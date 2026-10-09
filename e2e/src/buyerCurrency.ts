// B32.100 — a listing reads in the buyer's currency (Lens B32.51), on Lens's API, once a run, on workspaces of its own.
//
// A new seller publishes a public prompt listing with a $20.00 30-day commercial rent and a $1.00 per-use offer. Two new
// buyers declare where they are (PUT …/tax-profile): a GB consumer, and a GB business with a VAT number the Test tax
// partner finds valid (GB123456789). Each reads the listing (GET /v1/marketplace/listings/{id}) as it is, and in pounds
// (?currency=GBP). Every offer must carry a display beside its US-dollar price, which stays what was published, and the
// listing's price_note must start "Charged in US dollars on your monthly marketplace bill". In pounds the display is GBP
// from the ECB with its rate day, and the rent reads round-half-up(price × rate × 100) pence: for the business the price
// before VAT, "+ VAT"; for the consumer the price with the VAT Talyvor charges it, "incl. VAT".
//
// Whether Talyvor charges the GB consumer VAT is the operator's data (a GB registration and its rate), so the scenario
// asks the bill: the consumer uses the per-use offer once, billed, and once Lens has metered it the line's tax treatment
// is the oracle. standard at a rate — the rent must read incl. VAT at the price plus that rate, and, the rate loaded means
// GB's row and its currency are, the default read must be in pounds. not_registered (or no_rate) — the rent must read
// without VAT and no label, and the default read may be in US dollars: a Lens that knows no GB currency shows dollars.
// Both are said in the detail. ?currency=EUR gives euros, and ?currency=pounds is 400.
//
// Lens converts at the unrounded ECB rate and shows it to six places, so the figure is checked against every value the
// shown rate allows: almost always one.

import { fail } from './bank.ts'
import type { BillLine, Listing, MarketOffer, SyntheticUser, TaxProfileAnswer } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario, type ScenarioCtx } from './scenarios.ts'
import { until } from './trade.ts'

/** The rent: $20.00 for 30 days. */
const RENT_USD_MICROS = 20_000_000
const RENT_DAYS = 30
/** The per-use offer the consumer buys once, so its bill line says how Talyvor taxes it. */
const USE_USD_MICROS = 1_000_000
/** Lens meters a billed use within a minute; its tax is worked out then. */
const METER_WAIT_MS = 90_000
/** What every priced listing's price_note starts with (Lens market.chargedInUSD). */
export const CHARGED_IN_USD = 'Charged in US dollars on your monthly marketplace bill'
/** Well formed and not on the Test tax partner's list of numbers never issued: valid. */
const GB_VAT = 'GB123456789'

/** Lens market.Display: an offer's price in the reader's currency. */
export interface Display {
  currency: string
  amount_minor: number
  includes_tax: boolean
  tax_label?: string
  rate: string
  rate_date?: string
  source: string
}

/** A listing as a buyer reads it: each offer with its display, and the note on how it is charged. */
export interface ShownListing {
  id: string
  offers: (MarketOffer & { display?: Display })[] | null
  price_note?: string
}

/** How Talyvor taxes the GB consumer, as its billed use's line says: the treatment and, when it charges, the rate. */
export interface Taxed { treatment: string; rate_bps: number }

/** The tax on `micros` at `bps`, rounded half-up per line as the Test tax partner does. */
const taxOf = (micros: number, bps: number): number => Math.floor((micros * bps + 5_000) / 10_000)

/**
 * The lowest and highest minor units `usdMicros` can read as at `rate` (units of the currency per US dollar, shown to six
 * places), rounded half-up to `digits` places. Lens converts at the unrounded rate, anywhere within half a millionth of
 * the one it shows, so both ends are what that span allows; they are almost always the same figure.
 */
export function convertedRange(usdMicros: number, rate: string, digits = 2): [number, number] {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(rate)
  if (m === null) return [Number.NaN, Number.NaN]
  const r6 = BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? '').padEnd(6, '0'))
  const scaled = BigInt(usdMicros) * 10n ** BigInt(digits)
  const tera = 1_000_000_000_000n
  // amount = usdMicros × 10^digits × rate / 10^6, and rate is (2·r6 ± 1) / (2 × 10^6) at either end; half-up is ⌊x + ½⌋.
  const halfUp = (twiceRate: bigint): number => Number((scaled * twiceRate + tera) / (2n * tera))
  return [halfUp(2n * r6 - (rate.includes('.') ? 1n : 0n)), halfUp(2n * r6 + (rate.includes('.') ? 1n : 0n))]
}

