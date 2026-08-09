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
 * ── #95: THE RULE WAS NEVER "EVERY MONEY FIGURE". IT IS "EVERY NUMERAL". ─────────────────────
 *
 * preset.ts §THE FIGURE FACE, written by #88, says it in one line: "Every numeral in the product
 * renders here." The brief it was ported from says MONOSPACE FOR EVERY NUMERAL. Three merges then
 * swept for MONEY — #93 by name, #94 by `$` on screen — and nothing ever asked about a figure that
 * is not money. MEASURED at `565bdc0` with both guards green, by recording every rendered element
 * whose own text is a figure and nothing else: 139 such elements, 131 on the face, FOUR SOURCE
 * SITES off it, and every one of them a quantity rather than a price:
 *
 *     ConvertLens  Rate: <span class="text-ink">{lens_per_lxc}</span> LENS per LXC     ← the sans
 *     ConvertLens  minimum <span class="text-ink">{microsToUnits(min_lxc_ulxc)}</span> ← the sans
 *     CacheCard    <span class="font-mono …">{cache_hits.toLocaleString()}</span>      ← no tnum
 *     CacheCard    <span class="text-body text-muted">≈ {hit_rate*100}%</span>         ← the sans
 *
 * ⚠ THE LAST ONE IS THE ARGUMENT. `≈ <derived value>` in a muted caption is a shape this product
 * renders in four places — Overview, Spend, TopUp, BillingReturn — and in all four it is
 * `font-figure text-body text-muted`. CacheCard renders the same shape one class short. That is
 * not a fifth opinion about hit rates; it is the same treatment, missed.
 *
 * ⚠ AND WHY THIS IS STILL NOT A SOURCE RULE — the question W1.1 left for this merge was whether to
 * classify `microsToUnits` instead. MEASURED: that closes exactly ONE of the four. `lens_per_lxc`
 * is a bare field read with no call at all; the other two go through `toLocaleString` and
 * `Math.round`, which are also how identifiers and step indices are rendered. Classifying those
 * two would police every call site of two JavaScript builtins to reach two figures. The DOM knows
 * which of them ended up as a figure on screen; the source does not.
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
 * policed only when its own text is A FIGURE AND NOTHING ELSE — remove the figures and their
 * decoration and nothing may be left. ⚠ THAT CARVE-OUT IS WHAT KEEPS THE BROADENED RULE HONEST
 * rather than what weakens it: measured over the whole suite, it leaves 189 digit-bearing
 * elements unpoliced — every date ("Jul 19, 17:52"), every issue ref ("TAL-1"), every key prefix
 * ("tlv_ws_7c0ffee0"), every window button ("7d"), every counted sentence ("8 requests recorded
 * in the last 30 days"). A figure with a WORD beside it inside one element is prose. A figure
 * alone in its own element is a figure, and ConvertLens gives its rate its own span.
 */

/** Any number, with thousands separators and a decimal tail. */
const FIGURE = /\d[\d,]*(?:\.\d+)?/g

/**
 * What a figure may carry and still be a figure: the currency mark, the percent that makes it a
 * rate, the ≈ that marks a derived value, signs, brackets, separators, whitespace. Anything else
 * — a letter — means prose. `_` is deliberately absent, which is what keeps `tlv_ws_7c0ffee0` and
 * `cs_test_a1b2c3` out.
 */
const DECORATION = /[$%≈~+\-–—−()[\]{}\s,.:;·|/]/g

/** Non-global on purpose: `.test()` on a /g regex is stateful and skips every other call. */
const HAS_CURRENCY = /\$\s*\d/
const HAS_DIGIT = /\d/

/**
 * Money and everything else. Kept apart for one reason that is not cosmetic: MUST_RENDER_CURRENCY
 * is a floor that says "this file renders MONEY". Broadening the audit without keeping the kind
 * would let a file satisfy that floor by rendering a bare `1`, which is a weaker guard wearing the
 * same name.
 */
export type FigureKind = 'currency' | 'quantity'

export interface RenderedFigure {
  /** the element's own text, e.g. "≈ $12.35" */
  text: string
  /** the element's own class attribute, which is what a fix would change */
  className: string
  tag: string
  onFace: boolean
  kind: FigureKind
}

/** An element's OWN text: its direct text children only. See TRAP ONE. */
export function ownText(el: Element): string {
  let s = ''
  for (const n of Array.from(el.childNodes)) if (n.nodeType === 3 /* TEXT_NODE */) s += n.nodeValue ?? ''
  return s
}

/** What kind of figure this text is, or null if it is not a figure alone. See TRAP TWO. */
export function figureKind(text: string): FigureKind | null {
  if (!HAS_DIGIT.test(text)) return null
  if (text.replace(FIGURE, '').replace(DECORATION, '') !== '') return null
  return HAS_CURRENCY.test(text) ? 'currency' : 'quantity'
}

/** Is this text a figure and nothing else? */
export function isFigureOnly(text: string): boolean {
  return figureKind(text) !== null
}

/**
 * The face an element renders in: `font-figure` anywhere up the tree wins. `font-mono` does NOT
 * count. ⚠ That distinction is load-bearing and not theoretical: CacheCard's cached-serve count
 * was `font-mono`, and W1.1's own note that "the 20 font-mono call sites are IDENTIFIERS, not
 * figures" was true of sixteen of the seventeen.
 *
 * ⚠ BUT THE REASON WRITTEN HERE WAS FALSE, AND THE CORRECTION IS THE PART WORTH KEEPING. This
 * said `font-mono` is "the same family without tnum, and a column of figures that does not align
 * is the defect". MEASURED off the shipped binaries (glyphAudit.test.tsx pins it): the served IBM
 * Plex Mono subsets declare NO `tnum` feature at all, so `font-figure`'s
 * `font-feature-settings: "tnum" 1` has nothing to switch on — and all ten digits in those subsets
 * already advance 600 units, so a `font-mono` column ALIGNS. The two utilities are
 * rendering-identical in the browser. The SANS is the one with `tnum` and nine distinct digit
 * advances, which is presumably where the sentence came from before numerals moved to mono.
 *
 * ⚠ THE RULE IS UNCHANGED AND DELIBERATELY SO. One named utility for figures is still worth
 * having, and narrowing or widening it is a design decision, not a correction. What is corrected
 * is the claim that the browser can see the difference: it cannot, so this rule buys CONSISTENCY,
 * not alignment, and should be argued on that.
 */
export function onFigureFace(el: Element | null): boolean {
  for (let e: Element | null = el; e; e = e.parentElement) {
    if (/\bfont-figure\b/.test(e.getAttribute('class') ?? '')) return true
  }
  return false
}

/** Every figure rendered under `root`, and whether it landed on the face. */
export function figuresIn(root: ParentNode): RenderedFigure[] {
  const out: RenderedFigure[] = []
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const text = ownText(el)
    const kind = figureKind(text)
    if (!kind) continue
    out.push({
      text: text.trim(),
      className: el.getAttribute('class') ?? '',
      tag: el.tagName.toLowerCase(),
      onFace: onFigureFace(el),
      kind,
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
  for (const f of figuresIn(document.body)) {
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

/** Every figure this test file has rendered so far, on the face or not. */
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
 * Does this file's record satisfy a floor of `kind`? One line, exported for one reason: it is the
 * whole content of the floor check in test-setup.ts, and a floor that quietly accepted the wrong
 * kind would be untestable if it lived only inside an `afterAll`.
 */
export function satisfiesFloor(figures: readonly RenderedFigure[], kind: FigureKind): boolean {
  return figures.some((f) => f.kind === kind)
}

/**
 * Test files that MUST render at least one CURRENCY figure, so this audit cannot pass by
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

/**
 * The same floor for the half of the rule that is NOT money. ⚠ It is a separate table because it
 * answers a separate way of going quietly green: narrow `FIGURE` back to a `$` form and every
 * currency floor above still passes while the quantity rule stops policing anything. MEASURED as
 * a control — that one edit reds all four files below, and blinding the observer entirely now
 * reds ELEVEN files where #94 measured nine, because Ledger and Convert render no money at all
 * and only this table asks them for anything.
 *
 * ⚠ AND WHAT IT DOES NOT CATCH, measured rather than assumed: dropping `%` from DECORATION —
 * which silently stops policing CacheCard's hit rate — leaves every file here green, because each
 * still renders some OTHER quantity on the face. A floor answers "did this file render one", not
 * "did it render the one you care about". That narrowing is caught by a named case in
 * figureAudit.test.tsx instead, which is the right place for it and not a second-best.
 */
export const MUST_RENDER_QUANTITY: Record<string, string> = {
  'src/areas/lens/Ledger.test.tsx': 'every µLENS and µLXC row amount — the ledger is nothing but figures',
  'src/areas/lens/Overview.test.tsx': 'the LXC and LENS balances, and the cache card’s serve count and hit rate',
  'src/areas/lens/Convert.test.tsx': 'the conversion rate and the LXC minimum, both read from the deployment',
  'src/areas/lens/Held.test.tsx': 'the held LENS amount, and the same rate and minimum under a second fixture',
}
