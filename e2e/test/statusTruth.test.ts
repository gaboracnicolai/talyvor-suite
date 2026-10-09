import { describe, expect, it } from 'vitest'
import { RAIL_SERVICES } from '../src/moneyRails.ts'
import { type Healthz, type StatusJSON, statusTruthVerdict } from '../src/statusTruth.ts'

const NOW = Date.parse('2026-10-09T17:50:00Z')
const probed = '2026-10-09T17:46:00Z'

// Production's /status.json and /healthz as read at 17:46 UTC on 9 Oct, every rail answering its probe.
function page(): StatusJSON & Record<string, unknown> {
  const rails = RAIL_SERVICES.map((service) => ({
    service, name: service, mode: 'test', status: 'operational', last_success: probed, last_failure: null,
    capabilities: service === 'fx' ? [{ key: 'fx', cleared: false }] : [],
    ...(service === 'screening' ? { lists_age_hours: 3 } : {}),
  }))
  return {
    status: 'operational', version: 'b98a576', uptime_hours: 0.05, updated_at: probed,
    components: ['PostgreSQL', 'Redis', 'NATS', 'Proxy'].map((name) => ({ name, status: 'operational', latency_ms: 1, measured: true, checked_at: probed })),
    providers: [{ name: 'OpenAI', status: 'operational', latency_ms: 183, checked_at: probed }],
    rails,
    rails_summary: { up: 10, down: 0, idle: 0, down_names: [] },
  }
}
const health = (): Healthz => ({ status: 'healthy', version: 'b98a576', uptime_seconds: 198, checks: { database: { status: 'healthy', latency_ms: 1 } } })

describe('the status-truth oracle (B37.7)', () => {
  it('passes production as it reads with every rail answering', () => {
    expect(statusTruthVerdict(page(), health(), NOW)).toEqual({ pass: true, detail: expect.stringContaining('all 10 money rails') })
  })

  it('names a rail that is down and one never called', () => {
    const p = page()
    p.rails![5] = { ...p.rails![5], status: 'outage', last_failure: probed }
    p.rails![9] = { ...p.rails![9], status: 'unknown', last_success: null }
    p.rails_summary = { up: 8, down: 1, idle: 1, down_names: ['screening'] }
    const v = statusTruthVerdict(p, health(), NOW)
    expect(v.pass).toBe(false)
    expect(v.detail).toContain('rail screening (screening) is down')
    expect(v.detail).toContain('rail tax (tax) has not been called')
    expect(v.detail).not.toContain('rails_summary')
  })

  it('fails a page that disagrees with /healthz', () => {
    const v = statusTruthVerdict(page(), { ...health(), status: 'degraded', version: 'other', uptime_seconds: 900 }, NOW)
    expect(v.detail).toContain("is not /healthz's")
    expect(v.detail).toContain('more than 3 minutes')
    expect(v.detail).toContain('operational while /healthz reads "degraded"')
  })

  it('fails a stale probe, an unread clearance, a wrong summary, an extra key, an error text and public internals', () => {
    const p = page()
    p.rails![0] = { ...p.rails![0], last_success: '2026-10-09T17:30:00Z' }
    p.rails![1] = { ...p.rails![1], capabilities: [{ key: 'fx', cleared: null }] }
    p.rails_summary = { up: 9, down: 0, idle: 1, down_names: [] }
    p.components[0] = { ...p.components[0], status: 'outage', message: 'failed to connect to `user=lens`: 127.0.0.1:55433' }
    p.workspace = 'ws_1'
    const v = statusTruthVerdict(p, { ...health(), database_pool: {}, requests: {} }, NOW)
    for (const want of ['more than 10 minutes old', 'no cleared value for fx', 'is not the rows\'', 'PostgreSQL is outage',
      'keys it does not document: workspace', 'components[0].message holds an error text', 'carries database_pool and requests']) {
      expect(v.detail).toContain(want)
    }
  })

  it("holds the sanctions lists' age to the screening rail alone, and to no more than 48 h while it reads operational (B37.14)", () => {
    const screening = RAIL_SERVICES.indexOf('screening')
    const p = page()
    delete p.rails![screening].lists_age_hours
    p.rails![0] = { ...p.rails![0], lists_age_hours: 3 }
    const v = statusTruthVerdict(p, health(), NOW)
    expect(v.detail).toContain('rail screening (screening) carries no whole lists_age_hours (undefined)')
    expect(v.detail).toContain('rail account (account) carries lists_age_hours, which only the screening rail does')

    const stale = page()
    stale.rails![screening] = { ...stale.rails![screening], lists_age_hours: 52 }
    expect(statusTruthVerdict(stale, health(), NOW).detail).toContain('reads operational with its lists 52 h old, more than 48')
    stale.rails![screening] = { ...stale.rails![screening], lists_age_hours: 2.5 }
    expect(statusTruthVerdict(stale, health(), NOW).detail).toContain('carries no whole lists_age_hours (2.5)')
  })
})
