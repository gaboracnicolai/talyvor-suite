import { describe, expect, it } from 'vitest'
import { B30_CAPABILITIES, capabilitiesVerdict } from '../src/clearances.ts'
import type { CapabilityStatus } from '../src/lens.ts'

// Lens's answer as B30.1 left it, with one of the older capabilities beside the nineteen.
const listed: CapabilityStatus[] = [
  { capability: 'spend_on_talyvor', name: 'Spending on Talyvor', class: 'GREEN', real_money: true },
  ...Object.entries(B30_CAPABILITIES).map(([capability, cls]) => ({ capability, name: capability, class: cls, real_money: false })),
]

describe('the B30.1 capabilities oracle (B30.115)', () => {
  it('passes the nineteen, 5 AMBER and 14 RED, on test money only', () => {
    expect(Object.values(B30_CAPABILITIES).filter((c) => c === 'AMBER')).toHaveLength(5)
    expect(capabilitiesVerdict(listed)).toEqual({ pass: true, detail: expect.stringContaining('all 19') })
  })

  it('fails when one is removed from the registry', () => {
    expect(capabilitiesVerdict(listed.filter((c) => c.capability !== 'fx'))).toEqual({ pass: false, detail: expect.stringContaining('fx is not listed') })
  })

  it('fails when one changes class or takes real money', () => {
    const moved = listed.map((c) => (c.capability === 'pay_by_bank' ? { ...c, class: 'GREEN' } : c.capability === 'cover' ? { ...c, real_money: true } : c))
    const v = capabilitiesVerdict(moved)
    expect(v.pass).toBe(false)
    expect(v.detail).toContain('pay_by_bank is GREEN, not AMBER')
    expect(v.detail).toContain('cover takes real money')
  })
})
