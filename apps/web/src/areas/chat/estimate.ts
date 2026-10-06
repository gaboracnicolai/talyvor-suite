import { CHAT_MAX_TOKENS, type ChatAttachment, type ChatMessage, type ChatModel, type ChatTool, TOOL_PROVIDERS } from './chatApi'

/**
 * B28.99 — what a question will cost, as a range, before it is sent.
 *
 * The footer under an answer (price.ts) is the tokens the provider reported × the catalog's list rate.
 * Before sending, neither count is known, so each is bounded instead of guessed:
 *
 * · INPUT is every byte the request carries — the conversation so far, the question, the wallet tools
 *   on offer — at most one token per two bytes plus the provider's framing, at least one per eight. A
 *   document counts toward the high end only, by its size: Lens converts it, and a scanned page may
 *   convert to nothing.
 * · OUTPUT is at least one token and at most CHAT_MAX_TOKENS, the cap Chat sends Anthropic and Bedrock.
 *   Other providers take no cap, so for them the high end is an answer of that length, as the screen
 *   says.
 *
 * One request: a question a wallet tool answers takes more, and its footer counts them.
 */
export interface CostRange {
  low_usd: number
  high_usd: number
  /** The longest answer the high end prices, in tokens. */
  answer_tokens: number
}

/** Bytes per token in a text, at the most and the least: a token of ordinary text is one to about six bytes. */
const MOST_BYTES_PER_TOKEN = 8
const LEAST_BYTES_PER_TOKEN = 2
/** The tokens a provider adds around the messages, and around each one, at most. */
const FRAMING_TOKENS = 64
const PER_MESSAGE_TOKENS = 8
/** The instructions a provider adds when tools are offered (Anthropic's tool-use prompt is about 350), at most. */
const TOOL_FRAMING_TOKENS = 600

const encoder = new TextEncoder()
const bytes = (s: string) => encoder.encode(s).length

export function previewCost(
  turns: readonly ChatMessage[],
  question: string,
  docs: readonly ChatAttachment[],
  model: Pick<ChatModel, 'provider' | 'input_per_1m' | 'output_per_1m'>,
  tools: readonly ChatTool[],
): CostRange | undefined {
  if (!Number.isFinite(model.input_per_1m) || !Number.isFinite(model.output_per_1m)) return undefined
  // The same turns requestBody() sends: an answer that said nothing is left out.
  const said = turns.filter((t) => t.role !== 'assistant' || t.content.trim() !== '')
  const textBytes = said.reduce((n, t) => n + bytes(t.content), 0) + bytes(question)
  const docBytes = [...said.flatMap((t) => t.attachments ?? []), ...docs]
    .filter((d) => d.file_id !== undefined)
    .reduce((n, d) => n + d.size, 0)
  const offered = TOOL_PROVIDERS.includes(model.provider) ? tools : []
  const toolBytes = offered.length === 0 ? 0 : bytes(JSON.stringify(offered.map(({ name, description, input_schema }) => ({ name, description, input_schema }))))

  const inputLow = Math.floor((textBytes + toolBytes) / MOST_BYTES_PER_TOKEN)
  const inputHigh =
    Math.ceil((textBytes + toolBytes + docBytes) / LEAST_BYTES_PER_TOKEN) +
    FRAMING_TOKENS +
    PER_MESSAGE_TOKENS * (said.length + 1) +
    (offered.length === 0 ? 0 : TOOL_FRAMING_TOKENS)

  const usd = (input: number, output: number) => (input * model.input_per_1m + output * model.output_per_1m) / 1_000_000
  return { low_usd: usd(inputLow, 1), high_usd: usd(inputHigh, CHAT_MAX_TOKENS), answer_tokens: CHAT_MAX_TOKENS }
}
