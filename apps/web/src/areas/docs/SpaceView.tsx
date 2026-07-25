// One space's page tree.
//
// It used to render seven fabricated pages from ./fixtures.ts — titles, depths, locked chips,
// view counts of 128 / 64 / 31 / 12 / 7 / 45 / 90 — under a footnote claiming the BFF did not
// serve the read. The BFF does serve it (/api/docs/spaces/{spaceID}/pages); what is missing is
// a Docs upstream on this deployment. So the tree probes and reports, and buildTree/countNodes
// stay in ./tree.ts, unit-tested, ready for the live rows.
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { docsApi } from './api'
import { Crumbs } from './components'
import { DocsUpstreamCard } from './DocsUpstreamCard'

export function SpaceView() {
  const { spaceId = '' } = useParams()
  const spacesQ = useQuery({ queryKey: ['docs-spaces'], queryFn: docsApi.spaces })
  const space = spacesQ.data?.find((s) => s.id === spaceId)

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
