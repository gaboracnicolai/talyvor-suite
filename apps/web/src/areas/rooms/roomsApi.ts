import { getJSON } from '../../lib/api'
import { isSessionExpired } from '../../lib/productState'
import { type ListingKind, MarketError } from '../marketplace/marketApi'

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

/** Lens rooms.Wallet (B32.32) — the room's budget, shown to its members. Amounts are µLXC; -1 is unlimited. */
export interface RoomWallet {
  agent_id: string
  name: string
  balance_ulxc: number
  monthly_limit_ulxc: number
  spent_this_month_ulxc: number
  max_per_request_ulxc: number
  approval_above_ulxc: number
  budget_max_ulxc: number
  spend_policy: SpendPolicy
  may_spend: boolean
  why_not?: string
}

/** Lens rooms.Detail — GET /api/rooms/{id}; `me` is null when this workspace is not a member. */
export interface RoomDetail extends Room {
  terms: Terms
  members: Member[] | null
  agents: { agent_id: string; name: string; workspace_id: string }[] | null
  me: Member | null
  wallet?: RoomWallet
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

/** A price per use in µUSD, to the cent — or finer, when a use costs less than a cent. */
export function usdText(micros: number): string {
  if (micros <= 0) return 'Free'
  return `$${(micros / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`
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

async function post<T>(path: string, body: object, method = 'POST'): Promise<T> {
  const res = await fetch(path, {
    method,
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

/** Lens rooms.Message (B32.30). A run's refs say what ran, what it cost and who paid (B32.33). */
export interface RoomMessage {
  id: string
  cursor: number
  room_id: string
  author_workspace_id: string
  author_agent_id?: string
  kind: 'text' | 'contribution' | 'run' | 'prize' | 'system'
  body: string
  refs: RunRefs | Record<string, unknown> | null
  created_at: string
  edited_at?: string
  deleted_at?: string
}

/** A run message's refs: a use of a listing (`run: use`) or a question to the room's AI (`run: ask`). */
export interface RunRefs {
  run: 'use' | 'ask'
  pay: 'room' | 'self'
  payer_workspace_id: string
  charge?: string
  price_usd_micros?: number
  listing_id?: string
  contribution_id?: string
}

/** GET /api/rooms/{id}/messages: oldest first, and the room's event cursor as of the same read. */
export interface MessagePage {
  messages: RoomMessage[] | null
  more: boolean
  events_cursor: number
}

/** One room event: a message posted, edited or deleted, with the message as it now stands. */
export interface RoomEvent {
  cursor: number
  kind: 'message.posted' | 'message.edited' | 'message.deleted'
  ref: string
  at: string
  message?: RoomMessage
}

/** Lens rooms.Contribution (B32.31): a listing proposed to the room, with the members' votes. */
export interface Contribution {
  id: string
  room_id: string
  listing_id: string
  version: number
  kind: ListingKind
  title: string
  author_workspace_id: string
  forked_from?: string
  status: 'proposed' | 'accepted' | 'rejected'
  tally: number
  up: number
  down: number
  my_vote: number
  created_at: string
}

/** POST /api/rooms/{id}/contributions; a fork sends the same without kind, and what it leaves out stays the original's. */
export interface ContributionDraft {
  kind?: ListingKind
  title: string
  description: string
  artifact?: Record<string, unknown>
  changelog: string
  price_usd_micros?: number
}

/** POST /api/rooms/{id}/runs: what to run — a contribution's id or a listing's — and who pays. */
export interface RunRequest {
  target: string
  input: string
  variables: Record<string, string>
  model: string
  pay: 'room' | 'self'
}

/** Lens rooms.RunResult: the use, and the run message the room got. */
export interface RunResult {
  pay: 'room' | 'self'
  payer_workspace_id: string
  message?: RoomMessage
}

/** A message list with `m` in its place: replaced when it is there, else added in cursor order. */
export function upsertMessage(list: RoomMessage[], m: RoomMessage): RoomMessage[] {
  const at = list.findIndex((x) => x.id === m.id)
  if (at >= 0) return list.map((x, i) => (i === at ? m : x))
  return [...list, m].sort((a, b) => a.cursor - b.cursor)
}

/** The frames of a Server-Sent Events buffer that are complete, and what is left over. */
function sseFrames(buffer: string): { frames: { id?: string; event?: string; data: string }[]; rest: string } {
  const parts = buffer.replace(/\r\n/g, '\n').split('\n\n')
  const rest = parts.pop() ?? ''
  const frames = parts.map((p) => {
    const f: { id?: string; event?: string; data: string } = { data: '' }
    for (const line of p.split('\n')) {
      const i = line.indexOf(':')
      if (i <= 0) continue
      const field = line.slice(0, i)
      const value = line.slice(i + 1).replace(/^ /, '')
      if (field === 'id') f.id = value
      else if (field === 'event') f.event = value
      else if (field === 'data') f.data += value
    }
    return f
  })
  return { frames, rest }
}

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true })
  })

/**
 * Follows a room's events from `after` until `signal` aborts: each event to `onEvent`, in order. Lens ends each stream
 * after a while; this reconnects from the last cursor it saw, so nothing is lost and nothing comes twice. A room that
 * answers `gone` — this workspace was removed from it — ends the follow.
 */
export async function followRoom(id: string, after: number, onEvent: (e: RoomEvent) => void, signal: AbortSignal): Promise<void> {
  let cursor = after
  while (!signal.aborted) {
    let wait = 1000
    try {
      const res = await fetch(`/api/rooms/${e(id)}/events?after=${cursor}`, { headers: { Accept: 'text/event-stream' }, signal })
      if (!res.ok || !res.body) {
        if (res.status === 404) return
        wait = 5000
      } else {
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const split = sseFrames(buffer)
          buffer = split.rest
          for (const f of split.frames) {
            if (f.event === 'gone') return
            if (!f.data) continue
            const ev = JSON.parse(f.data) as RoomEvent
            cursor = Math.max(cursor, ev.cursor)
            onEvent(ev)
          }
        }
      }
    } catch {
      if (signal.aborted) return
      wait = 5000
    }
    await pause(wait, signal)
  }
}

