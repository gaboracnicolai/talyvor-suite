// B32.53 — Lens's rooms (B32.28–B32.29) in the stub Lens, as Chat's rail, the rooms directory, a new room and a
// room's first screen read and write them:
//
//   GET  /v1/rooms?topic=              {rooms, joined, invited, limits}
//   POST /v1/workspaces/{ws}/rooms     a room the workspace owns, the workspace its first member; past
//                                      rooms_plan_limits 402 with Lens's sentence
//   GET  /v1/rooms/{id}                the room, its terms, its members and the caller's membership; a private room
//                                      is 404 to anyone not in it
//   POST /v1/rooms/{id}/join           {terms_version}: joined, on the room's current terms (409 otherwise)
//
// STUB_BREAK=rooms opens a room without making its owner a member — so it is in nobody's rooms.
//
// B32.54 — and the room screen's reads and writes (Lens B32.30–B32.32), for a member of the room:
//
//   GET  /v1/rooms/{id}/messages            {messages, more, events_cursor}, oldest first
//   POST /v1/rooms/{id}/messages            {body}: the message, and a message.posted event
//   GET  /v1/rooms/{id}/events?after=       Server-Sent Events after the cursor (or Last-Event-ID), read twice a second
//   GET  /v1/rooms/{id}/contributions       {contributions}, newest first, each with its tally and the caller's vote
//   POST /v1/rooms/{id}/contributions       a contribution, and its contribution message
//   POST /v1/rooms/{id}/contributions/{c}/fork   the caller's contribution forked from c
//   PUT  /v1/rooms/{id}/contributions/{c}/vote   {value: 1 or -1}, the latest counting
//
// STUB_BREAK=room-stream answers the event stream with nothing — so a message posted elsewhere never reaches the screen.
//
// B32.55 — and room settings (Lens B32.28, B32.29, B32.32, B32.35), for the room's owner or an editor:
//
//   PATCH  /v1/rooms/{id}/members/{ws}          {role | may_spend | remove}; a viewer is never given may_spend
//   GET    /v1/rooms/{id}/invites               {invites}, never a token; POST {max_uses, expires_at} makes a link,
//   DELETE /v1/rooms/{id}/invites/{iid}         its token in that answer only; DELETE revokes it
//   GET    /v1/room-invites/{token}             what a live link opens; 404 once revoked, expired or used up
//   POST   /v1/room-invites/{token}/join        {terms_version}: joined through the link, which counts the use
//   GET    /v1/rooms/{id}/prizes                {prizes}; POST {title, criteria, amount_usd_micros, deadline}, the owner's,
//                                               refused 403 above what the budget has left less the open prizes
//   GET    /v1/workspaces/{ws}/agents/{wallet}/rules   the room wallet's rules; PUT refuses a monthly limit above the
//                                               owner's plan's room_budget_max_usd (or none) 402 naming rooms_plan_limits
//
// B32.91 — and room safety (Lens B32.52), for the moderation scenario:
//
//   POST   /v1/rooms/{id}/reports                 {reason, details}: 201; a public room reported by HIDE_AT workspaces
//   POST   /v1/rooms/{id}/messages/{m}/reports    leaves GET /v1/rooms and reads under_review until the operator reviews it
//   PATCH  /v1/rooms/{id}/members/{ws}            {banned: true|false}: a banned member is removed, its post and join 403
//   POST   /v1/rooms/{id}/runs                    {target, pay}: a run paid by the room is a line on the room wallet's
//   GET    /v1/workspaces/{ws}/agents/{wallet}/statement   statement; a closed room's run, post and join are 409
//   GET    /v1/admin/rooms/reports                the moderator key: the queue, with hide_at
//   POST   /v1/admin/rooms/{id}/moderate          {action: keep|close, reason}: its operator_audit row in the answer
//   GET    /v1/admin/operator-audit               403 to a moderator key, as Lens answers it
//
// STUB_BREAK=room-reports keeps a reported room listed; room-ban lets a banned member post; room-close refuses a closed
// room's run and spends its wallet anyway — each of them a defect the scenario must FAIL on.
//
// B28.295 — and the room screens' last routes (Lens B32.28, B32.29, B32.31, B32.33):
//
//   PUT    /v1/rooms/{id}/terms                 {split_rule, remix_share_bps, default_price_usd_micros, spend_policy}, the
//                                               owner's: the next version
//   GET    /v1/rooms/{id}/contributions/{c}     one, for a member
//   PATCH  /v1/rooms/{id}/contributions/{c}     {status: accepted or rejected}, by the owner or an editor
//   POST   /v1/rooms/{id}/runs                  a prompt run without a variable its template names is 400 naming it, and
//                                               moves nothing
//
// STUB_BREAK=room-invite-uses lets a one-use link admit again after its use; room-decide answers Accept and changes
// nothing; room-run-variables runs a prompt without its variable, on the room's wallet — each a defect room-invite-screen
// or room-decide-run must FAIL on.
//
// B32.83 — and a message's scan, edit, delete and the minute's limit (Lens B32.30):
//
//   POST   /v1/rooms/{id}/messages        in a public room a message carrying an AWS access key is 422 naming
//                                         aws_access_key, and stored nowhere; a member's 21st text message in a minute
//                                         is 429 naming LENS_ROOM_MESSAGES_PER_MINUTE, with Retry-After
//   PATCH  /v1/rooms/{id}/messages/{m}    {body}: its author's edit, and a message.edited event
//   DELETE /v1/rooms/{id}/messages/{m}    its author, or the room's owner or an editor: an empty tombstone, deleted by
//                                         the caller, and a message.deleted event
//
// STUB_BREAK=room-secret stores a public room's message carrying a key — a defect room-messages must FAIL on.
//
// B32.84 — and a contribution's listing and a fork's lineage (Lens B32.31), as room-contributions reads them:
//
//   GET    /v1/marketplace/listings/{l}          a contribution's listing with its artifact and one per_use offer, at the
//                                                price it named or the room's default, to its author and the room's
//                                                members; 404 to anyone else
//   GET    /v1/marketplace/listings/{l}/lineage  a fork's one room_fork edge to the version it forked, at the room's
//                                                remix share
//
// STUB_BREAK=room-fork-lineage records a fork's edge as a remix at the original's own remix share (0) — a defect
// room-contributions must FAIL on.
//
// B32.85 — and the room's wallet (Lens B32.32), as room-wallet reads it:
//
//   POST   /v1/workspaces/{ws}/rooms                    opens the room's wallet in the stub's Bank (setRoomWallets): an
//                                                       agent of kind room named "Room: <title>", with one key nobody holds
//   GET    /v1/rooms/{id}                               the wallet's balance, and may_spend: the owner, or under
//                                                       members_with_spend a member given may_spend; why_not otherwise
//   GET    /v1/workspaces/{ws}/agents/{wallet}/rules/history   a version for each rules saved, newest first
//
// STUB_BREAK=room-budget-saved answers a monthly limit above the plan's 402, and saves it anyway — a defect room-wallet
// must FAIL on.
//
// B32.86 — and runs in a room (Lens B32.33), as room-runs makes them:
//
//   POST   /v1/rooms/{id}/runs   {target, variables, pay}: paid room — by the owner, or a member given may_spend — a
//                                contribution's use is on the owner's bill with the room's wallet its agent, judged against
//                                the wallet's monthly limit (403 naming it past it); paid self it is on the member's bill;
//                                either way the room gets a run message whose refs name the use, the charge and the payer
//   POST   /v1/rooms/{id}/ask    {question, model, pay}: the room's AI answers, and the room gets a run message carrying
//                                the question and the answer
//
// STUB_BREAK=room-run-limit refuses a run past the wallet's monthly limit with 403, and bills it anyway — a defect
// room-runs must FAIL on.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'

