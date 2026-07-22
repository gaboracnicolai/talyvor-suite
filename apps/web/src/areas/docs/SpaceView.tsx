// One space's page tree. FIXTURE-backed until the BFF grows
// GET /api/docs/spaces/{spaceID}/pages — marked on the card and under it.
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Card, CardHeader } from '@talyvor/ui'
import { docsApi } from './api'
import { buildTree, countNodes, type TreeNode } from './tree'
import { formatDay } from '@talyvor/ui'
import { Chip, Crumbs, FixtureChip, FixtureNote } from './components'

// Indent per depth from the named spacing scale only. Server caps depth at 5;
// anything deeper clamps to the last step rather than inventing a value.
const indent = ['pl-0', 'pl-4', 'pl-8', 'pl-12', 'pl-16', 'pl-20']
const indentFor = (depth: number) => indent[Math.max(0, Math.min(depth, indent.length - 1))]

function TreeRow({ node, depth, spaceID }: { node: TreeNode; depth: number; spaceID: string }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(true)
  const p = node.page
  const hasKids = node.children.length > 0
  const go = () => navigate(`/docs/spaces/${spaceID}/pages/${p.id}`)
  return (
    <>
      <div
        className={`flex min-h-row items-center justify-between gap-2 border-b border-rule px-gutter py-1 last:border-b-0 ${indentFor(depth)}`}
      >
        <span className="flex min-w-0 items-center gap-1">
          {hasKids ? (
            <button
              type="button"
              aria-label={open ? `Collapse ${p.title}` : `Expand ${p.title}`}
              aria-expanded={open}
              onClick={() => setOpen(!open)}
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-control text-body text-faint hover:bg-canvas"
            >
              <span aria-hidden="true" className={open ? 'rotate-90' : undefined}>
                ›
              </span>
            </button>
          ) : (
            <span aria-hidden="true" className="inline-block h-5 w-5 shrink-0" />
          )}
          <button
            type="button"
            onClick={go}
            className="flex min-w-0 items-center gap-2 rounded-control text-left text-body text-ink hover:underline"
          >
            {p.icon ? <span aria-hidden="true">{p.icon}</span> : null}
            <span className="truncate">{p.title}</span>
          </button>
          {p.locked ? <Chip title="Soft-locked by another member">locked</Chip> : null}
        </span>
        <span className="shrink-0 text-caption font-normal tabular-nums text-faint">{formatDay(p.updated_at)}</span>
      </div>
      {open && hasKids
        ? node.children.map((c) => <TreeRow key={c.page.id} node={c} depth={depth + 1} spaceID={spaceID} />)
        : null}
    </>
  )
}

export function SpaceView() {
  const { spaceId = '' } = useParams()
  const spacesQ = useQuery({ queryKey: ['docs-spaces'], queryFn: docsApi.spaces })
  const treeQ = useQuery({
    queryKey: ['docs-page-tree', spaceId],
    queryFn: () => docsApi.pageTree(spaceId),
    enabled: spaceId !== '',
  })

  const space = spacesQ.data?.find((s) => s.id === spaceId)
  const roots = treeQ.data ? buildTree(treeQ.data.data) : []

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-2">
      <Crumbs trail={[{ label: 'Spaces', to: '/docs' }, { label: space?.name ?? spaceId }]} />
      <Card>
        <CardHeader>
          <span className="inline-flex items-center gap-2">
            {space?.icon ? <span aria-hidden="true">{space.icon}</span> : null}
            {space?.name ?? spaceId}
            {treeQ.data?.source === 'fixture' ? <FixtureChip /> : null}
          </span>
        </CardHeader>
        {treeQ.isLoading ? (
          <div className="px-gutter py-3 text-body text-muted">Loading…</div>
        ) : treeQ.isError ? (
          <div className="px-gutter py-3 text-body text-muted">Couldn’t load this space’s pages.</div>
        ) : roots.length === 0 ? (
          <div className="px-gutter py-3 text-body text-muted">No pages in this space yet.</div>
        ) : (
          roots.map((n) => <TreeRow key={n.page.id} node={n} depth={0} spaceID={spaceId} />)
        )}
      </Card>
      {treeQ.data ? (
        <div className="flex items-center justify-between">
          <FixtureNote />
          <span className="shrink-0 px-gutter text-caption font-normal tabular-nums text-faint">
            {countNodes(roots)} pages
          </span>
        </div>
      ) : null}
    </div>
  )
}
