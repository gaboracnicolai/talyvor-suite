// chatStream.ts — the two SSE shapes on this wire, and nothing else.
//
// ⚠ THE POPULATION IS MEASURED, NOT ASSUMED. talyvor-lens dispatches streaming with
// `if cfg.ProviderName() == "openai" { ServeOpenAI } else { ServeAnthropic }` — TWO SSE writers.
// So there are exactly two frame shapes a browser can receive through the BFF's relay, and a third
// would be a change in Lens rather than a gap here.
//
// ⚠ NOTHING IS SWALLOWED. A frame this parser cannot read is COUNTED, not dropped. A parser that
// silently returns "no text" for an unknown shape is indistinguishable, on screen, from a model
// that answered nothing — and the screen would show a confident empty reply. `unrecognised` is what
// lets the screen say which of the two happened.

export interface Delta {
  text: string
}

export interface Extraction {
  deltas: Delta[]
  done: boolean
  /** Frames whose shape this parser does not know, or which did not parse. Never silently 0. */
  unrecognised: number
  /** An error the SERVER reported inside the stream. Distinct from a transport failure. */
  error?: string
  /** Token counts the provider reported in this frame, if any (B1.4 prices the answer from them). */
  usage?: Usage
  /** The model the provider says served the request, if this frame names one. */
  model?: string
}

/**
 * Token counts as the provider reports them. Each side is optional because the two wire formats
 * report them in different frames: Anthropic sends input in `message_start` and output in
 * `message_delta`; OpenAI sends both in its final usage-only frame.
 */
export interface Usage {
  input_tokens?: number
  output_tokens?: number
}

function count(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
}

/** Later frames win per side; a side a frame does not report keeps its earlier value. */
export function mergeUsage(prev: Usage | undefined, next: Usage | undefined): Usage | undefined {
  if (next === undefined) return prev
  return {
    input_tokens: next.input_tokens ?? prev?.input_tokens,
    output_tokens: next.output_tokens ?? prev?.output_tokens,
  }
}

/**
 * FRAME_SEPARATOR — SSE frames end at a blank line.
 *
 * ⚠ CRLF IS INCLUDED DELIBERATELY. Nothing between Lens and the browser is contractually obliged to
 * use bare LF, and a parser that only knows `\n\n` against a CRLF producer never completes a single
 * frame — it accumulates the whole answer in the remainder and renders nothing at all, which looks
 * exactly like a model that never replied.
 */
const FRAME_SEPARATOR = /\r?\n\r?\n/

/**
 * splitFrames divides a buffer into COMPLETE frames and the remainder.
 *
 * ⚠ THE REMAINDER IS THE WHOLE JOB. A network read boundary lands wherever TCP says it does,
 * routinely mid-JSON. A parser that treats each read as a frame throws on the first split object
 * and kills a stream that was arriving correctly.
 */
export function splitFrames(buffer: string): { frames: string[]; rest: string } {
  const parts = buffer.split(FRAME_SEPARATOR)
  // The last part is by definition not yet terminated by a separator, so it is the remainder —
  // even when it is empty, which is the case where the buffer ended exactly on a boundary.
  const rest = parts.pop() ?? ''
  return { frames: parts.filter((p) => p.trim() !== ''), rest }
}

/** The `data:` payloads of one frame. An SSE frame may carry several, plus `event:` and comments. */
function dataLines(frame: string): string[] {
  const out: string[] = []
  for (const line of frame.split(/\r?\n/)) {
    // A leading colon is an SSE comment — the keepalive shape. Not data, and not a defect.
    if (line.startsWith(':')) continue
    if (!line.startsWith('data:')) continue
    out.push(line.slice('data:'.length).trim())
  }
  return out
}

/**
 * ANTHROPIC_CONTROL — the frame types a healthy Anthropic stream always sends and which carry no
 * answer text.
 *
 * ⚠ THEY ARE LISTED RATHER THAN IGNORED BY DEFAULT, because the default is to COUNT an unknown
 * shape. If these were not named, every healthy stream would report five unrecognised frames and
 * the counter would be noise from the first request — a warning that is always on is one nobody
 * reads, which is how a real one gets missed.
 */
