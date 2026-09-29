import { ApiError } from '../../lib/api'
import { type Usage, extractDeltas, mergeUsage, splitFrames } from './chatStream'
import type { AnswerCost, AnswerSource } from './price'

// chatApi.ts — the wire for W4.6.1 step 6.
//
// Three reads and one write, all through the BFF:
//   GET  /api/models                      the deployment's catalog (Lens /v1/catalog/models)
//   GET  /api/ai/providers                the providers Lens holds no key for (B18.58)
//   POST /api/ai/stream/{provider}/{path} the flushing SSE relay built in step 3
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
}

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
  /** B23.12 — on an answer: Lens's id for the request that produced it (X-Talyvor-Request-ID), which a
   *  thumbs-down names it by. */
  request_id?: string
  /** B23.12 — this answer was marked wrong, and Lens removed it so it is not served again. */
  marked_wrong?: boolean
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

/** Reads the deployment's catalog. Errors are the shared ApiError so the app-wide bar sees them. */
export async function fetchModels(): Promise<ChatModel[]> {
  const res = await fetch('/api/models', { credentials: 'same-origin' })
  if (!res.ok) throw new ApiError(res.status, '/api/models')
  const body: unknown = await res.json()
  return Array.isArray(body) ? (body as ChatModel[]) : []
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
  }
}

/**
 * The request body each provider's chat endpoint expects.
 *
 * ⚠ ANTHROPIC REQUIRES max_tokens AND OPENAI DOES NOT. Omitting it is a 400 from Anthropic, which
 * would arrive as a dead stream with no frames — the hardest failure to read from a chat screen.
 * Bedrock serves Anthropic's models and Lens fills in 1024 when it is absent, which cuts long
 * answers short, so it is sent there too.
 */
function requestBody(provider: string, model: string, turns: ChatMessage[]): unknown {
  // ⚠ ONLY role AND content GO UPSTREAM. A turn carries its cost for the screen, and Anthropic
  // refuses a message with a field it does not know.
  const messages = turns.map(({ role, content, attachments }) => {
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
  if (provider === 'anthropic' || provider === 'bedrock') {
    return { model, max_tokens: 4096, stream: true, messages }
  }
  return { model, stream: true, messages }
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
    /** B23.12 — Lens's id for this request, when it said. */
    requestId?: string
  }) => void
  /** A server-reported error inside the stream, or a transport failure. */
  onError: (message: string) => void
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
): Promise<void> {
  const path = chatPath(provider)
  if (path === undefined) {
    // Unreachable from the picker, which only offers STREAMABLE_PROVIDERS. Stated rather than
    // assumed: a caller that names another provider gets a refusal, not an empty reply.
    handlers.onError(`No chat path is known for provider "${provider}".`)
    return
  }

  let res: Response
  try {
    res = await fetch(`/api/ai/stream/${provider}/${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        // A document in the turn asks Lens to convert it, so a workspace on `opt_in` converts too.
        ...(messages.some((m) => m.attachments?.some((a) => a.file_id !== undefined)) ? { 'X-Talyvor-Distill': 'true' } : {}),
        ...(fresh ? { 'X-Talyvor-Cache': 'bypass' } : {}),
      },
      body: JSON.stringify(requestBody(provider, model, messages)),
      signal,
    })
  } catch (e) {
    if (signal?.aborted) return
    handlers.onError(e instanceof Error ? e.message : 'The request could not be sent.')
    return
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    handlers.onError(refusalMessage(res.status, detail))
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
  const requestId = res.headers.get('X-Talyvor-Request-ID') ?? undefined
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let unrecognised = 0
  let usage: Usage | undefined
  let served: string | undefined

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
        if (got.error !== undefined) {
          handlers.onError(got.error)
          return
        }
        for (const d of got.deltas) handlers.onDelta(d.text)
        if (got.done) {
          handlers.onDone({ unrecognised, usage, model: served, converted, source, saved, requestId })
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
  handlers.onDone({ unrecognised, usage, model: served, converted, source, saved, requestId })
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
 * first; an own-cache replay carries no price headers because it is free.
 */
function answerSource(h: Headers): AnswerSource | undefined {
  const rate = Number(h.get('X-Talyvor-Pool-Discount-Rate') ?? NaN)
  const charged = Number(h.get('X-Talyvor-Pool-Charged-ULXC') ?? NaN)
  if (Number.isFinite(rate) && Number.isFinite(charged)) return { kind: 'pool', discount_rate: rate, charged_ulxc: charged }
  if (h.get('X-Talyvor-Cache-Replay') === 'true') return { kind: 'cache' }
  return undefined
}

/**
 * refusalMessage turns a status into a sentence that names the next action.
 *
 * ⚠ 402 IS NOT "SOMETHING WENT WRONG". Lens answers 402 when the workspace cannot cover the
 * estimated cost, and that has a specific remedy on a specific screen in this app.
 */
function refusalMessage(status: number, detail: string): string {
  if (status === 401) return 'This session is no longer signed in. Sign in again to continue.'
  if (status === 402) return 'This workspace cannot cover the estimated cost of that request. Top up on Billing.'
  if (status === 429) return 'The provider is rate limiting this workspace. Try again shortly.'
  if (status === 503) return 'Chat is not configured on this deployment.'
  const trimmed = detail.trim()
  return trimmed === ''
    ? `The request was refused (${status}).`
    : `The request was refused (${status}): ${trimmed}`
}
