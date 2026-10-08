// B28.295 — the room screens and routes no scenario reached on the 7 Oct map: the invite link's own screen
// (/rooms/invite/:token, apps/web/src/areas/rooms/RoomInvite.tsx) and the BFF routes behind it, the terms form in
// room settings, joining a private room by its id without a link, and on the room screen (Room.tsx) a contribution
// accepted and a run refused. Each runs on a Team workspace of its own (Free opens no private room), the way a person
// uses the screens; Lens's own reads are the oracle — the room's terms, its members, the invite's uses, the
// contribution's status and the workspace's ledger — never the screen alone.
//
//   room-invite-screen — the owner saves new terms on settings; another company, without the link, asks the BFF to join
//                        the room by its id and is refused with nothing joined; with it, the link's screen shows the
//                        room and the terms Lens holds, Join room joins on those terms and uses the link up, and the
//                        link opened again says it admits no one.
//   room-decide-run    — the owner accepts a contribution on the room screen and runs it on themselves without the
//                        variable its template needs: refused naming the variable, the screen asks for it, and the
//                        ledger and the room gain nothing.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { ACTION_TIMEOUT_MS, fail } from './bank.ts'
import type { SyntheticUser } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import type { Scenario, ScenarioCtx, Verdict } from './scenarios.ts'

const FEATURE = 'Rooms'
/** How long a refused run is given for anything it wrongly wrote to reach Lens's reads. */
const REFUSED_WAIT_MS = 5_000

interface Member { workspace_id: string; role: string; terms_version?: number }
interface Terms { version: number; default_price_usd_micros: number }
interface Detail { id: string; terms: Terms; members: Member[] | null }
interface Invite { id: string; token?: string; max_uses: number; uses: number; live: boolean }

const waitFor = (page: Page, method: string, path: string) =>
  page.waitForResponse((r) => r.request().method() === method && new URL(r.url()).pathname === path, { timeout: ACTION_TIMEOUT_MS })

/** A screenshot of the page as it is now, at `width`×`height`, for the day's report — no reload, so what it shows stays. */
async function shoot(ctx: ScenarioCtx, page: Page, name: string, width: number, height: number, note: string): Promise<void> {
  const { dir, link } = ctx.env.shots
  await mkdir(dir, { recursive: true })
  const file = `${name}-${width}.png`
  await page.setViewportSize({ width, height })
  await page.screenshot({ path: join(dir, file) })
  ctx.evidence.push({ note, shot: `${link}/${file}` })
}

/** A private room `owner` opens on Lens, as its own software would: its id, or why not. */
async function openPrivateRoom(ctx: ScenarioCtx, owner: SyntheticUser, title: string): Promise<string | Verdict> {
  const made = await ctx.env.lens.act<{ id: string }>(owner, 'POST', '/v1/workspaces/{ws}/rooms',
    { title, topic: 'e2e', visibility: 'private', description: 'A nightly test room.' })
  ctx.evidence.push({ note: `the owner (${owner.workspaceID}) opens private room "${title}": ${said(made)}` })
  return made.ok ? made.value.id : fail(`opening a private room on Team was refused: ${said(made)}`)
}

async function detail(ctx: ScenarioCtx, who: SyntheticUser, id: string): Promise<Detail> {
  const r = await ctx.env.lens.act<Detail>(who, 'GET', `/v1/rooms/${encodeURIComponent(id)}`)
  if (!r.ok) throw new Error(`reading room ${id} as its owner: ${said(r)}`)
  return r.value
}

