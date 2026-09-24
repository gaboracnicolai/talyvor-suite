import { ApiError } from '../../lib/api'
import type { TrackIssue } from './types'

// ISSUE EXPORT — B4.4. CSV and JSON of the issues the list is showing, with their AI cost.
//
// ⚠ THE AI COST IS THE API'S OWN NUMBER, NEVER A FORMATTED ONE. Each row's `ai_cost_usd` is written
// exactly as GET /api/track/issues returned it (JavaScript's shortest round-trip form of the same
// double), so a column summed in a spreadsheet equals the sum of what the API reports for the same
// issues — no display rounding (formatCost's $0.42) ever reaches the file.
//
// ⚠ AND IT IS EVERY MATCHING ISSUE, NOT THE PAGE ON SCREEN. The list shows 50; the export pages
// through the same filtered query at the BFF's ceiling of 250 until a short page. Track reports no
// total count, so the only honest stop is "a page came back short" — or the cap below, which the
// result says it hit rather than passing a truncated file off as complete.

const EXPORT_PAGE = 250
const MAX_PAGES = 20

export interface ExportResult {
  issues: TrackIssue[]
  /** True when the cap stopped the read before a short page — the file is NOT everything. */
  truncated: boolean
}

/** Every issue the given list query matches. `query` is issuesQuery() minus limit/offset. */
export async function fetchAllIssues(query: URLSearchParams): Promise<ExportResult> {
  const issues: TrackIssue[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams(query)
    q.set('limit', String(EXPORT_PAGE))
    q.set('offset', String(page * EXPORT_PAGE))
    const res = await fetch(`/api/track/issues?${q.toString()}`, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new ApiError(res.status, '/api/track/issues')
    const body: unknown = await res.json()
    const rows = Array.isArray(body) ? (body as TrackIssue[]) : []
    issues.push(...rows)
    if (rows.length < EXPORT_PAGE) return { issues, truncated: false }
  }
  return { issues, truncated: true }
}

/** What the screen says after an export: how many, what they cost, and whether it is all of them. */
export function exportSummary(r: ExportResult): { count: number; total: number; truncated: boolean } {
  return { count: r.issues.length, total: totalAICost(r.issues), truncated: r.truncated }
}

/** The sum of the API's per-issue AI cost — what the file's column adds up to. */
export function totalAICost(issues: TrackIssue[]): number {
  return issues.reduce((sum, i) => sum + (Number.isFinite(i.ai_cost_usd) ? i.ai_cost_usd : 0), 0)
}

export interface ExportNames {
  assignee: (id: string | undefined) => string
  team: (id: string) => string
  project: (id: string | undefined) => string
}

export const CSV_COLUMNS = [
  'identifier',
  'title',
  'status',
  'priority',
  'assignee',
  'team',
  'project',
  'ai_cost_usd',
  'ai_tokens',
  'created_at',
  'updated_at',
  'id',
] as const

/**
 * One CSV cell. Quoted when it holds a comma, quote or line break (RFC 4180). A TEXT cell that
 * starts with = + - @ or a tab is prefixed with an apostrophe, so a title like `=HYPERLINK(…)`
 * opens in a spreadsheet as the words someone typed, not as a formula. Numbers are never prefixed.
 */
function cell(v: string | number, text: boolean): string {
  let s = String(v)
  if (text && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function issuesCSV(issues: TrackIssue[], names: ExportNames): string {
  const rows = issues.map((i) =>
    [
      cell(i.identifier, true),
      cell(i.title, true),
      cell(i.status, true),
      cell(i.priority, false),
      cell(names.assignee(i.assignee_id), true),
      cell(names.team(i.team_id), true),
      cell(names.project(i.project_id), true),
      cell(i.ai_cost_usd, false),
      cell(i.ai_tokens, false),
      cell(i.created_at, true),
      cell(i.updated_at, true),
      cell(i.id, true),
    ].join(','),
  )
  return [CSV_COLUMNS.join(','), ...rows].join('\r\n') + '\r\n'
}

/** The rows exactly as the API returned them — nothing renamed, nothing rounded. */
export function issuesJSON(issues: TrackIssue[]): string {
  return JSON.stringify(issues, null, 2) + '\n'
}

/** Hands `text` to the browser as a file download. */
export function download(filename: string, type: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
