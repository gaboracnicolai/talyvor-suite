import { ApiError, readableList } from '../../lib/api'
import { type Citation, type CodeRun, type ToolCallPiece, type Usage, extractDeltas, mergeUsage, splitFrames } from './chatStream'
import type { AnswerCost, AnswerSource } from './price'
import { PROMPT_RESOLVED_HEADER, promptReference } from './promptLibrary'

// chatApi.ts — the wire for W4.6.1 step 6.
//
// Three reads and one write, all through the BFF:
//   GET  /api/models                      the deployment's catalog (Lens /v1/catalog/models)
//   GET  /api/ai/providers                the providers Lens holds no key for (B18.58)
//   POST /api/ai/stream/{provider}/{path} the flushing SSE relay built in step 3
//   GET  /api/chat/tools, POST /api/chat/tools/call   B28.349: Lens's read-only wallet MCP tools (askChat)
//
// ⚠ THE BROWSER NEVER HOLDS A WORKSPACE KEY. The relay mints and leases a {proxy}-scoped Lens
// SESSION key server-side (apps/bff/stream.go). That is step 4's whole purpose and it is why this
// module sends no credential of its own.

/** One row of Lens's model catalog. Only the fields this screen reads are declared. */
export interface ChatModel {
  id: string
  provider: string
  display_name: string
  input_per_1m: number
  output_per_1m: number
  deprecated?: boolean
  /** B18.60 — when the provider released it (YYYY-MM-DD), from Lens's catalog (B18.12). */
  release_date?: string
  /** B18.60 — its place in the provider's line-up: frontier | balanced | fast | embedding. */
  tier?: string
  /** B28.363 — set only on the Auto choice (autoChoice): the cheapest and the dearest model it can be served by. */
  auto?: { cheapest: ChatModel; dearest: ChatModel }
}

/**
 * B28.363 — the model a request names to let Lens choose: talyvor-lens routes model "auto" to the cheapest model that
 * answers it well (B28.103, its proxy isAutoRoute), and the stream names the model that served it.
 */
export const AUTO_MODEL_ID = 'auto'
export const AUTO_MODEL_NAME = 'Auto (cheapest good)'

/**
 * STREAMABLE_PROVIDERS — the providers whose STREAM this client can read: every provider Lens
 * proxies (the BFF relay's allowlist), in the order the picker lists them.
 *
 * ⚠ MEASURED IN talyvor-lens (B18.7, b9f3301): each provider streams through its own upstream and
 * key, and the client receives Anthropic's events for Anthropic and OpenAI chat.completion.chunk
 * events for every other provider — Google and Bedrock translated. chatStream.ts reads both.
 */
export const STREAMABLE_PROVIDERS: readonly string[] = ['openai', 'anthropic', 'google', 'mistral', 'groq', 'bedrock', 'vllm']

/**
 * The upstream path each provider's chat endpoint lives at, under Lens's /v1/proxy/{provider}/.
 * Every provider but Anthropic takes the OpenAI request shape (Lens translates Google's and
 * Bedrock's).
 */
function chatPath(provider: string): string | undefined {
  if (!STREAMABLE_PROVIDERS.includes(provider)) return undefined
  return provider === 'anthropic' ? 'v1/messages' : 'v1/chat/completions'
}

/**
 * B10.3 — a document attached to a question. `data` (base64) lives in memory only: history.ts
 * keeps the name and size, never the bytes, so a reopened conversation shows what was attached but
 * cannot send it again.
 */
export interface ChatAttachment {
  name: string
  media_type: string
  size: number
  /** B18.24 — the id Lens stored the document under (POST /api/documents → tdoc_…). A question
   *  references the document by it rather than carrying the file. Absent on a document from before. */
  file_id?: string
}

/** B18.24 — what converting a question's documents saved, as Lens measured it (talyvor-lens B18.13):
 *  tokens by the gateway's own count — 0, never a guess, for a binary file — and bytes. */
export interface DistillSaved {
  tokens: number
  bytes: number
}

/** B28.358 — Lens trimmed the question with Tare before the model read it (X-Talyvor-Tare: applied). `tokens` is
 *  what that saved, X-Talyvor-Tare-Tokens-Saved (talyvor-lens B28.95), when Lens said. */
export interface TareSaved {
  tokens?: number
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  /** B1.4 — what an answer cost. Screen-side only: requestBody() never sends it upstream. */
  cost?: AnswerCost
  /** B10.3 — documents sent with this question. */
  attachments?: ChatAttachment[]
  /** B10.3 — set once the answer arrives: whether Lens converted the attached documents to text. */
  converted?: boolean
  /** B15.6 — set when the answer was not written by the model just now: replayed or shared. */
  source?: AnswerSource
  /** B18.24 — on an answer: what converting the question's documents saved. */
  saved?: DistillSaved
  /** B28.358 — on an answer: Tare trimmed its question, and what that saved when Lens said. */
  tare?: TareSaved
  /** B23.12 — on an answer: Lens's id for the request that produced it (X-Talyvor-Request-ID), which a
   *  thumbs-down names it by. */
  request_id?: string
  /** B23.12 — this answer was marked wrong, and Lens removed it so it is not served again. */
  marked_wrong?: boolean
  /** B28.81 — on an answer that is not whole: the model sent nothing back (`blank`), or it stopped at
   *  its length limit (`cut_off`). */
  incomplete?: 'blank' | 'cut_off'
  /** B28.349 — on an answer: the statement lines Lens's wallet tool read it from, each linked to its row. */
  spend?: SpendLine[]
  /** B28.349 — on an answer that took more than one request to the model (it called a tool first): how many. Each is charged. */
  requests?: number
  /** B28.354 — on an answer in a conversation an agent pays for: that agent, and whether Lens said it billed it. */
  payer?: AnswerPayer
  /** B28.362 — on an answer: what Lens charged for it, in µLXC, when Lens said (chatStream.ts CHARGE_FRAME). It is the
   *  figure under the answer in place of the estimate, and what the conversation's total counts. */
  charged_ulxc?: number
  /** B28.363 — on an answer asked of Auto: Lens chose the model that served it, and the stream named it. */
  auto?: boolean
  /** B28.112 — on an answer asked for again: its other versions, oldest first, each the answer with the turns that
   *  followed it. Screen-side only, like the price: requestBody() sends role and content. */
  versions?: ChatMessage[][]
  /** B28.112 — with `versions`, where this answer stands among all of them, from 0. */
  version?: number
  /** B28.370 — on an answer in a chat that uses a named prompt: which, and whether Lens said it swapped it in. */
  prompt?: AnswerPrompt
  /** B28.372 — on an answer asked with Search the web on: the pages Lens searched and gave the model, by the number the
   *  answer cites each with (chatStream.ts CITATIONS_FRAME); empty when none came back. Screen-side only. */
  citations?: Citation[]
  /** B28.373 — on an answer asked with Run code on: the code the model ran in Lens's sandbox and what it printed, in the
   *  order it ran (chatStream.ts CODE_RUN_FRAME). Screen-side only. */
  code_runs?: CodeRun[]
}

