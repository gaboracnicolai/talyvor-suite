// B17.3 SELF-TEST — a stand-in for Lens (and the OIDC issuer the BFF discovers at boot), so the harness
// can be run end to end on one machine against the REAL BFF binary and the REAL web bundle.
//
// It keeps the contracts the harness and the app read: the synthetic routes (B17.1), the workspace
// read the BFF's synthetic sign-in checks (B17.2), session keys, the catalog, the ledger, and the
// streaming proxy with Lens's replay and pool headers. The "model" is arithmetic and a table of
// capitals — enough for every oracle to have something true to check.
//
// B17.8 adds what the Features page and the Try-it pages read and write: the workspace's settings,
// its guardrails and spending limits, Tare and document-conversion previews, and a document attached
// in Chat converted on the proxy.
//
// STUB_BREAK=<name> plants one defect, so a harness change can be seen to FAIL on it:
//   price       — answers report twice the tokens they were charged for
//   cross-replay — another account's identical question is replayed as "your earlier answer"
//   pii         — a question with personal data is cached and shared like any other
//   injection   — prompt-injection detection is on but lets everything through
//   distill     — a document attached in Chat is passed on unconverted
//   tare        — Tare's preview drops a field from the rows it keeps
//   conversion  — the conversion preview drops the document's paragraphs
//   budget      — a spending limit is recorded but never refuses
//   setting     — cost-optimised routing is answered as recorded but not kept
//   logging     — request logging "none" still keeps each answer, and serves the kept copy even when
//                 asked past the cache
//   agent-limit — an agent's limit per request is recorded but never refuses (B17.6, stub-bank.ts)
//   subscribe   — the test card is taken and Stripe sends the browser back, but no allowance is granted
//   royalty     — an answer served from the pool to another synthetic workspace mints its contributor nothing
//
// B17.6 adds the Agent Bank and the marketplace (stub-bank.ts): agents with keys of their own, whose
// requests through the proxy are judged by their rules and spent from their own balance.
//
// B17.10 adds plans and royalties as Lens has them for synthetic workspaces since B25.2: subscribing
// sends the browser to a stand-in for Stripe's hosted checkout (/stub-checkout/…, with Stripe's field
// ids), where test card 4242 grants the period's allowance and returns to the app; and a pooled serve
// credits its contributor a pool_royalty_held row on the earnings ledger (tokens/history).
//
// B25.4 adds money between owners and the marketplace's moderators, with their planted defects
// (stub-bank.ts): the review queue answers the moderator key in STUB_MODERATOR_KEY, Lens's minute tick
// runs every two seconds, and Stripe's Connect onboarding is a page at /stub-connect/….

import { randomBytes } from 'node:crypto'
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http'
import { Bank } from './stub-bank.ts'

const PORT = Number(process.env.STUB_PORT ?? 9911)
const BASE = `http://127.0.0.1:${PORT}`
const KEY = process.env.LENS_SYNTHETIC_KEY ?? 'selftest-key'
const BREAK = process.env.STUB_BREAK ?? ''
const USD_PER_LXC = 0.1
const GRANT_ULXC = 1_000_000_000
/** Where Stripe sends the browser back to: the app's /billing/success (LENS_BILLING_SUCCESS_URL). */
const APP_URL = process.env.STUB_APP_URL ?? 'http://localhost:8797'
/** What each plan costs a month, in cents, and the allowance a period grants (LENS_SUBSCRIPTION_ALLOWANCE_ULXC). */
const PLAN_FEES: Record<string, number> = { plus: 2000, pro: 10000, max: 20000 }
const ALLOWANCE_ULXC = 50_000_000

const CATALOG = [
  { id: 'claude-haiku-4-5', provider: 'anthropic', display_name: 'Claude Haiku 4.5', input_per_1m: 1, output_per_1m: 5, release_date: '2025-10-15', tier: 'fast' },
  { id: 'claude-sonnet-5', provider: 'anthropic', display_name: 'Claude Sonnet 5', input_per_1m: 3, output_per_1m: 15, release_date: '2026-06-30', tier: 'balanced' },
  { id: 'gpt-6-luna', provider: 'openai', display_name: 'GPT-6 Luna', input_per_1m: 0.1, output_per_1m: 0.4, release_date: '2026-09-22', tier: 'fast' },
  { id: 'gemini-flash-lite', provider: 'google', display_name: 'Gemini Flash-Lite', input_per_1m: 0.1, output_per_1m: 0.4, release_date: '2026-07-21', tier: 'fast' },
  // Not a chat model, as in production: every-model must not try it.
  { id: 'text-embedding-3-large', provider: 'openai', display_name: 'Embedding 3 large', input_per_1m: 0.13, output_per_1m: 0, release_date: '2024-01-25', tier: 'embedding' },
]
const CONFIGURED = new Set(['anthropic', 'openai'])

