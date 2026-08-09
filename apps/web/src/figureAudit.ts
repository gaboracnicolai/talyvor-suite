/**
 * THE RENDERED-FIGURE AUDIT — what the user actually sees, not what the code called it.
 *
 * `figureFace.test.ts` (#93) reads SOURCE and keys on the NAME OF A FUNCTION: any call matching
 * /usd|cents|cost|price/i, plus every exported `format*` classified by hand. That caught the five
 * `formatUSD` sites. It cannot catch money that never passes through a money-named function, and
 * MEASURED 2026-08-09 at `7e2e9fc` — with figureFace green — this was on screen:
 *
 *     Overview:  ≈ {formatUSD(q.data.usd_value_uusd)}          ← the figure face
 *     Overview:  ≈ ${month.data.current_month_usd.toFixed(2)}  ← the body sans
 *
 * The same "≈ $" treatment, twelve rows apart on the same card, in two typefaces. The second
 * one's only function call is `toFixed`, which is not money-shaped, so rule A never saw it.
 * Spend.tsx renders the identical line. A source rule keyed on names cannot close this without
 * guessing which identifiers are rendered and which are merely referenced — measured: a naive
 * value-name rule flags `pending.usd_cents > 0` (a PREDICATE, whose render two lines below is
 * already on the face) and `keepPreviousData` (which contains "usD").
 *
 * So this rule reads the DOM instead. A figure is a figure because of what it says on screen.
 *
 * ⚠ TRAP ONE — REACT SPLITS THE TEXT NODE. `≈ ${x}` renders as TWO text nodes, "≈ $" and
 * "12.35". A per-text-node /\$\s*\d/ finds neither, so the first version of this audit passed
 * clean over both defects. It reads an element's OWN text — its direct text children joined —
 * which is the smallest unit that can carry a typeface. Pinned by a control below.
 *
 * ⚠ TRAP TWO — A SENTENCE IS NOT A FIGURE. The one sans-rendered currency text in the product at
 * `7e2e9fc` is a REFUSAL FROM LENS that TopUp surfaces verbatim — "this app offers $10, $50,
 * $100, but Lens refused that amount — the two are running different top-up allow-lists." Prose
 * that quotes a price is prose; digits ride the sentence, in the sans, the same argument that
 * keeps `formatWhen` and `formatDay` off the face. So an element is
 * policed only when its own text is A FIGURE AND NOTHING ELSE — remove the currency figures and
 * their decoration and nothing may be left. That carve-out is deliberately narrow: it does not
 * reach a figure INSIDE prose, which is why ConvertLens's "Rate: 2 LENS per LXC · minimum 0.1
 * LXC" is untouched here and stays W1.1's Convert-surface decision.
 */

/** `$` followed by digits — the only currency form this product renders. */
const CURRENCY = /\$\s*\d[\d,]*(?:\.\d+)?/g

/**
 * What a figure may carry and still be a figure: the ≈ that marks a derived value, signs,
 * brackets, separators, whitespace. Anything else — a letter — means prose.
 */
const DECORATION = /[≈~+\-–—−()[\]{}\s,.:;·|/]/g

export interface RenderedFigure {
  /** the element's own text, e.g. "≈ $12.35" */
  text: string
  /** the element's own class attribute, which is what a fix would change */
  className: string
  tag: string
  onFace: boolean
}

/** An element's OWN text: its direct text children only. See TRAP ONE. */
export function ownText(el: Element): string {
  let s = ''
  for (const n of Array.from(el.childNodes)) if (n.nodeType === 3 /* TEXT_NODE */) s += n.nodeValue ?? ''
  return s
}

/** Is this text a figure and nothing else? See TRAP TWO. */
export function isFigureOnly(text: string): boolean {
  if (!CURRENCY.test(text)) {
    CURRENCY.lastIndex = 0
    return false
  }
  CURRENCY.lastIndex = 0
  return text.replace(CURRENCY, '').replace(DECORATION, '') === ''
}

