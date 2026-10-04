import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cn, focusRing } from '@talyvor/ui'
import { useEffect, useId, useRef, useState } from 'react'
import { ApiError } from '../../lib/api'
import { statusLabel } from './format'
import { type IssuePatch, type PickerTarget, patchIssue, refocusIssue } from './issueKeys'
import { ISSUE_STATUSES, type TrackMember } from './types'

// B27.30 — the picker `s` (move) and `a` (assign) open on the focused issue. Type to narrow, ↑/↓ to
// choose, Enter to apply, Esc to leave. Focus goes back to the issue it acted on, so the next key
// lands where the reader already is.

interface Option {
  key: string
  label: string
  /** The PATCH body that picking this option sends. */
  body: IssuePatch
}

async function members(): Promise<TrackMember[]> {
  const res = await fetch('/api/members', { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new ApiError(res.status, '/api/members')
  const b: unknown = await res.json()
  return Array.isArray(b) ? (b as TrackMember[]) : []
}

export function IssuePicker({
  target,
  onClose,
}: {
  target: PickerTarget
  /** Called with the sentence to announce when something changed, or nothing when the reader left. */
  onClose: (done?: string) => void
}) {
  const qc = useQueryClient()
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [filter, setFilter] = useState('')
  const [active, setActive] = useState(0)
  const people = useQuery({
    queryKey: ['track', 'members'],
    queryFn: members,
    retry: false,
    enabled: target.kind === 'assignee',
  })

  const all: Option[] =
    target.kind === 'status'
      ? ISSUE_STATUSES.map((s) => ({ key: s, label: statusLabel(s), body: { status: s } }))
      : [
          { key: '-', label: 'No one', body: { assignee_id: null } },
          ...(people.data ?? []).map((m) => ({
            key: m.id,
            label: m.name || m.email,
            body: { assignee_id: m.id },
          })),
        ]
  // The people read failing is said in the list, ahead of any "nothing matches".
  const peopleFailed = target.kind === 'assignee' && people.isError
  const q = filter.trim().toLowerCase()
  const options = q ? all.filter((o) => o.label.toLowerCase().includes(q)) : all
  const current = Math.min(active, Math.max(options.length - 1, 0))

  const apply = useMutation({
    mutationFn: (o: Option) => patchIssue(target.issueId, o.body),
    onSuccess: async (_, o) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['track', 'issues'] }),
        qc.invalidateQueries({ queryKey: ['track-issue', target.issueId] }),
      ])
      onClose(
        target.kind === 'status'
          ? `${target.name} moved to ${o.label}.`
          : 'assignee_id' in o.body && o.body.assignee_id === null
            ? `${target.name} is unassigned.`
            : `${target.name} assigned to ${o.label}.`,
      )
      refocusIssue(target.issueId)
    },
  })

  useEffect(() => inputRef.current?.focus(), [])

  const title = target.kind === 'status' ? `Move ${target.name} to…` : `Assign ${target.name} to…`
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-x-0 top-24 z-30 mx-auto w-full max-w-md rounded-card border border-rule-strong bg-surface shadow-lg"
    >
      <p className="border-b border-rule px-3 py-2 text-caption text-muted">{title}</p>
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={options[current] ? `${listId}-${options[current].key}` : undefined}
        aria-label={target.kind === 'status' ? 'Status' : 'Assignee'}
        value={filter}
        placeholder="Type to narrow"
        onChange={(e) => {
          setFilter(e.target.value)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            const n = options.length
            if (n > 0) setActive((current + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
          } else if (e.key === 'Enter') {
            e.preventDefault()
            const o = options[current]
            if (o && !apply.isPending) apply.mutate(o)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
            refocusIssue(target.issueId)
          }
        }}
        className={`w-full border-b border-rule bg-canvas px-3 py-2 text-body text-ink placeholder:text-faint transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
      />
      <ul id={listId} role="listbox" aria-label={title} className="max-h-72 overflow-y-auto py-1">
        {people.isLoading && target.kind === 'assignee' ? (
          <li className="px-3 py-2 text-caption text-muted">Reading the workspace’s people…</li>
        ) : peopleFailed ? (
          <li className="px-3 py-2 text-caption text-muted">
            Couldn’t read the workspace’s people, so only “No one” can be chosen.
          </li>
        ) : null}
        {options.map((o, i) => (
          <li
            key={o.key}
            id={`${listId}-${o.key}`}
            role="option"
            aria-selected={i === current}
            onMouseDown={(e) => {
              e.preventDefault()
              if (!apply.isPending) apply.mutate(o)
            }}
            className={cn('cursor-pointer px-3 py-1.5 text-body text-ink', i === current && 'bg-canvas')}
          >
            {o.label}
          </li>
        ))}
        {options.length === 0 ? (
          <li className="px-3 py-2 text-caption text-muted">Nothing matches. Widen what you typed to see every choice.</li>
        ) : null}
      </ul>
      {apply.isError ? (
        <p className="border-t border-rule px-3 py-2 text-caption text-muted" role="status">
          Couldn’t change {target.name} — nothing was changed.
        </p>
      ) : null}
    </div>
  )
}
