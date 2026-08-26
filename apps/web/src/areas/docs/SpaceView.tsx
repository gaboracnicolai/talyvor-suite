// One space's page list, and the form that creates a page in it.
//
// It used to render seven FABRICATED pages from ./fixtures.ts — titles, depths, locked chips, view
// counts of 128 / 64 / 31 / 12 / 7 / 45 / 90 — under a footnote claiming the BFF did not serve the
// read. Those are gone and none return: SAME RULE AS THE TRACK SCREEN. An empty space renders empty
// because the API returned [], not because a fixture said so, and "No pages yet" is the correct
// output for a space nobody has written in.
//
// Writes work now because Docs takes the SESSION's workspace (apps/bff docsWorkspaceFor) instead of
// a pinned one, and because Docs enumerates workspaces from Track rather than from the workspaces it
// already holds content for — the cold-start deadlock that made a brand-new identity's first page
// 403 (talyvor-track bf60842, talyvor-docs c970329).
//
// buildTree/countNodes stay in ./tree.ts, unit-tested, for when this list becomes a tree.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, focusRing } from '@talyvor/ui'
import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Region, RegionScreen } from '../../components/Region'
import { isSessionExpired, isUnconfigured } from '../../lib/productState'
import { docsApi } from './api'
import { BackButton, Crumbs, spaceCrumbLabel, spaceTitle } from './components'
import { DocsUpstreamCard } from './DocsUpstreamCard'

