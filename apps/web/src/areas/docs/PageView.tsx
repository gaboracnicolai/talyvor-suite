// The page reader — three regions, one idea each, opened by the console's single page-scale
// heading (components/Region.tsx).
//
// It used to render a fabricated ProseMirror document with a fabricated view count and
// verification date. The BFF serves the real read (/api/docs/spaces/{spaceID}/pages/{pageID});
// this deployment has no Docs upstream behind it.
//
// ⚠ `PMDoc` STAYS IN ./pm.tsx AND THIS SCREEN STILL DOES NOT RENDER IT — MEASURED, because the
// item that produced this rebuild asked a design question that turns on whether it does. The
// question was: a page-scale heading here "sits ABOVE a document that has its own h1-equivalent"
// (pm.tsx maps a stored heading of level 1 to `text-title`), so which one is the page's title?
// It does not arise. `PMDoc` has ZERO production call sites — the only file that imports it is
// its own test — so the reader below renders a `<textarea>` of `content_text`, never a document
// with headings in it. The decision recorded is therefore that there is nothing to decide YET,
// and the day someone wires the renderer in, the question is theirs and it is a real one.
//
// ⚠ AND IT IS NOT A HOLE IN A GUARD, WHICH IS THE NEXT THING TO CHECK RATHER THAN ASSUME.
// ConsoleDeepHeading.test.tsx's SOURCE census reads `<h1` literally and pm.tsx builds its tag
// by computation (`const Tag = level <= 1 ? 'h1' : …`), which is exactly the blind spot that
// file's own limits paragraph names. Its DOM sweep is what covers it, and that sweep visits this
// address — so a wired-in PMDoc rendering a stored level-1 heading would count two `<h1>`s here
// and go red. The census is blind and the sweep is not, at the one address it matters.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, focusRing } from '@talyvor/ui'
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Region, RegionScreen } from '../../components/Region'
import { ApiError } from '../../lib/api'
import {
  isSessionExpired,
  isUnconfigured,
  notConfiguredCopy,
} from '../../lib/productState'
import { docsApi } from './api'
import { BackButton, Crumbs, pageTitle, spaceCrumbLabel } from './components'
import { PageSummary } from './PageSummary'
import { PageTranslation } from './PageTranslation'
import { PageChangelog } from './PageChangelog'
import { PageTitleSuggestion } from './PageTitleSuggestion'

// ── THE FIVE HEADLINES, AND WHY THIS SCREEN'S TITLE CARRIES STATE AT ALL ─────
//
// ⚠ THIS IS THE OPPOSITE OF THE DECISION ITS PARENT SCREEN TOOK, AND THE DIFFERENCE IS MEASURED
// RATHER THAN STYLISTIC. `SpaceView` one click up deliberately does NOT let its headline carry
// loading/empty/off/fault: the space's NAME comes from a different query (`docs-spaces`), so a
// broken page read says nothing about which space you are in, and the certain answer is available.
// Here there is no second source. The page's title arrives in the page read itself — the read that
// fails is the read that names it — so on a failure there is no certain name to fall back to, and
// a headline that pretended otherwise would be inventing one. What is certain in every state is
// WHAT HAPPENED, so that is what the largest words say.
//
// ⚠ 404 IS A STATE HERE, NOT A FAULT, AND THAT IS A SCREEN-LEVEL READING OF ONE BY-ID READ — the
// same one `areas/track/IssueDetail.tsx` already makes and documents at length, not a change to
// `lib/productState.ts` (which is right that a 404 from a COLLECTION route is a fault). MEASURED
// in the DOM before this rebuild: a 404 and a 500 at this address rendered byte-identical text —
// "Couldn’t reach Docs, so this page can’t be shown. This is a fault, not an empty page." — and
// BOTH of that sentence's clauses are false of a 404. Docs was reached. Docs answered. It is one
// predicate over four causes, which is the shape W1.1.8 removed from the ticket one directory
// over and which was still live here.
const HEADLINE_LOADING = 'Opening the page…'
const HEADLINE_MISSING = 'There is no page at this address.'
const HEADLINE_FAULT = 'Docs can’t be reached, so this page can’t be shown.'
const HEADLINE_OFF = 'Docs is not configured here.'
const HEADLINE_UNAVAILABLE = 'Unavailable.'