export function roomInviteScreen(i: number): Scenario {
  return {
    id: 'room-invite-screen',
    owner: 'talyvor-suite',
    feature: FEATURE,
    plan: 'team',
    own: true,
    title: "the owner's new terms are Lens's next version; another company cannot join a private room by its id, and its invite link's screen shows the room on Lens's terms, " +
      'joins it on them and is used up',
    run: async (ctx) => {
      const { page, user: owner } = ctx.app
      const { lens } = ctx.env
      if (ctx.env.userCount < 2) return fail('one synthetic user: there is no other company to open the invite link')
      const origin = new URL(page.url()).origin
      const viewport = page.viewportSize() ?? { width: 1280, height: 720 }
      const title = `Invite check ${i}-${RUN_SALT}`
      const id = await openPrivateRoom(ctx, owner, title)
      if (typeof id !== 'string') return id
      const room = `/v1/rooms/${encodeURIComponent(id)}`

      // The owner saves new terms on the settings screen: Lens holds them as the next version.
      const was = (await detail(ctx, owner, id)).terms
      await page.goto(`${origin}/rooms/${encodeURIComponent(id)}/settings`)
      const form = page.getByRole('form', { name: 'Change the terms' })
      await form.getByLabel('Default price per use, in US dollars', { exact: true }).fill('0.02')
      const [saved] = await Promise.all([
        waitFor(page, 'PUT', `/api/rooms/${id}/terms`),
        form.getByRole('button', { name: `Save as version ${was.version + 1}`, exact: true }).click(),
      ])
      const terms = (await detail(ctx, owner, id)).terms
      ctx.evidence.push({ note: `Save as version ${was.version + 1}: PUT /api/rooms/${id}/terms answered ${saved.status()}; Lens's terms: ${JSON.stringify(terms)}` })
      if (saved.status() !== 200) return fail(`saving the room's terms was answered ${saved.status()} ${await saved.text()}`)
      if (terms.version !== was.version + 1 || terms.default_price_usd_micros !== 20_000) {
        return fail(`after saving a default price of $0.02 as version ${was.version + 1}, Lens holds terms version ${terms.version} at ${terms.default_price_usd_micros} µUSD`)
      }

      const made = await lens.act<Invite>(owner, 'POST', `${room}/invites`, { max_uses: 1, expires_at: new Date(Date.now() + 86_400_000).toISOString() })
      ctx.evidence.push({ note: `a one-use invite link: ${made.ok ? `${made.status} ${made.value.id}` : said(made)}` })
      if (!made.ok || made.value.token === undefined) return fail(`making an invite link was refused: ${said(made)}`)
      const { token, id: inviteID } = made.value
      const link = `/rooms/invite/${encodeURIComponent(token)}`

      const joinerIndex = (owner.index + 1) % ctx.env.userCount
      const joiner = ctx.env.userAt(joinerIndex)
      const other = await ctx.env.signInUser(joinerIndex)
      try {
        const members = async () => (await detail(ctx, owner, id)).members ?? []

        // Without the link: the room's id alone joins nothing.
        await other.page.goto(`${origin}/rooms`)
        const uninvited = await other.page.evaluate(async ([roomID, version]) => {
          const r = await fetch(`/api/rooms/${encodeURIComponent(roomID)}/join`, {
            method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ terms_version: version }),
          })
          return { status: r.status, text: (await r.text()).slice(0, 300) }
        }, [id, terms.version] as const)
        const before = await members()
        ctx.evidence.push({ note: `${joiner.workspaceID}, without the link, POST /api/rooms/${id}/join: ${uninvited.status} ${uninvited.text}; Lens's members: ${before.map((m) => m.workspace_id).join(', ')}` })
        if (uninvited.status < 400) return fail(`another company joining private room ${id} by its id, without the link, was answered ${uninvited.status} ${uninvited.text}`)
        if (before.some((m) => m.workspace_id === joiner.workspaceID)) return fail(`refused ${uninvited.status}, ${joiner.workspaceID} is a member of private room ${id} on Lens anyway`)

        // The link's screen: the room, and the terms Lens holds now.
        await other.page.goto(`${origin}${link}`)
        const heading = await other.page.getByRole('heading', { name: title }).waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS }).then(() => true, () => false)
        if (!heading) return fail(`the invite link's screen does not show the room "${title}": ${(await other.page.locator('body').innerText().catch(() => '')).slice(0, 300)}`)
        const shown = await other.page.locator('body').innerText()
        ctx.evidence.push({ note: `the invite link's screen: ${shown.replace(/\s+/g, ' ').slice(0, 400)}` })
        if (!/Default price per use\s+\$0\.02\b/.test(shown) || !new RegExp(`Version\\s+${terms.version}\\b`).test(shown)) {
          return fail(`the invite link's screen does not show Lens's terms (version ${terms.version}, $0.02 a use): ${shown.replace(/\s+/g, ' ').slice(0, 300)}`)
        }
        await other.page.setViewportSize({ width: 1440, height: 900 })
        await shoot(ctx, other.page, 'room-invite', 1440, 900, `the invite link's screen at 1440: "${title}"`)
        await shoot(ctx, other.page, 'room-invite', 390, 844, `the invite link's screen at 390: "${title}"`)

        // Join room: a member on those terms, and the one-use link used up.
        await other.page.getByRole('checkbox', { name: /^I accept these terms/ }).check()
        const [joined] = await Promise.all([
          waitFor(other.page, 'POST', `/api/room-invites/${token}/join`),
          other.page.getByRole('button', { name: 'Join room', exact: true }).click(),
        ])
        ctx.evidence.push({ note: `Join room: POST /api/room-invites/…/join answered ${joined.status()}` })
        if (joined.status() >= 300) return fail(`joining through the invite link's screen was answered ${joined.status()} ${await joined.text()}`)
        const landed = await other.page.waitForURL((u) => u.pathname === `/rooms/${id}`, { timeout: ACTION_TIMEOUT_MS }).then(() => true, () => false)
        if (!landed) return fail(`after Join room the screen is ${new URL(other.page.url()).pathname}, not the room's`)
        const member = (await members()).find((m) => m.workspace_id === joiner.workspaceID)
        const invite = (await lens.act<{ invites: Invite[] | null }>(owner, 'GET', `${room}/invites`))
        const used = invite.ok ? (invite.value.invites ?? []).find((x) => x.id === inviteID) : undefined
        ctx.evidence.push({ note: `Lens: ${joiner.workspaceID}'s membership ${JSON.stringify(member)}; the invite ${JSON.stringify(used)}` })
        if (member === undefined || member.role !== 'member') return fail(`after Join room, Lens holds ${joiner.workspaceID}'s membership of room ${id} as ${JSON.stringify(member)}, not a member`)
        if (member.terms_version !== undefined && member.terms_version !== terms.version) return fail(`${joiner.workspaceID} joined on terms version ${member.terms_version}, not the ${terms.version} its screen showed`)
        if (used === undefined || used.uses !== 1 || used.live) return fail(`after its one use, Lens holds the invite as ${JSON.stringify(used)}, not used once and no longer live`)

        // The used link, opened again, admits no one.
        await other.page.goto(`${origin}${link}`)
        const gone = await other.page.getByText('This invite link no longer admits anyone', { exact: false }).waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS }).then(() => true, () => false)
        const preview = await lens.read(joiner, `/v1/room-invites/${encodeURIComponent(token)}`, ACTION_TIMEOUT_MS)
        ctx.evidence.push({ note: `the used link opened again: the screen ${gone ? 'says it admits no one' : 'does not say it admits no one'}; Lens's GET /v1/room-invites/…: ${preview.status}` })
        if (preview.status !== 404) return fail(`a used-up invite link still opens on Lens: ${preview.status} ${preview.body.slice(0, 200)}`)
        if (!gone) return fail(`a used-up invite link's screen does not say it admits no one: ${(await other.page.locator('body').innerText()).slice(0, 300)}`)
        return { pass: true, detail: `room ${id}'s terms saved on settings are Lens's version ${terms.version}; ${joiner.workspaceID} was refused ${uninvited.status} joining by the room's id, ` +
          `joined through the link's screen on version ${terms.version}, the link was used up and opened again admits no one` }
      } finally {
        await other.close()
        await page.setViewportSize(viewport)
      }
    },
  }
}

