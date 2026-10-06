// B34.1 — the agents a plan holds (LENS_PLAN_GATES, B32.12: Free 3, Team 25). A tester's workspace is on Free,
// and its scenarios open far more than three agents between them, one after another; the other company
// (users 9, 19, …) has agents opened in it by up to nine other users' scenarios at once. So, as an owner does:
//   · before a scenario that opens agents of its own, the workspace's oldest agents — left by the scenarios
//     before it — are archived until the new ones fit (an archive sweeps the balance back and revokes the keys);
//   · the other company goes on Team, paid with Stripe's test card on a checkout Lens opens, the first time a
//     scenario opens an agent in it. B35.7 — since the run creates it on Business (plans.ts), only when it is not.
// Neither loosens an oracle: a scenario still opens its agents on the screen or through Lens, and a refusal
// past the plan's agents still reads as the FAIL it is.

import type { AppUser } from './app.ts'
import type { LensClient, SyntheticUser } from './lens.ts'
import type { Evidence, ScenarioCtx } from './scenarios.ts'
import { payCheckout } from './screens.ts'

/** How long Stripe's webhook may take to reach Lens after the test card is taken. */
const WEBHOOK_WAIT_MS = 60_000

/**
 * Archives `user`'s oldest active agents until `opens` more fit its plan; a refused archive (an agent whose
 * pots hold money) is noted and passed over. Nothing is archived on a plan with room, or with no limit.
 */
export async function roomForAgents(lens: LensClient, user: SyntheticUser, opens: number, evidence: Evidence[]): Promise<void> {
  const plan = await lens.workspacePlan(user)
  const limit = plan.gates.agents
  let used = plan.agents_used
  if (limit < 0 || used + opens <= limit) return
  const archived: string[] = []
  for (const a of (await lens.agentBook(user)).agents) {
    if (used + opens <= limit) break
    if (a.archived_at !== undefined) continue
    const r = await lens.archiveAgent(user, a.id)
    if (r.ok) used--
    archived.push(r.ok ? a.name : `${a.name} (refused: ${r.status} ${r.error})`)
  }
  evidence.push({ note: `room for ${opens} agent(s) on ${plan.plan} (${limit} agents): archived ${archived.join(', ') || 'nothing'}; ${used} left` })
}

/**
 * B35.8 — before a second attempt, as an owner starting again would: every active agent of `user` archived, so the agents
 * the attempt opens again under the first attempt's names are the only ones of those names on the screen.
 */
export async function archiveAll(lens: LensClient, user: SyntheticUser): Promise<string[]> {
  const archived: string[] = []
  for (const a of (await lens.agentBook(user)).agents) {
    if (a.archived_at !== undefined) continue
    const r = await lens.archiveAgent(user, a.id)
    archived.push(r.ok ? a.name : `${a.name} (refused: ${r.status} ${r.error})`)
  }
  return archived
}

const onTeam = new Map<string, Promise<string | undefined>>()

/**
 * The other company on Team, once a run: undefined once Lens holds it to Team, or why not. Every scenario that
 * opens an agent in it waits for the same checkout; the first pays it, signed in as the other company.
 */
export function otherCompanyOnTeam(ctx: ScenarioCtx, partner: number): Promise<string | undefined> {
  const co = ctx.env.userAt(partner)
  let p = onTeam.get(co.workspaceID)
  if (p === undefined) {
    p = subscribeTeam(ctx, partner, co)
    onTeam.set(co.workspaceID, p)
  }
  return p
}

async function subscribeTeam(ctx: ScenarioCtx, partner: number, co: SyntheticUser): Promise<string | undefined> {
  const { lens } = ctx.env
  // B35.7 — on Team or above (the run creates a counterparty on Business), there is nothing to buy.
  if ((await lens.workspacePlan(co)).plan !== 'free') return undefined
  const start = await lens.startSubscription(co, 'team')
  if (!start.ok || start.value.url === undefined) return `Lens opens the other company no Team checkout: ${start.status} ${start.ok ? 'without a url' : start.error}`
  let other: AppUser | undefined
  let refused: string | undefined
  try {
    other = await ctx.env.signInUser(partner)
    const paid = await payCheckout(other, start.value.url, `tester-${partner}@example.com`)
    ctx.evidence.push({ note: `the other company (user ${partner}) on Team, paid with the test card on ${paid.checkout}${paid.refused === undefined ? '' : `: ${paid.refused}`}` })
    refused = paid.refused
  } finally {
    await other?.close()
  }
  if (refused !== undefined) return `paying for the other company's Team with the test card: ${refused}`
  const end = Date.now() + WEBHOOK_WAIT_MS
  let plan = await lens.workspacePlan(co)
  while (plan.plan !== 'team' && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 2000))
    plan = await lens.workspacePlan(co)
  }
  return plan.plan === 'team' ? undefined : `paid for the other company's Team, and ${WEBHOOK_WAIT_MS / 1000} s on Lens holds it to ${plan.plan}`
}
