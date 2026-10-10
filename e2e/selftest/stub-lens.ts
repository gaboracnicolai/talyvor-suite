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
//   roi-brand   — the ROI report wears the old navy and Inter, loads a font from another host, loses its
//                 mark and prints on a dark canvas (B29.29)
//   seats-allows — a plan's seat refusal names no plan that would allow the member (B32.71)
//   savings     — a replay does not say what it saved, as Lens before B28.95 (B28.358)
//   charge      — the stream says a model's answer was charged a µLXC more than its spend row (B28.362)
//   auto        — an "auto" answer is charged at the model Lens chose, but the stream names a dearer one (B28.363)
//   meter       — the balance read lags the ledger by 30 seconds, so Chat's meter does not drop by the charge (B28.104)
//   cheaper     — a question asked afresh of a provider's cheapest chat model, as Chat's "Re-ask with" asks it, is
//                 answered, named and charged by the provider's dearest (B28.364)
//   rooms       — a room is opened without its owner as a member, so it is in nobody's rooms (B32.53, stub-rooms.ts)
//   call-replay — an agent's byte-identical retry under one Idempotency-Key is charged again (B28.279)
//   hangup-unbilled — an agent's streamed answer is spent from it only once the stream ends, so one it hangs up on
//                 is never billed to it (B28.279)
//   move-replay, move-race — a fund or withdraw sent again under its key posts again; one landing beside another
//                 answers and posts nothing (B28.279, stub-bank.ts)
//   webhook-unsigned — Stripe's webhooks credit an event whatever its signature, or with none (B28.280)
//   webhook-stale — a signed event is taken however long ago it was signed (B28.280)
//   webhook-oversized — an event is read whole however big, so one past Lens's 1 MiB cap is taken (B28.280)
//   webhook-replay — an event delivered again, or its session under a new event, is credited again (B28.280)
//   rules-stream — a streamed request on an agent's key skips the agent's rules: its hours, models, providers and limits (B28.281)
//   pool-unshared — an answer goes into the pool whatever its workspace's sharing switch says (B28.283)
//   share-revoke — a shared chat's link turned off leaves the list, and its copy is still read by anyone holding it (B28.127)
//   pool-tells  — a question another workspace has asked is answered afresh, but says so in a pool header (B28.283)
//   pool-negation — the pool also serves a question asked with the same words in another order, or with a "not" (B28.283)
//   tool-fetch  — a tool fetches an address its arguments name, as one following a webhook or a callback would (B28.284)
//   tool-key    — a tool's answer carries the key it was called with (B28.284)
//   ssrf        — a compute node and the audit webhook are dialled wherever they point, the metadata address answering (B28.285)
//   zip-bomb    — a .docx's document is unpacked however large it gets (B28.285)
//   doc-size    — a document of any size is taken for conversion (B28.285)
//   key-forward — a plain request's X-Talyvor-Key and X-API-Key go on to the vLLM upstream (B28.287)
//   key-forward-stream — a streamed request goes on to the vLLM upstream with every header it came with, its key too (B28.287)
//   key-listed  — the workspace's list of API keys shows each key whole (B28.287)
//   ratelimit-open — the rate limiter lets every request through, as Lens's does when Redis errors and it fails open (B28.288)
//   retry-after — a request the rate limiter refuses is answered 429 without Retry-After (B28.288)
//   ratelimit-open-later — the rate limiter holds for the first workspace that bursts it and lets every one after through,
//                 as Lens's does once Redis starts erroring after the night's own run (B28.292: only the deep pass FAILs)
//   web-search  — Search the web is ignored: nothing is searched, and an answer cites no page (B28.372)
//   run-code    — Run code is ignored: no code is run, and the model answers from what it knows (B28.373)
//   temporary-kept — a temporary chat's answer (X-Talyvor-Cache-Store: off) is kept to serve again, as any other (B28.131)
//   pool-off-shared — a chat kept out of the shared pool (X-Talyvor-Pool: off) has its answer pooled for other workspaces (B28.381)
//   file-delete — an uploaded file's DELETE answers 204 and keeps it: still listed, its id still there (B28.380)
//   connector   — offered a connector's fingerprint tool, the stand-in model makes a fingerprint up rather than calling it (B28.122)
//   docs-page   — a Docs page attached in Chat is not read: asked to quote it, the stand-in model says it sees no page (B28.375)
//   issue       — a request's X-Talyvor-Issue is not kept: its spend names no issue, so no Track issue's AI cost rises (B28.376)
//   schedule-early — a scheduled prompt is asked as soon as it is scheduled, not at the time set (B28.377)
//   schedule-free  — a scheduled prompt is answered with nothing on the paying agent's statement (B28.377)
//   openapi-wallets — /openapi.json, / and /status are as before B28.12: no Agent Wallets line, tag or operation, and /
//                 links no API reference (stub-openapi.ts)
//   rails-outage — /status.json's screening rail failed after its last success, so it reads outage (B30.124)
//   status-truth — /healthz reads degraded while /status.json reads operational (B37.7)
//   reconciliation-missing — yesterday's pounds run has a payment the partner's statement does not show, and the £7.00
//                 shortfall it leaves in the safeguarding view (B30.123)
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
//
// B26.24: every read the self-test makes is answered in the shape a real Lens answers it, held to
// lens-shapes.json by test/stubLens.test.ts. A route this stub does not know is a 404 it logs as
// "stub lens: no such route", which the self-test names — never a `{}` that a screen then throws on.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http'
import { Bank, SIM_QUOTES } from './stub-bank.ts'
import { DOC_CAP, auditWebhook, docxDocument, nodesAvailable, nodesRoute } from './stub-guards.ts'
import { roomAgentTool, roomListingRoute, roomsModeratorRoute, roomsRoute, setRoomWallets } from './stub-rooms.ts'
import { lensOpenAPI, lensPage } from './stub-openapi.ts'

const PORT = Number(process.env.STUB_PORT ?? 9911)
const BASE = `http://127.0.0.1:${PORT}`
const KEY = process.env.LENS_SYNTHETIC_KEY ?? 'selftest-key'
const BREAK = process.env.STUB_BREAK ?? ''
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
/** B28.279 — its defects may be planted together, comma-separated, as stub-bank.ts's are. */
const broke = (name: string): boolean => BREAK.split(',').includes(name)
// B29.29 — the executive ROI report as Lens's own renderer (internal/roi RenderHTML, talyvor-lens 1d936fd) wrote it.
const ROI_REPORT = readFileSync(new URL('./roi-report.html', import.meta.url), 'utf8')
const USD_PER_LXC = 0.1
const GRANT_ULXC = 1_000_000_000
/**
 * B28.280 — the signing secrets of Stripe's two webhooks: the test-mode one the self-test gives the harness too
 * (LENS_STRIPE_TEST_WEBHOOK_SECRET), and a live one nobody is given.
 */
const WEBHOOK_SECRETS: Record<string, string> = {
  '/v1/billing/webhook/test': process.env.STUB_WEBHOOK_SECRET ?? 'whsec_selftest',
  '/v1/billing/webhook': `whsec_${randomBytes(24).toString('hex')}`,
}
/** talyvor-lens internal/billing: maxWebhookBody, and stripe-go's DefaultTolerance for a signature's age. */
const WEBHOOK_BODY_CAP = 1 << 20
const WEBHOOK_TOLERANCE_S = 300
/** Lens's claims on a top-up: each event once (lxc_purchases.stripe_event_id), and each session credited once. */
const webhookEvents = new Set<string>()
const creditedSessions = new Set<string>()
/** Where Stripe sends the browser back to: the app's /billing/success (LENS_BILLING_SUCCESS_URL). */
const APP_URL = process.env.STUB_APP_URL ?? 'http://localhost:8797'
/** What each plan costs a month, in cents, and the allowance a period grants (LENS_SUBSCRIPTION_ALLOWANCE_ULXC). */
const PLAN_FEES: Record<string, number> = { plus: 2000, pro: 10000, max: 20000 }
/** B32.71 — the company plans Lens sells a test workspace (B32.10). They grant no allowance. */
const COMPANY_PLANS: Record<string, number> = { team: 4900, business: 29900 }
/** B32.11 — the platform fee on AI spend by plan, and B32.12 — the agents each plan holds (lens.env.example's defaults). */
const PLATFORM_FEE_BPS: Record<string, number> = { free: 550, team: 300, business: 100 }
const PLAN_AGENTS: Record<string, number> = { free: 3, team: 25, business: -1 }
/** B32.12 — each plan's seats in LENS_PLAN_GATES' default (-1 unlimited), in the order a refusal looks for one
 *  that would allow more; plus, pro and max take free's gates and byok takes team's. */
const SEATS: [string, number][] = [['free', 1], ['team', 5], ['business', 25], ['enterprise', -1]]
const GATED_AS: Record<string, string> = { plus: 'free', pro: 'free', max: 'free', byok: 'team' }
const ALLOWANCE_ULXC = 50_000_000

const model = (id: string, provider: string, display_name: string, input_per_1m: number, output_per_1m: number, release_date: string, tier: string,
  document: boolean) => ({ id, provider, display_name, input_per_1m, output_per_1m, cached_input_per_1m: input_per_1m / 10, cache_write_per_1m: input_per_1m * 1.25,
  capabilities: { vision: tier !== 'embedding', audio: false, document }, context_tokens: 200_000, max_output: tier === 'embedding' ? 0 : 8192, release_date, tier })
const CATALOG = [
  model('claude-haiku-4-5', 'anthropic', 'Claude Haiku 4.5', 1, 5, '2025-10-15', 'fast', true),
  model('claude-sonnet-5', 'anthropic', 'Claude Sonnet 5', 3, 15, '2026-06-30', 'balanced', true),
  model('gpt-6-luna', 'openai', 'GPT-6 Luna', 0.1, 0.4, '2026-09-22', 'fast', false),
  model('gemini-flash-lite', 'google', 'Gemini Flash-Lite', 0.1, 0.4, '2026-07-21', 'fast', false),
  // Not a chat model, as in production: every-model must not try it.
  model('text-embedding-3-large', 'openai', 'Embedding 3 large', 0.13, 0, '2024-01-25', 'embedding', false),
]
const CONFIGURED = new Set(['anthropic', 'openai'])

/** A provider's chat models, the cheapest first. */
function chatModelsOf(provider: string) {
  return CATALOG.filter((c) => c.provider === provider && c.output_per_1m > 0).sort((a, b) => a.input_per_1m + a.output_per_1m - b.input_per_1m - b.output_per_1m)
}

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
  id: string; workspace_id: string; scope: string; scope_id: string; period: string; limit_usd: number; spent_usd: number; alert_thresholds: number[]
  enforcement: string; ends_at: string | null; created_at: string; updated_at: string
}
/** An API key as Lens lists it (tenant.APIKey); the key itself is shown once, when it is made. */
interface ApiKey { id: string; workspace_id: string; key_prefix: string; name: string; scopes: string[]; created_at: string }
interface Workspace {
  id: string; token: string; created_at: string; balance: number; ledger: Row[]; answers: Map<string, string>
  keys: (ApiKey & { key: string })[]
  /** Documents uploaded for Chat to reference by their tdoc_ id (Lens POST /v1/documents, B18.13), listed and deleted (B28.380). */
  documents: Map<string, { mediaType: string; bytes: Buffer; filename: string; uploadedAt: string }>
  settings: Settings
  guardrails: Record<string, unknown> & { enable_injection: boolean; enable_pii: boolean }
  budgets: Budget[]
  usage: { total: number; hits: number; pooled: number; converted: number }
  /** B28.365 — the person's chat history, sealed in their browser: talyvor-lens B28.107's one versioned copy per workspace. */
  history?: { version: number; salt: string; iv: string; ciphertext: string; updated_at: string }
  /** B28.106 — each charged request's feature tag (X-Talyvor-Feature) and provider USD: Lens's token_events, as Spend by feature groups them. */
  tagged: { feature: string; cost_usd: number; at: number; issue: string; request_id: string }[]
  plan?: { id: string; cancel: boolean; byok?: boolean }
  /** B35.7 — the plan the testers created it on (talyvor-lens B35.1), read after a subscription. */
  syntheticPlan?: string
  allowance?: { granted_ulxc: number; consumed_ulxc: number; remaining_ulxc: number; fee_usd_cents: number; period_start?: string; period_end?: string }
  earnings: Earned[]
  /** B28.370 — the workspace's named prompts, by name (talyvor-lens /v1/prompts), each at its one version. */
  prompts?: Map<string, NamedPrompt>
}

interface NamedPrompt {
  id: string; name: string; version: number; content: string; description: string; workspace_id: string; is_active: boolean
  created_by: string; created_at: string; updated_at: string
}

function newWorkspace(id: string, token: string): Workspace {
  return {
    id, token, created_at: new Date().toISOString(), balance: 0, ledger: [], answers: new Map(), keys: [], documents: new Map(), tagged: [],
    settings: { tare_policy: 'disabled', distill_policy: 'always', compression_policy: 'disabled', logging_policy: 'full',
      cache_poolable: true, distill_poolable: false, cost_optimize_routing: false },
    guardrails: { ...GUARDRAILS },
    budgets: [],
    usage: { total: 0, hits: 0, pooled: 0, converted: 0 },
    earnings: [],
  }
}

// Lens's guardrails, reduced to what the scenarios send; a new workspace's as Lens answers them.
const GUARDRAILS = { workspace_id: '', enable_pii: true, enable_injection: true, enable_topics: true, blocked_topics: null, enable_word_filter: true,
  blocked_words: null, pii_action: 'redact', injection_action: 'block', custom_rules: null }
const INJECTION = /ignore (all )?(previous|prior) instructions/i
const PERSONAL = /[\w.+-]+@[\w-]+\.[\w.]+|\+?\d[\d ()-]{8,}\d/