/** What a figure should read as, for a message: one value, or the span the shown rate allows. */
const shown = ([lo, hi]: [number, number]): string => (lo === hi ? `${lo}` : `${lo}–${hi}`)

/**
 * What is wrong with a buyer's read of the listing: undefined when nothing. Every offer has a display and its US-dollar
 * price as published; the note says the charge is in US dollars; the rent's display is in `currency` (any of them when
 * `currency` is empty), from the ECB with its day unless it is US dollars, and reads `grossMicros` converted at its rate
 * with `label` ("" for none), includes_tax exactly when it is "incl. VAT".
 */
export function shownFault(who: string, l: ShownListing, published: Map<string, number>, currency: string[], grossMicros: number, label: string): string | undefined {
  const offers = l.offers ?? []
  if (offers.length !== published.size) return `${who} reads ${offers.length} offer(s) on the listing; it was published with ${published.size}`
  for (const o of offers) {
    const was = published.get(o.kind)
    if (o.price_usd_micros !== was) return `${who} reads the ${o.kind} offer at ${o.price_usd_micros} µUSD; it was published at ${was} µUSD, and the US-dollar price never moves`
    if (o.display === undefined || o.display === null) return `${who} reads the ${o.kind} offer with no display: price_note ${JSON.stringify(l.price_note ?? '')}`
  }
  if (!(l.price_note ?? '').startsWith(CHARGED_IN_USD)) return `${who} reads price_note ${JSON.stringify(l.price_note ?? '')}; it starts "${CHARGED_IN_USD}"`
  const d = offers.find((o) => o.kind === 'rent')?.display
  if (d === undefined) return `${who} reads no rent offer on the listing`
  if (!currency.includes(d.currency)) return `${who} reads the rent in ${d.currency}; it should be in ${currency.join(' or ')}: ${JSON.stringify(d)}`
  if (d.currency === 'USD' ? d.source !== 'none' || d.rate !== '1' : d.source !== 'ecb' || Number.isNaN(Date.parse(d.rate_date ?? ''))) {
    return `${who} reads the rent in ${d.currency} with source ${d.source}, rate ${d.rate} of ${d.rate_date ?? '(no day)'}: ${d.currency === 'USD' ? 'dollars are at 1, source none' : 'a converted price is at the ECB reference rate of a day'}`
  }
  const want = convertedRange(grossMicros, d.rate, ['JPY', 'KRW', 'ISK'].includes(d.currency) ? 0 : 2)
  const what = `${grossMicros} µUSD at ${d.rate} ${d.currency} to the dollar is ${shown(want)}`
  if (d.amount_minor < want[0] || d.amount_minor > want[1]) return `${who} reads the rent as ${d.amount_minor} ${d.currency} minor units; ${what}`
  if ((d.tax_label ?? '') !== label || d.includes_tax !== (label === 'incl. VAT')) {
    return `${who} reads the rent labelled ${JSON.stringify(d.tax_label ?? '')}, includes_tax ${d.includes_tax}; it should be ${label === '' ? 'unlabelled, without tax' : `"${label}"${label === 'incl. VAT' ? ', includes_tax true' : ', includes_tax false'}`}`
  }
  return undefined
}

/** The consumer's gross and label, as its bill line says Talyvor taxes it: the price with VAT and "incl. VAT", or the price alone. */
export function consumerShows(t: Taxed): { gross: number; label: string } {
  return t.treatment === 'standard' || t.treatment === 'zero'
    ? { gross: RENT_USD_MICROS + taxOf(RENT_USD_MICROS, t.rate_bps), label: 'incl. VAT' }
    : { gross: RENT_USD_MICROS, label: '' }
}

