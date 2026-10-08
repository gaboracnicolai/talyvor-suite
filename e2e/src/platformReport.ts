// B32.98 — the annual platform-reporting export (Lens B32.44), on Lens's API, once a run, on workspaces of its own.
//
// Two new sellers each publish a listing with a $30.00 30-day commercial rent and a new buyer rents both; the buyer's bill
// paid, each sale clears, crediting the seller's share to their holdback on the marketplace journal. One seller has saved
// complete tax details resident in the UK (GB), the other the same details resident in the US.
//
// The global admin key — the export holds sellers' TINs in clear, and no narrower key reaches it — then asks for this year's
// export of test money as JSON (POST /v1/admin/platform-reports {year, funding: test, format: json, actor: nightly-e2e}).
// Four things must hold. (1) The X-Platform-Report-Sha256 Lens sent with the file is the sha256 of its bytes, and the runs
// Lens recorded for the year (GET /v1/admin/platform-reports?year=) list this file's run by nightly-e2e with that sha256.
// (2) Every record is of a seller resident in the UK or an EU member state. (3) The GB seller is listed, the consideration of
// their records in total the sum of the holdback credits their earnings read back, and no tax withheld in any quarter.
// (4) The US seller, who also sold this year, is not in the file at all.
//
// A run without the admin key (LENS_API_KEY) cannot ask for the file, and a Lens that stores no seller's tax details (no
// LENS_PROVIDER_SECRET_KEK) cannot open them into it: the scenario says so rather than passing. The GB VAT return is the
// operator's CLI alone (`lens tax return`), so it is not exercised here.

import { createHash, randomUUID } from 'node:crypto'
import { fail } from './bank.ts'
import { keptOf } from './fees.ts'
import type { MarketEarnings, MarketLicence, PlatformReport, PlatformReportRun, SellerTax } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario } from './scenarios.ts'
import { SELLER_DETAILS } from './taxPayouts.ts'
import { until } from './trade.ts'
import { METER_WAIT_MS, publishRent, RENT_USD_MICROS } from './weekStatement.ts'

/** Who the scenario's export is recorded as run by. */
export const ACTOR = 'nightly-e2e'
/** The EU's member states, whose residents DAC7 covers (Lens platformreport.memberStates). */
const MEMBER_STATES = new Set(['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT',
  'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'])
/** A seller resident in the US: complete details, outside both the UK reporting rules and DAC7. */
export const US_DETAILS = {
  ...SELLER_DETAILS, address: '3 Test Avenue, Austin TX', country: 'US', tins: [{ jurisdiction: 'US', number: '123456789' }],
  account_identifier: '021000021000123456',
}

/** Whether the export may list a seller resident in `country`: the UK or an EU member state. */
export const reportable = (country: string): boolean => country === 'GB' || MEMBER_STATES.has(country)

/**
 * What is wrong with the export, judged against the file's bytes, the run Lens recorded and what the scenario's sellers are
 * owed: undefined when nothing.
 */
export function platformReportFault(file: Buffer, sha256: string, id: string, runs: PlatformReportRun[], gb: { ws: string; credited: number }, us: string): string | undefined {
  const actual = createHash('sha256').update(file).digest('hex')
  if (sha256 !== actual) return `the export came with X-Platform-Report-Sha256 ${sha256 || '(none)'}, but the sha256 of its ${file.length} bytes is ${actual}`
  const run = runs.find((r) => r.id === id)
  if (run?.operator !== ACTOR || run.sha256 !== sha256) {
    return `the runs recorded for the year must list this export's run ${id} by ${ACTOR} with sha256 ${sha256}; it reads ${run === undefined ? 'no such run' : JSON.stringify(run)}`
  }
  const rep = JSON.parse(file.toString('utf8')) as PlatformReport
  const records = rep.records ?? []
  const outside = records.find((r) => !reportable(r.country_of_residence))
  if (outside !== undefined) return `the export lists seller ${outside.workspace_id}, resident in ${outside.country_of_residence || 'no country'}: only sellers resident in the UK or an EU member state are reported`
  const mine = records.filter((r) => r.workspace_id === gb.ws)
  if (mine.length === 0) return `the GB seller ${gb.ws} was credited ${gb.credited} µUSD this year, and the export of ${records.length} records leaves them out`
  const considered = mine.reduce((s, r) => s + r.total.consideration_usd_micros, 0)
  if (considered !== gb.credited) {
    return `the GB seller ${gb.ws}'s holdback was credited ${gb.credited} µUSD this year, as their earnings read back; the export reports ${considered} µUSD of consideration: ` +
      mine.map((r) => `${r.activity} ${JSON.stringify(r.total)}`).join(', ')
  }
  const withheld = mine.find((r) => r.total.taxes_withheld_usd_micros !== 0 || r.quarters.some((q) => q.taxes_withheld_usd_micros !== 0))
  if (withheld !== undefined) return `Talyvor withholds no tax, so every quarter's taxes_withheld_usd_micros is 0; the GB seller's ${withheld.activity} record reads ${JSON.stringify(withheld.quarters)}`
  if (records.some((r) => r.workspace_id === us) || (rep.unresolved_sellers ?? []).includes(us)) {
    return `the US seller ${us}, resident outside the UK and the EU, is in the export: ${JSON.stringify(records.filter((r) => r.workspace_id === us))}${(rep.unresolved_sellers ?? []).includes(us) ? ', and among its unresolved sellers' : ''}`
  }
  return undefined
}

