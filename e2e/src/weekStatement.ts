// B32.96 — a seller's weekly statement sums to its payout (Lens B32.42), on Lens's API, once a run, on workspaces of its own.
//
// A new seller publishes a listing with a $30.00 30-day commercial rent and a new buyer rents it; the buyer's bill paid,
// Lens's release job releases the seller's share — $25.50 at a 15% take, over the $25 payout minimum.
//
// Not yet paid, the seller reads with its owner's key: its payout page (GET …/marketplace/payouts) not paid this week and
// with no payouts; its list of statements (GET …/marketplace/statements) empty; and this week's statement (?period=) with
// no payout and net 0 — the sale, Talyvor's fee and the share carried forward, its lines summing to that 0. ?period=2026-W54
// is 400 (2026 has 53 ISO weeks), and the seller's agent key — neither its owner nor an admin — is refused 403 the list and
// the week.
//
// The seller completes its tax details and the weekly payout run is brought to it now with the synthetic key (talyvor-lens
// B32.99). Paid, the payout page reads paid this week and lists the payout in this week's period; the list of statements,
// newest first, starts with this week, naming the payout and its net; and the newest week's statement names the payout,
// its lines summing to its net, which is the listed net and the payout's, its Stripe fees the payout's account and payout
// fees. The agent key is refused that week too.
//
// A Lens that stores no seller's tax details (no LENS_PROVIDER_SECRET_KEK) or has no synthetic payout run pays this seller
// nothing, so it has no paid week to read: the scenario says so, after the unpaid half has passed, rather than passing.

import { randomUUID } from 'node:crypto'
import { fail } from './bank.ts'
import { keptOf } from './fees.ts'
import type { Answered, Listing, MarketLicence, MarketOffer, SellerTax, SyntheticUser, WeekStatement, WeeklyPayout } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario, type ScenarioCtx } from './scenarios.ts'
import { isoWeek, SELLER_DETAILS } from './taxPayouts.ts'
import { until } from './trade.ts'

/** The rent: $30.00 for 30 days, µUSD — the seller's share is over the $25 payout minimum. */
export const RENT_USD_MICROS = 30_000_000
const RENT_DAYS = 30
/** The listing's per-use offer, beside the rent: no buyer uses it. */
const PER_USE_USD_MICROS = 100_000
/** Lens meters a billed use within a minute; the bill cannot be paid before. */
export const METER_WAIT_MS = 90_000
/** Lens's release job runs every 5 minutes. */
export const RELEASE_WAIT_MS = 360_000
/** A week no year has: ISO years have 52 or 53 weeks. */
const NO_SUCH_WEEK = '2026-W54'

/** Lens market.Payouts, as much of it as this scenario reads. */
interface PayoutPage {
  paid_this_week: boolean
  payouts: WeeklyPayout[] | null
}

/** Lens market.StatementSummary: one week the seller was paid in. */
interface StatementRow {
  period: string
  payout_id: string
  net_usd_micros: number
  paid_at: string | null
}

const lineOf = (st: WeekStatement, kind: string): number => (st.lines ?? []).find((l) => l.kind === kind)?.amount_usd_micros ?? 0
const sumOf = (st: WeekStatement): number => (st.lines ?? []).reduce((s, l) => s + l.amount_usd_micros, 0)
const statementText = (st: WeekStatement): string =>
  `${st.period}: ${(st.lines ?? []).map((l) => `${l.kind} ${l.amount_usd_micros}`).join(', ')}; net ${st.net_usd_micros}; payout ${st.payout === null ? 'none' : `${st.payout.id} net ${st.payout.net_usd_micros}`}`

/**
 * What is wrong with the newest paid week, judged against the payout run's `paid`: undefined when nothing. Its statement
 * names the payout, its lines sum to its net, and that net is the listed row's, the payout page's and the payout's; its
 * Stripe fees are the payout's.
 */
