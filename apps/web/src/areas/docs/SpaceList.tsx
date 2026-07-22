// The one LIVE screen: spaces from GET /api/docs/spaces (upstream body verbatim).
// macOS-Settings density — one 38px row per space, whole row is the affordance.
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Card, CardHeader, Row } from '@talyvor/ui'
import { docsApi, type DocsSpace } from './api'
import { Chip } from './components'

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
      className="cursor-pointer outline-accent hover:bg-canvas focus-visible:outline"
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

export function SpaceList() {
  const q = useQuery({ queryKey: ['docs-spaces'], queryFn: docsApi.spaces })
  const spaces = q.data ?? []
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-2">
      <Card>
        <CardHeader>
          <span className="inline-flex items-center gap-2">Spaces</span>
        </CardHeader>
        {q.isLoading ? (
          <div className="px-gutter py-3 text-body text-muted">Loading…</div>
        ) : q.isError ? (
          <div className="px-gutter py-3 text-body text-muted">Couldn’t load spaces.</div>
        ) : spaces.length === 0 ? (
          <div className="px-gutter py-3 text-body text-muted">No spaces in this workspace yet.</div>
        ) : (
          spaces.map((s) => <SpaceRow key={s.id} space={s} />)
        )}
      </Card>
      <p className="px-gutter text-caption font-normal text-faint">
        Live from the BFF’s Docs proxy — the workspace is pinned server-side.
      </p>
    </div>
  )
}
