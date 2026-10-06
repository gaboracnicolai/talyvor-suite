// B28.440 — the TypeScript SDK's README quickstart, run against Lens as a developer runs it: the SDK is
// Lens's own sdk/typescript, read from the run's checkout of talyvor-lens (--lens-src), so the scenario
// tests the SDK as it is on Lens's main, not a copy. A signed-in owner creates an agent, funds it 10 LXC,
// issues its key; the agent makes one model call through Lens with that key (the SDK's .openai()); the
// owner reads its statement. The oracle is the statement's rows, never a status code.

import { randomInt } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { chargeULXC } from './app.ts'
import { worstInputTokens } from './budget.ts'
import { listPriceUSD, statesNumber } from './oracles.ts'
import { PLATFORM_FEE_BPS, type Plan } from './pricing.ts'
import { CannotTest, type Scenario, type ScenarioCtx, type Verdict } from './scenarios.ts'

/** What the quickstart funds the agent with: 10 LXC. */
export const QUICKSTART_FUND_ULXC = 10_000_000
const MAX_TOKENS = 16
/** The model the README's quickstart calls; another OpenAI model when the catalog does not offer it. */
const README_MODEL = 'gpt-4o-mini'

interface StatementLine { entry_id: string; kind: string; amount_ulxc: number; balance_after_ulxc: number; at: string }
interface Completion { choices: { message: { content: string | null } }[]; usage?: { prompt_tokens: number; completion_tokens: number } }
interface SdkClient {
  agents: {
    create(name: string): Promise<{ id: string; name: string }>
    fund(agentId: string, amountUlxc: number, opts?: { idempotencyKey?: string }): Promise<{ balance_ulxc: number }>
    issueKey(agentId: string): Promise<{ key: string }>
    statement(agentId: string): Promise<{ lines: StatementLine[] }>
  }
  openai(): { chat: { completions: { create(body: object): Promise<Completion> } } }
}
interface Sdk { LensClient: new (o: { lensUrl: string; apiKey: string; workspaceId: string }) => SdkClient }

const loaded = new Map<string, Promise<Sdk>>()

/**
 * Lens's sdk/typescript/src, transpiled as its own tsconfig builds it (CommonJS, into dist) under e2e/out,
 * where the SDK's require("openai") finds this package's openai, as an application's would.
 */
export function loadSdk(lensSrc: string): Promise<Sdk> {
  let p = loaded.get(lensSrc)
  if (p === undefined) {
    p = (async () => {
      const src = join(lensSrc, 'sdk', 'typescript', 'src')
      const into = fileURLToPath(new URL('../out/sdk-typescript/dist/', import.meta.url))
      await mkdir(into, { recursive: true })
      await writeFile(join(into, 'package.json'), '{"type":"commonjs"}\n')
      for (const f of (await readdir(src)).filter((n) => n.endsWith('.ts') && !n.endsWith('.d.ts'))) {
        const out = ts.transpileModule(await readFile(join(src, f), 'utf8'), {
          fileName: f,
          compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
        })
        await writeFile(join(into, f.replace(/\.ts$/, '.js')), out.outputText)
      }
      return createRequire(join(into, 'index.js'))('./index.js') as Sdk
    })()
    loaded.set(lensSrc, p)
  }
  return p
}

/**
 * The statement oldest first, each line's balance the one before plus its amount, from the funding on. The model
 * call is Lens's hold (the stub's spend), then the settle that gives back what the answer did not use, then — B32.11,
 * when the workspace's plan has one — its platform fee of `feeBPS` of what was spent, rounded up.
 */
export function quickstartStatement(newestFirst: readonly StatementLine[], feeBPS: number): { pass: true; spentULXC: number } | { pass: false; detail: string } {
  const lines = [...newestFirst].reverse()
  const funds = lines.filter((l) => l.kind === 'fund')
  if (funds.length !== 1 || lines[0]?.kind !== 'fund') return { pass: false, detail: `the statement does not open on one fund line: ${show(lines)}` }
  if (funds[0].amount_ulxc !== QUICKSTART_FUND_ULXC || funds[0].balance_after_ulxc !== QUICKSTART_FUND_ULXC) {
    return { pass: false, detail: `the fund line is ${funds[0].amount_ulxc} µLXC to ${funds[0].balance_after_ulxc}, not +${QUICKSTART_FUND_ULXC} to ${QUICKSTART_FUND_ULXC}` }
  }
  const call = lines[1]
  if (call === undefined || (call.kind !== 'hold' && call.kind !== 'spend') || !(call.amount_ulxc < 0)) {
    return { pass: false, detail: `no hold or spend line for the model call after the funding: ${show(lines)}` }
  }
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].balance_after_ulxc !== lines[i - 1].balance_after_ulxc + lines[i].amount_ulxc) {
      return { pass: false, detail: `the ${lines[i].kind} line of ${lines[i].amount_ulxc} µLXC leaves ${lines[i].balance_after_ulxc}, not ${lines[i - 1].balance_after_ulxc} + ${lines[i].amount_ulxc}: ${show(lines)}` }
    }
  }
  const rest = lines.slice(2)
  const settles = rest.filter((l) => l.kind === 'settle')
  const fees = rest.filter((l) => l.kind === 'platform_fee')
  const other = rest.filter((l) => l.kind !== 'settle' && l.kind !== 'platform_fee')
  if (other.length > 0 || settles.length > 1 || fees.length > 1) return { pass: false, detail: `the model call wrote more than a hold, a settle and a platform fee: ${show(lines)}` }
  const back = settles[0]?.amount_ulxc ?? 0
  if (back < 0 || back > -call.amount_ulxc) return { pass: false, detail: `the settle of ${back} µLXC gives back more than the ${-call.amount_ulxc} held, or takes more: ${show(lines)}` }
  const spentULXC = -call.amount_ulxc - back
  if (!(spentULXC > 0)) return { pass: false, detail: `the model call left the agent at ${QUICKSTART_FUND_ULXC - spentULXC} µLXC, nothing charged: ${show(lines)}` }
  const want = Math.ceil((spentULXC * feeBPS) / 10_000)
  const fee = fees[0] === undefined ? 0 : -fees[0].amount_ulxc
  if (fee !== want) return { pass: false, detail: `the platform fee on ${spentULXC} µLXC spent is ${fee} µLXC; at ${feeBPS} basis points it is ${want}: ${show(lines)}` }
  return { pass: true, spentULXC }
}