/** B28.370 — the named prompt an answer was asked with, and whether Lens's answer said it used it. */
export interface AnswerPrompt {
  name: string
  resolved: boolean
}

/** B28.354 — the agent chosen to pay for an answer. `billed` only when Lens's answer named that agent. */
export interface AnswerPayer {
  agent_id: string
  name: string
  billed: boolean
}

/**
 * B28.354 — names the agent whose wallet pays for a Chat request. Sent with the agent the conversation's
 * "Paid by" chose; Lens answers with it when it billed that agent, and without it when the workspace paid.
 */
export const PAID_BY_HEADER = 'X-Talyvor-Paid-By'

/**
 * B28.361 — the conversation a Chat request belongs to, and the budget its owner set on it, in µLXC. The id goes
 * with every request, so Lens can count a conversation's spend from its first answer; the budget goes when one is
 * set. Lens refuses a request that would take the conversation past it before the model is asked (talyvor-lens
 * B28.100), with the code `conversation_budget`.
 */
export const CONVERSATION_HEADER = 'X-Talyvor-Conversation-ID'
export const CONVERSATION_BUDGET_HEADER = 'X-Talyvor-Conversation-Budget-ULXC'

/** B28.362 — asks Lens to say in the stream what it charged for the answer (chatStream.ts CHARGE_FRAME). */
export const REPORT_CHARGE_HEADER = 'X-Talyvor-Report-Charge'

/** B28.372 — `on` asks Lens to search the web before the model answers, and to say in the stream which pages it gave the
 *  model (chatStream.ts CITATIONS_FRAME; talyvor-lens B28.118). */
export const WEB_SEARCH_HEADER = 'X-Talyvor-Web-Search'

/** B28.373 — `on` lets the model run code in Lens's sandbox while it answers, and asks Lens to say in the stream what it
 *  ran and what that printed (chatStream.ts CODE_RUN_FRAME; talyvor-lens B28.119). */
export const RUN_CODE_HEADER = 'X-Talyvor-Run-Code'

/** B28.361 — which conversation a request is part of, and its budget in µLXC when it has one. */
export interface ConversationTag {
  id: string
  budget_ulxc?: number
  /** B28.109 — the instructions of the project the conversation is in, sent to the model with every request. */
  instructions?: string
  /** B28.370 — the named prompt from the library the conversation uses, sent by name for Lens to swap in. */
  prompt?: string
  /** B28.372 — Search the web is on for this question: Lens searches first and the answer cites the pages. */
  web_search?: boolean
  /** B28.373 — Run code is on for this question: the model may run code in Lens's sandbox to answer it. */
  run_code?: boolean
}

/** B28.349 — a Lens MCP tool Chat may offer the model (GET /api/chat/tools): only ones that read. */
export interface ChatTool {
  name: string
  description: string
  input_schema: unknown
}

/** B28.349 — one tool call the model made: its id in the answer, the tool, and its arguments as JSON text. */
export interface ToolCall {
  id: string
  name: string
  args: string
}

/** B28.349 — what a tool answered: Lens's text, and whether it refused (the model is told either way). */
export interface ToolResult {
  text: string
  is_error: boolean
}

/** B28.349 — the tool spend questions are answered with: Lens's wallet_agents_spend (talyvor-lens B28.83). */
export const SPEND_TOOL = 'wallet_agents_spend'

/** B28.349 — one statement line a spend answer was read from: which agent, which entry, how much. */
export interface SpendLine {
  agent_id: string
  agent: string
  entry_id: string
  amount_ulxc: number
  at?: string
  /** B32.69 — a platform fee line's words as Lens wrote them, "Platform fee 3%". */
  label?: string
}

/**
 * B28.349 — the providers whose chat endpoint Lens passes a tool definition to as sent. Lens translates
 * Google's and Bedrock's request shapes, and a provider's own tool format is not part of that, so those
 * models are asked without tools rather than refused.
 */
export const TOOL_PROVIDERS: readonly string[] = ['openai', 'anthropic']

/** B28.349 — the tools this workspace's Lens offers Chat. A failed read offers none: Chat still answers. */
export async function fetchChatTools(): Promise<ChatTool[]> {
  const res = await fetch('/api/chat/tools', { credentials: 'same-origin' })
  if (!res.ok) return []
  const list = ((await res.json().catch(() => null)) as { tools?: unknown } | null)?.tools
  return Array.isArray(list)
    ? list.filter((t): t is ChatTool => typeof t?.name === 'string' && typeof t?.description === 'string' && typeof t?.input_schema === 'object')
    : []
}

