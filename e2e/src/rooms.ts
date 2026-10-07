// B32.53 — Chat becomes a list of open chats. The owner of a workspace of its own on Team opens a PRIVATE room on
// /rooms/new as a person does (apps/web/src/areas/rooms/Rooms.tsx); the BFF opens it on Lens for the session's
// workspace (apps/bff/rooms.go). The oracles are Lens's own reads, never the screen alone: the room is in the
// workspace's rooms with the workspace as its owner, it is not in the public list, another company reading it is
// 404 — and Chat's rail and the directory show it. A private room, so a nightly run puts nothing in the public
// directory real people read; that also takes a plan that allows one (Free allows none, rooms_plan_limits).
//
// B32.54 — and the room screen (apps/web/src/areas/rooms/Room.tsx): the owner posts a message from the composer, a
// message posted to Lens from elsewhere appears on the open screen without a reload (the event stream through
// apps/bff/rooms.go), and a contribution is proposed, forked and voted on. Lens's own reads are the oracle: both
// messages are the room's, the fork's original is the contribution it forked, and the vote is the tally.
//
// B32.55 — and the room's settings (roomSettings.ts): an invite link made, joined through and revoked, a member given
// may_spend, the room's budget refused above the plan's maximum and set within it, and a prize posted.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Locator, Page } from 'playwright'
import { ACTION_TIMEOUT_MS, fail } from './bank.ts'
import { roomSettingsChecks } from './roomSettings.ts'
import type { Scenario, ScenarioCtx } from './scenarios.ts'

/** Where a room's text is kept, as its first screen says it (apps/web/src/areas/rooms/roomsApi.ts STORED_NOTICE). */
export const STORED_NOTICE =
  'Messages in a room are stored by Talyvor and visible to its members — to everyone, in a public room.'

/** A screenshot of what the page shows now at `width`×`height`, in the dark theme the brand leads with, for the day's report. */
async function shoot(ctx: ScenarioCtx, page: Page, name: string, width: number, height: number, note: string): Promise<void> {
  const { dir, link } = ctx.env.shots
  await mkdir(dir, { recursive: true })
  const file = `${name}-${width}.png`
  await page.setViewportSize({ width, height })
  // The theme is chosen as the page loads (apps/web/index.html), so the page is loaded again in the dark.
  await page.emulateMedia({ colorScheme: 'dark' })
  try {
    await page.reload()
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined)
    await page.screenshot({ path: join(dir, file) })
  } finally {
    await page.emulateMedia({ colorScheme: null })
  }
  ctx.evidence.push({ note, shot: `${link}/${file}` })
}

