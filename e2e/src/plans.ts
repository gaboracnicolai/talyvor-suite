// B35.7 — every scenario runs on the plan it needs. A synthetic workspace can be on any plan (talyvor-lens B35.1), so
// each user is created on the largest plan its scenarios need: Team for one that opens agents (LENS_PLAN_GATES gives
// Free 3), Business where one user's scenarios open more agents between them than Team holds, and Business for a
// user whose workspace other users' scenarios open their counterparties in. A scenario that tests a plan's own gate
// runs on a workspace of its own, created on exactly its plan, so nothing else a user runs fills that gate first.

import type { LensClient, SyntheticUser } from './lens.ts'
import type { Plan } from './pricing.ts'
import type { Scenario } from './scenarios.ts'

/** The plans a tester's workspace is created on, from the smallest up. */
export const PLANS: readonly Plan[] = ['free', 'team', 'business']
/** The agents Team holds (LENS_PLAN_GATES, B32.12): one user's scenarios opening more run on Business. */
export const TEAM_AGENTS = 25

const larger = (a: Plan, b: Plan): Plan => (PLANS.indexOf(a) >= PLANS.indexOf(b) ? a : b)

/** The plan a scenario needs: the one it names, else Team for one that opens agents, else Free. */
export function needs(s: Pick<Scenario, 'plan' | 'agents'>): Plan {
  return s.plan ?? (s.agents !== undefined ? 'team' : 'free')
}

/** A scenario run on a workspace of its own: the user whose journey it is in, and the plan its workspace is created on. */
export interface OwnSeat {
  user: number
  scenario: string
  plan: Plan
}

export interface Cast {
  /** Each user's plan, by index. */
  plans: Plan[]
  /** The scenarios that run on a workspace of their own. */
  own: OwnSeat[]
}

/** Each user's plan, and the workspaces of their own the gate scenarios run on, from every user's journey. */
export function cast(journeys: readonly (readonly Scenario[])[]): Cast {
  const plans = journeys.map((journey) => {
    const shared = journey.filter((s) => s.own !== true)
    const opens = shared.reduce((n, s) => n + (s.agents ?? 0), 0)
    const plan = shared.reduce<Plan>((p, s) => larger(p, needs(s)), 'free')
    return opens > TEAM_AGENTS ? 'business' : plan
  })
  for (const journey of journeys) {
    for (const s of journey) for (const k of s.own === true ? [] : s.partners ?? []) if (k >= 0 && k < plans.length) plans[k] = 'business'
  }
  const own = journeys.flatMap((journey, user) => journey.filter((s) => s.own === true).map((s) => ({ user, scenario: s.id, plan: s.plan ?? 'free' })))
  return { plans, own }
}

/** The run's users, each on its plan, and each gate scenario's own workspace, keyed `user:scenario`. */
export interface Seated {
  users: SyntheticUser[]
  own: Map<string, SyntheticUser>
}

export const seatKey = (user: number, scenario: string): string => `${user}:${scenario}`

/**
 * Creates every workspace the cast needs, one call to Lens a plan (it allows ten synthetic calls a minute): the users
 * on it in index order, then the gate scenarios' own.
 */
export async function seat(lens: LensClient, c: Cast): Promise<Seated> {
  const users: SyntheticUser[] = new Array(c.plans.length)
  const own = new Map<string, SyntheticUser>()
  for (const plan of PLANS) {
    const here = c.plans.flatMap((p, i) => (p === plan ? [i] : []))
    const seats = c.own.filter((o) => o.plan === plan)
    if (here.length + seats.length === 0) continue
    const made = await lens.createUsers(here.length + seats.length, plan)
    here.forEach((index, n) => {
      users[index] = { ...made[n], index }
    })
    seats.forEach((o, n) => own.set(seatKey(o.user, o.scenario), { ...made[here.length + n], index: o.user }))
  }
  return { users, own }
}
