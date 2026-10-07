// B34.7 — every Lens setting and workspace-data route has a tester. On the 6 Oct map the workspace's config and
// budgets, its switches (logging, document conversion, compression, Tare and its model, pooling and cost-optimised
// routing) and both previews, deleting stored answers and asking for deletion, provider keys, local endpoints and
// injection patterns, guardrails, prompts, fallback chains, batches, a catalog model, an issue's anomaly read and
// answer feedback read "not covered". Each scenario here runs on a workspace of its own, on that workspace's own key
// or token, the way its own software calls Lens: it sets a thing, reads it back from Lens, sees it change what Lens
// does or records for the next request, and sets it back. A route only Lens's operator may call is checked to refuse
// the workspace and change nothing; a route this deployment does not run is checked to refuse and move nothing.

import { fail } from './bank.ts'
import { type Asked, ask, freshQuestion, judgeRoute, proxyKey, rowsText, servedRight, verdictOf } from './gateway.ts'
import { type LedgerRow, refusalOf } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { within } from './pricing.ts'
import type { Scenario, ScenarioCtx } from './scenarios.ts'

const FEATURE = 'Lens settings'
/** How long a switch is given to read back: Lens's replicas reload a workspace every 30 s. */
const SWITCH_WAIT_MS = 35_000
/** How long a request's rows, or a read that counts it, are given to reach Lens. */
const CHARGE_WAIT_MS = 15_000

/** One request on the workspace's own token: its status, Lens's sentence when it refused, and the body parsed. */
export async function call<T>(ctx: ScenarioCtx, method: string, path: string, body?: unknown): Promise<{ status: number; error: string; value?: T; text: string }> {
  const r = await ctx.env.lens.as(ctx.app.user.token, method, path.replace('{ws}', ctx.app.user.workspaceID), body)
  let value: T | undefined
  try {
    value = r.text === '' ? undefined : (JSON.parse(r.text) as T)
  } catch {
    value = undefined
  }
  return { status: r.status, error: r.status < 300 ? '' : refusalOf(r.text), value, text: r.text }
}

export const ok = (s: number): boolean => s >= 200 && s < 300
export const said = (r: { status: number; error: string; text: string }): string => `${r.status}${ok(r.status) ? ` ${r.text.slice(0, 160)}` : ` "${r.error}"`}`

/** The workspace as Lens reads it back (GET /v1/workspaces/{ws}): every switch on it. */
export interface WorkspaceRead {
  logging_policy: string
  distill_policy: string
  compression_policy: string
  tare_policy: string
  tare_model: boolean
  cache_poolable: boolean
  cost_optimize_routing: boolean
  distill_poolable: boolean
  spend_limit_usd: number
  allowed_models: string[] | null
}

async function workspaceRead(ctx: ScenarioCtx): Promise<WorkspaceRead> {
  const r = await call<WorkspaceRead>(ctx, 'GET', '/v1/workspaces/{ws}')
  if (r.value === undefined || !ok(r.status)) throw new Error(`reading the workspace back answered ${said(r)}`)
  return r.value
}

// ─── what only Lens's operator may change, and what this deployment does not run ─────

/**
 * Lens's operator alone adds a workspace, an injection pattern, a fallback chain or a local model endpoint: each is
 * Lens-wide, so a workspace's own token is refused (401, "admin credentials required") and nothing changes — the chains
 * and endpoints read back as before, and a text carrying the refused pattern is not taken for an injection. Batches
 * stay closed until a batch is billed for what it used (the lane is refused at start-up without that), and provider keys
 * are held only where Lens holds the key that seals them; where either is so, its routes refuse and the ledger stays
 * still. A catalog model reads back as the catalog lists it, and one it does not have is 404.
 */