const workspaces = new Map<string, Workspace>()
const byToken = new Map<string, Workspace>()
/** Session keys and API keys: the credentials the proxy takes. */
const byKey = new Map<string, Workspace>()
/** Single-turn questions any synthetic workspace has had answered: the synthetic pool. */
const pool = new Map<string, { owner: string; answer: string }>()
/** STUB_BREAK=pool-negation (B28.283) — a pooled answer to the same words as `said` in any order, "not" aside, as a similarity match blind to direction and negation serves. */
function looseMatch(model: string, said: string): { owner: string; answer: string } | undefined {
  const words = (t: string) => t.toLowerCase().split(/\W+/).filter((w) => w !== '' && w !== 'not').sort().join(' ')
  for (const [k, v] of pool) {
    const [m, msgs] = JSON.parse(k) as [string, [string, string][]]
    if (m === model && msgs.length === 1 && words(msgs[0][1]) === words(said)) return v
  }
  return undefined
}
/** B17.186 — talyvor-lens's similarity layers compare the converted text (cache.LatestTurn reads the body after distill), and
 *  two short documents asked the same question are near enough to match: the answer a workspace holds about another document. */
function alikeDocument(answers: Map<string, string>, model: string, asked: string): string | undefined {
  const question = (t: string) => t.replace(/<document name="[^"]*">[^]*?<\/document>/g, '').trim()
  if (question(asked) === asked.trim()) return undefined
  for (const [k, v] of answers) {
    const [m, msgs] = JSON.parse(k) as [string, [string, string][]]
    if (m === model && msgs.length === 1 && question(msgs[0][1]) !== msgs[0][1].trim() && question(msgs[0][1]) === question(asked)) return v
  }
  return undefined
}
/** Open checkouts on the stand-in for Stripe: session → the workspace and the plan it is for. */
const checkouts = new Map<string, { ws: string; plan: string }>()
/** B34.5 — each answer's X-Talyvor-Request-ID, and what it answered: Chat's Wrong answer names it (Lens POST /v1/feedback). */
const answered = new Map<string, { ws: string; key: string }>()

/** B28.127 — chats shared as links, by token: the copy talyvor-lens keeps until the link is turned off (apps/bff/chat_shares.go). */
interface ChatShare {
  id: string; token: string; ws: string; conversation_id: string; title: string
  messages: { role: string; content: string }[]; created_at: string
  /** STUB_BREAK=share-revoke — turned off: gone from the list, still served to a stranger. */
  off?: true
}
const chatShares = new Map<string, ChatShare>()
/** talyvor-lens B19.2 — each agent request sent with an Idempotency-Key, by that key and the request: its answer. */
const retries = new Map<string, string>()

function book(ws: Workspace, amount: number, type: string, description: string, tags: object = {}): number {
  if (type === 'spend') for (const b of ws.budgets) b.spent_usd += (-amount / 1e6) * USD_PER_LXC
  ws.balance += amount
  // A synthetic workspace's credits are a grant Lens marks as such.
  const metadata = type === 'admin_grant' ? { funding: 'grant', synthetic: true } : tags
  const at = new Date().toISOString()
  ws.ledger.unshift({ id: randomBytes(8).toString('hex'), workspace_id: ws.id, amount_ulxc: amount, balance_after_ulxc: ws.balance,
    type, description, metadata, created_at: at })
  if (type !== 'spend' || amount >= 0) return 0
  // B32.11 — a model call charged to credits carries its plan's platform fee, rounded up, its own row beside the spend.
  const bps = PLATFORM_FEE_BPS[gatedAs(ws)]
  const fee = Math.ceil((-amount * bps) / 10_000)
  ws.balance -= fee
  ws.ledger.unshift({ id: randomBytes(8).toString('hex'), workspace_id: ws.id, amount_ulxc: -fee, balance_after_ulxc: ws.balance,
    type: 'platform_fee', description: `Platform fee ${bps / 100}%`, metadata: { platform_fee_bps: bps, spend_ulxc: -amount }, created_at: at })
  return fee
}

/** B28.106 — a charged request's tag as Lens records it; STUB_BREAK=feature drops the header, as an untagged caller does. */
function tag(ws: Workspace, req: IncomingMessage, usd: number): void {
  ws.tagged.push({ feature: BREAK === 'feature' ? '' : String(req.headers['x-talyvor-feature'] ?? ''), cost_usd: usd, at: Date.now(),
    // B28.376 — and the Track issue it is for (X-Talyvor-Issue), as Lens keeps it with the spend; STUB_BREAK=issue drops it.
    issue: BREAK === 'issue' ? '' : String(req.headers['x-talyvor-issue'] ?? ''), request_id: 'req_' + randomBytes(10).toString('hex') })
}

/** B32.12 — the plan a workspace's gates are read under: a chat plan takes Free's. */
function gatedAs(ws: Workspace): string {
  const id = ws.plan?.id ?? ws.syntheticPlan ?? 'free'
  return PLAN_FEES[id] !== undefined ? 'free' : id
}

/** What the workspace spent this calendar month, in dollars (Lens spend/current-month). */
function monthUSD(ws: Workspace): number {
  const start = new Date()
  start.setUTCDate(1)
  start.setUTCHours(0, 0, 0, 0)
  const ulxc = ws.ledger.filter((r) => r.type === 'spend' && new Date(r.created_at) >= start).reduce((n, r) => n - r.amount_ulxc, 0)
  return (ulxc / 1e6) * USD_PER_LXC
}

type Block = { type: string; text?: string; source?: { data?: string; media_type?: string; file_id?: string }; file?: { file_data?: string; file_id?: string }; image_url?: { url?: string }; content?: string }
type Msg = { role: string; content: string | Block[] | null; tool_calls?: unknown[] }
const text = (m: Msg): string => (typeof m.content === 'string' ? m.content : (m.content ?? []).map((c) => c.text ?? '').join(''))

/** B28.349 — what Lens's wallet tool answered, when the conversation ends with it (Anthropic's tool_result, or OpenAI's tool turn). */
function toolResultOf(messages: Msg[]): string | undefined {
  const last = messages[messages.length - 1]
  if (last?.role === 'tool' && typeof last.content === 'string') return last.content
  if (last?.role === 'user' && Array.isArray(last.content)) return last.content.find((c) => c.type === 'tool_result')?.content
  return undefined
}
/** B28.349 — a question the stand-in model answers with Lens's wallet tool, when it is offered. */
const SPEND_QUESTION = /^What did (.+?) spend today\?/

/** B28.374 — "file this as a bug", which the stand-in model answers with Track's create_issue, when it is offered. */
const FILE_BUG = /\bfile (?:this|it) as a bug\b/i

/** B28.122 — "the fingerprint of the text "…"", which the stand-in model answers with a connector's fingerprint tool
 *  (Talyvor test tools, offered as <connector>__fingerprint), when one is offered. */
const FINGERPRINT = /\bfingerprint of the text "([^"]+)"/i
/** B17.160 — asked about the attached issue, which the stand-in model first looks up with Track's search_issues by the
 *  word its question ends with, when it is offered, as Claude did: the answer then takes two requests. */
const ABOUT_ISSUE = /\bthe attached issue\b.*\(([^()]+)\)\s*$/

/** B28.374 — the issue it files for "file this as a bug": the sentences before it are the bug, the first its title. */
function bugReport(q: string): { title: string; description: string } {
  const bug = q.slice(0, FILE_BUG.exec(q)?.index ?? q.length).trim()
  const title = (bug.split(/(?<=[.!?])\s+/)[0] ?? '').replace(/[.!?]$/, '').trim()
  return { title: title === '' ? 'A bug reported in Chat' : title, description: bug }
}

/** B28.374 — what Track said it filed, when a tool's answer is create_issue's: {"id", "identifier", "title", …}. */
function filedOf(result: string): { identifier: string; title: string } | undefined {
  try {
    const v = JSON.parse(result) as { identifier?: unknown; title?: unknown }
    return typeof v.identifier === 'string' ? { identifier: v.identifier, title: typeof v.title === 'string' ? v.title : '' } : undefined
  } catch {
    return undefined
  }
}

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

/** The tdoc_ id a block references an uploaded document by: Anthropic's file source, or OpenAI's file part. */
function fileRef(c: Block): string | undefined {
  return c.type === 'document' ? c.source?.file_id : c.type === 'file' ? c.file?.file_id : undefined
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

/** B28.368 — what Chat's Continue asks after an answer cut off at the length limit (apps/web history.ts CONTINUE_PROMPT). */
const CONTINUE = /^Your answer above was cut off at the length limit\./

/** talyvor-lens B28.118 — what a web search "finds": two news pages, served by this stub at their paths. */
const WEB_PAGES = [
  { path: '/web/news/rates', title: 'Central bank holds rates' },
  { path: '/web/news/markets', title: 'Markets close higher' },
]

/**
 * talyvor-lens B28.119 — Chat's Run code: asked for the nth prime, the model writes this code and Lens's sandbox runs it.
 * The stub's sandbox is the same trial division, run here; the answer is what it printed. Undefined for any other question.
 */
function primeRun(q: string): { nth: string; code: string; stdout: string } | undefined {
  const m = /\bthe (\d+)(st|nd|rd|th) prime\b/i.exec(q)
  const n = m === null ? NaN : Number(m[1])
  if (!(n >= 1 && n <= 10_000)) return undefined
  const code = `primes = []\nk = 2\nwhile len(primes) < ${n}:\n    if all(k % p for p in primes if p * p <= k):\n        primes.append(k)\n    k += 1\nprint(primes[-1])`
  const primes: number[] = []
  for (let k = 2; primes.length < n; k++) if (primes.every((p) => p * p > k || k % p !== 0)) primes.push(k)
  return { nth: `${n}${m![2].toLowerCase()}`, code, stdout: `${primes[n - 1]}\n` }
}

/** The stand-in model: arithmetic, capitals, and the harness's own fixed prompts. */
function think(messages: Msg[]): string {
  // B28.349 — told what the agents spent, it says the total in LXC.
  const spent = toolResultOf(messages)
  if (spent !== undefined) {
    // B28.374 — told what Track filed, it names the issue; told it was not filed, it says so in the tool's words.
    const filed = filedOf(spent)
    if (filed !== undefined) return `Filed it in Track as ${filed.identifier}: ${filed.title}.`
    if (FILE_BUG.test(messages.map(text).join('\n'))) return `I did not file it. ${spent}`
    // B28.122 — told what the connector's fingerprint tool answered, it gives that.
    const fingerprinted = FINGERPRINT.exec(messages.map(text).join('\n'))
    if (fingerprinted !== null) return `The fingerprint of "${fingerprinted[1]}" is ${spent}.`
    // B17.160 — told what Track's search found, it says what the issue is.
    if (ABOUT_ISSUE.test(text(messages[0] ?? { role: 'user', content: '' }))) {
      try {
        const found = (JSON.parse(spent) as { identifier?: string; title?: string }[])[0]
        return found === undefined ? 'Track found no such issue.' : `${found.identifier} asks for a fix: ${found.title}.`
      } catch {
        return `Track's search did not answer: ${spent}`
      }
    }
    try {
      return `Your agents spent ${(JSON.parse(spent) as { total_ulxc: number }).total_ulxc / 1e6} LXC today.`
    } catch {
      return 'The wallet tool did not answer.'
    }
  }
  const q = text(messages[messages.length - 1])
  const all = messages.map(text).join('\n')
  // B28.122 — asked for a fingerprint with no tool called (or STUB_BREAK=connector), it makes one up, as a model would.
  const guessed = FINGERPRINT.exec(q)
  if (guessed !== null) return `The fingerprint of "${guessed[1]}" is 0f1e2d3c4b5a.`
  // B28.368 — asked to go on with an answer it cut off: the rest of the whole answer, after what it had said.
  if (CONTINUE.test(q) && messages.length >= 3) {
    const had = text(messages[messages.length - 2])
    const whole = think(messages.slice(0, -2))
    return whole.startsWith(had) ? whole.slice(had.length) : whole
  }
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
  if ((m = /what is (\d+) minus (\d+)\?/i.exec(q))) return String(Number(m[1]) - Number(m[2]))
  if ((m = /^Is (\d+)( not)? greater than (\d+)\?/.exec(q))) return (Number(m[1]) > Number(m[3])) !== (m[2] !== undefined) ? 'Yes' : 'No'
  if (/^Let x = \d+/.test(q)) return 'OK'
  if ((m = /What is x \+ (\d+)\?/.exec(q))) return String(Number(/Let x = (\d+)/.exec(all)?.[1] ?? NaN) + Number(m[1]))
  if ((m = /^Multiply that by (\d+)/.exec(q))) {
    const prev = messages.slice(0, -1).reverse().find((x) => x.role === 'assistant')
    return String(Number(m[1]) * Number(prev === undefined ? NaN : text(prev)))
  }
  if ((m = /capital of ([A-Za-z ]+)\?/.exec(q))) return CAPITALS[m[1].trim().toLowerCase()] ?? 'I do not know.'
  if ((m = /single word: (\w+)/.exec(q))) return m[1]
  if ((m = /Repeat this exact string and nothing else: (\w+)/.exec(q))) return m[1]
  // B28.375 — asked to quote an attached Docs page: its sentence that names the word, as the page says it.
  if ((m = /Quote the sentence in the attached page that mentions ([\w-]+)/.exec(q))) {
    const word = m[1]
    // B17.155 — Chat's fence around the page is not a sentence of it (Lens sets it a blank line apart; this stub joins blocks bare).
    const said = BREAK === 'docs-page' ? undefined : all.replace(/<\/?document[^>]*>/g, '\n').split(/\n|(?<=[.!?])\s+/).find((s) => s.includes(word) && !s.includes('Quote the sentence') && !s.trim().startsWith('#'))
    return said === undefined ? 'I cannot see any page.' : `The page says: "${said.trim()}"`
  }
  // B28.379 — asked what an attached image shows, the stand-in for a model that reads images reads the number the
  // scenario's PNG names in its tEXt chunk (e2e numberPNG), so it answers only when the image arrived whole.
  if (/What number does the attached image show\?/.test(q)) return imageNumber(messages[messages.length - 1]) ?? 'I cannot see any image.'
  // B17.155 — as Claude answered in production: a document's text is the attached document only when Chat fences and
  // names it; the same words bare read as the user's own, and it says it sees no document.
  if (/code word in the attached document/.test(q)) return /<document name="[^"]*">[^]*?code word is (\w+)[^]*?<\/document>/.exec(all)?.[1] ?? 'I cannot see any document.'
  if ((m = /from 1 to (\d+)/.exec(q))) return Array.from({ length: Number(m[1]) }, (_, i) => i + 1).join(' ')
  return 'I can only do arithmetic and capitals.'
}

