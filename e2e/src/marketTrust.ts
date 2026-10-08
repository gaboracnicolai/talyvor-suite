// B32.89 — the trust panel (Lens B32.49), on Lens's API, once a run, on workspaces of its own.
//
// A new seller publishes a prompt listing with one per_use commercial offer at 100,000 µUSD. A workspace that has never
// paid for it reviews it and is refused (PUT …/marketplace/listings/{id}/review, 403). Two new buyers each make one billed
// use of it (POST …/listings/{id}/use) and review it, 5 and 3; the seller replies to the 3 (PUT …/reviews/{id}/reply). A
// fourth workspace is linked to the seller by a card both paid with (talyvor-lens B32.102's synthetic card link), makes a
// billed use, and is refused too. The workspace refused first then pays for a use, and reviews nothing.
//
// Lens's reads are the oracle. Each paying buyer's bill holds its one billed use of the listing (market_uses), not
// refunded: what makes it a paying buyer. The trust read (GET /v1/marketplace/listings/{id}/trust) counts the reviews of
// paying buyers not linked to the seller (market_reviews), so it must read count 2, average 4, one 3 and one 5, its recent
// reviews exactly the two the buyers wrote, the seller's reply on the 3. The refused workspace has paid by then, so a row
// its refused review wrote would count; that it does not is how the read shows none was written. A linked buyer's row is
// hidden from every read whatever was written, so its refusal is its 403 and the count. MCP market_listing, called with
// an agent's own key, must answer the same trust.
//
// While Lens has no synthetic card link the linked buyer cannot be made: the scenario SKIPs naming it, after everything
// else has passed — a FAIL in the rest is still a FAIL.

import { isDeepStrictEqual } from 'node:util'
import { fail } from './bank.ts'
import type { Answered, Listing, SyntheticUser } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario, type ScenarioCtx } from './scenarios.ts'

/** The offer, µUSD a use, and a billed use's price in µLXC at the peg. */
const PER_USE_USD_MICROS = 100_000
const PRICE_ULXC = PER_USE_USD_MICROS * 10
/** The two paying buyers' ratings, and what the panel must make of them. */
const RATINGS = [5, 3] as const
const AVERAGE = 4
const STARS = [0, 0, 1, 0, 1]

/** Lens market.Review as the review routes and the trust read answer it. */
interface Review { id: string; listing_id: string; rating: number; text: string; reply?: string; replied_at?: string }
/** Lens market.Trust (B32.49). */
interface Trust {
  listing_id: string
  publisher: { workspace_id: string; verified: boolean }
  reviews: { count: number; average: number; stars: number[]; recent: Review[] | null }
  claims: Record<string, number>
}
/** Lens market.Use as the use route answers it. */
interface Use { id: string; listing_id: string; charge: string; price_ulxc: number }

