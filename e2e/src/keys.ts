// B28.287 — KEYS ARE NEVER EXPOSED AND NEVER FORWARDED. A workspace holds keys of several kinds — its API keys (made on
// …/api-keys or on /v1/api/keys, and the new key a rotation makes), session keys, its agents' keys, its token, and a
// provider key it stored — and Lens hands each over once, when it is made. Two scenarios, each on a workspace of its own:
//   keys-unlisted — one key of each kind is made and the API key used once, then every list and stats read on Lens and
//        in the app that could name a key is read, and the API keys screen looked at: none may hold a whole key, the
//        part after its prefix, its SHA-256, or anything shaped like a Talyvor or provider key.
//   keys-not-forwarded — a synthetic upstream: a local HTTP server speaking OpenAI's chat API that records every
//        request. Lens sends it its vLLM traffic when Lens was started with LENS_VLLM_BASE_URL at it (the self-test's
//        stub Lens is, given E2E_UPSTREAM_PORT). The workspace's API key, its token and a session key are each sent in
//        Authorization, X-Talyvor-Key, X-API-Key and Proxy-Authorization at once, and in X-Talyvor-Key and in X-API-Key
//        alone, plain and streamed (Lens's two copies of the proxy). Every request served must reach the upstream, and
//        the upstream must see none of them, nor their hash, nor anything shaped like a Talyvor key — in a header, its
//        address or its body — and Lens's answer must carry none back. Production Lens sends its vLLM traffic nowhere
//        this run can see, so there it SKIPs.

import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { Page } from 'playwright'
import { fail } from './bank.ts'
import { ask, judgeRoute, proxyKey, verdictOf } from './gateway.ts'
import { KEY_SHAPE } from './injection.ts'
import { refusalOf } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { CannotTest, type Scenario, type ScenarioCtx } from './scenarios.ts'

/** A Talyvor key's shape: what the upstream may never see, though a provider key of Lens's own it may. */
const TALYVOR_SHAPE = /\btlv_[A-Za-z0-9_]{16,}/
/** The model asked of the synthetic upstream: one no catalog prices, as a vLLM an operator runs serves. */
const UPSTREAM_MODEL = 'e2e-upstream'

// ─── what no read may return ─────────────────────────────────────────────────────────────────────

/** One credential the workspace holds, by what it is. */
export interface Secret { what: string; value: string }

/** One form of a secret that must not appear: the whole, the part after its prefix, or its SHA-256. */
interface Needle { secret: string; part: string; text: string; fold: boolean }

export function needlesOf(s: Secret): Needle[] {
  const sha = createHash('sha256').update(s.value).digest()
  const rest = s.value.replace(/^(?:tlv_(?:[a-z]+_)?|sk-(?:ant-|proj-)?)/, '')
  const n = (part: string, text: string, fold = false): Needle => ({ secret: s.what, part, text, fold })
  return [
    n('whole', s.value),
    ...(rest !== s.value && rest.length >= 24 ? [n('without its prefix', rest)] : []),
    n('as its SHA-256', sha.toString('hex'), true),
    n('as its SHA-256', sha.toString('base64')),
    n('as its SHA-256', sha.toString('base64url')),
  ]
}

/**
 * What of the secrets `text` holds — each secret once, by the first of its forms found — and anything else in it shaped
 * like a key (`shape`), which no secret here accounts for.
 */
export function leaksIn(text: string, needles: readonly Needle[], shape: RegExp = KEY_SHAPE): string[] {
  const lower = text.toLowerCase()
  const found = new Map<string, string>()
  for (const n of needles) {
    if (!found.has(n.secret) && (text.includes(n.text) || (n.fold && lower.includes(n.text)))) found.set(n.secret, `${n.secret} ${n.part}`)
  }
  const shaped = [...text.matchAll(new RegExp(shape.source, 'g'))].map((m) => m[0])
    .filter((m) => !needles.some((n) => found.has(n.secret) && n.text.includes(m)))
    .map((m) => `${m.slice(0, 10)}… (shaped like a key)`)
  return [...found.values(), ...new Set(shaped)]
}

const headersText = (h: Headers): string => {
  const lines: string[] = []
  h.forEach((v, k) => lines.push(`${k}: ${v}`))
  return lines.join('\n')
}

