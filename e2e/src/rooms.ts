// B32.53 — Chat becomes a list of open chats. The owner of a workspace of its own on Team opens a PRIVATE room on
// /rooms/new as a person does (apps/web/src/areas/rooms/Rooms.tsx); the BFF opens it on Lens for the session's
// workspace (apps/bff/rooms.go). The oracles are Lens's own reads, never the screen alone: the room is in the
// workspace's rooms with the workspace as its owner, it is not in the public list, another company reading it is
// 404 — and Chat's rail and the directory show it. A private room, so a nightly run puts nothing in the public
// directory real people read; that also takes a plan that allows one (Free allows none, rooms_plan_limits).

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Locator, Page } from 'playwright'
import { ACTION_TIMEOUT_MS, fail } from './bank.ts'
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
    title: 'a private room opened on /rooms/new is the workspace’s on Lens, in Chat’s rail and the directory, and 404 to another company',
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
        await shoot(ctx, page, 'room', 390, 844, `the room's first screen at 390: "${title}"`)
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
        return { pass: true, detail: `private room ${id} is ${user.workspaceID}'s on Lens, absent from the public list, 404 to another company, and shown in the directory and Chat's rail` }
      } finally {
        await page.setViewportSize(viewport)
      }
    },
  }
}