export function marketTrust(seed: number): Scenario {
  return {
    id: 'market-trust',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Marketplace',
    title: "a listing's trust panel counts only paying buyers not linked to its seller: two buyers who paid for a use review it 5 and 3 and are counted, " +
      'average 4, with the seller\'s reply; a workspace that never paid and one sharing a card with the seller are refused and never counted; ' +
      "MCP market_listing's trust equals the read",
    run: async (ctx) => {
      const { lens } = ctx.env
      const [seller, first, second, stranger, linked] = await lens.createUsers(5)
      const id = await publish(ctx, seller, `Trusted ${seed}-${RUN_SALT}`)
      if (typeof id !== 'string') return fail(id.error)
      const review = (who: SyntheticUser, rating: number, text: string) =>
        lens.act<Review>(who, 'PUT', `/v1/workspaces/{ws}/marketplace/listings/${id}/review`, { rating, text })
      const refused = (what: string, r: Answered<Review>): string | undefined =>
        r.status === 403 ? undefined : `${what} must be refused 403 reviewing the listing; Lens answered ${said(r)}`

      // A use, billed: its market_uses row is the one line for the listing on its buyer's bill.
      const pay = async (who: SyntheticUser, what: string): Promise<Use | string> => {
        const u = await lens.act<Use>(who, 'POST', `/v1/workspaces/{ws}/marketplace/listings/${id}/use`, { variables: { word: 'trusted' } })
        ctx.evidence.push({ note: `${what} (${who.workspaceID}) uses the listing`, answer: said(u) })
        if (!u.ok) return `${what}'s use of the listing was refused: ${said(u)}`
        if (u.value.charge !== 'billed' || u.value.price_ulxc !== PRICE_ULXC) return `${what}'s use ${u.value.id} answered charge ${u.value.charge} at ${u.value.price_ulxc} µLXC, not billed at ${PRICE_ULXC}`
        const lines = ((await lens.marketBill(who)).lines ?? []).filter((l) => l.listing_id === id)
        ctx.evidence.push({ note: `${what}'s bill, the listing's lines`, answer: JSON.stringify(lines) })
        if (lines.length !== 1 || lines[0].use_id !== u.value.id || lines[0].price_ulxc !== PRICE_ULXC || lines[0].refunded_at !== undefined) {
          return `${what}'s bill should hold its use ${u.value.id} as the one line for the listing, ${PRICE_ULXC} µLXC, not refunded; it holds ${JSON.stringify(lines)}`
        }
        return u.value
      }

      // A workspace that never paid is refused.
      const unpaid = await review(stranger, 5, 'Never bought it, still five stars.')
      ctx.evidence.push({ note: `a workspace that never paid (${stranger.workspaceID}) reviews it 5`, answer: said(unpaid) })
      const wrong = refused('a workspace that never paid', unpaid)
      if (wrong !== undefined) return fail(wrong)

      // Two buyers pay for a use each.
      const buyers = [[first, 'the first buyer'], [second, 'the second buyer']] as const
      for (const [who, what] of buyers) {
        const u = await pay(who, what)
        if (typeof u === 'string') return fail(u)
      }

      // A buyer linked to the seller by a card both paid with pays for a use, and is refused.
      const link = await lens.linkCard(linked, seller)
      ctx.evidence.push({ note: `a fourth workspace (${linked.workspaceID}) and the seller pay with one card (synthetic card link)`, answer: said(link) })
      const unlinkable = !link.ok && (link.status === 404 || link.status === 405)
        ? `this Lens has no synthetic card link (POST /v1/synthetic/workspaces/{ws}/card-link, talyvor-lens B32.102): ${link.status}` : undefined
      if (!link.ok && unlinkable === undefined) return fail(`linking a fourth workspace to the seller by a card was refused: ${said(link)}`)
      if (unlinkable === undefined) {
        const u = await pay(linked, 'the buyer linked to the seller')
        if (typeof u === 'string') return fail(u)
        const r = await review(linked, 5, 'My own listing, five stars.')
        ctx.evidence.push({ note: 'the buyer linked to the seller reviews it 5', answer: said(r) })
        const no = refused('a buyer who paid for a use but shares a card with the seller', r)
        if (no !== undefined) return fail(no)
      }

      // The two paying buyers review it; the seller replies to the 3.
      const written: Review[] = []
      for (const [n, [who, what]] of buyers.entries()) {
        const text = `${what === 'the first buyer' ? 'Did exactly what it said' : 'Fine, a little slow'} (${RUN_SALT}).`
        const r = await review(who, RATINGS[n], text)
        ctx.evidence.push({ note: `${what} reviews it ${RATINGS[n]}`, answer: said(r) })
        if (!r.ok) return fail(`${what}, who paid for a use, reviewing it ${RATINGS[n]} was refused: ${said(r)}`)
        if (r.value.listing_id !== id || r.value.rating !== RATINGS[n] || r.value.text !== text) return fail(`${what}'s review reads ${JSON.stringify(r.value)}, not ${RATINGS[n]} "${text}" of ${id}`)
        written.push(r.value)
      }
      const replyText = `Thanks — it is faster now (${RUN_SALT}).`
      const replied = await lens.act<Review>(seller, 'PUT', `/v1/workspaces/{ws}/marketplace/listings/${id}/reviews/${written[1].id}/reply`, { reply: replyText })
      ctx.evidence.push({ note: `the seller replies to the ${RATINGS[1]}`, answer: said(replied) })
      if (!replied.ok || replied.value.id !== written[1].id || replied.value.reply !== replyText) return fail(`the seller's reply to review ${written[1].id} was answered ${said(replied)}`)

      // The workspace refused first now pays: a row its refused review wrote would count from here on.
      const late = await pay(stranger, 'the workspace refused first')
      if (typeof late === 'string') return fail(late)

      // The trust read counts the two, and MCP's market_listing answers the same.
      const read = await lens.act<Trust>(stranger, 'GET', `/v1/marketplace/listings/${id}/trust`)
      ctx.evidence.push({ note: 'the trust read', answer: said(read) })
      if (!read.ok) return fail(`reading the listing's trust panel: ${said(read)}`)
      const t = read.value
      const recent = t.reviews.recent ?? []
      const byID = new Map(recent.map((r) => [r.id, r]))
      const shown = `count ${t.reviews.count}, average ${t.reviews.average}, stars ${JSON.stringify(t.reviews.stars)}, recent ${JSON.stringify(recent.map((r) => [r.id, r.rating, r.reply ?? '']))}`
      if (t.listing_id !== id || t.publisher.workspace_id !== seller.workspaceID) return fail(`the trust read is of ${t.listing_id} published by ${t.publisher.workspace_id}, not ${id} by the seller ${seller.workspaceID}`)
      if (t.reviews.count > 2 || recent.length > 2) {
        return fail(`only the two paying buyers' reviews count, but the trust read holds more — a refused review was written (the workspace refused first has paid since${unlinkable === undefined ? ', and the linked buyer\'s refused one would be hidden' : ''}): ${shown}`)
      }
      if (t.reviews.count !== 2 || t.reviews.average !== AVERAGE || !isDeepStrictEqual(t.reviews.stars, STARS) || recent.length !== 2 || !written.every((w) => byID.has(w.id))) {
        return fail(`two paying buyers reviewed it ${RATINGS.join(' and ')} (${written.map((w) => w.id).join(', ')}): the trust read must count 2, average ${AVERAGE}, stars ${JSON.stringify(STARS)}, both reviews in recent; it reads ${shown}`)
      }
      if (byID.get(written[1].id)?.reply !== replyText || (byID.get(written[0].id)?.reply ?? '') !== '') {
        return fail(`the seller replied "${replyText}" to ${written[1].id} alone; the trust read shows ${shown}`)
      }
      const mcp = await marketListingTrust(ctx, stranger, id)
      if (typeof mcp === 'string') return fail(mcp)
      if (!isDeepStrictEqual(mcp, t)) return fail(`MCP market_listing's trust differs from the trust read: ${JSON.stringify(mcp)} against ${JSON.stringify(t)}`)

      const passed = `${written.length} paying buyers' billed uses on their bills, reviews ${written.map((w, n) => `${w.id} ${RATINGS[n]}`).join(' and ')} counted: ` +
        `count 2, average ${AVERAGE}, stars ${JSON.stringify(STARS)}, the seller's reply on the ${RATINGS[1]}; a workspace that never paid was refused 403 and, ` +
        `once it paid (${late.id}), still nothing of its counted`
      if (unlinkable !== undefined) throw new CannotTest(`the rest passed (${passed}), but a buyer sharing a card with the seller cannot be made: ${unlinkable}`)
      return { pass: true, detail: `${passed}; a buyer sharing a card with the seller paid for a use and was refused 403; MCP market_listing's trust equals the read` }
    },
  }
}