export function roomDecideRun(): Scenario {
  return {
    id: 'room-decide-run',
    owner: 'talyvor-suite',
    feature: FEATURE,
    plan: 'team',
    own: true,
    title: 'the owner accepts a contribution on the room screen and Lens holds it accepted; run without the variable its template needs, it is refused naming it, ' +
      'the screen asks for it, and the ledger and the room gain nothing',
    run: async (ctx) => {
      const { page, user: owner } = ctx.app
      const { lens } = ctx.env
      const origin = new URL(page.url()).origin
      const viewport = page.viewportSize() ?? { width: 1280, height: 720 }
      const id = await openPrivateRoom(ctx, owner, `Decide check ${RUN_SALT}`)
      if (typeof id !== 'string') return id
      const room = `/v1/rooms/${encodeURIComponent(id)}`
      const work = `Echo prompt ${RUN_SALT}`
      const proposed = await lens.act<{ id: string }>(owner, 'POST', `${room}/contributions`,
        { kind: 'prompt', title: work, artifact: { template: `Say {{word}} back (${RUN_SALT}).`, model: ctx.env.judgeModel }, price_usd_micros: 0 })
      ctx.evidence.push({ note: `the owner proposes "${work}", a prompt needing {{word}}: ${said(proposed)}` })
      if (!proposed.ok) return fail(`proposing a contribution was refused: ${said(proposed)}`)
      const cid = proposed.value.id

      try {
        // Accept, on the room screen.
        await page.goto(`${origin}/rooms/${encodeURIComponent(id)}`)
        const card = page.getByTestId('contribution-card').filter({ hasText: work })
        const [decided] = await Promise.all([
          waitFor(page, 'PATCH', `/api/rooms/${id}/contributions/${cid}`),
          card.getByRole('button', { name: 'Accept', exact: true }).click(),
        ])
        const read = await lens.act<{ id: string; status: string }>(owner, 'GET', `${room}/contributions/${encodeURIComponent(cid)}`)
        ctx.evidence.push({ note: `Accept: PATCH /api/rooms/${id}/contributions/${cid} answered ${decided.status()}; Lens's GET ${room}/contributions/${cid}: ${said(read)}` })
        if (decided.status() !== 200) return fail(`accepting the contribution was answered ${decided.status()} ${await decided.text()}`)
        if (!read.ok || read.value.status !== 'accepted') return fail(`after Accept, Lens holds contribution ${cid} as ${said(read)}, not accepted`)
        const marked = await card.getByTestId('accepted-mark').waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS }).then(() => true, () => false)
        if (!marked) return fail('after Accept, the contribution’s card is not marked Accepted')

        // Run it on me without {{word}}: refused before any model is asked.
        const ledgerBefore = new Set((await lens.ledger(owner)).map((r) => r.id))
        const runsBefore = (await lens.roomMessages(owner, id)).filter((m) => m.kind === 'run').length
        // The select's name is its label's text with the chosen option's, so it is found by its label instead.
        await page.locator('label', { hasText: 'What to run' }).locator('select').selectOption({ label: work })
        await page.getByRole('radio', { name: 'On me', exact: true }).check()
        const [ran] = await Promise.all([
          waitFor(page, 'POST', `/api/rooms/${id}/runs`),
          page.getByRole('button', { name: 'Run', exact: true }).click(),
        ])
        const answer = await ran.text()
        ctx.evidence.push({ note: `Run on me, without {{word}}: POST /api/rooms/${id}/runs answered ${ran.status()}`, answer: answer.slice(0, 300) })
        if (ran.status() !== 400 || !answer.includes('the prompt needs the variables word')) {
          return fail(`a run without the variable its template needs was answered ${ran.status()} ${answer.slice(0, 200)}, not refused naming "word"`)
        }
        const asks = await page.getByLabel('word', { exact: true }).waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS }).then(() => true, () => false)
        if (!asks) return fail('refused for want of {{word}}, the run panel does not ask for it')
        await page.getByLabel('word', { exact: true }).scrollIntoViewIfNeeded()
        await shoot(ctx, page, 'room-run-refused', 1440, 900, 'the room’s run panel at 1440, refused for want of {{word}}')
        await shoot(ctx, page, 'room-run-refused', 390, 844, 'the room’s run panel at 390, refused for want of {{word}}')
        await new Promise((w) => setTimeout(w, REFUSED_WAIT_MS))
        const fresh = (await lens.ledger(owner)).filter((r) => !ledgerBefore.has(r.id))
        const runsAfter = (await lens.roomMessages(owner, id)).filter((m) => m.kind === 'run').length
        ctx.evidence.push({ note: `after the refusal: ${fresh.length} new ledger row(s); ${runsAfter - runsBefore} new run message(s) in the room`,
          ledger: fresh.map((r) => ({ type: r.type, amount_ulxc: r.amount_ulxc, created_at: r.created_at })) })
        if (fresh.length > 0) return fail(`a refused run wrote ${fresh.length} row(s) to the owner's ledger: ${fresh.map((r) => `${r.type} ${r.amount_ulxc} µLXC`).join(', ')}`)
        if (runsAfter !== runsBefore) return fail(`a refused run posted ${runsAfter - runsBefore} run message(s) to the room`)
        return { pass: true, detail: `contribution ${cid}, accepted on the room screen, is accepted on Lens; run on me without {{word}} it was refused 400 naming it, the panel asked for it, and nothing reached the ledger or the room` }
      } finally {
        await page.setViewportSize(viewport)
      }
    },
  }
}
