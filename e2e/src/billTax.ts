// B32.93 — a marketplace bill carries its tax (Lens B32.39), on Lens's API, once a run, on workspaces of its own.
//
// A new seller publishes a prompt listing with one per_use commercial offer at $1.00. Two new buyers declare who and where
// they are (PUT …/tax-profile) and each uses it once (POST …/listings/{id}/use), billed: a GB consumer, and a DE business
// with a VAT number the Test tax partner finds valid (DE123456789). Each use is one line on its buyer's bill, and once Lens
// has metered it the line carries its tax treatment. On the Test tax partner's fixture rows the GB consumer's is standard at
// 2000 bps, 200,000 µUSD — not_registered at 0 on a Lens whose operator has loaded no GB registration, which is said, not
// failed — and the DE business's reverse_charge at 0, its note naming the reverse charge. Each bill's gross is its net plus
// its tax.
//
// The synthetic bill-pay pays the GB consumer's bill, and the use's clear entry must carry its tax: +price+tax on
// stripe:clearing, −tax on tax:GB. Lens's API shows no posting, but the seller's statement of the week reads its VAT
// collected from exactly those tax:<XX> postings of each released sale's clear entry (market.SellerStatement). So once the
// release job has released the seller's share — keptOf(price): none of the tax is the seller's — the week's
// vat_collected_usd_micros must be the GB line's tax.
//
// While Lens's Stripe key is live, a real buyer's sale Talyvor cannot account the tax on is refused before it runs ("not
// available in your country yet", Lens market.sellable). Every tester's workspace is a synthetic one, which that refusal
// never applies to, so no nightly run reaches it: Lens's real-PG test (internal/market/tax_realpg_test.go) holds it.

import { fail } from './bank.ts'
import { keptOf } from './fees.ts'
import type { BillLine, Listing, MarketBill, MarketOffer, SyntheticUser, TaxProfileAnswer, WeekStatement } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario, type ScenarioCtx } from './scenarios.ts'
import { isoWeek } from './taxPayouts.ts'
import { until } from './trade.ts'

/** The per-use price: $1.00, µUSD; one µUSD is ten µLXC at the peg. */
const PRICE_USD_MICROS = 1_000_000
const PRICE_ULXC = PRICE_USD_MICROS * 10
/** The GB standard rate on the fixture rows, and its tax on the price, half up. */
const GB_RATE_BPS = 2000
const GB_TAX_USD_MICROS = 200_000
/** Lens meters a billed use within a minute; its tax is worked out then. */
const METER_WAIT_MS = 90_000
/** Lens's release job runs every 5 minutes. */
const RELEASE_WAIT_MS = 360_000

/** Lens market.Use as the use route answers it. */
interface Use { id: string; charge: string; price_ulxc: number }

interface Buyer {
  who: string
  country: string
  business: boolean
  profile: Record<string, string>
}

const GB: Buyer = { who: 'the GB consumer', country: 'GB', business: false, profile: { legal_name: 'Nightly GB Consumer', country: 'GB' } }
// DE123456789 is well formed and not on the Test tax partner's list of numbers never issued: valid.
const DE: Buyer = { who: 'the DE business', country: 'DE', business: true, profile: { legal_name: 'Nightly Test GmbH', country: 'DE', tax_id: 'DE123456789' } }

/**
 * What is wrong with a buyer's tax on its one use, on the fixture rows: undefined when nothing. The GB consumer's line may
 * be not_registered at 0 on a Lens holding no GB registration; a business abroad with a valid VAT number is never taxed.
 */
export function lineTaxFault(b: Buyer, l: BillLine): string | undefined {
  const got = `${l.tax_treatment ?? '(none)'} at ${l.tax_rate_bps ?? '?'} bps, ${l.tax_usd_micros ?? '?'} µUSD in ${l.tax_jurisdiction ?? '?'}`
  if (l.tax_jurisdiction !== b.country) return `${b.who}'s tax is ${got}: its jurisdiction is ${b.country}`
  if (b.business) {
    if (l.tax_treatment === 'reverse_charge' && l.tax_usd_micros === 0 && /^Reverse charge/.test(l.tax_note ?? '')) return undefined
    return `${b.who}, with a valid VAT number, is taxed ${got} with the note "${l.tax_note ?? ''}": it is reverse_charge at 0, the note naming the reverse charge`
  }
  if (l.tax_treatment === 'standard' && l.tax_rate_bps === GB_RATE_BPS && l.tax_usd_micros === GB_TAX_USD_MICROS) return undefined
  if (l.tax_treatment === 'not_registered' && l.tax_usd_micros === 0) return undefined
  return `${b.who}'s tax is ${got}: on the fixture rows it is standard at ${GB_RATE_BPS} bps, ${GB_TAX_USD_MICROS} µUSD (not_registered at 0 without a GB registration)`
}