/**
 * The face an element renders in: `font-figure` anywhere up the tree wins. `font-mono` does NOT
 * count — it is the same family without tnum, and a column of money that does not align is the
 * defect, not the family.
 */
export function onFigureFace(el: Element | null): boolean {
  for (let e: Element | null = el; e; e = e.parentElement) {
    if (/\bfont-figure\b/.test(e.getAttribute('class') ?? '')) return true
  }
  return false
}

/** Every currency figure rendered under `root`, and whether it landed on the face. */
export function currencyFiguresIn(root: ParentNode): RenderedFigure[] {
  const out: RenderedFigure[] = []
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const text = ownText(el)
    if (!isFigureOnly(text)) continue
    out.push({
      text: text.trim(),
      className: el.getAttribute('class') ?? '',
      tag: el.tagName.toLowerCase(),
      onFace: onFigureFace(el),
    })
  }
  return out
}

// ── THE RUNNING AUDIT ────────────────────────────────────────────────────────────────────────
//
// ⚠ TRAP THREE, AND THE ONE THAT WOULD HAVE MADE THIS GUARD UNFALSIFIABLE. Testing Library's
// auto-cleanup is registered when the TEST FILE imports it — after this setup file — and vitest
// runs `afterEach` hooks last-registered-first. MEASURED: during the test `document.body` is 50
// characters; in a setup-file `afterEach` it is 0. An audit that scanned the DOM in `afterEach`
// would have found nothing on every surface in the product and reported it as clean.
//
// So capture happens at COMMIT TIME through a MutationObserver, and `afterEach` only reads what
// was already recorded. figureAudit.test.tsx pins this: it renders in one test and asserts the
// record survived into the next, with the body verifiably empty.

const records: RenderedFigure[] = []
const seen = new Set<string>()
let offenders: RenderedFigure[] = []

function scan(): void {
  for (const f of currencyFiguresIn(document.body)) {
    const key = `${f.onFace}|${f.tag}|${f.className}|${f.text}`
    if (seen.has(key)) continue
    seen.add(key)
    records.push(f)
    if (!f.onFace) offenders.push(f)
  }
}

/** Start recording. Called once per test file, from test-setup.ts. */
export function installFigureAudit(): void {
  new MutationObserver(scan).observe(document, { subtree: true, childList: true, characterData: true })
}

/** Every currency figure this test file has rendered so far, on the face or not. */
export function auditedFigures(): readonly RenderedFigure[] {
  return records
}

/** The off-face figures seen since the last call, and clears them. */
export function takeOffenders(): RenderedFigure[] {
  const out = offenders
  offenders = []
  return out
}

/**
 * Test files that MUST render at least one currency figure, so this audit cannot pass by
 * rendering nothing. Each name is checked against the tree by figureAudit.test.tsx, so a
 * deleted or renamed file fails rather than silently leaving the audit with no work.
 *
 * This is a FLOOR, not a census: a new money surface is still audited the moment its test
 * renders it — it just does not have to be listed here to be policed.
 */
export const MUST_RENDER_CURRENCY: Record<string, string> = {
  'src/areas/lens/Overview.test.tsx': 'the LXC balance ≈USD and the month-to-date provider spend',
  'src/areas/lens/Spend.test.tsx': 'the same month-to-date spend, on its own surface',
  'src/areas/lens/spendHolds.test.tsx': 'Spend again, with holds — a different fixture over the same card',
  'src/areas/lens/TopUp.test.tsx': 'the buy buttons: the price you read immediately before spending money',
  'src/areas/lens/BillingReturn.test.tsx': 'the confirmation sentence and the new balance',
  'src/BillingRoutes.test.tsx': 'the billing routes end to end, buttons and confirmation',
  'src/areas/lens/Held.test.tsx': 'the held-funds view carries the balance card',
  'src/areas/track/IssueDetail.test.tsx': 'AI cost per issue — the product thesis, priced on the page',
}
