// B32.55 — room settings (apps/web/src/areas/rooms/RoomSettings.tsx), as the owner of a private room on Team uses them:
// an invite link made on the screen, another company joining through it, that member given may_spend, the link revoked;
// the room's monthly budget set above what the plan allows a room and refused naming rooms_plan_limits, then set within
// it; and a prize posted. Lens's own reads are the oracle: the invite and its revoke, the membership and its may_spend,
// the room wallet's rules and the prize — never the screen alone. Awarding a prize moves money and is B32.87's.

import { join } from 'node:path'
import type { Page } from 'playwright'
import { ACTION_TIMEOUT_MS, fail } from './bank.ts'
import type { ScenarioCtx, Verdict } from './scenarios.ts'

type Shoot = (name: string, width: number, height: number, note: string) => Promise<void>

/** A YYYY-MM-DD date `days` from now, as a date input takes it. */
function dateIn(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}

/** Undefined when every setting reached Lens as the screen said; else the failing verdict. */
export async function roomSettingsChecks(ctx: ScenarioCtx, page: Page, origin: string, id: string, title: string, shoot: Shoot): Promise<Verdict | undefined> {
  const { user } = ctx.app
  const lens = ctx.env.lens
  const path = (p: string) => (r: { request(): { method(): string }; url(): string }, method: string) =>
    r.request().method() === method && new URL(r.url()).pathname === p
  const settings = `${origin}/rooms/${encodeURIComponent(id)}/settings`
  await page.goto(settings)
  await page.getByRole('heading', { name: title }).waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS })

  // An invite link, made and shown once.
  await page.getByLabel('How many workspaces it admits', { exact: true }).fill('2')
  const [made] = await Promise.all([
    page.waitForResponse((r) => path(`/api/rooms/${id}/invites`)(r, 'POST'), { timeout: ACTION_TIMEOUT_MS }),
    page.getByRole('button', { name: 'Make a link', exact: true }).click(),
  ])
  const invite = (await made.json().catch(() => ({}))) as { id?: string; token?: string; error?: string }
  ctx.evidence.push({ note: `Make a link: POST /api/rooms/${id}/invites answered ${made.status()}`, answer: JSON.stringify({ ...invite, token: invite.token ? '…' : undefined }) })
  if (made.status() !== 201 || !invite.id || !invite.token) return fail(`making an invite link was answered ${made.status()} "${invite.error ?? ''}"`)
  const shown = await page.getByLabel('Invite link', { exact: true }).inputValue()
  if (!shown.endsWith(`/rooms/invite/${encodeURIComponent(invite.token)}`)) return fail(`the screen shows the invite link as "${shown}", not the link Lens made`)
  const listed = (await lens.roomInvites(user, id)).find((i) => i.id === invite.id)
  ctx.evidence.push({ note: `Lens's GET /v1/rooms/${id}/invites: ${JSON.stringify(listed)}` })
  if (!listed || !listed.live || listed.max_uses !== 2 || listed.kind !== 'link') return fail(`Lens does not hold invite ${invite.id} as a live link admitting 2: ${JSON.stringify(listed)}`)

  // Another company joins through it, and the owner lets it spend the room's money.
  const other = ctx.env.userCount > 1 ? ctx.env.userAt((user.index + 1) % ctx.env.userCount) : undefined
  if (other) {
    const terms = (await lens.room(user, id)).terms.version
    const joined = await lens.joinRoomByInvite(other, invite.token, terms)
    ctx.evidence.push({ note: `${other.workspaceID} joins through the link: ${joined.status}` })
    if (!joined.ok) return fail(`another company joining through the invite link was answered ${joined.status} "${joined.error}"`)
    await page.reload()
    const spend = page.getByRole('button', { name: `${other.workspaceID} may spend the room’s money`, exact: true })
    const [changed] = await Promise.all([
      page.waitForResponse((r) => path(`/api/rooms/${id}/members/${other.workspaceID}`)(r, 'PATCH'), { timeout: ACTION_TIMEOUT_MS }),
      spend.click(),
    ])
    if (changed.status() !== 200) return fail(`giving the member may_spend was answered ${changed.status()} ${await changed.text()}`)
    const member = (await lens.room(user, id)).members?.find((m) => m.workspace_id === other.workspaceID)
    ctx.evidence.push({ note: `Lens's membership for ${other.workspaceID}: ${JSON.stringify(member)}` })
    if (member?.may_spend !== true) return fail(`Lens says ${other.workspaceID}'s membership is ${JSON.stringify(member)}, not one that may spend`)
  } else {
    ctx.evidence.push({ note: 'one synthetic user: no other company to join through the link or be given may_spend' })
  }

  // The link revoked: Lens no longer holds it live, and it opens nothing.
  const [revoked] = await Promise.all([
    page.waitForResponse((r) => path(`/api/rooms/${id}/invites/${invite.id}`)(r, 'DELETE'), { timeout: ACTION_TIMEOUT_MS }),
    page.getByRole('list', { name: 'Invites' }).getByRole('button', { name: /^Revoke invite/ }).first().click(),
  ])
  if (revoked.status() !== 200) return fail(`revoking the invite link was answered ${revoked.status()} ${await revoked.text()}`)
  const after = (await lens.roomInvites(user, id)).find((i) => i.id === invite.id)
  if (!after || after.live || !after.revoked_at) return fail(`after Revoke, Lens holds invite ${invite.id} as ${JSON.stringify(after)}`)
  const opened = await lens.read(other ?? user, `/v1/room-invites/${encodeURIComponent(invite.token)}`, ACTION_TIMEOUT_MS)
  ctx.evidence.push({ note: `the revoked link opened on Lens: ${opened.status}` })
  if (opened.status !== 404) return fail(`a revoked invite link still opens on Lens: ${opened.status} ${opened.body}`)

  // The room's budget: above the plan's room_budget_max_usd is refused naming rooms_plan_limits; within it is the rule.
  const wallet = (await lens.room(user, id)).wallet
  if (!wallet) return fail(`Lens shows room ${id} without a wallet`)
  const limitField = page.getByLabel(`Monthly limit for ${wallet.name}, in LXC`, { exact: true })
  const save = async (lxc: string) => {
    await limitField.fill(lxc)
    const [res] = await Promise.all([
      page.waitForResponse((r) => path(`/api/agents/${wallet.agent_id}/rules`)(r, 'PUT'), { timeout: ACTION_TIMEOUT_MS }),
      page.getByRole('button', { name: 'Save rules', exact: true }).click(),
    ])
    return res
  }
  const before = (await lens.agentRules(user, wallet.agent_id)).monthly_limit_ulxc
  if (wallet.budget_max_ulxc > 0) {
    const over = await save(String(wallet.budget_max_ulxc / 1_000_000 + 1))
    const refusal = page.getByRole('alert').filter({ hasText: 'rooms_plan_limits' })
    const said = await refusal.first().innerText({ timeout: ACTION_TIMEOUT_MS }).catch(() => '')
    ctx.evidence.push({ note: `a budget above the plan's ${wallet.budget_max_ulxc} µLXC: ${over.status()}, the screen says "${said}"` })
    if (over.status() !== 402 || !said.includes('rooms_plan_limits')) return fail(`a room budget above the plan's maximum was answered ${over.status()} and the screen said "${said}"`)
    const kept = (await lens.agentRules(user, wallet.agent_id)).monthly_limit_ulxc
    if (kept !== before) return fail(`the refused budget changed the room wallet's monthly limit on Lens from ${before} to ${kept}`)
  }
  const within = await save('100')
  if (within.status() !== 200) return fail(`a room budget of 100 LXC was answered ${within.status()} ${await within.text()}`)
  const set = (await lens.agentRules(user, wallet.agent_id)).monthly_limit_ulxc
  ctx.evidence.push({ note: `Lens's room wallet monthly limit after Save rules: ${set} µLXC` })
  if (set !== 100_000_000) return fail(`the room's budget saved as 100 LXC reads ${set} µLXC on Lens`)

  // A prize posted on the room's budget.
  const prize = `E2E prize ${Date.now().toString(36)}`
  const form = page.getByRole('form', { name: 'Post a prize' })
  await form.getByLabel('Prize', { exact: true }).fill(prize)
  await form.getByLabel('What wins it', { exact: true }).fill('The clearest pricing prompt')
  await form.getByLabel('Amount, in US dollars', { exact: true }).fill('1')
  await form.getByLabel('Deadline', { exact: true }).fill(dateIn(7))
  const [posted] = await Promise.all([
    page.waitForResponse((r) => path(`/api/rooms/${id}/prizes`)(r, 'POST'), { timeout: ACTION_TIMEOUT_MS }),
    form.getByRole('button', { name: 'Post prize', exact: true }).click(),
  ])
  if (posted.status() !== 201) return fail(`posting a $1 prize was answered ${posted.status()} ${await posted.text()}`)
  const held = (await lens.roomPrizes(user, id)).find((p) => p.title === prize)
  ctx.evidence.push({ note: `Lens's GET /v1/rooms/${id}/prizes: ${JSON.stringify(held)}` })
  if (!held || held.status !== 'open' || held.amount_usd_micros !== 1_000_000) return fail(`Lens holds the posted prize as ${JSON.stringify(held)}, not an open $1 prize`)
  const onScreen = await page.getByRole('list', { name: 'Prizes' }).getByText(prize).waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS }).then(() => true, () => false)
  if (!onScreen) return fail('the posted prize is not in the settings’ prize list')

  await page.evaluate(() => window.scrollTo(0, 0))
  await shoot('room-settings', 1440, 900, `room settings at 1440: "${title}"`)
  await shoot('room-settings', 390, 844, `room settings at 390: "${title}"`)
  // The budget and the prizes, further down the same screen, in the dark: scrolled to after the page is loaded in it.
  const { dir, link } = ctx.env.shots
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ colorScheme: 'dark' })
  try {
    await page.reload()
    for (const [name, region, note] of [
      ['room-settings-budget', 'The room’s budget', 'the budget and its rules'],
      ['room-settings-prizes', 'Prizes', 'the prizes'],
    ] as const) {
      await page.getByText(region, { exact: true }).first().scrollIntoViewIfNeeded({ timeout: ACTION_TIMEOUT_MS })
      await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
      await page.screenshot({ path: join(dir, `${name}-1440.png`) })
      ctx.evidence.push({ note: `room settings at 1440, ${note}`, shot: `${link}/${name}-1440.png` })
    }
  } finally {
    await page.emulateMedia({ colorScheme: null })
  }
  return undefined
}
