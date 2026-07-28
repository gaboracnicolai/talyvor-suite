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
// ── WHICH STATUSES MEAN "OFF" — 503, AND ONLY 503 ────────────────────────────
//
// 503 is the BFF's own answer, written deliberately at one place: forwardProduct returns
// `{product} upstream not configured on this BFF` when the product's base URL is empty. It is
// the ONLY status the BFF produces to mean "not wired". That makes it unambiguous, which is
// exactly what a diagnosis needs to be.
//
// ⚠ 404 USED TO BE IN THIS LIST AND IT COST US A DAY. The stated reason was deployment skew —
// "a BFF built before the route existed" — and that case is real, but the predicate cannot see
// WHOSE 404 it is holding. Two very different things arrive here as 404:
//
//   · the BFF has no such route (skew), and
//   · the BFF forwarded, and the PRODUCT answered 404.
//
// The second is overwhelmingly the common one in a running deployment, and it means either the
// resource does not exist or WE ARE ADDRESSING THE WRONG PATH. It happened: the BFF asked Docs
// for /v1/workspaces/{ws}/spaces/{id}, a path Docs does not register, and the screen reported
// "Docs is not configured on this deployment — no upstream is wired" while Docs was running and
// had just served the space list. Our routing bug, rendered as the operator's misconfiguration,
// sending them to check env vars that were correct.
//
// A 404 is a statement about an ADDRESS. It is never evidence about whether a product is
// deployed, so it does not belong in a predicate about deployment — and the skew case is not an
// argument for keeping it: a bundle newer than the server that serves it IS a fault, just a
// transient one, and rendering it as a calm "not wired here" is how you ship a skewed deploy and
// never find out.
//
// Everything else — 500, 502, a 403 from upstream tier checks — is a GENUINE failure and must
// surface as one. Laundering those into "off" is how a broken deployment comes to look calm,
// which is the inverse of this file's purpose. 404 was being laundered exactly that way.
export function isUnconfigured(err: unknown): boolean {
  return err instanceof ApiError && err.status === 503
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
// Everything else stays where it was. 503 remains isUnconfigured's calm "not wired here" (404 was
// removed from it — see above); 404/500/502/403 remain genuine faults. THAT SEPARATION IS THE POINT — a change that makes 401
// honest by routing 500 to the same message has not fixed anything, it has just moved which
// failures are misdescribed. Pinned by SessionExpired.test.tsx's 500/502/503 controls.
export function isSessionExpired(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401
}

/** The one sentence, said ONCE at the top of the app — never per panel. */
export const sessionExpiredCopy =
  'Your session has expired, so this workspace’s data can’t be read right now. Signing in again fixes it.'
