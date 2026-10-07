// B34.6 — every way into Lens's gateway has a tester. On the 5 Oct map the provider proxies, the OpenAI- and
// Anthropic-compatible prefixes, MCP, API keys and their rotation, tokens, session keys and sessions read "not
// covered". Each scenario here runs on a workspace of its own and calls Lens as a customer's software does, with that
// workspace's own key or token. A served request is one spend row on the ledger at the catalog price, with its
// platform fee beside it and any hold it took released; a provider Lens holds no key for answers its refusal, which
// is the oracle, and moves nothing; a rotated key's old value stops working once the rotation completes.

import { fail, platformFeeOf } from './bank.ts'
import { worstInputTokens } from './budget.ts'
import type { LedgerRow } from './lens.ts'
import { refusalOf } from './lens.ts'
import { type CatalogModel, RUN_SALT, chatModels, listPriceUSD } from './oracles.ts'
import { feeVerdict, within } from './pricing.ts'
import type { Scenario, ScenarioCtx, Verdict } from './scenarios.ts'

/** How long a served request's rows may take to reach the ledger: on production they were there within 2 s (7 Oct). */
const CHARGE_WAIT_MS = 15_000
/** How long a refused request is given to write a row it must not write. */
const REFUSED_WAIT_MS = 2_000
const MAX_TOKENS = 16
/** How long MCP's stream is given to send its first event: Lens sends it as soon as the stream opens. */
const SSE_WAIT_MS = 15_000
const FEATURE = 'Lens API'

type Shape = 'openai' | 'anthropic'
interface Route { route: string; provider: string; shape: Shape }

/** Every way a model is asked through Lens: the provider it reaches and the API it speaks. */
export const GATEWAY_ROUTES: readonly Route[] = [
  { route: '/v1/proxy/openai', provider: 'openai', shape: 'openai' },
  { route: '/oai', provider: 'openai', shape: 'openai' },
  { route: '/v1/proxy/anthropic', provider: 'anthropic', shape: 'anthropic' },
  { route: '/anthropic', provider: 'anthropic', shape: 'anthropic' },
  { route: '/v1/proxy/google', provider: 'google', shape: 'openai' },
  { route: '/v1/proxy/bedrock', provider: 'bedrock', shape: 'openai' },
  { route: '/v1/proxy/mistral', provider: 'mistral', shape: 'openai' },
  { route: '/v1/proxy/groq', provider: 'groq', shape: 'openai' },
  { route: '/v1/proxy/vllm', provider: 'vllm', shape: 'openai' },
]

// ─── the oracles ─────────────────────────────────────────────────────────────

/** The cheapest model the catalog prices for `provider`, or undefined when it prices none. */
export function cheapestOf(catalog: readonly CatalogModel[], provider: string): CatalogModel | undefined {
  return chatModels(catalog).filter((m) => m.provider === provider)
    .sort((a, b) => a.input_per_1m + a.output_per_1m - (b.input_per_1m + b.output_per_1m) || a.id.localeCompare(b.id))[0]
}

/**
 * A request's price at the catalog's list price in µLXC, rounded up — worked in whole µUSD, so 34 tokens at $0.10 a
 * million are 3.4 µUSD exactly and not a float's 3.4000000000000004.
 */
export function catalogULXC(m: Pick<CatalogModel, 'input_per_1m' | 'output_per_1m'>, inputTokens: number, outputTokens: number, usdPerLXC: number): number {
  const micros = (usd: number) => Math.round(usd * 1e6)
  const num = inputTokens * micros(m.input_per_1m) + outputTokens * micros(m.output_per_1m)
  const den = micros(usdPerLXC)
  return Math.floor((num + den - 1) / den)
}

const rowsText = (rows: readonly LedgerRow[]): string => rows.map((r) => `${r.type} ${r.amount_ulxc} µLXC`).join(', ')

/**
 * One served request's rows: one spend row at the catalog price, its platform fee beside it at the plan's rate, and any
 * hold it took released in full. Lens rounds a float's cost up, so a spend one µLXC above the exact price is that price
 * (34 tokens at $0.10 a million debit 43 µLXC, where the exact figure is 42).
 */