const BREAK = process.env.STUB_BREAK ?? ''

/** rooms_plan_limits' proposed values (Lens LENS_ROOMS_PLAN_LIMITS): public and private rooms a workspace opens. -1 is unlimited. */
const LIMITS: Record<string, { public_rooms: number; private_rooms: number; members_per_room: number; agents_per_room: number; room_budget_max_usd: number }> = {
  free: { public_rooms: 3, private_rooms: 0, members_per_room: 50, agents_per_room: 10, room_budget_max_usd: 100 },
  team: { public_rooms: 25, private_rooms: 10, members_per_room: 250, agents_per_room: 50, room_budget_max_usd: 5000 },
  business: { public_rooms: -1, private_rooms: 100, members_per_room: 1000, agents_per_room: 250, room_budget_max_usd: 50000 },
}
const NEXT: Record<string, string> = { free: 'team', team: 'business' }

interface Terms { version: number; split_rule: string; remix_share_bps: number; default_price_usd_micros: number; spend_policy: string; created_at: string }

interface Invite { id: string; token: string; max_uses: number; uses: number; expires_at: string; revoked_at?: string; created_by_workspace_id: string; created_at: string }
interface Prize { id: string; room_id: string; poster_workspace_id: string; title: string; criteria: string; amount_usd_micros: number; deadline: string; status: string; created_at: string }

interface Room {
  id: string; owner_workspace_id: string; title: string; topic: string; description: string; visibility: string; status: string
  terms: Terms; members: { workspace_id: string; role: string; may_spend?: boolean; terms_version: number; joined_at: string }[]
  created_at: string; last_activity_at: string
  /** B32.55 — the owner's plan when it opened the room, its invites and prizes, and its wallet's rules. */
  plan: string; invites: Invite[]; prizes: Prize[]; walletRules: Record<string, unknown>
  /** B32.91 — its reports, the workspaces banned from it, and its wallet's statement lines, newest last. */
  reports: Report[]; banned: string[]; walletLines: { entry_id: string; kind: string; amount_ulxc: number; counterparty: string; ref: string; balance_after_ulxc: number; at: string }[]
  /** B32.85 — its wallet's rules as each save left them, newest first. */
  walletVersions: { version: number; rules: Record<string, unknown>; changed_by: string; change: string; created_at: string }[]
}

interface Report { id: string; ws: string; message_id?: string; reason: string; details: string; created_at: string; resolution?: string }

/** LENS_ROOM_REPORTS_HIDE's default: the workspaces whose open reports take a public room off the list. */
const HIDE_AT = 3
/** The workspaces with an open report of `r`, less any whose earlier report the operator kept (Lens openReporters). */
const openReporters = (r: Room) => new Set(r.reports.filter((x) => x.resolution === undefined && !r.reports.some((k) => k.ws === x.ws && k.resolution === 'kept')).map((x) => x.ws)).size
const underReview = (r: Room) => r.visibility === 'public' && r.status === 'open' && openReporters(r) >= HIDE_AT
const closedRoom = { error: 'rooms: conflict: the room is closed' }
const bannedFrom = { error: "rooms: not allowed: the room's owner or an editor has banned you from this room" }
const audit: { id: number; actor: string; action: string; target: string; detail: string; occurred_at: string; recorded_at: string }[] = []

/** One LXC is ten cents at the peg: µLXC to µUSD. */
const ULXC_PER_USD = 10_000_000
const walletID = (r: Room) => 'ag_room_' + r.id.slice(5, 13)
const budgetMax = (r: Room) => {
  const usd = (LIMITS[r.plan] ?? LIMITS.free).room_budget_max_usd
  return usd < 0 ? -1 : usd * ULXC_PER_USD
}

const rooms = new Map<string, Room>()

/** B32.86 — a run's use as the stub's Bank records it on its buyer's bill. */
interface RoomUse { id: string; listing_id: string; charge: string; price_ulxc: number; agent_id: string; used_at: string }
/**
 * B32.85 — where a room's wallet is opened and what it holds: the stub's Bank, as stub-lens.ts sets it. B32.86 — and a
 * run's use on its buyer's bill, and what the wallet's billed uses cost this month.
 */
interface RoomWallets {
  open(ws: string, agentID: string, name: string): void; balance(agentID: string): number
  use(u: { listing_id: string; seller: string; buyer: string; agent_id: string; price_ulxc: number }): RoomUse; billed(agentID: string): number
}
let wallets: RoomWallets = { open: () => undefined, balance: () => 0, use: () => { throw new Error('stub rooms: no Bank to bill a run on') }, billed: () => 0 }
export function setRoomWallets(w: RoomWallets): void {
  wallets = w
}

interface Msg {
  id: string; cursor: number; room_id: string; author_workspace_id: string; kind: string; body: string; refs: Record<string, unknown>; created_at: string
  /** B32.83 — its edit and its tombstone. */
  edited_at?: string; deleted_at?: string; deleted_by_workspace_id?: string
}

/** LENS_ROOM_MESSAGES_PER_MINUTE's default, and Lens's aws_access_key pattern (internal/market/scan.go). */
const PER_MINUTE = 20
const AWS_KEY = /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/
/** Lens's 422 for a public room's message carrying a key, or undefined when the message may be posted (B32.83). */
const secretIn = (r: Room, text: string) => r.visibility !== 'public' || !AWS_KEY.test(text) || BREAK === 'room-secret' ? undefined : {
  error: 'this room is public and the message contains a secret (aws_access_key) — remove it and send it again',
  scan: { secrets: ['aws_access_key'], injection_risk: 0 },
}
interface Contribution {
  id: string; room_id: string; listing_id: string; version: number; kind: string; title: string; author_workspace_id: string
  forked_from?: string; status: string; message_id: string; votes: Map<string, number>; created_at: string
  /** B28.295 — a prompt's template, whose {{variables}} a run must give. */
  template: string
  /** B32.84 — its listing's artifact, its per_use price in µUSD, and who accepted or rejected it. */
  artifact: Record<string, unknown>; price: number; decided_by?: string
}

