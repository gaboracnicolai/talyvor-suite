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
