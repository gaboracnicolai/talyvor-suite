// B28.385 — the marketplace bill by Stripe invoice (talyvor-lens B28.140), on Lens's API, once a run, on workspaces of its own.
//
// A new seller publishes a prompt listing with one per_use commercial offer at $1.00 (billTax.ts's publish). A GB buyer
// declares itself, so each use carries its tax, and uses the listing, billed, and pays its bill with the synthetic bill-pay
// — invoice A — then does both again — invoice B — then uses it a third time and leaves that unpaid. A is refunded, as
// Stripe's charge.refunded refunds it.
//
// GET …/marketplace/invoices lists, newest first, the period in progress ("upcoming") and then B and A: each paid, its billing
// period starting where the last one ended, its PDF a Stripe link over https, and what it charged — price and tax — and
// refunded. The bill read for each (GET …/marketplace/bill?invoice=) holds exactly the uses that invoice carried, grouped by
// invoice period rather than calendar month, each inside its period; A's use reads refunded, never just paid; and each bill's
// gross is its invoice's gross less its refunds — 0 for A, B's price and tax for B, which is what Talyvor's receipt for B
// collected (Lens B32.40). The upcoming one holds the unpaid use.

import { fail } from './bank.ts'
import { publish } from './billTax.ts'
import type { MarketBill, MarketInvoice, SyntheticUser, TaxProfileAnswer } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import type { Scenario, ScenarioCtx } from './scenarios.ts'
import { until } from './trade.ts'

/** billTax.ts's per-use price, $1.00, in µLXC: ten to the µUSD. */
const PRICE_ULXC = 10_000_000
/** Lens meters a billed use within a minute; its tax is worked out then. */
const METER_WAIT_MS = 90_000
const UPCOMING = 'upcoming'

/** A use the buyer made, as its bill had it once metered: its id, when, and its price and tax in µUSD. */
interface Made { id: string; used_at: string; gross: number }

/** What is wrong with one invoice's bill: undefined when it holds exactly `uses`, inside the period, its gross the invoice's less refunds. */
export function invoiceBillFault(name: string, inv: MarketInvoice, bill: MarketBill, uses: Made[], refunded: boolean): string | undefined {
  const lines = bill.lines ?? []
  const ids = lines.map((l) => l.use_id).sort()
  const want = uses.map((u) => u.id).sort()
  if (bill.invoice?.id !== inv.id) return `the bill read for ${name} (?invoice=${inv.id}) names invoice ${JSON.stringify(bill.invoice?.id)}`
  if (ids.join() !== want.join()) {
    return `the bill read for ${name} should hold the use(s) that invoice carried, ${want.join(', ')}, grouped by its billing period; it holds ${ids.join(', ') || 'none'}`
  }
  const outside = lines.filter((l) => l.used_at === undefined || l.used_at < inv.period_start || l.used_at > inv.period_end)
  if (outside.length > 0) return `${name}'s billing period is ${inv.period_start} to ${inv.period_end}, and its bill holds uses made outside it: ${outside.map((l) => `${l.use_id} at ${l.used_at}`).join(', ')}`
  for (const l of lines) {
    if (refunded && l.refunded_at === undefined) return `${name} was refunded, and its use ${l.use_id} reads ${l.cleared_at === undefined ? 'unpaid' : 'paid'} on its bill, not refunded`
    if (!refunded && l.refunded_at !== undefined) return `nothing on ${name} was refunded, and its use ${l.use_id} reads refunded`
  }
  const left = inv.gross_usd_micros - inv.refunded_usd_micros
  if (bill.gross_usd_micros !== left) {
    return `${name} charged ${inv.gross_usd_micros} µUSD and refunded ${inv.refunded_usd_micros}, so its bill's total is ${left}; the bill reads gross ${bill.gross_usd_micros} µUSD`
  }
  return undefined
}