export function marketBillTax(seed: number): Scenario {
  return {
    id: 'market-bill-tax',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Marketplace',
    title: "a GB consumer and a DE business with a valid VAT number each make one $1.00 per-use buy: each bill line carries its tax " +
      "treatment (standard at 20%, reverse charged at 0) and each bill's gross is its net plus its tax; the GB bill paid, its use's " +
      "clear entry carries the tax to tax:GB — the seller's week counts it as VAT collected, the seller's share none of it",
    run: async (ctx) => {
      const { env } = ctx
      const [seller, gb, de] = await env.lens.createUsers(3)
      const pub = await publish(ctx, seller, `Taxed use ${seed}-${RUN_SALT}`)
      if (typeof pub === 'string') return fail(pub)
      const listing = pub.id

      // Each buyer declares itself and uses the listing once; its line, once metered, carries its tax.
      const lines: BillLine[] = []
      for (const [b, buyer] of [[GB, gb], [DE, de]] as const) {
        const put = await env.lens.act<TaxProfileAnswer>(buyer, 'PUT', '/v1/workspaces/{ws}/tax-profile', b.profile)
        ctx.evidence.push({ note: `${b.who} declares its tax profile`, answer: said(put) })
        if (!put.ok) return fail(`${b.who}'s tax profile was refused: ${said(put)}`)
        if (put.value.resolved?.country !== b.country || put.value.resolved.business !== b.business) {
          return fail(`${b.who} declared ${b.country}${b.business ? ' with a valid VAT number' : ''}; Lens resolves it to ${JSON.stringify(put.value.resolved)}`)
        }
        const used = await env.lens.act<Use>(buyer, 'POST', `/v1/workspaces/{ws}/marketplace/listings/${listing}/use`, { variables: { text: 'a nightly tax test' } })
        ctx.evidence.push({ note: `${b.who} uses it once`, answer: said(used) })
        if (!used.ok || used.value.charge !== 'billed' || used.value.price_ulxc !== PRICE_ULXC) {
          return fail(`${b.who}'s use should be billed at ${PRICE_ULXC} µLXC; Lens answered ${said(used)}`)
        }
        const bill = await until(() => env.lens.marketBill(buyer), (x) => (x.lines ?? []).some((l) => l.listing_id === listing && (l.tax_treatment ?? '') !== ''), METER_WAIT_MS)
        ctx.evidence.push({ note: `${b.who}'s bill`, answer: JSON.stringify(bill) })
        const mine = (bill.lines ?? []).filter((l) => l.listing_id === listing)
        if (mine.length !== 1 || mine[0].use_id !== used.value.id || mine[0].price_ulxc !== PRICE_ULXC) {
          return fail(`${b.who}'s use should be one ${PRICE_ULXC} µLXC line on its bill, use ${used.value.id}; the bill holds ${JSON.stringify(mine)}`)
        }
        if ((mine[0].tax_treatment ?? '') === '') return fail(`${METER_WAIT_MS / 1000} s after ${b.who} used it, its bill line carries no tax treatment: ${JSON.stringify(mine[0])}`)
        const wrong = lineTaxFault(b, mine[0]) ?? billTotalsFault(b, bill, mine[0])
        if (wrong !== undefined) return fail(wrong)
        lines.push(mine[0])
      }
      const [gbLine, deLine] = lines
      const gbTax = gbLine.tax_usd_micros ?? 0

      // The GB consumer's bill paid: its use's clear entry takes the tax to tax:GB, and the seller's share none of it.
      const paid = await until(() => env.lens.payTestBill(gb), (x) => x.ok || x.status !== 409, METER_WAIT_MS)
      ctx.evidence.push({ note: `${GB.who}'s bill paid now (B25.7)`, answer: said(paid) })
      if (!paid.ok) return fail(`paying ${GB.who}'s bill was refused: ${said(paid)}`)
      if (paid.value.uses_cleared !== 1) return fail(`paying ${GB.who}'s bill of one use cleared ${paid.value.uses_cleared} uses`)
      const share = keptOf(PRICE_USD_MICROS, env.fees.market_take_bps)
      const j = await until(() => env.lens.marketJournal(seller), (x) => x.holdback_usd_micros === 0 && x.available_usd_micros === share, RELEASE_WAIT_MS)
      ctx.evidence.push({ note: `the seller's journal: ${JSON.stringify(j)}` })
      if (j.holdback_usd_micros !== 0 || j.available_usd_micros !== share || !j.reconciled) {
        return fail(`${RELEASE_WAIT_MS / 60_000} minutes after ${GB.who}'s bill was paid, the seller's journal should hold its ${share} µUSD share of the ${PRICE_USD_MICROS} µUSD price ` +
          `available — none of the ${gbTax} µUSD tax — and reconcile; it reads ${JSON.stringify(j)}`)
      }
      const week = isoWeek(new Date())
      const st = await env.lens.act<WeekStatement>(seller, 'GET', `/v1/workspaces/{ws}/marketplace/statements?period=${week}`)
      ctx.evidence.push({ note: `the seller's statement of ${week}`, answer: said(st) })
      if (!st.ok) return fail(`reading the seller's statement of ${week}: ${said(st)}`)
      const sales = (st.value.lines ?? []).find((l) => l.kind === 'sales')?.amount_usd_micros ?? 0
      if (st.value.sales !== 1 || sales !== PRICE_USD_MICROS || st.value.vat_collected_usd_micros !== gbTax) {
        return fail(`the GB consumer's paid use should be the seller's one sale of ${week}, ${PRICE_USD_MICROS} µUSD, its clear entry taking its ${gbTax} µUSD tax to tax:GB; ` +
          `the week reads ${st.value.sales} sale(s) of ${sales} µUSD and ${st.value.vat_collected_usd_micros} µUSD VAT collected`)
      }

      const unregistered = gbLine.tax_treatment === 'not_registered' ? ' (this Lens holds no GB registration: its operator has loaded none)' : ''
      return { pass: true, detail: `${GB.who} ${gbLine.tax_treatment} at ${gbLine.tax_rate_bps ?? 0} bps, ${gbTax} µUSD${unregistered}; ${DE.who} ${deLine.tax_treatment} at ` +
        `${deLine.tax_usd_micros ?? 0} µUSD ("${deLine.tax_note ?? ''}"); each bill's gross = net + tax; the GB bill paid, the seller's ${share} µUSD share released and ` +
        `${st.value.vat_collected_usd_micros} µUSD VAT collected from its clear entry in ${week}. A live sale Talyvor cannot account for is refused for real buyers alone, which no tester is` }
    },
  }
}

