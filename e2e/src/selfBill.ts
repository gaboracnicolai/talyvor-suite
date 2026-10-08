// B32.97 — a self-billing seller's weekly statement carries its self-billed invoice (Lens B32.43), on Lens's API, once a run,
// on workspaces of its own.
//
// Two new sellers each publish a listing with a $30.00 30-day commercial rent and a new buyer rents both; the buyer's bill
// paid, Lens's release job releases each seller's share — $25.50 at a 15% take, over the $25 payout minimum. One seller saves
// complete tax details as a GB VAT-registered individual (GB123456789, a number the Test tax partner finds valid) who has
// agreed to self-billing (self_billing_agreed_version draft-2026-10, the agreement in talyvor-lens docs/terms/self-billing.md);
// the other saves the same details without the agreement. The save must keep the agreement and the number found valid.
// Not yet paid, the self-billing seller's statement of this week carries no invoice: there is no payout for it to bill.
//
// The weekly payout run is brought to each seller now with the synthetic key (talyvor-lens B32.99). The self-billing seller's
// newest paid week (GET …/marketplace/statements?period=) must carry its self-billed invoice: numbered TEST-SB-NNNNNN for
// test money, a preview, under the agreement it saved, from the seller (their name, GB, their VAT number) to TALYVOR LTD;
// its net the payout's gross, its VAT the payout's VAT and its gross their sum; the statement's supply_vat line that VAT, and
// its lines summing to its net, which is the payout's net. While LENS_SELF_BILLING_VAT is off — as it is in production until
// Talyvor's accountant confirms the treatment — the invoice is issued with vat_enabled false, treatment under_review, the
// note "VAT on your supply: under review" and no VAT, and the payout pays none: VAT paid while it is off FAILs. Turned on, a
// GB VAT-registered seller's invoice is standard at the GB rate, its VAT the net's to the cent. The other seller's paid week
// carries no invoice at all.
//
// A Lens that stores no seller's tax details (no LENS_PROVIDER_SECRET_KEK) or has no synthetic payout run pays these sellers
// nothing, so there is no invoice to read: the scenario says the seller has no payouts yet, after what it could check, rather
// than passing.

import { randomUUID } from 'node:crypto'
import { fail } from './bank.ts'
import { keptOf } from './fees.ts'
import type { MarketLicence, SellerTax, SyntheticUser, WeekStatement, WeeklyPayout } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario } from './scenarios.ts'
import { isoWeek, SELLER_DETAILS } from './taxPayouts.ts'
import { until } from './trade.ts'
import { METER_WAIT_MS, publishRent, read, RELEASE_WAIT_MS, RENT_USD_MICROS } from './weekStatement.ts'

/** The version of the self-billing agreement Lens publishes (talyvor-lens docs/terms/self-billing.md). */
const AGREEMENT_VERSION = 'draft-2026-10'
/** A well-formed GB VAT number not on the Test tax partner's list of numbers never issued: it finds it valid. */
const SELLER_VAT_NUMBER = 'GB123456789'
/** What a self-billed invoice and its statement say of the seller's VAT while LENS_SELF_BILLING_VAT is off (Lens market.VATUnderReview). */
const VAT_UNDER_REVIEW = 'VAT on your supply: under review'
/** Talyvor, the customer a self-billing seller supplies: LENS_SUPPLIER_LEGAL_NAME's default. */
const CUSTOMER = 'TALYVOR LTD'
/** The GB rate on the Test tax partner's fixture rows. */
const GB_RATE_BPS = 2000
const USD_MICROS_PER_CENT = 10_000

/** Lens market.StatementSummary: one week the seller was paid in. */
interface StatementRow {
  period: string
  payout_id: string
  net_usd_micros: number
}

const sumOf = (st: WeekStatement): number => (st.lines ?? []).reduce((s, l) => s + l.amount_usd_micros, 0)
const linesText = (st: WeekStatement): string => (st.lines ?? []).map((l) => `${l.kind} ${l.amount_usd_micros}`).join(', ')

/** The VAT on `net` at `bps`, half-up to the cent, as Lens pays it with a payout. */
export const vatToTheCent = (net: number, bps: number): number => Math.floor((Math.floor((net * bps + 5_000) / 10_000) + USD_MICROS_PER_CENT / 2) / USD_MICROS_PER_CENT) * USD_MICROS_PER_CENT

