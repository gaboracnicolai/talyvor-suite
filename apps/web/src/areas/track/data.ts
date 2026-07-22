// Track data layer. TWO sources, never blurred:
//
//   LIVE     /api/track/workspaces — the one Track route the BFF proxies today
//            (apps/bff/lens.go: requireSession → proxyProduct → Track GET /v1/workspaces,
//            gateway-authed, session identity attached server-side).
//   FIXTURE  everything else (fixtures.ts) — each hook below names the exact upstream
//            route it stands in for, returns `source: 'fixture'`, and every consuming
//            screen renders a <FixtureBadge>. The full inventory the BFF needs is the
//            PR's gap list; when a route lands, the hook body swaps to a fetch and the
//            `source` flips — call sites don't change shape.
//
// Filter params deliberately mirror Track's own List query names (issue/handler.go List:
// status, assignee_id, team_id, …) so the URL-driven filters on the list screen are
// byte-compatible with the eventual live query string.

import { useQuery } from '@tanstack/react-query'
import { FIXTURE_COMMENTS, FIXTURE_ISSUES, FIXTURE_MEMBERS, FIXTURE_TEAMS } from './fixtures'
import type { TrackComment, TrackIssue, TrackMember, TrackTeam, TrackWorkspace } from './types'

export class TrackApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`${path} → HTTP ${status}`)
    this.name = 'TrackApiError'
  }
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new TrackApiError(res.status, path)
  return (await res.json()) as T
}

/** LIVE: the only proxied Track read. Membership-scoped upstream (T10), so the list is
 *  exactly the session identity's workspaces. */
export function useTrackWorkspaces() {
  return useQuery({
    queryKey: ['track-workspaces'],
    queryFn: () => getJSON<TrackWorkspace[]>('/api/track/workspaces'),
  })
}

/** A fixture-backed read: the payload plus an explicit source tag. The tag exists so a
 *  screen CANNOT consume fixture data without deciding what to do about the badge. */
export interface FixtureBacked<T> {
  source: 'fixture'
  /** The upstream route this stands in for — surfaced in the badge tooltip. */
  standsInFor: string
  data: T
}

const fixture = <T,>(standsInFor: string, data: T): FixtureBacked<T> => ({ source: 'fixture', standsInFor, data })

/** Mirrors issue/handler.go's IssueFilter subset this UI exposes. Empty string = no
 *  filter, exactly like the server treats an absent query param. */
export interface IssueFilters {
  status: string
  assignee_id: string
  team_id: string
}

/** Pure, tested separately. Mirrors the server's WHERE semantics for the three params:
 *  each non-empty filter is an exact-match AND. Order: updated_at DESC (the server's
 *  default listing order for a scanning surface). */
export function filterIssues(issues: TrackIssue[], f: IssueFilters): TrackIssue[] {
  return issues
    .filter((i) => (f.status ? i.status === f.status : true))
    .filter((i) => (f.assignee_id ? i.assignee_id === f.assignee_id : true))
    .filter((i) => (f.team_id ? i.team_id === f.team_id : true))
    .slice()
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
}

/** FIXTURE ← GET /v1/workspaces/{wsID}/issues?status=&assignee_id=&team_id= */
export function useIssues(f: IssueFilters): FixtureBacked<TrackIssue[]> {
  return fixture('GET /v1/workspaces/{wsID}/issues', filterIssues(FIXTURE_ISSUES, f))
}

/** FIXTURE ← GET /v1/workspaces/{wsID}/issues/{id} (404 → undefined, like the
 *  scoped-read SEC-5 handler: foreign/unknown id is just "not found"). */
export function useIssue(id: string): FixtureBacked<TrackIssue | undefined> {
  return fixture('GET /v1/workspaces/{wsID}/issues/{id}', FIXTURE_ISSUES.find((i) => i.id === id))
}

/** FIXTURE ← GET /v1/workspaces/{wsID}/issues/{id}/comments (oldest first, a thread). */
export function useComments(issueId: string): FixtureBacked<TrackComment[]> {
  return fixture(
    'GET /v1/workspaces/{wsID}/issues/{id}/comments',
    FIXTURE_COMMENTS.filter((c) => c.issue_id === issueId).slice().sort((a, b) => (a.created_at > b.created_at ? 1 : -1)),
  )
}

/** FIXTURE ← GET /v1/workspaces/{wsID}/members (member-readable roster, #58). */
export function useMembers(): FixtureBacked<TrackMember[]> {
  return fixture('GET /v1/workspaces/{wsID}/members', FIXTURE_MEMBERS)
}

/** FIXTURE ← GET /v1/workspaces/{wsID}/teams */
export function useTeams(): FixtureBacked<TrackTeam[]> {
  return fixture('GET /v1/workspaces/{wsID}/teams', FIXTURE_TEAMS)
}

/** id → display name via the roster; an unknown/absent id renders as em-dash (the
 *  roster is the single naming authority — no name is ever invented client-side). */
export function memberName(members: TrackMember[], id: string | undefined): string {
  if (!id) return '—'
  return members.find((m) => m.id === id)?.name ?? '—'
}

export function teamIdentifier(teams: TrackTeam[], id: string): string {
  return teams.find((t) => t.id === id)?.identifier ?? '—'
}
