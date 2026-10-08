// B32.65 — lineage and licences (Lens B32.24–B32.27), on Lens's API, once a run, on workspaces of its own.
//
// Three new authors build a family. A publishes an original whose remix licence asks a royalty of 20%. B accepts that
// licence (POST …/listings/{A}/remix), publishes its remix of A with A as its parent, and asks 10% of its own remixes. C
// accepts B's licence and publishes its remix of B, sold by a $20.00 30-day commercial rent. C's lineage must name B at
// 10% and A at 20%: the shares the licences locked. A fourth workspace rents C, which is one line on its bill, and uses C
// twice: each use is licensed, and the bill still holds that one line.
//
// The synthetic bill-pay pays the rent, and the sale's one journal entry (B32.26) must split it as the design does.
// Talyvor takes its fee — the price less SellerShare at the market take — and the rest is the pool: B receives its 10% of
// the pool, A its 20% of what B received, each rounded down, and C keeps the rest. On the design's worked example (a take
// of 15%) that is a fee of 3,000,000 µUSD, C 15,300,000, B 1,360,000 and A 340,000. Each author's earnings must hold
// exactly one row for the rent — C's the sale with its gross and the fee, B's and A's royalties of generation 1 and 2
// naming their own listing as the original — and each author's journal (holdback plus available, B32.17) must hold that
// row's amount and reconcile. The fee and the three rows sum to the price.
//
// The synthetic refund then refunds the paid bill, as Stripe's charge.refunded does, and the reversal (B32.27) must mirror
// the sale: every author's row reads refunded with its whole amount counted as refunded, every author's journal is back
// to 0 and reconciles, and the buyer's line reads refunded.

import { randomUUID } from 'node:crypto'
import { fail } from './bank.ts'
import { keptOf } from './fees.ts'
import type { Listing, MarketEarnings, MarketLicence, MarketOffer, SyntheticUser } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario, type ScenarioCtx } from './scenarios.ts'
import { until } from './trade.ts'

/** The rent of C: $20.00 for 30 days, µUSD; one µUSD is ten µLXC at the peg. */
const RENT_USD_MICROS = 20_000_000
const RENT_ULXC = RENT_USD_MICROS * 10
const RENT_DAYS = 30
/** Every listing's per-use offer, beside C's rent: no buyer uses it. */
const PER_USE_USD_MICROS = 100_000
/** A's royalty on its remixes, and B's on its own. */
const A_SHARE_BPS = 2000
const B_SHARE_BPS = 1000
const BPS = 10_000
/** Lens meters a billed use within a minute, and only a metered use is paid. */
const METER_WAIT_MS = 90_000
/** A clear or a refund writes its rows at once; this is slack for a slow read. */
const ROWS_WAIT_MS = 30_000

/** Lens market.Lineage as GET /v1/marketplace/listings/{id}/lineage answers it. */
interface Lineage { ancestors: { listing_id: string; version: number; share_bps: number }[] | null }
/** Lens market.Remix: the licence accepted, its grant at the share it locked, and the artifact opened. */
interface Remix { grant?: { share_bps: number }; artifact: unknown }
/** Lens market.Use as the use route answers it. */
interface Use { id: string; charge: string; price_ulxc: number }

/** One author's row of the sale, as the design splits it. */
interface Want { who: string; user: SyntheticUser; listing: string; kind: 'sale' | 'lineage'; depth: number; share: number; gross: number; fee: number }

/** The design's split of `gross` at Talyvor's take: the fee, and what C, B and A each keep. */
export function split(gross: number, takeBPS: number): { fee: number; c: number; b: number; a: number } {
  const pool = keptOf(gross, takeBPS)
  const toB = Math.floor((pool * B_SHARE_BPS) / BPS)
  const toA = Math.floor((toB * A_SHARE_BPS) / BPS)
  return { fee: gross - pool, c: pool - toB, b: toB - toA, a: toA }
}