/**
 * What is wrong with a self-billing seller's paid week, judged against the payout run's `paid`: undefined when nothing. Its
 * statement carries the invoice for that payout, whose figures are the payout's, and the supply_vat line is the invoice's VAT,
 * the lines summing to the payout's net; under review, no VAT anywhere.
 */
export function selfBillFault(st: WeekStatement, paid: WeeklyPayout, seller: { name: string; country: string }): string | undefined {
  const inv = st.self_billed_invoice
  if (inv === null || inv === undefined) return `the seller agreed to self-billing (${AGREEMENT_VERSION}) and was paid ${paid.id} in ${st.period}, but the statement of ${st.period} carries no self-billed invoice`
  if (inv.payout_id !== paid.id || inv.period !== st.period) return `the self-billed invoice ${inv.number} of ${st.period} bills payout ${inv.payout_id} of ${inv.period}, not ${paid.id} of ${st.period}`
  if (inv.net_usd_micros !== paid.gross_usd_micros || inv.vat_usd_micros !== paid.vat_usd_micros || inv.gross_usd_micros !== inv.net_usd_micros + inv.vat_usd_micros) {
    return `the self-billed invoice ${inv.number} must be net the payout's gross ${paid.gross_usd_micros}, VAT the payout's ${paid.vat_usd_micros} and gross their sum; ` +
      `it reads net ${inv.net_usd_micros}, VAT ${inv.vat_usd_micros}, gross ${inv.gross_usd_micros}`
  }
  const supplyVAT = (st.lines ?? []).find((l) => l.kind === 'supply_vat')
  if (supplyVAT?.amount_usd_micros !== inv.vat_usd_micros) return `the statement of ${st.period} must carry the invoice's ${inv.vat_usd_micros} µUSD of VAT as its supply_vat line; its lines are ${linesText(st)}`
  if (sumOf(st) !== st.net_usd_micros || st.net_usd_micros !== paid.net_usd_micros) {
    return `the lines of ${st.period} sum to ${sumOf(st)}, its net is ${st.net_usd_micros} and the payout's ${paid.net_usd_micros}; all three must be one figure: ${linesText(st)}`
  }
  if (!inv.vat_enabled) {
    if (inv.vat_usd_micros !== 0 || paid.vat_usd_micros !== 0) {
      return `self-billing VAT is under review (vat_enabled false), so no VAT is paid; the invoice ${inv.number} charges ${inv.vat_usd_micros} µUSD and the payout ${paid.id} paid ${paid.vat_usd_micros}`
    }
    if (inv.treatment !== 'under_review' || inv.note !== VAT_UNDER_REVIEW || supplyVAT.label !== VAT_UNDER_REVIEW) {
      return `under review, the invoice ${inv.number} must read treatment under_review with the note "${VAT_UNDER_REVIEW}", and so must its statement line; ` +
        `it reads ${inv.treatment}, "${inv.note}", the line "${supplyVAT.label}"`
    }
  } else {
    const due = vatToTheCent(inv.net_usd_micros, GB_RATE_BPS)
    if (inv.treatment !== 'standard' || inv.rate_bps !== GB_RATE_BPS || inv.jurisdiction !== 'GB' || inv.vat_usd_micros !== due) {
      return `with self-billing VAT on, a GB VAT-registered seller's supply is standard at ${GB_RATE_BPS} bps in GB, ${due} µUSD on ${inv.net_usd_micros}; ` +
        `the invoice ${inv.number} reads ${inv.treatment} at ${inv.rate_bps} bps in ${inv.jurisdiction}, ${inv.vat_usd_micros} µUSD`
    }
  }
  if (!/^TEST-SB-\d{6}$/.test(inv.number) || !inv.preview) return `a self-billed invoice for test money is numbered TEST-SB-NNNNNN and a preview; it reads ${inv.number}, preview ${inv.preview}`
  const { supplier, customer } = inv
  if (inv.agreement_version !== AGREEMENT_VERSION || supplier.name !== seller.name || supplier.country !== seller.country || supplier.vat_number !== SELLER_VAT_NUMBER || customer.name !== CUSTOMER) {
    return `the invoice ${inv.number} must be under the agreement ${AGREEMENT_VERSION}, from ${seller.name} (${seller.country}, ${SELLER_VAT_NUMBER}) to ${CUSTOMER}; ` +
      `it reads ${inv.agreement_version}, from ${supplier.name} (${supplier.country}, ${supplier.vat_number || 'no VAT number'}) to ${customer.name}`
  }
  return undefined
}

