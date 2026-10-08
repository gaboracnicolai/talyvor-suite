// B32.66 — tax and payouts (Lens B32.39–B32.42), on Lens's API, once a run, on workspaces of its own.
//
// A new seller publishes a listing with a 30-day commercial rent at $10.00. Three new buyers declare who and where they
// are (PUT …/tax-profile) and each rents it: a GB consumer, a DE business with a VAT number the Test tax partner finds
// valid, and a US buyer. Each rent is one line on its buyer's marketplace bill, and once Lens has metered it the line
// carries its tax (market_tax_lines). On the Test tax partner's fixture rows (talyvor-lens internal/partners/testdata/tax:
// GB 20% under a GB VAT registration, no US registration) the three treatments are: the GB consumer standard at 2000
// bps, 2,000,000 µUSD; the DE business reverse_charge at 0 with the reverse-charge note; the US buyer not_registered at
// 0. A Lens whose operator has loaded no GB registration charges the GB consumer not_registered at 0 instead, and that is
// said, not failed. Each bill's gross is its net plus its tax.
//
// Each bill is paid with the synthetic bill-pay, and Talyvor's receipt for it (B32.40) is the oracle for the totals: one
// receipt for the paid invoice, in the test series, whose one line is the bill's line — its net, rate and tax — whose
// gross is net plus tax, and which is reverse charged, with the note, for the DE business alone.
//
// The seller's shares are released from the journal's holdback by Lens's release job; the journal then holds the three
// shares available and reconciles, and the seller's statement of the week (B32.42) has the three sales, Talyvor's fee
// and nothing paid — net 0, all carried forward — with the VAT Talyvor collected on those sales: the tax its meter
// events billed the buyers, cleared to tax:<XX> on the journal.
//
// The three shares are $25.50, over the $25 payout minimum. The seller has given no tax details, so the payout run —
// brought to the seller now with the synthetic key (talyvor-lens B32.99), its tax reminders brought due first — withholds
// them: no payout, the hold on their tax details, the journal unmoved. The seller completes their details and the next
// run pays them: one payout of the whole $25.50, its net its gross less Stripe's fees, and the journal's available back
// to 0 — moved by exactly the payout's gross — and the week's statement names that payout, its lines summing to its net,
// its sales and fee the three shares the journal released, its Stripe fees the payout's.
//
// While Lens cannot store a seller's tax details (no LENS_PROVIDER_SECRET_KEK) or has no synthetic payout run, the payout
// half cannot run: the scenario SKIPs naming why, after the tax half has passed — a FAIL in the tax half is still a FAIL.

import { randomUUID } from 'node:crypto'
import { fail } from './bank.ts'
import { keptOf } from './fees.ts'
import type { BillLine, Listing, MarketBill, MarketLicence, MarketOffer, MarketReceipt, SellerTax, SyntheticUser, TaxProfileAnswer, WeekStatement, WeeklyPayout } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { CannotTest, type Scenario, type ScenarioCtx } from './scenarios.ts'
import { until } from './trade.ts'

/** The rent: $10.00 for 30 days, µUSD; one µUSD is ten µLXC at the peg. */
const RENT_USD_MICROS = 10_000_000
const RENT_ULXC = RENT_USD_MICROS * 10
const RENT_DAYS = 30
/** The listing's per-use offer, beside the rent: no buyer uses it. */
const PER_USE_USD_MICROS = 100_000
/** The GB standard rate on the fixture rows, and its tax on the rent, half up. */
const GB_RATE_BPS = 2000
const GB_TAX_USD_MICROS = 2_000_000
/** Lens meters a billed use within a minute; its tax is worked out then. */
const METER_WAIT_MS = 90_000
/** Lens's release job runs every 5 minutes. */
const RELEASE_WAIT_MS = 360_000

interface Buyer {
  who: string
  country: string
  business: boolean
  profile: Record<string, string>
}