export function SpaceView() {
  const { spaceId = '' } = useParams()
  const qc = useQueryClient()
  const spacesQ = useQuery({ queryKey: ['docs-spaces'], queryFn: docsApi.spaces })
  const space = spacesQ.data?.find((s) => s.id === spaceId)

  const pagesKey = ['docs-pages', spaceId] as const
  const pages = useQuery({
    queryKey: pagesKey,
    queryFn: () => docsApi.pages(spaceId),
    retry: false,
    enabled: spaceId !== '',
  })
  const [title, setTitle] = useState('')
  // ⚠ THE EMPTY STATE PERFORMS ITS NEXT ACTION RATHER THAN POINTING AT IT. The copy this replaces
  // said "Create the first one above" — a spatial word, which names no control, means nothing to a
  // reader navigating by rotor, and had to be kept true by hand against the space list two clicks
  // up, whose form is BELOW its list and whose copy therefore said "below". Both screens now hand
  // the caret to the field instead, which is true from anywhere.
  const titleRef = useRef<HTMLInputElement | null>(null)
  // ⚠ THE REFUSAL IS OUR STATE, NOT `create.isError`, AND THE RESET BELOW IS WHY. A mutation's
  // error belongs to react-query's observer, which this component cannot clear from render — and
  // render is where the space change has to be answered (see below). Held here, the sentence is
  // reset by the same three lines that reset the words it sits under, so the two cannot disagree
  // about which space they are talking about. Cleared in `onMutate` rather than at the call site
  // so it cannot go stale if a second caller ever appears.
  const [failed, setFailed] = useState(false)

  // Invalidate on success so a created page appears without a reload — a create that does not
  // refetch leaves the writer looking at the list they just added to, and reads as a failure.
  const create = useMutation({
    mutationFn: (t: string) => docsApi.createPage(spaceId, t),
    onMutate: () => setFailed(false),
    onError: () => setFailed(true),
    onSuccess: async () => {
      setTitle('')
      await qc.invalidateQueries({ queryKey: pagesKey })
    },
  })

  // ⚠ BOTH OF THOSE BELONG TO ONE SPACE, AND NOTHING USED TO SAY SO.
  //
  // React Router matches /docs/spaces/:spaceId to ONE <Route> element, so moving from space A to
  // space B changes `spaceId` underneath this component and does NOT remount it — every useState
  // above survives. MEASURED, not reasoned about (the probe is now docsWrites.test.tsx's 'the
  // create form belongs to one space'): with 'A title meant for AAA' in the box on A, arriving at
  // B and pressing Create page sent
  //
  //     POST /api/docs/spaces/sp-b/pages {"title":"A title meant for AAA"}
  //
  // — a page created in B under a title meant for A, from a button the reader had every reason to
  // press; and a refusal about A stayed on screen over B.
  //
  // ⚠ IT IS NOT REACHABLE FROM THIS UI TODAY and it is still fixed here. Nothing on this screen
  // links to a sibling space — Back and the crumbs both go up to /docs and DO remount — so it
  // takes one ordinary addition (a space switcher, a recent list, a search result) to become a
  // page written into the wrong space, and whoever adds it has no reason to suspect this file.
  //
  // ⚠ THIS IS THE THIRD SCREEN IN THIS APP WITH THIS DEFECT, after PageView.tsx one level down
  // (`f4c1e97`, #190) and Track's IssueDetail.tsx (`d82bcfb`, #192). The first two were each
  // found by someone already reading the file; this one was found by asking the question of every
  // route in the app — the three <Route> elements that read a param and hold state — and it was
  // the only one of the three left unguarded.
  //
  // Resetting during render rather than in an effect is React's documented way to adjust state
  // when the thing it belongs to changes: the reset lands BEFORE the browser sees anything, so
  // the previous space's words are never painted under the new space's name.
  //
  // ⚠ AND THAT LAST SENTENCE IS THE ONE THING HERE NO TEST IN THIS REPO CAN SEE — MEASURED, so it
  // is not read as something the suite enforces. Moving these three lines into a
  // `useEffect(..., [spaceId])` leaves ALL 1220 tests green (control C7 in
  // ~/talyvor-queue/w11-spacestate-controls-8b47.py): jsdom and RTL observe state after the
  // effects have flushed, so the intermediate paint an effect would allow is invisible to them.
  // The three cases below pin WHICH space the words belong to; only a browser can pin WHEN. The
  // identical sentence in PageView.tsx and Track's IssueDetail.tsx is unpinned for the same
  // reason, and no floor or count would have shown it — only mutating the mechanism did.
  const [stateOf, setStateOf] = useState(spaceId)
  if (stateOf !== spaceId) {
    setStateOf(spaceId)
    setTitle('')
    setFailed(false)
  }

  const rows = pages.data ?? []
  const answered = !pages.isLoading && !pages.isError
  const empty = answered && rows.length === 0

  /* The way out, and the identifier, in one row — the same shape the Track ticket opens with. */
  const wayBack = (
    <div className="flex flex-wrap items-center gap-3">
      <BackButton to="/docs" />
      <Crumbs trail={[{ label: 'Spaces', to: '/docs' }, { label: spaceCrumbLabel(space?.name) }]} />
      <span className="font-mono text-caption text-muted">{spaceId}</span>
    </div>
  )

  // "Docs is not deployed here" is not "Docs is broken" and neither is "this space is empty".
  //
  // ⚠ THE TITLE IS THE SPACE'S NAME IN THIS BRANCH TOO, AND THE STATE CLAIM IS LEFT TO THE CARD.
  // `DocsUpstreamCard` RE-PROBES the same route and can answer four different ways — including
  // "Docs is configured on this deployment, but this view does not read it yet". A page-scale
  // heading saying "Docs is not configured here" would be a second claim about the same probe,
  // free to contradict it, and this file has already been the place where two sentences about one
  // fact drifted. The heading says what is certain: which space you are in.
  if (isUnconfigured(pages.error)) {
    return (
      <RegionScreen>
        <Region
          index="00"
          label="Space"
          heading={spaceTitle(space?.name)}
          sectionClassName="pb-10 pt-4 wide:pb-12"
          className="max-w-none"
        >
          {wayBack}
        </Region>
        <Region index="01" label="What is in it">
          <DocsUpstreamCard
            title={spaceTitle(space?.name)}
            path={`/api/docs/spaces/${encodeURIComponent(spaceId)}/pages`}
            reads="GET /api/docs/spaces/{spaceID}/pages"
          />
        </Region>
      </RegionScreen>
    )
  }

  return (
    <RegionScreen>
      <Region
        index="00"
        label="Space"
        heading={spaceTitle(space?.name)}
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="max-w-none"
      >
        {wayBack}
        {/* ⚠ THE OPENING REGION CARRIES A BODY ONLY WHEN THERE IS SOMETHING TO SAY, and the branch
            is a RENDER rather than a `hidden` class — Overview's rule. Copy about an empty space
            must not sit in the DOM of a full one.
            ⚠ AND THE TITLE IS NOT A STATE CLAIM ON THIS SCREEN, unlike its sibling two clicks up.
            There the read IS the subject, so the headline carries loading/empty/off/fault. Here you
            arrived from a list that ANSWERED, so the space exists and a failed page read says
            nothing about it; the page count is a fact about the space and belongs beside the pages.
            One screen's rule copied onto another without asking what its subject is would be the
            same mistake as one sentence for four causes, in the other direction. */}
        {empty ? (
          <>
            <p className="mt-8 max-w-2xl text-body text-muted">
              A page is anything worth writing down once and finding again — a runbook, a decision,
              the thing you explain to every new person.
            </p>
            <Button variant="primary" className="mt-8" onClick={() => titleRef.current?.focus()}>
              Write the first page
            </Button>
          </>
        ) : null}
      </Region>

      <Region index="01" label="What is in it">
        {pages.isLoading ? (
          <p className="text-body text-muted">Loading pages…</p>
        ) : isSessionExpired(pages.error) ? (
          // Said ONCE at the top of the app — a panel that cannot read for want of a credential
          // says only that it is unavailable, and the bar explains why.
          <p className="text-body text-muted">Unavailable.</p>
        ) : pages.isError ? (
          <p className="max-w-2xl text-body text-muted">
            Couldn’t reach Docs, so no pages can be shown. This is a fault, not an empty space.
          </p>
        ) : rows.length === 0 ? (
          <p className="max-w-2xl text-body text-muted">
            No pages yet. The first title goes in “Add a page” — that is a region label, which is the
            section&rsquo;s accessible name, so it is a place a rotor can actually go. It lands in
            your own workspace.
          </p>
        ) : (
          <ul className="flex flex-col">
            {rows.map((pg) => (
              <li key={pg.id} className="border-t border-rule py-2 first:border-t-0">
                <Link
                  className="text-body text-ink underline underline-offset-2"
                  to={`/docs/spaces/${spaceId}/pages/${pg.id}`}
                >
                  {pg.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Region>

      <Region index="02" label="Add a page">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const t = title.trim()
            if (!t || create.isPending) return
            create.mutate(t)
          }}
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-caption text-muted">Page title</span>
            <input
              ref={titleRef}
              className={`w-full rounded-control border border-rule bg-canvas px-2 py-1 text-body text-ink placeholder:text-faint transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What are you writing?"
            />
          </label>
          <Button type="submit" variant="primary" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create page'}
          </Button>
        </form>

        {/* ⚠ THE FORM IS NOT GATED ON THE PAGE READ, AND THAT IS UNCHANGED RATHER THAN DECIDED HERE.
            The space LIST gates its create form on its read having succeeded, because a create
            against an upstream that answered 503 is a button that 502s. This screen already returns
            early on `isUnconfigured`, so the off case never reaches this form — but a 500 on the
            PAGE read still leaves it offered. Whether a failed READ should withdraw a WRITE control
            is a product question, it was the shipped behaviour before this rebuild, and a rebuild
            is the wrong place to answer it quietly. Recorded, not changed. */}
        {failed ? (
          <p className="mt-4 text-body text-muted">
            Couldn’t create that page — nothing was saved. Try again.
          </p>
        ) : null}
      </Region>
    </RegionScreen>
  )
}