export function marketBillInvoices(seed: number): Scenario {
  return {
    id: 'market-bill-invoices',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Marketplace',
    items: ['B28.140', 'B28.385'],
    title: "a buyer's two paid bills and a third use unpaid list as two Stripe invoices after the period in progress, each with " +
      "its billing period, its PDF and what it charged; each invoice's bill holds exactly its own uses, the refunded one reading " +
      "refunded, and its total is the invoice's less refunds — the paid one's what Talyvor's receipt for it collected",
    run: async (ctx) => {
      const { env } = ctx
      const [seller, buyer] = await env.lens.createUsers(2)
      const pub = await publish(ctx, seller, `Invoiced use ${seed}-${RUN_SALT}`)
      if (typeof pub === 'string') return fail(pub)
      const put = await env.lens.act<TaxProfileAnswer>(buyer, 'PUT', '/v1/workspaces/{ws}/tax-profile', { legal_name: 'Nightly Invoice Buyer', address: '1 Test Street, London', country: 'GB' })
      ctx.evidence.push({ note: 'the buyer declares its tax profile', answer: said(put) })
      if (!put.ok) return fail(`the buyer's tax profile was refused: ${said(put)}`)

      // Two bills paid, one use each — invoices A and B — and a third use left on the period in progress; A refunded.
      const made: Made[] = []
      const invoices: string[] = []
      for (const pay of [true, true, false]) {
        const use = await meteredUse(ctx, buyer, pub.id)
        if (typeof use === 'string') return fail(use)
        made.push(use)
        if (!pay) continue
        const paid = await until(() => env.lens.payTestBill(buyer), (x) => x.ok || x.status !== 409, METER_WAIT_MS)
        ctx.evidence.push({ note: `the buyer's bill paid now (B25.7), use ${use.id} on it`, answer: said(paid) })
        if (!paid.ok) return fail(`paying the buyer's bill was refused: ${said(paid)}`)
        if (paid.value.uses_cleared !== 1) return fail(`paying a bill of one use cleared ${paid.value.uses_cleared}`)
        invoices.push(paid.value.invoice_id)
      }
      const [a, b] = invoices
      const back = await env.lens.refundTestBill(buyer, a)
      ctx.evidence.push({ note: `invoice A ${a} refunded (B25.7)`, answer: said(back) })
      if (!back.ok || back.value.uses_refunded !== 1) return fail(`refunding invoice A ${a}, of one use, answered ${said(back)}`)

      // The invoices: the period in progress, then B, then A — each period starting where the last one ended.
      const listed = await env.lens.marketInvoices(buyer)
      ctx.evidence.push({ note: "the buyer's invoices (GET …/marketplace/invoices)", answer: said(listed) })
      if (!listed.ok) return fail(`listing the buyer's invoices (GET …/marketplace/invoices) answered ${said(listed)}`)
      const got = listed.value.invoices ?? []
      if (got.map((x) => x.id).join() !== [UPCOMING, b, a].join()) {
        return fail(`the buyer's invoices should be, newest first, the period in progress then B and A — ${[UPCOMING, b, a].join(', ')}; Lens lists ${got.map((x) => x.id).join(', ') || 'none'}`)
      }
      const [upcoming, invB, invA] = got
      for (const [name, inv] of [['invoice A', invA], ['invoice B', invB]] as const) {
        if (inv.status !== 'paid') return fail(`${name} ${inv.id} was paid, and is listed ${inv.status}`)
        if (!/^https:\/\//.test(inv.invoice_pdf ?? '')) return fail(`${name} ${inv.id} should link Stripe's PDF over https; it reads ${JSON.stringify(inv.invoice_pdf)}`)
        if (!(inv.period_start < inv.period_end)) return fail(`${name}'s billing period runs ${inv.period_start} to ${inv.period_end}`)
      }
      if (invB.period_start < invA.period_end || upcoming.period_start < invB.period_end || upcoming.status !== UPCOMING) {
        return fail(`each billing period should start where the last ended: A ${invA.period_start}–${invA.period_end}, B ${invB.period_start}–${invB.period_end}, ` +
          `the period in progress (${upcoming.status}) ${upcoming.period_start}–${upcoming.period_end}`)
      }
      const [useA, useB, useC] = made
      if (invA.gross_usd_micros !== useA.gross || invA.refunded_usd_micros !== useA.gross || invB.gross_usd_micros !== useB.gross || invB.refunded_usd_micros !== 0) {
        return fail(`invoice A charged its one use's ${useA.gross} µUSD with tax and refunded all of it, B charged ${useB.gross} and refunded none; ` +
          `Lens lists A ${invA.gross_usd_micros} refunded ${invA.refunded_usd_micros}, B ${invB.gross_usd_micros} refunded ${invB.refunded_usd_micros}`)
      }

      // Each invoice's bill: its own uses, A's refunded, its total the invoice's less refunds.
      const bills: MarketBill[] = []
      for (const [name, inv, uses, refunded] of [['invoice A', invA, [useA], true], ['invoice B', invB, [useB], false], ['the period in progress', upcoming, [useC], false]] as const) {
        const bill = await env.lens.marketInvoiceBill(buyer, inv.id)
        ctx.evidence.push({ note: `the bill read for ${name} (?invoice=${inv.id})`, answer: said(bill) })
        if (!bill.ok) return fail(`reading the bill for ${name} (?invoice=${inv.id}) answered ${said(bill)}`)
        const wrong = invoiceBillFault(name, inv, bill.value, [...uses], refunded)
        if (wrong !== undefined) return fail(wrong)
        bills.push(bill.value)
      }

      // B's total is what Talyvor's receipt for B collected.
      const receipts = await env.lens.act<{ receipts: { invoice_id: string; number: string; gross_usd_micros: number }[] | null }>(buyer, 'GET', '/v1/workspaces/{ws}/marketplace/receipts')
      ctx.evidence.push({ note: "the buyer's receipts", answer: said(receipts) })
      if (!receipts.ok) return fail(`listing the buyer's receipts: ${said(receipts)}`)
      const receiptB = (receipts.value.receipts ?? []).find((r) => r.invoice_id === b)
      if (receiptB === undefined || receiptB.gross_usd_micros !== bills[1].gross_usd_micros) {
        return fail(`invoice B's bill totals ${bills[1].gross_usd_micros} µUSD, and Talyvor's receipt for it collected ${receiptB === undefined ? 'nothing — there is none' : `${receiptB.gross_usd_micros} µUSD`}`)
      }

      return { pass: true, detail: `two bills paid and a use left unpaid: Lens lists the period in progress, B and A, each paid one with its billing period and a Stripe PDF; ` +
        `A's bill holds its one use, refunded, total 0 (${invA.gross_usd_micros} charged, ${invA.refunded_usd_micros} refunded); B's its one use, paid, total ${bills[1].gross_usd_micros} µUSD, ` +
        `as receipt ${receiptB.number} collected; the period in progress holds the unpaid use, ${bills[2].gross_usd_micros} µUSD so far` }
    },
  }
}

/** The buyer uses the listing once, billed, and reads it back off its bill once Lens has metered it with its tax. */
async function meteredUse(ctx: ScenarioCtx, buyer: SyntheticUser, listing: string): Promise<Made | string> {
  const { env } = ctx
  const used = await env.lens.act<{ id: string; charge: string; price_ulxc: number }>(buyer, 'POST', `/v1/workspaces/{ws}/marketplace/listings/${listing}/use`, { variables: { text: 'a nightly invoice test' } })
  ctx.evidence.push({ note: 'the buyer uses it', answer: said(used) })
  if (!used.ok || used.value.charge !== 'billed' || used.value.price_ulxc !== PRICE_ULXC) return `the buyer's use should be billed at ${PRICE_ULXC} µLXC; Lens answered ${said(used)}`
  const metered = (x: MarketBill) => (x.lines ?? []).some((l) => l.use_id === used.value.id && (l.tax_treatment ?? '') !== '')
  const bill = await until(() => env.lens.marketBill(buyer), metered, METER_WAIT_MS)
  const line = (bill.lines ?? []).find((l) => l.use_id === used.value.id)
  if (line === undefined || !metered(bill)) return `${METER_WAIT_MS / 1000} s after the buyer's use ${used.value.id}, its bill does not hold it with its tax: ${JSON.stringify(bill.lines)}`
  return { id: line.use_id, used_at: line.used_at ?? '', gross: line.price_ulxc / 10 + (line.tax_usd_micros ?? 0) }
}