export function settingsOperatorOnly(): Scenario {
  return {
    id: 'settings-operator-only',
    owner: 'talyvor-lens',
    own: true,
    feature: FEATURE,
    title: "what only Lens's operator may change — a new workspace, an injection pattern, a fallback chain, a local endpoint — refuses the workspace's own token and changes nothing; batches and provider keys, where this deployment runs neither, refuse and move nothing; a catalog model reads back at its catalog price",
    run: async (ctx) => {
      const wrong: string[] = []
      const right: string[] = []
      const refusedAsOperatorOnly = (what: string, r: { status: number; error: string; text: string }) => {
        if (r.status === 401 && /admin credentials required/.test(r.error)) right.push(`${what}: 401`)
        else wrong.push(`${what} with the workspace's own token answered ${said(r)}, not 401 "admin credentials required"`)
      }
      const pattern = `e2e-${RUN_SALT}-zq${Date.now().toString(36)}`
      const chains0 = await call<Record<string, unknown>>(ctx, 'GET', '/v1/api/fallback/chains')
      const endpoints0 = await call<unknown[]>(ctx, 'GET', '/v1/local/endpoints')
      const ledger0 = await ctx.env.lens.ledger(ctx.app.user)

      refusedAsOperatorOnly('POST /v1/workspaces', await call(ctx, 'POST', '/v1/workspaces', { id: `e2e${RUN_SALT}${Date.now().toString(36)}`, name: 'e2e' }))
      refusedAsOperatorOnly('POST /v1/api/injection/patterns', await call(ctx, 'POST', '/v1/api/injection/patterns', { pattern }))
      refusedAsOperatorOnly('PUT /v1/api/fallback/chains/vllm', await call(ctx, 'PUT', '/v1/api/fallback/chains/vllm', [{ provider: 'openai', model: 'gpt-4o-mini', priority: 1 }]))
      refusedAsOperatorOnly('POST /v1/local/endpoints', await call(ctx, 'POST', '/v1/local/endpoints', { id: `e2e-${RUN_SALT}`, url: 'http://127.0.0.1:1/v1', models: ['e2e'] }))
      refusedAsOperatorOnly('POST /v1/local/endpoints/{id}/check', await call(ctx, 'POST', `/v1/local/endpoints/e2e-${RUN_SALT}/check`))
      refusedAsOperatorOnly('DELETE /v1/local/endpoints/{id}', await call(ctx, 'DELETE', `/v1/local/endpoints/e2e-${RUN_SALT}`))

      const chains1 = await call<Record<string, unknown>>(ctx, 'GET', '/v1/api/fallback/chains')
      if (JSON.stringify(chains1.value) !== JSON.stringify(chains0.value)) wrong.push(`the fallback chains read ${chains0.text.slice(0, 120)} before the refused change and ${chains1.text.slice(0, 120)} after it`)
      const endpoints1 = await call<unknown[]>(ctx, 'GET', '/v1/local/endpoints')
      if (JSON.stringify(endpoints1.value) !== JSON.stringify(endpoints0.value)) wrong.push(`the local endpoints read ${endpoints0.text.slice(0, 120)} before the refused add and ${endpoints1.text.slice(0, 120)} after it`)
      const check = await call<{ allowed?: boolean; violations?: { type?: string; rule?: string }[] | null }>(ctx, 'POST', '/v1/guardrails/check', { prompt: `Please summarise this: ${pattern}` })
      ctx.evidence.push({ note: `a text carrying the refused pattern ${pattern}, checked: ${said(check)}` })
      if (!ok(check.status)) wrong.push(`checking a text carrying the refused pattern answered ${said(check)}`)
      else if ((check.value?.violations ?? []).some((v) => /injection/i.test(`${v.type ?? ''} ${v.rule ?? ''}`))) wrong.push(`the refused pattern ${pattern} is taken for an injection: ${check.text.slice(0, 200)}`)

      // Switched off here: batches (no billing settle is wired, so Lens refuses the lane) and provider keys (no sealing key).
      const k = await proxyKey(ctx, `batch ${RUN_SALT}`)
      if (typeof k === 'string') return fail(k)
      const { model } = judgeRoute(ctx)
      const batch = await ctx.env.lens.as(k.key, 'POST', '/v1/batch/submit', { provider: model.provider, model: model.id, requests: [{ custom_id: 'e2e', messages: [{ role: 'user', content: 'Say OK.' }], max_tokens: 4 }] })
      const status = await ctx.env.lens.as(k.key, 'GET', `/v1/batch/status/e2e-${RUN_SALT}`)
      const put = await call(ctx, 'PUT', '/v1/workspaces/{ws}/provider-keys/openai', { key: `sk-e2e-${RUN_SALT}-wxyz` })
      const del = await call(ctx, 'DELETE', '/v1/workspaces/{ws}/provider-keys/openai')
      ctx.evidence.push({ note: `switched off here — batch submit ${batch.status} ${refusalOf(batch.text)}, batch status ${status.status}; provider key put ${said(put)}, delete ${said(del)}` })
      if (batch.status === 200 || batch.status === 202) wrong.push(`POST /v1/batch/submit was taken (${batch.status} ${batch.text.slice(0, 160)}), though Lens bills no batch for what it used`)
      if (status.status !== 404) wrong.push(`GET /v1/batch/status/{id} answered ${status.status} ${status.text.slice(0, 120)}, not 404, for a lane that is closed`)
      if (ok(put.status)) {
        // This deployment holds provider keys after all: the key is the workspace's, and removed it is gone.
        const listed = await call<{ provider: string; last4: string }[] | { keys?: { provider: string; last4: string }[] }>(ctx, 'GET', '/v1/workspaces/{ws}/provider-keys')
        const keys = Array.isArray(listed.value) ? listed.value : listed.value?.keys ?? []
        if (!keys.some((x) => x.provider === 'openai' && x.last4 === 'wxyz')) wrong.push(`an OpenAI key was taken and Lens lists ${listed.text.slice(0, 160)}`)
        if (!ok(del.status)) wrong.push(`removing the OpenAI key answered ${said(del)}`)
        const after = await call<unknown>(ctx, 'GET', '/v1/workspaces/{ws}/provider-keys')
        if (after.text.includes('"openai"')) wrong.push(`the removed OpenAI key is still listed: ${after.text.slice(0, 160)}`)
      } else if (put.status !== 404 || del.status !== 404) {
        wrong.push(`with no provider keys held here, PUT and DELETE …/provider-keys/openai answered ${put.status} and ${del.status}, not 404`)
      } else right.push('provider keys: not held here, 404')
      const ledger1 = await ctx.env.lens.ledger(ctx.app.user)
      const moved = ledger1.filter((r) => !ledger0.some((o) => o.id === r.id))
      if (moved.length > 0) wrong.push(`what was refused moved the ledger: ${rowsText(moved)}`)

      // Reads: a catalog model is the catalog's entry; an issue's anomaly read names the workspace and the issue.
      const cat = await call<{ id: string; provider: string; input_per_1m: number; output_per_1m: number }>(ctx, 'GET', `/v1/catalog/models/${encodeURIComponent(model.id)}`)
      if (cat.value?.id !== model.id || cat.value.provider !== model.provider || cat.value.input_per_1m !== model.input_per_1m || cat.value.output_per_1m !== model.output_per_1m) {
        wrong.push(`GET /v1/catalog/models/${model.id} reads ${said(cat)}; the catalog lists ${model.provider} at $${model.input_per_1m} / $${model.output_per_1m} a million`)
      }
      const unknown = await call(ctx, 'GET', `/v1/catalog/models/e2e-no-such-model-${RUN_SALT}`)
      if (unknown.status !== 404) wrong.push(`a model the catalog does not have answered ${said(unknown)}, not 404`)
      return verdictOf(wrong, `${right.join('; ')}; the chains, the endpoints and the injection patterns unchanged; batches refused (${batch.status}) with nothing on the ledger; ${model.id} read back at its catalog price`)
    },
  }
}

// ─── guardrails ──────────────────────────────────────────────────────────────

interface Guardrails { workspace_id: string; enable_word_filter: boolean; blocked_words: string[] | null; [k: string]: unknown }
interface CheckResult { passed: boolean; violations: { rule: string; type: string; action: string; message: string }[] | null; redacted_prompt?: string }

/**
 * The workspace's guardrails, both ways Lens offers them: a word blocked with PUT /v1/guardrails/policy reads back, is
 * caught by POST /v1/guardrails/check, and the next request carrying it comes back with X-Talyvor-Guardrail-Redacted —
 * served and charged at the catalog price. The same through POST and PATCH /v1/workspaces/{ws}/guardrails; DELETE puts
 * the default back, and the next request carrying the word is no longer redacted.
 */
