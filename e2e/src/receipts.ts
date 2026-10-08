// B32.94 — Talyvor's receipt for a paid marketplace bill (Lens B32.40), on Lens's API, once a run, on workspaces of its own.
//
// A new seller publishes a prompt listing with one per_use commercial offer at $1.00 (billTax.ts's publish). A GB buyer
// declares who and where it is (PUT …/tax-profile {legal_name, address, country GB}), uses the listing twice, billed, and
// pays its bill with the synthetic bill-pay. On the owner's key the receipts list holds one receipt for that invoice,
// numbered TEST-<year>-NNNNNN in the test series, and the receipt has the bill's two lines — each one's net, rate and tax
// as the bill (GET …/marketplace/bill) had it — with gross = net + tax. Its page (?format=html) is text/html and its PDF
// (?format=pdf) application/pdf starting %PDF-; a test receipt is a Preview, and while Talyvor's VAT number
// (LENS_SUPPLIER_VAT_NUMBER) is unset the page prints "VAT registration pending" in its place. The buyer's agent key is
// refused 403 the list and the receipt: a receipt prints the buyer's legal name, address and VAT number.
//
// A DE business with a valid VAT number (DE123456789) pays its bill next: its receipt is numbered in turn — the GB one's
// sequence + 1, or later if another run paid a bill between — reverse charged, with no VAT and a note naming the reverse
// charge.

import { fail } from './bank.ts'
import { publish } from './billTax.ts'
import type { BillLine, MarketBill, MarketReceipt, SyntheticUser, TaxProfileAnswer } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import type { Scenario, ScenarioCtx } from './scenarios.ts'
import { until } from './trade.ts'

/** billTax.ts's per-use price, $1.00, in µLXC: ten to the µUSD. */
const PRICE_ULXC = 10_000_000
/** Lens meters a billed use within a minute; its tax is worked out then. */
const METER_WAIT_MS = 90_000

interface Buyer {
  who: string
  uses: number
  business: boolean
  profile: Record<string, string>
}

const GB: Buyer = { who: 'the GB buyer', uses: 2, business: false, profile: { legal_name: 'Nightly Receipt Buyer', address: '1 Test Street, London', country: 'GB' } }
// DE123456789 is well formed and not on the Test tax partner's list of numbers never issued: valid.
const DE: Buyer = { who: 'the DE business', uses: 1, business: true,
  profile: { legal_name: 'Nightly Receipt GmbH', address: 'Teststraße 1, Berlin', country: 'DE', tax_id: 'DE123456789' } }

/** What a paid bill came to: its lines as the bill had them before it was paid, and the invoice that paid them. */
interface Paid { lines: BillLine[]; invoice: string }

/**
 * What is wrong with a receipt for the paid bill: undefined when nothing. Its number is its series, year and sequence; it
 * has the bill's lines, each with the bill's net, rate and tax; and its totals are theirs, gross = net + tax.
 */
