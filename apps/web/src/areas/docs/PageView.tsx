// The page reader: stored ProseMirror JSON rendered read-only. FIXTURE-backed until
// the BFF grows GET /api/docs/spaces/{spaceID}/pages/{pageID}.
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Card } from '@talyvor/ui'
import { ApiError } from '../../lib/api'
import { docsApi } from './api'
import { PMDoc } from './pm'
import { Chip, Crumbs, FixtureChip, FixtureNote, formatDay } from './components'

export function PageView() {
  const { spaceId = '', pageId = '' } = useParams()
  const spacesQ = useQuery({ queryKey: ['docs-spaces'], queryFn: docsApi.spaces })
  const pageQ = useQuery({
    queryKey: ['docs-page', spaceId, pageId],
    queryFn: () => docsApi.page(spaceId, pageId),
    enabled: spaceId !== '' && pageId !== '',
    retry: false,
  })

  const space = spacesQ.data?.find((s) => s.id === spaceId)
  const notFound = pageQ.error instanceof ApiError && pageQ.error.status === 404

  if (pageQ.isLoading) {
    return <div className="mx-auto max-w-3xl px-gutter py-3 text-body text-muted">Loading…</div>
  }
  if (notFound) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        <Crumbs trail={[{ label: 'Spaces', to: '/docs' }, { label: space?.name ?? spaceId, to: `/docs/spaces/${spaceId}` }, { label: 'Not found' }]} />
        <Card>
          <div className="px-gutter py-3 text-body text-muted">No such page in this space.</div>
        </Card>
      </div>
    )
  }
  if (pageQ.isError || !pageQ.data) {
    return <div className="mx-auto max-w-3xl px-gutter py-3 text-body text-muted">Couldn’t load this page.</div>
  }

  const { source, data: page } = pageQ.data
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-2">
      <Crumbs
        trail={[
          { label: 'Spaces', to: '/docs' },
          { label: space?.name ?? spaceId, to: `/docs/spaces/${spaceId}` },
          { label: page.title },
        ]}
      />
      <Card>
        <div className="flex flex-col gap-1 border-b border-rule px-gutter py-3">
          <div className="flex items-center justify-between gap-2">
            {/* UI chrome, deliberately not a heading element — the document's own
                first heading (rendered from content below) is the page's h1. */}
            <div className="flex min-w-0 items-center gap-2 text-title text-ink">
              {page.icon ? <span aria-hidden="true">{page.icon}</span> : null}
              <span className="truncate">{page.title}</span>
            </div>
            <span className="flex shrink-0 items-center gap-1">
              {source === 'fixture' ? <FixtureChip /> : null}
              {page.locked ? <Chip title="Soft-locked by another member">locked</Chip> : null}
              {page.doc_status ? <Chip title="Approval workflow status">{page.doc_status}</Chip> : null}
            </span>
          </div>
          <div className="text-caption font-normal tabular-nums text-faint">
            Updated {formatDay(page.updated_at)} · {page.view_count} views
            {page.last_verified_at ? ` · verified ${formatDay(page.last_verified_at)}` : ''}
          </div>
        </div>
        <div className="px-gutter py-4">
          <PMDoc content={page.content} />
        </div>
      </Card>
      {source === 'fixture' ? <FixtureNote /> : null}
    </div>
  )
}
