import { describe, expect, it } from 'vitest'
import { CapReached, SpendCap } from '../src/budget.ts'

describe('SpendCap', () => {
  it('refuses a request whose worst case would pass the cap, and stays shut after', () => {
    const cap = new SpendCap(1)
    const a = cap.reserve(0.6)
    expect(() => cap.reserve(0.5)).toThrow(CapReached) // 0.6 held + 0.5 > 1: never sent
    cap.settle(a, 0.1) // the first answer cost far less than its worst case
    expect(cap.spentUSD).toBeCloseTo(0.1)
    expect(() => cap.reserve(0.01)).toThrow(CapReached) // shut: no new work after the first refusal
  })

  it('counts a cost nobody could read at its worst case, never at zero', () => {
    const cap = new SpendCap(5)
    cap.settle(cap.reserve(0.02), undefined)
    expect(cap.spentUSD).toBeCloseTo(0.02)
    expect(cap.inFlightUSD).toBe(0)
  })
})