export function lineage(seed: number): Scenario {
  return {
    id: 'lineage',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Marketplace',
    title: "A's original at a 20% royalty is remixed into B at 10%, and B into C; a fourth workspace rents C for 30 days and uses it twice " +
      "with one line on its bill; the paid rent's journal entry splits Talyvor's fee, C, B and A in the design's proportions, and refunding " +
      'the bill reverses all four',
    run: async (ctx) => {
      const { env } = ctx
      const { lens } = env
      const [a, b, c, buyer] = await lens.createUsers(4)
      // The model the testers' own questions run on: one this Lens can run, cheap.
      const model = env.judgeModel
      const tag = `${seed}-${RUN_SALT}`

      // The family: A, B remixing A under its licence, C remixing B under its own.
      const A = await publish(ctx, a, 'A', { title: `Risk list ${tag}`, artifact: { template: 'List three risks in {{text}}.', model } })
      if (typeof A === 'string') return fail(A)
      const termsA = await terms(ctx, a, 'A', A.id, A_SHARE_BPS)
      if (termsA !== undefined) return fail(termsA)
      const grantB = await remix(ctx, b, 'B', 'A', A.id, A_SHARE_BPS)
      if (grantB !== undefined) return fail(grantB)
      const B = await publish(ctx, b, 'B', { title: `Risk register ${tag}`, parents: [{ listing_id: A.id, version: 1 }],
        artifact: { template: 'List three risks in {{text}}, each with the one step that most reduces it.', model } })
      if (typeof B === 'string') return fail(B)
      const termsB = await terms(ctx, b, 'B', B.id, B_SHARE_BPS)
      if (termsB !== undefined) return fail(termsB)
      const grantC = await remix(ctx, c, 'C', 'B', B.id, B_SHARE_BPS)
      if (grantC !== undefined) return fail(grantC)
      const C = await publish(ctx, c, 'C', { title: `Risk table ${tag}`, parents: [{ listing_id: B.id, version: 1 }], rent: true,
        artifact: { template: 'Write a table of three risks in {{text}}: each risk, how likely it is, and the one step that most reduces it.', model } })
      if (typeof C === 'string') return fail(C)
      const family = await lens.act<Lineage>(c, 'GET', `/v1/marketplace/listings/${C.id}/lineage`)
      ctx.evidence.push({ note: "C's lineage", answer: said(family) })
      const up = family.ok ? family.value.ancestors ?? [] : []
      const edgeB = up.find((x) => x.listing_id === B.id)
      const edgeA = up.find((x) => x.listing_id === A.id)
      if (edgeB?.version !== 1 || edgeB.share_bps !== B_SHARE_BPS || edgeA?.version !== 1 || edgeA.share_bps !== A_SHARE_BPS) {
        return fail(`C's lineage should name B version 1 at ${B_SHARE_BPS} bps and A version 1 at ${A_SHARE_BPS} bps; it reads ${said(family)}`)
      }

      // The fourth workspace rents C and uses it twice: one line on its bill, the rent.
      const rented = await lens.act<MarketLicence>(buyer, 'POST', `/v1/workspaces/{ws}/marketplace/listings/${C.id}/licences`, { offer_id: C.rent },
        { 'Idempotency-Key': randomUUID() })
      ctx.evidence.push({ note: `the buyer rents C for ${RENT_DAYS} days`, answer: said(rented) })
      if (!rented.ok) return fail(`renting C was refused: ${said(rented)}`)
      const rent = rented.value.use_id
      for (const n of [1, 2]) {
        const used = await lens.act<Use>(buyer, 'POST', `/v1/workspaces/{ws}/marketplace/listings/${C.id}/use`, { variables: { text: `a nightly test launch, take ${n}` } })
        ctx.evidence.push({ note: `the buyer uses C under the rent, use ${n}`, answer: said(used) })
        if (!used.ok || used.value.charge !== 'licensed' || used.value.price_ulxc !== 0) {
          return fail(`the rent covers the buyer's use ${n} of C, so it is charged licensed at 0; Lens answered ${said(used)}`)
        }
      }
      const lines = ((await lens.marketBill(buyer)).lines ?? []).filter((l) => l.listing_id === C.id)
      ctx.evidence.push({ note: "the buyer's bill, C's lines", answer: JSON.stringify(lines) })
      if (lines.length !== 1 || lines[0].use_id !== rent || lines[0].price_ulxc !== RENT_ULXC) {
        return fail(`after the rent and two uses under it, the buyer's bill should hold one line for C, the rent ${rent} at ${RENT_ULXC} µLXC; it holds ${JSON.stringify(lines)}`)
      }

      // The rent paid: the fee, C's sale and B's and A's royalties, each author's row on its earnings and its journal.
      const before = await Promise.all([a, b, c].map((u) => lens.marketEarnings(u)))
      const paid = await until(() => lens.payTestBill(buyer), (x) => x.ok || x.status !== 409, METER_WAIT_MS)
      ctx.evidence.push({ note: "the buyer's bill paid now (B25.7)", answer: said(paid) })
      if (!paid.ok) return fail(`paying the buyer's bill was refused: ${said(paid)}`)
      if (paid.value.uses_cleared !== 1) return fail(`paying a bill of one rent cleared ${paid.value.uses_cleared} uses`)
      const s = split(RENT_USD_MICROS, env.fees.market_take_bps)
      const want: Want[] = [
        { who: 'C', user: c, listing: C.id, kind: 'sale', depth: 0, share: s.c, gross: RENT_USD_MICROS, fee: s.fee },
        { who: 'B', user: b, listing: B.id, kind: 'lineage', depth: 1, share: s.b, gross: 0, fee: 0 },
        { who: 'A', user: a, listing: A.id, kind: 'lineage', depth: 2, share: s.a, gross: 0, fee: 0 },
      ]
      for (const [n, w] of want.entries()) {
        const wrong = await rowFault(ctx, w, rent, false, before[n])
        if (wrong !== undefined) return fail(`the paid rent of C: ${wrong}`)
      }
      if (s.fee + s.c + s.b + s.a !== RENT_USD_MICROS) return fail(`the fee and the three rows sum to ${s.fee + s.c + s.b + s.a} µUSD, not the ${RENT_USD_MICROS} the buyer paid`)

      // The bill refunded: every row of the sale reversed, every journal back to 0.
      const refunded = await lens.refundTestBill(buyer, paid.value.invoice_id)
      ctx.evidence.push({ note: `the paid bill ${paid.value.invoice_id} refunded, as Stripe's charge.refunded refunds it`, answer: said(refunded) })
      if (!refunded.ok) return fail(`refunding the paid bill was refused: ${said(refunded)}`)
      if (refunded.value.uses_refunded !== 1) return fail(`refunding a bill of one rent refunded ${refunded.value.uses_refunded} uses`)
      for (const [n, w] of want.entries()) {
        const wrong = await rowFault(ctx, w, rent, true, before[n])
        if (wrong !== undefined) return fail(`the refunded rent of C: ${wrong}`)
      }
      const line = ((await lens.marketBill(buyer)).lines ?? []).find((l) => l.use_id === rent)
      if (line?.refunded_at === undefined) return fail(`refunded, the buyer's line for the rent should read refunded; it reads ${JSON.stringify(line)}`)

      return { pass: true, detail: `A at ${A_SHARE_BPS} bps, B remixing A at ${B_SHARE_BPS} bps and C remixing B, each under its remix licence, C's lineage naming both; ` +
        `C rented for ${RENT_DAYS} days and used twice under it, one ${RENT_ULXC} µLXC line on the bill; paid, the ${RENT_USD_MICROS} µUSD rent split ` +
        `fee ${s.fee}, C ${s.c}, B ${s.b}, A ${s.a}, each author's row on its earnings and its journal, reconciled; refunded, all four reversed, every journal back to 0` }
    },
  }
}

