// B30.104 — the operator's Compliance page (/operator/compliance) reads every currency's reconciliation and safeguarding
// figures across all workspaces, so only someone on the BFF's OPERATOR_SUBS may have them. The testers are never on it,
// so once a run a signed-in tester asks the BFF for both reads and opens the page: both must be 403, and the page must
// say so and show no run, break or currency of anyone's.

import { fail } from './bank.ts'
import { bff } from './routes.ts'
import type { Scenario, Verdict } from './scenarios.ts'

const TIMEOUT_MS = 20_000
const REFUSAL = 'Only Talyvor’s operators can see this screen.'
export const OPERATOR_READS = ['/api/admin/reconciliation', '/api/admin/safeguarding'] as const

/** What the tester got: each read's status, and on the page the refusals shown and the figure rows rendered. */
export interface Seen {
  reads: { path: string; status: number }[]
  refusals: number
  rows: number
}

export function boundaryVerdict(seen: Seen): Verdict {
  const wrong = seen.reads.filter((r) => r.status !== 403).map((r) => `${r.path} answered a tester ${r.status}, not 403`)
  if (seen.rows > 0) wrong.push(`the Compliance page showed a tester ${seen.rows} reconciliation or safeguarding rows`)
  if (seen.refusals < OPERATOR_READS.length) wrong.push(`the Compliance page said "${REFUSAL}" ${seen.refusals} times, not ${OPERATOR_READS.length}`)
  if (wrong.length > 0) return fail(wrong.join('; '))
  return { pass: true, detail: `a tester asking ${OPERATOR_READS.join(' and ')} is refused 403, and the Compliance page says only operators can see it` }
}

export function operatorComplianceBoundary(): Scenario {
  return {
    id: 'operator-compliance-boundary',
    owner: 'talyvor-suite',
    items: ['B30.104'],
    feature: 'Operator',
    title: 'a tester, who is not an operator, is refused the Compliance page’s reconciliation and safeguarding figures, at the BFF and on the screen',
    run: async (ctx) => {
      const reads: Seen['reads'] = []
      for (const path of OPERATOR_READS) {
        const r = await bff<unknown>(ctx, 'GET', path)
        ctx.evidence.push({ note: `a tester asks ${path}`, answer: r.ok ? `${r.status} ${JSON.stringify(r.value).slice(0, 300)}` : `${r.status} ${r.error}` })
        reads.push({ path, status: r.status })
      }
      const page = await ctx.app.tab('/operator/compliance')
      try {
        await page.locator('header h1').filter({ hasText: 'Compliance' }).waitFor({ timeout: TIMEOUT_MS })
        const refusal = page.getByText(REFUSAL, { exact: true })
        await refusal.nth(OPERATOR_READS.length - 1).waitFor({ timeout: TIMEOUT_MS }).catch(() => undefined)
        const rows = await page.locator('[data-testid="compliance-run"], [data-testid="compliance-break"], [data-testid="compliance-safeguarding"]').count()
        return boundaryVerdict({ reads, refusals: await refusal.count(), rows })
      } finally {
        await page.close()
      }
    },
  }
}