/** A GET from `page`, as its own script makes one: the status and the body as text. */
async function fromApp(page: Page, path: string): Promise<{ status: number; text: string }> {
  return page.evaluate(async (p) => {
    const res = await fetch(p, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    return { status: res.status, text: await res.text() }
  }, path)
}

/** The list and stats reads on Lens that could name a workspace's key, on its own token. */
function lensReads(keyID: string, rotation: string | undefined, agentID: string | undefined, session: string): string[] {
  const ws = '/v1/workspaces/{ws}'
  const s = `/v1/sessions/${encodeURIComponent(session)}`
  return [
    `${ws}/api-keys`, `${ws}/api-keys/${keyID}/usage`, ...(rotation === undefined ? [] : [`${ws}/key-rotations/${rotation}`]),
    ws, '/v1/workspaces', '/v1/auth/me', `${ws}/provider-keys`, '/v1/api/keys/pool',
    `${ws}/agents`, `${ws}/agents/statement`, ...(agentID === undefined ? [] : [`${ws}/agents/${agentID}/statement`]),
    '/v1/sessions', s, `${s}/summary`,
    '/v1/api/spend/summary', '/v1/api/spend/by-model', '/v1/api/spend/by-team', '/v1/api/spend/by-feature', '/v1/api/spend/by-request',
    '/v1/api/usage', '/v1/api/models/usage', '/v1/api/cache/stats',
    `${ws}/spend/current-month`, `${ws}/budgets/status`, `${ws}/tokens/balance`, `${ws}/tokens/history`, '/v1/audit/export',
  ]
}

/** The app's reads of the same, through its own server, as the signed-in browser makes them. */
const APP_READS = ['/api/keys', '/api/agents', '/api/provider-keys', '/auth/me']

export function keysUnlisted(): Scenario {
  return {
    id: 'keys-unlisted',
    owner: 'talyvor-lens',
    own: true,
    agents: 1,
    feature: 'API keys',
    title: "a key of every kind the workspace holds — its API keys of both kinds, a rotation's new key, a session key, an agent's key, its token and a provider key — made, the API key used, then every list and stats read on Lens and in the app and the API keys screen: none holds a whole key, the part after its prefix, its SHA-256 or anything shaped like a key",
    run: async (ctx) => {
      const { env, app } = ctx
      const lens = env.lens
      const ws = '/v1/workspaces/{ws}'
      const wrong: string[] = []
      const secrets: Secret[] = [{ what: "the workspace's token", value: app.user.token }]
      const notMade: string[] = []
      const undo: (() => Promise<unknown>)[] = []
      let page: Page | undefined
      try {
        // 1. A key of every kind. The API key is the one the reads must show by its prefix; the rest are made where Lens makes them.
        const a = await proxyKey(ctx, `listed ${RUN_SALT}`)
        if (typeof a === 'string') return fail(a)
        secrets.push({ what: 'its API key', value: a.key })
        undo.push(() => lens.act(app.user, 'DELETE', `${ws}/api-keys/${a.id}`))
        const made = async <T>(what: string, method: string, path: string, body: unknown): Promise<T | undefined> => {
          const r = await lens.act<T>(app.user, method, path, body)
          if (!r.ok) notMade.push(`${what} (${r.status} ${r.error})`)
          return r.ok ? r.value : undefined
        }
        const begun = await made<{ rotation_id: string; key: string }>("a rotation's new key", 'POST', `${ws}/api-keys/${a.id}/rotate/begin`, {})
        if (begun !== undefined) {
          secrets.push({ what: "the new key of a rotation begun on it", value: begun.key })
          // Undone before the key it rotates is deleted.
          undo.push(() => lens.act(app.user, 'POST', `${ws}/key-rotations/${begun.rotation_id}/abandon`, {}))
        }
        const other = await made<{ key: string; id: string }>('a key from POST /v1/api/keys', 'POST', '/v1/api/keys', { name: `listed api ${RUN_SALT}` })
        if (other !== undefined) {
          secrets.push({ what: 'a key from POST /v1/api/keys', value: other.key })
          undo.push(() => lens.act(app.user, 'DELETE', `/v1/api/keys/${other.id}`))
        }
        const session = await made<{ key: string; id?: string }>('a session key', 'POST', '/v1/auth/session-keys', {})
        if (session !== undefined) {
          secrets.push({ what: 'a session key', value: session.key })
          if (session.id !== undefined) undo.push(() => lens.act(app.user, 'DELETE', `/v1/auth/session-keys/${session.id}`))
        }
        let agentID: string | undefined
        try {
          agentID = (await lens.createAgent(app.user, `Keys ${RUN_SALT}`)).id
        } catch (e) {
          notMade.push(`an agent (${e instanceof Error ? e.message : String(e)})`)
        }
        if (agentID !== undefined) {
          const k = await made<{ key: string; id: string }>("an agent's key", 'POST', `${ws}/agents/${agentID}/keys`, { name: `listed ${RUN_SALT}` })
          if (k !== undefined) {
            secrets.push({ what: "an agent's key", value: k.key })
            undo.push(() => lens.act(app.user, 'DELETE', `${ws}/api-keys/${k.id}`))
          }
        }
        // Shaped as an OpenAI project key, so a read that shows it whole is caught by its shape as well as its value.
        const provider = `sk-proj-e2e${RUN_SALT}${randomBytes(24).toString('hex')}`
        const stored = await lens.act(app.user, 'PUT', `${ws}/provider-keys/openai`, { key: provider })
        if (stored.ok) {
          secrets.push({ what: 'a provider key it stored', value: provider })
          undo.push(() => lens.act(app.user, 'DELETE', `${ws}/provider-keys/openai`))
        } else notMade.push(`a provider key (${stored.status} ${stored.error})`)
        ctx.evidence.push({ note: `made: ${secrets.map((s) => s.what).join(', ')}; not made here: ${notMade.join('; ') || 'none'}` })

        // 2. The control: the API key is live — it reads the workspace — and is used once, so its usage and the spend reads count it.
        const works = await lens.act({ ...app.user, token: a.key }, 'GET', ws)
        if (!works.ok) wrong.push(`the API key was refused reading its own workspace: ${works.status} ${works.error}`)
        const { route, model } = judgeRoute(ctx)
        const sessionID = `e2e-keys-${RUN_SALT}-${Date.now().toString(36)}`
        const used = await ask(ctx, a.key, route, model.id, 'the API key, used once', { 'X-Talyvor-Session': sessionID })
        if (used.status !== 200) wrong.push(`the API key's one request was refused: ${used.status} ${used.error}`)

        // 3. Every read that could name a key.
        const needles = secrets.flatMap(needlesOf)
        const read: string[] = []
        const notRead: string[] = []
        const judge = (where: string, status: number, text: string) => {
          if (status < 200 || status >= 300) return void notRead.push(`${where} (${status})`)
          read.push(where)
          const l = leaksIn(text, needles)
          if (l.length > 0) wrong.push(`${where} returns ${l.join(', ')}`)
        }
        for (const path of lensReads(a.id, begun?.rotation_id, agentID, sessionID)) {
          const r = await lens.as(app.user.token, 'GET', path.replace('{ws}', app.user.workspaceID))
          judge(`GET ${path}`, r.status, `${headersText(r.headers)}\n${r.text}`)
          if (path === `${ws}/api-keys` && !(r.status === 200 && r.text.includes(a.prefix))) wrong.push(`GET ${path} does not list the API key by its prefix ${a.prefix}: ${r.status} ${r.text.slice(0, 160)}`)
        }
        for (const s of secrets.slice(1).filter((x) => x.value.startsWith('tlv_'))) {
          const r = await lens.as(s.value, 'GET', '/v1/auth/me')
          judge(`GET /v1/auth/me on ${s.what}`, r.status, `${headersText(r.headers)}\n${r.text}`)
        }
        page = await app.tab('/keys')
        for (const path of APP_READS) {
          const r = await fromApp(page, path)
          judge(`the app's GET ${path}`, r.status, r.text)
          if (path === '/api/keys' && !(r.status === 200 && r.text.includes(a.prefix))) wrong.push(`the app's GET ${path} does not list the API key by its prefix ${a.prefix}: ${r.status}`)
        }
        await page.getByText(a.prefix).first().waitFor({ timeout: 15_000 }).catch(() => undefined)
        judge('the API keys screen', 200, await page.content())
        ctx.evidence.push({ note: `${read.length} reads held no key: ${read.join(', ')}; not read here: ${notRead.join(', ') || 'none'}` })
        return verdictOf(wrong, `${secrets.length} keys (${secrets.map((s) => s.what).join(', ')}), the API key used once; ${read.length} reads on Lens and in the app and the API keys screen ` +
          `hold none of them whole, without its prefix or as its SHA-256, and nothing shaped like a key${notRead.length === 0 ? '' : ` (${notRead.length} not read here: ${notRead.join(', ')})`}`)
      } finally {
        await page?.close().catch(() => undefined)
        for (const u of undo.reverse()) await u().catch(() => undefined)
      }
    },
  }
}

// ─── the synthetic upstream ──────────────────────────────────────────────────────────────────────

/** One request the upstream received: what Lens sent a provider. */
export interface Captured { method: string; url: string; headers: [string, string][]; body: string }

/** Each place in `c` that holds a secret or a Talyvor-shaped key, and what. */
export function capturedLeaks(c: Captured, needles: readonly Needle[]): string[] {
  return [
    ...c.headers.flatMap(([k, v]) => leaksIn(v, needles, TALYVOR_SHAPE).map((l) => `${l} in its ${k} header`)),
    ...leaksIn(c.url, needles, TALYVOR_SHAPE).map((l) => `${l} in its address`),
    ...leaksIn(c.body, needles, TALYVOR_SHAPE).map((l) => `${l} in its body`),
  ]
}

interface Upstream { marker: string; seen: Captured[]; close: () => Promise<void> }

/** An OpenAI-compatible chat server on `port`, answering every question with `marker`, plain or streamed, and recording it. */
async function upstream(port: number): Promise<Upstream> {
  const marker = `upstream-${RUN_SALT}`
  const seen: Captured[] = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c: Buffer) => { body += c.toString() })
    req.on('end', () => {
      const headers: [string, string][] = []
      for (let i = 0; i + 1 < req.rawHeaders.length; i += 2) headers.push([req.rawHeaders[i].toLowerCase(), req.rawHeaders[i + 1]])
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers, body })
      if (req.method !== 'POST') return void res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ object: 'list', data: [{ id: UPSTREAM_MODEL, object: 'model' }] }))
      let stream = false
      try {
        stream = (JSON.parse(body) as { stream?: boolean }).stream === true
      } catch {
        stream = false
      }
      const id = `chatcmpl-${seen.length}`
      const created = Math.floor(Date.now() / 1000)
      const usage = { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 }
      if (!stream) {
        return void res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id, object: 'chat.completion', created, model: UPSTREAM_MODEL,
          choices: [{ index: 0, message: { role: 'assistant', content: marker }, finish_reason: 'stop' }], usage }))
      }
      const chunk = (o: object) => `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: UPSTREAM_MODEL, ...o })}\n\n`
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      res.end(chunk({ choices: [{ index: 0, delta: { role: 'assistant', content: marker }, finish_reason: null }] }) +
        chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage }) + 'data: [DONE]\n\n')
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', (e) => reject(new Error(`the synthetic upstream cannot listen on port ${port}: ${e.message}`)))
    server.listen(port, '::', () => resolve())
  })
  return { marker, seen, close: () => new Promise<void>((r) => {
    server.close(() => r())
    server.closeAllConnections()
  }) }
}