/** An author publishes a listing — C with its rent — approved if the review holds it: its id, and C's rent offer's id. */
async function publish(ctx: ScenarioCtx, who: SyntheticUser, name: string, l: { title: string; artifact: object; parents?: object[]; rent?: boolean }):
  Promise<{ id: string; rent: string } | string> {
  const { lens } = ctx.env
  const offers: MarketOffer[] = [{ kind: 'per_use', licence: 'commercial', price_usd_micros: PER_USE_USD_MICROS }]
  if (l.rent === true) offers.push({ kind: 'rent', licence: 'commercial', price_usd_micros: RENT_USD_MICROS, period_days: RENT_DAYS })
  const pub = await lens.act<Listing>(who, 'POST', '/v1/workspaces/{ws}/marketplace/listings', { kind: 'prompt', title: l.title, description: '', visibility: 'public',
    artifact: l.artifact, changelog: '', offers, parents: l.parents ?? [] })
  ctx.evidence.push({ note: `${name} publishes "${l.title}"${(l.parents ?? []).length > 0 ? ', declaring its parent' : ''}`, answer: said(pub) })
  if (!pub.ok) return `${name}'s publish of "${l.title}" was refused: ${said(pub)}`
  if (pub.value.review_status !== 'approved') {
    if (!lens.canModerate) throw new CannotTest(`${name}'s listing was ${pub.value.review_status}, and approving it needs a moderator key: LENS_MODERATOR_KEY, from \`lens moderator-keys create\``)
    const ok = await lens.moderate(pub.value.id, 'approve')
    if (!ok.ok) return `approving ${name}'s held listing ${pub.value.id}: ${ok.status} ${ok.error}`
  }
  if (l.rent !== true) return { id: pub.value.id, rent: '' }
  const read = await lens.act<{ offers: MarketOffer[] | null }>(who, 'GET', `/v1/marketplace/listings/${pub.value.id}`)
  const rent = read.ok ? (read.value.offers ?? []).find((o) => o.kind === 'rent' && o.licence === 'commercial')?.id : undefined
  if (rent === undefined) return `${name}'s commercial rent offer cannot be read back: ${said(read)}`
  return { id: pub.value.id, rent }
}