export function platformReport(seed: number): Scenario {
  return {
    id: 'platform-report',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Marketplace',
    title: "the year's platform-reporting export carries the sha256 Lens recorded for it, lists only sellers resident in the UK or the EU, " +
      "reports the scenario's GB seller with the consideration their journal was credited and no tax withheld, and leaves its US seller out",
    run: async (ctx) => {
      const { env } = ctx
      if (!env.lens.canAdmin) {
        throw new CannotTest("needs Lens's global admin key to ask for the platform-reporting export, which holds sellers' TINs in clear: LENS_API_KEY, the key Lens boots with")
      }
      const [gb, us, buyer] = await env.lens.createUsers(3)

      // Where each seller lives decides whether the export lists them.
      for (const [seller, details, who] of [[gb, SELLER_DETAILS, 'the GB seller'], [us, US_DETAILS, 'the US seller']] as const) {
        const saved = await env.lens.act<SellerTax>(seller, 'PUT', '/v1/workspaces/{ws}/marketplace/seller-tax', details)
        ctx.evidence.push({ note: `${who} saves complete tax details, resident in ${details.country}`, answer: said(saved) })
        if (!saved.ok && saved.status === 503) throw new CannotTest("this Lens stores no seller's tax details (no LENS_PROVIDER_SECRET_KEK), so it cannot open them into the export")
        if (!saved.ok || !saved.value.complete) return fail(`${who}'s complete tax details should be saved complete: ${said(saved)}`)
      }

      // Each sells a rent this year: the buyer rents both, its bill is paid, and both sales clear.
      const listings: string[] = []
      for (const seller of [gb, us]) {
        const l = await publishRent(ctx, seller, `Platform report ${seed}-${RUN_SALT}-${listings.length}`)
        if (typeof l === 'string') return fail(l)
        const rented = await env.lens.act<MarketLicence>(buyer, 'POST', `/v1/workspaces/{ws}/marketplace/listings/${l.id}/licences`, { offer_id: l.rent },
          { 'Idempotency-Key': randomUUID() })
        ctx.evidence.push({ note: `the buyer rents ${l.id}`, answer: said(rented) })
        if (!rented.ok) return fail(`the buyer's rent of ${l.id} was refused: ${said(rented)}`)
        listings.push(l.id)
      }
      const paidBill = await until(() => env.lens.payTestBill(buyer), (x) => x.ok || x.status !== 409, METER_WAIT_MS)
      ctx.evidence.push({ note: "the buyer's bill paid now (B25.7)", answer: said(paidBill) })
      if (!paidBill.ok || paidBill.value.uses_cleared !== 2) return fail(`paying the buyer's bill of two rents should clear both: ${said(paidBill)}`)

      // What the GB seller's holdback was credited: each cleared sale's share, as their earnings read it back.
      const share = keptOf(RENT_USD_MICROS, env.fees.market_take_bps)
      const creditOf = (e: MarketEarnings): number => (e.earnings ?? []).filter((r) => r.refunded_at === undefined || r.refunded_at === '').reduce((s, r) => s + r.share_usd_micros, 0)
      const earned = await until(() => env.lens.marketEarnings(gb), (e) => creditOf(e) === share, METER_WAIT_MS)
      ctx.evidence.push({ note: "the GB seller's earnings", answer: JSON.stringify(earned) })
      const credited = creditOf(earned)
      if (credited !== share) return fail(`the GB seller's rent cleared, and their earnings should read back its ${share} µUSD share; they read ${credited} µUSD: ${JSON.stringify(earned.earnings)}`)

      const year = new Date().getUTCFullYear()
      const got = await env.lens.platformReport(year, 'test', ACTOR)
      ctx.evidence.push({ note: `the platform-reporting export of ${year}, test money, as JSON`, answer: got.ok ? `${got.value.file.length} bytes, id ${got.value.id}, sha256 ${got.value.sha256}, ${got.value.rows} rows` : said(got) })
      if (!got.ok && got.status === 401) throw new CannotTest(`Lens refused the key in LENS_API_KEY as its admin key: ${said(got)}`)
      if (!got.ok && got.status === 409) throw new CannotTest(`this Lens cannot open its sellers' tax details into the export: ${said(got)}`)
      if (!got.ok) return fail(`the platform-reporting export of ${year} was refused: ${said(got)}`)
      const runs = await env.lens.platformReportRuns(year)
      ctx.evidence.push({ note: `the export runs recorded for ${year}`, answer: runs.ok ? JSON.stringify((runs.value.runs ?? []).filter((r) => r.id === got.value.id)) : said(runs) })
      if (!runs.ok) return fail(`reading the export runs of ${year} was refused: ${said(runs)}`)

      const wrong = platformReportFault(got.value.file, got.value.sha256, got.value.id, runs.value.runs ?? [], { ws: gb.workspaceID, credited }, us.workspaceID)
      if (wrong !== undefined) return fail(wrong)
      return {
        pass: true,
        detail: `the export of ${year} (${got.value.rows} records) came with the sha256 of its bytes, recorded for run ${got.value.id} by ${ACTOR}; ` +
          `every record is of a seller resident in the UK or the EU; the GB seller is reported with the ${credited} µUSD their holdback was credited and no tax withheld; ` +
          `the US seller, who sold too, is not in it`,
      }
    },
  }
}
