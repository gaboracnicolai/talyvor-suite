// B30.124 — the money rails on Lens's status page (talyvor-lens B30.12). After the night's partner calls, anyone's
// GET /status.json must list every outside service money moves through, each still on its Test partner while no real
// adapter is configured, and none down: a rail is down when its last call failed after its last success.

import type { Scenario } from './scenarios.ts'

/** Lens's partners.Services, in the order the status page lists them. */
export const RAIL_SERVICES = ['account', 'fx', 'broker', 'stablecoin', 'kyc', 'screening', 'capital', 'insurer', 'agent_token', 'tax'] as const

/** One rail of /status.json, as Lens's status.MoneyRail sends it. */
export interface MoneyRail {
  service: string
  name?: string
  mode: string
  status: string
  last_success: string | null
  last_failure: string | null
}

/** The oracle: all ten services listed once, each in mode "test", and none an outage. */
export function railsVerdict(rails: readonly MoneyRail[] | null | undefined): { pass: boolean; detail: string } {
  if (!Array.isArray(rails)) return { pass: false, detail: `/status.json has no rails (${JSON.stringify(rails)})` }
  const wrong: string[] = []
  for (const service of RAIL_SERVICES) {
    const rows = rails.filter((r) => r.service === service)
    if (rows.length === 0) { wrong.push(`${service} is not listed`); continue }
    if (rows.length > 1) wrong.push(`${service} is listed ${rows.length} times`)
    const r = rows[0]
    if (r.mode !== 'test') wrong.push(`${service} is in mode ${JSON.stringify(r.mode)}, not "test", with no real adapter`)
    const failedLast = r.last_failure !== null && (r.last_success === null || Date.parse(r.last_failure) > Date.parse(r.last_success))
    if (r.status === 'outage' || failedLast) wrong.push(`${service} is down (status ${r.status}, last success ${r.last_success ?? 'never'}, last failure ${r.last_failure})`)
  }
  if (wrong.length > 0) return { pass: false, detail: `of the ${RAIL_SERVICES.length} money rails: ${wrong.join('; ')}` }
  return { pass: true, detail: `all ${RAIL_SERVICES.length} money rails are listed on their Test partner and none is down: ${rails.map((r) => `${r.service} ${r.status}`).join(', ')}` }
}

export function moneyRails(): Scenario {
  return {
    id: 'status-money-rails',
    owner: 'talyvor-lens',
    title: "Lens's status page lists all ten money rails, each on its Test partner, and none is down",
    feature: 'Agent Wallets',
    items: ['B30.12'],
    run: async (ctx) => {
      const res = await ctx.env.lens.as('', 'GET', '/status.json')
      let body: { rails?: MoneyRail[] | null }
      try {
        body = JSON.parse(res.text) as { rails?: MoneyRail[] | null }
      } catch {
        return { pass: false, detail: `GET /status.json answered ${res.status} ${res.text.slice(0, 120)}, not JSON` }
      }
      ctx.evidence.push({ note: `/status.json ${res.status} rails: ${(body.rails ?? []).map((r) => `${r.service} ${r.mode} ${r.status} (ok ${r.last_success ?? 'never'}, failed ${r.last_failure ?? 'never'})`).join('; ')}` })
      return railsVerdict(body.rails)
    },
  }
}
