// The one LIVE screen: spaces from GET /api/docs/spaces (upstream body verbatim).
// macOS-Settings density — one 38px row per space, whole row is the affordance.
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Row, focusRing } from '@talyvor/ui'
import { Region, RegionScreen } from '../../components/Region'
import { ApiError } from '../../lib/api'
import { AskAI } from './AskAI'
import { SearchDocs } from './SearchDocs'
import { docsApi, type DocsSpace } from './api'
import { Chip } from './components'
import { isSessionExpired } from '../../lib/productState'
import { PanelFailure } from '../../components/SessionExpiredBar'

function SpaceRow({ space }: { space: DocsSpace }) {
  const navigate = useNavigate()
  const open = () => navigate(`/docs/spaces/${space.id}`)
  return (
    <Row
      role="link"
      tabIndex={0}
      aria-label={`Open space ${space.name}`}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open()
        }
      }}
      className={`cursor-pointer transition-colors duration-200 hover:bg-canvas ${focusRing}`}
      label={
        <span className="inline-flex items-center gap-2">
          {space.icon ? <span aria-hidden="true">{space.icon}</span> : null}
          {space.name}
        </span>
      }
      hint={space.description || space.slug}
    >
      {space.private ? <Chip title="Visible to invited members only">private</Chip> : null}
      <span aria-hidden="true" className="text-body text-faint">
        ›
      </span>
    </Row>
  )
}

/**
 * The way in. Until this existed a workspace with zero spaces was a dead end: the create-page form
 * lives INSIDE a space, so with nothing to open there was nothing to do — the product was unreachable
 * from its own empty state.
 *
 * Same shape as SpaceView's create-page form, deliberately: one labelled field, one primary button,
 * invalidate on success. A second style for the same act would be the invention.
 *
 * ⚠ IT TAKES A REF BECAUSE THE EMPTY STATE PERFORMS ITS NEXT ACTION RATHER THAN DESCRIBING IT —
 * see §THE FOUR HEADLINES. The field is the destination, and a button two regions up puts the caret
 * in it; without the ref the invitation would be another sentence pointing at a place.
 */