const CAPITALS: Record<string, string> = {
  france: 'Paris', japan: 'Tokyo', canada: 'Ottawa', australia: 'Canberra', kenya: 'Nairobi', norway: 'Oslo',
  peru: 'Lima', egypt: 'Cairo', poland: 'Warsaw', chile: 'Santiago', portugal: 'Lisbon', thailand: 'Bangkok',
  ireland: 'Dublin', greece: 'Athens', finland: 'Helsinki', hungary: 'Budapest', argentina: 'Buenos Aires',
  vietnam: 'Hanoi', morocco: 'Rabat', austria: 'Vienna',
}

interface Row { id: string; workspace_id: string; amount_ulxc: number; balance_after_ulxc: number; type: string; description: string; metadata: object; created_at: string }
/** A row of the earnings ledger (Lens mining.LedgerEntry), in µLENS. */
interface Earned { id: string; workspace_id: string; amount_ulens: number; balance_after_ulens: number; type: string; description: string; metadata: object; created_at: string }
interface Settings {
  tare_policy: string
  distill_policy: string
  compression_policy: string
  logging_policy: string
  cache_poolable: boolean
  distill_poolable: boolean
  cost_optimize_routing: boolean
}
interface Budget {
  id: string; scope: string; period: string; limit_usd: number; spent_usd: number; alert_thresholds: number[]
  enforcement: string; ends_at: string | null
}
interface Workspace {
  id: string; token: string; balance: number; ledger: Row[]; answers: Map<string, string>
  settings: Settings
  guardrails: Record<string, unknown> & { enable_injection: boolean; enable_pii: boolean }
  budgets: Budget[]
  usage: { total: number; hits: number; pooled: number; converted: number }
  plan?: { id: string; cancel: boolean }
  allowance?: { granted_ulxc: number; consumed_ulxc: number; remaining_ulxc: number; fee_usd_cents: number }
  earnings: Earned[]
}

function newWorkspace(id: string, token: string): Workspace {
  return {
    id, token, balance: 0, ledger: [], answers: new Map(),
    settings: { tare_policy: 'disabled', distill_policy: 'always', compression_policy: 'disabled', logging_policy: 'full',
      cache_poolable: true, distill_poolable: false, cost_optimize_routing: false },
    guardrails: { enable_injection: true, enable_pii: true, blocked_topics: [], custom_rules: [] },
    budgets: [],
    usage: { total: 0, hits: 0, pooled: 0, converted: 0 },
    earnings: [],
  }
}

// Lens's guardrails, reduced to what the scenarios send.
const INJECTION = /ignore (all )?(previous|prior) instructions/i
const PERSONAL = /[\w.+-]+@[\w-]+\.[\w.]+|\+?\d[\d ()-]{8,}\d/

const workspaces = new Map<string, Workspace>()
const byToken = new Map<string, Workspace>()
const bySessionKey = new Map<string, Workspace>()
/** Single-turn questions any synthetic workspace has had answered: the synthetic pool. */
const pool = new Map<string, { owner: string; answer: string }>()
/** Open checkouts on the stand-in for Stripe: session → the workspace and the plan it is for. */
const checkouts = new Map<string, { ws: string; plan: string }>()

function book(ws: Workspace, amount: number, type: string, description: string): void {
  if (type === 'spend') for (const b of ws.budgets) b.spent_usd += (-amount / 1e6) * USD_PER_LXC
  ws.balance += amount
  ws.ledger.unshift({ id: randomBytes(8).toString('hex'), workspace_id: ws.id, amount_ulxc: amount, balance_after_ulxc: ws.balance,
    type, description, metadata: {}, created_at: new Date().toISOString() })
}

type Block = { type: string; text?: string; source?: { data?: string; media_type?: string }; file?: { file_data?: string } }
type Msg = { role: string; content: string | Block[] }
const text = (m: Msg): string => (typeof m.content === 'string' ? m.content : m.content.map((c) => c.text ?? '').join(''))

