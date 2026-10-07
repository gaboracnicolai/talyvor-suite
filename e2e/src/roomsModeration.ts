// B32.91 — ROOM SAFETY (Lens B32.52), on Lens's API, once a run. A workspace of the run's own opens a PUBLIC room under
// a topic of the run's own and posts in it. As many other test workspaces as Lens's LENS_ROOM_REPORTS_HIDE (default 3;
// the operator's room queue states it) report it — the first one reports the owner's message, the others the room —
// and the room is in GET /v1/rooms?topic= until the last report, and not after it, with GET /v1/rooms/{id} reading
// under_review. The operator keeps it (POST /v1/admin/rooms/{id}/moderate on the moderator key, X-Talyvor-Operator
// naming the testers) and it is listed again. A member that joined and posted is banned by the owner, and its next
// post is 403. The operator closes the room: another member's post and a run paid by the room are 409, and the room
// wallet's statement has no line it did not have before. Each operator action's operator_audit row names the testers.
// The room is closed at the end whatever happened, so a nightly run leaves nothing in the directory people read.

import { fail } from './bank.ts'
import type { OperatorAuditEntry, SyntheticUser } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario } from './scenarios.ts'

/** The operator the moderator key names in X-Talyvor-Operator (lens.ts moderator()). */
const OPERATOR = 'e2e-testers'
/** The most reporters the run makes for one room: LENS_ROOM_REPORTS_HIDE past this is a setting this scenario cannot reach. */
const MAX_REPORTERS = 10

