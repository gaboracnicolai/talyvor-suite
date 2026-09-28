// B17.3 SELF-TEST — a stand-in for Lens (and the OIDC issuer the BFF discovers at boot), so the harness
// can be run end to end on one machine against the REAL BFF binary and the REAL web bundle.
//
// It keeps the contracts the harness and the app read: the synthetic routes (B17.1), the workspace
// read the BFF's synthetic sign-in checks (B17.2), session keys, the catalog, the ledger, and the
// streaming proxy with Lens's replay and pool headers. The "model" is arithmetic and a table of
// capitals — enough for every oracle to have something true to check.
//
// STUB_BREAK=<name> plants one defect, so a harness change can be seen to FAIL on it:
//   price       — answers report twice the tokens they were charged for
//   cross-replay — another account's identical question is replayed as "your earlier answer"

import { randomBytes } from 'node:crypto'
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http'

const PORT = Number(process.env.STUB_PORT ?? 9911)
const BASE = `http://127.0.0.1:${PORT}`
const KEY = process.env.LENS_SYNTHETIC_KEY ?? 'selftest-key'
const BREAK = process.env.STUB_BREAK ?? ''
const USD_PER_LXC = 0.1
const GRANT_ULXC = 1_000_000_000

const CATALOG = [
  { id: 'claude-haiku-4-5', provider: 'anthropic', display_name: 'Claude Haiku 4.5', input_per_1m: 1, output_per_1m: 5 },
  { id: 'claude-sonnet-5', provider: 'anthropic', display_name: 'Claude Sonnet 5', input_per_1m: 3, output_per_1m: 15 },
  { id: 'gpt-6-luna', provider: 'openai', display_name: 'GPT-6 Luna', input_per_1m: 0.1, output_per_1m: 0.4 },
  { id: 'gemini-flash-lite', provider: 'google', display_name: 'Gemini Flash-Lite', input_per_1m: 0.1, output_per_1m: 0.4 },
]
const CONFIGURED = new Set(['anthropic', 'openai'])

const CAPITALS: Record<string, string> = {
  france: 'Paris', japan: 'Tokyo', canada: 'Ottawa', australia: 'Canberra', kenya: 'Nairobi', norway: 'Oslo',
  peru: 'Lima', egypt: 'Cairo', poland: 'Warsaw', chile: 'Santiago', portugal: 'Lisbon', thailand: 'Bangkok',
  ireland: 'Dublin', greece: 'Athens', finland: 'Helsinki', hungary: 'Budapest', argentina: 'Buenos Aires',
  vietnam: 'Hanoi', morocco: 'Rabat', austria: 'Vienna',
}

interface Row { id: string; workspace_id: string; amount_ulxc: number; balance_after_ulxc: number; type: string; description: string; metadata: object; created_at: string }
interface Workspace { id: string; token: string; balance: number; ledger: Row[]; answers: Map<string, string> }

const workspaces = new Map<string, Workspace>()
const byToken = new Map<string, Workspace>()
const bySessionKey = new Map<string, Workspace>()
/** Single-turn questions any synthetic workspace has had answered: the synthetic pool. */
const pool = new Map<string, { owner: string; answer: string }>()

function book(ws: Workspace, amount: number, type: string, description: string): void {
  ws.balance += amount
  ws.ledger.unshift({ id: randomBytes(8).toString('hex'), workspace_id: ws.id, amount_ulxc: amount, balance_after_ulxc: ws.balance,
    type, description, metadata: {}, created_at: new Date().toISOString() })
}

type Msg = { role: string; content: string | { type: string; text?: string }[] }
const text = (m: Msg): string => (typeof m.content === 'string' ? m.content : m.content.map((c) => c.text ?? '').join(''))