/** A read that answered 404 — see the headlines above for why this screen reads it as a state. */
function isMissing(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404
}

export function PageView() {
  const { spaceId = '', pageId = '' } = useParams()
  const qc = useQueryClient()
  const spacesQ = useQuery({ queryKey: ['docs-spaces'], queryFn: docsApi.spaces })
  const space = spacesQ.data?.find((s) => s.id === spaceId)

  const pageKey = ['docs-page', spaceId, pageId] as const
  const page = useQuery({
    queryKey: pageKey,
    queryFn: () => docsApi.page(spaceId, pageId),
    retry: false,
    enabled: spaceId !== '' && pageId !== '',
  })
  const [draft, setDraft] = useState<string | null>(null)
  // ⚠ THE EMPTY STATE PERFORMS ITS NEXT ACTION RATHER THAN POINTING AT IT — the rule both sibling
  // Docs screens now follow, for the reason SpaceView records: a spatial word ("below", "above")
  // names no control, means nothing to a reader navigating by rotor, and has to be kept true by
  // hand against a layout that moves.
  const editorRef = useRef<HTMLTextAreaElement | null>(null)
  // ⚠ THE DRAFT BELONGS TO ONE PAGE, AND NOTHING USED TO SAY SO.
  //
  // React Router matches /docs/spaces/:spaceId/pages/:pageId to ONE <Route> element, so moving
  // from one page to another does NOT remount this component — the params change underneath it
  // and useState survives. The seeding effect below only fills the draft `while it is null`, and
  // after the first page it never is again. MEASURED, not reasoned about (the probe is now
  // docsWrites.test.tsx's 'a different page gets a different draft'): navigating page A → page B
  // leaves the editor holding A's text under B's title, and Save then writes A's content INTO B.
  //
  // ⚠ IT IS NOT REACHABLE FROM THIS UI TODAY and it is still fixed here, deliberately. Nothing on
  // this screen links to a sibling page — the only ways out are the back button and the crumbs,
  // both of which go up through the space and DO remount. So the bug needs one ordinary addition
  // (a page tree in the sidebar, a "next page" link, a search result) to become silent data loss
  // in a document editor, and the person who adds that link has no reason to suspect this file.
  //
  // Resetting during render rather than in an effect is React's documented way to adjust state
  // when the thing it belongs to changes: the reset lands BEFORE the browser sees anything, so
  // the previous page's text is never painted under the new page's title.
  const pageIdentity = `${spaceId}/${pageId}`
  const [draftOf, setDraftOf] = useState(pageIdentity)
  if (draftOf !== pageIdentity) {
    setDraftOf(pageIdentity)
    setDraft(null)
  }
  // Seed the editor from the server ONCE the page arrives, and never clobber an in-flight edit:
  // the draft is only initialised while it is null.
  useEffect(() => {
    if (draft === null && page.data) setDraft(page.data.content_text ?? '')
  }, [draft, page.data])

  const save = useMutation({
    mutationFn: (text: string) => docsApi.updatePage(spaceId, pageId, { content_text: text }),
    // ⚠ THE RE-READ HAS TO REACH THE BOX, AND FOR ITS WHOLE LIFE IT COULD NOT. The invalidate was
    // here from the start — the intent is not in doubt — but the seeding effect above only ever
    // fills the draft `while it is null`, so the refetched page had nowhere to land and the
    // textarea went on showing the text that was typed at it whatever Docs did with it. A write
    // whose re-read cannot be observed is an optimistic echo with a network call in front of it,
    // and this app refuses that shape everywhere else it writes: Documents.tsx ("the rendered
    // state must be what Lens RECORDED"), Sharing.tsx, and the BFF's setDistillPolicy ("Report
    // what Lens RECORDED, never what was asked for").
    //
    // Dropping the draft AFTER the invalidate resolves — react-query awaits the refetch — hands
    // the effect a fresh page.data to seed from, so the box shows the stored value rather than
    // the submitted one. It matters here more than on the consent screens: the page PATCH sends
    // content_text, the projection Docs DERIVES from the document, so what comes back is not
    // always what went up. Whichever way that open question is settled, the reader is now looking
    // at the stored answer instead of their own keystrokes.
    //
    // ⚠ ONLY ON SUCCESS. A refused save keeps the draft — it is the only copy of those words, and
    // re-seeding from a server that did not take them would delete them. docsWrites.test.tsx
    // holds both directions.
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: pageKey })
      setDraft(null)
    },
  })

  // ⚠ THE HEADLINE IS CHOSEN FROM THE READ'S ACTUAL STATE, never from whether `page.data` is
  // undefined. `!page.data` is true while the read is in flight, true on a 404, true on a fault
  // and true on a dead credential — one predicate over four causes is exactly what put one
  // sentence on all of them. See the headlines above.
  const off = isUnconfigured(page.error)
  const expired = isSessionExpired(page.error)
  const missing = isMissing(page.error)
  const heading = page.data
    ? pageTitle(page.data.title)
    : off
      ? HEADLINE_OFF
      : expired
        ? HEADLINE_UNAVAILABLE
        : missing
          ? HEADLINE_MISSING
          : page.isError
            ? HEADLINE_FAULT
            : HEADLINE_LOADING

  /* The way out, the trail, and the identifier in one row — the shape both sibling screens open
     with. The button and the crumb are complementary rather than duplicates: the crumb says WHERE
     YOU ARE and carries the link semantics worth having, the button is unmistakably a control.
     See BackButton for the three sessions of evidence behind keeping both. */
  const wayBack = (
    <div className="flex flex-wrap items-center gap-3">
      <BackButton to={`/docs/spaces/${spaceId}`} />
      <Crumbs
        trail={[
          { label: 'Spaces', to: '/docs' },
          { label: spaceCrumbLabel(space?.name), to: `/docs/spaces/${spaceId}` },
        ]}
      />
      <span className="font-mono text-caption text-muted">{pageId}</span>
    </div>
  )

  if (!page.data) {
    // Every state with no page to draw still gets the screen's own landmark, its one page-scale
    // claim and the way out. The other two regions are not rendered at all rather than hidden: a
    // region is an idea, and there are no words and no AI controls to have an idea about.
    //
    // ⚠ THE OFF STATE NO LONGER DRAWS `DocsUpstreamCard`, AND THAT IS A DELETION WITH A REASON.
    // That card RE-PROBES the same route and can answer four ways, one of them "Docs is
    // configured on this deployment, but this view does not read it yet" — so beside a headline
    // reading "Docs is not configured here." it is a SECOND claim about ONE probe, free to
    // contradict the first. W1.1.9a named that drift exactly and avoided it the other way round:
    // there the heading is not a state claim, so the card is the screen's only claim. The rule
    // both screens now keep is the same one — exactly ONE claim about the upstream's state per
    // screen — and this screen's has to be the heading, because nothing else here is certain.
    // It is also what `IssueDetail.tsx` already does with `notConfiguredCopy('Track')`, so this
    // is the repo's existing answer applied rather than a new preference. The card keeps its
    // other call site and is unchanged.
    return (
      <RegionScreen>
        <Region index="00" label="Page" heading={heading} sectionClassName="pb-10 pt-4 wide:pb-12">
          <p className="max-w-2xl text-body text-muted">
            {off
              ? notConfiguredCopy('Docs')
              : expired
                ? // Said ONCE at the top of the app — a screen that cannot read for want of a
                  // credential says only that it is unavailable, and the bar explains why.
                  'The session that reads this workspace is no longer good.'
                : missing
                  ? // True of BOTH readings of a 404, because the upstream refuses to say which.
                    'Either it never existed, or it belongs to a space this session cannot read. Docs answers the same way for both, on purpose.'
                  : page.isError
                    ? 'This is a fault, not a missing page — Docs answered with an error, so nothing is drawn rather than something stale.'
                    : 'Reading it from Docs…'}
          </p>
          <div className="mt-8">{wayBack}</div>
        </Region>
      </RegionScreen>
    )
  }

  const stored = page.data.content_text ?? ''
  const blank = stored.trim() === ''

  return (
    <RegionScreen>
      <Region
        index="00"
        label="Page"
        heading={heading}
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="max-w-none"
      >
        {wayBack}
        {/* ⚠ THE OPENING REGION CARRIES THIS ONLY WHEN THERE IS SOMETHING TO SAY, and the branch
            is a RENDER rather than a `hidden` class — Overview's rule. Copy about an empty page
            must not sit in the DOM of a full one.

            ⚠ AND "EMPTY" HERE IS A PAGE THAT EXISTS AND HOLDS NO WORDS — not the missing state
            above and not the fault state above. Those three mean different things to whoever
            wrote the page, and this screen kept them apart in code while saying the same sentence
            for two of them; the headlines fixed that half and this is the other. The invitation
            hands over the caret rather than naming a direction. */}
        {blank ? (
          <>
            <p className="mt-8 max-w-2xl text-body text-muted">
              Nothing has been written on this page yet. A page is worth writing down once and
              finding again — a runbook, a decision, the thing you explain to every new person.
            </p>
            <Button variant="primary" className="mt-8" onClick={() => editorRef.current?.focus()}>
              Write the first words
            </Button>
          </>
        ) : null}
      </Region>

      <Region index="01" label="What it says">
        <label className="flex flex-col gap-1">
          <span className="text-caption text-muted">Content</span>
          <textarea
            ref={editorRef}
            className={`min-h-40 w-full rounded-control border border-rule bg-canvas px-2 py-1 text-body text-ink transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
            value={draft ?? ''}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
        <div className="mt-4 flex items-center gap-2">
          <Button
            variant="primary"
            disabled={save.isPending || draft === null}
            onClick={() => draft !== null && save.mutate(draft)}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
          {save.isError ? (
            <span className="text-caption text-muted">
              Couldn’t save — nothing was changed. Try again.
            </span>
          ) : null}
        </div>
      </Region>

      {/* ⚠ THE FOUR PANELS KEEP THEIR CARDS, AND THAT WAS RE-MEASURED RATHER THAN INHERITED. The
          item carried a recommendation from two sibling rebuilds and said in the same breath that
          it was "A RECOMMENDATION FROM TWO SIBLINGS, NOT A MEASUREMENT OF THESE FOUR". Measured:
          `meteredCostCensus.test.tsx` mounts each of these panels STANDALONE — outside this
          screen entirely — and reads its whole body text to check the price is stated before the
          click. Dissolving the cards would change what that instrument sees while it went on
          asserting the same thing, which is how a census quietly stops covering its subject. The
          REGION names the question and the four cards name the answers, which is also the shape
          the Track ticket landed on for its three (`04 What Track’s AI makes of it`). */}
      <Region index="02" label="What Docs’s AI makes of it">
        <div className="flex flex-col gap-3">
          {/* ⚠ EVERY ONE IS FED THE STORED PAGE, NOT `draft`. The charge lands on this page
              (docs_ai.go), so the bytes sent have to be this page's — summarising unsaved
              keystrokes would bill a document for words it does not contain. It is also why these
              controls need no editor at all, which is the claim W1.7 recorded as blocking them.

              ⚠ THE GATE ON `page.data` THAT USED TO WRAP EACH ONE IS NOW THE `!page.data` RETURN
              ABOVE — the same condition, stated once, at the point where the whole region stops
              making sense rather than four times over four panels. A generate against a page that
              failed to load would send an empty text and, but for the refusal on both sides, buy
              a completion of nothing; PageChangelog's reason differs and is stronger, since it
              would WRITE a row onto a page that is not there. */}
          <PageSummary pageId={pageId} text={stored} />
          {/* Translate adds a third rule of its own: it is the one control here that can succeed
              in the wrong language, because upstream a missing `language` is a 200 and a billed
              completion in English rather than an error. PageTranslation.tsx therefore ships with
              no default language; see its header for the measurement. */}
          <PageTranslation pageId={pageId} text={stored} />
          {/* The one card here whose output can be WRITTEN BACK. It writes `title`, a column of
              its own, so it does not touch the `content_text` question the editor above still
              owns; and it writes on its OWN second click, never on the suggestion arriving. */}
          <PageTitleSuggestion spaceId={spaceId} pageId={pageId} text={stored} />
          {/* The one control here that sends NONE of the page, and the one that leaves something
              behind. Summarise and translate both read `content_text` and both buy a metered Lens
              completion; this sends only a version and a list of issue ids, and buys nothing —
              measured, changelog generation reaches Lens never (it groups Track issues by label). */}
          <PageChangelog spaceId={spaceId} pageId={pageId} />
        </div>
      </Region>
    </RegionScreen>
  )
}