export function settingsGuardrails(): Scenario {
  return {
    id: 'settings-guardrails',
    owner: 'talyvor-lens',
    own: true,
    feature: FEATURE,
    title: "guardrails on the workspace's own token: a word blocked with PUT /v1/guardrails/policy, or with POST and PATCH /v1/workspaces/{ws}/guardrails, reads back, is caught by the check and is redacted from the next request (served at the catalog price); DELETE puts the default back and the next request is not redacted",
    run: async (ctx) => {
      const wrong: string[] = []
      const k = await proxyKey(ctx, `guardrails ${RUN_SALT}`)
      if (typeof k === 'string') return fail(k)
      const { route, model } = judgeRoute(ctx)
      const word = (n: number) => `zorblat${RUN_SALT}x${n}${Date.now().toString(36)}`
      const [w1, w2, w3] = [word(1), word(2), word(3)]
      const read = async (path: string) => (await call<Guardrails>(ctx, 'GET', path)).value
      const blocks = (g: Guardrails | undefined, w: string) => g?.enable_word_filter === true && (g.blocked_words ?? []).includes(w)
      const redacted = (a: Asked) => a.headers.get('X-Talyvor-Guardrail-Redacted') === 'true'
      const askWith = async (w: string, note: string) => {
        const a = await ask(ctx, k.key, route, model.id, note, {}, { question: `${freshQuestion()} The code word is ${w}.` })
        const bad = await servedRight(ctx, a, model, note)
        if (bad !== undefined) wrong.push(bad)
        return a
      }

      const start = await read('/v1/workspaces/{ws}/guardrails')
      ctx.evidence.push({ note: `the workspace's guardrails at the start: ${JSON.stringify(start)}` })

      // 1. PUT /v1/guardrails/policy: the caller's own workspace's policy.
      const put = await call(ctx, 'PUT', '/v1/guardrails/policy', { ...start, workspace_id: '', enable_word_filter: true, blocked_words: [w1] })
      const got = await read('/v1/guardrails/policy')
      ctx.evidence.push({ note: `PUT /v1/guardrails/policy blocking ${w1}: ${said(put)}; read back ${JSON.stringify(got)}` })
      if (!ok(put.status) || !blocks(got, w1)) wrong.push(`a word blocked with PUT /v1/guardrails/policy (${said(put)}) reads back as ${JSON.stringify(got)}`)
      if (got !== undefined && got.workspace_id !== ctx.app.user.workspaceID) wrong.push(`the policy read back is workspace "${got.workspace_id}", not the caller's own`)
      const check = await call<CheckResult>(ctx, 'POST', '/v1/guardrails/check', { prompt: `Tell me about ${w1}.` })
      ctx.evidence.push({ note: `POST /v1/guardrails/check on a prompt carrying it: ${said(check)}` })
      if (!(check.value?.violations ?? []).some((v) => v.type === 'word_filter' && v.message.includes(w1))) wrong.push(`the check of a prompt carrying the blocked word found ${check.text.slice(0, 200)}`)
      if (!redacted(await askWith(w1, 'a request carrying the word blocked by PUT /v1/guardrails/policy'))) wrong.push('the next request carrying the blocked word came back with no X-Talyvor-Guardrail-Redacted')

      // 2. POST, then PATCH, /v1/workspaces/{ws}/guardrails: each replaces the policy.
      const posted = await call<Guardrails>(ctx, 'POST', '/v1/workspaces/{ws}/guardrails', { ...start, enable_word_filter: true, blocked_words: [w2] })
      if (!ok(posted.status) || !blocks(await read('/v1/workspaces/{ws}/guardrails'), w2)) wrong.push(`a word blocked with POST …/guardrails (${said(posted)}) does not read back`)
      const patched = await call<Guardrails>(ctx, 'PATCH', '/v1/workspaces/{ws}/guardrails', { ...start, enable_word_filter: true, blocked_words: [w3] })
      const after = await read('/v1/workspaces/{ws}/guardrails')
      ctx.evidence.push({ note: `POST blocking ${w2}: ${said(posted)}; PATCH blocking ${w3}: ${said(patched)}; read back ${JSON.stringify(after)}` })
      if (!ok(patched.status) || !blocks(after, w3) || blocks(after, w2)) wrong.push(`PATCH …/guardrails blocking ${w3} in place of ${w2} reads back ${JSON.stringify(after)}`)
      if (!redacted(await askWith(w3, 'a request carrying the word blocked by PATCH'))) wrong.push('the next request carrying the word PATCH blocked came back with no X-Talyvor-Guardrail-Redacted')

      // 3. DELETE: the default again, and the word passes.
      const del = await call(ctx, 'DELETE', '/v1/workspaces/{ws}/guardrails')
      const back = await read('/v1/workspaces/{ws}/guardrails')
      ctx.evidence.push({ note: `DELETE …/guardrails: ${said(del)}; read back ${JSON.stringify(back)}` })
      if (!ok(del.status) || JSON.stringify(back) !== JSON.stringify(start)) wrong.push(`after DELETE the guardrails read ${JSON.stringify(back)}, not the default they started at, ${JSON.stringify(start)}`)
      if (redacted(await askWith(w3, 'a request carrying the word, once the guardrails are deleted'))) wrong.push('after DELETE the next request carrying the word was still redacted')
      return verdictOf(wrong, `a word blocked by PUT /v1/guardrails/policy and by PATCH …/guardrails read back, was caught by the check and redacted from the next request, each served at the catalog price; after DELETE the default read back and the word passed`)
    },
  }
}

// ─── the workspace's config and budgets ──────────────────────────────────────

interface Config { id: string; spending_cap_usd: number; rate_limit_rpm: number; rate_limit_tpm: number; [k: string]: unknown }
interface Budget { id: string; scope: string; scope_id: string; period: string; limit_usd: number; enforcement: string }
interface BudgetStatus extends Budget { decision: string }

/**
 * The workspace's config: a rate limit of one request a minute reads back, the next request is served and the one after
 * it refused 429 naming rate_limit_rpm with nothing on the ledger; set back to none, the next is served. A team budget:
 * created hard-blocking at a millionth of a dollar, read back alone and in the list and in the team's status, it refuses
 * the next request that names the team (402) with nothing on the ledger while a request naming no team is served;
 * raised with PATCH it reads back and lets the team's next request through; deleted it is gone. A request naming an
 * issue (X-Talyvor-Issue) is what that issue's anomaly read says it cost.
 */