/** B28.349 — runs one tool call through the BFF. Every failure is a result the model is told, never a throw. */
export async function callChatTool(call: ToolCall, signal?: AbortSignal): Promise<ToolResult> {
  let args: unknown
  try {
    args = call.args.trim() === '' ? {} : JSON.parse(call.args)
  } catch {
    return { text: 'The arguments were not valid JSON.', is_error: true }
  }
  try {
    const res = await fetch('/api/chat/tools/call', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ name: call.name, arguments: args }),
      signal,
    })
    const body = (await res.json().catch(() => ({}))) as { text?: unknown; is_error?: unknown; error?: unknown }
    if (!res.ok) return { text: typeof body.error === 'string' ? body.error : `The tool could not be run (${res.status}).`, is_error: true }
    return { text: typeof body.text === 'string' ? body.text : '', is_error: body.is_error === true }
  } catch {
    return { text: 'The tool could not be reached.', is_error: true }
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/**
 * B28.349 — the statement lines in what wallet_agents_spend answered, as Lens writes it:
 * {"agents": [{"agent_id", "name", "spent_ulxc", "lines": [{"entry_id", "kind", "amount_ulxc", "at"}]}]}, a platform fee line also carrying its "label".
 * A line without an entry cannot be linked to, so it is left out; text that is not that shape names none.
 */
export function spendLines(text: string): SpendLine[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  const agents = isObject(parsed) ? parsed.agents : undefined
  if (!Array.isArray(agents)) return []
  const out: SpendLine[] = []
  for (const a of agents) {
    if (!isObject(a) || typeof a.agent_id !== 'string' || !Array.isArray(a.lines)) continue
    const agent = typeof a.name === 'string' && a.name !== '' ? a.name : a.agent_id
    for (const l of a.lines) {
      if (!isObject(l) || typeof l.entry_id !== 'string' || l.entry_id === '' || typeof l.amount_ulxc !== 'number') continue
      out.push({
        agent_id: a.agent_id,
        agent,
        entry_id: l.entry_id,
        amount_ulxc: l.amount_ulxc,
        ...(typeof l.at === 'string' ? { at: l.at } : {}),
        ...(l.kind === 'platform_fee' && typeof l.label === 'string' && l.label !== '' ? { label: l.label } : {}),
      })
    }
  }
  return out
}

/** B28.349 — where a statement line is: Agent Wallets with its agent open and its row marked. */
export function statementLineHref(l: Pick<SpendLine, 'agent_id' | 'entry_id'>): string {
  return `/agents?${new URLSearchParams({ agent: l.agent_id, entry: l.entry_id }).toString()}`
}

/** An upload Lens refused or could not take, with the sentence to show. */
export class DocumentUploadError extends ApiError {
  constructor(
    status: number,
    readonly sentence: string,
  ) {
    super(status, '/api/documents')
    this.message = sentence
  }
}

/**
 * B18.24 — stores a document in Lens (up to 25 MB, through the BFF) and returns the id a question
 * references it by. The body is the file itself and its Content-Type the document's media type.
 */
export async function uploadDocument(file: File, mediaType: string): Promise<string> {
  const res = await fetch(`/api/documents?filename=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': mediaType, Accept: 'application/json' },
    body: file,
  })
  const answer = (await res.json().catch(() => ({}))) as { id?: unknown; error?: unknown }
  if (!res.ok) {
    const said = typeof answer.error === 'string' && res.status < 500 ? answer.error : 'Lens couldn’t store it just now.'
    throw new DocumentUploadError(res.status, said)
  }
  if (typeof answer.id !== 'string' || !answer.id.startsWith('tdoc_')) {
    throw new DocumentUploadError(res.status, 'Lens answered without a document id.')
  }
  return answer.id
}

/** Reads what Lens says converting the documents saved, or undefined when it said nothing. */
function distillSaved(headers: Headers): DistillSaved | undefined {
  const tokens = headers.get('X-Talyvor-Distill-Tokens-Saved')
  const bytes = headers.get('X-Talyvor-Distill-Bytes-Saved')
  if (tokens === null && bytes === null) return undefined
  const n = (v: string | null) => (v !== null && /^\d+$/.test(v) ? Number(v) : 0)
  return { tokens: n(tokens), bytes: n(bytes) }
}

/** B28.358 — a header's whole number, or undefined when it is absent or not one. */
function wholeHeader(headers: Headers, name: string): number | undefined {
  const v = headers.get(name)
  return v !== null && /^\d+$/.test(v) ? Number(v) : undefined
}

/** B28.358 — `{ saved_ulxc }` from a saving header, or nothing when Lens did not state one. */
function savedULXC(headers: Headers, name: string): { saved_ulxc?: number } {
  const n = wholeHeader(headers, name)
  return n === undefined ? {} : { saved_ulxc: n }
}

/** B28.358 — what Tare saved, or undefined when Lens did not trim the question. */
function tareSaved(headers: Headers): TareSaved | undefined {
  if (headers.get('X-Talyvor-Tare') !== 'applied') return undefined
  const tokens = wholeHeader(headers, 'X-Talyvor-Tare-Tokens-Saved')
  return tokens === undefined ? {} : { tokens }
}

/** Reads the deployment's catalog. Errors are the shared ApiError so the app-wide bar sees them. */
export async function fetchModels(): Promise<ChatModel[]> {
  const res = await fetch('/api/models', { credentials: 'same-origin' })
  if (!res.ok) throw new ApiError(res.status, '/api/models')
  return readableList<ChatModel>('/api/models', await res.json())
}

/**
 * B18.58 — the providers this deployment's Lens holds no key for; their models are not offered.
 *
 * ⚠ A FAILED READ HIDES NOTHING. The BFF names only what Lens refused (503 "not configured"), and a
 * read that fails leaves every provider listed: a question sent to an unconfigured one gets Lens's
 * own refusal, which is better than a working provider silently missing from the picker.
 */
export async function fetchUnconfiguredProviders(): Promise<string[]> {
  const res = await fetch('/api/ai/providers', { credentials: 'same-origin' })
  if (!res.ok) return []
  const body: unknown = await res.json()
  const list = (body as { unconfigured?: unknown } | null)?.unconfigured
  return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : []
}

/** How a provider is named in the picker. Presentation only — which providers exist is the catalog's. */
const PROVIDER_LABEL: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  bedrock: 'Amazon Bedrock',
  mistral: 'Mistral',
  groq: 'Groq',
  vllm: 'vLLM',
}

/** B18.60 — within one release date, the most capable first. */
const TIER_RANK: Record<string, number> = { frontier: 3, balanced: 2, fast: 1 }

/**
 * B18.60 — newest release first, from the catalog's release_date (Lens B18.12), never a number parsed
 * from a name; within one day the higher tier, then the higher output price. A model without a date
 * sorts last.
 */
function newestFirst(a: ChatModel, b: ChatModel): number {
  return (
    (b.release_date ?? '').localeCompare(a.release_date ?? '') ||
    (TIER_RANK[b.tier ?? ''] ?? 0) - (TIER_RANK[a.tier ?? ''] ?? 0) ||
    b.output_per_1m - a.output_per_1m ||
    a.display_name.localeCompare(b.display_name)
  )
}

export interface CatalogGroup {
  provider: string
  label: string
  /** False when this client cannot read the provider's stream: listed, never selectable. */
  streamable: boolean
  models: ChatModel[]
}

export interface PickerCatalog {
  groups: CatalogGroup[]
  /** Every model a conversation can use, in picker order. */
  offered: ChatModel[]
  /** Catalog entries that are not chat models (no output price, e.g. embeddings) or are retired. */
  omitted: number
  /** B18.58 — chat models on providers this deployment's Lens holds no key for: not listed. */
  unconfigured: number
  /** The newest frontier model among the offered ones (else the newest) — the default, from the catalog's fields. */
  defaultModel: ChatModel | undefined
  /** B28.363 — the Auto choice, when anything is offered. */
  auto: ChatModel | undefined
}

/**
 * B10.4 — the whole catalog, as the picker shows it: every priced chat model, grouped by provider,
 * newest first.
 *
 * ⚠ MODELS THIS CLIENT CANNOT STREAM ARE LISTED, NOT HIDDEN — disabled, with the reason, so the
 * picker shows everything the deployment prices and a model becomes usable the day Lens streams its
 * provider. ⚠ A CATALOG ENTRY WITH NO OUTPUT PRICE IS NOT A CHAT MODEL (embeddings), and a
 * deprecated one is retired at the provider; both are counted rather than silently dropped.
 * ⚠ A MODEL ON A PROVIDER LENS HOLDS NO KEY FOR IS NOT LISTED (Lens answers 503 for it), and it is
 * counted too.
 */
export function pickerCatalog(all: ChatModel[], unconfiguredProviders: readonly string[] = []): PickerCatalog {
  const priced = all.filter((m) => !m.deprecated && m.output_per_1m > 0)
  const chat = priced.filter((m) => !unconfiguredProviders.includes(m.provider))
  const byProvider = new Map<string, ChatModel[]>()
  for (const m of chat) byProvider.set(m.provider, [...(byProvider.get(m.provider) ?? []), m])
  const groups: CatalogGroup[] = [...byProvider.entries()]
    .map(([provider, models]) => ({
      provider,
      label: PROVIDER_LABEL[provider] ?? provider,
      streamable: STREAMABLE_PROVIDERS.includes(provider),
      models: [...models].sort(newestFirst),
    }))
    .sort(
      (a, b) =>
        Number(b.streamable) - Number(a.streamable) ||
        (a.streamable ? STREAMABLE_PROVIDERS.indexOf(a.provider) - STREAMABLE_PROVIDERS.indexOf(b.provider) : 0) ||
        a.label.localeCompare(b.label),
    )
  const offered = groups.filter((g) => g.streamable).flatMap((g) => g.models)
  return {
    groups,
    offered,
    omitted: all.length - priced.length,
    unconfigured: priced.length - chat.length,
    defaultModel: [...offered].filter((m) => m.tier === 'frontier').sort(newestFirst)[0] ?? [...offered].sort(newestFirst)[0],
    auto: autoChoice(offered),
  }
}

/** A model's list price for an answer as long as its question, the yardstick "cheapest" is measured by. */
const listRate = (m: ChatModel) => m.input_per_1m + m.output_per_1m

/**
 * B28.363 — the Auto choice: asked on the provider of the cheapest model offered, where Lens picks the cheapest model
 * that answers well. Until the stream names that model it is priced at the provider's dearest offered model, so an
 * answer is never priced below what it may have cost.
 */
export function autoChoice(offered: readonly ChatModel[]): ChatModel | undefined {
  const cheapest = [...offered].sort((a, b) => listRate(a) - listRate(b))[0]
  if (cheapest === undefined) return undefined
  const dearest = offered.filter((m) => m.provider === cheapest.provider).sort((a, b) => listRate(b) - listRate(a))[0]
  return {
    id: AUTO_MODEL_ID,
    provider: cheapest.provider,
    display_name: AUTO_MODEL_NAME,
    input_per_1m: dearest.input_per_1m,
    output_per_1m: dearest.output_per_1m,
    auto: { cheapest, dearest },
  }
}

/** The longest answer Chat asks Anthropic and Bedrock for, in tokens — B28.99 prices a long answer at it. */
export const CHAT_MAX_TOKENS = 4096

/**
 * The request body each provider's chat endpoint expects.
 *
 * ⚠ ANTHROPIC REQUIRES max_tokens AND OPENAI DOES NOT. Omitting it is a 400 from Anthropic, which
 * would arrive as a dead stream with no frames — the hardest failure to read from a chat screen.
 * Bedrock serves Anthropic's models and Lens fills in 1024 when it is absent, which cuts long
 * answers short, so it is sent there too.
 */
function requestBody(provider: string, model: string, turns: ChatMessage[], tools: ChatTool[] = [], exchange: unknown[] = [], instructions = '', prompt = ''): unknown {
  // ⚠ ONLY role AND content GO UPSTREAM. A turn carries its cost for the screen, and Anthropic
  // refuses a message with a field it does not know.
  // B28.78 — and never an answer that said nothing. A stopped, failed or blank answer stays in the
  // conversation as an empty assistant turn, and Anthropic refuses the whole request over it, so
  // every later question in that chat failed until a reload. The two questions either side of it are
  // read by Anthropic as one turn.
  const said = turns.filter((t) => t.role !== 'assistant' || t.content.trim() !== '')
  const messages = said.map(({ role, content, attachments }) => {
    const docs = (attachments ?? []).filter((a) => a.file_id !== undefined)
    if (docs.length === 0) return { role, content }
    // ⚠ THE TWO SHAPES LENS READS AN UPLOADED DOCUMENT FROM (talyvor-lens B18.13): Anthropic's
    // `document` block with a `file` source and OpenAI's `file` part, each naming the tdoc_ id. Lens
    // replaces each with the document's text before the model sees it — the id means nothing to a
    // provider, so it always converts.
    if (provider === 'anthropic') {
      return {
        role,
        content: [
          ...docs.map((d) => ({ type: 'document', source: { type: 'file', file_id: d.file_id } })),
          { type: 'text', text: content },
        ],
      }
    }
    return {
      role,
      content: [{ type: 'text', text: content }, ...docs.map((d) => ({ type: 'file', file: { file_id: d.file_id } }))],
    }
  })
  // B28.349 — the tool calls this question has made so far and what they answered, in the provider's shape.
  messages.push(...(exchange as typeof messages))
  const offered =
    tools.length === 0
      ? {}
      : provider === 'anthropic'
        ? { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })) }
        : { tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })) }
  // B28.109 — a project's instructions: Anthropic's own `system` field (Bedrock serves Anthropic's models), and a
  // system message first everywhere else. None, and the body is exactly what it was before projects.
  // B28.370 — a named prompt goes by name, first: a system message of exactly "lens:prompt:<name>", which Lens swaps
  // for the prompt's text. With instructions too, Anthropic's `system` is two text blocks, the prompt's first.
  const told = instructions.trim()
  const named = prompt === '' ? '' : promptReference(prompt)
  const systems = [named, told].filter((s) => s !== '')
  if (provider === 'anthropic' || provider === 'bedrock') {
    const system = systems.length === 0 ? {} : { system: systems.length === 1 ? systems[0] : systems.map((text) => ({ type: 'text', text })) }
    return { model, max_tokens: CHAT_MAX_TOKENS, stream: true, ...system, messages, ...offered }
  }
  return { model, stream: true, messages: [...systems.map((content) => ({ role: 'system', content })), ...messages], ...offered }
}

/** B28.349 — a tool call's arguments as the object Anthropic's tool_use block carries. */
function inputOf(c: ToolCall): unknown {
  try {
    const v: unknown = JSON.parse(c.args)
    return isObject(v) ? v : {}
  } catch {
    return {}
  }
}

/** B28.349 — the model's tool calls and what they answered, as the next request carries them. */
function toolTurns(provider: string, said: string, calls: ToolCall[], results: ToolResult[]): unknown[] {
  if (provider === 'anthropic') {
    return [
      {
        role: 'assistant',
        content: [
          ...(said.trim() !== '' ? [{ type: 'text', text: said }] : []),
          ...calls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: inputOf(c) })),
        ],
      },
      {
        role: 'user',
        content: calls.map((c, i) => ({ type: 'tool_result', tool_use_id: c.id, content: results[i].text, ...(results[i].is_error ? { is_error: true } : {}) })),
      },
    ]
  }
  return [
    {
      role: 'assistant',
      content: said.trim() !== '' ? said : null,
      tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args.trim() === '' ? '{}' : c.args } })),
    },
    ...calls.map((c, i) => ({ role: 'tool', tool_call_id: c.id, content: results[i].text })),
  ]
}

export interface StreamHandlers {
  /** Called with each text delta as it arrives. */
  onDelta: (text: string) => void
  /** Called once when the stream ends. `unrecognised` is frames this parser could not read;
   *  `usage` and `model` are what the provider reported, when it did; `converted` is Lens saying it
   *  turned an attached document into text (X-Talyvor-Distill: applied). */
  onDone: (info: {
    unrecognised: number
    usage?: Usage
    model?: string
    converted: boolean
    source?: AnswerSource
    /** B18.24 — what the conversion saved, when Lens said. */
    saved?: DistillSaved
    /** B28.358 — Tare trimmed the question; for askChat, every request the answer took, added. */
    tare?: TareSaved
    /** B23.12 — Lens's id for this request, when it said. */
    requestId?: string
    /** B28.81 — why the model stopped, as the provider named it (chatStream.ts), when it said. */
    finish?: string
    /** B28.349 — the tools the model called in this answer, whole, in the order it made them. */
    toolCalls?: ToolCall[]
    /** B28.349 — askChat: the statement lines Lens's wallet tool read the answer from. */
    spend?: SpendLine[]
    /** B28.349 — askChat: how many requests to the model the answer took, when more than one. */
    requests?: number
    /** B28.354 — the agent Lens says it billed for the answer (X-Talyvor-Paid-By); absent when the workspace paid. */
    paidBy?: string
    /** B28.362 — what Lens charged for the answer, in µLXC, when it said; for askChat, every request the answer took,
     *  added, and only when Lens said for each. */
    chargedULXC?: number
    /** B28.370 — Lens said it swapped the conversation's named prompt in (X-Talyvor-Prompt-Resolved: true). */
    promptResolved?: boolean
    /** B28.372 — the pages Lens searched and gave the model, when it said; for askChat, the last request's that said. */
    citations?: Citation[]
    /** B28.373 — the code the model ran in Lens's sandbox, in order; for askChat, every request's. */
    codeRuns?: CodeRun[]
  }) => void
  /** A server-reported error inside the stream, or a transport failure; `remedy` when a refusal has one here. */
  onError: (message: string, remedy?: Remedy) => void
}

/**
 * streamChat POSTs one turn and drives the SSE reader.
 *
 * ⚠ IT READS THE BODY AS A STREAM, WHICH IS THE ENTIRE POINT. `await res.text()` on this response
 * produces the identical final string, and a screen built on it looks correct in every assertion
 * that reads the finished DOM. The relay in front of it was built specifically to flush — step 3's
 * own note records that a buffering relay and a flushing one have byte-identical output, and that
 * only a positive control caught it. Chat.test.tsx asserts PARTIAL text before the stream ends.
 *
 * ⚠ A NON-2xx IS READ AS TEXT, NOT AS A STREAM. The BFF answers its own failures as JSON with a
 * status, and trying to parse those as SSE yields "the model said nothing".
 */
export async function streamChat(
  provider: string,
  model: string,
  messages: ChatMessage[],
  handlers: StreamHandlers,
  signal?: AbortSignal,
  /** B15.6 — ask the model afresh rather than be served a cached answer (Regenerate). */
  fresh = false,
  /** B28.349 — the tools the model may call, and the calls made so far and their answers. */
  tools: ChatTool[] = [],
  exchange: unknown[] = [],
  /** B28.354 — the agent whose wallet pays for this request; none, the workspace's. */
  paidBy?: string,
  /** B28.361 — the conversation this request is part of, and its budget. */
  conversation?: ConversationTag,
): Promise<void> {
  const path = chatPath(provider)
  if (path === undefined) {
    // Unreachable from the picker, which only offers STREAMABLE_PROVIDERS. Stated rather than
    // assumed: a caller that names another provider gets a refusal, not an empty reply.
    handlers.onError(`No chat path is known for provider "${provider}".`)
    return
  }

  const init: RequestInit = {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      // A document in the turn asks Lens to convert it, so a workspace on `opt_in` converts too.
      ...(messages.some((m) => m.attachments?.some((a) => a.file_id !== undefined)) ? { 'X-Talyvor-Distill': 'true' } : {}),
      ...(fresh ? { 'X-Talyvor-Cache': 'bypass' } : {}),
      ...(paidBy !== undefined && paidBy !== '' ? { [PAID_BY_HEADER]: paidBy } : {}),
      ...(conversation !== undefined ? { [CONVERSATION_HEADER]: conversation.id } : {}),
      ...(conversation?.budget_ulxc !== undefined ? { [CONVERSATION_BUDGET_HEADER]: String(conversation.budget_ulxc) } : {}),
      [REPORT_CHARGE_HEADER]: 'true',
      ...(conversation?.web_search === true ? { [WEB_SEARCH_HEADER]: 'on' } : {}),
      ...(conversation?.run_code === true ? { [RUN_CODE_HEADER]: 'on' } : {}),
    },
    body: JSON.stringify(requestBody(provider, model, messages, tools, exchange, conversation?.instructions, conversation?.prompt)),
    signal,
  }

  let res: Response
  let detail = ''
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(`/api/ai/stream/${provider}/${path}`, init)
    } catch (e) {
      if (signal?.aborted) return
      handlers.onError(e instanceof Error ? e.message : 'The request could not be sent.')
      return
    }
    if (res.ok) break
    detail = await res.text().catch(() => '')
    // B27.5 — Lens could not CHECK the session (a database hiccup). The person is still signed in,
    // so the turn is sent again, quietly, after the wait Lens asked for.
    if (!sessionCheckFailed(res.status, detail) || attempt === SESSION_CHECK_RETRIES) break
    if (!(await waitToRetry(retryAfterMs(res.headers.get('Retry-After')), signal))) return
  }

  if (!res.ok) {
    const r = refusal(res.status, detail)
    handlers.onError(r.text, r.remedy)
    return
  }

  const body = res.body
  if (body === null) {
    handlers.onError('The response carried no body.')
    return
  }

  const converted = res.headers.get('X-Talyvor-Distill') === 'applied'
  const saved = converted ? distillSaved(res.headers) : undefined
  const source = answerSource(res.headers)
  const tare = tareSaved(res.headers)
  const requestId = res.headers.get('X-Talyvor-Request-ID') ?? undefined
  const paidByLens = res.headers.get(PAID_BY_HEADER) ?? undefined
  const promptResolved = res.headers.get(PROMPT_RESOLVED_HEADER) === 'true'
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let unrecognised = 0
  let usage: Usage | undefined
  let served: string | undefined
  let finish: string | undefined
  let charged: number | undefined
  let citations: Citation[] | undefined
  const codeRuns: CodeRun[] = []
  // B28.349 — the tool calls arriving in pieces, by their index in the answer.
  const pieces = new Map<number, ToolCall>()
  const gather = (p: ToolCallPiece) => {
    const c = pieces.get(p.index) ?? { id: '', name: '', args: '' }
    pieces.set(p.index, { id: p.id || c.id, name: p.name || c.name, args: c.args + p.args })
  }
  const toolCalls = () => {
    const calls = [...pieces.entries()].sort(([a], [b]) => a - b).map(([, c]) => c).filter((c) => c.name !== '')
    return calls.length > 0 ? calls : undefined
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const split = splitFrames(buffer)
      buffer = split.rest
      for (const frame of split.frames) {
        const got = extractDeltas(frame)
        unrecognised += got.unrecognised
        usage = mergeUsage(usage, got.usage)
        served = got.model ?? served
        finish = got.finish ?? finish
        charged = got.charged_ulxc ?? charged
        citations = got.citations ?? citations
        codeRuns.push(...(got.codeRuns ?? []))
        if (got.error !== undefined) {
          handlers.onError(got.error)
          return
        }
        for (const d of got.deltas) handlers.onDelta(d.text)
        for (const p of got.toolCalls ?? []) gather(p)
        if (got.done) {
          handlers.onDone({ unrecognised, usage, model: served, converted, source, saved, tare, requestId, finish, toolCalls: toolCalls(), paidBy: paidByLens, chargedULXC: charged, promptResolved, citations, codeRuns })
          return
        }
      }
    }
  } catch (e) {
    if (signal?.aborted) return
    handlers.onError(e instanceof Error ? e.message : 'The stream ended unexpectedly.')
    return
  }

  // ⚠ THE STREAM ENDED WITHOUT ITS TERMINATOR. That is not the same as a clean finish and is not
  // reported as one: it is what a truncated relay, a killed upstream or a 10s client timeout look
  // like. Step 3 found exactly that shape (a whole-exchange Timeout guillotining long completions),
  // so a chat screen that rendered it as a finished answer would hide the defect it was built after.
  handlers.onDone({ unrecognised, usage, model: served, converted, source, saved, tare, requestId, finish, toolCalls: toolCalls(), paidBy: paidByLens, chargedULXC: charged, promptResolved, citations, codeRuns })
}

/** B28.349 — how many times one question may go to the model: the tools' answers go back at most twice. */
const MAX_TOOL_ROUNDS = 3

/** B28.358 — what Tare saved on two requests that answered one question, added; a count Lens did not state stays unstated. */
function addTare(a: TareSaved | undefined, b: TareSaved | undefined): TareSaved | undefined {
  if (a === undefined || b === undefined) return a ?? b
  return a.tokens === undefined || b.tokens === undefined ? {} : { tokens: a.tokens + b.tokens }
}

/** Token counts of two requests that answered one question, added. */
function addUsage(a: Usage | undefined, b: Usage | undefined): Usage | undefined {
  if (a === undefined || b === undefined) return a ?? b
  return { input_tokens: (a.input_tokens ?? 0) + (b.input_tokens ?? 0), output_tokens: (a.output_tokens ?? 0) + (b.output_tokens ?? 0) }
}

/**
 * B28.349 — asks one question with Lens's wallet tools on offer: "what did my agents spend?" is answered
 * from the agents' own statements. When the model calls a tool, the call runs through the BFF (only
 * read-only tools — apps/bff/chat_tools.go), its answer goes back to the model, and the model answers
 * from it. The text of every round streams into the one answer, its tokens are priced together, and the
 * statement lines the wallet tool read are handed to the screen to link. With no tools, or a provider
 * that takes none (TOOL_PROVIDERS), it is streamChat.
 */
export async function askChat(
  provider: string,
  model: string,
  messages: ChatMessage[],
  handlers: StreamHandlers,
  signal?: AbortSignal,
  fresh = false,
  tools: ChatTool[] = [],
  /** B28.354 — the agent whose wallet pays for every request this question takes. */
  paidBy?: string,
  /** B28.361 — the conversation every request this question takes is part of, and its budget. */
  conversation?: ConversationTag,
): Promise<void> {
  const offered = TOOL_PROVIDERS.includes(provider) ? tools : []
  let exchange: unknown[] = []
  // B28.354 — the agent Lens billed: named only when every request the question took named the same one.
  let billed: string | undefined | null = null
  let usage: Usage | undefined
  let tare: TareSaved | undefined
  // B28.362 — what Lens charged for the requests so far; unknown once one of them went unsaid.
  let charged: number | undefined = 0
  let unrecognised = 0
  let written = false
  // B28.372 — the pages Lens last said it searched, over every request the question took.
  let citations: Citation[] | undefined
  // B28.373 — the code the model ran, over every request the question took.
  const codeRuns: CodeRun[] = []
  const spend: SpendLine[] = []
  for (let round = 1; ; round++) {
    let said = ''
    let ended: Parameters<StreamHandlers['onDone']>[0] | undefined
    await streamChat(
      provider,
      model,
      messages,
      {
        onDelta: (text) => {
          // A round's text starts a paragraph of its own after what an earlier round said.
          if (said === '' && written) handlers.onDelta('\n\n')
          said += text
          handlers.onDelta(text)
        },
        onDone: (info) => {
          ended = info
        },
        onError: handlers.onError,
      },
      signal,
      fresh,
      offered,
      exchange,
      paidBy,
      conversation,
    )
    // Failed (already said) or stopped.
    if (ended === undefined) return
    const done: Parameters<StreamHandlers['onDone']>[0] = ended
    written ||= said !== ''
    usage = addUsage(usage, done.usage)
    tare = addTare(tare, done.tare)
    charged = charged === undefined || done.chargedULXC === undefined ? undefined : charged + done.chargedULXC
    unrecognised += done.unrecognised
    citations = done.citations ?? citations
    codeRuns.push(...(done.codeRuns ?? []))
    billed = billed === null || billed === done.paidBy ? done.paidBy : undefined
    const calls = done.toolCalls ?? []
    if (calls.length === 0 || round === MAX_TOOL_ROUNDS) {
      handlers.onDone({ ...done, usage, tare, unrecognised, chargedULXC: charged, citations, codeRuns, paidBy: billed ?? undefined, ...(spend.length > 0 ? { spend } : {}), ...(round > 1 ? { requests: round } : {}) })
      return
    }
    const results = await Promise.all(calls.map((c) => callChatTool(c, signal)))
    if (signal?.aborted) return
    calls.forEach((c, i) => {
      if (c.name !== SPEND_TOOL || results[i].is_error) return
      for (const l of spendLines(results[i].text)) {
        if (!spend.some((s) => s.agent_id === l.agent_id && s.entry_id === l.entry_id)) spend.push(l)
      }
    })
    exchange = [...exchange, ...toolTurns(provider, said, calls, results)]
  }
}

/**
 * B23.12 — marks an answer wrong: Lens removes the stored answer that request was served, from this
 * workspace's cache and the shared pool, so nobody is served it again. Throws when that did not happen.
 */
export async function markAnswerWrong(requestId: string): Promise<void> {
  const res = await fetch('/api/ai/feedback', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ request_id: requestId, signal: 'negative' }),
  })
  if (!res.ok) throw new ApiError(res.status, '/api/ai/feedback')
}

/**
 * B15.6 — where the answer came from. A pooled serve is replayed too, so the pool's headers are read
 * first; an own-cache replay carries no price headers because it is free. B27.27 — a BYOK workspace's
 * answer the model wrote on its own key carries X-Talyvor-BYOK: own-key and was charged no tokens.
 */
function answerSource(h: Headers): AnswerSource | undefined {
  const rate = Number(h.get('X-Talyvor-Pool-Discount-Rate') ?? NaN)
  const charged = Number(h.get('X-Talyvor-Pool-Charged-ULXC') ?? NaN)
  if (Number.isFinite(rate) && Number.isFinite(charged)) {
    return { kind: 'pool', discount_rate: rate, charged_ulxc: charged, ...savedULXC(h, 'X-Talyvor-Pool-Saved-ULXC') }
  }
  if (h.get('X-Talyvor-Cache-Replay') === 'true') return { kind: 'cache', ...savedULXC(h, 'X-Talyvor-Cache-Saved-ULXC') }
  if (h.get('X-Talyvor-BYOK') === 'own-key') return { kind: 'own_key' }
  return undefined
}

/** B27.5 — how many times a turn is sent again while Lens cannot check the session. */
const SESSION_CHECK_RETRIES = 3

/**
 * B27.5 — Lens's 503 for "your session could not be checked just now" (talyvor-lens internal/auth,
 * code `auth_unavailable`). It is NOT a sign-out and NOT the provider's "not configured" 503 on the
 * same route, and the code is the only thing that tells them apart.
 */
function sessionCheckFailed(status: number, detail: string): boolean {
  if (status !== 503) return false
  try {
    return (JSON.parse(detail) as { code?: unknown }).code === 'auth_unavailable'
  } catch {
    return false
  }
}

/** Retry-After in seconds → ms, bounded to 10s; 2s when Lens did not say. */
function retryAfterMs(header: string | null): number {
  const secs = Number(header ?? NaN)
  if (header === null || header.trim() === '' || !Number.isFinite(secs) || secs < 0) return 2000
  return Math.min(secs, 10) * 1000
}

/** Waits ms; false if the turn was stopped meanwhile, so nothing is sent for a closed question. */
function waitToRetry(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false)
    const timer = setTimeout(() => resolve(true), ms)
    // Chat aborts the turn on unmount, so this is the timer's unmount cleanup too.
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(false) }, { once: true })
  })
}

/** B28.348 — what fixes a refusal: a screen in this app, or a fresh chat. */
export type Remedy = { label: string; to: string } | { label: string; action: 'new_chat' }

/** B28.348 — a refusal as the person reads it: the sentence, and what to do about it when this app can help. */
export interface Refusal {
  text: string
  remedy?: Remedy
}

/**
 * B28.348 — the refusals Lens tells apart, by the `code` it puts beside `error` in the JSON body
 * (`{"error": "...", "code": "spending_cap"}`). B28.82 adds the codes on the Lens side; until a Lens
 * names one, the same refusal is recognised by the sentence Lens writes for it today (REFUSAL_TEXT).
 */
export const REFUSAL_CODES = [
  'spending_cap',
  'budget_exceeded',
  'allowance_exhausted',
  'session_limit',
  'conversation_budget',
  'guardrail_blocked',
  'provider_overloaded',
  'workspace_rate_limited',
] as const
export type RefusalCode = (typeof REFUSAL_CODES)[number]

/** Lens's own sentences for the same refusals, before it names a code (talyvor-lens internal/proxy). */
const REFUSAL_TEXT: [RegExp, RefusalCode][] = [
  [/^spending cap reached/i, 'spending_cap'],
  [/^budget exceeded/i, 'budget_exceeded'],
  [/plan allowance is used up/i, 'allowance_exhausted'],
  [/chat session has reached its spending limit/i, 'session_limit'],
  [/^this conversation has reached its budget/i, 'conversation_budget'],
  [/^guardrail violation/i, 'guardrail_blocked'],
  [/^rate limit reached: this workspace allows/i, 'workspace_rate_limited'],
  [/overloaded/i, 'provider_overloaded'],
]

interface RefusalBody {
  error?: unknown
  code?: unknown
  violations?: { type?: unknown }[]
}

function refusalBody(detail: string): RefusalBody {
  try {
    const parsed: unknown = JSON.parse(detail)
    return parsed !== null && typeof parsed === 'object' ? (parsed as RefusalBody) : {}
  } catch {
    return {}
  }
}

/** Which of Lens's refusals this is: the code it named, else the sentence it wrote, else none. */
export function refusalCode(status: number, detail: string): RefusalCode | undefined {
  const body = refusalBody(detail)
  if ((REFUSAL_CODES as readonly unknown[]).includes(body.code)) return body.code as RefusalCode
  if (status === 529) return 'provider_overloaded' // Anthropic's "overloaded", relayed as sent
  const said = typeof body.error === 'string' ? body.error : detail
  return REFUSAL_TEXT.find(([re]) => re.test(said))?.[1]
}

const BILLING: Remedy = { label: 'Billing', to: '/billing' }
const FEATURES: Remedy = { label: 'Features', to: '/features' }

/**
 * refusal turns a status and Lens's body into a sentence that names the next action.
 *
 * ⚠ 402 IS NOT ONE THING. Lens answers 402 for a spending cap, a budget, a used-up allowance, a
 * chat session's limit and an empty balance, and only the last two are fixed by topping up. Each
 * reads as itself (B28.348); "Top up on Billing" is for credit alone.
 */
export function refusal(status: number, detail: string): Refusal {
  switch (refusalCode(status, detail)) {
    case 'spending_cap':
      return { text: 'This workspace has reached its monthly spending cap, so nothing was sent. A workspace admin can raise the cap to continue.' }
    case 'budget_exceeded':
      return { text: 'A spending limit on this workspace, team or sprint is used up, so nothing was sent. Raise it or switch it off on Features.', remedy: FEATURES }
    case 'allowance_exhausted':
      return { text: 'This period’s plan allowance is used up and prepaid credit does not cover the request. Top up on Billing to continue.', remedy: BILLING }
    case 'session_limit':
      return { text: 'This chat has spent the most one chat may. Start a new chat to continue.', remedy: { label: 'Start a new chat', action: 'new_chat' } }
    case 'conversation_budget':
      return { text: 'Sending that would take this chat past the budget set on it, so nothing was sent. Raise the budget under the box, or start a new chat.', remedy: { label: 'Start a new chat', action: 'new_chat' } }
    case 'guardrail_blocked': {
      const kinds = [...new Set((refusalBody(detail).violations ?? []).map((v) => v.type).filter((t): t is string => typeof t === 'string' && t !== ''))]
      const named = kinds.length > 0 ? ` (${kinds.join(', ')})` : ''
      return { text: `This workspace’s guardrails blocked that message${named}. Remove the flagged content and send it again; guardrails are set on Features.`, remedy: FEATURES }
    }
    case 'provider_overloaded':
      return { text: 'The model’s provider is overloaded right now. Send it again in a moment, or pick another model.' }
    case 'workspace_rate_limited':
      return { text: 'This workspace has reached its own rate limit. Wait a minute and send it again, or ask a workspace admin to raise the limit.' }
  }
  if (status === 401) return { text: 'This session is no longer signed in. Sign in again to continue.' }
  if (status === 402) return { text: 'This workspace cannot cover the estimated cost of that request. Top up on Billing.', remedy: BILLING }
  if (status === 429) return { text: 'The provider is rate limiting this workspace. Try again shortly.' }
  if (sessionCheckFailed(status, detail)) return { text: 'Lens could not check this session just now. You are still signed in — send it again in a moment.' }
  if (status === 503 && /not configured/i.test(detail)) return { text: 'Chat is not configured on this deployment.' }
  if (status === 503) return { text: 'The model’s provider is unavailable right now. Send it again in a moment, or pick another model.' }
  const trimmed = detail.trim()
  return {
    text: trimmed === '' ? `The request was refused (${status}).` : `The request was refused (${status}): ${trimmed}`,
  }
}