const messages = new Map<string, Msg[]>()
const events = new Map<string, { cursor: number; kind: string; ref: string; at: string; message: Msg }[]>()
const contributions = new Map<string, Contribution[]>()
let cursor = 0

function post(roomID: string, ws: string, body: string, kind = 'text', refs: Record<string, unknown> = {}): Msg {
  const at = new Date().toISOString()
  const m: Msg = { id: 'msg_' + randomBytes(8).toString('hex'), cursor: ++cursor, room_id: roomID, author_workspace_id: ws, kind, body, refs, created_at: at }
  messages.set(roomID, [...(messages.get(roomID) ?? []), m])
  happened(roomID, 'message.posted', m)
  return m
}

/** One of a room's events, carrying the message as it now reads. */
function happened(roomID: string, kind: string, m: Msg): void {
  events.set(roomID, [...(events.get(roomID) ?? []), { cursor: ++cursor, kind, ref: m.id, at: new Date().toISOString(), message: { ...m } }])
}

const contributionView = (c: Contribution, ws: string) => {
  const votes = [...c.votes.values()]
  return {
    id: c.id, room_id: c.room_id, listing_id: c.listing_id, version: c.version, kind: c.kind, title: c.title, author_workspace_id: c.author_workspace_id,
    ...(c.forked_from ? { forked_from: c.forked_from } : {}), status: c.status, ...(c.decided_by ? { decided_by_workspace_id: c.decided_by } : {}),
    message_id: c.message_id, tally: votes.reduce((a, b) => a + b, 0), up: votes.filter((v) => v > 0).length, down: votes.filter((v) => v < 0).length,
    my_vote: c.votes.get(ws) ?? 0, created_at: c.created_at,
  }
}

/** A room's event stream after `after`, held open for a while as Lens holds it. */
function stream(req: IncomingMessage, res: ServerResponse, roomID: string, after: number): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
  res.write('retry: 1000\n\n')
  let last = after
  const send = () => {
    if (BREAK === 'room-stream') return
    for (const e of (events.get(roomID) ?? []).filter((x) => x.cursor > last)) {
      res.write(`id: ${e.cursor}\ndata: ${JSON.stringify(e)}\n\n`)
      last = e.cursor
    }
  }
  send()
  const tick = setInterval(send, 500)
  const end = setTimeout(() => res.end(), 20_000)
  req.on('close', () => (clearInterval(tick), clearTimeout(end)))
}

/** The room screen's routes on a room `ws` is in; false when `p` is not one. */
async function roomScreen(req: IncomingMessage, res: ServerResponse, p: string, url: URL, ws: string, r: Room): Promise<boolean> {
  const sub = /^\/v1\/rooms\/[^/]+\/(messages|events|contributions)(?:\/([^/]+)(?:\/(fork|vote))?)?$/.exec(p)
  if (sub === null || (sub[2] !== undefined && sub[1] === 'events') || (sub[3] !== undefined && sub[1] !== 'contributions')) return false
  const [, what, cid, act] = sub
  if (what === 'messages' && req.method === 'GET') {
    return json(res, 200, { messages: messages.get(r.id) ?? [], more: false, events_cursor: cursor }), true
  }
  if (req.method !== 'GET' && r.status === 'closed') return json(res, 409, closedRoom), true
  if (what === 'messages' && req.method === 'POST') {
    if (r.banned.includes(ws) && BREAK !== 'room-ban') return json(res, 403, bannedFrom), true
    if (!r.members.some((m) => m.workspace_id === ws) && !(r.banned.includes(ws) && BREAK === 'room-ban')) {
      return json(res, 403, { error: 'rooms: not allowed: join the room to post in it' }), true
    }
    const text = String((await body(req)).body ?? '')
    if (text.trim() === '') return json(res, 400, { error: 'rooms: invalid request: a message needs a body' }), true
    const minute = (messages.get(r.id) ?? []).filter((m) => m.author_workspace_id === ws && m.kind === 'text' && Date.parse(m.created_at) > Date.now() - 60_000)
    if (minute.length >= PER_MINUTE) {
      const wait = Math.max(Math.round((Date.parse(minute[0].created_at) + 60_000 - Date.now()) / 1000), 1)
      res.setHeader('Retry-After', String(wait))
      return json(res, 429, { error: `rooms: a member posts at most ${PER_MINUTE} messages a minute in a room (LENS_ROOM_MESSAGES_PER_MINUTE); try again in ${wait}s`,
        setting: 'LENS_ROOM_MESSAGES_PER_MINUTE', per_minute: PER_MINUTE }), true
    }
    const secret = secretIn(r, text)
    if (secret !== undefined) return json(res, 422, secret), true
    return json(res, 201, post(r.id, ws, text)), true
  }
  if (what === 'messages' && cid !== undefined && (req.method === 'PATCH' || req.method === 'DELETE')) {
    const m = (messages.get(r.id) ?? []).find((x) => x.id === decodeURIComponent(cid))
    if (m === undefined) return json(res, 404, { error: 'rooms: not found: no such message in this room' }), true
    const role = r.members.find((x) => x.workspace_id === ws)?.role
    if (req.method === 'PATCH') {
      if (m.author_workspace_id !== ws) return json(res, 403, { error: 'rooms: not allowed: only its author edits a message' }), true
      if (m.deleted_at !== undefined) return json(res, 409, { error: 'rooms: conflict: the message was deleted' }), true
      const text = String((await body(req)).body ?? '')
      if (text.trim() === '') return json(res, 400, { error: 'rooms: invalid request: a message needs a body' }), true
      const secret = secretIn(r, text)
      if (secret !== undefined) return json(res, 422, secret), true
      if (text !== m.body) {
        Object.assign(m, { body: text, edited_at: new Date().toISOString() })
        happened(r.id, 'message.edited', m)
      }
      return json(res, 200, m), true
    }
    if (m.author_workspace_id !== ws && role !== 'owner' && role !== 'editor') {
      return json(res, 403, { error: "rooms: not allowed: only its author, or the room's owner or an editor, deletes a message" }), true
    }
    if (m.deleted_at === undefined) {
      Object.assign(m, { body: '', deleted_at: new Date().toISOString(), deleted_by_workspace_id: ws })
      happened(r.id, 'message.deleted', m)
    }
    return json(res, 200, m), true
  }
  if (what === 'messages' && cid !== undefined) return false
  if (what === 'events' && req.method === 'GET') {
    const from = url.searchParams.get('after') ?? String(req.headers['last-event-id'] ?? '')
    stream(req, res, r.id, from === '' ? cursor : Number(from))
    return true
  }
  const list = contributions.get(r.id) ?? []
  if (what === 'contributions' && cid === undefined && req.method === 'GET') {
    return json(res, 200, { contributions: list.map((c) => contributionView(c, ws)) }), true
  }
  const make = (d: Record<string, unknown>, from?: Contribution) => {
    const id = 'rc_' + randomBytes(8).toString('hex')
    const title = String(d.title || from?.title || '').trim()
    const kind = String(from?.kind ?? d.kind ?? 'prompt')
    const m = post(r.id, ws, `proposed a ${kind} “${title}”`, 'contribution', { contribution_id: id, ...(from ? { forked_from: from.id } : {}) })
    const template = String(((d.artifact ?? {}) as Record<string, unknown>).template ?? from?.template ?? '')
    const artifact = (d.artifact ?? from?.artifact ?? {}) as Record<string, unknown>
    const price = typeof d.price_usd_micros === 'number' ? d.price_usd_micros : r.terms.default_price_usd_micros
    const c: Contribution = { id, room_id: r.id, listing_id: 'lst_' + randomBytes(8).toString('hex'), version: 1, kind, title, author_workspace_id: ws,
      ...(from ? { forked_from: from.id } : {}), status: 'proposed', message_id: m.id, votes: new Map(), created_at: m.created_at, template, artifact, price }
    contributions.set(r.id, [c, ...list])
    return json(res, 201, contributionView(c, ws)), true
  }
  if (what === 'contributions' && cid === undefined && req.method === 'POST') {
    const d = await body(req)
    if (String(d.title ?? '').trim() === '') return json(res, 400, { error: 'rooms: invalid request: a contribution needs a title' }), true
    return make(d)
  }
  const c = list.find((x) => x.id === decodeURIComponent(cid ?? ''))
  if (c === undefined) return json(res, 404, { error: 'rooms: not found: no such contribution in this room' }), true
  if (act === 'fork' && req.method === 'POST') return make(await body(req), c)
  if (act === 'vote' && req.method === 'PUT') {
    const v = Number((await body(req)).value)
    if (v !== 1 && v !== -1) return json(res, 400, { error: 'rooms: invalid request: a vote is 1 or -1' }), true
    c.votes.set(ws, v)
    return json(res, 200, contributionView(c, ws)), true
  }
  if (act === undefined && req.method === 'GET') return json(res, 200, contributionView(c, ws)), true
  if (act === undefined && req.method === 'PATCH') {
    const role = r.members.find((m) => m.workspace_id === ws)?.role ?? ''
    if (role !== 'owner' && role !== 'editor') return json(res, 403, { error: 'rooms: not allowed: only the room’s owner or an editor decides a contribution' }), true
    const status = String((await body(req)).status ?? '')
    if (status !== 'accepted' && status !== 'rejected') return json(res, 400, { error: 'rooms: invalid request: status must be accepted or rejected' }), true
    if (BREAK !== 'room-decide') Object.assign(c, { status, decided_by: ws })
    return json(res, 200, { ...contributionView(c, ws), status }), true
  }
  return false
}