/** HTML (or anything else, as it is) to the Markdown Lens's conversion produces. */
function toMarkdown(raw: string, mediaType: string): string {
  if (!/html/.test(mediaType)) return raw.trim()
  return raw
    .replace(/<(script|style|title)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n: string, t: string) => `\n${'#'.repeat(Number(n))} ${t.trim()}\n`)
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<\/(p|tr|table|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** A document block (Anthropic's, or OpenAI's file part) as its media type and bytes. */
function documentOf(c: Block): { mediaType: string; bytes: Buffer } | undefined {
  if (c.type === 'document' && c.source?.data !== undefined) return { mediaType: c.source.media_type ?? '', bytes: Buffer.from(c.source.data, 'base64') }
  const m = c.type === 'file' ? /^data:([^;]*);base64,(.*)$/s.exec(c.file?.file_data ?? '') : null
  return m === null ? undefined : { mediaType: m[1], bytes: Buffer.from(m[2], 'base64') }
}

/** Tare on JSON: an array of same-shaped objects keeps one row per shape. */
function shrink(v: unknown): unknown {
  if (Array.isArray(v)) {
    const seen = new Set<string>()
    const kept = v.filter((x) => {
      const shape = x !== null && typeof x === 'object' ? Object.keys(x).sort().join(',') : typeof x
      if (seen.has(shape)) return false
      seen.add(shape)
      return true
    })
    return kept.map((x) => {
      const row = shrink(x)
      if (BREAK === 'tare' && row !== null && typeof row === 'object' && !Array.isArray(row)) {
        const keys = Object.keys(row)
        delete (row as Record<string, unknown>)[keys[keys.length - 1]]
      }
      return row
    })
  }
  if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shrink(x)]))
  return v
}

/** The stand-in model: arithmetic, capitals, and the harness's own fixed prompts. */
function think(messages: Msg[]): string {
  const q = text(messages[messages.length - 1])
  const all = messages.map(text).join('\n')
  let m
  // An explorer (B17.5), scripted: open Chat, type a question, send it, note a finding, stop.
  if ((m = /^You are an explorer testing Talyvor[\s\S]*?\nStep (\d+) of/.exec(q))) {
    const box = /\[(\d+)\] textarea/.exec(q)?.[1]
    switch (Number(m[1])) {
      case 1: return '{"action":"goto","path":"/chat"}'
      case 2: return box === undefined ? '{"action":"done"}' : `{"action":"fill","target":${box},"text":"What is 2 + 2?"}`
      case 3: return '{"action":"press","key":"Enter"}'
      case 4: return '{"action":"finding","note":"(stub explorer) nothing is wrong; this lead is here to be read","severity":"low"}'
      default: return '{"action":"done"}'
    }
  }
  if ((m = /Answer A: ([\s\S]*?)\n\nAnswer B: ([\s\S]*?)\n\n/.exec(q))) {
    const pick = (s: string) => (/\d[\d,]*/.exec(s)?.[0] ?? s.trim().toLowerCase()).replace(/,/g, '')
    return pick(m[1]) === pick(m[2]) ? 'YES' : 'NO'
  }
  if ((m = /What is (\d+) \+ (\d+)\?/.exec(q))) return String(Number(m[1]) + Number(m[2]))
  if ((m = /What is (\d+) times (\d+)\?/.exec(q))) return String(Number(m[1]) * Number(m[2]))
  if (/^Let x = \d+/.test(q)) return 'OK'
  if ((m = /What is x \+ (\d+)\?/.exec(q))) return String(Number(/Let x = (\d+)/.exec(all)?.[1] ?? NaN) + Number(m[1]))
  if (/^Multiply that by 2/.test(q)) {
    const prev = messages.slice(0, -1).reverse().find((x) => x.role === 'assistant')
    return String(2 * Number(prev === undefined ? NaN : text(prev)))
  }
  if ((m = /capital of ([A-Za-z ]+)\?/.exec(q))) return CAPITALS[m[1].trim().toLowerCase()] ?? 'I do not know.'
  if (/single word: ok/.test(q)) return 'ok'
  if (/code word in the attached document/.test(q)) return /code word is (\w+)/.exec(all)?.[1] ?? 'I cannot see any document.'
  if ((m = /from 1 to (\d+)/.exec(q))) return Array.from({ length: Number(m[1]) }, (_, i) => i + 1).join(' ')
  return 'I can only do arithmetic and capitals.'
}

