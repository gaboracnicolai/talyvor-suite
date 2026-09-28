import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Input } from '@talyvor/ui'
import { Region } from '../../components/Region'
import { StoredAnswersFacts } from '../../components/StoredAnswersFacts'
import { ApiError, getJSON } from '../../lib/api'
import { isSessionExpired } from '../../lib/productState'

// StoredAnswers.tsx — B21.4: Features' "Stored answers" section. What this workspace has stored
// (Lens's B21.3 counts), deleting the answers it shared or everything it has stored — each
// confirmed by typing the workspace's name — and asking Talyvor to delete all of its data, with
// that request's status. Lens decides who may delete (the workspace's owner or an admin) and checks
// the typed name itself; this screen only says which refusal it was.

/** GET /api/features/stored-answers — Lens's counts, and the name a deletion is confirmed with. */
interface StoredCounts {
  shared_answers: number
  private_answers: number
  shared_conversions: number
  private_conversions: number
}

interface StoredReading extends StoredCounts {
  confirm_with: string
}

/** GET /api/features/deletion-requests — requests to delete everything, newest first. */
interface DeletionRequest {
  id: number
  status: string
  requested_at: string
  completed_at?: string
}

type Scope = 'shared' | 'all'

const STORED_KEY = ['stored-answers']
const REQUESTS_KEY = ['deletion-requests']

async function send<T>(path: string, body: object): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new ApiError(res.status, path)
  return (await res.json()) as T
}

const n = (v: number) => <span className="font-figure">{v.toLocaleString('en-US')}</span>
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

function refusal(err: unknown, what: string): string {
  if (isSessionExpired(err)) return `Nothing was ${what} — sign in again.`
  if (err instanceof ApiError && err.status === 403)
    return `Only this workspace’s owner or an admin can do this. Nothing was ${what}.`
  if (err instanceof ApiError && err.status === 400) return `That is not this workspace’s name. Nothing was ${what}.`
  return `Nothing was ${what}. You can try again.`
}

const DELETE: Record<Scope, { button: string; warning: string; done: (d: StoredCounts) => React.ReactNode }> = {
  shared: {
    button: 'Delete shared answers',
    warning:
      'Every answer and document conversion this workspace shared is deleted: nobody else is served them again, and they stop earning. This workspace’s own answers stay.',
    done: (d) => (
      <>
        Deleted {n(d.shared_answers)} shared answers and {n(d.shared_conversions)} shared document conversions.
      </>
    ),
  },
  all: {
    button: 'Delete everything stored',
    warning:
      'Every answer and document conversion this workspace has stored is deleted, shared or not: shared ones stop earning, and a repeated question goes to the model and is paid for again.',
    done: (d) => (
      <>
        Deleted {n(d.shared_answers + d.private_answers)} answers and{' '}
        {n(d.shared_conversions + d.private_conversions)} document conversions.
      </>
    ),
  },
}

function DeleteStored({ scope, confirmWith }: { scope: Scope; confirmWith: string }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const remove = useMutation({
    mutationFn: () =>
      send<{ deleted: StoredCounts }>('/api/features/stored-answers/delete', { scope, confirm: typed }),
    onSettled: () => qc.invalidateQueries({ queryKey: STORED_KEY }),
    onSuccess: () => {
      setOpen(false)
      setTyped('')
    },
  })
  const copy = DELETE[scope]
  if (!open) {
    return (
      <div className="flex flex-col gap-1">
        <div>
          <Button variant="danger" onClick={() => setOpen(true)}>
            {copy.button}…
          </Button>
        </div>
        {remove.isSuccess ? (
          <p role="status" className="text-caption text-ink">
            {copy.done(remove.data.deleted)}
          </p>
        ) : null}
      </div>
    )
  }
  return (
    <form
      className="flex w-full flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (typed === confirmWith && !remove.isPending) remove.mutate()
      }}
    >
      <p className="text-body text-ink">
        {copy.warning} <strong>This cannot be undone.</strong> Answers already given to other users stay in their
        conversations; they cannot be taken back.
      </p>
      <label className="flex flex-col gap-1">
        <span className="text-caption text-muted">
          Type <span className="font-mono text-ink">{confirmWith}</span> to confirm
        </span>
        <Input
          aria-label={`Type ${confirmWith} to confirm`}
          className="max-w-xs font-mono"
          value={typed}
          autoComplete="off"
          onChange={(e) => setTyped(e.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <Button type="submit" variant="danger" disabled={typed !== confirmWith || remove.isPending}>
          {remove.isPending ? 'Deleting…' : copy.button}
        </Button>
        <Button
          onClick={() => {
            setOpen(false)
            setTyped('')
            remove.reset()
          }}
        >
          Cancel
        </Button>
      </div>
      {remove.isError ? (
        <p className="text-caption text-ink" role="alert">
          {refusal(remove.error, 'deleted')}
        </p>
      ) : null}
    </form>
  )
}