/** B32.84 — a contribution's listing, or its lineage, as `ws` reads it; false when `p` names no contribution's listing. */
export function roomListingRoute(res: ServerResponse, p: string, ws: string): boolean {
  const m = /^\/v1\/marketplace\/listings\/([^/]+)(\/lineage)?$/.exec(p)
  const c = m === null ? undefined : [...contributions.values()].flat().find((x) => x.listing_id === decodeURIComponent(m[1]))
  if (m === null || c === undefined) return false
  const r = rooms.get(c.room_id)
  if (r === undefined || (c.author_workspace_id !== ws && !r.members.some((x) => x.workspace_id === ws))) return json(res, 404, { error: 'market: not found: no such listing' }), true
  const siblings = contributions.get(r.id) ?? []
  const from = siblings.find((x) => x.id === c.forked_from)
  const edge = from === undefined ? undefined : { listing_id: from.listing_id, version: from.version, share_bps: BREAK === 'room-fork-lineage' ? 0 : r.terms.remix_share_bps,
    source: BREAK === 'room-fork-lineage' ? 'remix' : 'room_fork', created_at: c.created_at }
  if (m[2] !== undefined) {
    return json(res, 200, { listing_id: c.listing_id, version: c.version, remix_policy: 'none', remix_share_bps: 0,
      ancestors: edge === undefined ? [] : [{ ...edge, title: from?.title, child_listing_id: c.listing_id, child_version: c.version, depth: 1 }],
      descendants: siblings.filter((x) => x.forked_from === c.id).length, max_depth: 5 }), true
  }
  return json(res, 200, {
    id: c.listing_id, workspace_id: c.author_workspace_id, kind: c.kind, title: c.title, description: '', price_per_use_ulxc: c.price * 10, visibility: 'room',
    room_id: r.id, latest_version: c.version, created_at: c.created_at, updated_at: c.created_at, review_status: 'approved', remix_policy: 'none', remix_share_bps: 0,
    offers: c.price > 0 ? [{ id: 'off_' + c.listing_id.slice(4), kind: 'per_use', licence: 'commercial', price_usd_micros: c.price }] : [], capabilities: [],
    versions: [{ version: c.version, artifact_sha256: '', scan: {}, created_at: c.created_at, needs: { input: false, variables: [], model: String(c.artifact.model ?? '') },
      ...(edge === undefined ? {} : { parents: [edge] }), artifact: c.artifact }],
  }), true
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let s = ''
  for await (const chunk of req) s += chunk
  return (JSON.parse(s || '{}') as Record<string, unknown>) ?? {}
}

const view = (r: Room) => ({
  id: r.id, owner_workspace_id: r.owner_workspace_id, title: r.title, topic: r.topic, description: r.description,
  visibility: r.visibility, status: r.status, terms_version: r.terms.version, member_count: r.members.length,
  created_at: r.created_at, last_activity_at: r.last_activity_at,
})

const member = (r: Room, m: Room['members'][number]) => ({
  workspace_id: m.workspace_id, role: m.role, may_spend: m.role === 'owner' || m.may_spend === true, terms_version: m.terms_version,
  terms_current: m.terms_version === r.terms.version, joined_at: m.joined_at,
})

/** Lens whyNotSpend (B32.32): why member `me` may not spend the room's budget; '' when it may. */
const whyNotSpend = (r: Room, me: Room['members'][number]): string => {
  if (r.status === 'closed') return 'the room is closed, and its budget is spent no more'
  if (me.role === 'owner') return ''
  if (r.terms.spend_policy !== 'members_with_spend') return "the room's spend policy is owner_only: only its owner spends the room's budget"
  if (me.may_spend !== true) return "the room's owner has not given you may_spend: ask its owner or an editor"
  return ''
}

const detail = (r: Room, ws: string) => {
  const me = r.members.find((m) => m.workspace_id === ws)
  const whyNot = me === undefined ? '' : whyNotSpend(r, me)
  const wallet = me === undefined ? undefined : {
    agent_id: walletID(r), name: `Room: ${r.title}`, balance_ulxc: wallets.balance(walletID(r)), monthly_limit_ulxc: Number(r.walletRules.monthly_limit_ulxc ?? 0), spent_this_month_ulxc: 0,
    max_per_request_ulxc: 0, approval_above_ulxc: 0, budget_max_ulxc: budgetMax(r), spend_policy: r.terms.spend_policy, may_spend: whyNot === '',
    ...(whyNot === '' ? {} : { why_not: whyNot }),
  }
  return { ...view(r), terms: r.terms, members: r.members.map((m) => member(r, m)), agents: [], me: me === undefined ? null : member(r, me), ...(wallet ? { wallet } : {}),
    ...(underReview(r) ? { under_review: true } : {}) }
}