export function roomsPrivate(seed: number): Scenario {
  return {
    id: 'rooms-private',
    owner: 'talyvor-suite',
    title: 'a private room opened on /rooms/new is the workspace’s on Lens, in Chat’s rail and the directory, and 404 to another company; its screen posts, streams, proposes, forks and votes; its settings invite, give may_spend, refuse a budget past the plan and post a prize',
    plan: 'team',
    own: true,
    run: async (ctx) => {
      const { page, user } = ctx.app
      const lens = ctx.env.lens
      const origin = new URL(page.url()).origin
      const viewport = page.viewportSize() ?? { width: 1280, height: 720 }
      const title = `Rooms check ${seed}-${Date.now().toString(36)}`
      try {
        await page.goto(`${origin}/rooms/new`)
        await page.getByLabel('Title', { exact: true }).fill(title)
        await page.getByLabel('Topic', { exact: true }).fill('e2e')
        await page.getByLabel('Who can find it').selectOption('private')
        const [res] = await Promise.all([
          page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/rooms', { timeout: ACTION_TIMEOUT_MS }),
          page.getByRole('button', { name: 'Open room', exact: true }).click(),
        ])
        const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string }
        ctx.evidence.push({ note: `Open room "${title}", private: POST /api/rooms answered ${res.status()}`, answer: JSON.stringify(body).slice(0, 500) })
        if (res.status() !== 201 || body.id === undefined) return fail(`opening a private room on Team was answered ${res.status()} "${body.error ?? ''}"`)
        const id = body.id

        // Lens: the room is this workspace's, it is in, and it is not listed to the public.
        const listed = await lens.rooms(user)
        const joined = (listed.joined ?? []).find((r) => r.id === id)
        ctx.evidence.push({ note: `Lens's GET /v1/rooms: joined ${(listed.joined ?? []).map((r) => `${r.title} (${r.visibility}, owner ${r.owner_workspace_id})`).join(', ') || 'none'}` })
        if (joined === undefined) return fail(`Lens does not list room ${id} among the rooms ${user.workspaceID} is in`)
        if (joined.owner_workspace_id !== user.workspaceID || joined.visibility !== 'private') {
          return fail(`Lens lists the room as ${joined.visibility}, owned by ${joined.owner_workspace_id} — not private and ${user.workspaceID}'s`)
        }
        if ((listed.rooms ?? []).some((r) => r.id === id)) return fail(`Lens lists private room ${id} among the open public rooms`)
        const detail = await lens.room(user, id)
        if (detail.me?.role !== 'owner') return fail(`Lens says the opener's membership is ${JSON.stringify(detail.me)}, not its owner`)
        if (ctx.env.userCount > 1) {
          const other = ctx.env.userAt((user.index + 1) % ctx.env.userCount)
          const read = await lens.read(other, `/v1/rooms/${encodeURIComponent(id)}`, ACTION_TIMEOUT_MS)
          ctx.evidence.push({ note: `another company (${other.workspaceID}) reads the room: ${read.status}` })
          if (read.status !== 404) return fail(`another company read private room ${id}: ${read.status} ${read.body}`)
        }

        // The screens: the room's first screen, the directory under Your rooms, and Chat's rail.
        const shown = async (what: Locator) =>
          what.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS }).then(() => true, () => false)
        if (!(await shown(page.getByRole('heading', { name: title })))) return fail(`after opening, the room's screen does not show "${title}"`)
        const notice = (await page.getByTestId('room-stored-notice').innerText()).trim()
        if (notice !== STORED_NOTICE) return fail(`the room's first screen says "${notice}", not where its messages are kept`)

        // B32.54 — the room screen. A message from the composer, and one posted to Lens from elsewhere that the open screen
        // shows without a reload.
        const messages = page.getByRole('list', { name: 'Messages' })
        const mine = `Hello from the room screen ${seed}`
        await page.getByLabel('Message', { exact: true }).fill(mine)
        const [sent] = await Promise.all([
          page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/rooms/${id}/messages`, { timeout: ACTION_TIMEOUT_MS }),
          page.getByRole('button', { name: 'Send', exact: true }).click(),
        ])
        ctx.evidence.push({ note: `Send "${mine}": POST /api/rooms/${id}/messages answered ${sent.status()}` })
        if (sent.status() !== 201) return fail(`posting a message from the room screen was answered ${sent.status()}`)
        if (!(await shown(messages.getByText(mine, { exact: true })))) return fail('the message sent from the composer is not in the conversation')
        const elsewhere = `Posted from elsewhere ${seed}-${Date.now().toString(36)}`
        await lens.postRoomMessage(user, id, elsewhere)
        if (!(await shown(messages.getByText(elsewhere, { exact: true })))) {
          return fail('a message posted to the room on Lens did not appear on the open room screen without a reload')
        }
        const kept = (await lens.roomMessages(user, id)).map((m) => m.body)
        ctx.evidence.push({ note: `Lens's GET /v1/rooms/${id}/messages: ${kept.length} messages` })
        if (!kept.includes(mine) || !kept.includes(elsewhere)) return fail(`Lens's messages for room ${id} lack ${!kept.includes(mine) ? 'the composer’s' : 'the one posted elsewhere'}`)

        // A contribution proposed, forked and voted on.
        const work = `Pricing prompt ${seed}`
        await page.getByRole('button', { name: 'Propose', exact: true }).click()
        // The form is found by its Title input: a textarea's label reads its text too once it is filled.
        const proposeForm = page.locator('form', { has: page.getByLabel('Title', { exact: true }) })
        await proposeForm.getByLabel('Title', { exact: true }).fill(work)
        await proposeForm.getByLabel('Template', { exact: true }).fill('Price {{product}} per seat.')
        const [proposed] = await Promise.all([
          page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/rooms/${id}/contributions`, { timeout: ACTION_TIMEOUT_MS }),
          proposeForm.getByRole('button', { name: 'Propose', exact: true }).click(),
        ])
        const original = (await proposed.json().catch(() => ({}))) as { id?: string; error?: string }
        ctx.evidence.push({ note: `Propose "${work}": answered ${proposed.status()}`, answer: JSON.stringify(original).slice(0, 300) })
        if (proposed.status() !== 201 || original.id === undefined) return fail(`proposing a contribution was answered ${proposed.status()} "${original.error ?? ''}"`)
        const board = page.getByRole('list', { name: 'Contributions' })
        await board.getByRole('button', { name: 'Fork', exact: true }).first().click()
        const [forked] = await Promise.all([
          page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/fork'), { timeout: ACTION_TIMEOUT_MS }),
          page.getByRole('group', { name: `Fork ${work}` }).getByRole('button', { name: 'Fork it', exact: true }).click(),
        ])
        if (forked.status() !== 201) return fail(`forking the contribution was answered ${forked.status()} ${await forked.text()}`)
        const [voted] = await Promise.all([
          page.waitForResponse((r) => r.request().method() === 'PUT' && new URL(r.url()).pathname.endsWith('/vote'), { timeout: ACTION_TIMEOUT_MS }),
          page.getByRole('button', { name: `Vote for ${work}`, exact: true }).click(),
        ])
        if (voted.status() !== 200) return fail(`voting for the contribution was answered ${voted.status()} ${await voted.text()}`)
        const cs = await lens.roomContributions(user, id)
        ctx.evidence.push({ note: `Lens's GET /v1/rooms/${id}/contributions: ${cs.map((c) => `${c.title} (tally ${c.tally}, forked from ${c.forked_from ?? '-'})`).join(', ')}` })
        const proposedOne = cs.find((c) => c.id === original.id)
        const fork = cs.find((c) => c.forked_from === original.id)
        if (proposedOne === undefined) return fail(`Lens does not list contribution ${original.id} in room ${id}`)
        if (fork === undefined) return fail(`Lens lists no contribution forked from ${original.id}`)
        if (proposedOne.tally !== 1 || proposedOne.my_vote !== 1) return fail(`Lens's tally for ${original.id} is ${proposedOne.tally} with my vote ${proposedOne.my_vote}, not the +1 cast`)
        await page.evaluate(() => window.scrollTo(0, 0)) // the reload keeps the scroll; the screen is shown from its top
        await shoot(ctx, page, 'room', 1440, 900, `the room screen at 1440: "${title}"`)
        await shoot(ctx, page, 'room', 390, 844, `the room screen at 390: "${title}"`)
        await page.setViewportSize(viewport)
        const settings = await roomSettingsChecks(ctx, page, origin, id, title, (name, w, h, note) => shoot(ctx, page, name, w, h, note))
        if (settings) return settings
        await page.setViewportSize(viewport)
        await page.goto(`${origin}/rooms`)
        if (!(await shown(page.getByRole('list', { name: 'Your rooms' }).getByRole('link', { name: title, exact: true })))) {
          return fail('the directory does not show the room under Your rooms')
        }
        await shoot(ctx, page, 'rooms', 1440, 900, 'the rooms directory at 1440')
        await shoot(ctx, page, 'rooms', 390, 844, 'the rooms directory at 390')
        await page.setViewportSize(viewport)
        await page.goto(`${origin}/chat`)
        const rail = page.getByRole('complementary', { name: 'Conversations' }).getByRole('list', { name: 'Your rooms' })
        if (!(await shown(rail.getByRole('link', { name: title, exact: true })))) return fail('Chat’s rail does not show the room under Rooms')
        await shoot(ctx, page, 'chat-rooms', 1440, 900, 'Chat with the room in its rail at 1440')
        return { pass: true, detail: `private room ${id} is ${user.workspaceID}'s on Lens, absent from the public list, 404 to another company, and shown in the directory and Chat's rail; its screen posted, streamed a message from elsewhere, proposed, forked and voted; its settings made, revoked and joined through an invite link, gave may_spend, refused a budget past the plan and posted a prize` }
      } finally {
        await page.setViewportSize(viewport)
      }
    },
  }
}
