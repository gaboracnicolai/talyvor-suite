/**
 * price.ts — rendering a CATALOG LIST RATE (USD per 1M tokens) as money.
 *
 * ⚠ WHY THIS IS NOT `formatCost` FROM ../track/format. That is this app's house money formatter and
 * it is the obvious thing to reach for. It is CORRECT for what it was written for — actual spend in
 * dollars, where two decimals is the money boundary — and WRONG here. Its branch is
 * `usd < 0.01 ? toFixed(4) : toFixed(2)`, and the cheapest seeded catalog rate is **0.015**
 * (internal/catalog/seed.go, the smallest InputPer1M of 45 entries). 0.015 is not below 0.01, so it
 * takes the two-decimal branch and renders **`$0.01`** — a real price corrupted by a third.
 *
 * ⚠ AND IT ROUNDS DOWN, WHICH IS NOT WHAT "round half up" PREDICTS. 0.015 has no exact double; it
 * is stored as 0.014999999999999999445, so toFixed(2) is correctly rounding a value BELOW the
 * midpoint. This product's rule elsewhere is that charges CEIL — this silently floors, on the
 * cheapest model in the catalog. A per-1M rate lives in the gap between that formatter's two cases.
 * price.test.ts pins the measured value as a control so the reason survives the next person who
 * notices the duplication.
 *
 * ⚠ WHAT WAS THERE BEFORE, MEASURED IN THE DOM RATHER THAN READ FROM THE SOURCE:
 *
 *     List price · 2.5 in / 10 out per 1M tokens
 *
 * No currency mark anywhere, on the one screen whose product thesis is showing what a message
 * costs — and the two figures disagreeing about their decimals because `String(10.00)` is `"10"`.
 *
 * ⚠ AND THE FIGURE AUDIT COULD NOT HAVE CAUGHT IT, CORRECTLY. `figureKind()` returns null unless an
 * element's own text is a figure ALONE; this text carries words, so it is prose and the audit
 * declines to police it — its own documented "TRAP TWO — A SENTENCE IS NOT A FIGURE". The currency
 * floor never applied. Nothing is wrong with the audit; the price sat in the one shape it does not
 * look at, which is why this needed a test of its own rather than a rule tightened over there.
 */

/**
 * formatUsdPer1M renders a USD-per-1M-tokens catalog rate: currency mark, at least two decimals,
 * and NEVER rounded.
 *
 * The value is built from `String(value)` — the shortest representation that round-trips a double,
 * and precisely what React was already rendering — then padded to two decimals. So the fix is
 * additive by construction: it adds a mark and trailing zeros and cannot change any displayed
 * number. `price.test.ts` states that as a losslessness property over the catalog's real range
 * rather than as a handful of examples.
 *
 * Non-finite input renders an em dash rather than `$NaN`. The catalog is proxied from the
 * deployment's Lens, so this client does not get to assume the field arrived.
 */
export function formatUsdPer1M(value: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'

  const raw = String(value)
  // Exponential form is unreachable from the real catalog (the smallest seeded rate is 0.015), but
  // this client renders whatever the deployment sends, so it is handled rather than assumed away:
  // toFixed(20) is the widest lossless decimal expansion available, and the trailing-zero trim
  // below brings it back to the shortest form that still shows every significant digit.
  const decimal = raw.includes('e') || raw.includes('E') ? trimZeros(value.toFixed(20)) : raw

  const [whole, fraction = ''] = decimal.split('.')
  return `$${whole}.${fraction.padEnd(2, '0')}`
}

/** Drop trailing fractional zeros, keeping at least one digit after the point. */
function trimZeros(s: string): string {
  if (!s.includes('.')) return s
  const trimmed = s.replace(/0+$/, '')
  return trimmed.endsWith('.') ? `${trimmed}0` : trimmed
}

/**
 * What one answer cost — B1.4. Stored with the answer in this browser's history.
 *
 * ⚠ USD IS STORED, CREDITS ARE DERIVED AT RENDER. The credit peg is the deployment's
 * (`usd_per_lxc` from /api/lxc/topup-options) and is not this file's to write down; storing
 * credits would freeze a conversion the deployment may change.
 *
 * ⚠ THIS IS THE ANSWER'S PRICE AT THE CATALOG RATE, NOT A LEDGER ROW. It is tokens the provider
 * reported × the list rate the picker shows. Whether the workspace was debited is a different
 * question (see the note in Chat.tsx on session keys), and nothing here answers it.
 */
export interface AnswerCost {
  /** The model that served the answer, as the screen names it. */
  model: string
  input_tokens: number
  output_tokens: number
  usd: number
}

/** USD for a token count at per-1M-token rates. Null when a count or rate is missing. */
export function answerUsd(
  usage: { input_tokens?: number; output_tokens?: number } | undefined,
  rates: { input_per_1m: number; output_per_1m: number },
): number | null {
  const tin = usage?.input_tokens
  const tout = usage?.output_tokens
  if (tin === undefined || tout === undefined) return null
  if (!Number.isFinite(rates.input_per_1m) || !Number.isFinite(rates.output_per_1m)) return null
  return (tin * rates.input_per_1m + tout * rates.output_per_1m) / 1_000_000
}

/**
 * The answer's price record, or undefined when the stream reported no complete token counts.
 * Priced at the rate of the model that was ASKED; named by the one the provider says ANSWERED,
 * except that a dated variant of the asked-for id (`gpt-4o-2024-08-06`) keeps the catalog's name.
 */
export function pricedAnswer(
  usage: { input_tokens?: number; output_tokens?: number } | undefined,
  asked: { id: string; display_name: string; input_per_1m: number; output_per_1m: number },
  servedBy: string | undefined,
): AnswerCost | undefined {
  const usd = answerUsd(usage, asked)
  if (usd === null) return undefined
  return {
    model: servedBy !== undefined && !servedBy.startsWith(asked.id) ? servedBy : asked.display_name,
    input_tokens: usage?.input_tokens ?? 0,
    output_tokens: usage?.output_tokens ?? 0,
    usd,
  }
}

/**
 * The price line's figure: credits at the deployment's peg, dollars when the deployment has not
 * confirmed one. Two significant digits below one unit, because a typical answer costs hundredths
 * of a credit and `0.00` would state that it was free.
 */
export function formatAnswerCost(usd: number, usdPerLXC: number | undefined): string {
  const pegged = typeof usdPerLXC === 'number' && Number.isFinite(usdPerLXC) && usdPerLXC > 0
  const amount = pegged ? usd / usdPerLXC : usd
  const figure =
    amount === 0
      ? '0'
      : amount < 1
        ? amount.toLocaleString('en-US', { maximumSignificantDigits: 2 })
        : amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return pegged ? `≈ ${figure} LXC` : `≈ $${figure}`
}