/** Answers a rooms route for workspace `ws` on plan `plan`; false when `p` is not one. */
export async function roomsRoute(req: IncomingMessage, res: ServerResponse, p: string, url: URL, ws: string, plan: string): Promise<boolean> {
  const limits = LIMITS[plan] ?? LIMITS.free
  const owned = [...rooms.values()].filter((r) => r.owner_workspace_id === ws && r.status !== 'closed')
  if (p === '/v1/rooms' && req.method === 'GET') {
    const topic = (url.searchParams.get('topic') ?? '').toLowerCase()
    const all = [...rooms.values()].sort((a, b) => b.last_activity_at.localeCompare(a.last_activity_at))
    json(res, 200, {
      rooms: all.filter((r) => r.visibility === 'public' && r.status === 'open' && (topic === '' || r.topic.toLowerCase() === topic) && (BREAK === 'room-reports' || !underReview(r))).map(view),
      joined: all.filter((r) => r.members.some((m) => m.workspace_id === ws)).map(view),
      invited: [],
      limits: { plan, limit_as: LIMITS[plan] === undefined ? 'free' : plan, ...limits,
        public_rooms_open: owned.filter((r) => r.visibility === 'public').length, private_rooms_open: owned.filter((r) => r.visibility === 'private').length },
    })
    return true
  }
  if (p === `/v1/workspaces/${ws}/rooms` && req.method === 'POST') {
    const d = await body(req)
    const visibility = d.visibility === 'private' ? 'private' : 'public'
    const title = String(d.title ?? '').trim()
    if (title === '') return json(res, 400, { error: 'rooms: invalid request: a room needs a title' }), true
    const max = visibility === 'public' ? limits.public_rooms : limits.private_rooms
    const open = owned.filter((r) => r.visibility === visibility).length
    if (max >= 0 && open >= max) {
      const noun = `${visibility} rooms`
      const allows = NEXT[plan] ?? ''
      const more = allows === '' ? ' — a contract with Talyvor sets more' : ` — the ${allows} plan allows ${LIMITS[allows][`${visibility}_rooms`] < 0 ? `unlimited ${noun}` : LIMITS[allows][`${visibility}_rooms`]}`
      json(res, 402, { error: `rooms_plan_limits (LENS_ROOMS_PLAN_LIMITS): your ${plan} plan allows ${max} ${noun}${more}`,
        setting: 'rooms_plan_limits', plan, limit: `${visibility}_rooms`, max, allows })
      return true
    }
    const t = (d.terms ?? {}) as Record<string, unknown>
    const now = new Date().toISOString()
    const r: Room = {
      id: 'room_' + randomBytes(12).toString('hex'), owner_workspace_id: ws, title, topic: String(d.topic ?? '').trim(),
      description: String(d.description ?? '').trim(), visibility, status: 'open',
      terms: { version: 1, split_rule: String(t.split_rule || 'owner_decides'), remix_share_bps: Number(t.remix_share_bps ?? 0),
        default_price_usd_micros: Number(t.default_price_usd_micros ?? 0), spend_policy: String(t.spend_policy || 'owner_only'), created_at: now },
      members: BREAK === 'rooms' ? [] : [{ workspace_id: ws, role: 'owner', terms_version: 1, joined_at: now }],
      created_at: now, last_activity_at: now, plan: LIMITS[plan] === undefined ? 'free' : plan, invites: [], prizes: [],
      walletRules: { max_per_request_ulxc: 0, daily_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 0, allowed_models: null,
        allowed_providers: null, active_from: '', active_until: '', timezone: '' },
      reports: [], banned: [], walletLines: [], walletVersions: [],
    }
    rooms.set(r.id, r)
    wallets.open(ws, walletID(r), `Room: ${title}`)
    json(res, 201, detail(r, ws))
    return true
  }
  if (await settingsOutsideRoom(req, res, p, ws)) return true
  const one = /^\/v1\/rooms\/([^/]+)(\/join)?$/.exec(p) ?? /^\/v1\/rooms\/([^/]+)()\/(?:messages|events|contributions|members|invites|prizes|reports|runs|ask|terms)/.exec(p)
  if (one === null) return false
  const r = rooms.get(decodeURIComponent(one[1]))
  if (r === undefined || (r.visibility === 'private' && !r.members.some((m) => m.workspace_id === ws))) {
    json(res, 404, { error: 'rooms: not found: no such room' })
    return true
  }
  if (await roomSafety(req, res, p, ws, r)) return true
  if (await roomAsk(req, res, p, ws, r)) return true
  if (await roomScreen(req, res, p, url, ws, r)) return true
  if (await roomSettings(req, res, p, ws, r)) return true
  if (one[2] === undefined && req.method === 'GET') return json(res, 200, detail(r, ws)), true
  if (one[2] === '/join' && req.method === 'POST') {
    if (r.banned.includes(ws)) return json(res, 403, bannedFrom), true
    if (r.status !== 'open') return json(res, 409, closedRoom), true
    const d = await body(req)
    if (d.terms_version !== r.terms.version) {
      json(res, 409, { error: `rooms: conflict: the room's terms are at version ${r.terms.version}; read them and join with terms_version ${r.terms.version}` })
      return true
    }
    const was = r.members.find((m) => m.workspace_id === ws)
    if (was !== undefined) return json(res, 200, member(r, was)), true
    const m = { workspace_id: ws, role: 'member', terms_version: r.terms.version, joined_at: new Date().toISOString() }
    r.members.push(m)
    json(res, 201, member(r, m))
    return true
  }
  return false
}

const inviteView = (r: Room, i: Invite, token = false) => ({
  id: i.id, room_id: r.id, kind: 'link', ...(token ? { token: i.token } : {}), max_uses: i.max_uses, uses: i.uses, expires_at: i.expires_at,
  ...(i.revoked_at ? { revoked_at: i.revoked_at } : {}), live: inviteLive(i), created_by_workspace_id: i.created_by_workspace_id, created_at: i.created_at,
})
const inviteLive = (i: Invite) => !i.revoked_at && Date.parse(i.expires_at) > Date.now() && i.uses < i.max_uses

