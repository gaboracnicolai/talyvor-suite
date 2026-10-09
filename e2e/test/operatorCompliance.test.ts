import { describe, expect, it } from 'vitest'
import { OPERATOR_READS, boundaryVerdict } from '../src/operatorCompliance.ts'

const refused = OPERATOR_READS.map((path) => ({ path, status: 403 }))

describe('the operator Compliance page’s boundary oracle (B30.104)', () => {
  it('passes a tester refused both reads, with the page saying so and showing nothing', () => {
    expect(boundaryVerdict({ reads: refused, refusals: 2, rows: 0 }).pass).toBe(true)
  })

  it('fails when a tester gets the figures', () => {
    const v = boundaryVerdict({ reads: [{ path: '/api/admin/reconciliation', status: 200 }, refused[1]], refusals: 1, rows: 3 })
    expect(v.pass).toBe(false)
    expect(v.detail).toContain('/api/admin/reconciliation answered a tester 200, not 403')
    expect(v.detail).toContain('showed a tester 3 reconciliation or safeguarding rows')
  })
})
