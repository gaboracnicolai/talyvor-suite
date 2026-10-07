// B28.281 — AN AGENT'S RULES CANNOT BE BYPASSED. Lens judges every request, listing use and payment an agent's own key makes
// against the agent's rules before the provider is called or any money moves (talyvor-lens economy enforceAgentRules). One
// scenario, on a workspace of its own so nothing else moves its money while it counts:
//   agent-rules-unbypassable — a funded agent with its own key tries what its rules forbid: a request over its daily limit,
//     one outside its hours, one to a model and one to a provider it may not use (each sent plain and streamed, Lens's two
//     copies of the proxy), a marketplace listing it may not use, and a payment above its approval amount. Each is refused by
//     the rule that forbids it, and its statement, the payee's, the workspace's ledger and both balances do not move. Its own
//     key cannot loosen its rules. With the rules opened, the same key is served and charged once, so every refusal was the
//     rules' and not a key or a balance that could not have paid.

import { fail, lxcText } from './bank.ts'
import { worstInputTokens } from './budget.ts'
import { billedOnce } from './concurrency.ts'
import { type AgentLine, type AgentRulesRead, type Answered, type JudgeReply, refusalOf } from './lens.ts'
import { RUN_SALT, listPriceUSD, statesNumber } from './oracles.ts'
import type { Scenario, ScenarioCtx } from './scenarios.ts'

/** What the agent is funded with: enough for every request and payment here, so none is refused for want of LXC. */
const FUND_ULXC = 1_000_000
const REPLY_MAX_TOKENS = 16
/** The approval amount, and a payment ten times it. */
const APPROVAL_ABOVE_ULXC = 1_000
const PAY_ULXC = 10_000
/** The listing's prompt, and the most a use of it may answer (Lens's default for a use that names none). */
const LISTING_PROMPT = 'What is 2 + 2? Reply with the number only.'
const USE_MAX_TOKENS = 4096

type Tried = { ok: true; said: string } | { ok: false; status: number; error: string }

/** One forbidden attempt: the rules that forbid it, the words Lens's refusal names it by, and the attempt itself. */
interface Attempt {
  what: string
  rules: Partial<AgentRulesRead>
  refusal: RegExp
  attempt: (key: string) => Promise<Tried>
}