/** B32.55 — what an invite link opens and joining through it, and the room wallet's rules; false when `p` is neither. */
async function settingsOutsideRoom(req: IncomingMessage, res: ServerResponse, p: string, ws: string): Promise<boolean> {
  const link = /^\/v1\/room-invites\/([^/]+)(\/join)?$/.exec(p)
  if (link !== null) {
    const token = decodeURIComponent(link[1])
    const r = [...rooms.values()].find((x) => x.invites.some((i) => i.token === token && inviteLive(i)))
    const i = r?.invites.find((x) => x.token === token)
    if (r === undefined || i === undefined) return json(res, 404, { error: 'rooms: not found: no such invite' }), true
    if (link[2] === undefined && req.method === 'GET') {
      return json(res, 200, { room: view(r), terms: r.terms, expires_at: i.expires_at, uses_left: i.max_uses - i.uses }), true
    }
    if (link[2] === '/join' && req.method === 'POST') {
      const d = await body(req)
      if (d.terms_version !== r.terms.version) return json(res, 409, { error: `rooms: conflict: the room's terms are at version ${r.terms.version}` }), true
      const was = r.members.find((m) => m.workspace_id === ws)
      if (was !== undefined) return json(res, 200, { room_id: r.id, member: member(r, was) }), true
      const m = { workspace_id: ws, role: 'member', terms_version: r.terms.version, joined_at: new Date().toISOString() }
      r.members.push(m)
      if (BREAK !== 'room-invite-uses') i.uses++
      return json(res, 201, { room_id: r.id, member: member(r, m) }), true
    }
    return false
  }
  const rules = /^\/v1\/workspaces\/([^/]+)\/agents\/(ag_room_[^/]+)\/(rules|rules\/history|statement)$/.exec(p)
  if (rules === null || rules[1] !== ws) return false
  const r = [...rooms.values()].find((x) => walletID(x) === rules[2] && x.owner_workspace_id === ws)
  if (r === undefined) return json(res, 404, { error: 'economy: agent not found' }), true
  if (rules[3] === 'statement') return req.method === 'GET' ? (json(res, 200, { agent_id: walletID(r), lines: [...r.walletLines].reverse() }), true) : false
  if (rules[3] === 'rules/history') return req.method === 'GET' ? (json(res, 200, { versions: r.walletVersions }), true) : false
  if (req.method === 'GET') return json(res, 200, r.walletRules), true
  if (req.method !== 'PUT') return false
  const d = await body(req)
  const monthly = Number(d.monthly_limit_ulxc ?? 0)
  const max = budgetMax(r)
  /** The rules saved, and their version (Lens recordRulesVersion), in the save's own transaction. */
  const save = () => {
    r.walletRules = { ...r.walletRules, ...d }
    r.walletVersions.unshift({ version: r.walletVersions.length + 1, rules: { ...r.walletRules }, changed_by: ws, change: 'set', created_at: new Date().toISOString() })
  }
  if (max >= 0 && (monthly <= 0 || monthly > max)) {
    if (BREAK === 'room-budget-saved') save()
    const usd = max / ULXC_PER_USD
    const allows = NEXT[r.plan] ?? ''
    const what = monthly <= 0 ? "a room's budget is its wallet's monthly limit, and it has none" : `a monthly limit of ${monthly / 1_000_000} LXC is above the room's budget`
    return json(res, 402, { error: `${what}: rooms_plan_limits (LENS_ROOMS_PLAN_LIMITS): your ${r.plan} plan allows a room a budget of at most $${usd} (${max / 1_000_000} LXC) a month${allows ? ` — the ${allows} plan allows $${LIMITS[allows].room_budget_max_usd}` : ''}`,
      setting: 'rooms_plan_limits', plan: r.plan, limit: 'room_budget_max_usd', max: usd, allows }), true
  }
  save()
  return json(res, 200, r.walletRules), true
}

/** B32.55 — a room's members, invites and prizes as its owner or an editor changes them; false when `p` is not one. */
async function roomSettings(req: IncomingMessage, res: ServerResponse, p: string, ws: string, r: Room): Promise<boolean> {
  if (p === `/v1/rooms/${r.id}/terms` && req.method === 'PUT') {
    if (!r.members.some((m) => m.workspace_id === ws && m.role === 'owner')) return json(res, 403, { error: 'rooms: not allowed: only the room’s owner changes its terms' }), true
    const d = await body(req)
    r.terms = { version: r.terms.version + 1, split_rule: String(d.split_rule || r.terms.split_rule), remix_share_bps: Number(d.remix_share_bps ?? 0),
      default_price_usd_micros: Number(d.default_price_usd_micros ?? 0), spend_policy: String(d.spend_policy || r.terms.spend_policy), created_at: new Date().toISOString() }
    const owner = r.members.find((m) => m.workspace_id === ws)
    if (owner !== undefined) owner.terms_version = r.terms.version
    return json(res, 200, r.terms), true
  }
  const sub = /^\/v1\/rooms\/[^/]+\/(members|invites|prizes)(?:\/([^/]+))?$/.exec(p)
  if (sub === null) return false
  const [, what, which] = sub
  const role = r.members.find((m) => m.workspace_id === ws)?.role ?? ''
  const manager = role === 'owner' || role === 'editor'
  if (what === 'prizes' && which === undefined && req.method === 'GET') return json(res, 200, { prizes: r.prizes }), true
  if (!manager) return json(res, 403, { error: 'rooms: not allowed: only the room’s owner or an editor does this' }), true
  if (what === 'members' && which !== undefined && req.method === 'PATCH') {
    const m = r.members.find((x) => x.workspace_id === decodeURIComponent(which))
    if (m === undefined) return json(res, 404, { error: 'rooms: not found: no such member' }), true
    if (m.role === 'owner') return json(res, 400, { error: "rooms: invalid request: the owner's membership does not change" }), true
    const d = await body(req)
    if (d.banned === true) {
      r.members = r.members.filter((x) => x !== m)
      if (!r.banned.includes(m.workspace_id)) r.banned.push(m.workspace_id)
      return json(res, 200, { ...member(r, m), banned_at: new Date().toISOString() }), true
    }
    if (d.remove === true) {
      r.members = r.members.filter((x) => x !== m)
      return json(res, 200, member(r, m)), true
    }
    if (typeof d.role === 'string') m.role = d.role
    if (typeof d.may_spend === 'boolean') {
      if (d.may_spend && m.role === 'viewer') return json(res, 400, { error: 'rooms: invalid request: a viewer cannot be given may_spend' }), true
      m.may_spend = d.may_spend
    }
    return json(res, 200, member(r, m)), true
  }
  if (what === 'invites' && which === undefined && req.method === 'GET') return json(res, 200, { invites: [...r.invites].reverse().map((i) => inviteView(r, i)) }), true
  if (what === 'invites' && which === undefined && req.method === 'POST') {
    if (r.visibility !== 'private') return json(res, 400, { error: 'rooms: invalid request: anyone may join a public room; invites are for private rooms' }), true
    const d = await body(req)
    const max = Number(d.max_uses ?? 0)
    if (!(max >= 1) || typeof d.expires_at !== 'string' || !(Date.parse(d.expires_at) > Date.now())) {
      return json(res, 400, { error: 'rooms: invalid request: a link invite needs max_uses (at least 1) and an expires_at in the future' }), true
    }
    const i: Invite = { id: 'rinv_' + randomBytes(12).toString('hex'), token: 'rinvtok_' + randomBytes(24).toString('base64url'), max_uses: max, uses: 0,
      expires_at: d.expires_at, created_by_workspace_id: ws, created_at: new Date().toISOString() }
    r.invites.push(i)
    return json(res, 201, inviteView(r, i, true)), true
  }
  if (what === 'invites' && which !== undefined && req.method === 'DELETE') {
    const i = r.invites.find((x) => x.id === decodeURIComponent(which))
    if (i === undefined) return json(res, 404, { error: 'rooms: not found: no such invite' }), true
    i.revoked_at ??= new Date().toISOString()
    return json(res, 200, inviteView(r, i)), true
  }
  if (what === 'prizes' && which === undefined && req.method === 'POST') {
    if (role !== 'owner') return json(res, 403, { error: 'rooms: not allowed: only the room’s owner posts a prize' }), true
    const d = await body(req)
    const amount = Number(d.amount_usd_micros ?? 0)
    if (String(d.title ?? '').trim() === '' || !(amount > 0)) return json(res, 400, { error: 'rooms: invalid request: a prize needs a title and an amount' }), true
    const left = Number(r.walletRules.monthly_limit_ulxc ?? 0) / 10 - r.prizes.filter((x) => x.status === 'open').reduce((n, x) => n + x.amount_usd_micros, 0)
    if (amount > left) return json(res, 403, { error: `rooms: a prize of $${amount / 1e6} is above what the room's budget has left this month ($${Math.max(0, left) / 1e6})` }), true
    const z: Prize = { id: 'rprz_' + randomBytes(12).toString('hex'), room_id: r.id, poster_workspace_id: ws, title: String(d.title).trim(), criteria: String(d.criteria ?? ''),
      amount_usd_micros: amount, deadline: String(d.deadline ?? ''), status: 'open', created_at: new Date().toISOString() }
    r.prizes.unshift(z)
    return json(res, 201, z), true
  }
  return false
}

