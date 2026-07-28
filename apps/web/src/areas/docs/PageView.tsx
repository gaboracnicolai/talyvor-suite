// The page reader.
//
// It used to render a fabricated ProseMirror document with a fabricated view count and
// verification date. The BFF serves the real read (/api/docs/spaces/{spaceID}/pages/{pageID});
// this deployment has no Docs upstream behind it. PMDoc stays in ./pm.tsx, tested, so wiring
// this screen is adding the fetch back — against real rows this time.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, CardHeader } from '@talyvor/ui'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { isSessionExpired, isUnconfigured } from '../../lib/productState'
import { docsApi } from './api'
import { Crumbs, spaceCrumbLabel } from './components'
import { DocsUpstreamCard } from './DocsUpstreamCard'

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
  // Seed the editor from the server ONCE the page arrives, and never clobber an in-flight edit:
  // the draft is only initialised while it is null.
  useEffect(() => {
    if (draft === null && page.data) setDraft(page.data.content_text ?? '')
  }, [draft, page.data])

  const save = useMutation({
    mutationFn: (text: string) => docsApi.updatePage(spaceId, pageId, { content_text: text }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: pageKey })
    },
  })

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-2">
      <Crumbs
        trail={[
          { label: 'Spaces', to: '/docs' },
          { label: spaceCrumbLabel(space?.name), to: `/docs/spaces/${spaceId}` },
        ]}
      />
      {isUnconfigured(page.error) ? (
        <DocsUpstreamCard
          title="Page"
          path={`/api/docs/spaces/${encodeURIComponent(spaceId)}/pages/${encodeURIComponent(pageId)}`}
          reads="GET /api/docs/spaces/{spaceID}/pages/{pageID}"
        />
      ) : (
        <Card>
          <CardHeader>{page.data?.title ?? 'Page'}</CardHeader>
          <div className="flex flex-col gap-3 px-gutter py-4">
            {page.isLoading ? (
              <p className="text-caption text-muted">Loading page…</p>
            ) : isSessionExpired(page.error) ? (
              <p className="text-caption text-muted">Unavailable.</p>
            ) : page.isError ? (
              <p className="text-caption text-muted">
                Couldn’t reach Docs, so this page can’t be shown. This is a fault, not an empty page.
              </p>
            ) : (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-caption text-muted">Content</span>
                  <textarea
                    className="min-h-40 w-full rounded border border-hairline bg-canvas px-2 py-1 text-body text-ink"
                    value={draft ?? ''}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                </label>
                <div className="flex items-center gap-2">
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
              </>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}