export function paidWeekFault(st: WeekStatement, row: StatementRow, listed: WeeklyPayout, paid: WeeklyPayout): string | undefined {
  if (st.payout?.id !== paid.id) return `the statement of ${st.period} names payout ${st.payout?.id ?? 'none'}, not the ${paid.id} the payout run made`
  if (sumOf(st) !== st.net_usd_micros) return `the lines of ${st.period} sum to ${sumOf(st)}, and its net is ${st.net_usd_micros}: ${statementText(st)}`
  const nets = [st.net_usd_micros, st.payout.net_usd_micros, row.net_usd_micros, listed.net_usd_micros]
  if (nets.some((n) => n !== paid.net_usd_micros)) {
    return `the net of ${st.period} must be the payout's ${paid.net_usd_micros} µUSD everywhere it is read; the statement reads ${st.net_usd_micros}, its payout ` +
      `${st.payout.net_usd_micros}, the list of statements ${row.net_usd_micros} and the payout page ${listed.net_usd_micros}`
  }
  const fees = -(paid.account_fee_usd_micros + paid.payout_fee_usd_micros)
  if (lineOf(st, 'stripe_fees') !== fees) return `the Stripe fees of ${st.period} read ${lineOf(st, 'stripe_fees')}; the payout's are −(${paid.account_fee_usd_micros} + ${paid.payout_fee_usd_micros}) = ${fees}`
  return undefined
}

