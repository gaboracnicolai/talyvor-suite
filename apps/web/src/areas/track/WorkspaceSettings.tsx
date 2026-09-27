import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Input, formatDay, inlineLink } from '@talyvor/ui'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Region, RegionScreen } from '../../components/Region'
import { ApiError, getJSONArray } from '../../lib/api'
import { isSessionExpired, isUnconfigured } from '../../lib/productState'
import { useTrackWorkspaces } from './data'
import type { TrackWorkspace } from './types'

// B18.53 — a Track workspace's owner deletes it here by typing its slug, sees it under "Deleted
// workspaces" with the day it goes for good, and restores it until then. Track decides everything
// (B18.30): only an owner may delete or restore, a delete must carry the slug, a deleted workspace
// can be restored for 14 days, and after that it is removed with everything in it.

const DELETED_KEY = ['track-workspaces', 'deleted']

/** Track deletes only when `confirm` is the workspace's slug (400 CONFIRMATION_REQUIRED otherwise). */
async function deleteWorkspace(id: string, confirm: string): Promise<void> {
  const path = `/api/track/workspaces/${encodeURIComponent(id)}`
  const res = await fetch(path, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ confirm }),
  })
  if (!res.ok) throw new ApiError(res.status, path)
}

async function restoreWorkspace(id: string): Promise<void> {
  const path = `/api/track/workspaces/${encodeURIComponent(id)}/restore`
  const res = await fetch(path, { method: 'POST', headers: { Accept: 'application/json' } })
  if (!res.ok) throw new ApiError(res.status, path)
}

function refusal(err: unknown, what: 'delete' | 'restore'): string {
  if (err instanceof ApiError && err.status === 403) return `Only this workspace’s owner can ${what} it.`
  if (err instanceof ApiError && err.status === 409) return 'Its 14 days to restore have passed, so it can’t be brought back.'
  return `Track didn’t ${what} it. Nothing changed — you can try again.`
}

function DeleteWorkspace({ ws }: { ws: TrackWorkspace }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const remove = useMutation({
    mutationFn: () => deleteWorkspace(ws.id, typed),
    onSuccess: async () => {
      setOpen(false)
      setTyped('')
      await qc.invalidateQueries({ queryKey: ['track-workspaces'] })
      await qc.invalidateQueries({ queryKey: ['track'] })
    },
  })
  if (!open) {
    return (
      <Button variant="danger" onClick={() => setOpen(true)}>
        Delete…
      </Button>
    )
  }
  return (
    <form
      className="flex w-full flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (typed === ws.slug && !remove.isPending) remove.mutate()
      }}
    >
      <p className="text-body text-ink">
        Deleting <strong>{ws.name}</strong> hides it at once. You can restore it for 14 days; after that
        every issue, project and member in it is removed for good.
      </p>
      <label className="flex flex-col gap-1">
        <span className="text-caption text-muted">
          Type <span className="font-mono text-ink">{ws.slug}</span> to confirm
        </span>
        <Input
          aria-label={`Type ${ws.slug} to confirm`}
          className="max-w-xs font-mono"
          value={typed}
          autoComplete="off"
          onChange={(e) => setTyped(e.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <Button type="submit" variant="danger" disabled={typed !== ws.slug || remove.isPending}>
          {remove.isPending ? 'Deleting…' : 'Delete workspace'}
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
          {refusal(remove.error, 'delete')}
        </p>
      ) : null}
    </form>
  )
}

function RestoreWorkspace({ ws }: { ws: TrackWorkspace }) {
  const qc = useQueryClient()
  const restore = useMutation({
    mutationFn: () => restoreWorkspace(ws.id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['track-workspaces'] })
      await qc.invalidateQueries({ queryKey: ['track'] })
    },
  })
  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="primary" disabled={restore.isPending} onClick={() => restore.mutate()}>
        {restore.isPending ? 'Restoring…' : 'Restore'}
      </Button>
      {restore.isError ? (
        <p className="text-caption text-ink" role="alert">
          {refusal(restore.error, 'restore')}
        </p>
      ) : null}
    </div>
  )
}

export function WorkspaceSettings() {
  const live = useTrackWorkspaces()
  const deleted = useQuery({
    queryKey: DELETED_KEY,
    queryFn: () => getJSONArray<TrackWorkspace>('/api/track/workspaces/deleted'),
  })
  const unavailable = (e: unknown) => isUnconfigured(e) || isSessionExpired(e)

  return (
    <RegionScreen>
      <Region index="00" label="Workspace settings" heading="Workspace settings" sectionClassName="pb-10 pt-4 wide:pb-12">
        <p className="max-w-2xl text-body text-muted">
          The Track workspaces you belong to. Their owner can delete one here and restore it within 14 days.
        </p>
        <p className="mt-4">
          <Link className={`text-body ${inlineLink}`} to="/track">
            Back to all issues
          </Link>
        </p>
      </Region>

      <Region index="01" label="Your workspaces">
        {live.isError ? (
          <p className="max-w-2xl text-body text-muted">
            {unavailable(live.error)
              ? 'Track is not reachable from this session, so there are no workspaces to show.'
              : 'Couldn’t read your workspaces from Track.'}
          </p>
        ) : live.isPending ? (
          <p className="text-body text-muted">Reading workspaces from Track…</p>
        ) : (live.data ?? []).length === 0 ? (
          <p className="max-w-2xl text-body text-muted">You belong to no Track workspace that is not deleted.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-rule border-y border-rule">
            {(live.data ?? []).map((ws) => (
              <li key={ws.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-body text-ink">{ws.name}</p>
                  <p className="font-mono text-caption text-muted">{ws.slug}</p>
                </div>
                <div className="flex min-w-0 flex-1 justify-end">
                  <DeleteWorkspace ws={ws} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Region>

      <Region index="02" label="Deleted workspaces">
        {deleted.isError ? (
          <p className="max-w-2xl text-body text-muted">
            {unavailable(deleted.error)
              ? 'Track is not reachable from this session.'
              : 'Couldn’t read deleted workspaces from Track. This is a fault, not an empty list.'}
          </p>
        ) : deleted.isPending ? (
          <p className="text-body text-muted">Reading deleted workspaces from Track…</p>
        ) : (deleted.data ?? []).length === 0 ? (
          <p className="max-w-2xl text-body text-muted">No deleted workspaces you own are waiting to be restored.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-rule border-y border-rule">
            {(deleted.data ?? []).map((ws) => (
              <li key={ws.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-body text-ink">{ws.name}</p>
                  <p className="text-caption text-muted">
                    Deleted <span className="font-figure">{ws.deleted_at ? formatDay(ws.deleted_at) : '—'}</span> · goes
                    for good on{' '}
                    <span className="font-figure">{ws.restorable_until ? formatDay(ws.restorable_until) : '—'}</span>
                  </p>
                </div>
                <RestoreWorkspace ws={ws} />
              </li>
            ))}
          </ul>
        )}
      </Region>
    </RegionScreen>
  )
}