const BUYERS: readonly Buyer[] = [
  { who: 'the GB consumer', country: 'GB', business: false, profile: { legal_name: 'Nightly GB Consumer', address: '1 Test Street, London', country: 'GB', postal_code: 'SW1A 1AA' } },
  // DE123456789 is well formed and not on the Test tax partner's list of numbers never issued: valid.
  { who: 'the DE business', country: 'DE', business: true, profile: { legal_name: 'Nightly Test GmbH', address: 'Teststraße 1, Berlin', country: 'DE', postal_code: '10115', tax_id: 'DE123456789' } },
  { who: 'the US buyer', country: 'US', business: false, profile: { legal_name: 'Nightly US Buyer', address: '1 Test Avenue, San Francisco', country: 'US', region: 'CA', postal_code: '94105' } },
]

/** A seller's complete tax details, as an individual in GB (Lens sellertax.Input). */
const SELLER_DETAILS = {
  seller_type: 'individual', first_name: 'Nightly', last_name: 'Seller', address: '2 Test Street, London', country: 'GB',
  tins: [{ jurisdiction: 'GB', number: '1234567890' }], date_of_birth: '1985-04-12', account_identifier: 'GB33BUKB20201555555555', account_holder: 'Nightly Seller',
}

/** The ISO week `at` falls in, UTC, as Lens names a payout's period: 2026-W41. */
export function isoWeek(at: Date): string {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const year = d.getUTCFullYear()
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / 86_400e3 + 1) / 7)
  return `${year}-W${String(week).padStart(2, '0')}`
}

/**
 * What is wrong with a buyer's tax on its rent, on the fixture rows: undefined when nothing. The GB consumer's line may be
 * not_registered at 0 on a Lens holding no GB registration; any other treatment, rate or amount is wrong.
 */
export function taxFault(b: Buyer, l: BillLine): string | undefined {
  const got = `${l.tax_treatment ?? '(none)'} at ${l.tax_rate_bps ?? '?'} bps, ${l.tax_usd_micros ?? '?'} µUSD in ${l.tax_jurisdiction ?? '?'}`
  if (l.tax_jurisdiction !== b.country) return `${b.who}'s tax is ${got}: its jurisdiction is ${b.country}`
  if (b.country === 'GB') {
    if (l.tax_treatment === 'standard' && l.tax_rate_bps === GB_RATE_BPS && l.tax_usd_micros === GB_TAX_USD_MICROS) return undefined
    if (l.tax_treatment === 'not_registered' && l.tax_usd_micros === 0) return undefined
    return `${b.who}'s tax is ${got}: on the fixture rows it is standard at ${GB_RATE_BPS} bps, ${GB_TAX_USD_MICROS} µUSD (not_registered at 0 without a GB registration)`
  }
  if (b.business) {
    if (l.tax_treatment === 'reverse_charge' && l.tax_usd_micros === 0 && /^Reverse charge/.test(l.tax_note ?? '')) return undefined
    return `${b.who}, with a valid VAT number, is taxed ${got} with the note "${l.tax_note ?? ''}": it is reverse_charge at 0, the note naming the reverse charge`
  }
  if (l.tax_treatment === 'not_registered' && l.tax_usd_micros === 0) return undefined
  return `${b.who}'s tax is ${got}: Talyvor holds no ${b.country} registration, so it is not_registered at 0`
}

/** The lines of a statement by kind; a kind it does not have reads 0. */
const lineOf = (st: WeekStatement, kind: string): number => (st.lines ?? []).find((l) => l.kind === kind)?.amount_usd_micros ?? 0
const sumOf = (st: WeekStatement): number => (st.lines ?? []).reduce((s, l) => s + l.amount_usd_micros, 0)
const statementText = (st: WeekStatement): string =>
  `${st.period}: ${(st.lines ?? []).map((l) => `${l.kind} ${l.amount_usd_micros}`).join(', ')}; net ${st.net_usd_micros}; VAT collected ${st.vat_collected_usd_micros}; payout ${st.payout?.id ?? 'none'}`

