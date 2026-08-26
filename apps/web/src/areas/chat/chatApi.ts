import { ApiError } from '../../lib/api'
import { extractDeltas, splitFrames } from './chatStream'

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

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/** Reads the deployment's catalog. Errors are the shared ApiError so the app-wide bar sees them. */
export async function fetchModels(): Promise<ChatModel[]> {
  const res = await fetch('/api/models', { credentials: 'same-origin' })
  if (!res.ok) throw new ApiError(res.status, '/api/models')
  const body: unknown = await res.json()
  return Array.isArray(body) ? (body as ChatModel[]) : []
}

/**
 * streamableModels narrows the catalog to what this client can read, and reports what it dropped.
 *
 * ⚠ IT RETURNS THE DROPPED COUNT RATHER THAN JUST FILTERING. A screen that silently shows 4 of 15
 * models is making an unstated claim about the deployment. The count is rendered.
 *
 * ⚠ DEPRECATED MODELS ARE DROPPED TOO — the catalog carries the flag, and offering a model the
 * provider has retired is a request that fails at the far end for a reason the screen could have
 * known.
 */
export function streamableModels(all: ChatModel[]): { models: ChatModel[]; hidden: number } {
  const models = all.filter((m) => STREAMABLE_PROVIDERS.includes(m.provider) && !m.deprecated)
  return { models, hidden: all.length - models.length }
}

/**
 * The request body each provider's chat endpoint expects.
 *
 * ⚠ ANTHROPIC REQUIRES max_tokens AND OPENAI DOES NOT. Omitting it is a 400 from Anthropic, which
 * would arrive as a dead stream with no frames — the hardest failure to read from a chat screen.
 */
function requestBody(provider: string, model: string, messages: ChatMessage[]): unknown {
  if (provider === 'anthropic') {
    return { model, max_tokens: 4096, stream: true, messages }
  }
  return { model, stream: true, messages }
}

export interface StreamHandlers {
  /** Called with each text delta as it arrives. */
  onDelta: (text: string) => void
  /** Called once when the stream ends cleanly. `unrecognised` is frames this parser could not read. */
  onDone: (info: { unrecognised: number }) => void
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
      headers: { 'Content-Type': 'application/json' },
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

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let unrecognised = 0

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
        if (got.error !== undefined) {
          handlers.onError(got.error)
          return
        }
        for (const d of got.deltas) handlers.onDelta(d.text)
        if (got.done) {
          handlers.onDone({ unrecognised })
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
  handlers.onDone({ unrecognised })
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