const ANTHROPIC_CONTROL = new Set([
  'message_start',
  'content_block_start',
  'content_block_stop',
  'message_delta',
  'message_stop',
  'ping',
  'error',
])

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/**
 * extractDeltas reads ONE frame.
 *
 * The two shapes, and why each test is what it is:
 *  · OpenAI  — `choices[].delta.content`. The opening frame carries `delta.role` and no content,
 *    and Lens appends a usage-only frame with an EMPTY choices array; neither is text and neither
 *    is a defect.
 *  · Anthropic — `content_block_delta` with `delta.type === "text_delta"`. ⚠ The type check is not
 *    decoration: a `thinking_delta` carries `delta.thinking`, and matching on "there is a string in
 *    here" would render the model's reasoning as its answer.
 */
export function extractDeltas(frame: string): Extraction {
  const deltas: Delta[] = []
  let done = false
  let unrecognised = 0
  let error: string | undefined
  let usage: Usage | undefined
  let model: string | undefined

  for (const payload of dataLines(frame)) {
    if (payload === '') continue
    if (payload === '[DONE]') {
      // The OpenAI sentinel. Not JSON, and counting it as unreadable would fire the counter on
      // every healthy stream.
      done = true
      continue
    }

    let obj: unknown
    try {
      obj = JSON.parse(payload)
    } catch {
      // ⚠ COUNTED, NOT THROWN. A throw inside the read loop aborts a stream that may be almost
      // entirely delivered, and loses the text already on screen.
      unrecognised += 1
      continue
    }
    if (!isRecord(obj)) {
      unrecognised += 1
      continue
    }

    // A server-reported error inside the stream. This is NOT a transport failure and must not be
    // reported as one: the request reached the model and the model (or the gateway) refused.
    const errField = obj.error
    if (isRecord(errField) && typeof errField.message === 'string') {
      error = errField.message
      continue
    }

    // ── Anthropic ──────────────────────────────────────────────────────────
    const type = obj.type
    if (typeof type === 'string') {
      if (type === 'content_block_delta') {
        const d = obj.delta
        if (isRecord(d) && d.type === 'text_delta' && typeof d.text === 'string') {
          if (d.text !== '') deltas.push({ text: d.text })
        }
        // A non-text delta (thinking, input_json) is a known shape carrying no answer text.
        continue
      }
      if (ANTHROPIC_CONTROL.has(type)) {
        if (type === 'message_stop') done = true
        if (type === 'message_start' && isRecord(obj.message)) {
          if (typeof obj.message.model === 'string') model = obj.message.model
          const u = obj.message.usage
          if (isRecord(u)) {
            usage = mergeUsage(usage, {
              input_tokens: count(u.input_tokens),
              output_tokens: count(u.output_tokens),
            })
          }
        }
        // message_delta's output_tokens is CUMULATIVE, so the last one is the answer's total.
        if (type === 'message_delta' && isRecord(obj.usage)) {
          usage = mergeUsage(usage, {
            input_tokens: count(obj.usage.input_tokens),
            output_tokens: count(obj.usage.output_tokens),
          })
        }
        continue
      }
      unrecognised += 1
      continue
    }

    // ── OpenAI ─────────────────────────────────────────────────────────────
    const choices = obj.choices
    if (Array.isArray(choices)) {
      if (typeof obj.model === 'string') model = obj.model
      if (isRecord(obj.usage)) {
        usage = mergeUsage(usage, {
          input_tokens: count(obj.usage.prompt_tokens),
          output_tokens: count(obj.usage.completion_tokens),
        })
      }
      for (const c of choices) {
        if (!isRecord(c)) continue
        const d = c.delta
        // ⚠ AN EMPTY STRING IS NOT PUSHED. The caller uses "a delta arrived" to leave the pending
        // state, and a role-only opening frame would clear it before a single character exists.
        if (isRecord(d) && typeof d.content === 'string' && d.content !== '') {
          deltas.push({ text: d.content })
        }
      }
      // An empty choices array is Lens's usage-only final frame — a known shape, not a mystery.
      continue
    }

    unrecognised += 1
  }

  const out: Extraction = { deltas, done, unrecognised }
  if (error !== undefined) out.error = error
  if (usage !== undefined) out.usage = usage
  if (model !== undefined) out.model = model
  return out
}
