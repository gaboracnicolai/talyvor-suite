import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { Input, cn, focusRing } from '@talyvor/ui'

import { ApiError, getJSONArray } from '../../lib/api'
import { statusLabel } from '../track/format'
import type { TrackIssue } from '../track/types'
import { type ChatAttachment, uploadDocument } from './chatApi'

// B28.376 — attach a Track issue, its cost attributed to it. The composer's Track issue button lists the workspace's
// issues; the issue chosen goes to Lens as a Markdown document (POST /api/documents), so the question references it by its
// tdoc_ id exactly as an attached file (B18.24) and the model reads the issue. From then on every request in the
// conversation names the issue to Lens (chatApi.ts ISSUE_HEADER), and Track adds what each answer cost to the issue's
// AI cost.

/** The issues the panel lists: Track's newest first, as the issue list reads them. */
const listIssues = () => getJSONArray<TrackIssue>('/api/track/issues?limit=100')

/** The text a Track issue is attached as: its identifier and title as a heading, its status, then its description. */
export function trackIssueText(issue: Pick<TrackIssue, 'identifier' | 'title' | 'status' | 'description'>): string {
  const description = (issue.description ?? '').trim()
  return `# ${issue.identifier} ${issue.title}\n\nStatus: ${statusLabel(issue.status)}\n${description === '' ? '' : `\n${description}\n`}`
}

/** Stores one Track issue in Lens as a document the question references. A refusal is an Error whose message is the
 *  sentence the composer shows. */
export async function attachTrackIssue(issue: Pick<TrackIssue, 'id' | 'identifier' | 'title' | 'status' | 'description'>): Promise<ChatAttachment> {
  const file = new File([trackIssueText(issue)], `${issue.identifier}.md`, { type: 'text/markdown' })
  let id: string
  try {
    id = await uploadDocument(file, 'text/markdown')
  } catch (e) {
    const why = e instanceof Error && e.message !== '' ? e.message : 'try again.'
    throw new Error(`${issue.identifier} couldn’t be attached: ${why}${/[.!?]$/.test(why) ? '' : '.'}`)
  }
  return {
    name: issue.title,
    media_type: 'text/markdown',
    size: file.size,
    file_id: id,
    track_issue: { id: issue.id, identifier: issue.identifier },
  }
}

/** The composer's Track issue button and the panel it opens: the workspace's issues, with a filter over their
 *  identifiers and titles. */
export function TrackIssuePicker({ disabled, onPick }: { disabled: boolean; onPick: (issue: TrackIssue) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const issues = useQuery({ queryKey: ['track', 'issues', 'chat-picker'], queryFn: listIssues, enabled: open })

  // Outside a click, the panel closes, as the model picker's does.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const close = () => {
    setOpen(false)
    setQuery('')
    triggerRef.current?.focus()
  }
  const q = query.trim().toLowerCase()
  const shown = (issues.data ?? []).filter((i) => q === '' || `${i.identifier} ${i.title}`.toLowerCase().includes(q))

  return (
    <div ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        title="Attach a Track issue"
        className={cn(
          'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-muted transition-colors duration-200 hover:text-ink disabled:opacity-50',
          focusRing,
        )}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="2.5" />
        </svg>
        {/* The page mark's neighbour, and as small: its name stays for a screen reader, and the title says it on hover. */}
        <span className="sr-only">Track issue</span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Attach a Track issue"
          className="absolute bottom-full left-0 z-20 mb-2 flex h-80 w-full max-w-sm flex-col overflow-hidden rounded-card border border-rule bg-surface"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              close()
            }
          }}
        >
          <div className="border-b border-rule p-2">
            <Input autoFocus value={query} placeholder="Filter issues" aria-label="Filter issues" onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {issues.error !== null ? (
              <p className="px-3 py-2 text-caption text-ink" role="alert">
                {issues.error instanceof ApiError && issues.error.status === 503 ? 'Track isn’t set up on this deployment.' : 'Track couldn’t be read just now.'}
              </p>
            ) : issues.isPending ? (
              <p className="px-3 py-2 text-caption text-muted">Loading issues…</p>
            ) : shown.length === 0 ? (
              <p className="px-3 py-2 text-caption text-muted">
                {q === '' ? 'There are no Track issues in this workspace yet.' : <>No issue matches &ldquo;{query}&rdquo;.</>}
              </p>
            ) : (
              <ul aria-label="Track issues">
                {shown.map((i) => (
                  <li key={i.id}>
                    <button
                      type="button"
                      aria-label={`${i.identifier} ${i.title}`}
                      className={cn('flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-body text-ink transition-colors duration-200 hover:bg-canvas', focusRing)}
                      onClick={() => {
                        onPick(i)
                        close()
                      }}
                    >
                      <span className="shrink-0 font-figure text-caption text-label">{i.identifier}</span>
                      <span className="min-w-0 truncate">{i.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="border-t border-rule px-3 py-2 text-caption text-faint">
            The issue goes with your question, and what this conversation&rsquo;s answers cost is added to its AI cost in Track.
          </p>
        </div>
      ) : null}
    </div>
  )
}
