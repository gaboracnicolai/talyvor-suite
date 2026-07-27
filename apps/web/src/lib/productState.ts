import { ApiError } from './api'

// "This product is not wired into this deployment" — DETECTED, never asserted.
//
// ── WHY THIS IS A FUNCTION AND NOT A SENTENCE IN A SCREEN ─────────────────────
//
// Track and Docs are optional upstreams: the BFF registers their routes in every deployment
// and answers 503 ("… upstream not configured on this BFF") when the product's env trio is
// unset. This deployment sets neither, and runs neither service.
//
// The tempting shortcut is to write "Track isn't configured here" into the screen. That
// creates precisely the failure this codebase has already been bitten by: a true sentence
// that silently becomes false. The #339 cache caption said "merged upstream but not deployed
// here" and stayed on screen for weeks after it deployed, with every gate green, because
// nothing could check prose. A hardcoded "not configured" is the same bug with a different
// subject — it would still be there the day the TRACK_* variables appear.
//
// So the screens ASK and report what came back. The state lights up and goes away on its own,
// with no edit and no deploy of this app, because the answer comes from the deployment rather
// than from the source.
//
// ── WHICH STATUSES MEAN "OFF" ────────────────────────────────────────────────
//
//   503 — the BFF's proxyProduct with an unconfigured upstream. The primary signal.
//   404 — a BFF built before the route existed. Kept for the same reason SpaceList and
//         TrackArea keep it: an older BFF serving a newer bundle is a deployment skew, not
//         a fault, and it must not read as an error either.
//
// Everything else — 500, 502, a 403 from upstream tier checks — is a GENUINE failure and must
// surface as one. Laundering those into "off" is how a broken deployment comes to look calm,
// which is the inverse of this file's purpose.
export function isUnconfigured(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 503 || err.status === 404)
}

/** The one sentence, so every area words it identically. `product` is the display name. */
export function notConfiguredCopy(product: string): string {
  return `${product} is not configured on this deployment — no upstream is wired, so there is nothing to show.`
}

// "Your credential is no longer good" — the THIRD state, and the one that was missing.
//
// ── THE INCIDENT ─────────────────────────────────────────────────────────────
//
// Lens restarted with a new ephemeral signing key. Every live session's workspace token became
// unverifiable, so every workspace-scoped read came back 401, and the app drew eight cards
// saying "Couldn't load the LXC balance", "Couldn't load the mint ledger", "Couldn't check".
// All eight were true and all eight were useless: they describe the symptom the reader can
// already see, while the cause (a dead credential) and the fix (one click) appeared nowhere.
//
// ── WHY THE AUTH GATE CANNOT CATCH THIS ──────────────────────────────────────
//
// The BFF's own session is still valid — /auth/me answers authenticated:true. What expired is
// the LENS token the BFF holds ON that session. So AuthGate correctly renders the app, and the
// only component in a position to notice is the one reading the failed query.
//
// ── IT IS NOT ONLY A DEPLOY ARTIFACT ─────────────────────────────────────────
//
// The workspace token is minted for 8 hours and the BFF session lasts 12, so hours 8→12 of
// EVERY session sit in this state with nothing having restarted. (The BFF now re-mints on
// expiry, which closes that window — but a restart, a revoked key or a rolled secret all land
// here again, so the screen must stay honest regardless of what the server does.)
//
// ── WHICH STATUS MEANS "SIGN IN AGAIN" ───────────────────────────────────────
//
//   401 — the only one. From requireSession (no BFF session) or passed through verbatim from
//         Lens (stale workspace token). Both are cured by the same single click: /auth/login
//         rotates the session and re-provisions, minting a fresh workspace token.
//
// Everything else stays where it was. 503/404 remain isUnconfigured's calm "not wired here";
// 500/502/403 remain genuine faults. THAT SEPARATION IS THE POINT — a change that makes 401
// honest by routing 500 to the same message has not fixed anything, it has just moved which
// failures are misdescribed. Pinned by SessionExpired.test.tsx's 500/502/503 controls.
export function isSessionExpired(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401
}

/** The one sentence, said ONCE at the top of the app — never per panel. */
export const sessionExpiredCopy =
  'Your session has expired, so this workspace’s data can’t be read right now. Signing in again fixes it.'