const hhmm = (minutes: number): string => {
  const m = ((minutes % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** An hour of the day, in UTC, that starts two hours from now: now is outside it, whenever the run is. */
function hoursAway(now = new Date()): { active_from: string; active_until: string; timezone: string } {
  const m = now.getUTCHours() * 60 + now.getUTCMinutes()
  return { active_from: hhmm(m + 120), active_until: hhmm(m + 180), timezone: 'UTC' }
}

/** One question on the agent's key, plain or streamed (and hung up on once served). A refusal should never reach the provider; one that did is counted at its worst. */
async function ask(ctx: ScenarioCtx, key: string, stream: boolean): Promise<Tried> {
  const { env } = ctx
  const model = env.catalog.find((m) => m.id === env.judgeModel)
  if (model === undefined) throw new Error(`the catalog has no model ${env.judgeModel}`)
  const prompt = `What is ${1000 + Math.floor(Math.random() * 9000)} + ${1000 + Math.floor(Math.random() * 9000)}? Reply with the number only. (${RUN_SALT})`
  const hold = env.cap.reserve(listPriceUSD(model, worstInputTokens(prompt.length), REPLY_MAX_TOKENS))
  try {
    if (stream) {
      const r = await env.lens.hangUpAsAgent(key, env.judgeProvider, model.id, prompt, REPLY_MAX_TOKENS)
      return r.ok ? { ok: true, said: r.value.said } : { ok: false, status: r.status, error: r.error }
    }
    const r = await env.lens.askAsAgent(key, env.judgeProvider, model.id, prompt, REPLY_MAX_TOKENS)
    return r.ok ? { ok: true, said: r.value.text } : { ok: false, status: r.status, error: r.error }
  } finally {
    env.cap.settle(hold, undefined)
  }
}

/** What the agents' statements, the workspace's ledger and the agents' balances hold now. */
async function books(ctx: ScenarioCtx, agents: string[]): Promise<{ lines: Set<string>; rows: Set<string>; held: Map<string, number | undefined> }> {
  const { lens } = ctx.env
  const user = ctx.app.user
  const lines = new Set<string>()
  for (const id of agents) for (const l of await lens.agentLines(user, id)) lines.add(`${id} ${l.entry_id} ${l.kind} ${l.amount_ulxc}`)
  const rows = new Set((await lens.ledger(user)).map((r) => r.id))
  const book = await lens.agentBook(user)
  return { lines, rows, held: new Map(agents.map((id) => [id, book.agents.find((a) => a.id === id)?.balance_ulxc])) }
}

/** What moved since `before`: new postings on the agents' statements, new rows on the ledger, a balance that changed; '' for nothing. */
async function movedSince(ctx: ScenarioCtx, agents: string[], before: Awaited<ReturnType<typeof books>>): Promise<string> {
  const now = await books(ctx, agents)
  const moved: string[] = []
  const lines = [...now.lines].filter((l) => !before.lines.has(l))
  if (lines.length > 0) moved.push(`postings ${lines.join(', ')}`)
  const rows = (await ctx.env.lens.ledger(ctx.app.user)).filter((r) => !before.rows.has(r.id))
  if (rows.length > 0) moved.push(`ledger rows ${rows.map((r) => `${r.type} ${r.amount_ulxc}`).join(', ')}`)
  for (const id of agents) if (now.held.get(id) !== before.held.get(id)) moved.push(`${id} holds ${now.held.get(id)} µLXC, not ${before.held.get(id)}`)
  return moved.join('; ')
}

export function agentRulesUnbypassable(): Scenario {
  return {
    id: 'agent-rules-unbypassable',
    owner: 'talyvor-lens',
    own: true,
    plan: 'team',
    agents: 2,
    feature: 'Agent Wallets',
    title: "a funded agent's own key is refused, with nothing posted and no balance moved, a request over its daily limit, one outside its hours, " +
      'one to a model and one to a provider it may not use (each plain and streamed), a listing it may not use and a payment above its approval amount; ' +
      'it cannot loosen its own rules, and with them opened the same key is served and charged once',
    run: async (ctx) => {
      const { env } = ctx
      const { lens } = env
      const user = ctx.app.user
      const agent = await lens.createAgent(user, `Bound ${RUN_SALT}`)
      const payee = await lens.createAgent(user, `Payee ${RUN_SALT}`)
      const k = await lens.act<{ key: string }>(user, 'POST', `/v1/workspaces/{ws}/agents/${agent.id}/keys`, { name: 'agent-rules-unbypassable' })
      if (!k.ok) return fail(`issuing ${agent.name} a key was refused: ${k.status} ${k.error}`)
      const key = k.value.key
      await lens.fundAgent(user, agent.id, FUND_ULXC)
      // The rules a new agent has: nothing forbidden. Each attempt changes only what forbids it, from these.
      const open = await lens.agentRules(user, agent.id)
      const setRules = async (change: Partial<AgentRulesRead>): Promise<string | undefined> => {
        const r = await lens.act(user, 'PUT', `/v1/workspaces/{ws}/agents/${agent.id}/rules`, { ...open, ...change })
        return r.ok ? undefined : `${r.status} ${r.error}`
      }
      const listing = await lens.publishListing(user, { title: `Rules ${RUN_SALT}`, template: LISTING_PROMPT, priceULXC: 1_000, model: env.judgeModel })
      if (!listing.ok) return fail(`publishing the listing the agent may not use was refused: ${listing.status} ${listing.error}`)
      const model = env.catalog.find((m) => m.id === env.judgeModel)
      if (model === undefined) throw new Error(`the catalog has no model ${env.judgeModel}`)
      const otherModel = env.catalog.find((m) => m.provider === env.judgeProvider && m.id !== env.judgeModel && !m.deprecated) ??
        env.catalog.find((m) => m.id !== env.judgeModel)
      if (otherModel === undefined) throw new Error(`the catalog has no model beside ${env.judgeModel} for the agent to be allowed instead`)
      const otherProvider = env.judgeProvider === 'openai' ? 'anthropic' : 'openai'

      const asked = (stream: boolean) => (key: string) => ask(ctx, key, stream)
      const attempts: Attempt[] = [
        ...[false, true].flatMap((stream): Attempt[] => {
          const how = stream ? 'streamed' : 'plain'
          return [
            { what: `a ${how} request over a daily limit of 0.000001 LXC`, rules: { daily_limit_ulxc: 1 }, refusal: /daily limit/, attempt: asked(stream) },
            { what: `a ${how} request outside its hours`, rules: hoursAway(), refusal: /may spend only between/, attempt: asked(stream) },
            { what: `a ${how} request to ${env.judgeModel}, with only ${otherModel.id} allowed`, rules: { allowed_models: [otherModel.id] }, refusal: /may not use the model/, attempt: asked(stream) },
            { what: `a ${how} request to ${env.judgeProvider}, with only ${otherProvider} allowed`, rules: { allowed_providers: [otherProvider] }, refusal: /may not use the provider/, attempt: asked(stream) },
          ]
        }),
        {
          what: `a use of the workspace's own listing ${listing.value.id}, with only another listing allowed`,
          rules: { allowed_listings: [`lst_e2e_not_this_${RUN_SALT}`] },
          refusal: /may not use the marketplace listing/,
          attempt: async (key) => {
            const hold = env.cap.reserve(listPriceUSD(model, worstInputTokens(LISTING_PROMPT.length), USE_MAX_TOKENS))
            try {
              const r = await lens.as(key, 'POST', `/v1/workspaces/${user.workspaceID}/marketplace/listings/${listing.value.id}/use`, { variables: {} })
              return r.status >= 200 && r.status < 300 ? { ok: true, said: r.text.slice(0, 120) } : { ok: false, status: r.status, error: refusalOf(r.text) }
            } finally {
              env.cap.settle(hold, undefined)
            }
          },
        },
        {
          what: `a payment of ${lxcText(PAY_ULXC)} LXC to ${payee.name}, above an approval amount of ${lxcText(APPROVAL_ABOVE_ULXC)} LXC`,
          rules: { approval_above_ulxc: APPROVAL_ABOVE_ULXC },
          refusal: /approval amount/,
          attempt: async (key) => {
            const r = await lens.payAsAgent(key, user.workspaceID, agent.id, payee.id, PAY_ULXC, `rules ${RUN_SALT}`)
            return r.ok ? { ok: true, said: `paid, entry ${r.value.entry_id}` } : { ok: false, status: r.status, error: r.error }
          },
        },
      ]

      const ids = [agent.id, payee.id]
      const start = await books(ctx, ids)
      const wrong: string[] = []
      for (const a of attempts) {
        const err = await setRules(a.rules)
        if (err !== undefined) return fail(`saving the rules for ${a.what} was refused: ${err}`)
        const before = await books(ctx, ids)
        const r = await a.attempt(key)
        ctx.evidence.push({ note: `${a.what}: ${r.ok ? `served — ${r.said}` : `${r.status} ${r.error}`}` })
        if (r.ok) wrong.push(`${a.what} was served (${r.said})`)
        else if (r.status !== 403 || !a.refusal.test(r.error)) wrong.push(`${a.what} was refused, but not by its rule: ${r.status} ${r.error}`)
        const moved = await movedSince(ctx, ids, before)
        if (moved !== '') wrong.push(`${a.what} moved money: ${moved}`)
      }

      // The agent's own key tries to open its rules again while they hold it to a daily limit of 1 µLXC.
      let err = await setRules({ daily_limit_ulxc: 1 })
      if (err !== undefined) return fail(`saving a daily limit of 1 µLXC was refused: ${err}`)
      const own = await lens.as(key, 'PUT', `/v1/workspaces/${user.workspaceID}/agents/${agent.id}/rules`, open)
      const kept = await lens.agentRules(user, agent.id)
      ctx.evidence.push({ note: `${agent.name}'s own key PUT open rules on itself: ${own.status} ${own.text.slice(0, 160)}; its daily limit is now ${kept.daily_limit_ulxc} µLXC` })
      if (own.status < 400 || own.status >= 500) wrong.push(`${agent.name}'s own key PUT open rules on itself and Lens answered ${own.status}`)
      if (kept.daily_limit_ulxc !== 1) wrong.push(`${agent.name}'s own key changed its daily limit from 1 to ${kept.daily_limit_ulxc} µLXC`)

      const still = await movedSince(ctx, ids, start)
      if (still !== '') wrong.push(`after every refusal, something had moved since the first: ${still}`)
      if (wrong.length > 0) return fail(wrong.join('; '))

      // The control: the same key, its rules opened, is served and charged once — so each refusal above was its rule's.
      err = await setRules({})
      if (err !== undefined) return fail(`opening the rules again was refused: ${err}`)
      const lines0: AgentLine[] = await lens.agentLines(user, agent.id)
      const rows0 = new Set((await lens.ledger(user)).map((r) => r.id))
      const a = 1000 + Math.floor(Math.random() * 9000)
      const b = 1000 + Math.floor(Math.random() * 9000)
      const prompt = `What is ${a} + ${b}? Reply with the number only. (${RUN_SALT})`
      const hold = env.cap.reserve(listPriceUSD(model, worstInputTokens(prompt.length), REPLY_MAX_TOKENS))
      let served: Answered<JudgeReply>
      try {
        served = await lens.askAsAgent(key, env.judgeProvider, model.id, prompt, REPLY_MAX_TOKENS, { 'X-Talyvor-Cache': 'bypass' })
        env.cap.settle(hold, served.ok ? listPriceUSD(model, served.value.inputTokens, served.value.outputTokens) : undefined)
      } catch (e) {
        env.cap.settle(hold, undefined)
        throw e
      }
      ctx.evidence.push({ note: `the same key with its rules opened: ${served.ok ? `"${served.value.text}"` : `${served.status} ${served.error}`}`, question: prompt })
      if (!served.ok) return fail(`with its rules opened, ${agent.name}'s key was still refused: ${served.status} ${served.error}`)
      if (!statesNumber(served.value.text, a + b)) return fail(`answered wrong: expected ${a + b}, got "${served.value.text}"`)
      const charged = await billedOnce(ctx, agent.id, lines0, rows0, 'the request with the rules opened')
      if (typeof charged === 'string') return fail(charged)
      const held = (await lens.agentBook(user)).agents.find((x) => x.id === agent.id)?.balance_ulxc
      if (held !== FUND_ULXC - charged) return fail(`${agent.name} was funded ${FUND_ULXC} µLXC and charged ${charged} once; Lens stores it holding ${held}`)
      return { pass: true, detail: `${attempts.length} forbidden attempts each refused (403) by its own rule with nothing posted and no balance moved; ` +
        `the agent's own key could not open its rules; opened, the same key was served and charged once (${charged} µLXC)` }
    },
  }
}