export function receiptFault(who: string, r: MarketReceipt, paid: Paid): string | undefined {
  const want = `TEST-${r.year}-${String(r.sequence).padStart(6, '0')}`
  if (r.series !== 'test' || r.number !== want) return `${who}'s receipt is numbered ${r.number} in the ${r.series} series: test money is TEST-<year>-NNNNNN, ${want} for sequence ${r.sequence} of ${r.year}`
  const got = r.lines ?? []
  const shown = (l: { use_id: string; net_usd_micros: number; rate_bps: number; tax_usd_micros: number }): string =>
    `${l.use_id} net ${l.net_usd_micros} at ${l.rate_bps} bps, tax ${l.tax_usd_micros}`
  const billed = paid.lines.map((l) => ({ use_id: l.use_id, net_usd_micros: l.price_ulxc / 10, rate_bps: l.tax_rate_bps ?? 0, tax_usd_micros: l.tax_usd_micros ?? 0 }))
  const missing = billed.filter((b) => !got.some((l) => l.use_id === b.use_id && l.net_usd_micros === b.net_usd_micros && l.rate_bps === b.rate_bps && l.tax_usd_micros === b.tax_usd_micros))
  if (got.length !== billed.length || missing.length > 0) {
    return `${who}'s receipt ${r.number} should have the bill's ${billed.length} line(s) — ${billed.map(shown).join('; ')} — and has ${got.length}: ${got.map(shown).join('; ') || 'none'}`
  }
  const net = billed.reduce((s, l) => s + l.net_usd_micros, 0)
  const tax = billed.reduce((s, l) => s + l.tax_usd_micros, 0)
  if (r.net_usd_micros !== net || r.tax_usd_micros !== tax || r.gross_usd_micros !== net + tax) {
    return `${who}'s receipt ${r.number} reads net ${r.net_usd_micros}, tax ${r.tax_usd_micros}, gross ${r.gross_usd_micros} µUSD; its bill's lines are net ${net}, tax ${tax}, gross ${net + tax}`
  }
  return undefined
}