export function settingsConfigBudgets(): Scenario {
  return {
    id: 'settings-config-budgets',
    owner: 'talyvor-lens',
    own: true,
    feature: FEATURE,
    title: "the workspace's config and budgets on its own token: a one-a-minute rate limit reads back and refuses the second request (429) until set back; a team budget made, read, listed and in the team's status refuses the team's next request (402) with nothing charged, lets it through once PATCH raises it, and is gone once deleted; an issue's anomaly read holds what its request cost",
    run: async (ctx) => {
      const wrong: string[] = []
      const k = await proxyKey(ctx, `config ${RUN_SALT}`)
      if (typeof k === 'string') return fail(k)
      const { route, model } = judgeRoute(ctx)
      const served = async (note: string, headers: Record<string, string> = {}) => {
        const bad = await servedRight(ctx, await ask(ctx, k.key, route, model.id, note, headers), model, note)
        if (bad !== undefined) wrong.push(bad)
      }
      const refused = async (note: string, status: number, sentence: RegExp, headers: Record<string, string> = {}) => {
        const a = await ask(ctx, k.key, route, model.id, note, headers)
        if (a.status !== status || !sentence.test(a.error)) wrong.push(`${note} answered ${a.status}${a.status === 200 ? ', served' : ` "${a.error}"`}, not ${status} ${sentence}`)
        else if (a.fresh.length > 0) wrong.push(`${note} was refused, and the ledger gained ${rowsText(a.fresh)}`)
      }

      // 1. Config: one request a minute.
      const start = await call<Config>(ctx, 'GET', '/v1/workspaces/{ws}/config')
      ctx.evidence.push({ note: `the workspace's config at the start: ${said(start)}` })
      const put = await call<Config>(ctx, 'PUT', '/v1/workspaces/{ws}/config', { rate_limit_rpm: 1 })
      const got = await call<Config>(ctx, 'GET', '/v1/workspaces/{ws}/config')
      ctx.evidence.push({ note: `rate_limit_rpm 1: ${said(put)}; read back ${said(got)}` })
      if (!ok(put.status) || got.value?.rate_limit_rpm !== 1) wrong.push(`a rate limit of 1 a minute (${said(put)}) reads back as ${said(got)}`)
      await served('the first request in the minute')
      await refused('the second request in the minute', 429, /rate_limit_rpm/)
      const back = await call<Config>(ctx, 'PUT', '/v1/workspaces/{ws}/config', { rate_limit_rpm: 0 })
      const read0 = await call<Config>(ctx, 'GET', '/v1/workspaces/{ws}/config')
      if (!ok(back.status) || read0.value?.rate_limit_rpm !== 0) wrong.push(`setting the rate limit back to none (${said(back)}) reads back as ${said(read0)}`)
      await served('a request once the rate limit is set back')

      // 2. A team budget, hard-blocking.
      const team = `e2e-${RUN_SALT}-${Date.now().toString(36)}`
      const asTeam = { 'X-Talyvor-Team': team }
      const made = await call<Budget>(ctx, 'POST', '/v1/workspaces/{ws}/budgets', { scope: 'team', scope_id: team, period: 'monthly', limit_usd: 0.000001, enforcement: 'hard_block' })
      ctx.evidence.push({ note: `a hard-blocking budget for team ${team}: ${said(made)}` })
      const id = made.value?.id
      if (made.status !== 201 || id === undefined) return fail([...wrong, `creating a budget answered ${said(made)}`].join('; '))
      const one = await call<Budget>(ctx, 'GET', `/v1/workspaces/{ws}/budgets/${id}`)
      if (one.value?.scope_id !== team || one.value.enforcement !== 'hard_block' || one.value.limit_usd !== 0.000001) wrong.push(`the budget reads back as ${said(one)}`)
      const list = await call<Budget[] | null>(ctx, 'GET', '/v1/workspaces/{ws}/budgets')
      if (!(list.value ?? []).some((b) => b.id === id)) wrong.push(`the list of budgets does not hold it: ${said(list)}`)
      const status = await call<BudgetStatus[] | null>(ctx, 'GET', `/v1/workspaces/{ws}/budgets/status?team=${encodeURIComponent(team)}`)
      if (!(status.value ?? []).some((b) => b.id === id)) wrong.push(`the team's budget status does not hold it: ${said(status)}`)
      await refused("a request naming the team, over its budget", 402, /budget exceeded/, asTeam)
      await served('a request naming no team')

      const raised = await call<Budget>(ctx, 'PATCH', `/v1/workspaces/{ws}/budgets/${id}`, { ...one.value, limit_usd: 100 })
      const reread = await call<Budget>(ctx, 'GET', `/v1/workspaces/{ws}/budgets/${id}`)
      ctx.evidence.push({ note: `raised to $100: ${said(raised)}; read back ${said(reread)}` })
      if (!ok(raised.status) || reread.value?.limit_usd !== 100) wrong.push(`raising the budget to $100 (${said(raised)}) reads back as ${said(reread)}`)
      await served('a request naming the team, once its budget is raised', asTeam)

      const del = await call(ctx, 'DELETE', `/v1/workspaces/{ws}/budgets/${id}`)
      const gone = await call(ctx, 'GET', `/v1/workspaces/{ws}/budgets/${id}`)
      ctx.evidence.push({ note: `deleted: ${said(del)}; read back ${said(gone)}` })
      if (!ok(del.status) || gone.status !== 404) wrong.push(`the deleted budget (${said(del)}) still reads back: ${said(gone)}`)

      // 3. An issue's cost: a request naming it, then the issue's anomaly read holds what it was charged.
      const issue = `E2E-${RUN_SALT}-${Date.now().toString(36)}`
      const tagged = await ask(ctx, k.key, route, model.id, `a request naming issue ${issue}`, { 'X-Talyvor-Issue': issue })
      const bad = await servedRight(ctx, tagged, model, `a request naming issue ${issue}`)
      if (bad !== undefined) wrong.push(bad)
      const spentUSD = (-(tagged.fresh.find((r) => r.type === 'spend')?.amount_ulxc ?? 0) / 1e6) * ctx.env.usdPerLXC
      const anomaly = await within(() => call<{ workspace_id: string; issue_id: string; cost_usd: number }>(ctx, 'GET', `/v1/workspaces/{ws}/anomalies/issue/${issue}`),
        (r) => (r.value?.cost_usd ?? 0) > 0, CHARGE_WAIT_MS)
      ctx.evidence.push({ note: `the issue's anomaly read: ${said(anomaly)}; the request was charged $${spentUSD}` })
      if (anomaly.value?.issue_id !== issue || anomaly.value.workspace_id !== ctx.app.user.workspaceID || Math.abs(anomaly.value.cost_usd - spentUSD) > 5e-7) {
        wrong.push(`the anomaly read of issue ${issue} reads ${said(anomaly)}; the one request naming it was charged $${spentUSD}`)
      }
      return verdictOf(wrong, `a one-a-minute rate limit read back, served the first request and refused the second (429) with nothing charged, and was set back; a team budget made, read, listed and in its status refused the team's request (402) with nothing charged while one naming no team was served, let the team through once raised, and was gone once deleted; issue ${issue}'s anomaly read holds the $${spentUSD} its request was charged`)
    },
  }
}

// ─── the workspace's switches ────────────────────────────────────────────────

/**
 * PUT `path` with `body`, then GET /v1/workspaces/{ws} until `holds` reads true of it (each replica reloads the
 * workspace within 30 s): undefined once it does, else what is wrong.
 */
export async function setSwitch(ctx: ScenarioCtx, path: string, body: Record<string, unknown>, holds: (w: WorkspaceRead) => boolean): Promise<string | undefined> {
  const put = await call(ctx, 'PUT', `/v1/workspaces/{ws}${path}`, body)
  const back = await within(() => workspaceRead(ctx), holds, SWITCH_WAIT_MS)
  const shown = JSON.stringify(Object.fromEntries(Object.keys(body).map((f) => [f, (back as unknown as Record<string, unknown>)[f]])))
  ctx.evidence.push({ note: `PUT ${path} ${JSON.stringify(body)}: ${said(put)}; the workspace reads back ${shown}` })
  if (!ok(put.status)) return `PUT ${path} ${JSON.stringify(body)} answered ${said(put)}`
  return holds(back) ? undefined : `PUT ${path} ${JSON.stringify(body)} answered ${put.status}, and the workspace reads back ${shown}`
}

/**
 * Request logging, pooling, cost-optimised routing and the retired prompt rewriter. Logging set to none is stated on the
 * next request (X-Talyvor-Logging: none) and keeps nothing to answer from, so an exact repeat goes to the model and is
 * charged again; set back, the next request states the old policy. With cache_poolable off another workspace asking the
 * same question is not served this workspace's answer; back on, it is served from the pool at the pool's price. Cost-
 * optimised routing reads back, and a request under it is charged at the catalog price of the model Lens says it used.
 * Distill pooling reads back (a synthetic workspace's conversions are never pooled, so nothing else can change).
 * Turning the prompt rewriter on is refused 410, naming Tare, and the workspace still reads it disabled.
 */
