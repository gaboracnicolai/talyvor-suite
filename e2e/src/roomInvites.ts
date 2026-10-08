// B32.82 — a private room by invite link, and the Free plan's room limits (Lens B32.29), on Lens's API, once a run.
//
// A workspace of its own on Free opens as many public rooms as GET /v1/rooms says its plan allows (rooms_plan_limits'
// proposal: three), under a topic of the run's own, and is refused one more and a private one: each 402, its body naming
// rooms_plan_limits, the plan free, the limit and its max as GET /v1/rooms states them — and the refused rooms are not
// opened. Put on Team (Lens B35.1), it opens a private room. A second company reads that room: 404. The owner makes an
// invite link of two uses that lasts a day; the second company previews it (the room, its terms, two uses left) and joins
// through it. Lens's own reads are the oracle: the room's members are the owner and the second company, and the invite
// has one use and is still live. The owner revokes it, and a third company's preview and join are both 404 — the members
// are still two and the invite's uses still one. Every room it opened is closed by the operator at the end, so a nightly
// run leaves nothing in the directory people read.

import { fail } from './bank.ts'
import type { LensClient, SyntheticUser } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario, type ScenarioCtx, type Verdict } from './scenarios.ts'

/** The most public rooms the run opens to reach Free's limit: a larger limit is a setting this scenario does not fill. */
const MAX_PUBLIC = 5
/** How long the invite link admits anyone: a day, so it is the revoke that stops it. */
const LINK_LIFE_MS = 86_400_000

interface Limits { plan: string; public_rooms: number; private_rooms: number; public_rooms_open: number; private_rooms_open: number }
interface Member { workspace_id: string; role: string }
interface Detail { id: string; title: string; visibility: string; terms: { version: number }; members: Member[] | null; me: Member | null }
interface Invite { id: string; token?: string; max_uses: number; uses: number; live: boolean; revoked_at?: string }
interface Preview { room: { id: string; title: string }; terms: { version: number }; uses_left: number }
/** Lens's refusal under rooms_plan_limits (cmd/lens/rooms_handler.go writeRoomPlanLimit). */
interface PlanLimitRefusal { error: string; setting: string; plan: string; limit: string; max: number; allows: string }

/** One request as `who` makes it, with Lens's status and its whole body — a refusal is judged on every field. */
async function raw<T>(lens: LensClient, who: SyntheticUser, method: string, path: string, body?: unknown): Promise<{ status: number; body: T | undefined; text: string }> {
  const r = await lens.as(who.token, method, path.replace('{ws}', who.workspaceID), body)
  let parsed: T | undefined
  try {
    parsed = JSON.parse(r.text) as T
  } catch {
    parsed = undefined
  }
  return { status: r.status, body: parsed, text: r.text.slice(0, 400) }
}

async function limitsOf(ctx: ScenarioCtx, who: SyntheticUser): Promise<Limits> {
  const r = await ctx.env.lens.act<{ limits?: Limits }>(who, 'GET', '/v1/rooms')
  if (!r.ok || r.value.limits === undefined) throw new Error(`GET /v1/rooms states no room limits for ${who.workspaceID}: ${said(r)}`)
  return r.value.limits
}

async function detailOf(ctx: ScenarioCtx, who: SyntheticUser, id: string): Promise<Detail> {
  const r = await ctx.env.lens.act<Detail>(who, 'GET', `/v1/rooms/${encodeURIComponent(id)}`)
  if (!r.ok) throw new Error(`reading room ${id} as ${who.workspaceID}: ${said(r)}`)
  return r.value
}

async function inviteOf(ctx: ScenarioCtx, owner: SyntheticUser, room: string, inviteID: string): Promise<Invite | undefined> {
  const r = await ctx.env.lens.act<{ invites: Invite[] | null }>(owner, 'GET', `/v1/rooms/${encodeURIComponent(room)}/invites`)
  if (!r.ok) throw new Error(`reading room ${room}'s invites as its owner: ${said(r)}`)
  return (r.value.invites ?? []).find((i) => i.id === inviteID)
}

/** What is wrong with a refusal under rooms_plan_limits, judged on its whole body; undefined when it is Lens's. */
function wrongRefusal(r: { status: number; body: PlanLimitRefusal | undefined; text: string }, limit: string, max: number): string | undefined {
  const b = r.body
  if (r.status !== 402 || b === undefined) return `answered ${r.status} ${r.text}, not 402`
  if (b.setting !== 'rooms_plan_limits' || !b.error.includes('rooms_plan_limits')) return `402 not naming rooms_plan_limits: ${r.text}`
  if (b.plan !== 'free' || b.limit !== limit || b.max !== max) return `402 naming plan ${b.plan}, limit ${b.limit} at ${b.max} — not free's ${limit} at ${max}`
  return undefined
}

