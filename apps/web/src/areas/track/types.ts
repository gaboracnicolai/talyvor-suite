// Track domain types — a DECLARED SUBSET of talyvor-track's json shapes (internal/model/model.go,
// internal/member/mgmt_handler.go), not a copy of them. Go's `*T` + `omitempty` means the key is
// ABSENT, hence `?:` here.
//
// ⚠ THE SENTENCE THAT USED TO BE HERE WAS FALSE, AND ITS SECOND HALF IS WHY IT MATTERED. It read
// "JSON-verbatim from talyvor-track @ a3bc7b2 … Field names and optionality mirror the Go structs'
// json tags exactly — so the day the BFF proxies these routes, the fixture types are already the
// live types". MEASURED at talyvor-track 6bf443a: `TrackIssue` held 21 of `model.Issue`'s 30 json
// fields. Two of the nine missing ones — `labels` and `sort_order` — carry NO omitempty, so they
// are on EVERY issue response and this file did not know they existed. Nothing broke: the BFF
// streams the body through and the extra keys are simply invisible to TypeScript. What was broken
// is the promise, which is present-tense, load-bearing for whoever wires a screen next, and could
// not be falsified by any change in this repository.
//
// So the claim is split into two halves that can be checked. Each interface DECLARES the upstream
// fields it does not mirror (`UPSTREAM-ONLY <Interface>: …`, `?` meaning the upstream tag carries
// omitempty). Interface fields ∪ that list = the whole upstream struct, and that union is the
// field set deploy/decision-expiry.sh tells a deployer to check against the Go source — the only
// place the check can run, because CI checks out this repository alone.
// mirrorSubsetRegister.test.ts keeps the two halves equal.

/** GET /v1/workspaces → []model.Workspace — the ONE route the BFF proxies today.
 *  UPSTREAM-ONLY TrackWorkspace: none */
export interface TrackWorkspace {
  id: string
  name: string
  slug: string
  logo_url: string
  plan: string
  created_at: string
  updated_at: string
}

/** model.IssueStatus — a FIXED six-value enum (upstream `model.go`, `type IssueStatus`), not the per-team
 *  workflow-status catalog (that is a separate table driving kanban columns; see the
 *  BFF gap list in the PR). The list screen filters on THIS enum. */
export const ISSUE_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled'] as const
export type IssueStatus = (typeof ISSUE_STATUSES)[number]

/** model.IssuePriority — 0 None, 1 Urgent, 2 High, 3 Medium, 4 Low (upstream `model.go`,
 *  `type IssuePriority`). */
export type IssuePriority = 0 | 1 | 2 | 3 | 4

/** GET /v1/workspaces/{wsID}/issues → []model.Issue (bare array, no envelope).
 *
 *  ⚠ A SUBSET, AND THE TWO WITHOUT A `?` ARE THE ONES TO READ TWICE: `labels` and `sort_order`
 *  carry no omitempty upstream, so they are on every issue this app already receives — the list
 *  screen orders BY sort_order (IssueList.tsx's allowlist) and cannot show the value. Adding the
 *  nine here was rejected deliberately: it makes the old sentence true for an afternoon and
 *  re-arms the same trap on the next upstream field, and four of them (`field_values`,
 *  `relations`, `is_blocked`, `time_tracked_sec`) have shapes this repo would be GUESSING at, in
 *  the one place TypeScript would then enforce the guess. Whether this screen should read labels
 *  is a product question, not a mirror question.
 *  UPSTREAM-ONLY TrackIssue: labels, sort_order, milestone_id?, field_values?, is_blocked?,
 *  relations?, time_tracked_sec?, rice_score?, ice_score? */
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

/** GET /v1/workspaces/{wsID}/issues/{id}/comments → []model.Comment.
 *  UPSTREAM-ONLY TrackComment: none */
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
 *  member; the WRITE half of that API (add / change-role / remove) is owner-only.
 *  UPSTREAM-ONLY TrackMember: none */
export interface TrackMember {
  id: string
  name: string
  email: string
  role: 'owner' | 'member'
  avatar_url: string
}

/** GET /v1/workspaces/{wsID}/teams → []model.Team. `color`/`icon` are Track-side
 *  hex/emoji strings; this UI renders the identifier, never the hex (the design
 *  system's palette is closed — see packages/ui README §The invariant).
 *  UPSTREAM-ONLY TrackTeam: none */
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
