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
import { Button, Card, CardHeader } from '@talyvor/ui'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { isUnconfigured } from '../../lib/productState'
import { docsApi } from './api'
import { Crumbs } from './components'
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

  // Invalidate on success so a created page appears without a reload — a create that does not
  // refetch leaves the writer looking at the list they just added to, and reads as a failure.
  const create = useMutation({
    mutationFn: (t: string) => docsApi.createPage(spaceId, t),
    onSuccess: async () => {
      setTitle('')
      await qc.invalidateQueries({ queryKey: pagesKey })
    },
  })

  // "Docs is not deployed here" is not "Docs is broken" and neither is "this space is empty".
  if (isUnconfigured(pages.error)) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        <Crumbs trail={[{ label: 'Spaces', to: '/docs' }, { label: space?.name ?? spaceId }]} />
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
      <Crumbs trail={[{ label: 'Spaces', to: '/docs' }, { label: space?.name ?? spaceId }]} />
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
                className="w-full rounded border border-hairline bg-canvas px-2 py-1 text-body text-ink"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What are you writing?"
              />
            </label>
            <Button type="submit" variant="primary" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create page'}
            </Button>
          </form>

          {create.isError ? (
            <p className="text-caption text-muted">
              Couldn’t create that page — nothing was saved. Try again.
            </p>
          ) : null}

          {pages.isLoading ? (
            <p className="text-caption text-muted">Loading pages…</p>
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
                <li key={pg.id} className="border-t border-hairline py-2 first:border-t-0">
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