const tokens = (s: string): number => Math.max(1, Math.ceil(s.length / 4))

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}

async function read(req: IncomingMessage): Promise<string> {
  let s = ''
  for await (const chunk of req) s += chunk
  return s
}

/** A question asked outside the proxy — a marketplace use — answered and charged as the proxy would. */
function runModel(on: { id: string }, modelID: string, question: string): { answer: string } | { error: string } {
  const ws = workspaces.get(on.id)
  const model = CATALOG.find((c) => c.id === modelID)
  if (ws === undefined || model === undefined || !CONFIGURED.has(model.provider)) return { error: `the model ${modelID} cannot be run here` }
  const answer = think([{ role: 'user', content: question }])
  const charge = Math.ceil((((tokens(question) + 8) * model.input_per_1m + tokens(answer) * model.output_per_1m) / 1e6 / USD_PER_LXC) * 1e6)
  book(ws, -charge, 'spend', `${model.id} answer (marketplace use)`)
  return { answer }
}

const bank = new Bank({ brk: BREAK, workspace: (id) => workspaces.get(id), runModel, json, read,
  moderatorKey: process.env.STUB_MODERATOR_KEY ?? '', base: BASE,
  credit: (id, ulxc, type, description) => {
    const ws = workspaces.get(id)
    if (ws !== undefined) book(ws, ulxc, type, description)
  } })
setInterval(() => bank.tick(), 2000)