export function roomsModeration(): Scenario {
  return {
    id: 'rooms-moderation',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Rooms',
    title: 'a public room reported by LENS_ROOM_REPORTS_HIDE workspaces leaves GET /v1/rooms and reads under_review until the operator keeps it; ' +
      "a banned member's post is 403; a closed room refuses a member's message and a run paid by the room with 409, and its wallet's statement gains no line; " +
      'the operator_audit rows name the testers',
    run: async (ctx) => {
      const { lens } = ctx.env
      if (!lens.canModerate) throw new CannotTest('needs a moderator key to keep and close a room: LENS_MODERATOR_KEY, from `lens moderator-keys create`')
      const owner = ctx.app.user
      const queue = await lens.roomReportQueue()
      ctx.evidence.push({ note: `the operator's room queue, GET /v1/admin/rooms/reports: ${queue.ok ? `hide_at ${queue.value.hide_at} (${queue.value.setting})` : said(queue)}` })
      if (!queue.ok) return fail(`the moderator key cannot read the operator's room queue: ${said(queue)}`)
      const hideAt = queue.value.hide_at
      if (!(hideAt >= 1 && hideAt <= MAX_REPORTERS)) throw new CannotTest(`LENS_ROOM_REPORTS_HIDE is ${hideAt}: this scenario makes at most ${MAX_REPORTERS} reporters`)

      const topic = `e2e-moderation-${RUN_SALT}`
      const made = await lens.act<{ id: string }>(owner, 'POST', '/v1/workspaces/{ws}/rooms',
        { title: `Moderation check ${RUN_SALT}`, topic, visibility: 'public', description: 'A nightly test room; the testers close it when they are done.' })
      ctx.evidence.push({ note: `the owner (${owner.workspaceID}) opens a public room under topic ${topic}: ${said(made)}` })
      if (!made.ok) return fail(`opening a public room was refused: ${said(made)}`)
      const id = made.value.id
      const room = `/v1/rooms/${encodeURIComponent(id)}`
      let closed = false
      try {
        const listed = async (who: SyntheticUser): Promise<boolean> => {
          const r = await lens.act<{ rooms: { id: string }[] | null }>(who, 'GET', `/v1/rooms?topic=${encodeURIComponent(topic)}`)
          if (!r.ok) throw new Error(`GET /v1/rooms?topic=${topic}: ${said(r)}`)
          return (r.value.rooms ?? []).some((x) => x.id === id)
        }
        const post = (who: SyntheticUser, body: string) => lens.act<{ id: string }>(who, 'POST', `${room}/messages`, { body })
        const first = await post(owner, `Welcome to the moderation check ${RUN_SALT}.`)
        if (!first.ok) return fail(`the owner's first message was refused: ${said(first)}`)
        if (!(await listed(owner))) return fail(`the new public room ${id} is not in GET /v1/rooms?topic=${topic}`)

        // The reports: one of the owner's message, the rest of the room, each from a workspace of its own.
        const others = await lens.createUsers(Math.max(hideAt, 2))
        const reporters = others.slice(0, hideAt)
        for (const [n, who] of reporters.entries()) {
          const before = await listed(who)
          if (!before) return fail(`after ${n} of ${hideAt} reports, room ${id} is already off GET /v1/rooms`)
          const rep = n === 0
            ? await lens.act(who, 'POST', `${room}/messages/${encodeURIComponent(first.value.id)}/reports`, { reason: 'spam', details: 'a nightly test report of a message' })
            : await lens.act(who, 'POST', `${room}/reports`, { reason: 'spam', details: 'a nightly test report of the room' })
          ctx.evidence.push({ note: `report ${n + 1} of ${hideAt}, ${n === 0 ? 'of the message' : 'of the room'}, by ${who.workspaceID}: ${said(rep)}` })
          if (rep.status !== 201) return fail(`report ${n + 1} of ${hideAt} by ${who.workspaceID} was answered ${said(rep)}, not 201`)
        }
        if (await listed(owner)) return fail(`reported by ${hideAt} workspaces (LENS_ROOM_REPORTS_HIDE), public room ${id} is still in GET /v1/rooms`)
        const hidden = await lens.room(owner, id)
        ctx.evidence.push({ note: `GET ${room} after ${hideAt} reports: status ${hidden.status}, under_review ${String(hidden.under_review)}` })
        if (hidden.under_review !== true) return fail(`reported by ${hideAt} workspaces, room ${id} reads under_review ${String(hidden.under_review)}`)

        // The operator keeps it, and it is listed again.
        const audits: OperatorAuditEntry[] = []
        const moderate = async (action: 'keep' | 'close', reason: string): Promise<string | undefined> => {
          const m = await lens.moderateRoom(id, action, reason)
          ctx.evidence.push({ note: `the operator's ${action}: ${said(m)}` })
          if (!m.ok) return `the operator's ${action} of room ${id} was refused: ${said(m)}`
          const a = m.value.audit
          if (a.action !== `room.${action}` || a.target !== id || a.actor !== OPERATOR || !(a.id > 0)) {
            return `the operator's ${action} wrote the operator_audit row ${JSON.stringify(a)}, not room.${action} on ${id} by ${OPERATOR}`
          }
          audits.push(a)
          return undefined
        }
        const kept = await moderate('keep', '')
        if (kept) return fail(kept)
        if (!(await listed(owner))) return fail(`kept by the operator, room ${id} is still off GET /v1/rooms`)
        if ((await lens.room(owner, id)).under_review === true) return fail(`kept by the operator, room ${id} still reads under_review`)

        // A member that joined and posted is banned, and its next post is refused.
        const terms = (await lens.room(owner, id)).terms.version
        const join = (who: SyntheticUser) => lens.act(who, 'POST', `${room}/join`, { terms_version: terms })
        const [banned, member] = others
        for (const who of [banned, member]) {
          const j = await join(who)
          if (!j.ok) return fail(`${who.workspaceID} joining the public room was refused: ${said(j)}`)
          const p = await post(who, `Hello from ${who.workspaceID} ${RUN_SALT}`)
          ctx.evidence.push({ note: `${who.workspaceID} joins (${j.status}) and posts: ${said(p)}` })
          if (p.status !== 201) return fail(`a member's post in the open room was answered ${said(p)}, not 201`)
        }
        const ban = await lens.act(owner, 'PATCH', `${room}/members/${encodeURIComponent(banned.workspaceID)}`, { banned: true })
        ctx.evidence.push({ note: `the owner bans ${banned.workspaceID}: ${said(ban)}` })
        if (!ban.ok) return fail(`the owner banning ${banned.workspaceID} was refused: ${said(ban)}`)
        const after = `Posted after the ban ${RUN_SALT}`
        const refused = await post(banned, after)
        ctx.evidence.push({ note: `the banned member posts: ${said(refused)}` })
        if (refused.status !== 403) return fail(`a banned member's post was answered ${said(refused)}, not 403`)
        if ((await lens.roomMessages(owner, id)).some((m) => m.body === after)) return fail(`the banned member's message is in room ${id}`)

        // The operator closes the room: a member's post and a run on its wallet are refused, and the wallet's statement is as it was.
        const work = await lens.act<{ id: string }>(owner, 'POST', `${room}/contributions`,
          { kind: 'prompt', title: `Closing check ${RUN_SALT}`, artifact: { template: `Say {{word}} back (${RUN_SALT}).` }, price_usd_micros: 0 })
        if (!work.ok) return fail(`proposing the contribution the closed room is asked to run was refused: ${said(work)}`)
        const wallet = (await lens.room(owner, id)).wallet
        if (wallet === undefined) return fail(`Lens shows the owner of room ${id} no wallet`)
        const before = await lens.agentLines(owner, wallet.agent_id)
        const shut = await moderate('close', 'a nightly test room, closed by the testers')
        if (shut) return fail(shut)
        closed = true
        const late = await post(member, `Posted after the close ${RUN_SALT}`)
        ctx.evidence.push({ note: `a member posts in the closed room: ${said(late)}` })
        if (late.status !== 409) return fail(`a member's post in a closed room was answered ${said(late)}, not 409`)
        const run = await lens.act(owner, 'POST', `${room}/runs`, { target: work.value.id, input: 'closed', variables: { word: 'closed' }, model: ctx.env.judgeModel, pay: 'room' })
        ctx.evidence.push({ note: `the owner runs the contribution on the closed room's wallet: ${said(run)}` })
        if (run.status !== 409) return fail(`a run paid by a closed room was answered ${said(run)}, not 409`)
        const now = await lens.agentLines(owner, wallet.agent_id)
        const had = new Set(before.map((l) => l.entry_id))
        const added = now.filter((l) => !had.has(l.entry_id))
        ctx.evidence.push({ note: `the room wallet ${wallet.agent_id}'s statement: ${before.length} lines before the run, ${now.length} after` })
        if (added.length > 0) return fail(`a run on closed room ${id} added ${added.length} line(s) to its wallet's statement: ${JSON.stringify(added).slice(0, 300)}`)

        // The audit log, where the moderator key may read it; Lens returns each action's operator_audit row with it either way.
        const log = await lens.operatorAudit(id)
        ctx.evidence.push({ note: `GET /v1/admin/operator-audit?target=${id}: ${log.ok ? (log.value.entries ?? []).map((e) => `${e.action} by ${e.actor}`).join(', ') : said(log)}` })
        if (log.ok) {
          for (const a of audits) {
            if (!(log.value.entries ?? []).some((e) => e.id === a.id && e.action === a.action && e.actor === OPERATOR)) {
              return fail(`the operator audit log for ${id} lacks ${a.action} by ${OPERATOR} (row ${a.id})`)
            }
          }
        }
        return {
          pass: true,
          detail: `public room ${id} stayed listed through ${hideAt - 1} report(s), left GET /v1/rooms and read under_review after ${hideAt}, and was listed again once kept; ` +
            `the banned member's post was 403; closed, it refused a member's post and a run on its wallet with 409 and its statement gained no line; ` +
            `operator_audit rows ${audits.map((a) => `${a.id} ${a.action}`).join(', ')} by ${OPERATOR}`,
        }
      } finally {
        if (!closed) await lens.moderateRoom(id, 'close', 'a nightly test room, closed by the testers after a failed check').catch(() => undefined)
      }
    },
  }
}