function CreateSpaceForm({ nameRef }: { nameRef: React.MutableRefObject<HTMLInputElement | null> }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  // Invalidate on success so the new space appears without a reload — the create that does not
  // refetch leaves someone looking at the empty list they just acted on, which reads as a failure.
  const create = useMutation({
    mutationFn: (n: string) => docsApi.createSpace(n),
    onSuccess: async () => {
      setName('')
      await qc.invalidateQueries({ queryKey: ['docs-spaces'] })
    },
  })
  return (
    <div className="flex flex-col gap-1">
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const n = name.trim()
          if (!n || create.isPending) return
          create.mutate(n)
        }}
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-caption text-muted">Space name</span>
          <input
            ref={nameRef}
            className={`w-full rounded-control border border-rule bg-canvas px-2 py-1 text-body text-ink placeholder:text-faint transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Engineering"
          />
        </label>
        <Button type="submit" variant="primary" disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create space'}
        </Button>
      </form>
      {create.isError ? (
        <p className="text-caption text-muted">
          Couldn’t create that space — nothing was saved. Try again.
        </p>
      ) : null}
    </div>
  )
}

/**
 * THE FOUR HEADLINES, AND WHY ADDING A HEADING TO THIS SCREEN ADDED FOUR WAYS TO BE WRONG.
 *
 * The card said "Spaces" in every state this screen has — loading, off, failed, and a workspace
 * full of them. That was safe because it claimed nothing, and it is also why the screen said
 * nothing: the largest words on the page were a noun. W1.1.9 gives it the console's page-scale
 * step, and a claim can be false.
 *
 * ⚠ THE OBVIOUS PREDICATE — a bare test of the row count against zero — IS WRONG TWICE: it is
 * true while the read is in flight, and true when the read FAILED. So "nothing is written down
 * here" would be printed over both a loading screen and a broken Docs, in the biggest type the
 * console has. The same repair as the issue list: the headline is chosen from the read's own
 * state. ⚠ AND THE EXPRESSION IS DESCRIBED RATHER THAN QUOTED, deliberately —
 * `emptyVsFault.test.ts` compares the RAW file's empty-branch count against the
 * COMMENT-STRIPPED one, so prose that quotes the branch makes raw exceed stripped and reports
 * a stripper eating live code. It caught this docstring on the first run.
 *
 * ⚠ AND OFF IS NOT BROKEN. This area has said so since its first commit — a 503 from the BFF's
 * proxyProduct (and a 404 from a BFF built before the Docs routes) means "not wired here", and the
 * caption at the bottom of this screen has carried that distinction all along. The heading carries
 * it now too, which is the loudest place it has ever been said, and it is why there are FOUR
 * headlines rather than three.
 */
const HEADLINE = 'Everything this workspace has written down.'
const HEADLINE_EMPTY = 'Nothing is written down in this workspace yet.'
const HEADLINE_OFF = 'Docs is not configured here.'
const HEADLINE_FAULT = 'Docs can’t be reached, so nothing can be listed.'

export function SpaceList() {
  const q = useQuery({ queryKey: ['docs-spaces'], queryFn: docsApi.spaces })
  const spaces = q.data ?? []
  const nameRef = useRef<HTMLInputElement | null>(null)
  // An unconfigured upstream is a 503 from the BFF's proxyProduct ("… upstream
  // not configured on this BFF"), and a 404 is a BFF built before the Docs
  // routes — both are INFORMATION, not faults (the same reading Overview's
  // product probe uses). Everything else is a real failure.
  const off = q.error instanceof ApiError && (q.error.status === 503 || q.error.status === 404)
  // ⚠ THE PREDICATE IS NOT SPELLED IN THIS COMMENT ON PURPOSE. `emptyVsFault.test.ts` counts the
  // empty-branch expression in the RAW file against the COMMENT-STRIPPED one and reds when they
  // differ, because that difference is how a broken stripper swallowing live code announces
  // itself. Prose that quotes the expression reports a stripper bug that is not there. Describe
  // it, do not quote it: the screen has answered when it is neither loading nor in error.
  const answered = !q.isLoading && !q.isError
  const empty = answered && spaces.length === 0
  const heading = off
    ? HEADLINE_OFF
    : q.isError
      ? HEADLINE_FAULT
      : empty
        ? HEADLINE_EMPTY
        : HEADLINE

  return (
    <RegionScreen>
      <Region
        index="00"
        label="Spaces"
        heading={heading}
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="max-w-none"
      >
        {/* ⚠ THE OPENING REGION CARRIES A BODY ONLY WHEN THERE IS SOMETHING TO SAY, and the branch
            is a RENDER rather than a `hidden` class — Overview's rule. Copy about an empty
            workspace must not sit in the DOM of a full one. */}
        {empty ? (
          <>
            <p className="max-w-2xl text-body text-muted">
              A space keeps pages that belong together — a team, a product, a decision you will
              come back to. It stays in your own workspace.
            </p>
            {/* ⚠ THE NEXT ACTION IS PERFORMED, NOT DESCRIBED. The copy this replaces read "Create
                the first one below", and its own comment argued that "below" was "the whole value
                of the sentence". It was not: a spatial word is meaningless to anyone navigating by
                rotor, it names no control, and it had to be kept true by hand across two screens
                that point opposite ways (SpaceView says "above"). The button puts the caret in the
                field it is talking about, which is true from anywhere and on any screen reader. */}
            <Button variant="primary" className="mt-8" onClick={() => nameRef.current?.focus()}>
              Name the first space
            </Button>
          </>
        ) : null}
      </Region>

      <Region index="01" label="What this workspace has">
        {q.isLoading ? (
          <p className="text-body text-muted">Loading…</p>
        ) : off ? (
          <p className="max-w-2xl text-body text-muted">
            The BFF has no Docs upstream wired (its DOCS_* trio is unset) — off, not broken. Nothing
            is shown because nothing is being served.
          </p>
        ) : q.isError ? (
          <>
            <PanelFailure error={q.error} what="spaces" />
            {/* ⚠ THIS SECOND SENTENCE IS NOT A RESTATEMENT OF THE FIRST, AND I REMOVED IT ONCE ON
                THE BELIEF THAT IT WAS. `PanelFailure` says the OUTCOME ("Couldn't load spaces.");
                this says WHO answered and what the screen did about it. `SessionExpired.test.tsx`
                caught the loss with a test whose own comment calls itself "the control" and
                explains why it exists: "these sentences are correct when the upstream really is
                unreachable, and deleting them everywhere would be the opposite mistake — trading
                one wrong diagnosis for a vaguer one". It names /docs specifically, "because its
                copy is the most explicit about reachability". It was, and for one commit it was
                not.
                ⚠ AND IT IS WITHHELD ON A 401 FOR THE SAME REASON IT IS SAID ON A 502: a dead
                credential is not the proxy answering with an error, and the bar at the top of the
                app already owns that sentence. */}
            {isSessionExpired(q.error) ? null : (
              <p className="mt-3 max-w-2xl text-body text-muted">
                The Docs proxy answered with an error — this screen shows nothing rather than
                something stale or invented.
              </p>
            )}
          </>
        ) : spaces.length === 0 ? (
          <p className="max-w-2xl text-body text-muted">
            No spaces in this workspace yet. The first one is named in “Start a space” — that is a
            region label, which is the section&rsquo;s accessible name, so it is a place a rotor can
            actually go. It lands in your own workspace.
          </p>
        ) : (
          <div className="flex flex-col">
            {spaces.map((s) => (
              <SpaceRow key={s.id} space={s} />
            ))}
          </div>
        )}

        {/* The caption is STATE-DEPENDENT: a liveness claim may only ever sit under data that is
            actually live. A failure state carrying "Live from …" was the review's worst finding —
            never reintroduce an unconditional caption.
            ⚠ THE OFF AND FAILED ARMS MOVED UP INTO THE BRANCH ABOVE. A caption sits under
            something and comments on it, and with the panel showing an empty box there was nothing
            for them to sit under — the off arm in particular was the SECOND wording of a fact the
            card body already stated ("Docs is not configured on this BFF deployment"), so that one
            collapsed into the wording that names the variables an operator has to set. ⚠ THE FAILED
            ARM DID NOT COLLAPSE, AND MY FIRST DRAFT OF THIS PARAGRAPH SAID IT DID: see the ⚠ in the
            error branch above. Only the liveness claim is genuinely a caption, and it is still
            here, still gated on the read having succeeded.
            ⚠ AND THE 401 ARM IS GONE FROM THIS FILE RATHER THAN MOVED, which is a removal worth
            naming: it existed to SUPPRESS the "proxy answered with an error" caption on a dead
            credential, so that this screen would not say what the bar at the top of the app
            already says. The caption it suppressed is now `PanelFailure`, which makes the same
            distinction itself ("Unavailable." on a 401, "Couldn't load spaces." otherwise). One
            predicate, in the component that owns the sentence, instead of two agreeing by hand. */}
        {q.isSuccess ? (
          <p className="mt-6 text-body text-faint">
            Live from the BFF’s Docs proxy — the workspace is pinned server-side.
          </p>
        ) : null}
      </Region>

      {/* The form is gated on isSuccess for the same reason the caption is: it may only be offered
          where it can actually work. An off or failing upstream cannot take a create, and a button
          that answers 503 is a worse empty state than an honest sentence.
          ⚠ THAT GATE IS WHY THE INDICES STAY CONTIGUOUS RATHER THAN FIXED PER IDEA. The two gated
          regions are the LAST two, so an off deployment renders `00 01` and a live one `00 01 02
          03` — a reader never meets a gap where a region was withheld. It is also why the create
          form sits BELOW the list here while the issue list puts its create form above: the gate
          decides the order, not a preference. */}
      {q.isSuccess ? (
        <Region index="02" label="Start a space">
          <CreateSpaceForm nameRef={nameRef} />
        </Region>
      ) : null}

      {/* ⚠ ONE REGION, TWO CARDS, AND THEY ARE TWO DIFFERENT QUESTIONS OF ONE KIND. Ask reads an
          answer out of the corpus; Search finds the pages. Both are on the same gate as the create
          form and for the same reason — they may only be offered where they can work. When the
          spaces read succeeded, Docs is reachable; whether its AI is configured is a SEPARATE
          question AskAI.tsx answers by ASKING rather than by a sentence written here (see
          lib/productState.ts for why a deployment state is detected rather than asserted), and
          whether Docs' SEMANTIC half is configured is a third question that no search response can
          answer, which is why SearchDocs.tsx hedges instead of captioning itself.
          ⚠ BOTH KEEP THEIR CARDS. `meteredCostCensus.test.tsx` and `aiCostClaim`-shaped censuses
          render these panels STANDALONE, and a region that dissolved their cards would change what
          those instruments see without changing what they assert. */}
      {q.isSuccess ? (
        <Region index="03" label="Ask across the workspace">
          <div className="flex flex-col gap-gutter">
            <AskAI />
            <SearchDocs />
          </div>
        </Region>
      ) : null}
    </RegionScreen>
  )
}
