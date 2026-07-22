// Track domain types, JSON-verbatim from talyvor-track @ a3bc7b2 (internal/model/model.go,
// internal/member/mgmt_handler.go). Field names and optionality mirror the Go structs'
// json tags exactly — Go's `*T` + `omitempty` means the key is ABSENT, hence `?:` here —
// so the day the BFF proxies these routes, the fixture types are already the live types.

/** GET /v1/workspaces → []model.Workspace — the ONE route the BFF proxies today. */
export interface TrackWorkspace {
  id: string
  name: string
  slug: string
  logo_url: string
  plan: string
  created_at: string
  updated_at: string
}

/** model.IssueStatus — a FIXED six-value enum (model.go:54-63), not the per-team
 *  workflow-status catalog (that is a separate table driving kanban columns; see the
 *  BFF gap list in the PR). The list screen filters on THIS enum. */
export const ISSUE_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled'] as const
export type IssueStatus = (typeof ISSUE_STATUSES)[number]

/** model.IssuePriority — 0 None, 1 Urgent, 2 High, 3 Medium, 4 Low (model.go:65-73). */
export type IssuePriority = 0 | 1 | 2 | 3 | 4

/** GET /v1/workspaces/{wsID}/issues → []model.Issue (bare array, no envelope). */
export interface TrackIssue {
  id: string
  workspace_id: string
  team_id: string
  project_id?: string
  number: number
  identifier: string
  title: string
  description: string
  status: IssueStatus
  priority: IssuePriority
  assignee_id?: string
  creator_id: string
  cycle_id?: string
  parent_id?: string
  due_date?: string
  completed_at?: string
  lens_feature: string
  ai_cost_usd: number
  ai_tokens: number
  created_at: string
  updated_at: string
}

/** GET /v1/workspaces/{wsID}/issues/{id}/comments → []model.Comment. */
export interface TrackComment {
  id: string
  issue_id: string
  author_id: string
  body: string
  edited_at?: string
  created_at: string
  updated_at: string
}

/** GET /v1/workspaces/{wsID}/members → []memberView — the picker projection
 *  (mgmt_handler.go): exactly what an assignee dropdown needs. Readable by ANY
 *  member; the WRITE half of that API (add / change-role / remove) is owner-only. */
export interface TrackMember {
  id: string
  name: string
  email: string
  role: 'owner' | 'member'
  avatar_url: string
}

/** GET /v1/workspaces/{wsID}/teams → []model.Team. `color`/`icon` are Track-side
 *  hex/emoji strings; this UI renders the identifier, never the hex (the design
 *  system's palette is closed — see packages/ui README §The invariant). */
export interface TrackTeam {
  id: string
  workspace_id: string
  name: string
  identifier: string
  color: string
  icon: string
  created_at: string
  updated_at: string
}