export function servedVerdict(fresh: readonly LedgerRow[], wantULXC: number, bps: number): Verdict {
  const spends = fresh.filter((r) => r.type === 'spend')
  if (spends.length !== 1) return fail(`the served request wrote ${spends.length} spend rows${spends.length === 0 ? '' : `: ${rowsText(spends)}`}; at the catalog price it costs ${wantULXC} µLXC`)
  const spend = -spends[0].amount_ulxc
  if (spend !== wantULXC && spend !== wantULXC + 1) return fail(`its spend row debits ${spend} µLXC; at the catalog price it costs ${wantULXC}`)
  const fee = feeVerdict(fresh, bps)
  if (!fee.pass) return fee
  const rest = fresh.filter((r) => r.type !== 'spend' && r.type !== 'platform_fee')
  const moved = rest.reduce((s, r) => s + r.amount_ulxc, 0)
  if (moved !== 0) return fail(`beside its spend and fee it wrote ${rowsText(rest)}, which move ${moved} µLXC more`)
  return { pass: true, detail: `one ${spend} µLXC spend row at the catalog price and its ${-fresh.find((r) => r.type === 'platform_fee')!.amount_ulxc} µLXC fee${rest.length === 0 ? '' : ', its hold released'}` }
}

/** A provider Lens holds no key for: its refusal — 503, saying what is not configured — and nothing on the ledger. */
export function refusedVerdict(status: number, error: string, fresh: readonly LedgerRow[]): Verdict {
  if (status !== 503 || !/\bnot configured\b/.test(error)) {
    return fail(`answered ${status} "${error}": neither served nor the refusal of a provider Lens holds no key for (503 "… not configured")`)
  }
  if (fresh.length > 0) return fail(`refused "${error}", and the ledger gained ${rowsText(fresh)}`)
  return { pass: true, detail: `refused 503 "${error}", nothing on the ledger` }
}

// ─── asking ──────────────────────────────────────────────────────────────────

interface Asked {
  status: number
  /** Lens's sentence, when it refused. */
  error: string
  /** The provider's token counts, when it was served. */
  usage?: { input: number; output: number }
  /** The rows the ledger gained. */
  fresh: LedgerRow[]
}

function usageOf(text: string): Asked['usage'] {
  try {
    const u = (JSON.parse(text) as { usage?: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number } }).usage
    return u === undefined ? undefined : { input: u.prompt_tokens ?? u.input_tokens ?? 0, output: u.completion_tokens ?? u.output_tokens ?? 0 }
  } catch {
    return undefined
  }
}

let asks = 0

/**
 * One question on `r` with `credential`, its worst case held against the run's cap first, and the rows the ledger gained:
 * for a served one, read until its spend and fee are there and any hold is released; for a refused one, a moment later.
 * What it spent is booked for the ledger read-back. The question is this run's own, so neither the workspace's cache nor
 * the pool can answer it.
 */
async function ask(ctx: ScenarioCtx, credential: string, r: Route, model: string, note: string, headers: Record<string, string> = {}): Promise<Asked> {
  const { env, app } = ctx
  const priced = env.catalog.find((m) => m.id === model)
  const n = ++asks
  const question = `What is ${1000 + ((RUN_SALT + n * 7919) % 9000)} + ${1000 + n}? Reply with the number only. (${RUN_SALT}-${Date.now().toString(36)}-${n})`
  const before = new Set((await env.lens.ledger(app.user)).map((x) => x.id))
  const hold = env.cap.reserve(priced === undefined ? 0 : listPriceUSD(priced, worstInputTokens(question.length), MAX_TOKENS))
  let res: { status: number; headers: Headers; text: string }
  try {
    res = await env.lens.as(credential, 'POST', `${r.route}${r.shape === 'anthropic' ? '/v1/messages' : '/v1/chat/completions'}`,
      { model, max_tokens: MAX_TOKENS, messages: [{ role: 'user', content: question }] },
      { ...(r.shape === 'anthropic' ? { 'anthropic-version': '2023-06-01' } : {}), ...headers })
  } catch (e) {
    env.cap.settle(hold, undefined)
    throw e
  }
  const usage = res.status === 200 ? usageOf(res.text) : undefined
  const settled = (rows: LedgerRow[]) => rows.some((x) => x.type === 'spend') && rows.some((x) => x.type === 'platform_fee') &&
    rows.filter((x) => x.type !== 'spend' && x.type !== 'platform_fee').reduce((s, x) => s + x.amount_ulxc, 0) === 0
  const read = async () => (await env.lens.ledger(app.user)).filter((x) => !before.has(x.id))
  if (res.status !== 200) await new Promise((w) => setTimeout(w, REFUSED_WAIT_MS))
  const fresh = res.status === 200 ? await within(read, settled, CHARGE_WAIT_MS) : await read()
  const spent = fresh.filter((x) => x.type === 'spend').reduce((s, x) => s - x.amount_ulxc, 0)
  // Served and not charged, it still cost the provider its price.
  env.cap.settle(hold, spent > 0 ? (spent / 1e6) * env.usdPerLXC : res.status !== 200 ? 0 : priced !== undefined && usage !== undefined ? listPriceUSD(priced, usage.input, usage.output) : undefined)
  for (const x of fresh) if (x.type === 'spend') env.book.add(app.user.workspaceID, -x.amount_ulxc)
  const error = res.status === 200 ? '' : refusalOf(res.text)
  ctx.evidence.push({
    note: `${note}: ${r.route} ${model}, ${res.status}${usage === undefined ? '' : ` (${usage.input} in / ${usage.output} out tokens)`}`,
    question,
    error: error === '' ? undefined : error,
    ledger: fresh.map((x) => ({ type: x.type, amount_ulxc: x.amount_ulxc, created_at: x.created_at })),
  })
  if (res.headers.get('X-Talyvor-Cache-Replay') === 'true' || res.headers.has('X-Talyvor-Pool-Charged-ULXC')) {
    throw new Error(`Lens answered "${question}" from an earlier answer, which is charged otherwise: there is no catalog price to judge`)
  }
  return { status: res.status, error, usage, fresh }
}

