// B30.123 — the daily reconciliation and the safeguarding view (talyvor-lens B30.11). Once a run, last, after the night's
// test payments through partner accounts, the operator read key reads GET /v1/admin/safeguarding and GET
// /v1/admin/reconciliation. Every money currency must have been reconciled within the last two days, none may show a
// shortfall (customers holding more than the partner reports holding for them), and the newest day's runs may carry no
// break: a payment the partner's statement does not show (missing), one only it shows (extra), or one whose amounts differ.

import { fail } from './bank.ts'
import { CannotTest, type Scenario, type Verdict } from './scenarios.ts'

/** Lens's economy.MoneyCurrencies: each is reconciled every day, a payment through it or not. */
export const MONEY_CURRENCIES = ['EUR', 'GBP', 'USD', 'USDC'] as const
/** The newest run may be of the day before yesterday (UTC) at the oldest: the job reconciles yesterday within an hour of midnight. */
const STALE_DAYS = 2

/** One break, as Lens's economy.ReconciliationBreak sends it. */
export interface ReconciliationBreak {
  kind: string
  workspace_id: string
  account_id: string
  payment_ref: string
  ledger_minor: number
  statement_minor: number
  amount_minor: number
}

/** One currency's run for one day, as Lens's economy.ReconciliationRun sends it. */
export interface ReconciliationRun {
  id: string
  day: string
  currency: string
  funding: string
  partner: string
  customers_hold_minor: number
  partner_holds_minor: number
  shortfall_minor: number
  break_count: number
  breaks: ReconciliationBreak[] | null
  ran_at: string
}

/** The oracle: every currency reconciled lately, no shortfall in the safeguarding view, and no break on the newest day. */
export function reconciliationVerdict(safeguarding: readonly ReconciliationRun[], runs: readonly ReconciliationRun[], now = new Date()): Verdict {
  const wrong: string[] = []
  for (const c of MONEY_CURRENCIES) if (!safeguarding.some((r) => r.currency === c)) wrong.push(`the safeguarding view has no run in ${c}`)
  for (const r of safeguarding.filter((r) => r.shortfall_minor !== 0)) {
    wrong.push(`${r.currency} (${r.funding}) is short ${r.shortfall_minor} minor units: customers hold ${r.customers_hold_minor}, the partner ${r.partner_holds_minor}`)
  }
  const newest = runs.reduce((d, r) => (r.day > d ? r.day : d), '')
  if (newest === '') wrong.push('GET /v1/admin/reconciliation lists no run')
  else if (newest < new Date(now.getTime() - STALE_DAYS * 86_400e3).toISOString().slice(0, 10)) wrong.push(`the newest reconciliation is of ${newest}: the daily run has stopped`)
  for (const r of runs.filter((r) => r.day === newest && (r.break_count !== 0 || (r.breaks ?? []).length !== 0))) {
    const each = (r.breaks ?? []).map((b) => `${b.kind} ${b.payment_ref} (ledger ${b.ledger_minor}, statement ${b.statement_minor})`)
    wrong.push(`${newest} ${r.currency} (${r.funding}) has ${r.break_count} breaks: ${each.join(', ')}`)
  }
  if (wrong.length > 0) return fail(wrong.join('; '))
  return { pass: true, detail: `${newest} reconciled with no break in ${runs.filter((r) => r.day === newest).length} runs, and no shortfall in ${MONEY_CURRENCIES.join(', ')}` }
}

export function dailyReconciliation(): Scenario {
  return {
    id: 'daily-reconciliation',
    owner: 'talyvor-lens',
    title: 'the daily reconciliation finds no break and the safeguarding view no shortfall in any currency',
    feature: 'Agent Wallets',
    items: ['B30.11'],
    run: async (ctx) => {
      const key = ctx.env.operatorReadKey
      if (key === '') throw new CannotTest('needs the operator read key Lens boots with: LENS_OPERATOR_READ_KEY')
      const read = async <T>(path: string): Promise<T> => {
        const res = await ctx.env.lens.as(key, 'GET', path)
        ctx.evidence.push({ note: `the operator read key asks ${path}`, answer: `${res.status} ${res.text.slice(0, 600)}` })
        if (res.status !== 200) throw new Error(`GET ${path} answered ${res.status}: ${res.text.slice(0, 200)}`)
        return JSON.parse(res.text) as T
      }
      const { currencies } = await read<{ currencies: ReconciliationRun[] | null }>('/v1/admin/safeguarding')
      const { runs } = await read<{ runs: ReconciliationRun[] | null }>('/v1/admin/reconciliation')
      return reconciliationVerdict(currencies ?? [], runs ?? [])
    },
  }
}