export function settingsSwitches(): Scenario {
  return {
    id: 'settings-switches',
    owner: 'talyvor-lens',
    own: true,
    feature: FEATURE,
    title: "the workspace's switches on its own token, each set, read back, seen on the next request and set back: logging none is stated and an exact repeat is charged again; with cache_poolable off another workspace is not served this one's answer, back on it is served from the pool; cost-optimised routing charges the model it names; distill pooling reads back; the retired rewriter refuses 410",
    run: async (ctx) => {
      const wrong: string[] = []
      const step = (w: string | undefined) => { if (w !== undefined) wrong.push(w) }
      const k = await proxyKey(ctx, `switches ${RUN_SALT}`)
      if (typeof k === 'string') return fail(k)
      const { route, model } = judgeRoute(ctx)
      const start = await workspaceRead(ctx)
      ctx.evidence.push({ note: `the workspace at the start: ${JSON.stringify(start)}` })
      const logged = (a: Asked) => a.headers.get('X-Talyvor-Logging') ?? '(none)'

      // 1. Logging: none, then back.
      step(await setSwitch(ctx, '/logging', { logging_policy: 'none' }, (w) => w.logging_policy === 'none'))
      const q = freshQuestion()
      for (const note of ['a question with logging none', 'the same question again, with logging none']) {
        const a = await ask(ctx, k.key, route, model.id, note, {}, { question: q, replay: true })
        if (logged(a) !== 'none') wrong.push(`${note} came back X-Talyvor-Logging: ${logged(a)}, not none`)
        if (a.replayed || !a.fresh.some((r) => r.type === 'spend')) wrong.push(`${note} was answered from an earlier answer with nothing charged, though logging none keeps nothing to answer from`)
        else step(await servedRight(ctx, a, model, note))
      }
      step(await setSwitch(ctx, '/logging', { logging_policy: start.logging_policy }, (w) => w.logging_policy === start.logging_policy))
      const after = await ask(ctx, k.key, route, model.id, 'a question once logging is set back')
      if (logged(after) !== start.logging_policy) wrong.push(`once logging was set back, the next request came back X-Talyvor-Logging: ${logged(after)}, not ${start.logging_policy}`)
      step(await servedRight(ctx, after, model, 'a question once logging is set back'))

      // 2. The prompt rewriter is retired: turning it on is refused, and it stays off.
      const rewriter = await call(ctx, 'PUT', '/v1/workspaces/{ws}/compression', { compression_policy: 'enabled' })
      const still = await workspaceRead(ctx)
      ctx.evidence.push({ note: `PUT /compression enabled: ${said(rewriter)}; compression_policy reads ${still.compression_policy}` })
      if (rewriter.status !== 410 || !/Tare/.test(rewriter.error)) wrong.push(`turning the retired prompt rewriter on answered ${said(rewriter)}, not 410 naming Tare`)
      if (still.compression_policy !== start.compression_policy) wrong.push(`after the refused PUT the rewriter reads ${still.compression_policy}, not ${start.compression_policy}`)

      // 3. Cost-optimised routing: on, a request is charged at the price of the model Lens says it used; then back.
      step(await setSwitch(ctx, '/cost-optimize-routing', { cost_optimize_routing: true }, (w) => w.cost_optimize_routing))
      const routed = await ask(ctx, k.key, route, model.id, 'a question with cost-optimised routing on')
      const to = routed.headers.get('X-Talyvor-Routed')?.split('→')[1]
      const used = to === undefined ? model : ctx.env.catalog.find((m) => m.id === to)
      if (used === undefined) wrong.push(`routing named a model the catalog does not price: X-Talyvor-Routed ${routed.headers.get('X-Talyvor-Routed')}`)
      else step(await servedRight(ctx, routed, used, `a question routed to ${used.id}`))
      step(await setSwitch(ctx, '/cost-optimize-routing', { cost_optimize_routing: start.cost_optimize_routing }, (w) => w.cost_optimize_routing === start.cost_optimize_routing))

      // 4. Distill pooling: read back both ways.
      step(await setSwitch(ctx, '/distill-poolable', { distill_poolable: !start.distill_poolable }, (w) => w.distill_poolable === !start.distill_poolable))
      step(await setSwitch(ctx, '/distill-poolable', { distill_poolable: start.distill_poolable }, (w) => w.distill_poolable === start.distill_poolable))

      // 5. Answer pooling, seen from another workspace.
      const [other] = await ctx.env.lens.createUsers(1)
      const there: ScenarioCtx = { ...ctx, app: { ...ctx.app, user: { ...other, index: ctx.app.user.index } } as ScenarioCtx['app'] }
      const ko = await proxyKey(there, `pool reader ${RUN_SALT}`)
      if (typeof ko === 'string') return fail([...wrong, `the other workspace: ${ko}`].join('; '))
      const pooledULXC = (a: Asked) => a.headers.get('X-Talyvor-Pool-Charged-ULXC')
      step(await setSwitch(ctx, '/cache-poolable', { cache_poolable: false }, (w) => !w.cache_poolable))
      const q2 = freshQuestion()
      step(await servedRight(ctx, await ask(ctx, k.key, route, model.id, 'a question with cache_poolable off', {}, { question: q2 }), model, 'a question with cache_poolable off'))
      const notShared = await ask(there, ko.key, route, model.id, 'another workspace, the same question', {}, { question: q2, replay: true })
      if (notShared.replayed) wrong.push(`with cache_poolable off, another workspace asking the same question was served from an earlier answer (pool ${pooledULXC(notShared) ?? 'no'})`)
      else step(await servedRight(there, notShared, model, 'another workspace, the same question'))
      step(await setSwitch(ctx, '/cache-poolable', { cache_poolable: true }, (w) => w.cache_poolable))
      const q3 = freshQuestion()
      step(await servedRight(ctx, await ask(ctx, k.key, route, model.id, 'a question with cache_poolable on', {}, { question: q3 }), model, 'a question with cache_poolable on'))
      const shared = await ask(there, ko.key, route, model.id, 'another workspace, the same question, pooled', {}, { question: q3, replay: true })
      const spend = shared.fresh.filter((r) => r.type === 'spend')
      if (pooledULXC(shared) === null) wrong.push(`with cache_poolable on, another workspace asking the same question was not served from the pool (${shared.replayed ? 'answered from its own earlier answer' : 'asked afresh'})`)
      else if (spend.length !== 1 || -spend[0].amount_ulxc !== Number(pooledULXC(shared))) wrong.push(`the pooled answer says it was charged ${pooledULXC(shared)} µLXC, and the other workspace's ledger gained ${rowsText(shared.fresh)}`)
      step(await setSwitch(ctx, '/cache-poolable', { cache_poolable: start.cache_poolable }, (w) => w.cache_poolable === start.cache_poolable))

      return verdictOf(wrong, `logging none was stated on the next requests and the repeat was charged again, then ${start.logging_policy} again; the rewriter refused 410; routing charged the model it used; distill pooling read back; with cache_poolable off another workspace was asked afresh, back on it was served from the pool at ${pooledULXC(shared)} µLXC`)
    },
  }
}

// ─── Tare, its model, document conversion, and both previews ─────────────────

/** Forty same-shaped rows, each value this run's own, so no earlier request carried them: what Tare reduces. */
export function rows(seed: string): string {
  return JSON.stringify(Array.from({ length: 40 }, (_, i) => ({ id: i, name: `item ${i}`, status: 'active', region: 'eu-west', ref: `${seed}-${i}` })))
}