/** B28.379 — the number a question's PNG names in its tEXt chunk, from Anthropic's image block or OpenAI's image_url. */
function imageNumber(m: Msg): string | undefined {
  for (const b of Array.isArray(m.content) ? m.content : []) {
    const data = b.type === 'image' ? b.source?.data : b.type === 'image_url' ? /^data:image\/png;base64,(.*)$/.exec(b.image_url?.url ?? '')?.[1] : undefined
    const png = Buffer.from(data ?? '', 'base64')
    if (!png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) continue
    for (let at = 8; at + 8 <= png.length; at += 12 + png.readUInt32BE(at)) {
      const [type, body] = [png.toString('latin1', at + 4, at + 8), png.subarray(at + 8, at + 8 + png.readUInt32BE(at))]
      if (type === 'tEXt' && body.toString('latin1').startsWith('Title\0')) return body.toString('latin1').slice(6)
    }
  }
  return undefined
}

const tokens = (s: string): number => Math.max(1, Math.ceil(s.length / 4))

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}

/**
 * B28.288 — Lens's rate limiter (talyvor-lens internal/ratelimit, its DefaultRules' second): 100 requests a second a key,
 * the one past it answered 429 with Retry-After, X-RateLimit-Remaining 0 and the window it hit. Counted on the workspace
 * read alone (GET /v1/workspaces/{ws}, which rate-limits-hold bursts), so no other scenario's requests are refused here.
 * STUB_BREAK=ratelimit-open lets every request through, as Lens's limiter does when Redis errors; retry-after refuses
 * without saying when to come back.
 */
const PER_SECOND = 100
const windows = new Map<string, { from: number; n: number }>()
/** The first workspace a burst took past the limit, for STUB_BREAK=ratelimit-open-later. */
let firstBurst: string | undefined
function limited(res: ServerResponse, ws: string, credential: string): boolean {
  const now = Date.now()
  const seen = windows.get(`${ws}:${credential}`)
  const w = seen === undefined || now - seen.from >= 1000 ? { from: now, n: 0 } : seen
  w.n++
  windows.set(`${ws}:${credential}`, w)
  if (w.n > PER_SECOND) firstBurst ??= ws
  if (w.n <= PER_SECOND || broke('ratelimit-open') || (broke('ratelimit-open-later') && firstBurst !== ws)) {
    res.setHeader('X-RateLimit-Remaining', String(Math.max(PER_SECOND - w.n, 0)))
    return false
  }
  const secs = Math.max(1, Math.ceil((w.from + 1000 - now) / 1000))
  json(res, 429, { error: 'rate limit exceeded', limit_type: 'second', retry_after_seconds: secs },
    { ...(broke('retry-after') ? {} : { 'Retry-After': String(secs) }), 'X-RateLimit-Remaining': '0' })
  return true
}

async function read(req: IncomingMessage): Promise<string> {
  let s = ''
  for await (const chunk of req) s += chunk
  return s
}

async function readBytes(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
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

/**
 * Not a route this stub knows. Said where the self-test reads it, so a read the app starts making is named
 * rather than answered with a body the screen cannot use. The BFF is Go's HTTP client; the harness reads
 * Lens directly too, and its lens-reads scenario asks for every route Lens has.
 */
function miss(req: IncomingMessage, res: ServerResponse, path: string): void {
  const asker = /^Go-http-client\//.test(req.headers['user-agent'] ?? '') ? 'the BFF' : 'the harness'
  console.log(`stub lens: no such route: ${req.method} ${path.replace(/^\/v1\/workspaces\/[^/]+/, '/v1/workspaces/{wsID}')} (asked by ${asker})`)
  json(res, 404, { error: 'stub: no such route' })
}

/** Routes Lens itself does not serve as production is configured: answered as Lens answers them, not as misses. */
const ABSENT = new Set(['/v1/bonds'])

/** Lens's simulated market (B22.8): the ECB's reference rates, a few of them, fixed. */
const QUOTES = { simulated: true, market_data: 'European Central Bank euro foreign exchange reference rates (source: ECB, free at www.ecb.europa.eu)',
  rate_date: '2026-10-02', quotes: SIM_QUOTES }

const bank = new Bank({ brk: BREAK, workspace: (id) => workspaces.get(id), runModel, json, read, miss,
  moderatorKey: process.env.STUB_MODERATOR_KEY ?? '', adminKey: process.env.STUB_ADMIN_KEY ?? '', base: BASE,
  credit: (id, ulxc, type, description, metadata) => {
    const ws = workspaces.get(id)
    if (ws !== undefined) book(ws, ulxc, type, description, metadata)
  } })
setInterval(() => bank.tick(), 2000)
// B32.85 — a room's wallet is an agent of its owner's in the Bank: funded, listed and posted as any agent (stub-rooms.ts).
setRoomWallets({ open: (ws, agentID, name) => bank.openRoomWallet(ws, agentID, name), balance: (agentID) => bank.agentBalance(agentID),
  use: (u) => bank.roomUse(u), billed: (agentID) => bank.agentBilledThisMonth(agentID), prize: (u) => bank.prizeUse(u) })
// B32.88 — and an agent's room_* tools over /mcp, on its own key.
bank.roomTool = roomAgentTool

/**
 * B28.377 — talyvor-lens B28.125's prompt schedules (apps/bff/prompt_schedules.go holds the contract): a prompt asked at
 * its time, then every day or week, on the paying agent's own wallet — judged by its rules as a call on its key is, and
 * charged to it, so the run names the statement line it was charged on. Lens's minute tick runs them; this stub's
 * every second, so a self-test waits seconds rather than a minute past the time set.
 */
interface PromptRun { ran_at: string; outcome: 'answered' | 'refused'; answer?: string; detail?: string; request_id?: string; charged_ulxc?: number; entry_id?: string }
interface PromptSchedule {
  id: string; ws: string; agent_id: string; prompt: string; provider: string; model: string; every: 'once' | 'day' | 'week'
  next_run_at?: string; active: boolean; created_at: string; runs: PromptRun[]
}
const promptSchedules: PromptSchedule[] = []
const EVERY_MS: Record<string, number> = { once: 0, day: 86_400_000, week: 7 * 86_400_000 }
const scheduleView = ({ ws: _w, ...s }: PromptSchedule) => s

async function promptScheduleRoute(req: IncomingMessage, res: ServerResponse, ws: Workspace, rest: string): Promise<boolean> {
  if (rest === '/agents/prompt-schedules' && req.method === 'GET') {
    return json(res, 200, { schedules: promptSchedules.filter((s) => s.ws === ws.id).reverse().map(scheduleView) }), true
  }
  const stop = /^\/agents\/prompt-schedules\/([^/]+)$/.exec(rest)
  if (stop !== null && req.method === 'DELETE') {
    const s = promptSchedules.find((x) => x.id === stop[1] && x.ws === ws.id)
    if (s === undefined) return json(res, 404, { error: 'economy: no such prompt schedule in this workspace' }), true
    s.active = false
    s.next_run_at = undefined
    return json(res, 200, { id: s.id, active: false }), true
  }
  const made = /^\/agents\/([^/]+)\/prompt-schedules$/.exec(rest)
  if (made === null || req.method !== 'POST') return false
  const b = JSON.parse((await read(req)) || '{}') as { prompt?: string; provider?: string; model?: string; every?: string; first_run_at?: string }
  if (bank.agentIn(ws.id, made[1]) === undefined) return json(res, 404, { error: 'economy: no such agent' }), true
  const first = Date.parse(b.first_run_at ?? '')
  if (!(b.prompt ?? '').trim() || CATALOG.find((c) => c.id === b.model && c.provider === b.provider) === undefined || EVERY_MS[b.every ?? ''] === undefined || Number.isNaN(first)) {
    return json(res, 400, { error: 'economy: a prompt schedule needs a prompt, a model, once, day or week, and its first time' }), true
  }
  const s: PromptSchedule = { id: 'psc_' + randomBytes(8).toString('hex'), ws: ws.id, agent_id: made[1], prompt: (b.prompt ?? '').trim(), provider: b.provider ?? '',
    model: b.model ?? '', every: b.every as PromptSchedule['every'], next_run_at: new Date(first).toISOString(), active: true, created_at: new Date().toISOString(), runs: [] }
  promptSchedules.push(s)
  return json(res, 201, scheduleView(s)), true
}

/** One run of a schedule that is due: asked as the agent's own call is, and charged to its wallet. */
function runPromptSchedule(s: PromptSchedule, now: number): void {
  const ws = workspaces.get(s.ws)
  const agent = bank.agentIn(s.ws, s.agent_id)
  const model = CATALOG.find((c) => c.id === s.model)
  const ran_at = new Date(now).toISOString()
  if (ws === undefined || agent === undefined || model === undefined) {
    s.runs.unshift({ ran_at, outcome: 'refused', detail: 'economy: the agent or its model is gone' })
  } else {
    const worst = Math.ceil((((tokens(s.prompt) + 8) * model.input_per_1m + 4096 * model.output_per_1m) / 1e6 / USD_PER_LXC) * 1e6)
    const refused = bank.admit(agent, worst, model.id, s.prompt, s.provider)
    if (refused !== undefined) {
      s.runs.unshift({ ran_at, outcome: 'refused', detail: refused.error })
    } else {
      const answer = think([{ role: 'user', content: s.prompt }])
      const charge = Math.ceil((((tokens(s.prompt) + 8) * model.input_per_1m + tokens(answer) * model.output_per_1m) / 1e6 / USD_PER_LXC) * 1e6)
      const fee = book(ws, -charge, 'spend', `${model.id} answer (scheduled prompt)`)
      ws.usage.total++
      const entry = broke('schedule-free') ? undefined : bank.spent(agent, charge, model.id, fee)
      s.runs.unshift({ ran_at, outcome: 'answered', answer, request_id: 'req_' + randomBytes(8).toString('hex'),
        charged_ulxc: broke('schedule-free') ? 0 : charge + fee, ...(entry === undefined ? {} : { entry_id: entry }) })
    }
  }
  const every = EVERY_MS[s.every]
  if (every === 0) {
    s.active = false
    s.next_run_at = undefined
  } else {
    s.next_run_at = new Date(Date.parse(s.next_run_at ?? ran_at) + every).toISOString()
  }
}

setInterval(() => {
  const now = Date.now()
  for (const s of promptSchedules) {
    // STUB_BREAK=schedule-early — asked the moment it is scheduled, whatever time was set.
    const due = s.active && s.next_run_at !== undefined && (Date.parse(s.next_run_at) <= now || (broke('schedule-early') && s.runs.length === 0))
    if (due) runPromptSchedule(s, now)
  }
}, 1000)

/**
 * B28.287 — Lens's vLLM provider, served when LENS_VLLM_BASE_URL names one: the request goes on with every header a key is
 * read from taken off (talyvor-lens auth.StripCredentialHeaders: Authorization, X-Talyvor-Key, X-API-Key) and
 * Proxy-Authorization — which Lens's list lacks, so Lens sends it on as it came (FOUND.md) — on both copies of the proxy,
 * and its answer comes back as the upstream gave it.
 */
const VLLM = process.env.LENS_VLLM_BASE_URL ?? ''
const CREDENTIAL_HEADERS = ['authorization', 'x-talyvor-key', 'x-api-key', 'proxy-authorization']
/** What fetch sets itself, or refuses to be given. */
const HOP_HEADERS = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive', 'upgrade', 'expect', 'accept-encoding'])

async function vllm(req: IncomingMessage, res: ServerResponse, path: string, raw: string): Promise<void> {
  const stream = (JSON.parse(raw || '{}') as { stream?: boolean }).stream === true
  const kept = stream ? (broke('key-forward-stream') ? CREDENTIAL_HEADERS : []) : broke('key-forward') ? ['x-talyvor-key', 'x-api-key'] : []
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(req.headers)) {
    if (v !== undefined && !HOP_HEADERS.has(k) && (!CREDENTIAL_HEADERS.includes(k) || kept.includes(k))) headers[k] = Array.isArray(v) ? v.join(', ') : v
  }
  try {
    const up = await fetch(`${VLLM.replace(/\/+$/, '')}/${path}`, { method: 'POST', headers, body: raw })
    res.writeHead(up.status, { 'Content-Type': up.headers.get('content-type') ?? 'application/json' })
    res.end(Buffer.from(await up.arrayBuffer()))
  } catch (e) {
    json(res, 502, { error: `vLLM upstream unreachable: ${e instanceof Error ? e.message : String(e)}` })
  }
}

