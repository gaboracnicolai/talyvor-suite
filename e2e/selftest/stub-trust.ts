// B32.89 SELF-TEST — the stand-in Lens's trust panel (Lens B32.49), as market-trust reads and writes it: a buyer's review
// of a listing (PUT …/marketplace/listings/{id}/review), the seller's reply (PUT …/reviews/{reviewID}/reply), the trust
// read (GET /v1/marketplace/listings/{id}/trust, and market_listing's trust over MCP), and the synthetic card link of
// talyvor-lens B32.102 (POST /v1/synthetic/workspaces/{ws}/card-link), which records one card on two test workspaces as
// though both had paid with it. Only a buyer with a billed use of the listing that was not refunded, and no card in common
// with its seller, may review it, and only such buyers' reviews are counted — asked at every read, as Lens asks. The Bank
// (stub-bank.ts) holds the listings and the uses; this desk keeps the reviews and the cards. Its defects:
//   review-refused-kept — a buyer who never paid is refused 403, but its review is written anyway, and counts once it pays
//   review-linked       — a buyer sharing a card with the seller may review, and is counted
//   trust-mcp-unreplied — market_listing's trust leaves the seller's replies out
//   card-link-missing   — no synthetic card link, as on a Lens without B32.102: 404

import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** A listing as the trust read needs it, visible to the viewer it was asked for; undefined when it is not. */
export interface TrustListing { id: string; workspace_id: string; latest_version: number }
export interface Lineage { ancestors: unknown[]; descendants: number }

interface StubReview {
  id: string; listing_id: string; buyer: string; rating: number; text: string; reply: string; replied_at?: string; created_at: string; updated_at: string
}

export interface TrustDeps {
  json: (res: ServerResponse, status: number, body: unknown) => void
  body: <T>(req: IncomingMessage) => Promise<T>
  broken: (name: string) => boolean
  /** The listing as `viewer` may see it. */
  listing: (id: string, viewer: string) => TrustListing | undefined
  /** Whether `buyer` has a billed use of the listing that was not refunded. */
  paid: (listingID: string, buyer: string) => boolean
  payoutsEnabled: (ws: string) => boolean
  lineage: (listingID: string) => Lineage
}

const MAX_TEXT = 4000

export class TrustDesk {
  private readonly reviews: StubReview[] = []
  /** Each test workspace's cards, as the hashes of their fingerprints. */
  private readonly cards = new Map<string, Set<string>>()
  private readonly d: TrustDeps

  constructor(d: TrustDeps) {
    this.d = d
  }

  private linked(a: string, b: string): boolean {
    const mine = this.cards.get(a)
    return mine !== undefined && [...(this.cards.get(b) ?? [])].some((c) => mine.has(c))
  }

  private counts(r: StubReview, seller: string): boolean {
    return this.d.paid(r.listing_id, r.buyer) && (!this.linked(seller, r.buyer) || this.d.broken('review-linked'))
  }

  private out(r: StubReview, replies = true): object {
    return { id: r.id, listing_id: r.listing_id, rating: r.rating, text: r.text, ...(replies && r.reply !== '' ? { reply: r.reply, replied_at: r.replied_at } : {}),
      created_at: r.created_at, updated_at: r.updated_at }
  }