export function marketBuyerCurrency(seed: number): Scenario {
  return {
    id: 'market-buyer-currency',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Marketplace',
    title: "a $20.00 rent reads in the buyer's currency beside its unchanged US-dollar price: a GB consumer sees it in pounds at the ECB rate " +
      'with the VAT its bill charges, "incl. VAT"; a GB business sees it in pounds "+ VAT"; ?currency=EUR is in euros, ?currency=pounds is 400, ' +
      'and the note says it is charged in US dollars on the monthly bill',
    run: async (ctx) => {
      const { lens } = ctx.env
      const [seller, consumer, business] = await lens.createUsers(3)
      const pub = await publish(ctx, seller, `Priced in pounds ${seed}-${RUN_SALT}`)
      if (typeof pub === 'string') return fail(pub)
      const listing = pub.id
      const published = new Map([['rent', RENT_USD_MICROS], ['per_use', USE_USD_MICROS]])

      for (const [who, buyer, profile, isBusiness] of [
        ['the GB consumer', consumer, { legal_name: 'Nightly GB Consumer', country: 'GB' }, false],
        ['the GB business', business, { legal_name: 'Nightly GB Ltd', country: 'GB', tax_id: GB_VAT }, true],
      ] as const) {
        const put = await lens.act<TaxProfileAnswer>(buyer, 'PUT', '/v1/workspaces/{ws}/tax-profile', profile)
        ctx.evidence.push({ note: `${who} declares its tax profile`, answer: said(put) })
        if (!put.ok) return fail(`${who}'s tax profile was refused: ${said(put)}`)
        if (put.value.resolved?.country !== 'GB' || put.value.resolved.business !== isBusiness) {
          return fail(`${who} declared GB${isBusiness ? ` with ${GB_VAT}, valid` : ''}; Lens resolves it to ${JSON.stringify(put.value.resolved)}`)
        }
      }

      // The bill is the oracle for the consumer's VAT: one billed use, and the tax its line is metered with.
      const taxed = await consumerTaxed(ctx, consumer, listing)
      if (typeof taxed === 'string') return fail(taxed)
      const c = consumerShows(taxed)
      const charged = c.label !== ''

      const read = async (who: string, buyer: SyntheticUser, query: string): Promise<{ status: number; listing?: ShownListing; said: string }> => {
        const got = await lens.act<ShownListing>(buyer, 'GET', `/v1/marketplace/listings/${listing}${query}`)
        // Each offer's price and display, and the note: the listing itself is cut short before them.
        const prices = got.ok ? JSON.stringify({ offers: (got.value.offers ?? []).map((o) => ({ kind: o.kind, price_usd_micros: o.price_usd_micros, display: o.display })),
          price_note: got.value.price_note }) : said(got)
        ctx.evidence.push({ note: `${who} reads the listing${query === '' ? '' : ` with ${query}`}`, answer: prices })
        return { status: got.status, listing: got.ok ? got.value : undefined, said: said(got) }
      }
      const judge = async (who: string, buyer: SyntheticUser, query: string, currency: string[], gross: number, label: string): Promise<ShownListing | string> => {
        const got = await read(who, buyer, query)
        if (got.listing === undefined) return `${who}'s read of the listing${query === '' ? '' : ` with ${query}`} was refused: ${got.said}`
        const wrong = shownFault(`${who}${query === '' ? '' : ` (${query})`}`, got.listing, published, currency, gross, label)
        return wrong ?? got.listing
      }

      // The default read: pounds once GB's rate is loaded (its currency with it); without it, dollars are what Lens knows.
      const home = charged ? ['GBP'] : ['GBP', 'USD']
      const cHome = await judge('the GB consumer', consumer, '', home, c.gross, c.label)
      if (typeof cHome === 'string') return fail(cHome)
      const cGBP = await judge('the GB consumer', consumer, '?currency=GBP', ['GBP'], c.gross, c.label)
      if (typeof cGBP === 'string') return fail(cGBP)
      const bHome = await judge('the GB business', business, '', home, RENT_USD_MICROS, '+ VAT')
      if (typeof bHome === 'string') return fail(bHome)
      const bGBP = await judge('the GB business', business, '?currency=GBP', ['GBP'], RENT_USD_MICROS, '+ VAT')
      if (typeof bGBP === 'string') return fail(bGBP)
      const cEUR = await judge('the GB consumer', consumer, '?currency=EUR', ['EUR'], c.gross, c.label)
      if (typeof cEUR === 'string') return fail(cEUR)
      const pounds = await read('the GB consumer', consumer, '?currency=pounds')
      if (pounds.status !== 400) return fail(`?currency=pounds is no ISO 4217 code and must be refused 400; Lens answered ${pounds.said}`)

      const rent = (l: ShownListing): Display => (l.offers ?? []).find((o) => o.kind === 'rent')?.display as Display
      const fig = (d: Display): string => `${d.amount_minor} ${d.currency}${d.tax_label ? ` ${d.tax_label}` : ''}`
      const why = charged
        ? `the consumer's use was taxed ${taxed.treatment} at ${taxed.rate_bps} bps`
        : `the consumer's use was taxed ${taxed.treatment}: this Lens's operator has loaded no GB registration or rate, so no VAT is shown`
      return {
        pass: true,
        detail: `${why}; the $20.00 rent read ${fig(rent(cGBP))} for the GB consumer and ${fig(rent(bGBP))} for the GB business at ${rent(bGBP).rate} GBP to the dollar ` +
          `(ECB, ${rent(bGBP).rate_date}), ${fig(rent(cEUR))} with ?currency=EUR; by default ${fig(rent(cHome))} and ${fig(rent(bHome))}` +
          `${rent(cHome).currency === 'USD' ? ' (in dollars: this Lens knows no currency for GB)' : ''}; the US-dollar prices unchanged, the note "${CHARGED_IN_USD}…", ?currency=pounds 400`,
      }
    },
  }
}

