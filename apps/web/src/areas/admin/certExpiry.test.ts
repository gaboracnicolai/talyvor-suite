import { describe, expect, it } from 'vitest'
import { EXPIRY_WARN_DAYS, daysUntil, expiryLabel, expiryPill, expiryState } from './certExpiry'

const DAY = 24 * 60 * 60 * 1000
const now = Date.parse('2026-07-22T12:00:00Z')
const at = (deltaMS: number) => new Date(now + deltaMS).toISOString()

describe('expiryState', () => {
  it('classifies far-future as valid, inside the window as expiring, past as expired', () => {
    expect(expiryState(at(365 * DAY), now)).toBe('valid')
    expect(expiryState(at(17 * DAY), now)).toBe('expiring')
    expect(expiryState(at(-1 * DAY), now)).toBe('expired')
  })

  it('boundaries: exactly now is expired; exactly the warn threshold is valid', () => {
    expect(expiryState(at(0), now)).toBe('expired')
    expect(expiryState(at(EXPIRY_WARN_DAYS * DAY), now)).toBe('valid')
    expect(expiryState(at(EXPIRY_WARN_DAYS * DAY - 1), now)).toBe('expiring')
  })

  it('an unparseable date is never "fine"', () => {
    expect(expiryState('not-a-date', now)).toBe('expired')
  })

  it('maps to the economy states only — no invented colours', () => {
    expect(expiryPill).toEqual({ valid: 'settled', expiring: 'held', expired: 'slashed' })
    expect(expiryLabel.expiring).toBe('expires soon')
  })
})

describe('daysUntil', () => {
  it('whole days, negative when past, null when unparseable', () => {
    expect(daysUntil(at(17 * DAY), now)).toBe(17)
    expect(daysUntil(at(-21 * DAY), now)).toBe(-21)
    expect(daysUntil('garbage', now)).toBeNull()
  })
})
