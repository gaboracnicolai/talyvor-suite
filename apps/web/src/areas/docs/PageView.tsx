// The page reader.
//
// It used to render a fabricated ProseMirror document with a fabricated view count and
// verification date. The BFF serves the real read (/api/docs/spaces/{spaceID}/pages/{pageID});
// this deployment has no Docs upstream behind it. PMDoc stays in ./pm.tsx, tested, so wiring
// this screen is adding the fetch back — against real rows this time.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, CardHeader, focusRing } from '@talyvor/ui'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { isSessionExpired, isUnconfigured } from '../../lib/productState'
import { docsApi } from './api'
import { BackButton, Crumbs, spaceCrumbLabel } from './components'
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
    // ⚠ THE RE-READ HAS TO REACH THE BOX, AND FOR ITS WHOLE LIFE IT COULD NOT. The invalidate was
    // here from the start — the intent is not in doubt — but the seeding effect above only ever
    // fills the draft `while it is null`, so the refetched page had nowhere to land and the
    // textarea went on showing the text that was typed at it whatever Docs did with it. A write
    // whose re-read cannot be observed is an optimistic echo with a network call in front of it,
    // and this app refuses that shape everywhere else it writes: Documents.tsx ("the rendered
    // state must be what Lens RECORDED"), Sharing.tsx, and the BFF's setDistillPolicy ("Report
    // what Lens RECORDED, never what was asked for").
    //
    // Dropping the draft AFTER the invalidate resolves — react-query awaits the refetch — hands
    // the effect a fresh page.data to seed from, so the box shows the stored value rather than
    // the submitted one. It matters here more than on the consent screens: the page PATCH sends
    // content_text, the projection Docs DERIVES from the document, so what comes back is not
    // always what went up. Whichever way that open question is settled, the reader is now looking
    // at the stored answer instead of their own keystrokes.
    //
    // ⚠ ONLY ON SUCCESS. A refused save keeps the draft — it is the only copy of those words, and
    // re-seeding from a server that did not take them would delete them. docsWrites.test.tsx
    // holds both directions.
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: pageKey })
      setDraft(null)
    },
  })

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-2">
      {/* The button and the crumb sit on one row: the crumb says WHERE YOU ARE, the button is the
          way out. Keeping both is deliberate — see BackButton for why the crumb alone was not
          enough, and why replacing it would lose the link semantics it still provides. */}
      <div className="flex flex-wrap items-center gap-3">
        <BackButton to={`/docs/spaces/${spaceId}`} />
        <Crumbs
          trail={[
            { label: 'Spaces', to: '/docs' },
            { label: spaceCrumbLabel(space?.name), to: `/docs/spaces/${spaceId}` },
          ]}
        />
      </div>
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
                    className={`min-h-40 w-full rounded-control border border-rule bg-canvas px-2 py-1 text-body text-ink transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
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