/** `a`, served, judged at the catalog price of `model`; undefined when right, else what is wrong. */
async function servedRight(ctx: ScenarioCtx, a: Asked, model: CatalogModel, who: string): Promise<string | undefined> {
  if (a.status !== 200) return `${who} was refused: ${a.status} ${a.error}`
  if (a.usage === undefined) return `${who} was served with no token counts`
  const v = servedVerdict(a.fresh, catalogULXC(model, a.usage.input, a.usage.output, ctx.env.usdPerLXC), (await platformFeeOf(ctx)).bps)
  return v.pass ? undefined : `${who}: ${v.detail}`
}

/** The route and model the judge is asked on: the provider the harness relies on to serve. */
function judgeRoute(ctx: ScenarioCtx): { route: Route; model: CatalogModel } {
  const model = ctx.env.catalog.find((m) => m.id === ctx.env.judgeModel)
  if (model === undefined) throw new Error(`the catalog has no model ${ctx.env.judgeModel}`)
  const route = GATEWAY_ROUTES.find((r) => r.route === `/v1/proxy/${ctx.env.judgeProvider}`)
  if (route === undefined) throw new Error(`Lens has no proxy route for ${ctx.env.judgeProvider}`)
  return { route, model }
}

/** A key of the workspace's own that may call the proxy (POST /v1/workspaces/{ws}/api-keys), or why not. */
async function proxyKey(ctx: ScenarioCtx, name: string): Promise<{ key: string; id: string; prefix: string } | string> {
  const made = await ctx.env.lens.act<{ key: string; id: string; prefix: string }>(ctx.app.user, 'POST', '/v1/workspaces/{ws}/api-keys', { name, scopes: ['proxy'] })
  ctx.evidence.push({ note: `a key of the workspace's own, "${name}": ${made.ok ? `${made.status}, ${made.value.prefix}…` : `refused ${made.status}: ${made.error}`}` })
  if (!made.ok) return `creating a key of the workspace's own was refused: ${made.status} ${made.error}`
  if (!made.value.key.startsWith(made.value.prefix)) return `the key Lens returned does not start with the prefix it states, ${made.value.prefix}`
  return made.value
}

const verdictOf = (wrong: readonly string[], right: string): Verdict => wrong.length > 0 ? fail(wrong.join('; ')) : { pass: true, detail: right }

// ─── the scenarios ───────────────────────────────────────────────────────────

/** Every provider route and both compatible prefixes, each asked once on the workspace's own key. */
export function gatewayProviders(): Scenario {
  return {
    id: 'gateway-providers',
    owner: 'talyvor-lens',
    own: true,
    feature: FEATURE,
    title: "every provider route and the OpenAI- and Anthropic-compatible prefixes, on the workspace's own key: a served request is one spend row at the catalog price with its fee; a provider Lens holds no key for refuses and moves nothing",
    run: async (ctx) => {
      const k = await proxyKey(ctx, `gateway ${RUN_SALT}`)
      if (typeof k === 'string') return fail(k)
      const right: string[] = []
      const wrong: string[] = []
      for (const r of GATEWAY_ROUTES) {
        const model = cheapestOf(ctx.env.catalog, r.provider)
        const a = await ask(ctx, k.key, r, model?.id ?? `${r.provider}-default`, r.provider)
        let w: string | undefined
        if (a.status !== 200) {
          const v = refusedVerdict(a.status, a.error, a.fresh)
          w = v.pass ? undefined : `${r.route}: ${v.detail}`
          if (v.pass) right.push(`${r.route}: ${v.detail}`)
        } else {
          w = model === undefined ? `${r.route}: served a model the catalog prices nothing for` : await servedRight(ctx, a, model, r.route)
          if (w === undefined) right.push(`${r.route}: served ${model!.id} at its catalog price`)
        }
        if (w !== undefined) wrong.push(w)
      }
      return verdictOf(wrong, right.join('; '))
    },
  }
}