/** A memo with a code only it states, as a document block of the type Lens converts. */
export function memo(code: string): { html: string; block: unknown[] } {
  const html = `<html><body><h1>Memo ${code}</h1><p>The access code is ${code}.</p></body></html>`
  return { html, block: [{ type: 'document', source: { type: 'base64', media_type: 'text/html', data: Buffer.from(html).toString('base64') } }, { type: 'text', text: 'What is the access code? Reply with it only.' }] }
}

const PROSE = 'The quarterly review meeting, which was held on Tuesday afternoon in the large conference room on the third floor, covered a great many topics that the team had been discussing at length over the previous several weeks, including but not limited to the budget, the hiring plan, and the roadmap for the next two quarters.'

interface TarePreview { reduced: string; kind: string; refused: boolean; refusal_reasons: string[] | null; tokens_in_estimated: number; tokens_saved_estimated: number; tare_model: boolean }
interface DistillPreview { markdown: string; format: string; savings: { tokens_saved: number } }

/**
 * Tare: on (always), a request whose newest message is forty same-shaped rows comes back X-Talyvor-Tare: applied, is
 * charged at the catalog price for what the provider counted, and its saving is recorded against the work item it names
 * (GET …/tare/savings); disabled, the next such request is not reduced; set back. The Tare model: off, the preview of a
 * paragraph of prose leaves it as it is; on, the preview says the model ran and the prose is shorter; set back. The rows'
 * preview keeps every field name. Document conversion: on, a memo attached as an HTML document comes back
 * X-Talyvor-Distill: applied and the workspace's conversion count rises by one; disabled, the next is not converted and
 * the count stays; set back. The conversion preview turns the memo into Markdown with its heading and its code.
 */
export function settingsTareDistill(): Scenario {
  return {
    id: 'settings-tare-distill',
    owner: 'talyvor-lens',
    own: true,
    feature: FEATURE,
    title: "Tare, the Tare model and document conversion on the workspace's own token, each set, read back, seen on the next request and set back: Tare reduces forty rows and records the saving, disabled it does not; the Tare model shortens prose in the preview only when on; a memo is converted and counted, disabled it is not; both previews",
    run: async (ctx) => {
      const wrong: string[] = []
      const step = (w: string | undefined) => { if (w !== undefined) wrong.push(w) }
      const k = await proxyKey(ctx, `tare ${RUN_SALT}`)
      if (typeof k === 'string') return fail(k)
      const { route, model } = judgeRoute(ctx)
      const start = await workspaceRead(ctx)
      ctx.evidence.push({ note: `at the start: tare ${start.tare_policy}, tare model ${start.tare_model}, distill ${start.distill_policy}` })
      const seed = () => `${RUN_SALT}${Date.now().toString(36)}`
      const tared = (a: Asked) => a.headers.get('X-Talyvor-Tare') === 'applied'
      const converted = (a: Asked) => a.headers.get('X-Talyvor-Distill') === 'applied'

      // 1. Tare, with its saving recorded against the work item the request names.
      const item = `E2E-TARE-${seed()}`
      const big = rows(seed())
      const reduced = await ask(ctx, k.key, route, model.id, 'forty rows, Tare on', { 'X-Talyvor-Issue': item }, { question: big })
      if (!tared(reduced)) wrong.push(`with Tare ${start.tare_policy}, forty same-shaped rows came back X-Talyvor-Tare: ${reduced.headers.get('X-Talyvor-Tare') ?? '(none)'}, not applied`)
      step(await servedRight(ctx, reduced, model, 'forty rows, Tare on'))
      const savings = await within(() => call<{ by_work_item: { work_item_id: string; tokens_saved?: number; [k: string]: unknown }[] | null }>(ctx, 'GET', '/v1/workspaces/{ws}/tare/savings'),
        (r) => (r.value?.by_work_item ?? []).some((w) => w.work_item_id === item), SWITCH_WAIT_MS)
      ctx.evidence.push({ note: `GET /tare/savings: ${savings.text.slice(0, 300)}` })
      if (!(savings.value?.by_work_item ?? []).some((w) => w.work_item_id === item)) wrong.push(`Tare's savings name nothing for the work item ${item} the reduced request named`)
      step(await setSwitch(ctx, '/tare', { tare_policy: 'disabled' }, (w) => w.tare_policy === 'disabled'))
      const plain = await ask(ctx, k.key, route, model.id, 'forty rows, Tare disabled', {}, { question: rows(seed()) })
      if (tared(plain)) wrong.push('with Tare disabled, forty rows still came back X-Talyvor-Tare: applied')
      step(await servedRight(ctx, plain, model, 'forty rows, Tare disabled'))
      step(await setSwitch(ctx, '/tare', { tare_policy: start.tare_policy }, (w) => w.tare_policy === start.tare_policy))

      // 2. The Tare model, seen in the preview.
      const preview = async (content: string) => {
        const r = await call<TarePreview>(ctx, 'POST', '/v1/workspaces/{ws}/tare/preview', { content })
        if (r.value === undefined || !ok(r.status)) throw new Error(`the Tare preview answered ${said(r)}`)
        return r.value
      }
      const off = await preview(PROSE)
      step(await setSwitch(ctx, '/tare-model', { enabled: true }, (w) => w.tare_model))
      const on = await preview(PROSE)
      ctx.evidence.push({ note: `the prose's preview, model off: ${JSON.stringify(off).slice(0, 240)}; on: ${JSON.stringify(on).slice(0, 240)}` })
      if (off.tare_model || (!off.refused && off.reduced !== PROSE)) wrong.push(`with the Tare model off, the preview shortened the prose or says the model ran: ${JSON.stringify(off).slice(0, 200)}`)
      if (!on.tare_model || on.refused || on.kind !== 'prose' || !(on.tokens_saved_estimated > 0) || !(on.reduced.length < PROSE.length)) wrong.push(`with the Tare model on, the preview of the prose reads ${JSON.stringify(on).slice(0, 240)}`)
      step(await setSwitch(ctx, '/tare-model', { enabled: start.tare_model }, (w) => w.tare_model === start.tare_model))
      const json = await preview(rows(seed()))
      const kept = ['id', 'name', 'status', 'region', 'ref'].filter((f) => !json.reduced.includes(`"${f}"`))
      if (json.kind !== 'json' || json.refused || !(json.tokens_saved_estimated > 0) || kept.length > 0) wrong.push(`the preview of forty rows reads kind ${json.kind}, refused ${json.refused}, ${json.tokens_saved_estimated} tokens saved${kept.length > 0 ? `, and lost the field names ${kept.join(', ')}` : ''}`)

      // 3. Document conversion, counted.
      const count = async () => (await call<{ converted: number }>(ctx, 'GET', '/v1/workspaces/{ws}/distill/usage')).value?.converted ?? -1
      const c0 = await count()
      const m1 = memo(`HERON-${seed()}`)
      const conv = await ask(ctx, k.key, route, model.id, 'a memo attached as HTML, conversion on', {}, { question: m1.html, content: m1.block })
      if (!converted(conv)) wrong.push(`with conversion ${start.distill_policy}, the memo came back X-Talyvor-Distill: ${conv.headers.get('X-Talyvor-Distill') ?? '(none)'}, not applied`)
      step(await servedRight(ctx, conv, model, 'a memo, conversion on'))
      const c1 = await within(count, (n) => n === c0 + 1, SWITCH_WAIT_MS)
      if (c1 !== c0 + 1) wrong.push(`the workspace's conversions read ${c0} before the memo and ${c1} after it`)
      step(await setSwitch(ctx, '/distill', { distill_policy: 'disabled' }, (w) => w.distill_policy === 'disabled'))
      const m2 = memo(`HERON-${seed()}`)
      const pre = new Set((await ctx.env.lens.ledger(ctx.app.user)).map((r) => r.id))
      const raw = await ask(ctx, k.key, route, model.id, 'a memo attached as HTML, conversion disabled', {}, { question: m2.html, content: m2.block })
      if (converted(raw)) wrong.push('with conversion disabled, the memo still came back X-Talyvor-Distill: applied')
      if (raw.status === 200) step(await servedRight(ctx, raw, model, 'a memo, conversion disabled'))
      else {
        // Unconverted, the provider may refuse an HTML document outright: then nothing may stay charged or held.
        const net = (rs: LedgerRow[]) => rs.reduce((n, r) => n + r.amount_ulxc, 0)
        const left = await within(async () => (await ctx.env.lens.ledger(ctx.app.user)).filter((r) => !pre.has(r.id)), (rs) => net(rs) === 0, CHARGE_WAIT_MS)
        ctx.evidence.push({ note: `the unconverted memo was refused ${raw.status} "${raw.error}"; its rows: ${rowsText(left) || 'none'}` })
        if (net(left) !== 0) wrong.push(`the unconverted memo was refused ${raw.status} "${raw.error}", and ${-net(left)} µLXC stayed taken: ${rowsText(left)}`)
      }
      const c2 = await count()
      if (c2 !== c1) wrong.push(`with conversion disabled the workspace's conversions moved from ${c1} to ${c2}`)
      step(await setSwitch(ctx, '/distill', { distill_policy: start.distill_policy }, (w) => w.distill_policy === start.distill_policy))
      const m3 = memo(`HERON-${seed()}`)
      const dp = await ctx.env.lens.raw(ctx.app.user.token, 'POST', `/v1/workspaces/${ctx.app.user.workspaceID}/distill/preview`, m3.html, 'text/html')
      let md: DistillPreview | undefined
      try { md = JSON.parse(dp.text) as DistillPreview } catch { md = undefined }
      ctx.evidence.push({ note: `the conversion preview of the memo: ${dp.status} ${dp.text.slice(0, 240)}` })
      const code = m3.html.match(/HERON-[\w]+/)![0]
      if (dp.status !== 200 || md?.format !== 'html' || !md.markdown.includes(`# Memo ${code}`) || !md.markdown.includes(`The access code is ${code}.`)) wrong.push(`the conversion preview of the memo answered ${dp.status} ${dp.text.slice(0, 200)}`)

      return verdictOf(wrong, `Tare reduced forty rows (charged at the catalog price, its saving recorded against ${item}) and, disabled, did not; the Tare model shortened the prose in the preview only when on, and the rows' preview kept every field name; the memo was converted and counted (${c0} → ${c1}) and, disabled, was not; the conversion preview gave its heading and code`)
    },
  }
}