/** Where a credential is put on a request: Authorization is set from it when `authorization`. */
interface Placement { what: string; authorization: boolean; required: boolean; headers: (k: string) => Record<string, string> }

const PLACEMENTS: readonly Placement[] = [
  { what: 'in Authorization, X-Talyvor-Key, X-API-Key and Proxy-Authorization at once', authorization: true, required: true,
    headers: (k) => ({ 'X-Talyvor-Key': k, 'X-API-Key': k, 'Proxy-Authorization': `Bearer ${k}` }) },
  { what: 'in X-Talyvor-Key alone', authorization: false, required: false, headers: (k) => ({ 'X-Talyvor-Key': k }) },
  { what: 'in X-API-Key alone', authorization: false, required: false, headers: (k) => ({ 'X-API-Key': k }) },
]

export function keysNotForwarded(): Scenario {
  return {
    id: 'keys-not-forwarded',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Lens API',
    title: "a synthetic upstream that Lens sends its vLLM traffic to: the workspace's API key, its token and a session key, each sent in every header Lens reads a key from (and Proxy-Authorization), plain and streamed — every request served reaches the upstream, which sees none of them, nor their hash, nor anything shaped like a Talyvor key, and Lens's answer carries none back",
    run: async (ctx: ScenarioCtx) => {
      const { env, app } = ctx
      const port = env.upstreamPort
      if (port === 0) {
        throw new CannotTest('this run has no synthetic upstream: give it E2E_UPSTREAM_PORT and start Lens with LENS_VLLM_BASE_URL=http://<this machine>:<port> (production Lens sends its vLLM traffic nowhere this run can see)')
      }
      const up = await upstream(port)
      const undo: (() => Promise<unknown>)[] = []
      try {
        const a = await proxyKey(ctx, `forwarded ${RUN_SALT}`)
        if (typeof a === 'string') return fail(a)
        undo.push(() => env.lens.act(app.user, 'DELETE', `/v1/workspaces/{ws}/api-keys/${a.id}`))
        const creds: Secret[] = [{ what: "the workspace's API key", value: a.key }, { what: "the workspace's token", value: app.user.token }]
        const s = await env.lens.act<{ key: string; id?: string }>(app.user, 'POST', '/v1/auth/session-keys', {})
        if (s.ok) {
          creds.push({ what: 'a session key', value: s.value.key })
          if (s.value.id !== undefined) undo.push(() => env.lens.act(app.user, 'DELETE', `/v1/auth/session-keys/${s.value.id}`))
        }
        const needles = creds.flatMap(needlesOf)
        const wrong: string[] = []
        const refused: string[] = []
        let reached = 0
        let n = 0
        for (const c of creds) {
          for (const p of PLACEMENTS) {
            for (const stream of [false, true]) {
              const label = `${c.what} ${p.what}, ${stream ? 'streamed' : 'plain'}`
              const nonce = `${RUN_SALT}-${++n}-${randomBytes(4).toString('hex')}`
              const r = await env.lens.as(p.authorization ? c.value : '', 'POST', '/v1/proxy/vllm/v1/chat/completions',
                { model: UPSTREAM_MODEL, stream, max_tokens: 8, messages: [{ role: 'user', content: `Say ok. (${nonce})` }] }, p.headers(c.value))
              const error = r.status === 200 ? '' : refusalOf(r.text)
              if (r.status === 503 && /not configured/.test(error)) {
                throw new CannotTest(`Lens has no vLLM upstream (503 "${error}"): start it with LENS_VLLM_BASE_URL=http://<this machine>:${port}`)
              }
              const got = up.seen.filter((x) => x.body.includes(nonce))
              reached += got.length
              for (const g of got) for (const l of capturedLeaks(g, needles)) wrong.push(`${label}: the upstream received ${l}`)
              const back = leaksIn(`${headersText(r.headers)}\n${r.text}`, needles, TALYVOR_SHAPE)
              if (back.length > 0) wrong.push(`${label}: Lens's answer carries ${back.join(', ')}`)
              if (r.status !== 200) {
                refused.push(`${label} (${r.status})`)
                if (p.required) wrong.push(`${label}: refused ${r.status} "${error}", so nothing reached the upstream to judge`)
              } else if (got.length === 0) {
                if (!r.text.includes(up.marker)) throw new CannotTest(`Lens served ${label} from a vLLM other than this run's upstream on port ${port}: its LENS_VLLM_BASE_URL is elsewhere`)
                wrong.push(`${label}: Lens answered with the upstream's words, and the upstream recorded no request carrying the question`)
              }
            }
          }
        }
        ctx.evidence.push({ note: `${n} requests to /v1/proxy/vllm; the upstream on port ${port} recorded ${up.seen.length} (${reached} carrying a question sent); refused by Lens: ${refused.join(', ') || 'none'}` })
        return verdictOf(wrong, `${n} requests on ${creds.map((c) => c.what).join(', ')} in every header Lens reads a key from, plain and streamed: ${reached} reached the upstream ` +
          `and it saw no key of the workspace's, no hash of one and nothing shaped like a Talyvor key; Lens's answers carried none back${refused.length === 0 ? '' : ` (Lens refused ${refused.length}: ${refused.join(', ')})`}`)
      } finally {
        for (const u of undo.reverse()) await u().catch(() => undefined)
        await up.close()
      }
    },
  }
}
