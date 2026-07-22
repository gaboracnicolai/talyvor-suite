import type { IssuePriority, IssueStatus } from './types'

/** Compact absolute timestamp, same shape the Lens ledger uses ("Jul 19, 14:52") —
 *  one clock format across areas. */
export function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/** Human labels for the six-value status enum (types.ts / model.go:54-63). */
const STATUS_LABELS: Record<IssueStatus, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In progress',
  in_review: 'In review',
  done: 'Done',
  cancelled: 'Cancelled',
}
export function statusLabel(s: IssueStatus): string {
  return STATUS_LABELS[s]
}

/** model.IssuePriority labels (model.go:65-73). 0 is "no priority", rendered dim. */
const PRIORITY_LABELS: Record<IssuePriority, string> = {
  0: 'None',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
}
export function priorityLabel(p: IssuePriority): string {
  return PRIORITY_LABELS[p] ?? 'None'
}

/** Plain "$1.50" for Track's reconciled per-issue AI cost (model.Issue.ai_cost_usd, a
 *  float USD — Track's one non-µ money field; it is a rollup Lens reconciles in, not a
 *  ledger amount). Not a MuNumeral: USD has no token tick. */
export function formatUSD(usd: number): string {
  return usd.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