/** Lens rooms.Invite (B32.29): a link, or a workspace the owner named. The token is in the answer that made it, only. */
export interface Invite {
  id: string
  room_id: string
  kind: 'link' | 'named'
  workspace_id?: string
  token?: string
  max_uses: number
  uses: number
  expires_at?: string
  revoked_at?: string
  live: boolean
  created_by_workspace_id: string
  created_at: string
}

/** Lens rooms.InvitePreview — what a live invite link opens. */
export interface InvitePreview {
  room: Room
  terms: Terms
  expires_at: string
  uses_left: number
}

/** Lens rooms.Prize (B32.35): posted by the owner, awarded to a contribution, or closed at its deadline unawarded. */
export interface Prize {
  id: string
  room_id: string
  poster_workspace_id: string
  title: string
  criteria: string
  amount_usd_micros: number
  deadline: string
  status: 'open' | 'awarded' | 'closed'
  contribution_id?: string
  winner_workspace_id?: string
  awarded_at?: string
  closed_at?: string
  created_at: string
}

/** PATCH /api/rooms/{id}/members/{ws}: one change at a time — a role, may_spend, or removing the member. */
export type MemberChange = { role: 'editor' | 'member' | 'viewer' } | { may_spend: boolean } | { remove: true }

/** The roles the owner or an editor can give; a room has one owner, the workspace that opened it. */
export const ROLES: readonly ['editor' | 'member' | 'viewer', string][] = [
  ['editor', 'Editor'],
  ['member', 'Member'],
  ['viewer', 'Viewer'],
]

/** Where an invite link's token is opened, on this site. */
export const inviteHref = (token: string) => `/rooms/invite/${encodeURIComponent(token)}`