/** The seller publishes the listing with its rent and per-use offers, approved if the review holds it: its id, or why not. */
async function publish(ctx: ScenarioCtx, seller: SyntheticUser, title: string): Promise<{ id: string } | string> {
  const { env } = ctx
  const offers: MarketOffer[] = [{ kind: 'rent', licence: 'commercial', price_usd_micros: RENT_USD_MICROS, period_days: RENT_DAYS },
    { kind: 'per_use', licence: 'commercial', price_usd_micros: USE_USD_MICROS }]
  const pub = await env.lens.act<Listing>(seller, 'POST', '/v1/workspaces/{ws}/marketplace/listings', { kind: 'prompt', title, description: '', visibility: 'public',
    artifact: { template: 'Summarise {{text}} in one line.', model: env.judgeModel }, changelog: '', offers })
  ctx.evidence.push({ note: `the seller publishes "${title}" with a $20.00 ${RENT_DAYS}-day rent and a $1.00 use`, answer: said(pub) })
  if (!pub.ok) return `publishing "${title}" was refused: ${said(pub)}`
  if (pub.value.review_status !== 'approved') {
    if (!env.lens.canModerate) throw new CannotTest(`the listing was ${pub.value.review_status}, and approving it needs a moderator key: LENS_MODERATOR_KEY, from \`lens moderator-keys create\``)
    const ok = await env.lens.moderate(pub.value.id, 'approve')
    if (!ok.ok) return `approving the held listing ${pub.value.id}: ${ok.status} ${ok.error}`
  }
  return { id: pub.value.id }
}

/** The consumer uses the listing once, billed; how its line is taxed once Lens has metered it, or what went wrong. */
async function consumerTaxed(ctx: ScenarioCtx, consumer: SyntheticUser, listing: string): Promise<Taxed | string> {
  const { lens } = ctx.env
  const used = await lens.act<{ id: string; charge: string }>(consumer, 'POST', `/v1/workspaces/{ws}/marketplace/listings/${listing}/use`, { variables: { text: 'a nightly price test' } })
  ctx.evidence.push({ note: 'the GB consumer uses it once, billed', answer: said(used) })
  if (!used.ok || used.value.charge !== 'billed') return `the GB consumer's use should be billed; Lens answered ${said(used)}`
  const bill = await until(() => lens.marketBill(consumer), (x) => (x.lines ?? []).some((l) => l.use_id === used.value.id && (l.tax_treatment ?? '') !== ''), METER_WAIT_MS)
  const line: BillLine | undefined = (bill.lines ?? []).find((l) => l.use_id === used.value.id)
  ctx.evidence.push({ note: "the GB consumer's bill line for its use", answer: JSON.stringify(line ?? null) })
  if ((line?.tax_treatment ?? '') === '') return `${METER_WAIT_MS / 1000} s after the GB consumer used it, its bill line carries no tax treatment: ${JSON.stringify(line ?? null)}`
  return { treatment: line?.tax_treatment ?? '', rate_bps: line?.tax_rate_bps ?? 0 }
}
