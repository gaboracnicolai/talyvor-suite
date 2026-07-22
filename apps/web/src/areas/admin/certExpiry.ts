// Certificate-expiry classification, pure (wall-clock is an argument — the
// lens spendMath precedent). Expiry is the one admin surface where a warning
// colour earns its keep, and it uses the ECONOMY states rather than inventing
// new ones: valid → settled, inside the renewal window → held, expired →
// slashed. An unparseable cert is NOT classified here — no expiry data means
// no expiry claim (the screen shows a neutral parse-error chip instead).
import type { PillStatus } from '@talyvor/ui'

export type ExpiryState = 'valid' | 'expiring' | 'expired'

/** Industry-standard renewal window: inside 30 days an operator should act. */
export const EXPIRY_WARN_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

export function expiryState(notAfterISO: string, nowMS: number): ExpiryState {
  const t = Date.parse(notAfterISO)
  if (Number.isNaN(t)) return 'expired' // an unreadable date on a cert row is never "fine"
  if (t <= nowMS) return 'expired'
  if (t - nowMS < EXPIRY_WARN_DAYS * DAY_MS) return 'expiring'
  return 'valid'
}

export const expiryPill: Record<ExpiryState, PillStatus> = {
  valid: 'settled',
  expiring: 'held',
  expired: 'slashed',
}

export const expiryLabel: Record<ExpiryState, string> = {
  valid: 'valid',
  expiring: 'expires soon',
  expired: 'expired',
}

/** Whole days until expiry (negative = days since). For the row's caption. */
export function daysUntil(notAfterISO: string, nowMS: number): number | null {
  const t = Date.parse(notAfterISO)
  if (Number.isNaN(t)) return null
  return Math.floor((t - nowMS) / DAY_MS)
}
