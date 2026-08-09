// The one LIVE screen: spaces from GET /api/docs/spaces (upstream body verbatim).
// macOS-Settings density — one 38px row per space, whole row is the affordance.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, CardHeader, Row } from '@talyvor/ui'
import { ApiError } from '../../lib/api'
import { docsApi, type DocsSpace } from './api'
import { Chip } from './components'
import { isSessionExpired } from '../../lib/productState'
import { PanelFailure } from '../../components/SessionExpiredBar'

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

/**
 * The way in. Until this existed a workspace with zero spaces was a dead end: the create-page form
 * lives INSIDE a space, so with nothing to open there was nothing to do — the product was unreachable
 * from its own empty state.
 *
 * Same shape as SpaceView's create-page form, deliberately: one labelled field, one primary button,
 * invalidate on success. A second style for the same act would be the invention.
 */
function CreateSpaceForm() {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  // Invalidate on success so the new space appears without a reload — the create that does not
  // refetch leaves someone looking at the empty list they just acted on, which reads as a failure.
  const create = useMutation({
    mutationFn: (n: string) => docsApi.createSpace(n),
    onSuccess: async () => {
      setName('')
      await qc.invalidateQueries({ queryKey: ['docs-spaces'] })
    },
  })
  return (
    <div className="flex flex-col gap-1 px-gutter py-3">
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const n = name.trim()
          if (!n || create.isPending) return
          create.mutate(n)
        }}
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-caption text-muted">Space name</span>
          <input
            className="w-full rounded border border-rule bg-canvas px-2 py-1 text-body text-ink"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Engineering"
          />
        </label>
        <Button type="submit" variant="primary" disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create space'}
        </Button>
      </form>
      {create.isError ? (
        <p className="text-caption text-muted">
          Couldn’t create that space — nothing was saved. Try again.
        </p>
      ) : null}
    </div>
  )
}

export function SpaceList() {
  const q = useQuery({ queryKey: ['docs-spaces'], queryFn: docsApi.spaces })
  const spaces = q.data ?? []
  // An unconfigured upstream is a 503 from the BFF's proxyProduct ("… upstream
  // not configured on this BFF"), and a 404 is a BFF built before the Docs
  // routes — both are INFORMATION, not faults (the same reading Overview's
  // product probe uses). Everything else is a real failure.
  const off = q.error instanceof ApiError && (q.error.status === 503 || q.error.status === 404)
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-2">
      <Card>
        <CardHeader>
          <span className="inline-flex items-center gap-2">Spaces</span>
        </CardHeader>
        {q.isLoading ? (
          <div className="px-gutter py-3 text-body text-muted">Loading…</div>
        ) : off ? (
          <div className="px-gutter py-3 text-body text-muted">
            Docs is not configured on this BFF deployment.
          </div>
        ) : q.isError ? (
          <PanelFailure error={q.error} what="spaces" />
        ) : spaces.length === 0 ? (
          // "below", not "above": SpaceView's form sits over its list and this one sits under it.
          // The word is the whole value of the sentence — a direction that points the wrong way is
          // worse than no direction, and the two screens genuinely differ.
          <div className="px-gutter py-3 text-body text-muted">
            No spaces in this workspace yet. Create the first one below — it lands in your own
            workspace.
          </div>
        ) : (
          spaces.map((s) => <SpaceRow key={s.id} space={s} />)
        )}
        {/* The form is gated on isSuccess for the same reason the caption below is: it may only be
            offered where it can actually work. An off or failing upstream cannot take a create, and
            a button that answers 503 is a worse empty state than an honest sentence. */}
        {q.isSuccess ? <CreateSpaceForm /> : null}
      </Card>
      {/* The caption is STATE-DEPENDENT: a liveness claim may only ever sit under
          data that is actually live. A failure state carrying "Live from …" was
          the review's worst finding — never reintroduce an unconditional caption. */}
      {q.isSuccess ? (
        <p className="px-gutter text-body text-faint">
          Live from the BFF’s Docs proxy — the workspace is pinned server-side.
        </p>
      ) : off ? (
        <p className="px-gutter text-body text-faint">
          The BFF has no Docs upstream wired (its DOCS_* trio is unset) — off, not
          broken. Nothing is shown because nothing is being served.
        </p>
      ) : isSessionExpired(q.error) ? null : q.isError ? (
        <p className="px-gutter text-body text-faint">
          The Docs proxy answered with an error — this screen shows nothing rather
          than something stale or invented.
        </p>
      ) : null}
    </div>
  )
}