export function roomInviteLimits(i: number): Scenario {
  return {
    id: 'room-invite-limits',
    owner: 'talyvor-lens',
    feature: 'Rooms',
    own: true,
    title: "a Free workspace opens its plan's public rooms and is refused one more and a private one with 402 naming rooms_plan_limits; on Team it opens a private room, " +
      "404 to another company until it joins by an invite link, whose use Lens counts; revoked, the link previews and joins 404 for a third",
    run: async (ctx): Promise<Verdict> => {
      const { lens } = ctx.env
      if (!lens.canModerate) throw new CannotTest('needs a moderator key to close the public rooms it opens: LENS_MODERATOR_KEY, from `lens moderator-keys create`')
      const owner = ctx.app.user
      const topic = `e2e-room-limits-${RUN_SALT}`
      const opened: string[] = []
      const open = (visibility: 'public' | 'private', title: string) =>
        raw<{ id: string } & PlanLimitRefusal>(lens, owner, 'POST', '/v1/workspaces/{ws}/rooms',
          { title, topic, visibility, description: 'A nightly test room; the testers close it when they are done.' })
      try {
        // Free: its public rooms up to the limit Lens states, then one more and a private one refused.
        const free = await limitsOf(ctx, owner)
        ctx.evidence.push({ note: `GET /v1/rooms limits for ${owner.workspaceID}: ${JSON.stringify(free)}` })
        if (free.plan !== 'free') return fail(`the workspace made on Free reads plan ${free.plan} in GET /v1/rooms`)
        if (free.public_rooms_open !== 0 || free.private_rooms_open !== 0) return fail(`a new workspace already has rooms open: ${JSON.stringify(free)}`)
        if (!(free.public_rooms >= 1 && free.public_rooms <= MAX_PUBLIC)) throw new CannotTest(`Free allows ${free.public_rooms} public rooms: this scenario opens at most ${MAX_PUBLIC}`)
        if (free.private_rooms !== 0) throw new CannotTest(`Free allows ${free.private_rooms} private rooms: there is no private room to refuse it`)
        for (let n = 1; n <= free.public_rooms; n++) {
          const r = await open('public', `Room limits check ${i}-${RUN_SALT} ${n}`)
          ctx.evidence.push({ note: `public room ${n} of ${free.public_rooms} on Free: ${r.status} ${r.body?.id ?? r.text}` })
          if (r.status !== 201 || r.body?.id === undefined) return fail(`public room ${n} of the ${free.public_rooms} Free allows was answered ${r.status} ${r.text}`)
          opened.push(r.body.id)
        }
        const over = await open('public', `Room limits check ${i}-${RUN_SALT} one too many`)
        ctx.evidence.push({ note: `public room ${free.public_rooms + 1} on Free: ${over.status} ${over.text}` })
        if (over.body?.id !== undefined && over.status === 201) opened.push(over.body.id)
        const overWrong = wrongRefusal(over, 'public_rooms', free.public_rooms)
        if (overWrong) return fail(`a public room past Free's ${free.public_rooms} was ${overWrong}`)
        const priv = await open('private', `Room limits check ${i}-${RUN_SALT} private on Free`)
        ctx.evidence.push({ note: `a private room on Free: ${priv.status} ${priv.text}` })
        if (priv.body?.id !== undefined && priv.status === 201) opened.push(priv.body.id)
        const privWrong = wrongRefusal(priv, 'private_rooms', 0)
        if (privWrong) return fail(`a private room on Free was ${privWrong}`)
        const after = await limitsOf(ctx, owner)
        if (after.public_rooms_open !== free.public_rooms || after.private_rooms_open !== 0) {
          return fail(`after the two refusals Lens counts ${after.public_rooms_open} public and ${after.private_rooms_open} private rooms open, not ${free.public_rooms} and 0`)
        }

        // Team: a private room.
        const moved = await lens.setTestPlan(owner, 'team')
        ctx.evidence.push({ note: `the workspace put on Team: ${said(moved)}` })
        if (!moved.ok) return fail(`putting the workspace on Team was refused: ${said(moved)}`)
        const made = await open('private', `Invite link check ${i}-${RUN_SALT}`)
        ctx.evidence.push({ note: `a private room on Team: ${made.status} ${made.body?.id ?? made.text}` })
        if (made.status !== 201 || made.body?.id === undefined) return fail(`a private room on Team was answered ${made.status} ${made.text}`)
        const id = made.body.id
        opened.push(id)
        const room = `/v1/rooms/${encodeURIComponent(id)}`
        const [joiner, stranger] = await lens.createUsers(2)
        const unseen = await raw(lens, joiner, 'GET', room)
        ctx.evidence.push({ note: `another company (${joiner.workspaceID}) reads the private room: ${unseen.status}` })
        if (unseen.status !== 404) return fail(`another company read private room ${id}: ${unseen.status} ${unseen.text}`)

        // The invite link: previewed and joined through by the second company.
        const link = await lens.act<Invite>(owner, 'POST', `${room}/invites`, { max_uses: 2, expires_at: new Date(Date.now() + LINK_LIFE_MS).toISOString() })
        ctx.evidence.push({ note: `the owner makes an invite link of 2 uses: ${link.ok ? `${link.status} ${link.value.id}` : said(link)}` })
        if (!link.ok || link.value.token === undefined) return fail(`making an invite link was refused or carried no token: ${said(link)}`)
        const { token, id: inviteID } = link.value
        const linkPath = `/v1/room-invites/${encodeURIComponent(token)}`
        const preview = await raw<Preview>(lens, joiner, 'GET', linkPath)
        ctx.evidence.push({ note: `the second company previews the link: ${preview.status} ${preview.text}` })
        const terms = (await detailOf(ctx, owner, id)).terms.version
        if (preview.status !== 200 || preview.body?.room.id !== id || preview.body.terms.version !== terms || preview.body.uses_left !== 2) {
          return fail(`the link's preview was ${preview.status} ${preview.text} — not room ${id} at terms version ${terms} with 2 uses left`)
        }
        const joined = await raw<{ room_id: string; member: Member }>(lens, joiner, 'POST', `${linkPath}/join`, { terms_version: terms })
        ctx.evidence.push({ note: `the second company joins through the link: ${joined.status} ${joined.text}` })
        if (joined.status !== 201 || joined.body?.room_id !== id) return fail(`joining through the link was answered ${joined.status} ${joined.text}`)
        const members = (await detailOf(ctx, owner, id)).members ?? []
        const used = await inviteOf(ctx, owner, id, inviteID)
        ctx.evidence.push({ note: `Lens's members of ${id}: ${members.map((m) => `${m.workspace_id} ${m.role}`).join(', ')}; the invite: ${JSON.stringify(used)}` })
        const roleOf = (ws: string) => members.find((m) => m.workspace_id === ws)?.role
        if (members.length !== 2 || roleOf(owner.workspaceID) !== 'owner' || roleOf(joiner.workspaceID) !== 'member') {
          return fail(`after the join through the link Lens's members of ${id} are ${JSON.stringify(members)} — not its owner and ${joiner.workspaceID} as a member`)
        }
        if (used?.uses !== 1 || used.live !== true) return fail(`after one join through the link Lens holds the invite as ${JSON.stringify(used)}, not 1 use and still live`)
        const inside = await detailOf(ctx, joiner, id)
        if (inside.me?.role !== 'member') return fail(`the company that joined through the link reads its membership of ${id} as ${JSON.stringify(inside.me)}`)

        // Revoked: the third company's preview and join are 404, and nothing changes.
        const revoked = await lens.act<Invite>(owner, 'DELETE', `${room}/invites/${encodeURIComponent(inviteID)}`)
        ctx.evidence.push({ note: `the owner revokes the link: ${said(revoked)}` })
        if (!revoked.ok) return fail(`revoking the invite link was refused: ${said(revoked)}`)
        const late = await raw(lens, stranger, 'GET', linkPath)
        const lateJoin = await raw(lens, stranger, 'POST', `${linkPath}/join`, { terms_version: terms })
        ctx.evidence.push({ note: `a third company (${stranger.workspaceID}) with the revoked link: preview ${late.status}, join ${lateJoin.status} ${lateJoin.text}` })
        if (late.status !== 404) return fail(`the revoked link's preview was answered ${late.status} ${late.text}, not 404`)
        if (lateJoin.status !== 404) return fail(`joining through the revoked link was answered ${lateJoin.status} ${lateJoin.text}, not 404`)
        const still = (await detailOf(ctx, owner, id)).members ?? []
        const gone = await inviteOf(ctx, owner, id, inviteID)
        ctx.evidence.push({ note: `after the revoke, Lens's members of ${id}: ${still.length}; the invite: ${JSON.stringify(gone)}` })
        if (still.some((m) => m.workspace_id === stranger.workspaceID) || still.length !== 2) return fail(`after the revoke Lens's members of ${id} are ${JSON.stringify(still)}`)
        if (gone?.uses !== 1 || gone.live !== false || gone.revoked_at === undefined) return fail(`after the revoke Lens holds the invite as ${JSON.stringify(gone)}, not revoked with 1 use`)
        return {
          pass: true,
          detail: `Free opened ${free.public_rooms} public rooms and was refused one more (402 public_rooms ${free.public_rooms}) and a private one (402 private_rooms 0), both naming rooms_plan_limits; ` +
            `on Team private room ${id} was 404 to ${joiner.workspaceID} until it joined by link ${inviteID} (1 use, 2 members); revoked, the link's preview and join were 404 to ${stranger.workspaceID}`,
        }
      } finally {
        for (const id of opened) await lens.moderateRoom(id, 'close', 'a nightly test room, closed by the testers').catch(() => undefined)
      }
    },
  }
}
