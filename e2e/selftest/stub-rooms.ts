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

interface Room {
  id: string; owner_workspace_id: string; title: string; topic: string; description: string; visibility: string; status: string
  terms: Terms; members: { workspace_id: string; role: string; terms_version: number; joined_at: string }[]
  created_at: string; last_activity_at: string
}

const rooms = new Map<string, Room>()

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
  workspace_id: m.workspace_id, role: m.role, may_spend: m.role === 'owner', terms_version: m.terms_version,
  terms_current: m.terms_version === r.terms.version, joined_at: m.joined_at,
})

const detail = (r: Room, ws: string) => {
  const me = r.members.find((m) => m.workspace_id === ws)
  return { ...view(r), terms: r.terms, members: r.members.map((m) => member(r, m)), agents: [], me: me === undefined ? null : member(r, me) }
}

/** Answers a rooms route for workspace `ws` on plan `plan`; false when `p` is not one. */
export async function roomsRoute(req: IncomingMessage, res: ServerResponse, p: string, url: URL, ws: string, plan: string): Promise<boolean> {
  const limits = LIMITS[plan] ?? LIMITS.free
  const owned = [...rooms.values()].filter((r) => r.owner_workspace_id === ws && r.status !== 'closed')
  if (p === '/v1/rooms' && req.method === 'GET') {
    const topic = (url.searchParams.get('topic') ?? '').toLowerCase()
    const all = [...rooms.values()].sort((a, b) => b.last_activity_at.localeCompare(a.last_activity_at))
    json(res, 200, {
      rooms: all.filter((r) => r.visibility === 'public' && r.status === 'open' && (topic === '' || r.topic.toLowerCase() === topic)).map(view),
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
      created_at: now, last_activity_at: now,
    }
    rooms.set(r.id, r)
    json(res, 201, detail(r, ws))
    return true
  }
  const one = /^\/v1\/rooms\/([^/]+)(\/join)?$/.exec(p)
  if (one === null) return false
  const r = rooms.get(decodeURIComponent(one[1]))
  if (r === undefined || (r.visibility === 'private' && !r.members.some((m) => m.workspace_id === ws))) {
    json(res, 404, { error: 'rooms: not found: no such room' })
    return true
  }
  if (one[2] === undefined && req.method === 'GET') return json(res, 200, detail(r, ws)), true
  if (one[2] === '/join' && req.method === 'POST') {
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