/** MCP: refused without a credential; with the workspace's token it names itself and its tools, and counts a request. */
export function gatewayMCP(): Scenario {
  return {
    id: 'gateway-mcp',
    owner: 'talyvor-lens',
    own: true,
    feature: FEATURE,
    title: "MCP on the workspace's own token: POST /mcp names Lens and its tools and its spend summary counts a request at its catalog price; /mcp/sse opens on the endpoint event; both refuse no credential",
    run: async (ctx) => {
      const { env, app } = ctx
      const wrong: string[] = []
      let id = 0
      const rpc = async <T>(credential: string, method: string, params?: unknown): Promise<{ status: number; result?: T; error?: string }> => {
        const r = await env.lens.as(credential, 'POST', '/mcp', { jsonrpc: '2.0', id: ++id, method, ...(params === undefined ? {} : { params }) })
        if (r.status !== 200) return { status: r.status, error: refusalOf(r.text) }
        const body = JSON.parse(r.text) as { result?: T; error?: { message: string } }
        return { status: r.status, result: body.result, error: body.error?.message }
      }
      const summary = async (): Promise<{ total_requests: number; total_cost_usd: number }> => {
        const r = await rpc<{ content: { text: string }[] }>(app.user.token, 'tools/call', { name: 'get_spend_summary', arguments: { days: 1 } })
        if (r.result === undefined) throw new Error(`MCP's get_spend_summary answered ${r.status} ${r.error ?? 'no result'}`)
        return JSON.parse(r.result.content[0].text) as { total_requests: number; total_cost_usd: number }
      }

      const bare = await rpc('', 'initialize', {})
      if (bare.status !== 401) wrong.push(`POST /mcp with no credential answered ${bare.status}, not 401`)
      const init = await rpc<{ protocolVersion: string; serverInfo: { name: string } }>(app.user.token, 'initialize', {})
      ctx.evidence.push({ note: `initialize: ${init.status} ${JSON.stringify(init.result ?? init.error)}` })
      if (init.result?.serverInfo.name !== 'talyvor-lens' || !init.result.protocolVersion) wrong.push(`initialize answered ${init.status} ${JSON.stringify(init.result ?? init.error)}`)
      const tools = await rpc<{ tools: { name: string }[] }>(app.user.token, 'tools/list')
      const names = tools.result?.tools.map((t) => t.name) ?? []
      if (!names.includes('get_spend_summary')) wrong.push(`tools/list names no get_spend_summary: ${names.join(', ') || tools.error}`)

      const before = await summary()
      const k = await proxyKey(ctx, `mcp ${RUN_SALT}`)
      if (typeof k === 'string') return fail(k)
      const { route, model } = judgeRoute(ctx)
      const a = await ask(ctx, k.key, route, model.id, 'one question for MCP to count')
      if (a.status !== 200 || a.usage === undefined) return fail([...wrong, `the question MCP was to count was refused: ${a.status} ${a.error}`].join('; '))
      const want = listPriceUSD(model, a.usage.input, a.usage.output)
      const after = await within(summary, (s) => s.total_requests > before.total_requests, CHARGE_WAIT_MS)
      ctx.evidence.push({ note: `get_spend_summary before and after: ${JSON.stringify(before)} → ${JSON.stringify(after)}; the request's catalog price $${want}` })
      if (after.total_requests !== before.total_requests + 1) wrong.push(`MCP's spend summary counted ${after.total_requests - before.total_requests} requests for the one made`)
      else if (Math.abs(after.total_cost_usd - before.total_cost_usd - want) > 1e-9) {
        wrong.push(`MCP's spend summary rose by $${after.total_cost_usd - before.total_cost_usd} for a request whose catalog price is $${want}`)
      }

      const sse = await env.lens.firstEvent(app.user.token, '/mcp/sse', SSE_WAIT_MS)
      ctx.evidence.push({ note: `GET /mcp/sse: ${sse.status} ${JSON.stringify(sse.event)}` })
      if (sse.status !== 200 || !/^event: endpoint\ndata: \{"uri":"\/mcp"\}$/.test(sse.event)) {
        wrong.push(sse.status === 0 ? `GET /mcp/sse sent nothing in ${SSE_WAIT_MS / 1000} s, not even its headers` : `GET /mcp/sse answered ${sse.status} and opened on ${JSON.stringify(sse.event)}, not the endpoint event naming /mcp`)
      }
      const sseBare = await env.lens.firstEvent('', '/mcp/sse', SSE_WAIT_MS)
      if (sseBare.status !== 401) wrong.push(`GET /mcp/sse with no credential answered ${sseBare.status}, not 401`)
      return verdictOf(wrong, `MCP names talyvor-lens and ${names.length} tools, counts the request at its catalog price ($${want}), opens its stream on the endpoint event, and refuses no credential`)
    },
  }
}

