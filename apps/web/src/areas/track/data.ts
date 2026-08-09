// Track data layer.
//
// ── WHAT CHANGED, AND WHY THE FIXTURES ARE GONE ──────────────────────────────
//
// This file used to serve fourteen invented issues, four invented people, two teams and five
// comments from ./fixtures.ts, each marked with a <FixtureBadge> and a header explaining that
// "the BFF proxies exactly ONE Track route today". That header was false: the BFF registers
// /api/track/issues, /api/track/issues/{id}, /api/track/issues/{id}/comments,
// /api/track/teams and /api/members. It had been false for a while, and nothing could catch
// it, because a prose claim about system state is not checkable.
//
// The reason the screens still cannot show real issues is a deployment fact, not a routing
// one: this deployment runs NO Track. There are no TRACK_* variables and the service is not in
// the compose stack, so every one of those routes answers 503 ("track upstream not configured
// on this BFF"). There is no upstream to point at.
//
// So the fixtures are deleted rather than re-marked. Fourteen fabricated issues with plausible
// titles, assignees and AI costs are the most convincing kind of fake data, and a badge does
// not undo that for a reader who screenshots the page. What replaces them is what this
// deployment can actually answer: a probe.
//
// ── DETECTED, NOT ASSERTED ───────────────────────────────────────────────────
//
// The screens ask the BFF and report what comes back (see lib/productState.ts). Nothing here
// hardcodes "Track isn't configured" — that sentence would become the next stale caption the
// day Track ships. When the TRACK_* trio appears the probe starts answering 200 and the
// screens change on their own, with no edit to this app.
//
// The pure query semantics below are KEPT. filterIssues mirrors Track's own WHERE clauses and
// is what the list will use once there is an upstream; it is tested against rows declared in
// the test file, which is where sample data belongs — not in a module screens render from.

import { useQuery } from '@tanstack/react-query'
import { ApiError } from '../../lib/api'
import { isUnconfigured } from '../../lib/productState'
import type { TrackIssue, TrackMember, TrackTeam, TrackWorkspace } from './types'

export class TrackApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`${path} -> HTTP ${status}`)
    this.name = 'TrackApiError'
  }
}

// The shared ApiError, so isUnconfigured() classifies a Track read exactly as it classifies
// every other product read — one rule for "off", in one place.
async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new ApiError(res.status, path)
  return (await res.json()) as T
}

/** LIVE: the only proxied Track read this area renders today. Membership-scoped upstream
 *  (T10), so the list is exactly the session identity's workspaces. */
export function useTrackWorkspaces() {
  return useQuery({
    queryKey: ['track-workspaces'],
    queryFn: () => getJSON<TrackWorkspace[]>('/api/track/workspaces'),
  })
}

/** What this deployment can tell us about a Track read, right now. */
export type UpstreamState = 'loading' | 'unconfigured' | 'error' | 'configured'

/**
 * Probe a Track route and classify the answer. This is the whole mechanism behind the
 * "not configured on this deployment" state: one real request, and the screen renders what
 * came back rather than what someone believed when they wrote the file.
 *
 * A 200 means the upstream IS wired — at which point the screen says the data is reachable
 * but this view does not read it yet. That is true, and it is a visible prompt to finish the
 * job. It never invents rows to fill the gap.
 */
export function useTrackProbe(path: string): { state: UpstreamState } {
  const q = useQuery({
    queryKey: ['track-probe', path],
    queryFn: () => getJSON<unknown>(path),
    retry: false,
  })
  if (q.isLoading) return { state: 'loading' }
  if (isUnconfigured(q.error)) return { state: 'unconfigured' }
  if (q.isError) return { state: 'error' }
  return { state: 'configured' }
}

/** Mirrors issue/handler.go's IssueFilter subset this UI exposes. Empty string = no
 *  filter, exactly like the server treats an absent query param. */
export interface IssueFilters {
  status: string
  assignee_id: string
  team_id: string
}

/** Pure, tested separately. Mirrors the server's WHERE semantics for the three params:
 *  each non-empty filter is an exact-match AND. Order: updated_at DESC (the server's
 *  default listing order for a scanning surface). Kept for the live wiring. */
export function filterIssues(issues: TrackIssue[], f: IssueFilters): TrackIssue[] {
  return issues
    .filter((i) => (f.status ? i.status === f.status : true))
    .filter((i) => (f.assignee_id ? i.assignee_id === f.assignee_id : true))
    .filter((i) => (f.team_id ? i.team_id === f.team_id : true))
    .slice()
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
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