export function marketReceipts(seed: number): Scenario {
  return {
    id: 'market-receipts',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Marketplace',
    title: "a GB buyer's paid bill of two uses gets Talyvor's receipt, numbered TEST-<year>-NNNNNN, its lines and totals the bill's, as a " +
      "page and a PDF, a Preview reading \"VAT registration pending\" until Talyvor's VAT number is set, and refused to the buyer's agent " +
      "key; a DE business's bill paid next is receipted in turn, reverse charged with no VAT and the reverse-charge note",
    run: async (ctx) => {
      const { env } = ctx
      const [seller, gb, de] = await env.lens.createUsers(3)
      const pub = await publish(ctx, seller, `Receipted use ${seed}-${RUN_SALT}`)
      if (typeof pub === 'string') return fail(pub)

      // The GB buyer's bill of two uses, paid, and its receipt.
      const gbPaid = await buyAndPay(ctx, GB, gb, pub.id)
      if (typeof gbPaid === 'string') return fail(gbPaid)
      const first = await receiptOf(ctx, GB, gb, gbPaid)
      if (typeof first === 'string') return fail(first)
      if (first.reverse_charge) return fail(`${GB.who}'s receipt ${first.number} is reverse charged: a GB consumer is not`)

      // Its page and its PDF, a Preview, Talyvor's VAT number printed as pending while it is unset.
      const path = `/v1/workspaces/${gb.workspaceID}/marketplace/receipts/${first.id}`
      const page = await env.lens.as(gb.token, 'GET', `${path}?format=html`)
      ctx.evidence.push({ note: `${GB.who}'s receipt as a page`, answer: `${page.status} ${page.headers.get('Content-Type')} ${page.text.slice(0, 300)}` })
      if (page.status !== 200 || !(page.headers.get('Content-Type') ?? '').startsWith('text/html') || !page.text.includes(first.number)) {
        return fail(`${GB.who}'s receipt ${first.number} as a page (?format=html) should be text/html naming its number; Lens answered ${page.status} ${page.headers.get('Content-Type')} ${page.text.slice(0, 200)}`)
      }
      const vat = first.supplier?.vat_number ?? ''
      if (!first.preview) return fail(`${GB.who}'s receipt ${first.number} is for test money and is no Preview: ${JSON.stringify(first)}`)
      if (vat === '' && !page.text.includes('VAT registration pending')) {
        return fail(`Talyvor's VAT number is unset on ${GB.who}'s receipt ${first.number}, so its page should read "VAT registration pending"; it reads ${page.text.slice(0, 300)}`)
      }
      if (vat !== '' && !page.text.includes(vat)) return fail(`${GB.who}'s receipt ${first.number} names Talyvor's VAT number ${vat}, and its page does not print it`)
      const pdf = await env.lens.as(gb.token, 'GET', `${path}?format=pdf`)
      ctx.evidence.push({ note: `${GB.who}'s receipt as a PDF`, answer: `${pdf.status} ${pdf.headers.get('Content-Type')} ${pdf.text.slice(0, 40)}` })
      if (pdf.status !== 200 || pdf.headers.get('Content-Type') !== 'application/pdf' || !pdf.text.startsWith('%PDF-')) {
        return fail(`${GB.who}'s receipt ${first.number} as a PDF (?format=pdf) should be application/pdf starting %PDF-; Lens answered ${pdf.status} ${pdf.headers.get('Content-Type')} ${JSON.stringify(pdf.text.slice(0, 40))}`)
      }

      // The buyer's agent key reads neither the list nor the receipt.
      const agent = await env.lens.createAgent(gb, `Receipt reader ${RUN_SALT}`)
      const key = await env.lens.act<{ key: string }>(gb, 'POST', `/v1/workspaces/{ws}/agents/${agent.id}/keys`, { name: 'market-receipts' })
      if (!key.ok) return fail(`issuing ${agent.name} a key was refused: ${said(key)}`)
      for (const read of [`/v1/workspaces/${gb.workspaceID}/marketplace/receipts`, path]) {
        const got = await env.lens.as(key.value.key, 'GET', read)
        ctx.evidence.push({ note: `${GB.who}'s agent key reads ${read}`, answer: `${got.status} ${got.text.slice(0, 300)}` })
        if (got.status !== 403) return fail(`${GB.who}'s agent key must be refused 403 reading ${read} (the buyer's legal name, address and VAT number); Lens answered ${got.status} ${got.text.slice(0, 200)}`)
      }

      // The DE business's bill paid next: receipted in turn, reverse charged.
      const dePaid = await buyAndPay(ctx, DE, de, pub.id)
      if (typeof dePaid === 'string') return fail(dePaid)
      const next = await receiptOf(ctx, DE, de, dePaid)
      if (typeof next === 'string') return fail(next)
      const inTurn = next.year === first.year ? next.sequence > first.sequence : next.year === first.year + 1
      if (!inTurn) return fail(`${DE.who}'s bill was paid after ${GB.who}'s, so its receipt ${next.number} should come after ${first.number} in the run (sequence ${first.sequence} + 1 or later); it is sequence ${next.sequence} of ${next.year}`)
      if (!next.reverse_charge || next.tax_usd_micros !== 0 || !(next.notes ?? []).some((n) => /reverse charge/i.test(n))) {
        return fail(`${DE.who}, with a valid VAT number, should have a reverse-charged receipt with no VAT and a note naming the reverse charge; ${next.number} reads reverse_charge ${next.reverse_charge}, ` +
          `VAT ${next.tax_usd_micros} µUSD, notes ${JSON.stringify(next.notes)}`)
      }

      const pending = vat === '' ? ', Talyvor\'s VAT number "VAT registration pending"' : `, Talyvor's VAT number ${vat}`
      return { pass: true, detail: `${GB.who}'s bill of ${gbPaid.lines.length} uses paid: receipt ${first.number}, its lines and totals the bill's (net ${first.net_usd_micros}, ` +
        `tax ${first.tax_usd_micros}, gross ${first.gross_usd_micros} µUSD), a page and a PDF, a Preview${pending}; its agent key refused 403; ${DE.who}'s bill paid next: ` +
        `receipt ${next.number}, in turn, reverse charged at 0 VAT ("${(next.notes ?? [])[0] ?? ''}")` }
    },
  }
}