/** An author lets others remix its listing at a royalty of `bps`: undefined once Lens says so. */
async function terms(ctx: ScenarioCtx, who: SyntheticUser, name: string, listing: string, bps: number): Promise<string | undefined> {
  const t = await ctx.env.lens.act<{ remix_policy: string; remix_share_bps: number }>(who, 'PUT', `/v1/workspaces/{ws}/marketplace/listings/${listing}/remix-terms`,
    { remix_policy: 'royalty', remix_share_bps: bps })
  ctx.evidence.push({ note: `${name} lets others remix it at a ${bps} bps royalty`, answer: said(t) })
  return t.ok && t.value.remix_policy === 'royalty' && t.value.remix_share_bps === bps ? undefined : `setting ${name}'s royalty remix terms at ${bps} bps: ${said(t)}`
}

/** An author accepts the remix licence of `parent`'s version 1: undefined when its grant locks the parent's share and opens the artifact. */
async function remix(ctx: ScenarioCtx, who: SyntheticUser, name: string, parentName: string, parent: string, bps: number): Promise<string | undefined> {
  const r = await ctx.env.lens.act<Remix>(who, 'POST', `/v1/workspaces/{ws}/marketplace/listings/${parent}/remix`, { version: 1 })
  ctx.evidence.push({ note: `${name} accepts ${parentName}'s remix licence`, answer: said(r) })
  return r.ok && r.value.grant?.share_bps === bps && r.value.artifact !== null && r.value.artifact !== undefined
    ? undefined : `${name} accepting ${parentName}'s remix licence should open its artifact under a grant at ${bps} bps: ${said(r)}`
}

/**
 * What is wrong with author `w`'s row of the rent `use`, once paid or once refunded: undefined when its earnings hold that
 * one row as the design splits it — reversed in whole once refunded — and its journal holds what that row leaves it.
 */
async function rowFault(ctx: ScenarioCtx, w: Want, use: string, reversed: boolean, before: MarketEarnings): Promise<string | undefined> {
  const { lens } = ctx.env
  const rows = (e: MarketEarnings) => (e.earnings ?? []).filter((x) => x.use_id === use)
  const settled = (e: MarketEarnings) => rows(e).length > 0 && (rows(e)[0].refunded_at !== undefined) === reversed
  const e = await until(() => lens.marketEarnings(w.user), settled, ROWS_WAIT_MS)
  const j = await lens.marketJournal(w.user)
  const mine = rows(e)
  ctx.evidence.push({ note: `${w.who}'s rows of the rent${reversed ? ', refunded' : ''}: ${JSON.stringify(mine)}; its journal ${JSON.stringify(j)}` })
  const r = mine[0]
  const what = w.kind === 'sale' ? `the sale, ${w.gross} µUSD gross with Talyvor's ${w.fee} fee,` : `a royalty of generation ${w.depth} naming ${w.who}'s listing ${w.listing},`
  if (mine.length !== 1 || r.kind !== w.kind || (r.depth ?? 0) !== w.depth || r.share_usd_micros !== w.share || (r.gross_usd_micros ?? 0) !== w.gross || (r.fee_usd_micros ?? 0) !== w.fee ||
    (w.kind === 'lineage' && r.original_listing_id !== w.listing)) {
    return `${w.who}'s earnings should hold one row for it, ${what} keeping ${w.share} µUSD; they hold ${JSON.stringify(mine)}`
  }
  if (reversed !== (r.refunded_at !== undefined)) return `${w.who}'s row ${reversed ? 'still reads unrefunded' : 'already reads refunded'}: ${JSON.stringify(r)}`
  const refunded = (e.refunded_usd_micros ?? 0) - (before.refunded_usd_micros ?? 0)
  if (refunded !== (reversed ? w.share : 0)) return `${w.who}'s earnings count ${refunded} µUSD more refunded; ${reversed ? `the reversal takes back its whole ${w.share}` : 'nothing is refunded yet'}`
  const held = j.holdback_usd_micros + j.available_usd_micros
  if (held !== (reversed ? 0 : w.share) || !j.reconciled) {
    return `${w.who}'s journal should hold ${reversed ? '0, its row reversed' : `its ${w.share} µUSD`} (holdback plus available) and reconcile; it reads ${JSON.stringify(j)}`
  }
  return undefined
}