function requestLine(r: DeletionRequest): React.ReactNode {
  if (r.status === 'done' && r.completed_at)
    return (
      <>
        Asked {day(r.requested_at)} — done {day(r.completed_at)}. Everything Talyvor held for this workspace was
        deleted; billing and ledger records are kept, because the law requires them.
      </>
    )
  return <>Asked {day(r.requested_at)} — waiting for Talyvor to delete it.</>
}

function AskForDeletion() {
  const qc = useQueryClient()
  const requests = useQuery({
    queryKey: REQUESTS_KEY,
    queryFn: () => getJSON<{ requests: DeletionRequest[] }>('/api/features/deletion-requests'),
  })
  const ask = useMutation({
    mutationFn: () => send<DeletionRequest>('/api/features/deletion-requests', {}),
    onSettled: () => qc.invalidateQueries({ queryKey: REQUESTS_KEY }),
  })
  const list = requests.data?.requests ?? []
  const waiting = list.some((r) => r.status !== 'done')
  return (
    <div className="flex flex-col gap-2">
      <p className="text-body text-muted">
        An operator deletes everything Talyvor holds for this workspace, its stored answers and conversions
        included, and marks the request done here. Billing and ledger records are kept, because the law requires
        them.
      </p>
      <div>
        <Button variant="danger" disabled={waiting || ask.isPending || !requests.isSuccess} onClick={() => ask.mutate()}>
          {ask.isPending ? 'Asking…' : 'Ask Talyvor to delete all my data'}
        </Button>
      </div>
      {ask.isError ? (
        <p className="text-caption text-ink" role="alert">
          {refusal(ask.error, 'asked for')}
        </p>
      ) : null}
      {requests.isError ? (
        <p className="text-caption text-muted">Whether you have asked before could not be read just now.</p>
      ) : (
        <ul className="text-caption text-ink" data-testid="deletion-requests">
          {list.map((r) => (
            <li key={r.id}>{requestLine(r)}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function StoredAnswers() {
  const stored = useQuery({ queryKey: STORED_KEY, queryFn: () => getJSON<StoredReading>('/api/features/stored-answers') })
  const s = stored.data
  return (
    <Region index="08" label="Stored answers" heading="What this workspace has stored, and deleting it">
      <div className="flex flex-col gap-4">
        <p className="text-body text-ink" data-testid="stored-answers-counts">
          {stored.isPending
            ? 'Reading…'
            : stored.isError || !s
              ? isSessionExpired(stored.error)
                ? 'What this workspace has stored can’t be read until you sign in again.'
                : 'What this workspace has stored could not be read just now.'
              : (
                  <>
                    {n(s.shared_answers)} answers shared with others and {n(s.private_answers)} kept to this
                    workspace; {n(s.shared_conversions)} document conversions shared and {n(s.private_conversions)} kept
                    to this workspace (measured by Lens).
                  </>
                )}
        </p>
        <StoredAnswersFacts />
        {s ? (
          <div className="flex flex-col gap-3">
            <DeleteStored scope="shared" confirmWith={s.confirm_with} />
            <DeleteStored scope="all" confirmWith={s.confirm_with} />
          </div>
        ) : null}
        <AskForDeletion />
      </div>
    </Region>
  )
}