// ─── what the workspace has stored, and deleting it ──────────────────────────

interface StoredCounts { shared_answers: number; private_answers: number; shared_conversions: number; private_conversions: number; cached_copies: number }
interface DeletionRequest { id: number; workspace_id: string; status: string; note: string }

/**
 * Stored answers, answer feedback and deletion: a question answered once is stored (the counts rise) and its exact repeat
 * is served from it, charged nothing. Marked negative with POST /v1/feedback on the served answer's request id, the
 * stored answer is removed and the next repeat goes to the model and is charged. Every stored answer deleted (scope all,
 * confirmed with the workspace's name), the counts read zero and the next repeat is charged again. A deletion request
 * filed is listed as requested, and filing again while it is open returns the same one.
 */
export function settingsStoredAnswers(): Scenario {
  return {
    id: 'settings-stored-answers',
    owner: 'talyvor-lens',
    own: true,
    feature: FEATURE,
    title: "stored answers on the workspace's own token: an answer is stored and its exact repeat served free; marked negative with POST /v1/feedback it is removed and the next repeat is charged; deleting everything stored zeroes the counts and the next repeat is charged; a deletion request is filed and listed once",
    run: async (ctx) => {
      const wrong: string[] = []
      const step = (w: string | undefined) => { if (w !== undefined) wrong.push(w) }
      const k = await proxyKey(ctx, `stored ${RUN_SALT}`)
      if (typeof k === 'string') return fail(k)
      const { route, model } = judgeRoute(ctx)
      const q = freshQuestion()
      const again = (note: string) => ask(ctx, k.key, route, model.id, note, {}, { question: q, replay: true })
      const charged = async (note: string) => {
        const a = await again(note)
        if (a.replayed || !a.fresh.some((r) => r.type === 'spend')) wrong.push(`${note} was answered from an earlier answer, charged nothing`)
        else step(await servedRight(ctx, a, model, note))
      }
      const counts = async () => (await call<StoredCounts>(ctx, 'GET', '/v1/workspaces/{ws}/stored-answers')).value
      const total = (c: StoredCounts | undefined) => c === undefined ? -1 : c.shared_answers + c.private_answers + c.shared_conversions + c.private_conversions + c.cached_copies

      // 1. Stored, then served from what is stored.
      step(await servedRight(ctx, await ask(ctx, k.key, route, model.id, 'a question, the first time', {}, { question: q }), model, 'a question, the first time'))
      const held = await within(counts, (c) => (c?.private_answers ?? 0) > 0, CHARGE_WAIT_MS)
      ctx.evidence.push({ note: `stored after one answer: ${JSON.stringify(held)}` })
      if (!((held?.private_answers ?? 0) > 0)) wrong.push(`after one answer the workspace's stored answers read ${JSON.stringify(held)}`)
      const served = await again('the exact repeat')
      if (served.fresh.some((r) => r.type === 'spend')) wrong.push(`the exact repeat of a stored answer was charged: ${rowsText(served.fresh)}`)

      // 2. Answer feedback: negative removes it.
      const id = served.headers.get('X-Talyvor-Request-ID') ?? ''
      const fb = await call<{ answers_removed?: number; exact_copies_removed?: number }>(ctx, 'POST', '/v1/feedback', { request_id: id, signal: 'negative' })
      ctx.evidence.push({ note: `POST /v1/feedback negative on ${id}: ${said(fb)}` })
      if (!ok(fb.status) || !((fb.value?.answers_removed ?? 0) + (fb.value?.exact_copies_removed ?? 0) > 0)) wrong.push(`marking the served answer negative answered ${said(fb)}, removing nothing`)
      await charged('the repeat after negative feedback')

      // 3. Everything stored, deleted.
      const name = (await call<{ name: string }>(ctx, 'GET', '/v1/workspaces/{ws}')).value?.name ?? ''
      const del = await call<{ scope: string; deleted: StoredCounts }>(ctx, 'DELETE', '/v1/workspaces/{ws}/stored-answers', { scope: 'all', confirm: name })
      const zero = await counts()
      ctx.evidence.push({ note: `DELETE …/stored-answers scope all: ${said(del)}; then ${JSON.stringify(zero)}` })
      if (!ok(del.status) || total(del.value?.deleted) <= 0) wrong.push(`deleting everything stored answered ${said(del)}, deleting nothing`)
      if (total(zero) !== 0) wrong.push(`after deleting everything stored the workspace still holds ${JSON.stringify(zero)}`)
      await charged('the repeat after everything stored was deleted')

      // 4. A deletion request, filed once.
      const filed = await call<DeletionRequest>(ctx, 'POST', '/v1/workspaces/{ws}/deletion-requests', { note: `e2e ${RUN_SALT}` })
      const twice = await call<DeletionRequest>(ctx, 'POST', '/v1/workspaces/{ws}/deletion-requests', { note: `e2e ${RUN_SALT} again` })
      const listed = await call<{ requests: DeletionRequest[] }>(ctx, 'GET', '/v1/workspaces/{ws}/deletion-requests')
      ctx.evidence.push({ note: `deletion request: ${said(filed)}; again: ${said(twice)}; listed ${said(listed)}` })
      if (filed.status !== 201 || filed.value?.status !== 'requested' || filed.value.workspace_id !== ctx.app.user.workspaceID) wrong.push(`filing a deletion request answered ${said(filed)}`)
      if (twice.value?.id !== filed.value?.id) wrong.push(`filing again while one is open made another: ${said(twice)}`)
      if ((listed.value?.requests ?? []).filter((r) => r.id === filed.value?.id && r.status === 'requested').length !== 1) wrong.push(`the deletion requests list ${said(listed)}`)
      return verdictOf(wrong, `the answer was stored and its repeat served free; negative feedback removed it and the repeat was charged; deleting everything stored zeroed the counts and the repeat was charged; deletion request ${filed.value?.id} filed once and listed as requested`)
    },
  }
}

