// B17.3 — the oracles: how a scenario knows an answer is right without trusting the thing it tests.
// Pure functions, unit-tested in test/oracles.test.ts.

/** One row of Lens's model catalog, as GET /v1/catalog/models serves it. */
export interface CatalogModel {
  id: string
  provider: string
  display_name: string
  input_per_1m: number
  output_per_1m: number
  deprecated?: boolean
}

/** What the line under an answer says (apps/web/src/areas/chat/Chat.tsx, data-testid="turn-cost"). */
export type Footer =
  | { kind: 'priced'; figure: number; unit: 'USD' | 'LXC'; model: string; inputTokens: number; outputTokens: number }
  | { kind: 'cache' }
  | { kind: 'pool'; discountPct: number; figure: number }
  | { kind: 'unpriced' }
  | { kind: 'unreadable'; text: string }

const PRICED = /^≈ (\$?)([\d,.]+)( LXC)? · (.+) · ([\d,]+) in \/ ([\d,]+) out tokens$/
const POOL = /^shared answer · (\d+)% off · ≈ ([\d,.]+) LXC$/

export function parseFooter(raw: string): Footer {
  const text = raw.replace(/\s+/g, ' ').trim()
  if (text === 'from your earlier answer · 0 LXC') return { kind: 'cache' }
  if (text.startsWith('Price not known')) return { kind: 'unpriced' }
  const pool = POOL.exec(text)
  if (pool !== null) return { kind: 'pool', discountPct: Number(pool[1]), figure: num(pool[2]) }
  const p = PRICED.exec(text)
  if (p !== null && (p[1] === '$') !== (p[3] === ' LXC')) {
    return {
      kind: 'priced',
      figure: num(p[2]),
      unit: p[3] === ' LXC' ? 'LXC' : 'USD',
      model: p[4],
      inputTokens: num(p[5]),
      outputTokens: num(p[6]),
    }
  }
  return { kind: 'unreadable', text }
}

function num(s: string): number {
  return Number(s.replace(/,/g, ''))
}

/** US dollars for a token count at a model's list price. */
export function listPriceUSD(m: Pick<CatalogModel, 'input_per_1m' | 'output_per_1m'>, inputTokens: number, outputTokens: number): number {
  return (inputTokens * m.input_per_1m + outputTokens * m.output_per_1m) / 1_000_000
}

/**
 * The footer's figure as the screen should print it. Written from the rule, not imported from
 * apps/web: an oracle that calls the code under test agrees with it by construction.
 */
export function expectedFigure(usd: number, usdPerLXC: number | undefined): string {
  const pegged = usdPerLXC !== undefined && Number.isFinite(usdPerLXC) && usdPerLXC > 0
  const amount = pegged ? usd / usdPerLXC : usd
  const figure =
    amount === 0
      ? '0'
      : amount < 1
        ? amount.toLocaleString('en-US', { maximumSignificantDigits: 2 })
        : amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return pegged ? `≈ ${figure} LXC` : `≈ $${figure}`
}

/** What a priced footer's figure means in dollars. */
export function footerUSD(f: Extract<Footer, { kind: 'priced' }>, usdPerLXC: number): number {
  return f.unit === 'LXC' ? f.figure * usdPerLXC : f.figure
}

/** True when `answer` states `n` as a number of its own ("42", "42.", "= 42", "1,042" for 1042). */
export function statesNumber(answer: string, n: number): boolean {
  const plain = String(n)
  const grouped = n.toLocaleString('en-US')
  return [plain, grouped].some((form) => new RegExp(`(^|[^\\d.,])${form.replace(/[.,]/g, '\\$&')}(?![\\d]|[.,]\\d)`).test(answer))
}

/** True when `answer` names `word`, case-insensitively, as a whole word. */
export function namesWord(answer: string, word: string): boolean {
  return new RegExp(`(^|\\W)${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`, 'i').test(answer)
}

/** The judge's verdict: its reply must begin with YES or NO; anything else is no verdict. */
export function judgeVerdict(reply: string): boolean | undefined {
  const head = reply.trim().toUpperCase()
  if (head.startsWith('YES')) return true
  if (head.startsWith('NO')) return false
  return undefined
}

/** A small deterministic generator, so a run's questions are reproducible from its seed. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 0x1_0000_0000
  }
}
