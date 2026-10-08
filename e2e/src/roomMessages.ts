// B32.83 — a room's messages (Lens B32.30), on Lens's API, once a run, on a Team workspace of its own.
//
// The owner opens a public room under a topic of the run's own and a second company joins it and opens the room's event
// stream (GET /v1/rooms/{id}/events). The owner posts, and the stream's data line carries that message — its id and its
// body — within two seconds of Lens answering the post. The member's message carrying an AWS access key is 422 naming
// the secret's kind (aws_access_key), and Lens holds no row of it. The member edits its own message and the owner deletes
// another of the member's, and GET /v1/rooms/{id}/messages reads the edit (the new body, edited) and the tombstone (an
// empty body, deleted by the owner). The owner's private room is 404 to a third company reading its messages. That third
// company joins the public room and posts as fast as it can: the message past LENS_ROOM_MESSAGES_PER_MINUTE is 429 with
// Retry-After, its body naming the setting and the number the company reached, and Lens holds exactly that many of its
// messages. The operator closes both rooms at the end, so a nightly run leaves nothing in the directory people read.

import { fail } from './bank.ts'
import type { LensClient, LensRoomMessage, RoomEventStream, SyntheticUser } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario, type Verdict } from './scenarios.ts'

/** How soon after Lens answers a post its event stream must carry the message (Lens reads its events once a second). */
const LIVE_MS = 2_000
/** The most messages the run posts to reach LENS_ROOM_MESSAGES_PER_MINUTE (default 20): a larger limit reads as a FAIL. */
const MAX_POSTS = 50
/** Posting past this is no longer "in a minute": the first message may have left Lens's window before the last. */
const MINUTE_BUDGET_MS = 50_000
const PER_MINUTE_SETTING = 'LENS_ROOM_MESSAGES_PER_MINUTE'

/** Lens's rooms.Message as GET /v1/rooms/{id}/messages reads it, with its edit and its tombstone. */
interface Row extends LensRoomMessage { edited_at?: string; deleted_at?: string; deleted_by_workspace_id?: string }
/** Lens's 422 for a public room's message the scan refused (cmd/lens/rooms_handler.go writeErr). */
interface ScanRefused { error: string; scan?: { secrets?: string[]; personal_data?: string[] } }
/** Lens's 429 for a member past LENS_ROOM_MESSAGES_PER_MINUTE. */
interface RateRefused { error: string; setting: string; per_minute: number }