// ─── prompts ─────────────────────────────────────────────────────────────────

interface Prompt { name: string; version: number; content: string; is_active: boolean; workspace_id: string }

/**
 * Prompts: one made, read back and listed; a request whose system prompt names it (lens:prompt:<name>) comes back
 * X-Talyvor-Prompt-Resolved and the model follows it. A second version read back, with both in the history and the diff
 * between them; the next request follows the second. Rolled back to the first, the next request follows the first again.
 */
export function settingsPrompts(): Scenario {
  return {
    id: 'settings-prompts',
    owner: 'talyvor-lens',
    own: true,
    feature: FEATURE,
    title: "prompts on the workspace's own token: one made, read and listed is used by a request naming it (X-Talyvor-Prompt-Resolved, the model follows it); a second version, its history and diff, and the next request follows it; rolled back, the next follows the first",
    run: async (ctx) => {
      const wrong: string[] = []
      const step = (w: string | undefined) => { if (w !== undefined) wrong.push(w) }
      const k = await proxyKey(ctx, `prompts ${RUN_SALT}`)
      if (typeof k === 'string') return fail(k)
      const { route, model } = judgeRoute(ctx)
      const name = `e2e-${RUN_SALT}-${Date.now().toString(36)}`
      const says = (word: string) => `Whatever the user writes, reply with the single word ${word} and nothing else.`
      const follows = async (word: string, note: string) => {
        const a = await ask(ctx, k.key, route, model.id, note, {}, { system: `lens:prompt:${name}` })
        if (a.headers.get('X-Talyvor-Prompt-Resolved') !== 'true') wrong.push(`${note} came back with no X-Talyvor-Prompt-Resolved`)
        if (!a.text.toUpperCase().includes(word)) wrong.push(`${note}: the prompt says to reply ${word}, and the model replied "${a.text.slice(0, 80)}"`)
        step(await servedRight(ctx, a, model, note))
      }
      const get = async () => (await call<Prompt>(ctx, 'GET', `/v1/prompts/${name}`)).value

      const made = await call<Prompt>(ctx, 'POST', '/v1/prompts', { name, content: says('PELICAN'), description: 'e2e' })
      ctx.evidence.push({ note: `POST /v1/prompts: ${said(made)}` })
      if (made.status !== 201 || made.value?.version !== 1) return fail(`making a prompt answered ${said(made)}`)
      const v1 = await get()
      if (v1?.content !== says('PELICAN') || v1.workspace_id !== ctx.app.user.workspaceID) wrong.push(`the prompt reads back as ${JSON.stringify(v1)}`)
      const list = await call<Prompt[] | null>(ctx, 'GET', '/v1/prompts')
      if (!(list.value ?? []).some((p) => p.name === name)) wrong.push(`the list of prompts does not hold ${name}: ${list.text.slice(0, 200)}`)
      await follows('PELICAN', 'a request naming the prompt')

      const put = await call<Prompt>(ctx, 'PUT', `/v1/prompts/${name}`, { content: says('OTTER'), description: 'e2e v2' })
      const v2 = await get()
      const history = await call<Prompt[] | null>(ctx, 'GET', `/v1/prompts/${name}/history`)
      const diff = await call<{ from_version: number; to_version: number; lines_added: number; lines_removed: number; diff: string }>(ctx, 'GET', `/v1/prompts/${name}/diff?from=1&to=2`)
      ctx.evidence.push({ note: `PUT: ${said(put)}; history ${history.text.slice(0, 200)}; diff ${said(diff)}` })
      if (!ok(put.status) || v2?.version !== 2 || v2.content !== says('OTTER')) wrong.push(`the second version reads back as ${JSON.stringify(v2)} (${said(put)})`)
      const versions = (history.value ?? []).map((p) => p.version).sort()
      if (versions.join(',') !== '1,2') wrong.push(`the prompt's history holds versions ${versions.join(', ') || 'none'}, not 1 and 2`)
      if (diff.value?.from_version !== 1 || diff.value.to_version !== 2 || !(diff.value.lines_added > 0) || !(diff.value.lines_removed > 0) || !diff.value.diff.includes('OTTER')) wrong.push(`the diff from 1 to 2 reads ${said(diff)}`)
      await follows('OTTER', 'a request naming the prompt, after its second version')

      const back = await call<Prompt>(ctx, 'POST', `/v1/prompts/${name}/rollback`, { version: 1 })
      const v3 = await get()
      ctx.evidence.push({ note: `rolled back to 1: ${said(back)}; reads ${JSON.stringify(v3)}` })
      if (!ok(back.status) || v3?.content !== says('PELICAN')) wrong.push(`rolled back to version 1, the prompt reads ${JSON.stringify(v3)}`)
      await follows('PELICAN', 'a request naming the prompt, after the rollback')
      return verdictOf(wrong, `${name} made, read and listed; requests naming it were resolved and followed it — PELICAN, OTTER after version 2 (history 1 and 2, the diff between them), PELICAN again after the rollback`)
    },
  }
}