async function proxy(req: IncomingMessage, res: ServerResponse, provider: string, path: string): Promise<void> {
  // talyvor-lens auth extractCredential: Authorization's bearer, else X-Talyvor-Key, else X-API-Key.
  const header = (name: string) => String(req.headers[name] ?? '')
  const credential = header('authorization').replace(/^Bearer /, '') || header('x-talyvor-key') || header('x-api-key')
  const agentCall = bank.agentOfKey(credential)
  // A workspace's token is served as its keys are (talyvor-lens: a JWT on the proxy, B34.6's gateway-auth).
  const ws = byKey.get(credential) ?? byToken.get(credential) ?? (agentCall === undefined ? undefined : workspaces.get(agentCall.ws.id))
  if (ws === undefined) return json(res, 401, { error: 'unauthorized' })
  const raw = await read(req)
  if (provider === 'vllm' && VLLM !== '') return vllm(req, res, path, raw)
  if (!CONFIGURED.has(provider)) return json(res, 503, { error: `provider ${provider} not configured` })
  const body = JSON.parse(raw || '{}') as { model?: string; stream?: boolean; max_tokens?: number; messages?: Msg[]; tools?: { name?: string; function?: { name?: string } }[] }
  // talyvor-lens B28.103 — model "auto" is served by the provider's cheapest chat model, and the stream names it.
  const auto = body.model === 'auto'
  const requested = auto
    ? CATALOG.filter((c) => c.provider === provider && c.output_per_1m > 0).sort((a, b) => a.input_per_1m + a.output_per_1m - b.input_per_1m - b.output_per_1m)[0]
    : CATALOG.find((c) => c.id === body.model)
  // STUB_BREAK=cheaper (B28.364) — the re-ask of the cheapest model is served by the dearest, which the stream names.
  const swapped = BREAK === 'cheaper' && !auto && req.headers['x-talyvor-cache'] === 'bypass' && requested !== undefined && requested.id === chatModelsOf(provider)[0]?.id
  const model = swapped ? chatModelsOf(provider).at(-1) : requested
  const named = swapped ? { model: model?.id } : !auto ? {} : { model: BREAK === 'auto' ? 'claude-sonnet-5' : model?.id }
  if (model === undefined || (provider === 'anthropic') !== (path === 'v1/messages')) return json(res, 400, { error: 'bad request' })
  const messages = body.messages ?? []
  // B28.78 — Anthropic refuses a conversation holding an answer that said nothing, as a stopped one does.
  const blank = messages.findIndex((m, i) => m.role === 'assistant' && i < messages.length - 1 && text(m).trim() === '' &&
    !(Array.isArray(m.content) && m.content.some((c) => c.type === 'tool_use')))
  if (provider === 'anthropic' && blank >= 0) {
    return json(res, 400, { type: 'error', error: { type: 'invalid_request_error',
      message: `messages.${blank}: all messages must have non-empty content except for the optional final assistant message` } })
  }
  const headers: Record<string, string> = {}
  // B28.370 — talyvor-lens prompts.Resolve: a system message, or Anthropic's system string, of exactly "lens:prompt:<name>"
  // is swapped for the workspace's prompt of that name, and the answer says so.
  const promptNamed = (s: unknown) => (typeof s === 'string' && s.startsWith('lens:prompt:') ? ws.prompts?.get(s.slice('lens:prompt:'.length).trim()) : undefined)
  const system = (body as { system?: unknown }).system
  if (promptNamed(system) !== undefined) {
    ;(body as { system?: unknown }).system = promptNamed(system)?.content
    headers['X-Talyvor-Prompt-Resolved'] = 'true'
  }
  for (const m of messages) {
    const prompt = m.role === 'system' ? promptNamed(m.content) : undefined
    if (prompt === undefined) continue
    m.content = prompt.content
    headers['X-Talyvor-Prompt-Resolved'] = 'true'
  }

  // The guardrails first: an injection is refused before the budget, the cache and the model; personal
  // data keeps the request out of the cache and the pool.
  const said = messages.map(text).join('\n')
  if (ws.guardrails.enable_injection && BREAK !== 'injection' && INJECTION.test(said)) {
    return json(res, 400, { error: 'guardrail violation', violations: [{ type: 'injection', action: 'block' }], risk_score: 1 },
      { 'X-Talyvor-Guardrail-Blocked': 'true' })
  }
  const personal = ws.guardrails.enable_pii && BREAK !== 'pii' && PERSONAL.test(said)
  // An agent's key: its rules judge the request's worst case before anything is answered (B19.2).
  // STUB_BREAK=rules-stream (B28.281) — a streamed request on an agent's key skips its rules, as a copy of the proxy that forgot them would.
  if (agentCall !== undefined && !(broke('rules-stream') && body.stream === true)) {
    const worst = Math.ceil((((tokens(messages.map(text).join(' ')) + 8) * model.input_per_1m + (body.max_tokens ?? 4096) * model.output_per_1m) / 1e6 / USD_PER_LXC) * 1e6)
    const refused = bank.admit(agentCall.agent, worst, model.id, said, provider)
    if (refused !== undefined) return json(res, refused.status, { error: refused.error })
  }
  if (BREAK !== 'budget' && ws.budgets.some((b) => b.enforcement === 'hard_block' && b.spent_usd >= b.limit_usd)) {
    return json(res, 402, { error: 'budget exceeded for workspace/team/sprint' })
  }
  // B28.426 — talyvor-lens B28.186: a question asked through a marketplace listing (X-Talyvor-Listing) is one use of it, charged
  // as a marketplace use, and the answer says how.
  const listing = header('x-talyvor-listing')
  if (listing !== '') {
    const charge = bank.chatListingUse(ws.id, listing)
    if (charge === undefined) return json(res, 404, { error: 'market: no such listing' })
    headers['X-Talyvor-Listing-Charge'] = charge
  }
  // B28.349 — offered Lens's wallet tool and asked what the agents spent, the stand-in model calls it, as a model does.
  // An answer that used a tool depends on the books at that moment, so none of it is kept or replayed; a question that
  // was only offered one is kept as any other.
  const tooled = messages.some((m) => m.role === 'tool' || (Array.isArray(m.content) && m.content.some((c) => c.type === 'tool_use' || c.type === 'tool_result')))
  const lastAsked = text(messages[messages.length - 1] ?? { role: 'user', content: '' })
  const asked = SPEND_QUESTION.exec(lastAsked)
  const offeredTool = (name: string) => (body.tools ?? []).some((t) => (t.name ?? t.function?.name) === name)
  // B28.122 — offered a connector's fingerprint tool and asked for a text's fingerprint, it calls it.
  const fingerprintTool = (body.tools ?? []).map((t) => t.name ?? t.function?.name ?? '').find((n) => n.endsWith('__fingerprint'))
  const fingerprint = FINGERPRINT.exec(lastAsked)
  // B28.374 — offered Track's create_issue and told to file a bug, it files it.
  const tool = toolResultOf(messages) !== undefined || !body.stream ? undefined
    : offeredTool('wallet_agents_spend') && asked !== null ? 'wallet_agents_spend'
    : offeredTool('create_issue') && FILE_BUG.test(lastAsked) ? 'create_issue'
    : fingerprintTool !== undefined && fingerprint !== null && BREAK !== 'connector' ? fingerprintTool
    : offeredTool('search_issues') && ABOUT_ISSUE.test(lastAsked) ? 'search_issues'
    : undefined
  if (tool !== undefined) {
    const inTok = tokens(messages.map(text).join(' ')) + 8
    const args = tool === 'create_issue' ? JSON.stringify(bugReport(lastAsked))
      : tool === fingerprintTool ? JSON.stringify({ text: fingerprint?.[1] ?? '' })
      : tool === 'search_issues' ? JSON.stringify({ query: ABOUT_ISSUE.exec(lastAsked)?.[1] ?? '' })
      : JSON.stringify({ from: new Date().toISOString().slice(0, 10), ...(asked?.[1] === 'my agents' ? {} : { agent: asked?.[1] }) })
    const outTok = tokens(args) + 8
    const toolCharge = Math.ceil(((inTok * model.input_per_1m + outTok * model.output_per_1m) / 1e6 / USD_PER_LXC) * 1e6)
    book(ws, -toolCharge, 'spend', `${model.id} tool call`)
    tag(ws, req, (inTok * model.input_per_1m + outTok * model.output_per_1m) / 1e6)
    ws.usage.total++
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    // talyvor-lens B28.102 — what the request was charged, before the terminator, when asked (apps/web chatStream.ts CHARGE_FRAME).
    const charged = () => {
      if (req.headers['x-talyvor-report-charge'] === 'true') res.write(`event: talyvor.charge\ndata: ${JSON.stringify({ type: 'talyvor.charge', charged_ulxc: toolCharge })}\n\n`)
    }
    const call = 'call_' + randomBytes(6).toString('hex')
    if (provider === 'anthropic') {
      const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      send('message_start', { type: 'message_start', message: { usage: { input_tokens: inTok, output_tokens: 0 } } })
      send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: call, name: tool, input: {} } })
      send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: args } })
      send('content_block_stop', { type: 'content_block_stop', index: 0 })
      send('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: outTok } })
      charged()
      send('message_stop', { type: 'message_stop' })
    } else {
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: call, type: 'function', function: { name: tool, arguments: args } }] }, finish_reason: 'tool_calls' }] })}\n\n`)
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: inTok, completion_tokens: outTok } })}\n\n`)
      charged()
      res.write('data: [DONE]\n\n')
    }
    return void res.end()
  }
  // Document conversion: asked for by the app, applied unless the workspace switched it off. A document
  // uploaded first and referenced by its tdoc_ id (B18.24) is converted whatever the switch says, as in
  // Lens: the id means nothing to a provider.
  const distill = req.headers['x-talyvor-distill'] === 'true' && ws.settings.distill_policy !== 'disabled'
  let converted = 0
  for (const m of messages) {
    if (typeof m.content === 'string' || m.content === null) continue
    const blocks: Block[] = []
    for (const c of m.content) {
      const ref = fileRef(c)
      const doc = ref === undefined ? documentOf(c) : ws.documents.get(ref)
      if (ref !== undefined && doc === undefined) return json(res, 400, { error: `document ${ref} not found` })
      if (doc === undefined) blocks.push(c)
      else if (BREAK === 'distill' || (ref === undefined && !distill)) blocks.push(ref === undefined ? c : { type: 'text', text: doc.bytes.toString('utf8') })
      else {
        converted++
        blocks.push({ type: 'text', text: toMarkdown(doc.bytes.toString('utf8'), doc.mediaType) })
      }
    }
    m.content = blocks
  }
  if (converted > 0) {
    headers['X-Talyvor-Distill'] = 'applied'
    ws.usage.converted += converted
  }
  // Request logging "none" keeps nothing new. As in Lens (talyvor-lens storeCaches), an answer kept
  // before the switch is still there to replay; the BFF asks such a repeat again (B17.12).
  // talyvor-lens B28.453 — and a temporary chat's question (X-Talyvor-Cache-Store: off, B28.131) keeps nothing.
  const temporary = req.headers['x-talyvor-cache-store'] === 'off' && !broke('temporary-kept')
  const keep = !personal && !tooled && !temporary && (ws.settings.logging_policy !== 'none' || BREAK === 'logging')
  // talyvor-lens B28.133 — a chat kept out of the shared pool (X-Talyvor-Pool: off, B28.381): its answer is not pooled
  // for another workspace, and it is served none of theirs. Its own workspace's cache still serves and keeps it.
  const unpooled = req.headers['x-talyvor-pool'] === 'off'
  ws.usage.total++

  const key = JSON.stringify([model.id, messages.map((m) => [m.role, text(m)])])
  const rid = 'req_' + randomBytes(10).toString('hex')
  headers['X-Talyvor-Request-ID'] = rid
  answered.set(rid, { ws: ws.id, key })
  const bypass = req.headers['x-talyvor-cache'] === 'bypass' && !(BREAK === 'logging' && ws.settings.logging_policy === 'none')
  let answer: string
  let charge = 0
  let fee = 0
  // talyvor-lens B28.118 — Chat's Search the web (X-Talyvor-Web-Search: on): two pages "found", which this stub serves.
  const searched = req.headers['x-talyvor-web-search'] === 'on' && !broke('web-search')
  // talyvor-lens B28.119 — Chat's Run code (X-Talyvor-Run-Code: on): the code the model ran for a fresh answer, if any.
  const runCode = req.headers['x-talyvor-run-code'] === 'on' && !broke('run-code')
  let ran: ReturnType<typeof primeRun>
  // talyvor-lens B28.102 — what a model's answer was charged, said in the stream; STUB_BREAK=charge says a µLXC more.
  let charged: number | undefined
  // B28.368 — the answer stopped at max_tokens, as a model's does.
  let cut = false
  const own = personal || tooled ? undefined
    : ws.answers.get(key) ?? (converted > 0 && messages.length === 1 ? alikeDocument(ws.answers, model.id, text(messages[0])) : undefined)
  const shared = messages.length === 1 && !personal && !tooled && !unpooled ? pool.get(key) ?? (broke('pool-negation') ? looseMatch(model.id, said) : undefined) : undefined
  if (broke('pool-tells') && [...workspaces.values()].some((w) => w.id !== ws.id && w.answers.has(key))) headers['X-Talyvor-Pool-Seen'] = 'elsewhere'
  const inTok = tokens(messages.map(text).join(' ')) + 8
  // B28.358 — what an answer costs at list price, which a replay saves whole and a pooled serve in part.
  const listULXC = (out: string) => Math.ceil(((inTok * model.input_per_1m + tokens(out) * model.output_per_1m) / 1e6 / USD_PER_LXC) * 1e6)
  // talyvor-lens B19.2 — an agent's byte-identical retry under one Idempotency-Key (same key, model and prompt) is
  // answered and charged once; STUB_BREAK=call-replay charges every copy.
  const idem = agentCall === undefined ? '' : String(req.headers['idempotency-key'] ?? '')
  const retryKey = idem === '' || broke('call-replay') ? undefined : createHash('sha256').update([credential, idem, model.id, said].join('\0')).digest('hex')
  const retried = retryKey === undefined ? undefined : retries.get(retryKey)
  if (retried !== undefined) {
    answer = retried
  } else if (!bypass && own !== undefined) {
    answer = own
    headers['X-Talyvor-Cache-Replay'] = 'true'
    // talyvor-lens B28.95 — and says what the replay saved.
    if (BREAK !== 'savings') headers['X-Talyvor-Cache-Saved-ULXC'] = String(listULXC(answer))
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
      const list = Math.max(listULXC(answer), charge)
      headers['X-Talyvor-Pool-List-ULXC'] = String(list)
      headers['X-Talyvor-Pool-Saved-ULXC'] = String(list - charge)
      fee = book(ws, -charge, 'spend', 'pooled answer')
      tag(ws, req, (charge / 1e6) * USD_PER_LXC)
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
    // talyvor-lens B28.119 — with Run code on, the nth prime is worked out by code run in the sandbox.
    ran = runCode ? primeRun(text(messages[messages.length - 1])) : undefined
    answer = ran !== undefined ? `The ${ran.nth} prime is ${ran.stdout.trim()}.` : think(messages)
    // talyvor-lens B28.118 — searched first, the answer cites the pages it was given.
    if (searched) answer += ' [1] [2]'
    if (body.max_tokens !== undefined && tokens(answer) > body.max_tokens) {
      answer = answer.slice(0, body.max_tokens * 4)
      cut = true
    }
    const outTok = tokens(answer)
    charge = Math.ceil(((inTok * model.input_per_1m + outTok * model.output_per_1m) / 1e6 / USD_PER_LXC) * 1e6)
    fee = book(ws, -charge, 'spend', `${model.id} answer`)
    tag(ws, req, (inTok * model.input_per_1m + outTok * model.output_per_1m) / 1e6)
    charged = BREAK === 'charge' ? charge + 1 : charge
    if (retryKey !== undefined) retries.set(retryKey, answer)
    if (keep) ws.answers.set(key, answer)
    if (keep && messages.length === 1 && !personal && (!unpooled || broke('pool-off-shared')) && (ws.settings.cache_poolable || broke('pool-unshared'))) pool.set(key, { owner: ws.id, answer })
  }
  const spend = () => {
    if (agentCall !== undefined) bank.spent(agentCall.agent, charge, model.id, fee)
  }
  // STUB_BREAK=hangup-unbilled — spent from the agent only when the stream ends, and not at all if it hung up first.
  const spendAtEnd = broke('hangup-unbilled') && body.stream === true
  if (!spendAtEnd) spend()
  let hungUp = false
  res.on('close', () => {
    hungUp = !res.writableFinished
  })
  const outTok = tokens(answer)
  const shownIn = BREAK === 'price' ? inTok * 2 : inTok

  if (!body.stream) {
    // B28.440 — OpenAI's shape for its chat completions, as the SDK's .openai() reads them.
    if (provider === 'openai') {
      return json(res, 200, { choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }],
        usage: { prompt_tokens: shownIn, completion_tokens: outTok } }, headers)
    }
    return json(res, 200, { content: [{ type: 'text', text: answer }], usage: { input_tokens: shownIn, output_tokens: outTok } }, headers)
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', ...headers })
  const pieces = answer.match(/.{1,12}/gs) ?? ['']
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  // talyvor-lens B28.118 — the pages it searched, first, on either writer (apps/web chatStream.ts CITATIONS_FRAME).
  if (searched) send('talyvor.citations', { type: 'talyvor.citations', citations: WEB_PAGES.map((p, i) => ({ n: i + 1, url: `${BASE}${p.path}`, title: p.title })) })
  // talyvor-lens B28.119 — the code it ran and what that printed, on either writer (apps/web chatStream.ts CODE_RUN_FRAME).
  if (ran !== undefined) send('talyvor.code_run', { type: 'talyvor.code_run', language: 'python', code: ran.code, stdout: ran.stdout, stderr: '', exit_code: 0 })
  const sayCharged = () => {
    if (charged !== undefined && req.headers['x-talyvor-report-charge'] === 'true') send('talyvor.charge', { type: 'talyvor.charge', charged_ulxc: charged })
  }
  if (provider === 'anthropic') {
    send('message_start', { type: 'message_start', message: { ...named, usage: { input_tokens: shownIn, output_tokens: 0 } } })
    for (const p of pieces) {
      send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: p } })
      await new Promise((r) => setTimeout(r, 30))
    }
    send('message_delta', { type: 'message_delta', delta: { stop_reason: cut ? 'max_tokens' : 'end_turn' }, usage: { output_tokens: outTok } })
    sayCharged()
    send('message_stop', { type: 'message_stop' })
  } else {
    for (const p of pieces) {
      res.write(`data: ${JSON.stringify({ ...named, choices: [{ index: 0, delta: { content: p } }] })}\n\n`)
      await new Promise((r) => setTimeout(r, 30))
    }
    res.write(`data: ${JSON.stringify({ ...named, choices: [{ index: 0, delta: {}, finish_reason: cut ? 'length' : 'stop' }] })}\n\n`)
    res.write(`data: ${JSON.stringify({ ...named, choices: [], usage: { prompt_tokens: shownIn, completion_tokens: outTok } })}\n\n`)
    sayCharged()
    res.write('data: [DONE]\n\n')
  }
  if (spendAtEnd && !hungUp) spend()
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
    if (PLAN_FEES[open.plan] !== undefined) {
      ws.allowance = { granted_ulxc: ALLOWANCE_ULXC, consumed_ulxc: 0, remaining_ulxc: ALLOWANCE_ULXC, fee_usd_cents: PLAN_FEES[open.plan],
        period_start: new Date().toISOString(), period_end: new Date(Date.now() + 30 * 86400e3).toISOString() }
    }
  }
  res.writeHead(303, { Location: `${APP_URL}/billing/success?session_id=${session}` })
  res.end()
}