/** The buyer declares itself, uses the listing `b.uses` times, billed, and pays the bill once each use is metered with its tax. */
async function buyAndPay(ctx: ScenarioCtx, b: Buyer, buyer: SyntheticUser, listing: string): Promise<Paid | string> {
  const { env } = ctx
  const put = await env.lens.act<TaxProfileAnswer>(buyer, 'PUT', '/v1/workspaces/{ws}/tax-profile', b.profile)
  ctx.evidence.push({ note: `${b.who} declares its tax profile`, answer: said(put) })
  if (!put.ok) return `${b.who}'s tax profile was refused: ${said(put)}`
  if (put.value.resolved?.country !== b.profile.country || put.value.resolved.business !== b.business) {
    return `${b.who} declared ${b.profile.country}${b.business ? ' with a valid VAT number' : ''}; Lens resolves it to ${JSON.stringify(put.value.resolved)}`
  }
  const ids: string[] = []
  for (let n = 0; n < b.uses; n++) {
    const used = await env.lens.act<{ id: string; charge: string; price_ulxc: number }>(buyer, 'POST', `/v1/workspaces/{ws}/marketplace/listings/${listing}/use`, { variables: { text: 'a nightly receipt test' } })
    ctx.evidence.push({ note: `${b.who} uses it`, answer: said(used) })
    if (!used.ok || used.value.charge !== 'billed' || used.value.price_ulxc !== PRICE_ULXC) return `${b.who}'s use should be billed at ${PRICE_ULXC} µLXC; Lens answered ${said(used)}`
    ids.push(used.value.id)
  }
  const metered = (x: MarketBill): boolean => ids.every((id) => (x.lines ?? []).some((l) => l.use_id === id && (l.tax_treatment ?? '') !== ''))
  const bill = await until(() => env.lens.marketBill(buyer), metered, METER_WAIT_MS)
  ctx.evidence.push({ note: `${b.who}'s bill, before it is paid`, answer: JSON.stringify(bill) })
  if (!metered(bill)) return `${METER_WAIT_MS / 1000} s after ${b.who}'s ${ids.length} use(s), its bill does not hold each with its tax: ${JSON.stringify(bill.lines)}`
  const lines = (bill.lines ?? []).filter((l) => ids.includes(l.use_id))
  const paid = await until(() => env.lens.payTestBill(buyer), (x) => x.ok || x.status !== 409, METER_WAIT_MS)
  ctx.evidence.push({ note: `${b.who}'s bill paid now (B25.7)`, answer: said(paid) })
  if (!paid.ok) return `paying ${b.who}'s bill was refused: ${said(paid)}`
  if (paid.value.uses_cleared !== ids.length) return `paying ${b.who}'s bill of ${ids.length} use(s) cleared ${paid.value.uses_cleared}`
  return { lines, invoice: paid.value.invoice_id }
}

/** The one receipt the owner's key lists for the paid invoice, read whole, and checked against the bill: it, or what is wrong. */
async function receiptOf(ctx: ScenarioCtx, b: Buyer, buyer: SyntheticUser, paid: Paid): Promise<MarketReceipt | string> {
  const { env } = ctx
  const listed = await env.lens.act<{ receipts: { id: string; number: string; invoice_id: string }[] | null }>(buyer, 'GET', '/v1/workspaces/{ws}/marketplace/receipts')
  ctx.evidence.push({ note: `${b.who}'s receipts`, answer: said(listed) })
  if (!listed.ok) return `listing ${b.who}'s receipts: ${said(listed)}`
  const ours = (listed.value.receipts ?? []).filter((r) => r.invoice_id === paid.invoice)
  if (ours.length !== 1) return `${b.who}'s paid bill ${paid.invoice} should have one receipt; Lens lists ${JSON.stringify(listed.value.receipts)}`
  const got = await env.lens.act<MarketReceipt>(buyer, 'GET', `/v1/workspaces/{ws}/marketplace/receipts/${ours[0].id}`)
  ctx.evidence.push({ note: `${b.who}'s receipt`, answer: said(got) })
  if (!got.ok) return `reading ${b.who}'s receipt ${ours[0].id}: ${said(got)}`
  if (got.value.number !== ours[0].number) return `${b.who}'s receipt is listed as ${ours[0].number} and reads ${got.value.number}`
  return receiptFault(b.who, got.value, paid) ?? got.value
}
