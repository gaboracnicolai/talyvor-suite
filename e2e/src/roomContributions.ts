// B32.84 — a room's contributions (Lens B32.31), on Lens's API, once a run, on a Free workspace of its own.
//
// The owner opens a public room whose terms give a remix share of 1200 bps and a default price of 20000 µUSD a use, and
// a second company joins it. The owner proposes a prompt (POST /v1/rooms/{id}/contributions): the member reads its
// listing with the artifact (GET /v1/marketplace/listings/{listing_id}), a third company gets 404 for it, and the public
// catalog (GET /v1/marketplace/listings) does not list it. The member forks it with an edited artifact, votes +1 and then
// -1 on it, and the owner votes +1 and accepts it. Lens's reads are the oracle: the fork's lineage holds one room_fork
// edge to the original at the room's 1200 bps (market_lineage), the contribution counts one vote per member — the
// member's latest -1 and the owner's +1, a tally of 0 (room_votes) — it reads accepted, decided by the owner, beside the
// fork forked from it (room_contributions), and its one offer is per_use at the room's 20000 µUSD. The operator closes
// the room at the end, so a nightly run leaves nothing in the directory people read.

import { fail } from './bank.ts'
import type { LensClient, MarketOffer, SyntheticUser } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario, type Verdict } from './scenarios.ts'

/** The room's terms the item names: the original's share of a fork's sales, and a contribution's price when it names none. */
const REMIX_SHARE_BPS = 1200
const DEFAULT_PRICE_USD_MICROS = 20_000

/** Lens rooms.Contribution as POST, PUT …/vote, PATCH and GET /v1/rooms/{id}/contributions[/{cid}] answer it. */
interface Contribution {
  id: string; room_id: string; listing_id: string; version: number; kind: string; title: string; author_workspace_id: string
  forked_from?: string; status: string; decided_by_workspace_id?: string; tally: number; up: number; down: number; my_vote: number
}
/** Lens market.Listing as GET /v1/marketplace/listings/{id} answers it to one that may open its artifact. */
interface RoomListing {
  id: string; workspace_id: string; visibility: string; room_id?: string; review_status: string; offers: MarketOffer[] | null
  versions?: { version: number; artifact?: { template?: string } }[]
}
/** Lens market.Lineage: a listing's ancestors, nearest first, each edge with its share and where it came from. */
interface Lineage { listing_id: string; ancestors: { listing_id: string; version: number; child_listing_id: string; share_bps: number; source: string; depth: number }[] | null }

/** One request as `who` makes it: Lens's status and its whole body. */
async function raw<T>(lens: LensClient, who: SyntheticUser, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await lens.as(who.token, method, path, body, headers)
  let parsed: T | undefined
  try {
    parsed = JSON.parse(r.text) as T
  } catch {
    parsed = undefined
  }
  return { status: r.status, body: parsed, text: r.text.slice(0, 400) }
}