export function sellerWeekStatement(seed: number): Scenario {
  return {
    id: 'seller-week-statement',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Marketplace',
    title: "a seller's weekly statement: before a payout, this week's lines sum to a net of 0 with no payout, an unknown week is 400 and the " +
      "seller's agent key is 403; paid by the payout run, the newest week's lines sum to its net, which is the listed net and the payout's, " +
      "its Stripe fees the payout's",
    run: async (ctx) => {
      const { env } = ctx
      const [seller, buyer] = await env.lens.createUsers(2)
      const listing = await publishRent(ctx, seller, `Weekly statement ${seed}-${RUN_SALT}`)
      if (typeof listing === 'string') return fail(listing)

      // The buyer rents it, its bill is paid, and the seller's share released.
      const rented = await env.lens.act<MarketLicence>(buyer, 'POST', `/v1/workspaces/{ws}/marketplace/listings/${listing.id}/licences`, { offer_id: listing.rent },
        { 'Idempotency-Key': randomUUID() })
      ctx.evidence.push({ note: `the buyer rents it for ${RENT_DAYS} days`, answer: said(rented) })
      if (!rented.ok) return fail(`the buyer's rent was refused: ${said(rented)}`)
      const paidBill = await until(() => env.lens.payTestBill(buyer), (x) => x.ok || x.status !== 409, METER_WAIT_MS)
      ctx.evidence.push({ note: "the buyer's bill paid now (B25.7)", answer: said(paidBill) })
      if (!paidBill.ok || paidBill.value.uses_cleared !== 1) return fail(`paying the buyer's bill of one rent should clear it: ${said(paidBill)}`)
      const share = keptOf(RENT_USD_MICROS, env.fees.market_take_bps)
      const j = await until(() => env.lens.marketJournal(seller), (x) => x.holdback_usd_micros === 0 && x.available_usd_micros === share, RELEASE_WAIT_MS)
      ctx.evidence.push({ note: `the seller's journal: ${JSON.stringify(j)}` })
      if (j.available_usd_micros !== share) return fail(`${RELEASE_WAIT_MS / 60_000} minutes after the bill was paid, the seller's ${share} µUSD share should be available; the journal reads ${JSON.stringify(j)}`)

      // Not yet paid: no payout anywhere, and this week's lines sum to a net of 0.
      const week = isoWeek(new Date())
      const page0 = await read<PayoutPage>(ctx, seller, 'the payout page, not yet paid', '/marketplace/payouts')
      if (typeof page0 === 'string') return fail(page0)
      if (page0.paid_this_week || (page0.payouts ?? []).length > 0) return fail(`a seller never paid reads paid_this_week ${page0.paid_this_week} with payouts ${JSON.stringify(page0.payouts)}`)
      const list0 = await read<{ statements: StatementRow[] | null }>(ctx, seller, 'the list of statements, not yet paid', '/marketplace/statements')
      if (typeof list0 === 'string') return fail(list0)
      if ((list0.statements ?? []).length > 0) return fail(`a seller never paid lists statements of paid weeks: ${JSON.stringify(list0.statements)}`)
      const st0 = await read<WeekStatement>(ctx, seller, `the statement of ${week}, not yet paid`, `/marketplace/statements?period=${week}`)
      if (typeof st0 === 'string') return fail(st0)
      if (st0.payout !== null || st0.net_usd_micros !== 0 || sumOf(st0) !== 0) {
        return fail(`not yet paid this week, the seller's statement of ${week} should name no payout and its lines sum to a net of 0; it reads ${statementText(st0)}`)
      }
      if (st0.sales !== 1 || lineOf(st0, 'sales') !== RENT_USD_MICROS || lineOf(st0, 'carried_forward') !== -share) {
        return fail(`the seller's statement of ${week} should hold the one ${RENT_USD_MICROS} µUSD sale released this week and carry its ${share} µUSD share forward; it reads ${st0.sales} sale(s), ${statementText(st0)}`)
      }

      // A week no year has, and a key that is neither the owner nor an admin.
      const nowhere = await env.lens.act<WeekStatement>(seller, 'GET', `/v1/workspaces/{ws}/marketplace/statements?period=${NO_SUCH_WEEK}`)
      ctx.evidence.push({ note: `the statement of ${NO_SUCH_WEEK}`, answer: said(nowhere) })
      if (nowhere.status !== 400) return fail(`no year has a week 54, so ?period=${NO_SUCH_WEEK} must be 400; Lens answered ${said(nowhere)}`)
      const agent = await env.lens.createAgent(seller, `Statement reader ${RUN_SALT}`)
      const key = await env.lens.act<{ key: string }>(seller, 'POST', `/v1/workspaces/{ws}/agents/${agent.id}/keys`, { name: 'seller-week-statement' })
      if (!key.ok) return fail(`issuing ${agent.name} a key was refused: ${said(key)}`)
      const refusedAt = async (period: string | undefined): Promise<string | undefined> => {
        const path = `/v1/workspaces/${seller.workspaceID}/marketplace/statements${period === undefined ? '' : `?period=${period}`}`
        const got = await env.lens.as(key.value.key, 'GET', path)
        ctx.evidence.push({ note: `the seller's agent key reads ${path}`, answer: `${got.status} ${got.text.slice(0, 300)}` })
        return got.status === 403 ? undefined : `the seller's agent key is neither its owner nor an admin, so it must be refused 403 reading ${path}; Lens answered ${got.status} ${got.text.slice(0, 200)}`
      }
      const read0 = (await refusedAt(undefined)) ?? (await refusedAt(week))
      if (read0 !== undefined) return fail(read0)
      const unpaid = `not yet paid, ${week} named no payout, its lines (1 sale of ${RENT_USD_MICROS}, ${share} carried forward) summing to a net of 0, nothing listed; ` +
        `${NO_SUCH_WEEK} was 400 and the agent key 403`

      // Paid by the payout run, brought to the seller now, its tax details complete.
      const details = await env.lens.act<SellerTax>(seller, 'PUT', '/v1/workspaces/{ws}/marketplace/seller-tax', SELLER_DETAILS)
      ctx.evidence.push({ note: 'the seller completes their tax details', answer: said(details) })
      if (!details.ok && details.status === 503) throw new CannotTest(`${unpaid}; but this Lens stores no seller's tax details (no LENS_PROVIDER_SECRET_KEK), so it pays this seller nothing: the seller has no payouts yet, and no paid week to read`)
      if (!details.ok || !details.value.complete) return fail(`the seller's complete tax details should be saved complete: ${said(details)}`)
      const run = await env.lens.syntheticPayoutRun(seller)
      ctx.evidence.push({ note: 'the payout run, brought to the seller now', answer: said(run) })
      if (!run.ok && (run.status === 404 || run.status === 405)) {
        throw new CannotTest(`${unpaid}; but this Lens has no synthetic payout run (POST /v1/synthetic/workspaces/{ws}/marketplace/payouts/run, talyvor-lens B32.99): the seller has no payouts yet, and no paid week to read`)
      }
      if (!run.ok) return fail(`the payout run for the seller was refused: ${said(run)}`)
      const paid = run.value.payout
      if (run.value.withheld || paid === null) return fail(`with ${share} µUSD available and their tax details complete, the payout run should pay the seller; it answered ${JSON.stringify(run.value)}`)

      const page1 = await read<PayoutPage>(ctx, seller, 'the payout page, paid', '/marketplace/payouts')
      if (typeof page1 === 'string') return fail(page1)
      const listed = (page1.payouts ?? []).find((p) => p.id === paid.id)
      if (!page1.paid_this_week || listed === undefined || listed.period !== week) {
        return fail(`paid ${paid.id} in ${week}, the payout page should read paid this week and list it in ${week}; it reads paid_this_week ${page1.paid_this_week}, payouts ${JSON.stringify(page1.payouts)}`)
      }
      const list1 = await read<{ statements: StatementRow[] | null }>(ctx, seller, 'the list of statements, paid', '/marketplace/statements')
      if (typeof list1 === 'string') return fail(list1)
      const rows = list1.statements ?? []
      const newestFirst = rows.every((r, n) => n === 0 || rows[n - 1].period > r.period)
      if (rows.length === 0 || !newestFirst || rows[0].period !== week || rows[0].payout_id !== paid.id) {
        return fail(`paid ${paid.id} in ${week}, the list of statements should start with ${week} naming it, newest first; it reads ${JSON.stringify(rows)}`)
      }
      const newest = rows[0].period
      const st1 = await read<WeekStatement>(ctx, seller, `the statement of ${newest}, the newest`, `/marketplace/statements?period=${newest}`)
      if (typeof st1 === 'string') return fail(st1)
      const wrong = paidWeekFault(st1, rows[0], listed, paid) ?? (await refusedAt(newest))
      if (wrong !== undefined) return fail(wrong)
      return {
        pass: true,
        detail: `${unpaid}; paid ${paid.id} (${paid.gross_usd_micros} µUSD gross, ${paid.net_usd_micros} net), the payout page read paid this week and the list started with ` +
          `${newest}, whose lines summed to ${st1.net_usd_micros} — the payout's net, as listed — its Stripe fees ${lineOf(st1, 'stripe_fees')}; the agent key 403 on it too`,
      }
    },
  }
}