export const roomsApi = {
  list: (topic = '') =>
    getJSON<RoomsList>(`/api/rooms${topic ? `?topic=${e(topic)}` : ''}`, { rooms: 'list', joined: 'list', invited: 'list' }),
  room: (id: string) =>
    getJSON<RoomDetail>(`/api/rooms/${e(id)}`, { id: 'string', title: 'string', terms: 'object' }),
  create: (draft: RoomDraft) => post<RoomDetail>('/api/rooms', draft),
  join: (id: string, termsVersion: number) => post<Member>(`/api/rooms/${e(id)}/join`, { terms_version: termsVersion }),
  // B32.54 — the room screen.
  messages: (id: string) => getJSON<MessagePage>(`/api/rooms/${e(id)}/messages?limit=100`, { messages: 'list', events_cursor: 'number' }),
  post: (id: string, body: string) => post<RoomMessage>(`/api/rooms/${e(id)}/messages`, { body }),
  contributions: async (id: string) =>
    (await getJSON<{ contributions: Contribution[] | null }>(`/api/rooms/${e(id)}/contributions`, { contributions: 'list' }))
      .contributions ?? [],
  propose: (id: string, draft: ContributionDraft) => post<Contribution>(`/api/rooms/${e(id)}/contributions`, draft),
  fork: (id: string, cid: string, draft: ContributionDraft) =>
    post<Contribution>(`/api/rooms/${e(id)}/contributions/${e(cid)}/fork`, draft),
  vote: (id: string, cid: string, value: 1 | -1) =>
    post<Contribution>(`/api/rooms/${e(id)}/contributions/${e(cid)}/vote`, { value }, 'PUT'),
  decide: (id: string, cid: string, status: 'accepted' | 'rejected') =>
    post<Contribution>(`/api/rooms/${e(id)}/contributions/${e(cid)}`, { status }, 'PATCH'),
  run: (id: string, req: RunRequest) => post<RunResult>(`/api/rooms/${e(id)}/runs`, req),
  // B32.55 — room settings.
  changeMember: (id: string, ws: string, change: MemberChange) =>
    post<Member>(`/api/rooms/${e(id)}/members/${e(ws)}`, change, 'PATCH'),
  setTerms: (id: string, terms: RoomDraft['terms']) => post<Terms>(`/api/rooms/${e(id)}/terms`, terms, 'PUT'),
  invites: async (id: string) =>
    (await getJSON<{ invites: Invite[] | null }>(`/api/rooms/${e(id)}/invites`, { invites: 'list' })).invites ?? [],
  createInvite: (id: string, maxUses: number, expiresAt: string) =>
    post<Invite>(`/api/rooms/${e(id)}/invites`, { max_uses: maxUses, expires_at: expiresAt }),
  revokeInvite: (id: string, iid: string) => post<Invite>(`/api/rooms/${e(id)}/invites/${e(iid)}`, {}, 'DELETE'),
  prizes: async (id: string) =>
    (await getJSON<{ prizes: Prize[] | null }>(`/api/rooms/${e(id)}/prizes`, { prizes: 'list' })).prizes ?? [],
  postPrize: (id: string, draft: { title: string; criteria: string; amount_usd_micros: number; deadline: string }) =>
    post<Prize>(`/api/rooms/${e(id)}/prizes`, draft),
  awardPrize: (id: string, pid: string, contributionID: string) =>
    post<{ prize: Prize }>(`/api/rooms/${e(id)}/prizes/${e(pid)}/award`, { contribution_id: contributionID }),
  previewInvite: (token: string) =>
    getJSON<InvitePreview>(`/api/room-invites/${e(token)}`, { room: 'object', terms: 'object', uses_left: 'number' }),
  joinByInvite: (token: string, termsVersion: number) =>
    post<{ room_id: string; member: Member }>(`/api/room-invites/${e(token)}/join`, { terms_version: termsVersion }),
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