export function roomContributions(i: number): Scenario {
  return {
    id: 'room-contributions',
    owner: 'talyvor-lens',
    feature: 'Rooms',
    own: true,
    title: "a room's contribution is a listing its members read with the artifact, 404 to anyone else and never in the catalog, at the room's default price; " +
      `a member's fork of it records a room_fork lineage edge at the room's ${REMIX_SHARE_BPS} bps; each member's latest vote counts once and the owner accepts it`,
    run: async (ctx): Promise<Verdict> => {
      const { lens } = ctx.env
      if (!lens.canModerate) throw new CannotTest('needs a moderator key to close the public room it opens: LENS_MODERATOR_KEY, from `lens moderator-keys create`')
      const owner = ctx.app.user
      let opened: string | undefined
      const listing = (who: SyntheticUser, id: string) => raw<RoomListing>(lens, who, 'GET', `/v1/marketplace/listings/${encodeURIComponent(id)}`)
      /** A contribution the review holds is its author's alone: the operator approves it, as a moderator would. */
      const reviewed = async (who: SyntheticUser, c: Contribution, what: string): Promise<string | undefined> => {
        const own = await listing(who, c.listing_id)
        if (own.status !== 200 || own.body === undefined) return `the author of ${what} reads its listing ${c.listing_id} as ${own.status} ${own.text}`
        if (own.body.review_status === 'approved') return undefined
        const ok = await lens.moderate(c.listing_id, 'approve')
        ctx.evidence.push({ note: `${what} was ${own.body.review_status}; the operator approves it: ${said(ok)}` })
        return ok.ok ? undefined : `approving ${what}, held for review, was refused: ${said(ok)}`
      }
      try {
        const made = await lens.act<{ id: string; terms?: { remix_share_bps: number; default_price_usd_micros: number } }>(owner, 'POST', '/v1/workspaces/{ws}/rooms', {
          title: `Contributions check ${i}-${RUN_SALT}`, topic: `e2e-room-contributions-${RUN_SALT}`, visibility: 'public',
          description: 'A nightly test room; the testers close it when they are done.',
          terms: { remix_share_bps: REMIX_SHARE_BPS, default_price_usd_micros: DEFAULT_PRICE_USD_MICROS },
        })
        ctx.evidence.push({ note: `the owner (${owner.workspaceID}) opens a public room: ${said(made)}` })
        if (!made.ok) return fail(`opening a public room was refused: ${said(made)}`)
        const id = made.value.id
        opened = id
        const room = `/v1/rooms/${encodeURIComponent(id)}`
        const terms = (await lens.room(owner, id)).terms
        if (terms.remix_share_bps !== REMIX_SHARE_BPS || terms.default_price_usd_micros !== DEFAULT_PRICE_USD_MICROS) {
          return fail(`room ${id}'s terms read remix_share_bps ${terms.remix_share_bps} and default_price_usd_micros ${terms.default_price_usd_micros}, not the ${REMIX_SHARE_BPS} and ${DEFAULT_PRICE_USD_MICROS} it was opened with`)
        }
        const [member, stranger] = await lens.createUsers(2)
        const joined = await lens.act(member, 'POST', `${room}/join`, { terms_version: terms.version })
        ctx.evidence.push({ note: `a second company (${member.workspaceID}) joins: ${said(joined)}` })
        if (!joined.ok) return fail(`a second company joining the public room was refused: ${said(joined)}`)

        // The owner proposes a prompt: a listing the member reads with its artifact, 404 to a stranger, never in the catalog.
        const template = `List the three riskiest assumptions in this launch plan, one line each, most dangerous first: {{plan}} (room check ${RUN_SALT})`
        const proposed = await raw<Contribution>(lens, owner, 'POST', `${room}/contributions`,
          { kind: 'prompt', title: `Riskiest assumptions ${RUN_SALT}`, artifact: { template, model: ctx.env.judgeModel } }, { 'Idempotency-Key': `e2e-contribute-${id}` })
        ctx.evidence.push({ note: `the owner proposes a prompt: ${proposed.status} ${proposed.text}` })
        if (proposed.status !== 201 || proposed.body?.id === undefined) return fail(`the owner's contribution to its room was answered ${proposed.status} ${proposed.text}`)
        const original = proposed.body
        const held = await reviewed(owner, original, `the owner's contribution ${original.id}`)
        if (held !== undefined) return fail(held)
        const seen = await listing(member, original.listing_id)
        ctx.evidence.push({ note: `the member reads listing ${original.listing_id}: ${seen.status} ${seen.text}` })
        if (seen.status !== 200 || seen.body === undefined) return fail(`a member of room ${id} reads its contribution's listing ${original.listing_id} as ${seen.status} ${seen.text}`)
        if (seen.body.visibility !== 'room' || seen.body.room_id !== id) {
          return fail(`the contribution's listing reads visibility ${seen.body.visibility} in room ${seen.body.room_id}, not visibility room in ${id}`)
        }
        if (!seen.body.versions?.some((v) => v.version === original.version && v.artifact?.template === template)) {
          return fail(`a member of room ${id} reads listing ${original.listing_id} without its artifact: ${JSON.stringify(seen.body.versions).slice(0, 300)}`)
        }
        const offers = seen.body.offers ?? []
        if (offers.length !== 1 || offers[0].kind !== 'per_use' || offers[0].price_usd_micros !== DEFAULT_PRICE_USD_MICROS) {
          return fail(`the contribution named no price, and its listing's offers are ${JSON.stringify(offers)}, not one per_use offer at the room's ${DEFAULT_PRICE_USD_MICROS} µUSD`)
        }
        const unseen = await listing(stranger, original.listing_id)
        ctx.evidence.push({ note: `a third company (${stranger.workspaceID}) reads listing ${original.listing_id}: ${unseen.status} ${unseen.text}` })
        if (unseen.status !== 404 || unseen.text.includes('riskiest assumptions')) {
          return fail(`a company not in room ${id} read its contribution's listing ${original.listing_id}: ${unseen.status} ${unseen.text}`)
        }
        const catalog = await raw<{ listings: { id: string }[] | null }>(lens, stranger, 'GET', '/v1/marketplace/listings')
        if (catalog.status !== 200) return fail(`the public catalog was answered ${catalog.status} ${catalog.text}`)
        if ((catalog.body?.listings ?? []).some((l) => l.id === original.listing_id)) return fail(`the public catalog lists room ${id}'s contribution ${original.listing_id}`)

        // The member forks it: its own contribution, whose lineage is a room_fork edge at the room's remix share.
        const edited = `${template} — and for each, the cheapest test that would prove it wrong`
        const forked = await raw<Contribution>(lens, member, 'POST', `${room}/contributions/${encodeURIComponent(original.id)}/fork`,
          { title: `Riskiest assumptions, with tests ${RUN_SALT}`, artifact: { template: edited, model: ctx.env.judgeModel } }, { 'Idempotency-Key': `e2e-fork-${id}` })
        ctx.evidence.push({ note: `the member forks ${original.id}: ${forked.status} ${forked.text}` })
        if (forked.status !== 201 || forked.body?.id === undefined) return fail(`the member's fork of ${original.id} was answered ${forked.status} ${forked.text}`)
        const fork = forked.body
        if (fork.forked_from !== original.id || fork.author_workspace_id !== member.workspaceID || fork.listing_id === original.listing_id) {
          return fail(`the fork reads forked_from ${fork.forked_from}, author ${fork.author_workspace_id}, listing ${fork.listing_id}: not the member's own listing forked from ${original.id}`)
        }
        const forkHeld = await reviewed(member, fork, `the member's fork ${fork.id}`)
        if (forkHeld !== undefined) return fail(forkHeld)
        const tree = await raw<Lineage>(lens, member, 'GET', `/v1/marketplace/listings/${encodeURIComponent(fork.listing_id)}/lineage`)
        ctx.evidence.push({ note: `the fork's lineage: ${tree.status} ${tree.text}` })
        if (tree.status !== 200 || tree.body === undefined) return fail(`the fork's lineage was answered ${tree.status} ${tree.text}`)
        const parents = (tree.body.ancestors ?? []).filter((a) => a.depth === 1)
        const edge = parents[0]
        if (parents.length !== 1 || edge.listing_id !== original.listing_id || edge.version !== original.version || edge.child_listing_id !== fork.listing_id) {
          return fail(`the fork's lineage has parents ${JSON.stringify(parents)}, not the one edge to ${original.listing_id} version ${original.version}`)
        }
        if (edge.source !== 'room_fork' || edge.share_bps !== REMIX_SHARE_BPS) {
          return fail(`the fork's lineage edge to the original is ${edge.source} at ${edge.share_bps} bps, not room_fork at the room's ${REMIX_SHARE_BPS}`)
        }

        // The votes: the member's +1 replaced by its -1, the owner's +1; the owner accepts the contribution.
        const one = `${room}/contributions/${encodeURIComponent(original.id)}`
        for (const [who, value, name] of [[member, 1, 'the member'], [member, -1, 'the member'], [owner, 1, 'the owner']] as const) {
          const v = await lens.act<Contribution>(who, 'PUT', `${one}/vote`, { value })
          ctx.evidence.push({ note: `${name} votes ${value > 0 ? '+1' : '-1'}: ${said(v)}` })
          if (!v.ok) return fail(`${name}'s vote of ${value} on ${original.id} was refused: ${said(v)}`)
        }
        const decided = await lens.act<Contribution>(owner, 'PATCH', one, { status: 'accepted' })
        ctx.evidence.push({ note: `the owner accepts ${original.id}: ${said(decided)}` })
        if (!decided.ok) return fail(`the owner accepting ${original.id} was refused: ${said(decided)}`)

        // Read back from Lens: one vote per member, the latest counting, and the room's two contributions as they stand.
        const asMember = await raw<Contribution>(lens, member, 'GET', one)
        const asOwner = await raw<Contribution>(lens, owner, 'GET', one)
        ctx.evidence.push({ note: `GET ${one} as the member: ${asMember.text}; as the owner: ${asOwner.text}` })
        const m = asMember.body
        const o = asOwner.body
        if (asMember.status !== 200 || asOwner.status !== 200 || m === undefined || o === undefined) {
          return fail(`reading contribution ${original.id} back was answered ${asMember.status} to the member and ${asOwner.status} to the owner`)
        }
        if (m.up !== 1 || m.down !== 1 || m.tally !== 0 || m.my_vote !== -1 || o.my_vote !== 1) {
          return fail(`after the member's +1 then -1 and the owner's +1, contribution ${original.id} reads up ${m.up}, down ${m.down}, tally ${m.tally}, ` +
            `the member's vote ${m.my_vote} and the owner's ${o.my_vote} — not one vote per member, the latest counting: up 1, down 1, tally 0, -1 and +1`)
        }
        if (o.status !== 'accepted' || o.decided_by_workspace_id !== owner.workspaceID) {
          return fail(`after the owner accepted it, contribution ${original.id} reads ${o.status}, decided by ${o.decided_by_workspace_id ?? 'nobody'}`)
        }
        const all = await raw<{ contributions: Contribution[] | null }>(lens, owner, 'GET', `${room}/contributions`)
        const list = all.body?.contributions ?? []
        ctx.evidence.push({ note: `GET ${room}/contributions as the owner: ${all.status} ${list.map((c) => `${c.id} ${c.status}${c.forked_from ? ` forked from ${c.forked_from}` : ''}`).join(', ')}` })
        const theFork = list.find((c) => c.id === fork.id)
        if (all.status !== 200 || list.length !== 2 || !list.some((c) => c.id === original.id && c.status === 'accepted') ||
          theFork?.forked_from !== original.id || theFork.status !== 'proposed' || theFork.tally !== 0) {
          return fail(`room ${id}'s contributions read ${all.status} ${JSON.stringify(list).slice(0, 400)}, not the accepted original and the member's unvoted fork of it`)
        }
        return {
          pass: true,
          detail: `the owner's contribution ${original.id} was a listing the member read with its artifact at one per_use offer of ${DEFAULT_PRICE_USD_MICROS} µUSD, 404 to a stranger and not in the catalog; ` +
            `the member's fork ${fork.id} has one room_fork lineage edge to it at ${REMIX_SHARE_BPS} bps; after +1, -1 and the owner's +1 it reads up 1, down 1, tally 0, accepted by the owner`,
        }
      } finally {
        if (opened !== undefined) await lens.moderateRoom(opened, 'close', 'a nightly test room, closed by the testers').catch(() => undefined)
      }
    },
  }
}
