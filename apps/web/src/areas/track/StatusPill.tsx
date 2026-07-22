import { statusLabel } from './format'
import type { IssueStatus } from './types'

// The issue-status pill, in the system's pill grammar: hue on the DOT, label in muted
// ink — text is never a hue (packages/ui README §The invariant).
//
// This is track-LOCAL because packages/ui's Pill deliberately has no neutral status
// ('idle' was removed as dead surface, and packages/ui is another tab's file). Track is
// the real state that needs a neutral: backlog/todo issues are alive but unstarted.
//
// The dot encodes the status CATEGORY, not the exact status — deliberately mirroring
// Track's own workflow model (workflow/engine.go StatusCategory: backlog / unstarted /
// started / completed / cancelled). The label carries the exact status; the hue carries
// only its lifecycle stage, reusing the system's existing lifecycle vocabulary
// (held = in flight, settled = landed, slashed = dead) plus the two neutral greys.
const DOT: Record<IssueStatus, string> = {
  backlog: 'bg-faint', //     CategoryBacklog   — dimmest: parked
  todo: 'bg-muted', //        CategoryUnstarted — present, not started
  in_progress: 'bg-held', //  CategoryStarted   — in flight
  in_review: 'bg-held', //    CategoryStarted   — in flight (label disambiguates)
  done: 'bg-settled', //      CategoryCompleted — landed
  cancelled: 'bg-slashed', // CategoryCancelled — dead
}

export function StatusPill({ status }: { status: IssueStatus }) {
  return (
    <span className="inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-pill border border-rule bg-surface px-2 text-caption uppercase tracking-wide text-muted">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-pill ${DOT[status]}`} aria-hidden="true" />
      {statusLabel(status)}
    </span>
  )
}