/** The seller publishes the listing with its one per_use offer, approved if the review holds it: its id, or why not. */
export async function publish(ctx: ScenarioCtx, seller: SyntheticUser, title: string): Promise<{ id: string } | string> {
  const { env } = ctx
  const offers: MarketOffer[] = [{ kind: 'per_use', licence: 'commercial', price_usd_micros: PRICE_USD_MICROS }]
  const pub = await env.lens.act<Listing>(seller, 'POST', '/v1/workspaces/{ws}/marketplace/listings', { kind: 'prompt', title, description: '', visibility: 'public',
    artifact: { template: 'Summarise {{text}} in one line.', model: env.judgeModel }, changelog: '', offers })
  ctx.evidence.push({ note: `the seller publishes "${title}" at ${PRICE_USD_MICROS} µUSD a use`, answer: said(pub) })
  if (!pub.ok) return `publishing "${title}" was refused: ${said(pub)}`
  if (pub.value.review_status !== 'approved') {
    if (!env.lens.canModerate) throw new CannotTest(`the listing was ${pub.value.review_status}, and approving it needs a moderator key: LENS_MODERATOR_KEY, from \`lens moderator-keys create\``)
    const ok = await env.lens.moderate(pub.value.id, 'approve')
    if (!ok.ok) return `approving the held listing ${pub.value.id}: ${ok.status} ${ok.error}`
  }
  return { id: pub.value.id }
}

/** What is wrong with a buyer's bill's totals for its one use: undefined when its net is the price and its gross the net plus the tax. */
function billTotalsFault(b: Buyer, bill: MarketBill, l: BillLine): string | undefined {
  const tax = l.tax_usd_micros ?? 0
  if (bill.net_usd_micros === PRICE_USD_MICROS && bill.tax_usd_micros === tax && bill.gross_usd_micros === (bill.net_usd_micros ?? 0) + (bill.tax_usd_micros ?? 0)) return undefined
  return `${b.who}'s bill reads net ${bill.net_usd_micros}, tax ${bill.tax_usd_micros}, gross ${bill.gross_usd_micros} µUSD; its one use is net ${PRICE_USD_MICROS}, tax ${tax}, gross ${PRICE_USD_MICROS + tax}`
}