/**
 * The workspace's keys: one made, listed by its prefix and serving; rotated while in use (completion refused until the
 * new key has made a request, the old value refused after it); a second rotation abandoned; one rotated at once; one
 * deleted; a key of the other kind (POST /v1/api/keys) made, serving and deleted; and the shared pool of provider keys,
 * which the workspace may neither add to nor take from.
 */
export function gatewayKeys(): Scenario {
  return {
    id: 'gateway-keys',
    owner: 'talyvor-lens',
    own: true,
    feature: FEATURE,
    title: "the workspace's API keys: made, listed, served at the catalog price and counted; a rotation's old value stops working once it completes, an abandoned one's new value never works; a deleted key is refused; the shared key pool refuses the workspace",
    run: async (ctx) => {
      const { env, app } = ctx
      const lens = env.lens
      const { route, model } = judgeRoute(ctx)
      const wrong: string[] = []
      const step = (w: string | undefined) => { if (w !== undefined) wrong.push(w) }
      const serves = async (key: string, who: string) => servedRight(ctx, await ask(ctx, key, route, model.id, who), model, who)
      const refused = async (key: string, who: string): Promise<string | undefined> => {
        const a = await ask(ctx, key, route, model.id, who)
        if (a.status !== 401) return `${who} answered ${a.status}${a.status === 200 ? ', served' : ` "${a.error}"`}, not 401`
        return a.fresh.length === 0 ? undefined : `${who} was refused, and the ledger gained ${rowsText(a.fresh)}`
      }
      const listed = async () => (await lens.act<{ id: string; key_prefix: string }[] | null>(app.user, 'GET', '/v1/workspaces/{ws}/api-keys'))
      const ws = (p: string) => `/v1/workspaces/{ws}${p}`

      // 1. Made: listed by its prefix, never its value; it serves; its usage shows the request.
      const a = await proxyKey(ctx, `rotated ${RUN_SALT}`)
      if (typeof a === 'string') return fail(a)
      const list = await listed()
      if (!list.ok || !(list.value ?? []).some((k) => k.id === a.id && k.key_prefix === a.prefix)) wrong.push(`the list of keys does not hold the new key by its prefix: ${JSON.stringify(list)}`)
      if (list.ok && JSON.stringify(list.value).includes(a.key)) wrong.push("the list of keys shows the new key's whole value")
      step(await serves(a.key, 'the new key'))
      const usage = await lens.act<{ last_used_at: string | null; total_requests: number; total_cost: number }>(app.user, 'GET', ws(`/api-keys/${a.id}/usage`))
      ctx.evidence.push({ note: `its usage: ${JSON.stringify(usage)}` })
      if (!usage.ok || usage.value.last_used_at === null) wrong.push(`the new key's usage names no last use after it served a request: ${JSON.stringify(usage)}`)
      else if (usage.value.total_requests !== 1 || !(usage.value.total_cost > 0)) {
        wrong.push(`the new key's usage reads ${usage.value.total_requests} requests costing $${usage.value.total_cost} after the one request it made`)
      }

      // 2. A rotation begun: completing it before the new key has made a request is refused and revokes nothing.
      const begun = await lens.act<{ rotation_id: string; key: string; id: string; old_key_still_valid: boolean }>(app.user, 'POST', ws(`/api-keys/${a.id}/rotate/begin`), {})
      ctx.evidence.push({ note: `rotation begun: ${begun.ok ? `${begun.status}, old key still valid: ${begun.value.old_key_still_valid}` : `refused ${begun.status}: ${begun.error}`}` })
      if (!begun.ok) return fail([...wrong, `beginning a rotation was refused: ${begun.status} ${begun.error}`].join('; '))
      const rotation = ws(`/key-rotations/${begun.value.rotation_id}`)
      const early = await lens.act(app.user, 'POST', `${rotation}/complete`, {})
      if (early.ok || early.status !== 412) wrong.push(`completing the rotation before the new key had made a request answered ${early.status}, not 412`)
      step(await serves(a.key, 'the old key, while the rotation is open'))
      step(await serves(begun.value.key, 'the new key, while the rotation is open'))
      const status = await lens.act<{ new_key_used: boolean }>(app.user, 'GET', rotation)
      if (!status.ok || !status.value.new_key_used) wrong.push(`the rotation does not read the new key as used: ${JSON.stringify(status)}`)

      // 3. Completed: the old key's value stops working.
      const done = await lens.act<{ outcome: string }>(app.user, 'POST', `${rotation}/complete`, {})
      ctx.evidence.push({ note: `rotation completed: ${JSON.stringify(done)}` })
      if (!done.ok || done.value.outcome !== 'completed') return fail([...wrong, `completing the rotation answered ${JSON.stringify(done)}`].join('; '))
      step(await refused(a.key, 'the old key, once the rotation completed'))

      // 4. A second rotation, abandoned: its new key never works, and the key in use goes on.
      const second = await lens.act<{ rotation_id: string; key: string }>(app.user, 'POST', ws(`/api-keys/${begun.value.id}/rotate/begin`), {})
      if (!second.ok) return fail([...wrong, `beginning a second rotation was refused: ${second.status} ${second.error}`].join('; '))
      const abandoned = await lens.act<{ outcome: string }>(app.user, 'POST', ws(`/key-rotations/${second.value.rotation_id}/abandon`), {})
      ctx.evidence.push({ note: `second rotation abandoned: ${JSON.stringify(abandoned)}` })
      if (!abandoned.ok || abandoned.value.outcome !== 'abandoned') wrong.push(`abandoning the second rotation answered ${JSON.stringify(abandoned)}`)
      step(await refused(second.value.key, "the abandoned rotation's new key"))
      step(await serves(begun.value.key, 'the key in use, after the abandoned rotation'))

      // 5. Rotated at once: the old value stops at once.
      const swapped = await lens.act<{ key: string; id: string }>(app.user, 'POST', ws(`/api-keys/${begun.value.id}/rotate`), {})
      if (!swapped.ok) return fail([...wrong, `rotating the key at once was refused: ${swapped.status} ${swapped.error}`].join('; '))
      step(await refused(begun.value.key, 'the key rotated at once'))
      step(await serves(swapped.value.key, 'its replacement'))

      // 6. Deleted: refused, and gone from the list.
      const deleted = await lens.act(app.user, 'DELETE', ws(`/api-keys/${swapped.value.id}`))
      if (!deleted.ok) wrong.push(`deleting the key was refused: ${deleted.status} ${deleted.error}`)
      step(await refused(swapped.value.key, 'the deleted key'))
      const after = await listed()
      if (after.ok && (after.value ?? []).some((k) => k.id === swapped.value.id)) wrong.push('the deleted key is still listed')

      // 7. The other kind of key, from POST /v1/api/keys: it serves at the catalog price, and once deleted it is refused.
      const other = await lens.act<{ key: string; id: string }>(app.user, 'POST', '/v1/api/keys', { name: `api ${RUN_SALT}` })
      ctx.evidence.push({ note: `POST /v1/api/keys: ${other.ok ? `${other.status}, id ${other.value.id}` : `refused ${other.status}: ${other.error}`}` })
      if (!other.ok) wrong.push(`POST /v1/api/keys was refused: ${other.status} ${other.error}`)
      else {
        step(await serves(other.value.key, 'a key from POST /v1/api/keys'))
        const gone = await lens.act(app.user, 'DELETE', `/v1/api/keys/${other.value.id}`)
        if (!gone.ok) wrong.push(`DELETE /v1/api/keys/${other.value.id} was refused: ${gone.status} ${gone.error}`)
        step(await refused(other.value.key, 'that key, once deleted'))
      }

      // 8. The shared pool of provider keys is Talyvor's: the workspace may read it, and may neither add to it nor take from it.
      const size = async () => {
        const r = await lens.as(app.user.token, 'GET', '/v1/api/keys/pool')
        const v = JSON.parse(r.text) as unknown
        return Array.isArray(v) ? v.length : v === null ? 0 : Object.keys(v as object).length
      }
      const pool0 = await size()
      const add = await lens.as(app.user.token, 'POST', '/v1/api/keys/pool', { provider: route.provider, key: `sk-e2e-placeholder-${RUN_SALT}` })
      const take = await lens.as(app.user.token, 'DELETE', `/v1/api/keys/pool/e2e-${RUN_SALT}`)
      ctx.evidence.push({ note: `the pool: add ${add.status} ${refusalOf(add.text)}; take ${take.status} ${refusalOf(take.text)}` })
      for (const [what, r] of [['adding a key to the shared pool', add], ['taking one from it', take]] as const) {
        if (r.status !== 401 && r.status !== 403) wrong.push(`${what} with the workspace's own token answered ${r.status}, not a refusal`)
      }
      const pool1 = await size()
      if (pool1 !== pool0) wrong.push(`the shared pool held ${pool0} entries and holds ${pool1} after the workspace was refused`)

      return verdictOf(wrong, 'a key made, listed by its prefix, served at the catalog price and counted; completing a rotation refused until the new key served, the old key refused after it; an abandoned rotation\'s key never served; a key rotated at once and one deleted refused; a /v1/api/keys key served and refused once deleted; the shared pool refused the workspace both ways')
    },
  }
}

