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
// ⚠ "THE PURE QUERY SEMANTICS BELOW ARE KEPT ... WHAT THE LIST WILL USE ONCE THERE IS AN
// UPSTREAM" — THAT SENTENCE STOOD HERE UNTIL `7474125`, AND THE LIST HAD ALREADY SHIPPED WITHOUT
// IT. `filterIssues` mirrored three of Track's WHERE clauses client-side. The live list arrived
// (#83, then the view rail) and REFUSED that shape in writing: "nothing here filters client-side,
// because a control that narrowed only the rows already fetched would be a filter that lies about
// what it searched" — every control on IssueList is a parameter the BFF validates and forwards.
// So the caller it was kept for WAS written, and decided against it, and the export stayed
// exported, documented and carrying five of its own tests. Deleted, with `IssueFilters`.
//
// ⚠ AND ITS DOCSTRING WAS FALSE ABOUT THE SERVER IT MIRRORED: it called `updated_at DESC` "the
// server's default listing order". MEASURED against talyvor-track `internal/issue/store.go`
// (`orderBy := "created_at"`, overridden only by an allowlisted `order_by`) — the default is
// created_at, and this app sees updated_at only because `issuesQuery` SENDS `order_by=updated_at`
// on every request. A mirror nobody calls is a mirror nobody checks.

import { useQuery } from '@tanstack/react-query'
import { ApiError } from '../../lib/api'
import type { TrackMember, TrackTeam, TrackWorkspace } from './types'

// The shared ApiError, so isUnconfigured() classifies a Track read exactly as it classifies
// every other product read — one rule for "off", in one place.
//
// ⚠ THIS MODULE ALSO EXPORTED A `TrackApiError extends Error`, AND NOTHING ANYWHERE CONSTRUCTED
// IT. It was the leftover of the read below being switched to the shared type, left exported at
// the top of the area's data layer — an area-named error class the next reader would find first,
// which `instanceof ApiError` is false for, so isSessionExpired, isUnconfigured, the retry rule
// and the QueryCache re-probe would all have gone silent together. Deleted rather than rebased
// onto ApiError: a second name for ApiError with no callers is not a type this area needs.
// src/errorTypes.test.ts is the census that makes the sixth instance fail rather than sit here.
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

/**
 * What this deployment can tell us about a Track read, right now — the vocabulary
 * `UpstreamCard` renders, and the only export of this module that is a TYPE.
 *
 * ⚠ THE HOOK THAT PRODUCED IT IS GONE, AND THE STATE VOCABULARY IS NOT. `useTrackProbe` wrapped
 * one read and mapped it onto these four words; measured at `7474125`, NOTHING imported it, in
 * any file, test or not. What replaced it is the shared classifier applied at the screen that
 * owns the read (`isUnconfigured(issues.error)` in IssueList, `TrackArea`, `SpaceView`,
 * `PageView`, `DocsUpstreamCard`, `Overview`, `Members`) — a card is handed the state it should
 * draw rather than being given a path to go and probe. Deleting the hook and keeping the type is
 * the shape that leaves: `UpstreamCard` takes `state`, and its four values still need a name.
 */
export type UpstreamState = 'loading' | 'unconfigured' | 'error' | 'configured'

/** id → display name via the roster; an unknown/absent id renders as em-dash (the
 *  roster is the single naming authority — no name is ever invented client-side). */
export function memberName(members: TrackMember[], id: string | undefined): string {
  if (!id) return '—'
  return members.find((m) => m.id === id)?.name ?? '—'
}

export function teamIdentifier(teams: TrackTeam[], id: string): string {
  return teams.find((t) => t.id === id)?.identifier ?? '—'
}