export function taxAndPayouts(seed: number): Scenario {
  return {
    id: 'tax-and-payouts',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Marketplace',
    title: 'a GB consumer, a DE business with a valid VAT number and a US buyer each rent one listing: each bill line carries its tax ' +
      '(standard at 20%, reverse charged at 0, not registered at 0), each paid bill gets a receipt whose totals are its net plus its tax, ' +
      "and the seller's week shows the VAT collected; the seller, without tax details, is withheld from the payout run, completes them, " +
      'and the next run pays the three shares with a statement equal to its journal postings',
    run: async (ctx) => {
      const { env } = ctx
      const [seller, ...buyers] = await env.lens.createUsers(1 + BUYERS.length)
      const listing = await publishRent(ctx, seller, `Taxed ${seed}-${RUN_SALT}`)
      if (typeof listing === 'string') return fail(listing)

      // Each buyer declares itself and rents the listing; its line, once metered, carries its tax.
      const lines: BillLine[] = []
      for (const [n, b] of BUYERS.entries()) {
        const buyer = buyers[n]
        const put = await env.lens.act<TaxProfileAnswer>(buyer, 'PUT', '/v1/workspaces/{ws}/tax-profile', b.profile)
        ctx.evidence.push({ note: `${b.who} declares its tax profile`, answer: JSON.stringify(put) })
        if (!put.ok) return fail(`${b.who}'s tax profile was refused: ${put.status} ${put.error}`)
        const where = put.value.resolved
        if (where?.country !== b.country || where.business !== b.business) {
          return fail(`${b.who} declared ${b.country}${b.business ? ' with a valid VAT number' : ''}; Lens resolves it to ${JSON.stringify(where)}`)
        }
        const rented = await env.lens.act<MarketLicence>(buyer, 'POST', `/v1/workspaces/{ws}/marketplace/listings/${listing.id}/licences`, { offer_id: listing.rent },
          { 'Idempotency-Key': randomUUID() })
        ctx.evidence.push({ note: `${b.who} rents it for ${RENT_DAYS} days`, answer: JSON.stringify(rented) })
        if (!rented.ok) return fail(`${b.who}'s rent was refused: ${rented.status} ${rented.error}`)
        const bill = await until(() => env.lens.marketBill(buyer), (x) => (x.lines ?? []).some((l) => l.listing_id === listing.id && (l.tax_treatment ?? '') !== ''), METER_WAIT_MS)
        ctx.evidence.push({ note: `${b.who}'s bill`, answer: JSON.stringify(bill) })
        const mine = (bill.lines ?? []).filter((l) => l.listing_id === listing.id)
        if (mine.length !== 1 || mine[0].use_id !== rented.value.use_id || mine[0].price_ulxc !== RENT_ULXC) {
          return fail(`${b.who}'s rent should be one ${RENT_ULXC} µLXC line on its bill, the licence's use ${rented.value.use_id}; the bill holds ${JSON.stringify(mine)}`)
        }
        if ((mine[0].tax_treatment ?? '') === '') return fail(`${METER_WAIT_MS / 1000} s after ${b.who} rented it, its bill line carries no tax: ${JSON.stringify(mine[0])}`)
        const wrong = taxFault(b, mine[0]) ?? billTotalsFault(b, bill, mine[0])
        if (wrong !== undefined) return fail(wrong)
        lines.push(mine[0])
      }

      // Each bill paid, and Talyvor's receipt for it.
      for (const [n, b] of BUYERS.entries()) {
        const buyer = buyers[n]
        const line = lines[n]
        const paid = await until(() => env.lens.payTestBill(buyer), (x) => x.ok || x.status !== 409, METER_WAIT_MS)
        ctx.evidence.push({ note: `${b.who}'s bill paid now (B25.7)`, answer: JSON.stringify(paid) })
        if (!paid.ok) return fail(`paying ${b.who}'s bill was refused: ${paid.status} ${paid.error}`)
        if (paid.value.uses_cleared !== 1) return fail(`paying ${b.who}'s bill of one rent cleared ${paid.value.uses_cleared} uses`)
        const listed = await env.lens.act<{ receipts: { id: string; invoice_id: string }[] | null }>(buyer, 'GET', '/v1/workspaces/{ws}/marketplace/receipts')
        const ours = listed.ok ? (listed.value.receipts ?? []).filter((r) => r.invoice_id === paid.value.invoice_id) : []
        if (ours.length !== 1) return fail(`${b.who}'s paid bill ${paid.value.invoice_id} should have one receipt; Lens lists ${listed.ok ? JSON.stringify(listed.value.receipts) : `${listed.status} ${listed.error}`}`)
        const got = await env.lens.act<MarketReceipt>(buyer, 'GET', `/v1/workspaces/{ws}/marketplace/receipts/${ours[0].id}`)
        ctx.evidence.push({ note: `${b.who}'s receipt`, answer: JSON.stringify(got) })
        if (!got.ok) return fail(`reading ${b.who}'s receipt ${ours[0].id}: ${got.status} ${got.error}`)
        const wrong = receiptFault(b, got.value, line)
        if (wrong !== undefined) return fail(wrong)
      }

      // The seller's shares released, and the week's statement before any payout: the VAT collected is the tax the buyers were billed.
      const take = env.fees.market_take_bps
      const share = keptOf(RENT_USD_MICROS, take)
      const owed = share * BUYERS.length
      const taxed = lines.reduce((s, l) => s + (l.tax_usd_micros ?? 0), 0)
      const j = await until(() => env.lens.marketJournal(seller), (x) => x.holdback_usd_micros === 0 && x.available_usd_micros === owed, RELEASE_WAIT_MS)
      ctx.evidence.push({ note: `the seller's journal: ${JSON.stringify(j)}` })
      if (j.holdback_usd_micros !== 0 || j.available_usd_micros !== owed || !j.reconciled) {
        return fail(`${RELEASE_WAIT_MS / 60_000} minutes after the three bills were paid, the seller's journal should hold the three ${share} µUSD shares available (${owed}) and reconcile; it reads ${JSON.stringify(j)}`)
      }
      const week = isoWeek(new Date())
      const before = await statement(ctx, seller, week)
      if (typeof before === 'string') return fail(before)
      const salesFault = weekFault(before, owed, taxed)
      if (salesFault !== undefined) return fail(`before any payout, ${salesFault}`)
      if (before.payout !== null || before.net_usd_micros !== 0 || lineOf(before, 'carried_forward') !== -owed) {
        return fail(`before any payout the seller's week should pay nothing and carry the ${owed} µUSD forward; it reads ${statementText(before)}`)
      }
      const taxHalf = `${BUYERS.map((b, n) => `${b.who} ${lines[n].tax_treatment} at ${lines[n].tax_usd_micros} µUSD`).join(', ')}; ` +
        `each paid bill's receipt is its line, gross = net + tax${lines[1].tax_treatment === 'reverse_charge' ? ', the DE business\'s reverse charged' : ''}; ` +
        `the seller's week: 3 sales, ${owed} µUSD released, ${before.vat_collected_usd_micros} µUSD VAT collected`

      // The payout run withholds the seller without tax details, and pays them once they are complete.
      const t0 = await env.lens.act<SellerTax>(seller, 'GET', '/v1/workspaces/{ws}/marketplace/seller-tax')
      ctx.evidence.push({ note: "the seller's tax details, before giving any", answer: JSON.stringify(t0) })
      if (!t0.ok) return fail(`reading the seller's tax details: ${t0.status} ${t0.error}`)
      if (!t0.value.accepting) throw new CannotTest(`the tax half passed (${taxHalf}), but this Lens cannot store a seller's tax details, so it withholds nobody: it has no LENS_PROVIDER_SECRET_KEK`)
      if (t0.value.complete) return fail(`a new seller who gave no tax details reads complete: ${JSON.stringify(t0.value)}`)
      const run1 = await env.lens.syntheticPayoutRun(seller)
      ctx.evidence.push({ note: 'the payout run, brought to the seller now, its tax reminders due', answer: JSON.stringify(run1) })
      if (!run1.ok && (run1.status === 404 || run1.status === 405)) {
        throw new CannotTest(`the tax half passed (${taxHalf}), but this Lens has no synthetic payout run (POST /v1/synthetic/workspaces/{ws}/marketplace/payouts/run, talyvor-lens B32.99): ${run1.status}`)
      }
      if (!run1.ok) return fail(`the payout run for the seller was refused: ${run1.status} ${run1.error}`)
      const t1 = await env.lens.act<SellerTax>(seller, 'GET', '/v1/workspaces/{ws}/marketplace/seller-tax')
      const p1 = await env.lens.payouts(seller)
      const j1 = await env.lens.marketJournal(seller)
      ctx.evidence.push({ note: `withheld? the seller's tax details ${JSON.stringify(t1)}; payouts ${JSON.stringify(p1.payouts)}; journal ${JSON.stringify(j1)}` })
      if (!run1.value.withheld || run1.value.payout !== null || (t1.ok && (t1.value.withheld_since ?? '') === '') || (p1.payouts ?? []).length > 0 || j1.available_usd_micros !== owed) {
        return fail(`the seller gave no tax details, so the payout run must withhold them and move nothing; it answered ${JSON.stringify(run1.value)}, ` +
          `their details read withheld since ${t1.ok ? t1.value.withheld_since ?? 'never' : t1.error}, they have ${(p1.payouts ?? []).length} payout(s) and ${j1.available_usd_micros} µUSD available (want ${owed})`)
      }

      const done = await env.lens.act<SellerTax>(seller, 'PUT', '/v1/workspaces/{ws}/marketplace/seller-tax', SELLER_DETAILS)
      ctx.evidence.push({ note: 'the seller completes their tax details', answer: JSON.stringify(done) })
      if (!done.ok) return fail(`the seller's tax details were refused: ${done.status} ${done.error}`)
      if (!done.value.complete || (done.value.missing ?? []).length > 0 || (done.value.withheld_since ?? '') !== '') {
        return fail(`completed, the seller's tax details read ${JSON.stringify(done.value)}: complete, nothing missing and no longer withheld`)
      }
      const run2 = await env.lens.syntheticPayoutRun(seller)
      ctx.evidence.push({ note: 'the next payout run', answer: JSON.stringify(run2) })
      if (!run2.ok) return fail(`the next payout run for the seller was refused: ${run2.status} ${run2.error}`)
      const paid = run2.value.payout
      if (run2.value.withheld || paid === null) return fail(`their details complete, the next payout run should pay the seller's ${owed} µUSD; it answered ${JSON.stringify(run2.value)}`)
      const wrongPayout = payoutFault(paid, owed, week)
      if (wrongPayout !== undefined) return fail(wrongPayout)
      const listedPayout = ((await env.lens.payouts(seller)).payouts ?? []) as unknown as WeeklyPayout[]
      const j2 = await env.lens.marketJournal(seller)
      ctx.evidence.push({ note: `paid: payouts ${JSON.stringify(listedPayout)}; journal ${JSON.stringify(j2)}` })
      if (listedPayout.length !== 1 || listedPayout[0].id !== paid.id) return fail(`paid once, the seller's payouts list ${JSON.stringify(listedPayout)}, not the run's ${paid.id}`)
      if (j1.available_usd_micros - j2.available_usd_micros !== paid.gross_usd_micros || j2.available_usd_micros !== 0 || !j2.reconciled) {
        return fail(`the ${paid.gross_usd_micros} µUSD payout should take exactly that from the journal's available, ${j1.available_usd_micros} → 0, and it reconcile; it reads ${JSON.stringify(j2)}`)
      }
      const after = await statement(ctx, seller, week)
      if (typeof after === 'string') return fail(after)
      const listedWeeks = await env.lens.act<{ statements: { period: string; payout_id: string; net_usd_micros: number }[] | null }>(seller, 'GET', '/v1/workspaces/{ws}/marketplace/statements')
      const weekRow = listedWeeks.ok ? (listedWeeks.value.statements ?? []).find((s) => s.period === week) : undefined
      const wrongWeek = weekFault(after, owed, taxed) ??
        (after.payout?.id !== paid.id ? `the week's statement names payout ${after.payout?.id ?? 'none'}, not ${paid.id}` : undefined) ??
        (after.net_usd_micros !== paid.net_usd_micros || sumOf(after) !== after.net_usd_micros ? `the week's lines sum to ${sumOf(after)} and its net is ${after.net_usd_micros}; the payout paid ${paid.net_usd_micros}` : undefined) ??
        (lineOf(after, 'stripe_fees') !== -(paid.account_fee_usd_micros + paid.payout_fee_usd_micros) ? `the week's Stripe fees are ${lineOf(after, 'stripe_fees')}; the payout's are ${paid.account_fee_usd_micros} + ${paid.payout_fee_usd_micros}` : undefined) ??
        (lineOf(after, 'carried_forward') !== 0 ? `paid, the week still carries ${lineOf(after, 'carried_forward')} forward` : undefined) ??
        (weekRow?.payout_id !== paid.id || weekRow.net_usd_micros !== paid.net_usd_micros ? `the seller's list of statements reads ${JSON.stringify(listedWeeks)} for ${week}` : undefined)
      if (wrongWeek !== undefined) return fail(`paid, ${wrongWeek}: ${statementText(after)}`)
      return { pass: true, detail: `${taxHalf}; the seller, with no tax details, was withheld by the payout run with nothing moved; completed, the next run paid ` +
        `${paid.id}: ${paid.gross_usd_micros} µUSD gross, ${paid.net_usd_micros} net after Stripe's ${paid.account_fee_usd_micros} + ${paid.payout_fee_usd_micros}, the journal's available ${owed} → 0, ` +
        `and the week's statement names it, its lines summing to its net` }
    },
  }
}