/** Tokens and session keys: the workspace may not mint a token; it refreshes its own; it revokes one session key, then all. */
export function gatewayAuth(): Scenario {
  return {
    id: 'gateway-auth',
    owner: 'talyvor-lens',
    // Revoking every session key of a workspace signs out each browser on it: on its own, it signs out nobody else's.
    own: true,
    feature: FEATURE,
    title: "tokens and session keys: the workspace's own token may not mint a token; a refreshed token is the same workspace for longer and is charged at the catalog price; one session key revoked stops working, and revoking all stops the rest",
    run: async (ctx) => {
      const { env, app } = ctx
      const lens = env.lens
      const wrong: string[] = []
      type Me = { workspace_id: string; user_id: string; scopes: string[] | null; auth_method: string; expires_at?: string }
      const me = async (credential: string) => {
        const r = await lens.as(credential, 'GET', '/v1/auth/me')
        return { status: r.status, me: r.status === 200 ? (JSON.parse(r.text) as Me) : undefined }
      }

      // A token for a workspace is the operator's, or a mint credential's, to issue.
      const minted = await lens.as(app.user.token, 'POST', '/v1/auth/token', { workspace_id: app.user.workspaceID, user_id: app.user.workspaceID })
      ctx.evidence.push({ note: `POST /v1/auth/token on the workspace's own token: ${minted.status} ${refusalOf(minted.text)}` })
      if (minted.status !== 403 || minted.text.includes('"token"')) wrong.push(`the workspace's own token asked POST /v1/auth/token for a token and Lens answered ${minted.status}, not 403`)

      // Refreshed: the same workspace, user and scopes, for longer — and what it asks is charged.
      const old = await me(app.user.token)
      const refreshed = await lens.as(app.user.token, 'POST', '/v1/auth/refresh', {})
      const fresh = refreshed.status === 200 ? (JSON.parse(refreshed.text) as { token: string; expires_at: string }) : undefined
      ctx.evidence.push({ note: `POST /v1/auth/refresh: ${refreshed.status}${fresh === undefined ? ` ${refusalOf(refreshed.text)}` : `, expires ${fresh.expires_at}`}` })
      if (fresh === undefined || old.me === undefined) return fail([...wrong, `refreshing the workspace's token answered ${refreshed.status} ${refusalOf(refreshed.text)}`].join('; '))
      const now = await me(fresh.token)
      const same = now.me !== undefined && now.me.workspace_id === old.me.workspace_id && now.me.user_id === old.me.user_id &&
        JSON.stringify(now.me.scopes) === JSON.stringify(old.me.scopes) && now.me.auth_method === 'jwt'
      if (!same) wrong.push(`the refreshed token reads ${JSON.stringify(now.me ?? now.status)}; the token it refreshed read ${JSON.stringify(old.me)}`)
      else if (!(Date.parse(now.me!.expires_at ?? '') > Date.parse(old.me.expires_at ?? ''))) wrong.push(`the refreshed token expires ${now.me!.expires_at}, not after the old one's ${old.me.expires_at}`)
      const { route, model } = judgeRoute(ctx)
      const w = await servedRight(ctx, await ask(ctx, fresh.token, route, model.id, 'the refreshed token asks'), model, 'a question on the refreshed token')
      if (w !== undefined) wrong.push(w)

      // Session keys: each is the workspace's; one revoked stops working, the other goes on until all are revoked.
      const mint = async () => {
        const r = await lens.as(app.user.token, 'POST', '/v1/auth/session-keys', {})
        if (r.status !== 201 && r.status !== 200) throw new Error(`minting a session key answered ${r.status} ${refusalOf(r.text)}`)
        return JSON.parse(r.text) as { key: string; id: string }
      }
      const [s1, s2] = [await mint(), await mint()]
      for (const s of [s1, s2]) {
        const m = await me(s.key)
        if (m.me?.workspace_id !== app.user.workspaceID || m.me.auth_method !== 'session_key') wrong.push(`a new session key reads ${JSON.stringify(m.me ?? m.status)}`)
      }
      const notJWT = await lens.as(s1.key, 'POST', '/v1/auth/refresh', {})
      if (notJWT.status !== 401) wrong.push(`a session key asked to be refreshed as a token and Lens answered ${notJWT.status}, not 401`)
      const one = await lens.as(app.user.token, 'DELETE', `/v1/auth/session-keys/${s1.id}`)
      const [after1, other1] = [await me(s1.key), await me(s2.key)]
      ctx.evidence.push({ note: `one session key revoked: ${one.status}; it then reads ${after1.status}, the other ${other1.status}` })
      if (one.status >= 300 || after1.status !== 401 || other1.status !== 200) wrong.push(`revoking one session key answered ${one.status}, and then it reads ${after1.status} (want 401) and the other ${other1.status} (want 200)`)
      const all = await lens.as(app.user.token, 'DELETE', '/v1/auth/session-keys')
      const revoked = all.status === 200 ? (JSON.parse(all.text) as { revoked?: number }).revoked : undefined
      const after2 = await me(s2.key)
      ctx.evidence.push({ note: `every session key revoked: ${all.status} ${all.text.slice(0, 100)}; the other then reads ${after2.status}` })
      if (all.status !== 200 || !(Number(revoked) >= 1) || after2.status !== 401) wrong.push(`revoking every session key answered ${all.status} ${all.text.slice(0, 100)}, and the other then reads ${after2.status} (want 401)`)

      return verdictOf(wrong, "the workspace's own token is refused a token; its refreshed token is the same workspace, user and scopes for longer, and charged at the catalog price; a revoked session key stops working and the other only once all are revoked")
    },
  }
}