/** B32.91 — reports of a room or a message, and a run in it; false when `p` is neither. */
async function roomSafety(req: IncomingMessage, res: ServerResponse, p: string, ws: string, r: Room): Promise<boolean> {
  const rep = /^\/v1\/rooms\/[^/]+(?:\/messages\/([^/]+))?\/reports$/.exec(p)
  if (rep !== null && req.method === 'POST') {
    const d = await body(req)
    const messageID = rep[1] === undefined ? undefined : decodeURIComponent(rep[1])
    if (messageID !== undefined && !(messages.get(r.id) ?? []).some((m) => m.id === messageID)) return json(res, 404, { error: 'rooms: not found: no such message' }), true
    const was = r.reports.find((x) => x.ws === ws && x.message_id === messageID && x.resolution === undefined)
    if (was !== undefined) return json(res, 200, { id: was.id, room_id: r.id, reason: was.reason, created_at: was.created_at, already_reported: true }), true
    const x: Report = { id: 'rrep_' + randomBytes(10).toString('hex'), ws, ...(messageID ? { message_id: messageID } : {}), reason: String(d.reason ?? ''),
      details: String(d.details ?? ''), created_at: new Date().toISOString() }
    r.reports.push(x)
    return json(res, 201, { id: x.id, room_id: r.id, ...(messageID ? { message_id: messageID } : {}), reason: x.reason, details: x.details, created_at: x.created_at }), true
  }
  if (p !== `/v1/rooms/${r.id}/runs` || req.method !== 'POST') return false
  const me = r.members.find((m) => m.workspace_id === ws)
  if (me === undefined) return json(res, 403, { error: 'rooms: not allowed: join the room to run things in it' }), true
  // STUB_BREAK=room-close: a closed room's run is refused, and its wallet is spent anyway — only the statement shows it.
  const closed = r.status === 'closed'
  if (closed && BREAK !== 'room-close') return json(res, 409, closedRoom), true
  const d = await body(req)
  const target = (contributions.get(r.id) ?? []).find((c) => c.id === String(d.target ?? ''))
  if (target === undefined) return json(res, 404, { error: 'market: not found: no such listing' }), true
  const pay = payOf(d)
  if (pay === undefined) return json(res, 400, { error: noPayer }), true
  const why = pay === 'room' && !closed ? whyNotSpend(r, me) : ''
  if (why !== '') return json(res, 403, { error: `rooms: not allowed: ${why}` }), true
  const given = (d.variables ?? {}) as Record<string, unknown>
  const missing = [...target.template.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((v) => v[1]).filter((v) => !(v in given))
  if (missing.length > 0 && BREAK !== 'room-run-variables') {
    return json(res, 400, { error: `market: invalid listing: the prompt needs the variables ${missing.join(', ')}` }), true
  }
  if (closed) return spendWallet(r, target.listing_id), json(res, 409, closedRoom), true
  // B32.86 — paid room the owner buys it with the room's wallet as its agent, judged against the wallet's monthly limit.
  const buyer = pay === 'room' ? r.owner_workspace_id : ws
  const agent = pay === 'room' ? walletID(r) : ''
  const bought = { listing_id: target.listing_id, seller: target.author_workspace_id, buyer, agent_id: agent, price_ulxc: target.price * 10 }
  const charge = buyer === target.author_workspace_id ? 0 : bought.price_ulxc
  const over = pay === 'room' ? pastMonthly(r, charge, `use of “${target.title}”`) : undefined
  if (over !== undefined) {
    if (BREAK === 'room-run-limit') wallets.use(bought)
    return json(res, 403, { error: over }), true
  }
  if (pay === 'room') spendWallet(r, target.listing_id)
  const u = wallets.use(bought)
  const output = `${target.template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, v: string) => String(given[v] ?? ''))} — answered.`
  const price = u.price_ulxc / 10
  const cost = u.charge === 'billed' ? `$${(price / 1e6).toFixed(2)} on the marketplace bill` : "no charge: the payer's own listing"
  const m = post(r.id, ws, `ran a ${target.kind} “${target.title}” ${paidBy(pay)} — ${cost}\n\n${output}`, 'run', { run: 'use', use_id: u.id, listing_id: u.listing_id,
    version: target.version, charge: u.charge, price_usd_micros: price, pay, payer_workspace_id: buyer, contribution_id: target.id, ...(agent === '' ? {} : { wallet_agent_id: agent }) })
  return json(res, 200, { use: { id: u.id, listing_id: u.listing_id, version: target.version, kind: target.kind, model: String(d.model || target.artifact.model || ''),
    charge: u.charge, price_ulxc: u.price_ulxc, output, used_at: u.used_at, ...(agent === '' ? {} : { agent_id: agent }) }, pay, payer_workspace_id: buyer, message: m }), true
}

/** B32.86 — a member's question to the room's AI, which reads the room's latest messages; false when `p` is not one. */
async function roomAsk(req: IncomingMessage, res: ServerResponse, p: string, ws: string, r: Room): Promise<boolean> {
  if (p !== `/v1/rooms/${r.id}/ask` || req.method !== 'POST') return false
  const me = r.members.find((m) => m.workspace_id === ws)
  if (me === undefined) return json(res, 403, { error: 'rooms: not allowed: join the room to run things in it' }), true
  if (r.status === 'closed') return json(res, 409, closedRoom), true
  const d = await body(req)
  const question = String(d.question ?? '').trim()
  const model = String(d.model ?? '').trim()
  if (question === '') return json(res, 400, { error: 'rooms: invalid request: ask a question' }), true
  if (model === '') return json(res, 400, { error: 'rooms: invalid request: name the model to ask ("model")' }), true
  const secret = secretIn(r, question)
  if (secret !== undefined) return json(res, 422, secret), true
  const pay = payOf(d)
  if (pay === undefined) return json(res, 400, { error: noPayer }), true
  const why = pay === 'room' ? whyNotSpend(r, me) : ''
  if (why !== '') return json(res, 403, { error: `rooms: not allowed: ${why}` }), true
  const over = pay === 'room' ? pastMonthly(r, MODEL_CALL_ULXC, 'request') : undefined
  if (over !== undefined) return json(res, 403, { error: over }), true
  if (pay === 'room') spendWallet(r, `ask:${model}`)
  const latest = (messages.get(r.id) ?? []).filter((m) => m.deleted_at === undefined).slice(-CONTEXT_MESSAGES)
  const answer = latest.length === 0 ? 'Nothing has been said in this room yet.'
    : `This room has ${latest.length} recent message(s); the latest says: ${latest[latest.length - 1].body.split('\n')[0]}`
  const buyer = pay === 'room' ? r.owner_workspace_id : ws
  const m = post(r.id, ws, `asked the room's AI ${paidBy(pay)}: ${question}\n\n${answer}`, 'run',
    { run: 'ask', model, pay, payer_workspace_id: buyer, ...(pay === 'room' ? { wallet_agent_id: walletID(r) } : {}) })
  return json(res, 200, { answer, pay, payer_workspace_id: buyer, message: m }), true
}

/** LENS_ROOM_CONTEXT_MESSAGES's default, and what one model call on the room's wallet costs the stub. */
const CONTEXT_MESSAGES = 30
const MODEL_CALL_ULXC = 1_000
const noPayer = 'rooms: invalid request: say who pays: "pay" is "room", the room\'s budget, or "self"'
const payOf = (d: Record<string, unknown>): 'room' | 'self' | undefined => d.pay === 'room' || d.pay === 'self' ? d.pay : undefined
const paidBy = (pay: string) => pay === 'room' ? "on the room's budget" : 'on their own account'

/** A model call made with the room wallet's key: a line on its statement. */
function spendWallet(r: Room, ref: string): void {
  const balance = r.walletLines.reduce((n, l) => n + l.amount_ulxc, 0) - MODEL_CALL_ULXC
  r.walletLines.push({ entry_id: 'je_' + randomBytes(8).toString('hex'), kind: 'agent_spend', amount_ulxc: -MODEL_CALL_ULXC, counterparty: 'models', ref,
    balance_after_ulxc: balance, at: new Date().toISOString() })
}

/** Lens's refusal of `amount` µLXC more on the room's wallet past its monthly limit (economy enforceAgentRules); undefined within it. */
function pastMonthly(r: Room, amount: number, what: string): string | undefined {
  const monthly = Number(r.walletRules.monthly_limit_ulxc ?? 0)
  const spent = wallets.billed(walletID(r)) - r.walletLines.reduce((n, l) => n + Math.min(l.amount_ulxc, 0), 0)
  if (monthly <= 0 || spent + amount <= monthly) return undefined
  const lxc = (u: number) => String(u / 1_000_000)
  return `economy: the agent's spending rules refuse this request: the agent has spent ${lxc(spent)} LXC of its monthly limit of ${lxc(monthly)} LXC, and this ${what} would cost up to ${lxc(amount)} LXC`
}

/** B32.91 — the operator's room routes behind the moderator key naming its operator; false when `p` is not one. */
export async function roomsModeratorRoute(req: IncomingMessage, res: ServerResponse, p: string, key: string, moderatorKey: string): Promise<boolean> {
  if (!p.startsWith('/v1/admin/rooms/') && p !== '/v1/admin/operator-audit') return false
  if (moderatorKey === '' || key !== moderatorKey) return json(res, 401, { error: 'admin credentials required' }), true
  const operator = String(req.headers['x-talyvor-operator'] ?? '').trim()
  if (operator === '') return json(res, 400, { error: 'a moderator key must name the operator it acts for in X-Talyvor-Operator' }), true
  if (p === '/v1/admin/operator-audit') return json(res, 403, { error: 'a moderator key may only use the marketplace review queue' }), true
  if (p === '/v1/admin/rooms/reports' && req.method === 'GET') {
    const open = [...rooms.values()].filter((r) => r.reports.some((x) => x.resolution === undefined))
    return json(res, 200, { rooms: open.map((r) => ({ room: view(r), reporters: openReporters(r), hidden: underReview(r),
      reports: r.reports.filter((x) => x.resolution === undefined) })), hide_at: HIDE_AT, setting: 'LENS_ROOM_REPORTS_HIDE' }), true
  }
  const mod = /^\/v1\/admin\/rooms\/([^/]+)\/moderate$/.exec(p)
  if (mod === null || req.method !== 'POST') return false
  const r = rooms.get(decodeURIComponent(mod[1]))
  if (r === undefined) return json(res, 404, { error: 'rooms: not found: no such room' }), true
  const d = await body(req)
  const action = String(d.action ?? '')
  const reason = String(d.reason ?? '').trim()
  if (action !== 'keep' && action !== 'close') return json(res, 400, { error: 'rooms: invalid request: action must be keep, lock, unlock or close' }), true
  if (action === 'close' && reason === '') return json(res, 400, { error: 'rooms: invalid request: say why the room is closed: reason' }), true
  if (action === 'close' && r.status === 'closed') return json(res, 409, { error: 'rooms: conflict: the room is already closed' }), true
  const open = r.reports.filter((x) => x.resolution === undefined)
  for (const x of open) x.resolution = action === 'keep' ? 'kept' : 'closed'
  if (action === 'close') {
    r.status = 'closed'
    post(r.id, '', 'Talyvor has closed this room: it takes no more messages, and its budget is spent no more.', 'system', { room_status: 'closed' })
  }
  const now = new Date().toISOString()
  const a = { id: audit.length + 1, actor: operator, action: `room.${action}`, target: r.id,
    detail: open.length > 0 ? `${reason} (resolved ${open.length} open reports)`.trim() : reason, occurred_at: now, recorded_at: now }
  audit.push(a)
  return json(res, 200, { room: view(r), resolved_reports: open.length, audit: a }), true
}