/** The seller publishes the listing with its per-use and rent offers, approved if the review holds it: its id and the rent's offer id. */
async function publishRent(ctx: ScenarioCtx, seller: SyntheticUser, title: string): Promise<{ id: string; rent: string } | string> {
  const { env } = ctx
  const model = env.catalog[0]
  if (model === undefined) throw new Error('the catalog has no model')
  const offers: MarketOffer[] = [{ kind: 'per_use', licence: 'commercial', price_usd_micros: PER_USE_USD_MICROS },
    { kind: 'rent', licence: 'commercial', price_usd_micros: RENT_USD_MICROS, period_days: RENT_DAYS }]
  const pub = await env.lens.act<Listing>(seller, 'POST', '/v1/workspaces/{ws}/marketplace/listings', { kind: 'prompt', title, description: '', visibility: 'public',
    artifact: { template: 'Summarise {{text}} in one line.', model: model.id }, changelog: '', offers })
  ctx.evidence.push({ note: `the seller publishes "${title}" with a $10.00 ${RENT_DAYS}-day commercial rent`, answer: JSON.stringify(pub) })
  if (!pub.ok) return `publishing "${title}" was refused: ${pub.status} ${pub.error}`
  if (pub.value.review_status !== 'approved') {
    if (!env.lens.canModerate) throw new CannotTest(`the listing was ${pub.value.review_status}, and approving it needs a moderator key: LENS_MODERATOR_KEY, from \`lens moderator-keys create\``)
    const ok = await env.lens.moderate(pub.value.id, 'approve')
    if (!ok.ok) return `approving the held listing ${pub.value.id}: ${ok.status} ${ok.error}`
  }
  const read = await env.lens.act<{ offers: MarketOffer[] | null }>(seller, 'GET', `/v1/marketplace/listings/${pub.value.id}`)
  const rent = read.ok ? (read.value.offers ?? []).find((o) => o.kind === 'rent' && o.licence === 'commercial')?.id : undefined
  if (rent === undefined) return `the listing's commercial rent offer cannot be read back: ${read.ok ? JSON.stringify(read.value.offers) : `${read.status} ${read.error}`}`
  return { id: pub.value.id, rent }
}