/** A session named on a request: listed, read and summed as what Lens charged for it. */
export function gatewaySessions(): Scenario {
  return {
    id: 'gateway-sessions',
    owner: 'talyvor-lens',
    own: true,
    feature: FEATURE,
    title: 'a request naming a session (X-Talyvor-Session) on the workspace\'s own key: the session is listed, read and summed with one turn, the provider\'s token counts and the catalog price it was charged at',
    run: async (ctx) => {
      const { env } = ctx
      const k = await proxyKey(ctx, `sessions ${RUN_SALT}`)
      if (typeof k === 'string') return fail(k)
      const { route, model } = judgeRoute(ctx)
      const id = `e2e-${RUN_SALT}-${Date.now().toString(36)}`
      const a = await ask(ctx, k.key, route, model.id, `one question in session ${id}`, { 'X-Talyvor-Session': id })
      const wrong: string[] = []
      const w = await servedRight(ctx, a, model, 'the question in the session')
      if (w !== undefined) wrong.push(w)
      if (a.usage === undefined) return fail(wrong.join('; '))
      const want = listPriceUSD(model, a.usage.input, a.usage.output)
      type Session = { id: string; workspace_id: string; turn_count: number; total_input_tokens: number; total_output_tokens: number; total_cost_usd: number }
      const read = async <T>(path: string) => {
        const r = await env.lens.as(ctx.app.user.token, 'GET', path)
        ctx.evidence.push({ note: `GET ${path}: ${r.status} ${r.text.slice(0, 300)}` })
        return r.status === 200 ? (JSON.parse(r.text) as T) : undefined
      }
      const listed = (await read<Session[] | null>('/v1/sessions'))?.find((s) => s.id === id)
      if (listed?.turn_count !== 1) wrong.push(`GET /v1/sessions lists the session with ${listed === undefined ? 'nothing' : `${listed.turn_count} turns`}, not one turn`)
      const one = await read<Session>(`/v1/sessions/${encodeURIComponent(id)}`)
      if (one === undefined || one.workspace_id !== ctx.app.user.workspaceID || one.turn_count !== 1) wrong.push(`GET /v1/sessions/{id} reads ${JSON.stringify(one)}`)
      else {
        if (one.total_input_tokens !== a.usage.input || one.total_output_tokens !== a.usage.output) {
          wrong.push(`the session holds ${one.total_input_tokens} in / ${one.total_output_tokens} out tokens; the provider counted ${a.usage.input} / ${a.usage.output}`)
        }
        if (Math.abs(one.total_cost_usd - want) > 1e-9) wrong.push(`the session says it cost $${one.total_cost_usd}; at the catalog price it cost $${want}`)
      }
      const sum = await read<{ session_id: string; turn_count: number; total_cost_usd: number }>(`/v1/sessions/${encodeURIComponent(id)}/summary`)
      if (sum?.session_id !== id || sum.turn_count !== 1 || sum.total_cost_usd !== one?.total_cost_usd) wrong.push(`the session's summary reads ${JSON.stringify(sum)}`)
      return verdictOf(wrong, `the session is listed, read and summed with one turn of ${a.usage.input} in / ${a.usage.output} out tokens at its catalog price, $${want}`)
    },
  }
}