/** The stand-in model: arithmetic, capitals, and the harness's own fixed prompts. */
function think(messages: Msg[]): string {
  const q = text(messages[messages.length - 1])
  const all = messages.map(text).join('\n')
  let m
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

async function proxy(req: IncomingMessage, res: ServerResponse, provider: string, path: string): Promise<void> {
  const ws = bySessionKey.get((req.headers.authorization ?? '').replace(/^Bearer /, ''))
  if (ws === undefined) return json(res, 401, { error: 'unauthorized' })
  const raw = await read(req)
  if (!CONFIGURED.has(provider)) return json(res, 503, { error: `provider ${provider} not configured` })
  const body = JSON.parse(raw || '{}') as { model?: string; stream?: boolean; messages?: Msg[] }
  const model = CATALOG.find((c) => c.id === body.model)
  if (model === undefined || (provider === 'anthropic') !== (path === 'v1/messages')) return json(res, 400, { error: 'bad request' })
  const messages = body.messages ?? []

  const key = JSON.stringify([model.id, messages.map((m) => [m.role, text(m)])])
  const bypass = req.headers['x-talyvor-cache'] === 'bypass'
  let answer: string
  const headers: Record<string, string> = {}
  let charge = 0
  const own = ws.answers.get(key)
  const shared = messages.length === 1 ? pool.get(key) : undefined
  const inTok = tokens(messages.map(text).join(' ')) + 8
  if (!bypass && own !== undefined) {
    answer = own
    headers['X-Talyvor-Cache-Replay'] = 'true'
  } else if (!bypass && shared !== undefined && shared.owner !== ws.id) {
    answer = shared.answer
    if (BREAK === 'cross-replay') {
      headers['X-Talyvor-Cache-Replay'] = 'true'
    } else {
      charge = Math.round(((inTok * model.input_per_1m + tokens(answer) * model.output_per_1m) / 1e6 / USD_PER_LXC) * 1e6 * 0.7)
      headers['X-Talyvor-Pool-Discount-Rate'] = '0.3'
      headers['X-Talyvor-Pool-Charged-ULXC'] = String(charge)
      book(ws, -charge, 'spend', 'pooled answer')
    }
  } else {
    answer = think(messages)
    const outTok = tokens(answer)
    charge = Math.ceil(((inTok * model.input_per_1m + outTok * model.output_per_1m) / 1e6 / USD_PER_LXC) * 1e6)
    book(ws, -charge, 'spend', `${model.id} answer`)
    ws.answers.set(key, answer)
    if (messages.length === 1) pool.set(key, { owner: ws.id, answer })
  }
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
      const { count = 100 } = JSON.parse((await read(req)) || '{}') as { count?: number }
      const expires = new Date(Date.now() + 24 * 3600e3).toISOString().replace(/\.\d+Z$/, 'Z')
      const out = []
      for (let i = 0; i < count; i++) {
        const id = 's' + randomBytes(20).toString('hex').slice(0, 26)
        const ws: Workspace = { id, token: 'tok-' + randomBytes(16).toString('hex'), balance: 0, ledger: [], answers: new Map() }
        book(ws, GRANT_ULXC, 'admin_grant', 'synthetic test credits')
        workspaces.set(id, ws)
        byToken.set(ws.token, ws)
        out.push({ workspace_id: id, token: ws.token, expires_at: expires })
      }
      return json(res, 201, { created: out.length, workspaces: out })
    }
    if (p === '/v1/economy/conversion-rate') return json(res, 200, { usd_per_lxc: USD_PER_LXC })
    const proxied = /^\/v1\/proxy\/([a-z]+)\/(.+)$/.exec(p)
    if (proxied !== null) return await proxy(req, res, proxied[1], proxied[2])

    const ws = byToken.get(bearer)
    if (ws === undefined) return json(res, 401, { error: 'unauthorized' })
    if (p === '/v1/catalog/models') return json(res, 200, CATALOG)
    if (p === '/v1/auth/session-keys' && req.method === 'POST') {
      const key = 'tlv_sk_' + randomBytes(24).toString('hex')
      bySessionKey.set(key, ws)
      return json(res, 201, { key, expires_at: new Date(Date.now() + 3600e3).toISOString() })
    }
    const scoped = /^\/v1\/workspaces\/([^/]+)(\/.*)?$/.exec(p)
    if (scoped !== null) {
      if (scoped[1] !== ws.id) return json(res, 403, { error: 'forbidden' })
      const rest = scoped[2] ?? ''
      if (rest === '') return json(res, 200, { id: ws.id, name: 'Synthetic user', active: true, cache_poolable: true, synthetic: true })
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