async function proxy(req: IncomingMessage, res: ServerResponse, provider: string, path: string): Promise<void> {
  const credential = (req.headers.authorization ?? '').replace(/^Bearer /, '')
  const agentCall = bank.agentOfKey(credential)
  const ws = bySessionKey.get(credential) ?? (agentCall === undefined ? undefined : workspaces.get(agentCall.ws.id))
  if (ws === undefined) return json(res, 401, { error: 'unauthorized' })
  const raw = await read(req)
  if (!CONFIGURED.has(provider)) return json(res, 503, { error: `provider ${provider} not configured` })
  const body = JSON.parse(raw || '{}') as { model?: string; stream?: boolean; max_tokens?: number; messages?: Msg[] }
  const model = CATALOG.find((c) => c.id === body.model)
  if (model === undefined || (provider === 'anthropic') !== (path === 'v1/messages')) return json(res, 400, { error: 'bad request' })
  const messages = body.messages ?? []
  const headers: Record<string, string> = {}

  // The guardrails first: an injection is refused before the budget, the cache and the model; personal
  // data keeps the request out of the cache and the pool.
  const said = messages.map(text).join('\n')
  if (ws.guardrails.enable_injection && BREAK !== 'injection' && INJECTION.test(said)) {
    return json(res, 400, { error: 'guardrail violation', violations: [{ type: 'injection', action: 'block' }], risk_score: 1 },
      { 'X-Talyvor-Guardrail-Blocked': 'true' })
  }
  const personal = ws.guardrails.enable_pii && BREAK !== 'pii' && PERSONAL.test(said)
  // An agent's key: its rules judge the request's worst case before anything is answered (B19.2).
  if (agentCall !== undefined) {
    const worst = Math.ceil((((tokens(messages.map(text).join(' ')) + 8) * model.input_per_1m + (body.max_tokens ?? 4096) * model.output_per_1m) / 1e6 / USD_PER_LXC) * 1e6)
    const refused = bank.admit(agentCall.agent, worst, model.id, said)
    if (refused !== undefined) return json(res, refused.status, { error: refused.error })
  }
  if (BREAK !== 'budget' && ws.budgets.some((b) => b.enforcement === 'hard_block' && b.spent_usd >= b.limit_usd)) {
    return json(res, 402, { error: 'budget exceeded for workspace/team/sprint' })
  }
  // Document conversion: asked for by the app, applied unless the workspace switched it off.
  if (req.headers['x-talyvor-distill'] === 'true' && ws.settings.distill_policy !== 'disabled' && BREAK !== 'distill') {
    let converted = 0
    for (const m of messages) {
      if (typeof m.content === 'string') continue
      m.content = m.content.map((c) => {
        const doc = documentOf(c)
        if (doc === undefined) return c
        converted++
        return { type: 'text', text: toMarkdown(doc.bytes.toString('utf8'), doc.mediaType) }
      })
    }
    if (converted > 0) {
      headers['X-Talyvor-Distill'] = 'applied'
      ws.usage.converted += converted
    }
  }
  // Request logging "none" keeps nothing new. As in Lens (talyvor-lens storeCaches), an answer kept
  // before the switch is still there to replay; the BFF asks such a repeat again (B17.12).
  const keep = !personal && (ws.settings.logging_policy !== 'none' || BREAK === 'logging')
  ws.usage.total++

  const key = JSON.stringify([model.id, messages.map((m) => [m.role, text(m)])])
  const bypass = req.headers['x-talyvor-cache'] === 'bypass' && !(BREAK === 'logging' && ws.settings.logging_policy === 'none')
  let answer: string
  let charge = 0
  const own = personal ? undefined : ws.answers.get(key)
  const shared = messages.length === 1 && !personal ? pool.get(key) : undefined
  const inTok = tokens(messages.map(text).join(' ')) + 8
  if (!bypass && own !== undefined) {
    answer = own
    headers['X-Talyvor-Cache-Replay'] = 'true'
    ws.usage.hits++
  } else if (!bypass && shared !== undefined && shared.owner !== ws.id) {
    answer = shared.answer
    ws.usage.pooled++
    if (BREAK === 'cross-replay') {
      headers['X-Talyvor-Cache-Replay'] = 'true'
    } else {
      charge = Math.round(((inTok * model.input_per_1m + tokens(answer) * model.output_per_1m) / 1e6 / USD_PER_LXC) * 1e6 * 0.7)
      headers['X-Talyvor-Pool-Discount-Rate'] = '0.3'
      headers['X-Talyvor-Pool-Charged-ULXC'] = String(charge)
      book(ws, -charge, 'spend', 'pooled answer')
      // The contributor's royalty, held (Lens poolroyalty: minted between two synthetic workspaces since B25.2).
      const owner = workspaces.get(shared.owner)
      if (owner !== undefined && BREAK !== 'royalty') {
        const amount = Math.max(1, Math.round((charge / 0.7) * 0.5))
        const balance = (owner.earnings[0]?.balance_after_ulens ?? 0) + amount
        owner.earnings.unshift({ id: randomBytes(8).toString('hex'), workspace_id: owner.id, amount_ulens: amount, balance_after_ulens: balance,
          type: 'pool_royalty_held', description: 'pool royalty: exact pooled hit served', metadata: { layer: 'exact' }, created_at: new Date().toISOString() })
      }
    }
  } else {
    answer = think(messages)
    const outTok = tokens(answer)
    charge = Math.ceil(((inTok * model.input_per_1m + outTok * model.output_per_1m) / 1e6 / USD_PER_LXC) * 1e6)
    book(ws, -charge, 'spend', `${model.id} answer`)
    if (keep) ws.answers.set(key, answer)
    if (keep && messages.length === 1 && !personal && ws.settings.cache_poolable) pool.set(key, { owner: ws.id, answer })
  }
  if (agentCall !== undefined) bank.spent(agentCall.agent, charge)
  const outTok = tokens(answer)
  const shownIn = BREAK === 'price' ? inTok * 2 : inTok

  if (!body.stream) {
    return json(res, 200, { content: [{ type: 'text', text: answer }], usage: { input_tokens: shownIn, output_tokens: outTok } }, headers)
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', ...headers })
  const pieces = answer.match(/.{1,12}/gs) ?? ['']
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  if (provider === 'anthropic') {
    send('message_start', { type: 'message_start', message: { usage: { input_tokens: shownIn, output_tokens: 0 } } })
    for (const p of pieces) {
      send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: p } })
      await new Promise((r) => setTimeout(r, 30))
    }
    send('message_delta', { type: 'message_delta', usage: { output_tokens: outTok } })
    send('message_stop', { type: 'message_stop' })
  } else {
    for (const p of pieces) {
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: p } }] })}\n\n`)
      await new Promise((r) => setTimeout(r, 30))
    }
    res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: shownIn, completion_tokens: outTok } })}\n\n`)
    res.write('data: [DONE]\n\n')
  }
  res.end()
}