/** An AWS access key's shape (Lens's aws_access_key pattern), made for this run so no key is ever written down. */
function awsKeyShaped(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  return 'AKIA' + Array.from({ length: 16 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
}

/** One request as `who` makes it: Lens's status, its Retry-After and its whole body. */
async function raw<T>(lens: LensClient, who: SyntheticUser, method: string, path: string, body?: unknown) {
  const r = await lens.as(who.token, method, path, body)
  let parsed: T | undefined
  try {
    parsed = JSON.parse(r.text) as T
  } catch {
    parsed = undefined
  }
  return { status: r.status, retryAfter: r.headers.get('Retry-After'), body: parsed, text: r.text.slice(0, 400) }
}

export function roomMessages(i: number): Scenario {
  return {
    id: 'room-messages',
    owner: 'talyvor-lens',
    feature: 'Rooms',
    plan: 'team',
    own: true,
    title: "a public room's message reaches another member's event stream within two seconds; a message carrying a key is 422 naming its kind and stored nowhere; " +
      "an author's edit and the owner's delete read back as the edit and a tombstone; a private room's messages are 404 to a stranger; " +
      `a member's message past ${PER_MINUTE_SETTING} is 429 naming it, and Lens holds only the messages it allowed`,
    run: async (ctx): Promise<Verdict> => {
      const { lens } = ctx.env
      if (!lens.canModerate) throw new CannotTest('needs a moderator key to close the public room it opens: LENS_MODERATOR_KEY, from `lens moderator-keys create`')
      const owner = ctx.app.user
      const topic = `e2e-room-messages-${RUN_SALT}`
      const opened: string[] = []
      let stream: RoomEventStream | undefined
      const open = async (visibility: 'public' | 'private') => {
        const r = await lens.act<{ id: string }>(owner, 'POST', '/v1/workspaces/{ws}/rooms',
          { title: `Messages check ${i}-${RUN_SALT} ${visibility}`, topic, visibility, description: 'A nightly test room; the testers close it when they are done.' })
        ctx.evidence.push({ note: `the owner (${owner.workspaceID}) opens a ${visibility} room: ${said(r)}` })
        if (r.ok) opened.push(r.value.id)
        return r
      }
      const rows = async (who: SyntheticUser, id: string) => (await lens.roomMessages(who, id)) as Row[]
      try {
        const pub = await open('public')
        if (!pub.ok) return fail(`opening a public room was refused: ${said(pub)}`)
        const id = pub.value.id
        const room = `/v1/rooms/${encodeURIComponent(id)}`
        const post = (who: SyntheticUser, body: string) => raw<Row & RateRefused & ScanRefused>(lens, who, 'POST', `${room}/messages`, { body })
        const [member, stranger] = await lens.createUsers(2)
        const terms = (await lens.room(owner, id)).terms.version
        const joined = await lens.act(member, 'POST', `${room}/join`, { terms_version: terms })
        ctx.evidence.push({ note: `a second company (${member.workspaceID}) joins: ${said(joined)}` })
        if (!joined.ok) return fail(`a second company joining the public room was refused: ${said(joined)}`)

        // Live: the member's event stream carries the owner's message within two seconds of the post.
        const opening = await lens.roomEvents(member, id)
        ctx.evidence.push({ note: `the member opens GET ${room}/events: ${opening.status}` })
        if (!opening.ok) return fail(`the member's event stream of room ${id} was refused: ${said(opening)}`)
        stream = opening.value
        const first = `First message of the live check ${RUN_SALT}`
        const sent = await post(owner, first)
        const answered = Date.now()
        ctx.evidence.push({ note: `the owner posts: ${sent.status} ${sent.body?.id ?? sent.text}` })
        if (sent.status !== 201 || sent.body?.id === undefined) return fail(`the owner's message in its public room was answered ${sent.status} ${sent.text}`)
        const firstID = sent.body.id
        const live = await stream.waitFor((e) => e.ref === firstID, LIVE_MS + 3_000)
        ctx.evidence.push({ note: `the member's stream: ${stream.seen.map((s) => `${s.event.kind} ${s.event.ref} +${s.at - answered}ms`).join(', ') || 'nothing'}` })
        if (live === undefined) return fail(`the member's event stream carried no event of message ${firstID} within ${(LIVE_MS + 3_000) / 1000}s of the post`)
        const late = live.at - answered
        if (late > LIVE_MS) return fail(`the member's event stream carried message ${firstID} ${late}ms after the post, not within ${LIVE_MS}ms`)
        if (live.event.kind !== 'message.posted' || live.event.message?.body !== first) {
          return fail(`the stream's data line for message ${firstID} was ${JSON.stringify(live.event).slice(0, 300)}, not message.posted carrying its body`)
        }
        stream.close()
        stream = undefined

        // A key in a public room: 422 naming its kind, and no row.
        const before = (await rows(owner, id)).map((m) => m.id)
        const leaked = `Here is the deploy key ${awsKeyShaped()} for the check ${RUN_SALT}`
        const scanned = await post(member, leaked)
        ctx.evidence.push({ note: `the member posts a message carrying an AWS access key: ${scanned.status} ${scanned.text}` })
        if (scanned.status !== 422) return fail(`a message carrying an AWS access key in a public room was answered ${scanned.status} ${scanned.text}, not 422`)
        if (!scanned.body?.error.includes('secret (aws_access_key)') || JSON.stringify(scanned.body.scan?.secrets) !== '["aws_access_key"]') {
          return fail(`the 422 for a message carrying an AWS access key does not name aws_access_key as the secret it found: ${scanned.text}`)
        }
        const afterScan = await rows(owner, id)
        if (afterScan.length !== before.length || afterScan.some((m) => !before.includes(m.id) || m.body.includes('AKIA'))) {
          return fail(`after the refused message Lens holds ${afterScan.length} messages in room ${id}, not the ${before.length} it held: ${JSON.stringify(afterScan.map((m) => m.body)).slice(0, 300)}`)
        }

        // The author's edit and the owner's delete, read back from Lens.
        const mine = await post(member, `The member's message ${RUN_SALT}, before its edit`)
        const theirs = await post(member, `The member's message ${RUN_SALT} the owner deletes`)
        if (mine.status !== 201 || mine.body?.id === undefined || theirs.status !== 201 || theirs.body?.id === undefined) {
          return fail(`the member's two messages were answered ${mine.status} ${mine.text} and ${theirs.status} ${theirs.text}`)
        }
        const edited = `The member's message ${RUN_SALT}, edited`
        const edit = await lens.act<Row>(member, 'PATCH', `${room}/messages/${encodeURIComponent(mine.body.id)}`, { body: edited })
        ctx.evidence.push({ note: `the member edits its message ${mine.body.id}: ${said(edit)}` })
        if (!edit.ok) return fail(`the member editing its own message was refused: ${said(edit)}`)
        const del = await lens.act<Row>(owner, 'DELETE', `${room}/messages/${encodeURIComponent(theirs.body.id)}`)
        ctx.evidence.push({ note: `the owner deletes the member's message ${theirs.body.id}: ${said(del)}` })
        if (!del.ok) return fail(`the owner deleting the member's message was refused: ${said(del)}`)
        const kept = await rows(stranger, id)
        const e = kept.find((m) => m.id === mine.body?.id)
        const t = kept.find((m) => m.id === theirs.body?.id)
        ctx.evidence.push({ note: `GET ${room}/messages as a third company: the edit ${JSON.stringify(e)}; the tombstone ${JSON.stringify(t)}` })
        if (e?.body !== edited || e.edited_at === undefined) return fail(`Lens reads the member's edited message as ${JSON.stringify(e)}, not its new body, edited`)
        if (t === undefined || t.body !== '' || t.deleted_at === undefined || t.deleted_by_workspace_id !== owner.workspaceID) {
          return fail(`Lens reads the message the owner deleted as ${JSON.stringify(t)}, not an empty tombstone deleted by ${owner.workspaceID}`)
        }

        // A private room's messages: 404 to a company not in it.
        const priv = await open('private')
        if (!priv.ok) return fail(`opening a private room on Team was refused: ${said(priv)}`)
        const privRoom = `/v1/rooms/${encodeURIComponent(priv.value.id)}`
        const inside = await raw<Row>(lens, owner, 'POST', `${privRoom}/messages`, { body: `A private message ${RUN_SALT}` })
        if (inside.status !== 201) return fail(`the owner's message in its private room was answered ${inside.status} ${inside.text}`)
        const unseen = await raw(lens, stranger, 'GET', `${privRoom}/messages`)
        ctx.evidence.push({ note: `a third company (${stranger.workspaceID}) reads the private room's messages: ${unseen.status} ${unseen.text}` })
        if (unseen.status !== 404 || unseen.text.includes('A private message')) return fail(`a company not in private room ${priv.value.id} read its messages: ${unseen.status} ${unseen.text}`)

        // The minute's limit: the third company posts until Lens refuses one.
        const join3 = await lens.act(stranger, 'POST', `${room}/join`, { terms_version: terms })
        if (!join3.ok) return fail(`the third company joining the public room was refused: ${said(join3)}`)
        const t0 = Date.now()
        let allowed = 0
        let refused: Awaited<ReturnType<typeof post>> | undefined
        for (let n = 1; n <= MAX_POSTS; n++) {
          const r = await post(stranger, `Rate check ${RUN_SALT} message ${n}`)
          if (r.status === 201) {
            allowed++
            continue
          }
          refused = r
          break
        }
        const took = Date.now() - t0
        ctx.evidence.push({ note: `the third company posted ${allowed} messages in ${took}ms, then: ${refused ? `${refused.status} Retry-After ${refused.retryAfter} ${refused.text}` : 'none refused'}` })
        if (refused === undefined) {
          if (took > MINUTE_BUDGET_MS) throw new CannotTest(`posting ${MAX_POSTS} messages took ${took}ms: they were not all in one minute`)
          return fail(`Lens took ${MAX_POSTS} messages in ${took}ms from one member and refused none (${PER_MINUTE_SETTING} defaults to 20)`)
        }
        const rb = refused.body
        if (refused.status !== 429) return fail(`message ${allowed + 1} in a minute was answered ${refused.status} ${refused.text}, not 429`)
        if (rb?.setting !== PER_MINUTE_SETTING || !rb.error.includes(PER_MINUTE_SETTING)) return fail(`the 429 does not name ${PER_MINUTE_SETTING}: ${refused.text}`)
        if (rb.per_minute !== allowed) return fail(`the 429 says a member posts ${rb.per_minute} messages a minute, but it came after ${allowed}`)
        if (!(Number(refused.retryAfter) >= 1)) return fail(`the 429 past ${PER_MINUTE_SETTING} says Retry-After ${refused.retryAfter}, not when to come back`)
        const posted = (await rows(owner, id)).filter((m) => m.author_workspace_id === stranger.workspaceID)
        if (posted.length !== allowed || posted.some((m) => m.body === `Rate check ${RUN_SALT} message ${allowed + 1}`)) {
          return fail(`Lens holds ${posted.length} of the third company's messages in room ${id}, not the ${allowed} it allowed`)
        }
        return {
          pass: true,
          detail: `the owner's message reached the member's event stream ${late}ms after the post; a message carrying an AWS access key was 422 naming aws_access_key, no row; ` +
            `the member's edit and the owner's delete read back as the edit and a tombstone; private room ${priv.value.id}'s messages were 404 to a stranger; ` +
            `message ${allowed + 1} in a minute was 429 naming ${PER_MINUTE_SETTING} (${rb.per_minute}, Retry-After ${refused.retryAfter}s) and Lens holds the ${allowed} allowed`,
        }
      } finally {
        stream?.close()
        for (const id of opened) await lens.moderateRoom(id, 'close', 'a nightly test room, closed by the testers').catch(() => undefined)
      }
    },
  }
}