const show = (lines: readonly StatementLine[]): string => lines.map((l) => `${l.kind} ${l.amount_ulxc} → ${l.balance_after_ulxc}`).join('; ') || 'no lines'

export function sdkWalletQuickstart(seed: number): Scenario {
  return {
    id: 'sdk-wallet-quickstart',
    agents: 1,
    title: "the TypeScript SDK's README quickstart: an agent created, funded 10 LXC, keyed, calling a model through Lens, and its statement",
    feature: 'Agent Wallets',
    run: async (ctx: ScenarioCtx): Promise<Verdict> => {
      const { env, app } = ctx
      if (env.lensSrc === 'none') throw new CannotTest('no Lens checkout was given (--lens-src none), and the SDK is read from it')
      const { LensClient } = await loadSdk(env.lensSrc)
      const lensUrl = env.lens.baseURL
      const workspaceId = app.user.workspaceID
      const model = env.catalog.find((m) => m.id === README_MODEL) ??
        env.catalog.filter((m) => m.provider === 'openai' && m.output_per_1m > 0 && !m.deprecated).sort((a, b) => a.output_per_1m - b.output_per_1m)[0]
      if (model === undefined) return { pass: false, detail: "Lens's catalog offers no OpenAI chat model, and the quickstart calls one through .openai()" }

      // 1. Create an agent. 2. Fund its wallet from the workspace (10 LXC).
      const owner = new LensClient({ lensUrl, apiKey: app.user.token, workspaceId })
      const agent = await owner.agents.create(`SDK quickstart ${seed}`)
      const funded = await owner.agents.fund(agent.id, QUICKSTART_FUND_ULXC, { idempotencyKey: `fund-${agent.id}` })
      ctx.evidence.push({ note: `owner.agents.create → ${agent.id}; fund ${QUICKSTART_FUND_ULXC} µLXC → balance ${funded.balance_ulxc}` })
      // 3. Issue the agent its own key.
      const { key } = await owner.agents.issueKey(agent.id)

      // 4. The agent calls a model through Lens with that key. A question no one has asked, so it is neither replayed nor pooled.
      const a = randomInt(1000, 10000)
      const b = randomInt(1000, 10000)
      const question = `What is ${a} + ${b}? Reply with the number only.`
      const hold = env.cap.reserve(listPriceUSD(model, worstInputTokens(question.length), MAX_TOKENS))
      let r: Completion
      try {
        const ai = new LensClient({ lensUrl, apiKey: key, workspaceId }).openai()
        r = await ai.chat.completions.create({ model: model.id, messages: [{ role: 'user', content: question }], max_tokens: MAX_TOKENS })
      } catch (e) {
        env.cap.settle(hold, undefined)
        return { pass: false, detail: `the agent's model call (${model.id}, .openai()) was refused: ${e instanceof Error ? e.message : String(e)}` }
      }
      const answer = r.choices[0]?.message.content ?? ''
      const cost = r.usage === undefined ? undefined : listPriceUSD(model, r.usage.prompt_tokens, r.usage.completion_tokens)
      env.cap.settle(hold, cost)
      // Booked as every charged answer is, for the ledger read-back.
      if (cost !== undefined) env.book.add(workspaceId, chargeULXC(cost, env.usdPerLXC))
      ctx.evidence.push({ note: `the agent asked ${model.id} with its own key`, question, answer })
      if (!statesNumber(answer, a + b)) return { pass: false, detail: `the model call answered wrong: expected ${a + b}, got "${answer}"` }

      // 5. Read its statement, newest first.
      const { lines } = await owner.agents.statement(agent.id)
      ctx.evidence.push({ note: `the statement of ${agent.id}`, ledger: lines.map((l) => ({ type: l.kind, amount_ulxc: l.amount_ulxc, created_at: l.at })) })
      const plan = (await env.lens.workspacePlan(app.user)).gated_as as Plan
      const st = quickstartStatement(lines, PLATFORM_FEE_BPS[plan])
      if (!st.pass) return { pass: false, detail: st.detail }
      return { pass: true, detail: `the statement holds the fund line (+${QUICKSTART_FUND_ULXC} µLXC) and the model call: ${st.spentULXC} µLXC spent and its platform fee on ${plan}, each line's balance following from the one before` }
    },
  }
}