/**
 * The stand-in for Stripe's hosted checkout, with its field ids (#email, #cardNumber, …). Paid with test
 * card 4242, it does what Stripe's test-mode webhook makes Lens do — the plan and the period's allowance
 * — and sends the browser back to the app, as Stripe does.
 */
async function stripeCheckout(req: IncomingMessage, res: ServerResponse, session: string): Promise<void> {
  const open = checkouts.get(session)
  if (open === undefined) return json(res, 404, { error: 'no such checkout' })
  if (req.method !== 'POST') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`<!doctype html><html><head><title>Stub checkout</title></head><body><form method="post">
<h1>Subscribe to ${open.plan}</h1>
<label>Email <input id="email" name="email"></label>
<label>Card number <input id="cardNumber" name="card"></label>
<label>Expiry <input id="cardExpiry" name="expiry"></label>
<label>CVC <input id="cardCvc" name="cvc"></label>
<label>Name on card <input id="billingName" name="name"></label>
<button type="submit" data-testid="hosted-payment-submit-button">Subscribe</button>
</form></body></html>`)
    return
  }
  const form = new URLSearchParams(await read(req))
  if ((form.get('card') ?? '').replace(/\s/g, '') !== '4242424242424242') {
    res.writeHead(402, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<!doctype html><p>Your card was declined.</p>')
    return
  }
  checkouts.delete(session)
  const ws = workspaces.get(open.ws)
  if (ws !== undefined && BREAK !== 'subscribe') {
    ws.plan = { id: open.plan, cancel: false }
    ws.allowance = { granted_ulxc: ALLOWANCE_ULXC, consumed_ulxc: 0, remaining_ulxc: ALLOWANCE_ULXC, fee_usd_cents: PLAN_FEES[open.plan] }
  }
  res.writeHead(303, { Location: `${APP_URL}/billing/success?session_id=${session}` })
  res.end()
}

