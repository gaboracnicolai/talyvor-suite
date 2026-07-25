// Captions that claim a route DOES NOT EXIST YET, made checkable.
//
// ── THE ROT THIS CLOSES ──────────────────────────────────────────────────────
//
// The Overview's cache panel said, in prose, "lens #339's per-request visibility is merged
// upstream but not deployed here". That was true the day it was written. It stayed on the
// screen for weeks after #339 deployed, and every gate stayed green the whole time, because
// the tests pinned that the fixture was MARKED — never that the marking was still TRUE. The
// Docs area carried the same shape ("the BFF serves only /api/docs/spaces today") while the
// BFF had grown four Docs routes.
//
// A prose claim about system state cannot be checked, so it rots silently. A STRUCTURED one
// can. Any screen that wants to say "this data isn't wired yet because route X doesn't exist"
// must name X through awaitingRoute(), and awaiting.test.ts then asserts that the BFF does
// NOT register X. The day someone adds the route, the guard fails and the build stops until
// the screen is either wired or re-captioned. The claim can no longer outlive its truth.
//
// ── SCOPE, deliberately narrow ───────────────────────────────────────────────
//
// This guards ONE class of claim: "route X is absent". It does not — and cannot — verify
// free prose about deployments, upstream versions, or what some other repo has merged. The
// lesson from #339 is that such claims are unverifiable, so the fix is not a cleverer checker
// but to STOP MAKING THEM: say what this deployment observes right now (see the detected
// "not configured" states in the Track and Docs areas, which probe rather than assert), or
// name a route through here where a machine can check it.

/** The BFF's own route pattern, verbatim — e.g. '/api/members',
 *  '/api/docs/spaces/{spaceID}/pages'. It must match the string in
 *  apps/bff/lens.go's HandleFunc call exactly, because that is what the guard compares. */
export type BffRoutePattern = string

/**
 * The caption for data that is not wired because its BFF route does not exist.
 *
 * Pass the route pattern, not prose about it. `detail` may add why it matters, but must not
 * make a second unverifiable claim (no "merged upstream", no "not deployed here" — that is
 * exactly the sentence that rotted).
 */
export function awaitingRoute(route: BffRoutePattern, detail?: string): string {
  return detail ? `awaiting ${route} — ${detail}` : `awaiting ${route}`
}

/**
 * Extract the routes a BFF source file registers. Exported so the guard test can positive-
 * control it: a matcher that silently stops matching would make the guard vacuously green,
 * which is the same failure mode as the caption it is protecting against.
 *
 * Matches `a.mux.HandleFunc("…"` / `a.mux.Handle("…"` and returns the path literals.
 */
export function registeredBffRoutes(goSource: string): string[] {
  const out = new Set<string>()
  const re = /a\.mux\.Handle(?:Func)?\(\s*"([^"]+)"/g
  for (const m of goSource.matchAll(re)) out.add(m[1])
  return [...out]
}

/**
 * Extract every route named by an awaitingRoute(...) call in web source.
 * Single-quoted, double-quoted and backtick literals; the first argument only.
 */
export function awaitedRoutes(tsSource: string): string[] {
  const out = new Set<string>()
  const re = /awaitingRoute\(\s*['"`]([^'"`]+)['"`]/g
  for (const m of tsSource.matchAll(re)) out.add(m[1])
  return [...out]
}