/** One of the seller's marketplace reads on its owner's key, its answer kept as evidence: the answer, or why it cannot be read. */
export async function read<T>(ctx: ScenarioCtx, seller: SyntheticUser, note: string, rest: string): Promise<T | string> {
  const got: Answered<T> = await ctx.env.lens.act<T>(seller, 'GET', `/v1/workspaces/{ws}${rest}`)
  ctx.evidence.push({ note, answer: got.ok ? JSON.stringify(got.value) : said(got) })
  return got.ok ? got.value : `reading ${note}: ${said(got)}`
}

/** The seller publishes the listing with its per-use and rent offers, approved if the review holds it: its id and the rent's offer id. */
export async function publishRent(ctx: ScenarioCtx, seller: SyntheticUser, title: string): Promise<{ id: string; rent: string } | string> {
  const { env } = ctx
  const model = env.catalog[0]
  if (model === undefined) throw new Error('the catalog has no model')
  const offers: MarketOffer[] = [{ kind: 'per_use', licence: 'commercial', price_usd_micros: PER_USE_USD_MICROS },
    { kind: 'rent', licence: 'commercial', price_usd_micros: RENT_USD_MICROS, period_days: RENT_DAYS }]
  const pub = await env.lens.act<Listing>(seller, 'POST', '/v1/workspaces/{ws}/marketplace/listings', { kind: 'prompt', title, description: '', visibility: 'public',
    artifact: { template: 'Summarise {{text}} in one line.', model: model.id }, changelog: '', offers })
  ctx.evidence.push({ note: `the seller publishes "${title}" with a $30.00 ${RENT_DAYS}-day commercial rent`, answer: said(pub) })
  if (!pub.ok) return `publishing "${title}" was refused: ${said(pub)}`
  if (pub.value.review_status !== 'approved') {
    if (!env.lens.canModerate) throw new CannotTest(`the listing was ${pub.value.review_status}, and approving it needs a moderator key: LENS_MODERATOR_KEY, from \`lens moderator-keys create\``)
    const ok = await env.lens.moderate(pub.value.id, 'approve')
    if (!ok.ok) return `approving the held listing ${pub.value.id}: ${ok.status} ${ok.error}`
  }
  const back = await env.lens.act<{ offers: MarketOffer[] | null }>(seller, 'GET', `/v1/marketplace/listings/${pub.value.id}`)
  const rent = back.ok ? (back.value.offers ?? []).find((o) => o.kind === 'rent' && o.licence === 'commercial')?.id : undefined
  if (rent === undefined) return `the listing's commercial rent offer cannot be read back: ${said(back)}`
  return { id: pub.value.id, rent }
}