/** The Features page's switches: Lens's route for each, and the field it records. */
const SETTINGS: Record<string, keyof Settings> = {
  '/tare': 'tare_policy',
  '/distill': 'distill_policy',
  '/cost-optimize-routing': 'cost_optimize_routing',
  '/distill-poolable': 'distill_poolable',
  '/logging': 'logging_policy',
  '/cache-poolable': 'cache_poolable',
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', BASE)
  const p = url.pathname
  const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '')
  try {
    if (p === '/.well-known/openid-configuration') {
      return json(res, 200, { issuer: BASE, authorization_endpoint: `${BASE}/authorize`, token_endpoint: `${BASE}/token`,
        jwks_uri: `${BASE}/jwks`, id_token_signing_alg_values_supported: ['RS256'] })
    }
    if (p.startsWith('/v1/synthetic/')) {
      if (req.headers['x-talyvor-synthetic-key'] !== KEY) return json(res, 401, { error: 'the synthetic operator key is required' })
      if (p === '/v1/synthetic/workspaces/reset') {
        for (const ws of workspaces.values()) {
          ws.answers.clear()
          if (ws.balance < GRANT_ULXC) book(ws, GRANT_ULXC - ws.balance, 'admin_grant', 'synthetic test credits restored')
        }
        pool.clear()
        return json(res, 200, { reset: workspaces.size })
      }
      if (await bank.syntheticRoute(req, res, p)) return
      const { count = 100 } = JSON.parse((await read(req)) || '{}') as { count?: number }
      const expires = new Date(Date.now() + 24 * 3600e3).toISOString().replace(/\.\d+Z$/, 'Z')
      const out = []
      for (let i = 0; i < count; i++) {
        const id = 's' + randomBytes(20).toString('hex').slice(0, 26)
        const ws = newWorkspace(id, 'tok-' + randomBytes(16).toString('hex'))
        book(ws, GRANT_ULXC, 'admin_grant', 'synthetic test credits')
        workspaces.set(id, ws)
        byToken.set(ws.token, ws)
        out.push({ workspace_id: id, token: ws.token, expires_at: expires })
      }
      return json(res, 201, { created: out.length, workspaces: out })
    }
    if (p === '/v1/economy/conversion-rate') return json(res, 200, { usd_per_lxc: USD_PER_LXC })
    const paying = /^\/stub-checkout\/(\w+)$/.exec(p)
    if (paying !== null) return await stripeCheckout(req, res, paying[1])
    const proxied = /^\/v1\/proxy\/([a-z]+)\/(.+)$/.exec(p)
    if (proxied !== null) return await proxy(req, res, proxied[1], proxied[2])

    if (await bank.agentPay(req, res, bearer, p)) return
    if (await bank.moderatorRoute(req, res, bearer, p)) return
    if (p.startsWith('/stub-connect/')) {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      return void res.end('<!doctype html><title>Stripe Connect onboarding (stub)</title><h1>Stripe Connect onboarding (stub)</h1>')
    }
    // The BFF runs a marketplace use on the session key the chat streams on (B20.3).
    const ws = byToken.get(bearer) ?? bySessionKey.get(bearer)
    if (ws === undefined) return json(res, 401, { error: 'unauthorized' })
    if (p === '/v1/catalog/models') return json(res, 200, CATALOG)
    if (bank.publicRoute(res, p, url, ws.id)) return
    if (await bank.publicWrite(req, res, p, ws.id)) return
    if (p === '/v1/catalog/discovered') return json(res, 200, [])
    if (p === '/v1/api/usage') {
      const u = ws.usage
      return json(res, 200, { period_days: Number(url.searchParams.get('days') ?? 30), models: [], cache: { total_requests: u.total,
        cache_hits: u.hits + u.pooled, misses: u.total - u.hits - u.pooled, hit_rate: u.total === 0 ? 0 : (u.hits + u.pooled) / u.total,
        by_source: { cache_hit_exact: u.hits, cache_hit_pooled: u.pooled } } })
    }
    if (p === '/v1/auth/session-keys' && req.method === 'POST') {
      const key = 'tlv_sk_' + randomBytes(24).toString('hex')
      bySessionKey.set(key, ws)
      return json(res, 201, { key, expires_at: new Date(Date.now() + 3600e3).toISOString() })
    }
    const scoped = /^\/v1\/workspaces\/([^/]+)(\/.*)?$/.exec(p)
    if (scoped !== null) {
      if (scoped[1] !== ws.id) return json(res, 403, { error: 'forbidden' })
      const rest = scoped[2] ?? ''
      if (rest === '') return json(res, 200, { id: ws.id, name: 'Synthetic user', active: true, synthetic: true, ...ws.settings })
      if (await bank.workspaceRoute(req, res, ws, rest, url)) return
      const setting = SETTINGS[rest]
      if (setting !== undefined && req.method === 'PUT') {
        const v = (JSON.parse((await read(req)) || '{}') as Record<string, unknown>)[setting]
        if (v === undefined) return json(res, 400, { error: `${setting} required` })
        if (!(BREAK === 'setting' && setting === 'cost_optimize_routing')) (ws.settings as unknown as Record<string, unknown>)[setting] = v
        return json(res, 200, { [setting]: BREAK === 'setting' && setting === 'cost_optimize_routing' ? v : ws.settings[setting] })
      }
      if (rest === '/guardrails') {
        if (req.method === 'POST') ws.guardrails = JSON.parse((await read(req)) || '{}') as Workspace['guardrails']
        return json(res, 200, ws.guardrails)
      }
      if (rest === '/budgets' && req.method === 'POST') {
        const b = JSON.parse((await read(req)) || '{}') as Partial<Budget>
        const budget: Budget = { id: randomBytes(8).toString('hex'), scope: b.scope ?? 'workspace', period: b.period ?? 'monthly',
          limit_usd: b.limit_usd ?? 0, spent_usd: 0, alert_thresholds: [], enforcement: b.enforcement ?? 'hard_block', ends_at: null }
        ws.budgets.push(budget)
        return json(res, 201, budget)
      }
      if (rest === '/budgets') return json(res, 200, ws.budgets)
      const budget = /^\/budgets\/([^/]+)$/.exec(rest)
      if (budget !== null && req.method === 'PATCH') {
        const b = ws.budgets.find((x) => x.id === budget[1])
        if (b === undefined) return json(res, 404, { error: 'no such budget' })
        Object.assign(b, JSON.parse((await read(req)) || '{}'), { id: b.id, scope: b.scope, spent_usd: b.spent_usd })
        return json(res, 200, b)
      }
      if (rest === '/tare/savings') return json(res, 200, { by_work_item: [] })
      if (rest === '/distill/usage') return json(res, 200, { converted: ws.usage.converted, vision_ocr: 0, days: 30 })
      if (rest === '/earnings') return json(res, 200, { disabled_gates: [], by_type: [] })
      if (rest === '/tare/preview' && req.method === 'POST') {
        const { content = '', kind = '' } = JSON.parse((await read(req)) || '{}') as { content?: string; kind?: string }
        let reduced: string | undefined
        try {
          reduced = JSON.stringify(shrink(JSON.parse(content)))
        } catch {
          // not JSON: sent unchanged
        }
        const tin = tokens(content)
        if (reduced === undefined || tokens(reduced) >= tin) {
          return json(res, 200, { reduced: content, kind: kind || 'unknown', refused: true, refusal_reasons: ['nothing this preview can shrink safely'],
            tokens_in_estimated: tin, tokens_out_estimated: tin, tokens_saved_estimated: 0 })
        }
        const tout = tokens(reduced)
        return json(res, 200, { reduced, kind: 'json', refused: false, refusal_reasons: null,
          tokens_in_estimated: tin, tokens_out_estimated: tout, tokens_saved_estimated: tin - tout })
      }
      if (rest === '/distill/preview' && req.method === 'POST') {
        const mediaType = String(req.headers['content-type'] ?? '')
        let raw = await read(req)
        if (BREAK === 'conversion') raw = raw.replace(/<p[^>]*>[\s\S]*?<\/p>/gi, '')
        const markdown = toMarkdown(raw, mediaType)
        const [tin, tout] = [tokens(raw), tokens(markdown)]
        return json(res, 200, { markdown, format: /html/.test(mediaType) ? 'html' : 'txt', needs_vision: false,
          savings: { input_bytes: raw.length, output_bytes: markdown.length, input_tokens_raw: tin, input_tokens_distilled: tout, tokens_saved: tin - tout } })
      }
      if (rest === '/billing/subscribe' && req.method === 'POST') {
        const { plan = '' } = JSON.parse((await read(req)) || '{}') as { plan?: string }
        if (PLAN_FEES[plan] === undefined) return json(res, 400, { error: `plan ${plan} is not sold here` })
        if (ws.plan !== undefined) return json(res, 409, { error: 'this workspace already has a live subscription' })
        const session = 'cs_test_' + randomBytes(12).toString('hex')
        checkouts.set(session, { ws: ws.id, plan })
        return json(res, 200, { url: `${BASE}/stub-checkout/${session}` })
      }
      if (rest === '/billing/allowance') {
        return json(res, 200, { allowance: ws.allowance === undefined ? null : { workspace_id: ws.id, ...ws.allowance },
          earned_ulens: 0, earned_held_ulens: 0, earned_usd_cents: 0, earned_back_usd_cents: 0 })
      }
      if ((rest === '/billing/subscription/cancel' || rest === '/billing/subscription/resume') && req.method === 'POST') {
        if (ws.plan === undefined) return json(res, 409, { error: 'this workspace has no live subscription' })
        ws.plan.cancel = rest.endsWith('/cancel')
      }
      if (rest === '/billing/subscription' || rest === '/billing/subscription/cancel' || rest === '/billing/subscription/resume') {
        return json(res, 200, { subscribed: ws.plan !== undefined, status: ws.plan === undefined ? undefined : 'active',
          current_period_end: new Date(Date.now() + 30 * 86400e3).toISOString(), cancel_at_period_end: ws.plan?.cancel ?? false, livemode: false })
      }
      if (rest === '/tokens/history') {
        const limit = Number(url.searchParams.get('limit') ?? 20)
        const offset = Number(url.searchParams.get('offset') ?? 0)
        return json(res, 200, ws.earnings.slice(offset, offset + limit))
      }
      if (rest === '/lxc/balance') return json(res, 200, { workspace_id: ws.id, balance_ulxc: ws.balance })
      if (rest === '/lxc/history') {
        const limit = Number(url.searchParams.get('limit') ?? 20)
        const offset = Number(url.searchParams.get('offset') ?? 0)
        return json(res, 200, ws.ledger.slice(offset, offset + limit))
      }
      return json(res, 200, {})
    }
    return json(res, 404, { error: 'stub: no such route' })
  } catch (e) {
    return json(res, 500, { error: String(e) })
  }
}).listen(PORT, '127.0.0.1', () => console.log(`stub lens on ${BASE}${BREAK !== '' ? ` (broken: ${BREAK})` : ''}`))
