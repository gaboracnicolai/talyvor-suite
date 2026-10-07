import { getJSON } from '../../lib/api'
import { isSessionExpired } from '../../lib/productState'
import { MarketError } from '../marketplace/marketApi'

// roomsApi.ts — B32.53: rooms, through the BFF's /api/rooms routes (apps/bff/rooms.go) to Lens's rooms
// (B32.28–B32.30). A room is an open chat where people and their agents build something together; its
// terms say how what is made in it is priced and shared. Prices are integer µUSD.
//
// A refusal carries Lens's own sentence — a rooms_plan_limits refusal names the plan and the plan that
// allows more — and the screen shows it as Lens words it.

/** Lens rooms.Room. */
export interface Room {
  id: string
  owner_workspace_id: string
  title: string
  topic: string
  description: string
  visibility: 'public' | 'private'
  status: string
  terms_version: number
  member_count: number
  created_at: string
  last_activity_at: string
}

export type SplitRule = 'owner_decides' | 'equal' | 'by_votes'
export type SpendPolicy = 'owner_only' | 'members_with_spend'

/** Lens rooms.Terms: one version of how a room's work is priced and shared. */
export interface Terms {
  version: number
  split_rule: SplitRule
  remix_share_bps: number
  default_price_usd_micros: number
  spend_policy: SpendPolicy
  created_at: string
}

/** Lens rooms.Member. */
export interface Member {
  workspace_id: string
  role: string
  may_spend: boolean
  terms_version: number
  terms_current: boolean
  joined_at: string
}

/** Lens rooms.Detail — GET /api/rooms/{id}; `me` is null when this workspace is not a member. */
export interface RoomDetail extends Room {
  terms: Terms
  members: Member[] | null
  agents: { agent_id: string; name: string; workspace_id: string }[] | null
  me: Member | null
}

/** Lens rooms.Usage — what this workspace's plan lets it open, beside what it has open. -1 is unlimited. */
export interface RoomLimits {
  plan: string
  limit_as: string
  public_rooms: number
  private_rooms: number
  public_rooms_open: number
  private_rooms_open: number
}

/** GET /api/rooms: the open public rooms by latest activity, and the rooms this workspace is in or invited to. */
export interface RoomsList {
  rooms: Room[] | null
  joined: Room[] | null
  invited: Room[] | null
  limits?: RoomLimits
}

/** Lens rooms.Draft — POST /api/rooms. */
export interface RoomDraft {
  title: string
  topic: string
  description: string
  visibility: 'public' | 'private'
  terms: {
    split_rule: SplitRule
    remix_share_bps: number
    default_price_usd_micros: number
    spend_policy: SpendPolicy
  }
}

export const SPLIT_RULES: readonly [SplitRule, string][] = [
  ['owner_decides', 'The owner decides'],
  ['equal', 'Equal shares'],
  ['by_votes', 'By members’ votes'],
]

export const SPEND_POLICIES: readonly [SpendPolicy, string][] = [
  ['owner_only', 'Only the owner'],
  ['members_with_spend', 'Members the owner lets spend'],
]

export const splitRuleText = (r: string) => SPLIT_RULES.find(([v]) => v === r)?.[1] ?? r
export const spendPolicyText = (p: string) => SPEND_POLICIES.find(([v]) => v === p)?.[1] ?? p

/** Where a room's text is kept, said before its first message (B32.30). */
export const STORED_NOTICE =
  'Messages in a room are stored by Talyvor and visible to its members — to everyone, in a public room.'

/** `12.5` → 1,250 basis points; empty is none. Null for anything that is not a share from 0 to 100 with two decimals at most. */
export function parseShare(text: string): number | null {
  if (text.trim() === '') return 0
  const m = /^\s*(\d{1,3})(?:\.(\d{1,2}))?\s*$/.exec(text)
  if (!m) return null
  const bps = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
  return bps <= 10_000 ? bps : null
}

export const shareText = (bps: number) => `${(bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`

/** Rooms of a topic, newest activity first, in the order Lens gave them. */
export function byTopic(rooms: Room[]): [string, Room[]][] {
  const out = new Map<string, Room[]>()
  for (const r of rooms) {
    const t = r.topic.trim() || 'Other'
    out.set(t, [...(out.get(t) ?? []), r])
  }
  return [...out]
}

async function post<T>(path: string, body: object): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let sentence = ''
    try {
      sentence = ((await res.json()) as { error?: string }).error ?? ''
    } catch {
      // a body that is not JSON carries no sentence
    }
    throw new MarketError(res.status, path, sentence)
  }
  return (await res.json()) as T
}

const e = encodeURIComponent

export const ROOMS_KEY = ['rooms']

export const roomsApi = {
  list: (topic = '') =>
    getJSON<RoomsList>(`/api/rooms${topic ? `?topic=${e(topic)}` : ''}`, { rooms: 'list', joined: 'list', invited: 'list' }),
  room: (id: string) =>
    getJSON<RoomDetail>(`/api/rooms/${e(id)}`, { id: 'string', title: 'string', terms: 'object' }),
  create: (draft: RoomDraft) => post<RoomDetail>('/api/rooms', draft),
  join: (id: string, termsVersion: number) => post<Member>(`/api/rooms/${e(id)}/join`, { terms_version: termsVersion }),
}

/**
 * Lens's sentence for a refusal, as Lens words it — a rooms_plan_limits refusal word for word, setting name first;
 * any other loses Lens's "rooms: …:" prefix. A fault says nothing happened.
 */
export function roomRefusal(err: unknown): string {
  if (isSessionExpired(err)) return 'Nothing happened — sign in again.'
  if (err instanceof MarketError && err.sentence && err.status < 500) {
    if (err.sentence.startsWith('rooms_plan_limits')) return err.sentence
    const s = err.sentence.replace(/^rooms: (invalid request: |not allowed: |conflict: |not found: )?/, '')
    return `${s.charAt(0).toUpperCase()}${s.slice(1)}${s.endsWith('.') ? '' : '.'}`
  }
  return 'Nothing happened. You can try again.'
}
