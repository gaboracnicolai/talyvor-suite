import { ApiError } from '../../lib/api'
import { type Usage, extractDeltas, mergeUsage, splitFrames } from './chatStream'
import type { AnswerCost, AnswerSource } from './price'

// chatApi.ts — the wire for W4.6.1 step 6.
//
// Two reads and one write, all through the BFF:
//   GET  /api/models                      the deployment's catalog (Lens /v1/catalog/models)
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
}

/**
 * STREAMABLE_PROVIDERS — the providers whose STREAM this client can honestly read.
 *
 * ⚠ MEASURED IN talyvor-lens, NOT CHOSEN. Its streaming dispatch is
 * `if cfg.ProviderName() == "openai" { ServeOpenAI } else { ServeAnthropic }` — there are exactly
 * TWO SSE writers. The BFF's relay allowlist is wider (openai, anthropic, google, bedrock, mistral,
 * groq, vllm), and that width is correct for the RELAY, which is shape-agnostic and just copies
 * bytes. It is not correct for a PARSER.
 *
 * ⚠ SO THE PICKER IS NARROWER THAN THE CATALOG ON PURPOSE, AND THE SCREEN SAYS SO. The item asks
 * for "every frontier model"; the measured truth today is two provider families, and offering a
 * third would put a model in front of a person that this parser would render as an empty answer.
 * Widening this set is a change in Lens — a third SSE writer — not a change here.
 */
export const STREAMABLE_PROVIDERS: readonly string[] = ['openai', 'anthropic']

/** The upstream path each provider's chat endpoint lives at, under Lens's /v1/proxy/{provider}/. */
const CHAT_PATH: Record<string, string> = {
  openai: 'v1/chat/completions',
  anthropic: 'v1/messages',
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
  data?: string
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
}

/** Reads the deployment's catalog. Errors are the shared ApiError so the app-wide bar sees them. */
export async function fetchModels(): Promise<ChatModel[]> {
  const res = await fetch('/api/models', { credentials: 'same-origin' })
  if (!res.ok) throw new ApiError(res.status, '/api/models')
  const body: unknown = await res.json()
  return Array.isArray(body) ? (body as ChatModel[]) : []
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

/**
 * B10.4 — a model's generation, read from the number in its name: GPT-5.6 → 5.6, Claude Opus 4.5 →
 * 4.5, Llama 3.3 70B → 3.3. A model with no number sorts last.
 *
 * ⚠ AN INFERENCE, BECAUSE THE CATALOG CARRIES NO RELEASE DATE. Lens's catalog.Model has prices,
 * capabilities and limits, and nothing that says when a model came out or which is a provider's
 * flagship. Providers number their generations, so the number in the name is the closest fact the
 * catalog does hold. A `released` field in Lens would replace this (recorded in FOUND.md).
 */
export function generation(m: ChatModel): number {
  const match = /(\d+(?:\.\d+)?)/.exec(m.display_name)
  return match === null ? -1 : Number(match[1])
}

/** Newest generation first; within one, the flagship (highest output price) first. */
function newestFirst(a: ChatModel, b: ChatModel): number {
  return generation(b) - generation(a) || b.output_per_1m - a.output_per_1m || a.display_name.localeCompare(b.display_name)
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
  /** The newest flagship among the offered models — the default, chosen from data, never a name. */
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
 */
export function pickerCatalog(all: ChatModel[]): PickerCatalog {
  const chat = all.filter((m) => !m.deprecated && m.output_per_1m > 0)
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
    omitted: all.length - chat.length,
    defaultModel: [...offered].sort(newestFirst)[0],
  }
}

/**
 * The request body each provider's chat endpoint expects.
 *
 * ⚠ ANTHROPIC REQUIRES max_tokens AND OPENAI DOES NOT. Omitting it is a 400 from Anthropic, which
 * would arrive as a dead stream with no frames — the hardest failure to read from a chat screen.
 */
function requestBody(provider: string, model: string, turns: ChatMessage[]): unknown {
  // ⚠ ONLY role AND content GO UPSTREAM. A turn carries its cost for the screen, and Anthropic
  // refuses a message with a field it does not know.
  const messages = turns.map(({ role, content, attachments }) => {
    const docs = (attachments ?? []).filter((a) => a.data !== undefined)
    if (docs.length === 0) return { role, content }
    // ⚠ THE TWO SHAPES LENS'S CONVERTER READS (talyvor-lens internal/proxy/distill_integration.go,
    // extractBlockDocument): Anthropic's base64 `document` block and OpenAI's `file` part with a
    // data: URL. Lens replaces each with the document's text before the model sees it.
    if (provider === 'anthropic') {
      return {
        role,
        content: [
          ...docs.map((d) => ({ type: 'document', source: { type: 'base64', media_type: d.media_type, data: d.data } })),
          { type: 'text', text: content },
        ],
      }
    }
    return {
      role,
      content: [
        { type: 'text', text: content },
        ...docs.map((d) => ({ type: 'file', file: { filename: d.name, file_data: `data:${d.media_type};base64,${d.data}` } })),
      ],
    }
  })
  if (provider === 'anthropic') {
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
  onDone: (info: { unrecognised: number; usage?: Usage; model?: string; converted: boolean; source?: AnswerSource }) => void
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
  const path = CHAT_PATH[provider]
  if (path === undefined) {
    // Unreachable from the picker, which only offers STREAMABLE_PROVIDERS. Stated rather than
    // assumed: a caller that grows a third provider gets a refusal, not an empty reply.
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
        ...(messages.some((m) => m.attachments?.some((a) => a.data !== undefined)) ? { 'X-Talyvor-Distill': 'true' } : {}),
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
  const source = answerSource(res.headers)
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
          handlers.onDone({ unrecognised, usage, model: served, converted, source })
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
  handlers.onDone({ unrecognised, usage, model: served, converted, source })
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