/** What is wrong with a buyer's bill's totals for its one rent: undefined when its net is the rent and its gross the net plus the tax. */
function billTotalsFault(b: Buyer, bill: MarketBill, l: BillLine): string | undefined {
  const tax = l.tax_usd_micros ?? 0
  if (bill.net_usd_micros === RENT_USD_MICROS && bill.tax_usd_micros === tax && bill.gross_usd_micros === RENT_USD_MICROS + tax) return undefined
  return `${b.who}'s bill reads net ${bill.net_usd_micros}, tax ${bill.tax_usd_micros}, gross ${bill.gross_usd_micros} µUSD; its one rent is net ${RENT_USD_MICROS}, tax ${tax}, gross ${RENT_USD_MICROS + tax}`
}

/** What is wrong with a buyer's receipt for its paid bill of one rent `l`: undefined when nothing. */
function receiptFault(b: Buyer, r: MarketReceipt, l: BillLine): string | undefined {
  const tax = l.tax_usd_micros ?? 0
  const lines = r.lines ?? []
  const one = lines[0]
  if (!/^TEST-\d{4}-\d{6}$/.test(r.number) || r.series !== 'test') return `${b.who}'s receipt is numbered ${r.number} in the ${r.series} series: a test bill's is TEST-<year>-NNNNNN`
  if (lines.length !== 1 || one.use_id !== l.use_id || one.net_usd_micros !== RENT_USD_MICROS || one.rate_bps !== (l.tax_rate_bps ?? 0) || one.tax_usd_micros !== tax) {
    return `${b.who}'s receipt should have one line, the rent ${l.use_id} at net ${RENT_USD_MICROS}, ${l.tax_rate_bps ?? 0} bps, tax ${tax}; it has ${JSON.stringify(lines)}`
  }
  if (r.net_usd_micros !== RENT_USD_MICROS || r.tax_usd_micros !== tax || r.gross_usd_micros !== RENT_USD_MICROS + tax || r.gross_cents * 10_000 !== r.gross_usd_micros) {
    return `${b.who}'s receipt totals net ${r.net_usd_micros}, tax ${r.tax_usd_micros}, gross ${r.gross_usd_micros} µUSD (${r.gross_cents}¢); its bill is net ${RENT_USD_MICROS}, tax ${tax}, gross ${RENT_USD_MICROS + tax}`
  }
  const noted = (r.notes ?? []).some((n) => /^Reverse charge/.test(n))
  if (r.reverse_charge !== b.business || noted !== b.business) {
    return `${b.who}'s receipt reads reverse_charge ${r.reverse_charge} with notes ${JSON.stringify(r.notes)}: ${b.business ? 'a business abroad with a valid VAT number is reverse charged, with the note' : 'only a business abroad is reverse charged'}`
  }
  return undefined
}

