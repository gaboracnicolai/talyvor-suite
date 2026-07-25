// The page reader.
//
// It used to render a fabricated ProseMirror document with a fabricated view count and
// verification date. The BFF serves the real read (/api/docs/spaces/{spaceID}/pages/{pageID});
// this deployment has no Docs upstream behind it. PMDoc stays in ./pm.tsx, tested, so wiring
// this screen is adding the fetch back — against real rows this time.
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { docsApi } from './api'
import { Crumbs } from './components'
import { DocsUpstreamCard } from './DocsUpstreamCard'

export function PageView() {
  const { spaceId = '', pageId = '' } = useParams()
  const spacesQ = useQuery({ queryKey: ['docs-spaces'], queryFn: docsApi.spaces })
  const space = spacesQ.data?.find((s) => s.id === spaceId)

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-2">
      <Crumbs
        trail={[
          { label: 'Spaces', to: '/docs' },
          { label: space?.name ?? spaceId, to: `/docs/spaces/${spaceId}` },
        ]}
      />
      <DocsUpstreamCard
        title="Page"
        path={`/api/docs/spaces/${encodeURIComponent(spaceId)}/pages/${encodeURIComponent(pageId)}`}
        reads="GET /api/docs/spaces/{spaceID}/pages/{pageID}"
      />
    </div>
  )
}