/** The seller publishes the listing with its one per_use offer, approved if the review holds it: its id. */
async function publish(ctx: ScenarioCtx, seller: SyntheticUser, title: string): Promise<string | { error: string }> {
  const { lens, judgeModel } = ctx.env
  const pub = await lens.act<Listing>(seller, 'POST', '/v1/workspaces/{ws}/marketplace/listings', { kind: 'prompt', title, description: '', visibility: 'public',
    artifact: { template: 'Reply with the single word: {{word}}', model: judgeModel }, changelog: '',
    offers: [{ kind: 'per_use', licence: 'commercial', price_usd_micros: PER_USE_USD_MICROS }] })
  ctx.evidence.push({ note: `the seller (${seller.workspaceID}) publishes "${title}" at ${PER_USE_USD_MICROS} µUSD a use`, answer: said(pub) })
  if (!pub.ok) return { error: `publishing "${title}" was refused: ${said(pub)}` }
  if (pub.value.review_status !== 'approved') {
    if (!lens.canModerate) throw new CannotTest(`the listing was ${pub.value.review_status}, and approving it needs a moderator key: LENS_MODERATOR_KEY, from \`lens moderator-keys create\``)
    const ok = await lens.moderate(pub.value.id, 'approve')
    if (!ok.ok) return { error: `approving the held listing ${pub.value.id}: ${said(ok)}` }
  }
  return pub.value.id
}

/** market_listing over MCP on an agent's own key, made for the purpose in `who`'s workspace: its trust, or what went wrong. */
async function marketListingTrust(ctx: ScenarioCtx, who: SyntheticUser, id: string): Promise<Trust | string> {
  const { lens } = ctx.env
  const agent = await lens.createAgent(who, `Trust reader ${RUN_SALT}`)
  const k = await lens.act<{ key: string }>(who, 'POST', `/v1/workspaces/{ws}/agents/${agent.id}/keys`, { name: 'market-trust' })
  if (!k.ok) return `issuing ${agent.name} a key was refused: ${said(k)}`
  const got = await lens.as(k.value.key, 'POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'market_listing', arguments: { listing_id: id } } })
  ctx.evidence.push({ note: `${agent.name} calls market_listing`, answer: `${got.status} ${got.text.slice(0, 1500)}` })
  try {
    const body = JSON.parse(got.text) as { result?: { content?: { text?: string }[]; isError?: boolean } }
    const text = body.result?.content?.[0]?.text
    if (got.status !== 200 || body.result?.isError === true || text === undefined) return `market_listing was answered ${got.status} ${got.text.slice(0, 300)}`
    const trust = (JSON.parse(text) as { trust?: Trust }).trust
    return trust ?? `market_listing's answer carries no trust: ${text.slice(0, 300)}`
  } catch {
    return `market_listing's answer is not JSON: ${got.status} ${got.text.slice(0, 300)}`
  }
}