/**
 * B32.71 — GET /v1/workspaces/{ws}/plan/seats?members=N as Lens answers it (cmd/lens/plan_gates_handler.go):
 * 200 when the plan's seats take N members, else 402 with Lens's sentence (internal/plans RefuseCount).
 */
function seatsCheck(res: ServerResponse, wsID: string, members: number): void {
  const ws = workspaces.get(wsID)
  if (ws === undefined) return json(res, 404, { error: 'workspace not found' })
  if (!(members >= 0)) return json(res, 400, { error: 'members must be the number of members the workspace would have, ≥ 0' })
  const plan = ws.plan?.id ?? ws.syntheticPlan ?? 'free'
  const gated = GATED_AS[plan] ?? plan
  const limit = SEATS.find(([p]) => p === gated)?.[1] ?? 1
  if (limit === -1 || members <= limit) return json(res, 200, { plan, seats: limit, members })
  const seat = (n: number) => (n === 1 ? 'seat' : 'seats')
  const allows = BREAK === 'seats-allows' ? undefined : SEATS.find(([, n]) => n === -1 || n > limit)
  const error = `LENS_PLAN_GATES: the ${plan} plan allows ${limit} ${seat(limit)}` + (allows === undefined ? ' — a contract with Talyvor sets more'
    : allows[1] === -1 ? ` — the ${allows[0]} plan allows unlimited seats` : ` — the ${allows[0]} plan allows ${allows[1]} ${seat(allows[1])}`)
  return json(res, 402, { error, plan, gate: 'seats', limit, allows: allows?.[0] })
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

/**
 * B28.280 — Lens's Stripe webhook (internal/billing HandleWebhook), reduced to a top-up: no more of the body than its cap
 * is read, the Stripe-Signature must be the secret's over that and no older than Stripe allows, and a paid session credits
 * its workspace once — an event delivered again, or the session under another event, is acknowledged and credits nothing.
 */
async function stripeWebhook(req: IncomingMessage, res: ServerResponse, secret: string): Promise<void> {
  const whole = await readBytes(req)
  const raw = (broke('webhook-oversized') ? whole : whole.subarray(0, WEBHOOK_BODY_CAP)).toString('utf8')
  const parts = String(req.headers['stripe-signature'] ?? '').split(',').map((kv) => kv.split('=') as [string, string])
  const t = Number(parts.find(([k]) => k === 't')?.[1])
  const want = createHmac('sha256', secret).update(`${t}.${raw}`).digest()
  const signed = parts.some(([k, v]) => k === 'v1' && /^[0-9a-f]+$/.test(v ?? '') && v.length === want.length * 2 && timingSafeEqual(Buffer.from(v, 'hex'), want))
  const fresh = broke('webhook-stale') || Math.abs(Date.now() / 1000 - t) <= WEBHOOK_TOLERANCE_S
  if (!broke('webhook-unsigned') && (!signed || !fresh)) return void res.writeHead(400, { 'Content-Type': 'text/plain' }).end('invalid signature\n')
  let event: { id?: string; type?: string; data?: { object?: { id?: string; mode?: string; payment_status?: string; amount_total?: number; currency?: string; metadata?: Record<string, string> } } }
  try {
    event = JSON.parse(raw)
  } catch {
    return void res.writeHead(400, { 'Content-Type': 'text/plain' }).end('invalid signature\n')
  }
  const sess = event.data?.object ?? {}
  const paying = event.type === 'checkout.session.async_payment_succeeded' || (event.type === 'checkout.session.completed' && sess.payment_status === 'paid')
  const ws = workspaces.get(sess.metadata?.workspace_id ?? '')
  const cents = sess.amount_total ?? 0
  const ulxc = cents * Math.round(0.01 / USD_PER_LXC * 1e6)
  if (!paying || sess.mode !== 'payment' || ws === undefined || sess.currency !== 'usd' || cents < 1_000 || cents > 1_000_000 || String(ulxc) !== sess.metadata?.lxc_amount) {
    return void res.writeHead(200).end()
  }
  const again = webhookEvents.has(event.id ?? '') || creditedSessions.has(sess.id ?? '')
  webhookEvents.add(event.id ?? '')
  creditedSessions.add(sess.id ?? '')
  if (!again || broke('webhook-replay')) book(ws, ulxc, 'purchase', 'stripe top-up', { usd_cents: cents, stripe_event_id: event.id, stripe_session_id: sess.id, funding: 'test' })
  res.writeHead(200).end()
}

// talyvor-lens partners.Services and status.railNames, in its order.
const RAILS: [string, string][] = [['account', 'Accounts and payments'], ['fx', 'Currency conversion'], ['broker', 'Trading'],
  ['stablecoin', 'Stablecoins'], ['kyc', 'Identity verification'], ['screening', 'Sanctions screening'], ['capital', 'Credit'],
  ['insurer', 'Cover'], ['agent_token', 'Agent cards'], ['tax', 'Tax']]

function moneyRails(screeningDown: boolean): { name: string; status: string }[] {
  const now = Date.now()
  const hourAgo = new Date(now - 3_600_000).toISOString()
  const recent = new Date(now).toISOString()
  return RAILS.map(([service, name]) => {
    const capabilities = service === 'fx' ? [{ key: 'fx', cleared: false }] : []
    if (service !== 'screening') return { service, mode: 'test', last_success: recent, last_failure: null, name, status: 'operational', capabilities }
    const [ok, failed] = screeningDown ? [hourAgo, recent] : [recent, hourAgo]
    return { service, mode: 'test', last_success: ok, last_failure: failed, name, status: screeningDown ? 'outage' : 'operational', capabilities, lists_age_hours: 3 }
  })
}

// talyvor-lens B30.11 — yesterday's reconciliation in each money currency on the Test partner, clean; planted, the pounds run
// has one payment the partner's statement does not show and the £7.00 shortfall it leaves, as Lens's own test has it.
function reconciliationRuns(): unknown[] {
  const ranAt = new Date(Date.now() - 3600e3)
  const day = new Date(ranAt.getTime() - 86_400e3).toISOString().slice(0, 10)
  return ['EUR', 'GBP', 'USD', 'USDC'].map((currency) => {
    const missing = currency === 'GBP' && broke('reconciliation-missing')
    const breaks = missing ? [{ kind: 'missing', workspace_id: 'ws_stub', account_id: 'macc_stub_gbp', payment_ref: 'test_pbb_never_arrived',
      ledger_minor: 700, statement_minor: 0, amount_minor: -700 }] : []
    const hold = missing ? 700 : 0
    return { id: `rec_stub_${currency}`, day, currency, funding: 'test', partner: 'test', customers_hold_minor: hold, partner_holds_minor: 0,
      shortfall_minor: hold, break_count: breaks.length, breaks, ran_at: ranAt.toISOString() }
  })
}

// talyvor-lens's /status.json (B37.3's documented keys): Lens's own components up, the rails answering their probes (B37.2).
function statusJSON(): unknown {
  const at = new Date().toISOString()
  const rails = moneyRails(broke('rails-outage'))
  const down = rails.filter((r) => r.status === 'outage').map((r) => r.name)
  return {
    status: 'operational', version: 'stub', uptime_hours: Math.round(process.uptime() / 36) / 100, updated_at: at,
    components: ['PostgreSQL', 'Redis', 'NATS', 'Proxy'].map((name) => ({ name, status: 'operational', latency_ms: 1, measured: true, checked_at: at })),
    providers: [{ name: 'OpenAI', status: 'operational', latency_ms: 100, checked_at: at }],
    rails,
    rails_summary: { up: rails.length - down.length, down: down.length, idle: 0, down_names: down },
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', BASE)
  const p = url.pathname
  const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '')
  try {
    // B28.285 — Lens's /healthz: how long it has been up, which the testers read to tell a restart.
    if (p === '/healthz') return json(res, 200, { status: broke('status-truth') ? 'degraded' : 'healthy', uptime_seconds: Math.floor(process.uptime()), version: 'stub' })
    // talyvor-lens B28.12 — the API reference and the two pages that say what Lens is, none behind a credential.
    if (p === '/openapi.json') return json(res, 200, lensOpenAPI(broke('openapi-wallets')))
    if (p === '/' || p === '/status') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return void res.end(lensPage(p, broke('openapi-wallets')))
    }
    // talyvor-lens B30.12 — the money rails, every one on its Test partner. Screening failed once an hour ago and has answered
    // since, so it is up; planted, its failure is the newer and it is down.
    if (p === '/status.json') return json(res, 200, statusJSON())
    // talyvor-lens B30.11 — the reconciliation runs and the safeguarding view, on the operator read key or the admin key, as Lens.
    if (p === '/v1/admin/reconciliation' || p === '/v1/admin/safeguarding') {
      if (bearer === '' || ![process.env.STUB_OPERATOR_READ_KEY, process.env.STUB_ADMIN_KEY].includes(bearer)) return json(res, 401, { error: 'admin credentials required' })
      return json(res, 200, p === '/v1/admin/safeguarding' ? { currencies: reconciliationRuns() } : { runs: reconciliationRuns() })
    }
    // talyvor-lens B28.118 — the web pages a search "finds", so a cited link opens.
    const page = WEB_PAGES.find((w) => w.path === p)
    if (page !== undefined) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return void res.end(`<!doctype html><title>${page.title}</title><h1>${page.title}</h1>`)
    }
    if (p === '/.well-known/openid-configuration') {
      return json(res, 200, { issuer: BASE, authorization_endpoint: `${BASE}/authorize`, token_endpoint: `${BASE}/token`,
        jwks_uri: `${BASE}/jwks`, id_token_signing_alg_values_supported: ['RS256'] })
    }
    if (p.startsWith('/v1/synthetic/')) {
      if (req.headers['x-talyvor-synthetic-key'] !== KEY) return json(res, 401, { error: 'the synthetic operator key is required' })
      if (p === '/v1/synthetic/workspaces/reset') {
        // As Lens (B26.1): only those named in {"workspaces":[…]}, or every one when none are named.
        const named = (JSON.parse((await read(req)) || '{}') as { workspaces?: string[] }).workspaces ?? []
        const unknown = named.filter((id) => !workspaces.has(id))
        if (unknown.length > 0) return json(res, 400, { error: `${unknown.length} named workspaces are not active synthetic workspaces, nothing was reset: ${unknown.slice(0, 5).join(', ')}` })
        const chosen = named.length > 0 ? named.map((id) => workspaces.get(id) as Workspace) : [...workspaces.values()]
        // B27.16 — the self-test fails on this line: a run resets its own users, never everyone's.
        if (named.length === 0) console.log(`stub lens: reset EVERY synthetic workspace (${chosen.length}), naming none`)
        for (const ws of chosen) {
          ws.answers.clear()
          if (ws.balance < GRANT_ULXC) book(ws, GRANT_ULXC - ws.balance, 'admin_grant', 'synthetic test credits restored')
        }
        for (const [key, a] of pool) if (chosen.some((ws) => ws.id === a.owner)) pool.delete(key)
        return json(res, 200, { reset: chosen.length })
      }
      if (await bank.syntheticRoute(req, res, p)) return
      // Lens B35.1 — a test workspace put on a plan with the synthetic key.
      const onPlan = /^\/v1\/synthetic\/workspaces\/([^/]+)\/plan$/.exec(p)
      if (onPlan !== null && req.method === 'POST') {
        const ws = workspaces.get(decodeURIComponent(onPlan[1]))
        if (ws === undefined) return json(res, 404, { error: 'not a synthetic workspace' })
        const { plan = '' } = JSON.parse((await read(req)) || '{}') as { plan?: string }
        ws.syntheticPlan = plan
        return json(res, 200, { workspace_id: ws.id, plan: { plan } })
      }
      const { count = 100, plan = 'free' } = JSON.parse((await read(req)) || '{}') as { count?: number; plan?: string }
      const expires = new Date(Date.now() + 24 * 3600e3).toISOString().replace(/\.\d+Z$/, 'Z')
      const out = []
      for (let i = 0; i < count; i++) {
        const id = 's' + randomBytes(20).toString('hex').slice(0, 26)
        const ws = newWorkspace(id, 'tok-' + randomBytes(16).toString('hex'))
        ws.syntheticPlan = plan
        book(ws, GRANT_ULXC, 'admin_grant', 'synthetic test credits')
        workspaces.set(id, ws)
        byToken.set(ws.token, ws)
        out.push({ workspace_id: id, token: ws.token, expires_at: expires })
      }
      return json(res, 201, { created: out.length, plan, workspaces: out })
    }
    if (p === '/v1/economy/conversion-rate') return json(res, 200, { lens_per_lxc: 1, rate: 1, usd_per_lxc: USD_PER_LXC })
    if (WEBHOOK_SECRETS[p] !== undefined && req.method === 'POST') return await stripeWebhook(req, res, WEBHOOK_SECRETS[p])
    // B32.14 — the price card's three public reads, as Lens states them with no credential: the plans, what each company
    // plan unlocks, and every fee (lens.env.example's defaults).
    if (p === '/v1/billing/plans') {
      return json(res, 200, { plans: Object.entries(PLAN_FEES).map(([id, cents]) => ({ id, usd_cents: cents, included_ulxc: (ALLOWANCE_ULXC * cents) / PLAN_FEES.plus })),
        company_plans: Object.entries(COMPANY_PLANS).map(([id, cents]) => ({ id, usd_cents: cents })), byok_add_on_usd_cents: 19900, enterprise_from_usd_cents: 250000 })
    }
    if (p === '/v1/public/plan-gates') {
      const gate = (agents: number, seats: number, keys: string, live: boolean, sso: boolean, edge: boolean) =>
        ({ agents, seats, own_provider_keys: keys, live_money: live, slack_teams_approvals: live, sso, audit_export: sso, edge })
      return json(res, 200, { order: ['free', 'team', 'business', 'enterprise'], plans: { free: gate(3, 1, 'none', false, false, false),
        team: gate(25, 5, 'add_on', true, false, false), business: gate(-1, 25, 'included', true, true, false), enterprise: gate(-1, -1, 'included', true, true, true) } })
    }
    if (p === '/v1/public/fees') {
      return json(res, 200, { market_take_bps: 1500, services_take_bps: 500, compute_take_bps: 500, lending_fee_bps: 100,
        platform_fee_bps: { ...PLATFORM_FEE_BPS, enterprise: 100 }, fx_margin_bps: { free: 0, team: 50, business: 25, enterprise: 15 },
        intl_payment_fee_minor: { GBP: 500, EUR: 600, USD: 700 }, merchant_fee_bps: 75, merchant_a2a_fee_bps: 100 })
    }
    // B28.127 — a shared chat, read with no credential: its title, turns and when it was shared, or 404.
    const sharedChat = /^\/v1\/public\/chat-shares\/([A-Za-z0-9_-]+)$/.exec(p)
    if (sharedChat !== null && req.method === 'GET') {
      const sh = chatShares.get(sharedChat[1])
      if (sh === undefined) return json(res, 404, { error: 'not found' })
      return json(res, 200, { title: sh.title, messages: sh.messages, created_at: sh.created_at })
    }
    const paying = /^\/stub-checkout\/(\w+)$/.exec(p)
    if (paying !== null) return await stripeCheckout(req, res, paying[1])
    const proxied = /^\/v1\/proxy\/([a-z]+)\/(.+)$/.exec(p)
    if (proxied !== null) return await proxy(req, res, proxied[1], proxied[2])

    // B30.118 — the Know Your Agent keys, revocation list and verify, which any platform calls with no credential.
    if (await bank.kyaPublic(req, res, p)) return
    // B32.81 — the market_* MCP tools on an agent's own key.
    if (await bank.agentMCP(req, res, bearer, p)) return
    if (await bank.agentPay(req, res, bearer, p)) return
    if (await bank.agentUse(req, res, bearer, p)) return
    if (await bank.agentTaxProfile(req, res, bearer, p)) return
    if (await bank.moderatorRoute(req, res, bearer, p)) return
    // B32.98 — the platform-reporting export and its runs, on the global admin key.
    if (await bank.platformReportRoute(req, res, bearer, url)) return
    // B32.91 — the operator's room queue, keep and close, on the same moderator key (stub-rooms.ts).
    if (await roomsModeratorRoute(req, res, p, bearer, process.env.STUB_MODERATOR_KEY ?? '')) return
    if (p.startsWith('/stub-connect/')) {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      return void res.end('<!doctype html><title>Stripe Connect onboarding (stub)</title><h1>Stripe Connect onboarding (stub)</h1>')
    }
    // B32.71 — Track's seats check (B32.73): Track asks about the Lens workspace the BFF named, on a credential
    // minted for that workspace. The stand-in for that credential is the synthetic key the stub Track is given.
    const seats = /^\/v1\/workspaces\/([^/]+)\/plan\/seats$/.exec(p)
    if (seats !== null && req.headers['x-talyvor-synthetic-key'] === KEY) return seatsCheck(res, seats[1], Number(url.searchParams.get('members')))
    // B28.376 — Track's syncer reads each request's spend and the issue it named (talyvor-track GetSpendByRequest), on a
    // credential for the workspace; the stand-in for it is the synthetic key the stub Track is given.
    if (p === '/v1/api/spend/by-request' && req.headers['x-talyvor-synthetic-key'] === KEY) {
      const since = Date.now() - Number(url.searchParams.get('days') ?? 30) * 86_400e3
      const of = workspaces.get(url.searchParams.get('workspace_id') ?? '')
      return json(res, 200, { rows: (of?.tagged ?? []).filter((e) => e.at >= since).map((e) => ({ request_id: e.request_id, feature: e.feature,
        issue_id: e.issue, cost_usd: e.cost_usd, input_tokens: 0, output_tokens: 0, ts: new Date(e.at).toISOString() })), next_cursor: '' })
    }
    // The BFF runs a marketplace use on the session key the chat streams on (B20.3).
    const ws = byToken.get(bearer) ?? byKey.get(bearer)
    if (ws === undefined) return json(res, 401, { error: 'unauthorized' })
    if (p === '/v1/catalog/models') return json(res, 200, CATALOG)
    // B28.349 — Lens's MCP JSON-RPC route, on the workspace's own token: Chat's read-only wallet tool.
    if (p === '/mcp' && req.method === 'POST') {
      const rpc = JSON.parse((await read(req)) || '{}') as Parameters<Bank['mcp']>[1] & { params?: { arguments?: Record<string, unknown> } }
      // STUB_BREAK=tool-fetch (B28.284) — a tool reaches every address its arguments name.
      if (broke('tool-fetch')) for (const v of Object.values(rpc.params?.arguments ?? {})) if (typeof v === 'string' && /^https?:\/\//.test(v)) await fetch(v).catch(() => undefined)
      const answer = bank.mcp(ws.id, rpc) as { result?: { content?: { type: string; text: string }[] } }
      // STUB_BREAK=tool-key (B28.284) — a tool's answer carries the key it was called with.
      if (broke('tool-key')) answer.result?.content?.push({ type: 'text', text: `called with ${bearer}` })
      return json(res, 200, answer)
    }
    // B28.285 — the nodes Lens offers for a model, and the audit export sent to a webhook (stub-guards.ts).
    if (p === '/v1/nodes/available') return json(res, 200, nodesAvailable(url.searchParams.get('model') ?? ''))
    if (p === '/v1/audit/webhook' && req.method === 'POST') return json(res, ...auditWebhook(await read(req), broke('ssrf')))
    // B32.84 — a room contribution's listing and lineage, its room's members' alone (stub-rooms.ts).
    if (roomListingRoute(res, p, ws.id)) return
    if (bank.publicRoute(res, p, url, ws.id)) return
    if (await bank.publicWrite(req, res, p, ws.id)) return
    // B32.53 — rooms: Chat's rail, the directory, a new room and a room's first screen (stub-rooms.ts).
    if (await roomsRoute(req, res, p, url, ws.id, ws.plan?.id ?? ws.syntheticPlan ?? 'free')) return
    if (p === '/v1/catalog/discovered') return json(res, 200, [])
    if (ABSENT.has(p) || p.startsWith('/v1/bonds/')) return json(res, 404, { error: 'not found' })
    if (p === '/v1/markets/simulated/quotes') return json(res, 200, QUOTES)
    // Spend by feature: Lens's Go slice over the window (`ORDER BY cost_usd DESC`), null while nothing was spent in it.
    // B28.106 — grouped by each request's X-Talyvor-Feature, the untagged as "".
    if (p === '/v1/api/spend/by-feature') {
      const since = Date.now() - Number(url.searchParams.get('days') ?? 30) * 86_400e3
      const by = new Map<string, { feature: string; cost_usd: number; requests: number }>()
      for (const e of ws.tagged.filter((x) => x.at >= since)) {
        const row = by.get(e.feature) ?? { feature: e.feature, cost_usd: 0, requests: 0 }
        row.cost_usd += e.cost_usd
        row.requests++
        by.set(e.feature, row)
      }
      return json(res, 200, by.size === 0 ? null : [...by.values()].sort((a, b) => b.cost_usd - a.cost_usd))
    }
    // B28.376 — what Lens holds an issue's requests cost (X-Talyvor-Issue), as its anomaly read says it.
    const ofIssue = /^\/v1\/workspaces\/([^/]+)\/anomalies\/issue\/([^/]+)$/.exec(p)
    if (ofIssue !== null && ofIssue[1] === ws.id) {
      const issue = decodeURIComponent(ofIssue[2])
      return json(res, 200, { workspace_id: ws.id, issue_id: issue, cost_usd: ws.tagged.filter((e) => e.issue === issue).reduce((sum, e) => sum + e.cost_usd, 0) })
    }
    if (p === '/v1/api/usage') {
      const u = ws.usage
      return json(res, 200, { period_days: Number(url.searchParams.get('days') ?? 30), models: [], cache: { total_requests: u.total,
        cache_hits: u.hits + u.pooled, misses: u.total - u.hits - u.pooled, hit_rate: u.total === 0 ? 0 : (u.hits + u.pooled) / u.total,
        by_source: { cache_hit_exact: u.hits, cache_hit_pooled: u.pooled } } })
    }
    if (p === '/v1/documents' && req.method === 'POST') {
      const bytes = await readBytes(req)
      const id = 'tdoc_' + randomBytes(12).toString('hex')
      const mediaType = String(req.headers['content-type'] ?? '')
      const filename = url.searchParams.get('filename') ?? ''
      const uploadedAt = new Date().toISOString()
      ws.documents.set(id, { mediaType, bytes, filename, uploadedAt })
      return json(res, 201, { id, media_type: mediaType, filename, size_bytes: bytes.length, uploaded_at: uploadedAt })
    }
    // B28.380 — the workspace's uploaded documents, listed without their bytes, and one deleted for good (talyvor-lens
    // B28.132): 204, then 404 for its id and gone from the list. STUB_BREAK=file-delete answers 204 and keeps it.
    if (p === '/v1/documents' && req.method === 'GET') {
      return json(res, 200, { documents: [...ws.documents].map(([id, d]) => ({ id, media_type: d.mediaType, filename: d.filename, size_bytes: d.bytes.length, uploaded_at: d.uploadedAt })) })
    }
    const ofDocument = /^\/v1\/documents\/([^/]+)$/.exec(p)
    if (ofDocument !== null && req.method === 'DELETE') {
      const id = decodeURIComponent(ofDocument[1])
      if (!ws.documents.has(id)) return json(res, 404, { error: 'document not found' })
      if (!broke('file-delete')) ws.documents.delete(id)
      res.writeHead(204).end()
      return
    }
    if (p === '/v1/auth/session-keys' && req.method === 'POST') {
      const key = 'tlv_sk_' + randomBytes(24).toString('hex')
      byKey.set(key, ws)
      return json(res, 201, { key, expires_at: new Date(Date.now() + 3600e3).toISOString() })
    }
    // B28.370 — the workspace's named prompts (talyvor-lens /v1/prompts): listed, and one saved at version 1.
    if (p === '/v1/prompts' && req.method === 'GET') return json(res, 200, [...(ws.prompts?.values() ?? [])])
    if (p === '/v1/prompts' && req.method === 'POST') {
      const { name = '', content = '', description = '' } = JSON.parse((await read(req)) || '{}') as { name?: string; content?: string; description?: string }
      if (name.trim() === '') return json(res, 400, { error: 'prompts: Name required' })
      if (content === '') return json(res, 400, { error: 'prompts: Content required' })
      const prompts = (ws.prompts ??= new Map())
      if (prompts.has(name)) return json(res, 400, { error: 'prompts: insert: duplicate key value violates unique constraint' })
      const now = new Date().toISOString()
      const prompt: NamedPrompt = { id: randomBytes(16).toString('hex'), name, version: 1, content, description, workspace_id: ws.id, is_active: true,
        created_by: '', created_at: now, updated_at: now }
      prompts.set(name, prompt)
      return json(res, 201, prompt)
    }
    // B34.5 — an answer marked wrong (Lens B15.4): its stored copy and its pooled copy go, and it is never served again.
    if (p === '/v1/feedback' && req.method === 'POST') {
      const { request_id = '', signal = '' } = JSON.parse((await read(req)) || '{}') as { request_id?: string; signal?: string }
      const a = answered.get(request_id)
      if (a === undefined || a.ws !== ws.id || !['negative', 'repeat'].includes(signal)) return json(res, 404, { error: 'no such request for this workspace' })
      const stored = ws.answers.delete(a.key)
      const pooled = pool.get(a.key)?.owner === ws.id && pool.delete(a.key)
      return json(res, 200, { stored, served_from: stored ? 'cache' : 'model', answers_removed: stored ? 1 : 0, exact_copies_removed: (stored ? 1 : 0) + (pooled ? 1 : 0) })
    }
    const view = () => ({ id: ws.id, name: 'Synthetic user', cache_prefix: `ws:${ws.id}:`, spend_limit_usd: 0, allowed_models: [], allowed_providers: [],
      max_tokens_per_request: 0, max_output_tokens: 0, max_input_tokens: 0, active: true, ...ws.settings, synthetic: true, created_at: ws.created_at })
    // B34.5 — the workspaces a token may act in, as Lens lists them (newListMyWorkspacesHandler): its own, alone.
    if (p === '/v1/workspaces' && req.method === 'GET') return json(res, 200, [view()])
    const scoped = /^\/v1\/workspaces\/([^/]+)(\/.*)?$/.exec(p)
    if (scoped !== null) {
      if (scoped[1] !== ws.id) return json(res, 403, { error: 'forbidden' })
      const rest = scoped[2] ?? ''
      if (rest === '') return limited(res, ws.id, bearer) ? undefined : json(res, 200, view())
      // B28.377 — before the Agent Bank's routes, whose /agents/{id}/… would take prompt-schedules for an agent's id.
      if (await promptScheduleRoute(req, res, ws, rest)) return
      if (await bank.workspaceRoute(req, res, ws, rest, url)) return
      // B28.285 — compute nodes, verified only when Lens's guarded probe reaches them (stub-guards.ts).
      if (rest === '/nodes' || rest.startsWith('/nodes/')) {
        const answer = nodesRoute(req.method ?? 'GET', rest, ws.id, req.method === 'POST' ? await read(req) : '', broke('ssrf'))
        if (answer !== undefined) return json(res, ...answer)
      }
      const setting = SETTINGS[rest]
      if (setting !== undefined && req.method === 'PUT') {
        const v = (JSON.parse((await read(req)) || '{}') as Record<string, unknown>)[setting]
        if (v === undefined) return json(res, 400, { error: `${setting} required` })
        if (!(BREAK === 'setting' && setting === 'cost_optimize_routing')) (ws.settings as unknown as Record<string, unknown>)[setting] = v
        return json(res, 200, { [setting]: BREAK === 'setting' && setting === 'cost_optimize_routing' ? v : ws.settings[setting] })
      }
      if (rest === '/guardrails') {
        if (req.method === 'POST') ws.guardrails = { ...GUARDRAILS, ...(JSON.parse((await read(req)) || '{}') as object) } as Workspace['guardrails']
        return json(res, 200, ws.guardrails)
      }
      if (rest === '/api-keys' && req.method === 'POST') {
        const { name = '', scopes = [] } = JSON.parse((await read(req)) || '{}') as { name?: string; scopes?: string[] }
        const key = 'tlv_' + randomBytes(24).toString('hex')
        const k = { id: randomBytes(16).toString('hex'), workspace_id: ws.id, key_prefix: key.slice(0, 12), name, scopes, created_at: new Date().toISOString(), key }
        ws.keys.push(k)
        byKey.set(key, ws)
        return json(res, 201, { key, id: k.id, prefix: k.key_prefix, name, scopes, warning: 'Store this key securely. It will not be shown again.' })
      }
      // Lens lists the keys as a Go slice: null when there are none.
      // STUB_BREAK=key-listed (B28.287) — each key shown whole.
      if (rest === '/api-keys') return json(res, 200, ws.keys.length === 0 ? null : ws.keys.map(({ key, ...k }) => (broke('key-listed') ? { ...k, key } : k)))
      const apiKey = /^\/api-keys\/([^/]+)$/.exec(rest)
      if (apiKey !== null && req.method === 'DELETE') {
        const k = ws.keys.find((x) => x.id === apiKey[1])
        // B28.359 — an agent's key is one of the workspace's keys, and is revoked the same way.
        if (k === undefined && bank.revokeAgentKey(ws.id, apiKey[1])) return json(res, 200, { ok: true })
        if (k === undefined) return json(res, 404, { error: 'key not found' })
        ws.keys = ws.keys.filter((x) => x !== k)
        byKey.delete(k.key)
        return json(res, 200, { ok: true })
      }
      if (rest === '/budgets' && req.method === 'POST') {
        const b = JSON.parse((await read(req)) || '{}') as Partial<Budget>
        const at = new Date().toISOString()
        const budget: Budget = { id: randomBytes(8).toString('hex'), workspace_id: ws.id, scope: b.scope ?? 'workspace', scope_id: b.scope_id ?? '',
          period: b.period ?? 'monthly', limit_usd: b.limit_usd ?? 0, spent_usd: 0, alert_thresholds: b.alert_thresholds ?? [],
          enforcement: b.enforcement ?? 'hard_block', ends_at: null, created_at: at, updated_at: at }
        ws.budgets.push(budget)
        return json(res, 201, budget)
      }
      if (rest === '/budgets') return json(res, 200, ws.budgets)
      const budget = /^\/budgets\/([^/]+)$/.exec(rest)
      if (budget !== null && req.method === 'PATCH') {
        const b = ws.budgets.find((x) => x.id === budget[1])
        if (b === undefined) return json(res, 404, { error: 'no such budget' })
        Object.assign(b, JSON.parse((await read(req)) || '{}'), { id: b.id, workspace_id: ws.id, scope: b.scope, spent_usd: b.spent_usd, updated_at: new Date().toISOString() })
        return json(res, 200, b)
      }
      if (rest === '/tare/savings') return json(res, 200, { by_work_item: [] })
      if (rest === '/distill/usage') return json(res, 200, { converted: ws.usage.converted, vision_ocr: 0, days: 30 })
      // B29.12 — Settings reads provider keys. Lens mounts the route only while key custody is armed
      // (talyvor-lens cmd/lens/main.go, `if byokStore != nil`); unarmed, as here, it is not found.
      if (rest === '/provider-keys' || rest.startsWith('/provider-keys/')) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        return void res.end('404 page not found\n')
      }
      if (rest === '/earnings') {
        const held = ws.earnings.filter((e) => e.type.endsWith('_held')).reduce((n, e) => n + e.amount_ulens, 0)
        return json(res, 200, { workspace_id: ws.id, contribution_settled_ulens: 0, capital_settled_ulens: 0, settled_ulens: 0, held_ulens: held, revoked_ulens: 0,
          contribution_settled_usd_at_peg: 0, settled_usd_at_peg: 0, held_usd_at_peg: held / 1e6 / 10, lens_per_usd: 10, earning_enabled: true,
          disabled_gates: null, reuses: ws.usage.pooled, helped_workspaces: 0, by_type: [], unclassified_types: null })
      }
      if (rest === '/tokens/balance') {
        const held = ws.earnings.filter((e) => e.type.endsWith('_held')).reduce((n, e) => n + e.amount_ulens, 0)
        return json(res, 200, { workspace_id: ws.id, balance_ulens: 0, held_balance_ulens: held, lifetime_earned_ulens: 0, lifetime_spent_ulens: 0,
          updated_at: ws.earnings[0]?.created_at ?? '0001-01-01T00:00:00Z' })
      }
      if (rest === '/spend/current-month') return json(res, 200, { current_month_usd: monthUSD(ws) })
      // B27.32: the stub routes nothing to a cheaper model and keeps no list price, so every measured
      // request was charged what it would have cost — a saving of exactly zero, as Lens reports it.
      if (rest === '/savings/current-month') {
        const start = new Date()
        start.setUTCDate(1)
        start.setUTCHours(0, 0, 0, 0)
        const n = ws.ledger.filter((r) => r.type === 'spend' && new Date(r.created_at) >= start).length
        const usd = monthUSD(ws)
        return json(res, 200, { month_start: start.toISOString(), saved_usd: 0, list_usd: usd, charged_usd: usd, requests: n, unmeasured_requests: 0 })
      }
      if (rest === '/deletion-requests') return json(res, 200, { requests: [] })
      // B28.365 — the sealed chat history as talyvor-lens B28.107 keeps it: the strings as they arrive, the stored version + 1 on
      // a PUT over the stored version, 409 over any other, version 0 while none is stored. STUB_BREAK=sync answers a PUT and keeps nothing.
      if (rest === '/chat-history') {
        const h = ws.history ?? { version: 0, salt: '', iv: '', ciphertext: '', updated_at: null }
        if (req.method === 'GET') return json(res, 200, h)
        if (req.method === 'DELETE') {
          ws.history = undefined
          return json(res, 200, { deleted: true })
        }
        if (req.method === 'PUT') {
          const b = JSON.parse((await read(req)) || '{}') as { base_version?: unknown; salt?: unknown; iv?: unknown; ciphertext?: unknown }
          if (typeof b.base_version !== 'number' || [b.salt, b.iv, b.ciphertext].some((x) => typeof x !== 'string' || x === '')) {
            return json(res, 400, { error: 'base_version, salt, iv and ciphertext required' })
          }
          if (b.base_version !== h.version) return json(res, 409, { error: 'another device stored a newer copy of this history', version: h.version })
          const next = { version: h.version + 1, salt: b.salt as string, iv: b.iv as string, ciphertext: b.ciphertext as string, updated_at: new Date().toISOString() }
          if (!BREAK.split(',').includes('sync')) ws.history = next
          return json(res, 200, { version: next.version, updated_at: next.updated_at })
        }
      }
      // B28.127 — the workspace's shared chats as talyvor-lens keeps them: listed newest first, one made with a token from
      // crypto/rand, and one turned off by deleting its copy. STUB_BREAK=share-revoke takes it off the list and keeps serving the copy.
      if (rest === '/chat-shares' && req.method === 'GET') {
        const live = [...chatShares.values()].filter((sh) => sh.ws === ws.id && sh.off !== true).reverse()
        return json(res, 200, live.map(({ id, token, conversation_id, title, created_at }) => ({ id, token, conversation_id, title, created_at })))
      }
      if (rest === '/chat-shares' && req.method === 'POST') {
        const b = JSON.parse((await read(req)) || '{}') as { conversation_id?: unknown; title?: unknown; messages?: unknown }
        if (typeof b.conversation_id !== 'string' || typeof b.title !== 'string' || !Array.isArray(b.messages) || b.messages.length === 0) {
          return json(res, 400, { error: 'conversation_id, title and messages required' })
        }
        const sh: ChatShare = { id: randomBytes(8).toString('hex'), token: randomBytes(24).toString('base64url'), ws: ws.id,
          conversation_id: b.conversation_id, title: b.title, messages: b.messages as ChatShare['messages'], created_at: new Date().toISOString() }
        chatShares.set(sh.token, sh)
        const { id, token, conversation_id, title, created_at } = sh
        return json(res, 201, { id, token, conversation_id, title, created_at })
      }
      const unshare = /^\/chat-shares\/([^/]+)$/.exec(rest)
      if (unshare !== null && req.method === 'DELETE') {
        const sh = [...chatShares.values()].find((x) => x.id === unshare[1] && x.ws === ws.id && x.off !== true)
        if (sh === undefined) return json(res, 404, { error: 'no such shared chat' })
        if (BREAK.split(',').includes('share-revoke')) sh.off = true
        else chatShares.delete(sh.token)
        res.writeHead(204)
        return void res.end()
      }
      // Pattern mining is off on production (LENS_PATTERN_MINING_ENABLED): an opt-in either way is refused.
      if (rest === '/pattern-mining/opt-in' && req.method !== 'GET') return json(res, 503, { error: 'pattern mining is not enabled on this deployment' })
      if (rest === '/pattern-mining/opt-in') return json(res, 200, { enabled: false, opted_in: false })
      // B34.5 — what the workspace stored, deleted (Lens B21.3): confirmed with its id or its name.
      if (rest === '/stored-answers' && req.method === 'DELETE') {
        const { scope = '', confirm = '' } = JSON.parse((await read(req)) || '{}') as { scope?: string; confirm?: string }
        if (scope !== 'shared' && scope !== 'all') return json(res, 400, { error: 'scope must be "shared" or "all"' })
        if (confirm !== ws.id && confirm !== 'Synthetic user') return json(res, 400, { error: "confirm must be this workspace's name, typed exactly — this cannot be undone" })
        const shared = [...pool].filter(([, a]) => a.owner === ws.id).map(([k]) => k)
        for (const k of shared) pool.delete(k)
        const own = ws.answers.size - shared.filter((k) => ws.answers.has(k)).length
        if (scope === 'all') ws.answers.clear()
        else for (const k of shared) ws.answers.delete(k)
        return json(res, 200, { shared_answers: shared.length, private_answers: scope === 'all' ? own : 0, shared_conversions: 0, private_conversions: 0 })
      }
      if (rest === '/stored-answers') {
        const shared = [...pool.values()].filter((a) => a.owner === ws.id).length
        return json(res, 200, { shared_answers: shared, private_answers: ws.answers.size - shared, shared_conversions: 0, private_conversions: 0,
          cached_copies: ws.answers.size })
      }
      // The BFF asks with an empty body whether top-ups are sold (probeBillingEnabled): Lens refuses the body.
      if (rest === '/billing/checkout' && req.method === 'POST') {
        const { usd_cents } = JSON.parse((await read(req)) || '{}') as { usd_cents?: number }
        if (usd_cents === undefined) return json(res, 400, { error: 'invalid JSON body' })
        // B34.4 — a top-up's checkout: Stripe's page to pay on (test mode); nothing is credited until Stripe says it was paid.
        if (![1000, 5000, 10000].includes(usd_cents)) return json(res, 400, { error: 'billing: that top-up amount is not offered' })
        return json(res, 200, { url: `https://checkout.stripe.com/c/pay/cs_test_${randomBytes(12).toString('hex')}` })
      }
      // B34.4 — LENS converted to LXC: refused under the minimum, and beyond the LENS the workspace holds.
      if (rest === '/lxc/convert' && req.method === 'POST') {
        const { lxc_amount_ulxc = 0 } = JSON.parse((await read(req)) || '{}') as { lxc_amount_ulxc?: number }
        if (lxc_amount_ulxc < 100_000) return json(res, 400, { error: 'economy: conversion below minimum of 100000 µLXC' })
        const lens = ws.earnings.filter((e) => !e.type.endsWith('_held')).reduce((n, e) => n + e.amount_ulens, 0)
        if (lens < lxc_amount_ulxc && !BREAK.split(',').includes('convert-free')) return json(res, 402, { error: 'economy: insufficient LENS balance for conversion' })
        if (BREAK.split(',').includes('convert-free')) {
          book(ws, lxc_amount_ulxc, 'convert_from_lens', 'converted from LENS')
          return json(res, 200, { lxc_minted: lxc_amount_ulxc })
        }
        return json(res, 501, { error: 'stub: converting LENS the workspace holds is not modelled' })
      }
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
        // B28.285 — a document past the cap is refused, and a .docx's document is unpacked no further than it (stub-guards.ts).
        const bytes = await readBytes(req)
        if (bytes.length > DOC_CAP && !broke('doc-size')) return json(res, 413, { error: 'document exceeds the size limit' })
        if (mediaType === DOCX) {
          const xml = docxDocument(bytes, broke('zip-bomb') ? Infinity : DOC_CAP)
          if (xml === undefined) return json(res, 422, { error: 'conversion failed: distill: conversion failed' })
          if (xml === 'too large') return json(res, 422, { error: 'conversion failed: distill: input exceeds size limit' })
          const markdown = xml.subarray(0, 1 << 20).toString().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
          return json(res, 200, { markdown, format: 'docx', needs_vision: false, tier: 'free', savings: { input_bytes: bytes.length, output_bytes: xml.length,
            input_tokens_raw: tokens(xml.subarray(0, 1 << 20).toString()), input_tokens_distilled: tokens(markdown), tokens_saved: 0 } })
        }
        let raw = bytes.toString()
        if (BREAK === 'conversion') raw = raw.replace(/<p[^>]*>[\s\S]*?<\/p>/gi, '')
        const markdown = toMarkdown(raw, mediaType)
        const [tin, tout] = [tokens(raw), tokens(markdown)]
        return json(res, 200, { markdown, format: /html/.test(mediaType) ? 'html' : 'txt', needs_vision: false,
          savings: { input_bytes: raw.length, output_bytes: markdown.length, input_tokens_raw: tin, input_tokens_distilled: tout, tokens_saved: tin - tout } })
      }
      if (rest === '/billing/subscribe' && req.method === 'POST') {
        const { plan = '' } = JSON.parse((await read(req)) || '{}') as { plan?: string }
        if (PLAN_FEES[plan] === undefined && COMPANY_PLANS[plan] === undefined) return json(res, 400, { error: `plan ${plan} is not sold here` })
        if (ws.plan !== undefined) return json(res, 409, { error: 'this workspace already has a live subscription' })
        const session = 'cs_test_' + randomBytes(12).toString('hex')
        checkouts.set(session, { ws: ws.id, plan })
        return json(res, 200, { url: `${BASE}/stub-checkout/${session}` })
      }
      // B32.12 — the plan Lens holds the workspace to, its gates, and the agents it has now (archived ones not counted).
      if (rest === '/plan' && req.method === 'GET') {
        const gated = gatedAs(ws)
        const byok = ws.plan?.byok ?? false
        return json(res, 200, { plan: ws.plan?.id ?? ws.syntheticPlan ?? 'free', gated_as: gated, byok_add_on: byok, own_provider_keys_allowed: byok || gated === 'business',
          gates: { agents: PLAN_AGENTS[gated] ?? 3, slack_teams_approvals: gated !== 'free' }, agents_used: bank.activeAgents(ws.id) })
      }
      // B28.364 — Lens's routing advisor (GET …/routing/recommendation) as one that has learned a provider's cheapest chat
      // model answers every question well: that model, on the quality-per-dollar basis, in Lens's routing.Recommendation.
      if (rest === '/routing/recommendation' && req.method === 'GET') {
        const provider = url.searchParams.get('provider') || 'openai'
        const range = url.searchParams.get('input_range') || 'medium'
        const best = chatModelsOf(provider)[0]
        return json(res, 200, best === undefined
          ? { model: '', provider, basis: 'none', sample_size: 0, distinct_workspaces: 0, confidence: '', expected_quality: 0, expected_cost_per_1k: 0,
            reason: `no qualifying ${provider} candidate for /${range} (need ≥50 samples across ≥3 workspaces)` }
          : { model: best.id, provider, basis: 'quality_per_dollar', sample_size: 120, distinct_workspaces: 5, confidence: 'medium', expected_quality: 0.9,
            expected_cost_per_1k: (best.input_per_1m + best.output_per_1m) / 2000, reason: `best quality_per_dollar for /${range} among ${provider} models: ${best.id}` })
      }
      if (rest === '/billing/allowance') {
        return json(res, 200, { allowance: ws.allowance === undefined ? null : { workspace_id: ws.id, ...ws.allowance },
          earned_ulens: 0, earned_held_ulens: 0, earned_usd_cents: 0, earned_back_usd_cents: 0 })
      }
      // B34.5 — a live plan for individuals moved to another (Lens B18.14): the allowance follows at once here, as
      // Stripe's webhook makes it follow on Lens.
      if (rest === '/billing/subscription/plan' && req.method === 'POST') {
        const { plan = '' } = JSON.parse((await read(req)) || '{}') as { plan?: string }
        if (PLAN_FEES[plan] === undefined) return json(res, 400, { error: `plan ${plan} is not one to move to` })
        if (ws.plan === undefined || PLAN_FEES[ws.plan.id] === undefined) return json(res, 409, { error: 'billing: workspace has no live subscription to change' })
        if (ws.plan.id === plan) return json(res, 409, { error: `billing: the subscription is already on ${plan}` })
        const was = ws.plan.id
        ws.plan.id = plan
        // The allowance moves by the difference in included usage times the share of the period left (B18.14).
        const included = (p: string) => (ALLOWANCE_ULXC * PLAN_FEES[p]) / PLAN_FEES.plus
        const a = ws.allowance
        if (a !== undefined) {
          const [start, end] = [Date.parse(a.period_start ?? ''), Date.parse(a.period_end ?? '')]
          const left = end > start ? Math.min(1, Math.max(0, (end - Date.now()) / (end - start))) : 1
          const granted = Math.max(a.consumed_ulxc, Math.round(a.granted_ulxc + (included(plan) - included(was)) * left))
          ws.allowance = { ...a, granted_ulxc: granted, remaining_ulxc: granted - a.consumed_ulxc, fee_usd_cents: PLAN_FEES[plan] }
        }
      }
      // B34.5 — BYOK, Team's add-on (Lens B32.10): added to or removed from a live Team subscription.
      if (rest === '/billing/subscription/byok' && (req.method === 'POST' || req.method === 'DELETE')) {
        if (ws.plan === undefined) return json(res, 409, { error: 'billing: workspace has no live subscription' })
        if (ws.plan.id !== 'team') return json(res, 409, { error: `billing: the BYOK add-on is Team's — this workspace is on ${ws.plan.id}` })
        if ((ws.plan.byok ?? false) === (req.method === 'POST')) return json(res, 409, { error: 'billing: the Team subscription already is as asked' })
        ws.plan.byok = req.method === 'POST'
      }
      if ((rest === '/billing/subscription/cancel' || rest === '/billing/subscription/resume') && req.method === 'POST') {
        if (ws.plan === undefined) return json(res, 409, { error: 'this workspace has no live subscription' })
        ws.plan.cancel = rest.endsWith('/cancel')
      }
      if (['/billing/subscription', '/billing/subscription/cancel', '/billing/subscription/resume', '/billing/subscription/byok', '/billing/subscription/plan'].includes(rest)) {
        return json(res, 200, { subscribed: ws.plan !== undefined, status: ws.plan === undefined ? undefined : 'active',
          current_period_end: new Date(Date.now() + 30 * 86400e3).toISOString(), cancel_at_period_end: ws.plan?.cancel ?? false, livemode: false,
          plan: ws.plan?.id, byok: ws.plan?.byok ?? false })
      }
      if (rest === '/roi/report' && url.searchParams.get('format') === 'html') {
        let html = ROI_REPORT.replaceAll('ws-selftest', ws.id)
        if (BREAK === 'roi-brand') {
          html = html.replace(/<span class="tv-mark"[\s\S]*?<\/svg><\/span><\/span>/, '').replace('</style>',
            'h1{color:#1a1a2e;font-family:Inter,sans-serif}@media print{body{background:#1a1a2e}}</style>' +
            '<link rel="stylesheet" href="http://fonts.invalid/inter.css">')
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        return void res.end(html)
      }
      if (rest === '/tokens/history') {
        const limit = Number(url.searchParams.get('limit') ?? 20)
        const offset = Number(url.searchParams.get('offset') ?? 0)
        return json(res, 200, ws.earnings.slice(offset, offset + limit))
      }
      if (rest === '/lxc/balance') {
        const lag = BREAK === 'meter' ? ws.ledger.filter((r) => Date.now() - Date.parse(r.created_at) < 30_000).reduce((n, r) => n + r.amount_ulxc, 0) : 0
        return json(res, 200, { workspace_id: ws.id, balance_ulxc: ws.balance - lag, lifetime_minted_ulxc: ws.ledger.filter((r) => r.amount_ulxc > 0).reduce((n, r) => n + r.amount_ulxc, 0),
          lifetime_spent_ulxc: ws.ledger.filter((r) => r.type === 'spend').reduce((n, r) => n - r.amount_ulxc, 0), usd_value_uusd: Math.round(ws.balance * USD_PER_LXC) })
      }
      if (rest === '/lxc/history') {
        const limit = Number(url.searchParams.get('limit') ?? 20)
        const offset = Number(url.searchParams.get('offset') ?? 0)
        return json(res, 200, ws.ledger.slice(offset, offset + limit))
      }
    }
    return miss(req, res, p)
  } catch (e) {
    return json(res, 500, { error: String(e) })
  }
}).listen(PORT, '127.0.0.1', () => console.log(`stub lens on ${BASE}${BREAK !== '' ? ` (broken: ${BREAK})` : ''}`))