export function selfBilledInvoice(seed: number): Scenario {
  return {
    id: 'self-billed-invoice',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Marketplace',
    title: "a self-billing seller's paid week carries its self-billed invoice to TALYVOR LTD, its net the payout's gross and its VAT the " +
      "payout's, the supply_vat line that VAT and the lines summing to the payout's net; no VAT while self-billing VAT is under review; " +
      'a seller without the agreement gets none',
    run: async (ctx) => {
      const { env } = ctx
      const [biller, plain, buyer] = await env.lens.createUsers(3)
      const listings: { id: string; rent: string }[] = []
      for (const seller of [biller, plain]) {
        const l = await publishRent(ctx, seller, `Self-billed week ${seed}-${RUN_SALT}-${listings.length}`)
        if (typeof l === 'string') return fail(l)
        listings.push(l)
      }

      // The buyer rents both, its bill is paid, and each seller's share released.
      for (const l of listings) {
        const rented = await env.lens.act<MarketLicence>(buyer, 'POST', `/v1/workspaces/{ws}/marketplace/listings/${l.id}/licences`, { offer_id: l.rent },
          { 'Idempotency-Key': randomUUID() })
        ctx.evidence.push({ note: `the buyer rents ${l.id}`, answer: said(rented) })
        if (!rented.ok) return fail(`the buyer's rent of ${l.id} was refused: ${said(rented)}`)
      }
      const paidBill = await until(() => env.lens.payTestBill(buyer), (x) => x.ok || x.status !== 409, METER_WAIT_MS)
      ctx.evidence.push({ note: "the buyer's bill paid now (B25.7)", answer: said(paidBill) })
      if (!paidBill.ok || paidBill.value.uses_cleared !== 2) return fail(`paying the buyer's bill of two rents should clear both: ${said(paidBill)}`)
      const share = keptOf(RENT_USD_MICROS, env.fees.market_take_bps)
      for (const seller of [biller, plain]) {
        const j = await until(() => env.lens.marketJournal(seller), (x) => x.holdback_usd_micros === 0 && x.available_usd_micros === share, RELEASE_WAIT_MS)
        ctx.evidence.push({ note: `the journal of seller ${seller.workspaceID}: ${JSON.stringify(j)}` })
        if (j.available_usd_micros !== share) return fail(`${RELEASE_WAIT_MS / 60_000} minutes after the bill was paid, seller ${seller.workspaceID}'s ${share} µUSD share should be available; the journal reads ${JSON.stringify(j)}`)
      }

      // One seller agrees to self-billing as a GB VAT-registered individual; the other gives the same details without it.
      const agreed = await env.lens.act<SellerTax & { self_billing_agreed_version: string; vat_valid: boolean }>(biller, 'PUT', '/v1/workspaces/{ws}/marketplace/seller-tax',
        { ...SELLER_DETAILS, vat_number: SELLER_VAT_NUMBER, self_billing_agreed_version: AGREEMENT_VERSION })
      ctx.evidence.push({ note: `the self-billing seller saves their details, VAT number ${SELLER_VAT_NUMBER} and the agreement ${AGREEMENT_VERSION}`, answer: said(agreed) })
      if (!agreed.ok && agreed.status === 503) throw new CannotTest("this Lens stores no seller's tax details (no LENS_PROVIDER_SECRET_KEK), so it pays no seller: the sellers have no payouts yet, and no self-billed invoice to read")
      if (!agreed.ok || !agreed.value.complete || agreed.value.self_billing_agreed_version !== AGREEMENT_VERSION || !agreed.value.vat_valid) {
        return fail(`a GB individual's complete details with VAT number ${SELLER_VAT_NUMBER} and the self-billing agreement should be saved complete, the number valid and the agreement ${AGREEMENT_VERSION} kept: ${said(agreed)}`)
      }
      const details = await env.lens.act<SellerTax>(plain, 'PUT', '/v1/workspaces/{ws}/marketplace/seller-tax', SELLER_DETAILS)
      ctx.evidence.push({ note: 'the other seller saves the same details without the agreement', answer: said(details) })
      if (!details.ok || !details.value.complete) return fail(`the other seller's complete tax details should be saved complete: ${said(details)}`)
      const week = isoWeek(new Date())
      const st0 = await read<WeekStatement>(ctx, biller, `the self-billing seller's statement of ${week}, not yet paid`, `/marketplace/statements?period=${week}`)
      if (typeof st0 === 'string') return fail(st0)
      if (st0.payout !== null || st0.self_billed_invoice !== null) return fail(`not yet paid, the self-billing seller's statement of ${week} should carry no payout and no invoice; it reads payout ${JSON.stringify(st0.payout)}, invoice ${JSON.stringify(st0.self_billed_invoice)}`)
      const saved = `the agreement ${AGREEMENT_VERSION} and VAT number ${SELLER_VAT_NUMBER} were saved and kept, and the unpaid ${week} carried no invoice`

      // Paid by the payout run, brought to each seller now.
      const payOut = async (seller: SyntheticUser, who: string): Promise<WeeklyPayout | string> => {
        const run = await env.lens.syntheticPayoutRun(seller)
        ctx.evidence.push({ note: `the payout run, brought to ${who} now`, answer: said(run) })
        if (!run.ok && (run.status === 404 || run.status === 405)) {
          throw new CannotTest(`${saved}; but this Lens has no synthetic payout run (POST /v1/synthetic/workspaces/{ws}/marketplace/payouts/run, talyvor-lens B32.99): the sellers have no payouts yet, and no self-billed invoice to read`)
        }
        if (!run.ok) return `the payout run for ${who} was refused: ${said(run)}`
        if (run.value.withheld || run.value.payout === null) return `with ${share} µUSD available and their tax details complete, the payout run should pay ${who}; it answered ${JSON.stringify(run.value)}`
        return run.value.payout
      }
      const newestWeek = async (seller: SyntheticUser, who: string, paid: WeeklyPayout): Promise<WeekStatement | string> => {
        const list = await read<{ statements: StatementRow[] | null }>(ctx, seller, `${who}'s list of statements, paid`, '/marketplace/statements')
        if (typeof list === 'string') return list
        const newest = (list.statements ?? [])[0]
        if (newest?.payout_id !== paid.id) return `paid ${paid.id}, ${who}'s list of statements should start with the week naming it; it reads ${JSON.stringify(list.statements)}`
        return read<WeekStatement>(ctx, seller, `${who}'s statement of ${newest.period}, the newest`, `/marketplace/statements?period=${newest.period}`)
      }
      const billerName = `${SELLER_DETAILS.first_name} ${SELLER_DETAILS.last_name}`
      const paid = await payOut(biller, 'the self-billing seller')
      if (typeof paid === 'string') return fail(paid)
      const st1 = await newestWeek(biller, 'the self-billing seller', paid)
      if (typeof st1 === 'string') return fail(st1)
      const wrong = selfBillFault(st1, paid, { name: billerName, country: SELLER_DETAILS.country })
      if (wrong !== undefined) return fail(wrong)

      const paidPlain = await payOut(plain, 'the seller without the agreement')
      if (typeof paidPlain === 'string') return fail(paidPlain)
      const st2 = await newestWeek(plain, 'the seller without the agreement', paidPlain)
      if (typeof st2 === 'string') return fail(st2)
      if (st2.self_billed_invoice !== null) return fail(`the seller without the agreement was paid ${paidPlain.id}, and its statement of ${st2.period} carries a self-billed invoice: ${JSON.stringify(st2.self_billed_invoice)}`)

      const inv = st1.self_billed_invoice
      if (inv === null) return fail(`the statement of ${st1.period} lost its invoice`)
      return {
        pass: true,
        detail: `${saved}; paid ${paid.id} (${paid.gross_usd_micros} µUSD gross, ${paid.vat_usd_micros} VAT, ${paid.net_usd_micros} net), ${st1.period} carried ${inv.number} ` +
          `from ${inv.supplier.name} to ${inv.customer.name}: net ${inv.net_usd_micros}, VAT ${inv.vat_usd_micros} (${inv.vat_enabled ? `${inv.treatment} at ${inv.rate_bps} bps` : inv.treatment}), ` +
          `gross ${inv.gross_usd_micros}, the lines summing to the payout's net; the seller without the agreement, paid ${paidPlain.id}, had none`,
      }
    },
  }
}
