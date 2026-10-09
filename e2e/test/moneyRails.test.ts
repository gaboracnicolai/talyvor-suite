import { describe, expect, it } from 'vitest'
import { type MoneyRail, RAIL_SERVICES, railsVerdict } from '../src/moneyRails.ts'

// Lens's rails as B30.12 sends them after a night's calls: screening failed once, then answered.
const rails: MoneyRail[] = RAIL_SERVICES.map((service) => service === 'screening'
  ? { service, mode: 'test', status: 'operational', last_success: '2026-10-09T02:00:00Z', last_failure: '2026-10-09T01:00:00Z' }
  : { service, mode: 'test', status: 'unknown', last_success: null, last_failure: null })

describe('the money rails oracle (B30.124)', () => {
  it('passes all ten on their Test partner with none down', () => {
    expect(railsVerdict(rails)).toEqual({ pass: true, detail: expect.stringContaining('all 10') })
  })

  it('fails when screening failed after its last success', () => {
    const down = rails.map((r) => (r.service === 'screening' ? { ...r, status: 'outage', last_failure: '2026-10-09T03:00:00Z' } : r))
    expect(railsVerdict(down)).toEqual({ pass: false, detail: expect.stringContaining('screening is down') })
  })

  it('fails when a rail is missing or live', () => {
    const v = railsVerdict(rails.filter((r) => r.service !== 'tax').map((r) => (r.service === 'fx' ? { ...r, mode: 'live' } : r)))
    expect(v.pass).toBe(false)
    expect(v.detail).toContain('tax is not listed')
    expect(v.detail).toContain('fx is in mode "live"')
  })
})
