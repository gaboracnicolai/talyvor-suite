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

/**
 * B28.349 — a piece of a tool call the model is making, by its index in the answer. OpenAI streams
 * `delta.tool_calls[]` — the id and name first, then the arguments a few characters at a time; Anthropic
 * opens a `tool_use` content block with the id and name, then sends its input as `input_json_delta`
 * pieces. Pieces with the same index are one call, `args` concatenated in order.
 */
export interface ToolCallPiece {
  index: number
  id?: string
  name?: string
  args: string
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
  /** B28.81 — why the model stopped, as the provider names it: OpenAI's finish_reason (every provider
   *  Lens translates sends that shape) or Anthropic's stop_reason. */
  finish?: string
  /** B28.349 — pieces of the tool calls the model is making in this frame. */
  toolCalls?: ToolCallPiece[]
  /** B28.362 — what Lens charged for the answer, in µLXC, when this frame is Lens's CHARGE_FRAME. */
  charged_ulxc?: number
  /** B28.372 — the web pages Lens searched and gave the model, when this frame is Lens's CITATIONS_FRAME. */
  citations?: Citation[]
  /** B28.373 — code the model ran in Lens's sandbox and what it printed, when this frame is Lens's CODE_RUN_FRAME. */
  codeRuns?: CodeRun[]
}

/**
 * B28.362 — the frame Lens adds to a stream to say what the answer was charged (talyvor-lens B28.102), when the
 * request asked with `X-Talyvor-Report-Charge: true` (chatApi.ts REPORT_CHARGE_HEADER; an SDK reading Lens directly
 * never sees it), on either writer, after the provider's last usage frame and BEFORE the terminator (`data: [DONE]`, `message_stop`) — the
 * reader stops at the terminator, so a frame after it is never read:
 *
 *     event: talyvor.charge
 *     data: {"type":"talyvor.charge","charged_ulxc":1350}
 *
 * `charged_ulxc` is what the request was charged, in µLXC as a whole number: the amount of the spend row Lens wrote for
 * it (a platform fee is a row of its own, not in it). Chat puts it under the answer in place of the estimate.
 */
export const CHARGE_FRAME = 'talyvor.charge'

/**
 * B28.372 — the frame Lens adds to a stream when the request asked it to search the web first (talyvor-lens B28.118),
 * with `X-Talyvor-Web-Search: on` (chatApi.ts WEB_SEARCH_HEADER): the pages it found and gave the model, numbered as the
 * model was told to cite them in its answer ("[1]", "[2]"). On either writer, anywhere before the terminator — first,
 * as soon as the search is back, is best:
 *
 *     event: talyvor.citations
 *     data: {"type":"talyvor.citations","citations":[{"n":1,"url":"https://…","title":"…"},{"n":2,"url":"https://…"}]}
 *
 * `n` is the number from 1, `url` the page (only http and https are shown), `title` the page's title when the search
 * gave one. A search that found nothing sends `"citations":[]`. Chat lists them under the answer as its sources.
 */
export const CITATIONS_FRAME = 'talyvor.citations'

/** B28.372 — one page Lens searched and gave the model, by the number the answer cites it with. */
export interface Citation {
  n: number
  url: string
  title?: string
}

/** B28.372 — the pages in a CITATIONS_FRAME that can be linked; undefined when the frame is not that shape. */
function citationsOf(v: unknown): Citation[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Citation[] = []
  for (const c of v) {
    if (!isRecord(c) || typeof c.n !== 'number' || !Number.isSafeInteger(c.n) || c.n < 1 || typeof c.url !== 'string') return undefined
    // A link is only ever made to a web page: a javascript: or data: URL from outside is dropped, not rendered.
    if (!/^https?:\/\/[^\s]+$/i.test(c.url)) continue
    out.push({ n: c.n, url: c.url, ...(typeof c.title === 'string' && c.title.trim() !== '' ? { title: c.title.trim() } : {}) })
  }
  return out.sort((a, b) => a.n - b.n)
}

/**
 * B28.373 — the frame Lens adds to a stream for each piece of code the model ran in Lens's sandbox while answering
 * (talyvor-lens B28.119), when the request asked with `X-Talyvor-Run-Code: on` (chatApi.ts RUN_CODE_HEADER). One frame
 * per run, in the order they ran, on either writer, anywhere before the terminator — as soon as the run is back is best:
 *
 *     event: talyvor.code_run
 *     data: {"type":"talyvor.code_run","language":"python","code":"print(1)","stdout":"1\n","stderr":"","exit_code":0}
 *
 * `language` names what ran, `code` is what ran, word for word, `stdout` and `stderr` what it printed (either may be
 * left out when empty), `exit_code` how it ended, and `timed_out: true` when the sandbox stopped it for taking too long.
 * Chat shows each under the answer, the code and what it printed, as text.
 */