/** What is wrong with the seller's week's sales: the three rents' gross, Talyvor's fee on them, and the VAT the buyers were billed. */
function weekFault(st: WeekStatement, owed: number, taxed: number): string | undefined {
  const gross = RENT_USD_MICROS * BUYERS.length
  if (st.sales === BUYERS.length && lineOf(st, 'sales') === gross && lineOf(st, 'sales') + lineOf(st, 'talyvor_fee') === owed && st.vat_collected_usd_micros === taxed &&
    lineOf(st, 'brought_forward') === 0 && sumOf(st) === st.net_usd_micros) return undefined
  return `the seller's week should have ${BUYERS.length} sales of ${gross} µUSD less Talyvor's fee leaving the ${owed} the journal released, ${taxed} µUSD VAT collected, nothing brought forward, ` +
    `and lines summing to its net; it reads ${statementText(st)}`
}

/** What is wrong with the payout of the seller's `owed` µUSD in `week`: undefined when it is the whole of it, less Stripe's fees. */
function payoutFault(p: WeeklyPayout, owed: number, week: string): string | undefined {
  if (p.method === 'stripe' && p.period === week && p.gross_usd_micros === owed && p.net_usd_micros === p.gross_usd_micros + p.vat_usd_micros - p.account_fee_usd_micros - p.payout_fee_usd_micros &&
    p.net_usd_micros > 0) return undefined
  return `the payout should be ${owed} µUSD gross in ${week}, its net that less Stripe's fees; it reads ${JSON.stringify(p)}`
}

/** The seller's statement of `week`, or why it cannot be read. */
async function statement(ctx: ScenarioCtx, seller: SyntheticUser, week: string): Promise<WeekStatement | string> {
  const st = await ctx.env.lens.act<WeekStatement>(seller, 'GET', `/v1/workspaces/{ws}/marketplace/statements?period=${week}`)
  ctx.evidence.push({ note: `the seller's statement of ${week}`, answer: JSON.stringify(st) })
  return st.ok ? st.value : `reading the seller's statement of ${week}: ${st.status} ${st.error}`
}
