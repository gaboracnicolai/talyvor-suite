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
import { Button, Card, CardHeader, focusRing } from '@talyvor/ui'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { isSessionExpired, isUnconfigured } from '../../lib/productState'
import { docsApi } from './api'
import { BackButton, Crumbs, spaceCrumbLabel } from './components'
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

  // "Docs is not deployed here" is not "Docs is broken" and neither is "this space is empty".
  if (isUnconfigured(pages.error)) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <BackButton to="/docs" />
          <Crumbs trail={[{ label: 'Spaces', to: '/docs' }, { label: spaceCrumbLabel(space?.name) }]} />
        </div>
        <DocsUpstreamCard
          title={space?.name ?? spaceId}
          path={`/api/docs/spaces/${encodeURIComponent(spaceId)}/pages`}
          reads="GET /api/docs/spaces/{spaceID}/pages"
        />
      </div>
    )
  }

  const rows = pages.data ?? []

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
          <BackButton to="/docs" />
          <Crumbs trail={[{ label: 'Spaces', to: '/docs' }, { label: spaceCrumbLabel(space?.name) }]} />
        </div>
      <Card>
        <CardHeader>{space?.name ?? spaceId}</CardHeader>
        <div className="flex flex-col gap-4 px-gutter py-4">
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

          {failed ? (
            <p className="text-caption text-muted">
              Couldn’t create that page — nothing was saved. Try again.
            </p>
          ) : null}

          {pages.isLoading ? (
            <p className="text-caption text-muted">Loading pages…</p>
          ) : isSessionExpired(pages.error) ? (
            <p className="text-caption text-muted">Unavailable.</p>
          ) : pages.isError ? (
            <p className="text-caption text-muted">
              Couldn’t reach Docs, so no pages can be shown. This is a fault, not an empty space.
            </p>
          ) : rows.length === 0 ? (
            <p className="text-caption text-muted">
              No pages yet. Create the first one above — it lands in your own workspace.
            </p>
          ) : (
            <ul className="flex flex-col">
              {rows.map((pg) => (
                <li key={pg.id} className="border-t border-rule py-2 first:border-t-0">
                  <Link className="text-body text-ink underline" to={`/docs/spaces/${spaceId}/pages/${pg.id}`}>
                    {pg.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  )
}