  /** A listing's trust panel as `viewer` may see the listing (Lens market.Trust); undefined when it may not. MCP's leaves replies out under trust-mcp-unreplied. */
  trust(viewer: string, listingID: string, mcp = false): object | undefined {
    const l = this.d.listing(listingID, viewer)
    if (l === undefined) return undefined
    const payouts = this.d.payoutsEnabled(l.workspace_id)
    const counted = this.reviews.filter((r) => r.listing_id === l.id && this.counts(r, l.workspace_id))
    const stars = [0, 0, 0, 0, 0]
    for (const r of counted) stars[r.rating - 1]++
    const sum = counted.reduce((s, r) => s + r.rating, 0)
    const recent = [...counted].sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id)).slice(0, 20)
    const lineage = this.d.lineage(l.id)
    return {
      listing_id: l.id, version: l.latest_version,
      publisher: { workspace_id: l.workspace_id, verified: payouts, payouts_enabled: payouts, upheld_claims_12_months: 0, ...(payouts ? {} : { not_verified_because: ['payouts are not enabled'] }) },
      reviews: { count: counted.length, average: counted.length === 0 ? 0 : Math.round((sum / counted.length) * 100) / 100, stars,
        recent: recent.map((r) => this.out(r, !(mcp && this.d.broken('trust-mcp-unreplied')))) },
      eval: null, claims: { open: 0, upheld: 0, attributed: 0, rejected: 0 }, originals: lineage.ancestors, remixes: lineage.descendants,
    }
  }

  /** GET /v1/marketplace/listings/{id}/trust, as anyone signed in reads it. */
  publicRoute(res: ServerResponse, path: string, viewer: string): boolean {
    const m = /^\/v1\/marketplace\/listings\/([^/]+)\/trust$/.exec(path)
    if (m === null) return false
    const t = this.trust(viewer, m[1])
    if (t === undefined) return this.d.json(res, 404, { error: 'market: no such listing' }), true
    return this.d.json(res, 200, t), true
  }

  /** A buyer's review and the seller's reply under /v1/workspaces/{ws}; true when `rest` was one. */
  async route(req: IncomingMessage, res: ServerResponse, ws: string, rest: string, now: string): Promise<boolean> {
    const { json } = this.d
    let m = /^\/marketplace\/listings\/([^/]+)\/review$/.exec(rest)
    if (m !== null && req.method === 'PUT') {
      const b = await this.d.body<{ rating?: number; text?: string }>(req)
      const text = (b.text ?? '').trim()
      const rating = b.rating ?? 0
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) return json(res, 400, { error: 'market: invalid: rating must be 1 to 5' }), true
      if (text.length > MAX_TEXT) return json(res, 400, { error: `market: invalid: text must be at most ${MAX_TEXT} characters` }), true
      const l = this.d.listing(m[1], ws)
      if (l === undefined) return json(res, 404, { error: 'market: no such listing' }), true
      const paid = this.d.paid(l.id, ws)
      const may = l.workspace_id !== ws && paid && (!this.linked(l.workspace_id, ws) || this.d.broken('review-linked'))
      const had = this.reviews.find((x) => x.listing_id === l.id && x.buyer === ws)
      const fresh = (): StubReview => ({ id: `mrv_${randomBytes(8).toString('hex')}`, listing_id: l.id, buyer: ws, rating, text, reply: '', created_at: now, updated_at: now })
      if (!may) {
        if (!paid && had === undefined && this.d.broken('review-refused-kept')) this.reviews.push(fresh())
        return json(res, 403, { error: 'market: only a buyer who paid for a use or a licence of this listing, and is not linked to its seller, may review it' }), true
      }
      const r = had ?? fresh()
      if (had === undefined) this.reviews.push(r)
      else Object.assign(r, { rating, text, updated_at: now })
      return json(res, 200, this.out(r)), true
    }
    m = /^\/marketplace\/listings\/([^/]+)\/reviews\/([^/]+)\/reply$/.exec(rest)
    if (m !== null && req.method === 'PUT') {
      const reply = ((await this.d.body<{ reply?: string }>(req)).reply ?? '').trim()
      if (reply.length > MAX_TEXT) return json(res, 400, { error: `market: invalid: reply must be at most ${MAX_TEXT} characters` }), true
      const l = this.d.listing(m[1], ws)
      const r = this.reviews.find((x) => x.id === m?.[2] && x.listing_id === m[1])
      if (l === undefined || l.workspace_id !== ws || r === undefined) return json(res, 404, { error: 'market: not found' }), true
      Object.assign(r, { reply, replied_at: reply === '' ? undefined : now })
      return json(res, 200, this.out(r)), true
    }
    return false
  }

  /** POST /v1/synthetic/workspaces/{ws}/card-link {workspace_id}: one card recorded on both test workspaces (talyvor-lens B32.102). */
  async syntheticRoute(req: IncomingMessage, res: ServerResponse, path: string, isTest: (ws: string) => boolean): Promise<boolean> {
    const m = /^\/v1\/synthetic\/workspaces\/([^/]+)\/card-link$/.exec(path)
    if (m === null || req.method !== 'POST') return false
    if (this.d.broken('card-link-missing')) return this.d.json(res, 404, { error: 'not found' }), true
    const other = (await this.d.body<{ workspace_id?: string }>(req)).workspace_id ?? ''
    if (other === '' || other === m[1]) return this.d.json(res, 400, { error: 'body must be {"workspace_id": "<another test workspace>"}' }), true
    if (!isTest(m[1]) || !isTest(other)) return this.d.json(res, 403, { error: 'synthetic: both workspaces must be synthetic test workspaces' }), true
    const card = randomBytes(32).toString('hex')
    for (const ws of [m[1], other]) this.cards.set(ws, (this.cards.get(ws) ?? new Set<string>()).add(card))
    return this.d.json(res, 200, { workspace_id: m[1], linked_to: other }), true
  }
}