export const CODE_RUN_FRAME = 'talyvor.code_run'

/** B28.373 — one piece of code the model ran in Lens's sandbox, and what came of it. */
export interface CodeRun {
  language: string
  code: string
  stdout: string
  stderr: string
  exit_code: number
  timed_out?: boolean
}

/** B28.373 — the run in a CODE_RUN_FRAME; undefined when the frame is not that shape. */
function codeRunOf(o: Record<string, unknown>): CodeRun | undefined {
  const { language, code, stdout, stderr, exit_code: exit, timed_out: timedOut } = o
  if (typeof language !== 'string' || language.trim() === '' || typeof code !== 'string') return undefined
  if (typeof exit !== 'number' || !Number.isSafeInteger(exit)) return undefined
  if ((stdout !== undefined && typeof stdout !== 'string') || (stderr !== undefined && typeof stderr !== 'string')) return undefined
  if (timedOut !== undefined && typeof timedOut !== 'boolean') return undefined
  return { language: language.trim(), code, stdout: stdout ?? '', stderr: stderr ?? '', exit_code: exit, ...(timedOut === true ? { timed_out: true } : {}) }
}

/** B28.81 — the stop reasons that mean the model ran out of room, not out of answer. */
export function cutOff(finish: string | undefined): boolean {
  return finish === 'length' || finish === 'max_tokens'
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
  let finish: string | undefined
  let charged: number | undefined
  let citations: Citation[] | undefined
  const codeRuns: CodeRun[] = []
  const toolCalls: ToolCallPiece[] = []

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
      // B28.362 — Lens's own frame, on either writer: what it charged. A figure that is not a whole µLXC is counted.
      if (type === CHARGE_FRAME) {
        const c = obj.charged_ulxc
        if (typeof c === 'number' && Number.isSafeInteger(c) && c >= 0) charged = c
        else unrecognised += 1
        continue
      }
      // B28.372 — Lens's own frame, on either writer: the pages it searched. A frame of another shape is counted.
      if (type === CITATIONS_FRAME) {
        const got = citationsOf(obj.citations)
        if (got !== undefined) citations = got
        else unrecognised += 1
        continue
      }
      // B28.373 — Lens's own frame, on either writer: a piece of code the model ran. A frame of another shape is counted.
      if (type === CODE_RUN_FRAME) {
        const run = codeRunOf(obj)
        if (run !== undefined) codeRuns.push(run)
        else unrecognised += 1
        continue
      }
      if (type === 'content_block_delta') {
        const d = obj.delta
        if (isRecord(d) && d.type === 'text_delta' && typeof d.text === 'string') {
          if (d.text !== '') deltas.push({ text: d.text })
        }
        // B28.349 — a tool call's input, a piece at a time.
        if (isRecord(d) && d.type === 'input_json_delta' && typeof d.partial_json === 'string' && typeof obj.index === 'number') {
          toolCalls.push({ index: obj.index, args: d.partial_json })
        }
        // A non-text delta (thinking) is a known shape carrying no answer text.
        continue
      }
      // B28.349 — a tool call opens as its own content block, naming the tool.
      const block = obj.content_block
      if (type === 'content_block_start' && isRecord(block) && block.type === 'tool_use' && typeof obj.index === 'number') {
        toolCalls.push({ index: obj.index, id: String(block.id ?? ''), name: String(block.name ?? ''), args: '' })
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
        if (type === 'message_delta' && isRecord(obj.delta) && typeof obj.delta.stop_reason === 'string') {
          finish = obj.delta.stop_reason
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
        // B28.349 — the tool calls the model is making, a piece at a time.
        if (isRecord(d) && Array.isArray(d.tool_calls)) {
          for (const tc of d.tool_calls) {
            if (!isRecord(tc) || typeof tc.index !== 'number') continue
            const fn = isRecord(tc.function) ? tc.function : {}
            toolCalls.push({
              index: tc.index,
              ...(typeof tc.id === 'string' ? { id: tc.id } : {}),
              ...(typeof fn.name === 'string' ? { name: fn.name } : {}),
              args: typeof fn.arguments === 'string' ? fn.arguments : '',
            })
          }
        }
        if (typeof c.finish_reason === 'string') finish = c.finish_reason
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
  if (finish !== undefined) out.finish = finish
  if (toolCalls.length > 0) out.toolCalls = toolCalls
  if (charged !== undefined) out.charged_ulxc = charged
  if (citations !== undefined) out.citations = citations
  if (codeRuns.length > 0) out.codeRuns = codeRuns
  return out
}
