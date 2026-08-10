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
 * The priority enum's values in model order (0 None … 4 Low), for anything that has to OFFER the
 * choice rather than label one value. Derived from `PRIORITY_LABELS` rather than written out a
 * second time: integer-like keys enumerate in ascending numeric order, so this IS the declaration
 * order and cannot drift from the labels beside it.
 *
 * ⚠ IT EXISTS BECAUSE THE DRIFT ALREADY HAPPENED. IssueDetail.tsx hand-rolled its own five-entry
 * `PRIORITIES` list for the control that ships, while this module's `priorityLabel` — exported,
 * documented and unit-tested against model.IssuePriority — had ZERO production call sites.
 * Measured at `1b7acf3`: renaming the SHIPPED label left all 1383 tests green; renaming the same
 * label here redded `format.test.ts`. The pinned vocabulary was the one that shipped nowhere.
 */
export const PRIORITY_VALUES = Object.keys(PRIORITY_LABELS).map(Number) as IssuePriority[]

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
 *
 * ⚠ AND THE ZERO NEEDED `tokens` TO BE TRUE, BECAUSE ZERO COST IS NOT ZERO USAGE. A response
 * served from the cache, or by a registered inference node, is written upstream with cost_usd = 0
 * and its token counts intact — talyvor-lens writes that zero as a literal in the SQL
 * (`insertCacheServeSQL`), Lens returns the row on /v1/api/spend/by-request, and talyvor-track's
 * syncer lands every row it receives with no zero-cost filter anywhere on the chain. An issue
 * whose work was pooled therefore holds `ai_tokens > 0` against `ai_cost_usd == 0`, and it is the
 * ordinary shape of a pooled issue rather than an edge case. Saying "No AI spend recorded" about
 * that issue is false, and the screen said it directly beside the token count that disproved it.
 *
 * Both strings are claims about the LEDGER and neither characterises the world: this function is
 * not told whether the zero came from a cache hit, a node serve or a reconciliation, so it
 * reports what was recorded and stops there. "Free" would be the wrong word and upstream says so
 * in its own source — "A spend view must never render this row as 'the request was free'"
 * (alerts.go), "render cache rows as 'served from cache', not 'free'" (server.go) — and Track
 * does not carry `serve_source`, so this module cannot honestly say which it was. WHAT THE ROW
 * SHOULD CALL A ZERO-COST SERVE, IF ANYTHING BEYOND THE AMOUNT, IS A PRODUCT DECISION AND IS NOT
 * MADE HERE. Only the false sentence is removed.
 *
 * `tokens` disambiguates the ZERO alone — every nonzero cost renders identically with or without
 * it — so the default keeps any caller that has no token count truthful for the case it can see.
 */
export function formatCost(usd: number, tokens = 0): string {
  if (usd <= 0) return tokens > 0 ? '$0.00 recorded' : 'No AI spend recorded'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}
