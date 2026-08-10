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

/**
 * Track's reconciled per-issue AI cost (model.Issue.ai_cost_usd, a float USD — Track's one
 * non-µ money field; it is a rollup Lens reconciles in, not a ledger amount). Not a MuNumeral:
 * USD has no token tick.
 *
 * Money the way the ledger holds it — never rounded up into a friendlier number. A single AI
 * call is usually sub-cent, and `$0.00` on this field reads as "this issue cost nothing", which
 * is the one thing the number exists to disprove; a genuine zero says so in words instead.
 *
 * ⚠ THIS IS THE SHIPPED RULE, MOVED — not a new one. It was `costLabel`, a local helper in
 * IssueDetail.tsx, while this module exported a `formatUSD` that rounded to cents and had ZERO
 * production call sites. The two disagreed on every value below half a cent ($0.00 vs $0.0004)
 * and at zero, and the exported, documented, tested one was the one a developer would find.
 * The rendered output is unchanged; the dead namesake is gone. formatterReach.test.ts is the
 * guard that makes "exported but nothing calls it" fail rather than sit in a comment.
 */
export function formatCost(usd: number): string {
  if (usd <= 0) return 'No AI spend recorded'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}
