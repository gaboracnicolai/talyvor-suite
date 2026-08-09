import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tokens, type TokenName } from '../tokens'

/**
 * THE PORT, MADE AUDITABLE.
 *
 * W1.1 asks the console to speak the public site's visual language. A port described in
 * prose is a claim; this makes it a check. Every dark token is in exactly one of three
 * categories, and the partition must be total:
 *
 *   PORTED       — the value IS a site variable, byte for byte. Drift fails here.
 *   DIVERGED     — deliberately different, with the MEASUREMENT that forced it.
 *   NO_COUNTERPART — the site has no such colour (it has no ledger, no held state, no
 *                    routing ramp), so there is nothing to port and nothing to drift from.
 *
 * ⚠ WHERE THE SITE VALUES COME FROM. Not from a screenshot and not from the brief's
 * paraphrase — from the stylesheet the site actually serves, `@theme` block. The site is a
 * THIRD-PARTY ARTIFACT this repo cannot reach from CI, so it is registered as an UNCHECKABLE
 * premise in deploy/decision-expiry.sh rather than pretended to be verified on every run.
 * What this test guards is that OUR side of the port has not moved since it was measured.
 *
 * ── PROVENANCE, AND WHY THE FILENAME IS NOT PART OF IT ──────────────────────
 *
 *   2026-08-09  /assets/styles-CGSz1SmS.css   the original measurement (#88)
 *   2026-08-09  /assets/styles-AuqlUACj.css   RE-MEASURED after a redeploy — all nine values
 *                                             below byte-identical, sha 9e15abe, 332,038 bytes
 *
 * ⚠ THE FIRST URL NOW 404s AND THE PALETTE DID NOT CHANGE. Both facts at once, which is the
 * whole lesson: the stylesheet is CONTENT-HASHED, so its name changes when ANY byte of the
 * site's CSS changes — a new section, a new utility, a Tailwind bump — and says nothing about
 * these nine variables. `resolves ⇒ unchanged` is sound; `404 ⇒ changed` is not, and until
 * this merge the expiry register asserted the second one. Pin the VALUES, never the filename;
 * the command in decision-expiry.sh now reads the stylesheet URL out of the served HTML.
 */

// Verbatim from the served stylesheet's @theme block. Lower-case as served.
const SITE = {
  '--color-ink': '#060a12',
  '--color-ink-raise': '#0b1220',
  '--color-ink-panel': '#0d1526',
  '--color-hairline': '#9cc4e024',
  '--color-txt': '#e6eef7',
  '--color-txt-dim': '#7e93ab',
  '--color-txt-faint': '#55677e',
  '--color-acc': '#3ad6c0',
  '--color-acc-dim': '#3ad6c029',
} as const
type SiteVar = keyof typeof SITE

/** Tokens whose dark value IS the named site variable. */
const PORTED: Partial<Record<TokenName, SiteVar>> = {
  canvas: '--color-ink',
  surface: '--color-ink-raise',
  ink: '--color-txt',
  muted: '--color-txt-dim',
  accent: '--color-acc',
}

/**
 * Deliberate divergences. Each carries the number that forced it — a divergence without a
 * measurement is drift with a comment on it.
 */
const DIVERGED: Partial<Record<TokenName, { from: string; because: string }>> = {
  sidebar: {
    from: '(the site has no sidebar)',
    because:
      "the site's own chrome is the PAGE colour separated by a rule, not a second plane — its header is " +
      '`bg-ink/80 border-b`, measured in the served markup. The rail follows it: sidebar === canvas, and the ' +
      '`border-r border-rule` in Shell is what separates them. This also removed two AA failures the old ' +
      'greyer rail carried (light muted 4.40:1, light accent 4.36:1 against it).',
  },
  faint: {
    from: '#55677e',
    because:
      "the site's txt-faint measures 3.42:1 on its own page black — it fails AA body, and the site uses it only " +
      'for 11px eyebrow labels. This console puts `faint` on the µ-tail of every money figure at 12.5px, so the ' +
      'value is lifted along the site\'s OWN txt-faint → txt-dim ray to the first point that clears 4.5:1 against ' +
      'both dark planes (#6B7F96 = 4.81 canvas / 4.55 surface). Minimum distance, same colour ray.',
  },
  rule: {
    from: '#9cc4e024',
    because:
      'identical colour, written as rgba() because tokens.ts states alpha that way elsewhere and theme.css mirrors ' +
      'it verbatim: #9cc4e0 = rgb(156,196,224) and 0x24/255 = .141 → rgba(156,196,224,.14).',
  },
  'accent-tint': {
    from: '#3ad6c029',
    because:
      'the site\'s acc-dim is a translucent overlay; this system pins an OPAQUE tint (design-fixes correction 3) so ' +
      'one value serves every plane. #0E2B2E is exactly `--color-acc-dim` composited over `--color-ink` — what the ' +
      'site actually renders — and lands in the working band the correction pinned: 1.32:1 vs canvas, 1.25:1 vs ' +
      'surface, ink on it 12.78:1, 8.24:1 clear of the full fill.',
  },
  'rule-strong': {
    from: '(the site has one hairline)',
    because:
      'a marketing page separates a handful of panels; a console separates rows inside tables inside cards. The ' +
      "second weight is the same hue at .26 alpha — the site's hairline, not a new colour.",
  },
  'accent-hover': {
    from: '(the site has no hover token)',
    because:
      'the site hovers TO the accent from dim text, so it never needs a step past it. A console has filled ' +
      'controls that must show a press, so this is one step lighter on the same hue (#55DFCC, 12.09:1 on canvas).',
  },
  'accent-ink': {
    from: '(the site never puts text on the accent)',
    because:
      'measured: `bg-acc` appears 9 times in the served markup and every one is a 1px underline or a 6px dot — the ' +
      'site has NO filled accent button. A console needs an unambiguous primary, so the fill is kept and takes the ' +
      "page black as its ink (#060A12 on #3AD6C0 = 10.91:1). This is a divergence from the site, on purpose.",
  },
}

/** The site has no ledger, no held state and no routing ramp — nothing to port. */
const NO_COUNTERPART: readonly TokenName[] = ['lens', 'lxc', 'tier1', 'tier3', 'settled', 'held', 'slashed']

/**
 * ⚠ THE SAME MEASUREMENT WAS WRITTEN DOWN TWICE. `deploy/decision-expiry.sh` states this
 * palette a second time, in prose, as the DECISION line of its W1.1 premise — "canvas #060A12,
 * surface #0B1220, ink #E6EEF7, muted #7E93AB, accent #3AD6C0". Two copies of one measurement
 * with nothing between them: re-measure the site, update one, and the other keeps asserting the
 * old numbers with total confidence and no red anywhere. The register is the file a deploy is
 * supposed to TRUST, so it is the worse of the two to leave stale.
 *
 * This reads the register and requires the two to agree. It is deliberately keyed on the five
 * PORTED tokens rather than on all nine site variables — the register names the tokens a reader
 * of a runbook would recognise, and a divergence is not a port.
 */
const REGISTER = resolve(import.meta.dirname, '../../../../deploy/decision-expiry.sh')

describe('the register and this table are the same measurement', () => {
  it('decision-expiry.sh states the palette decision, and states it once', () => {
    const text = readFileSync(REGISTER, 'utf8')
    const lines = text.split('\n').filter((l) => l.includes("the console's dark palette IS the public site's"))
    expect(
      lines,
      'the W1.1 palette premise is not in deploy/decision-expiry.sh under the wording this test ' +
        'reads. If it moved, move this check with it — do not delete it: an unread register is ' +
        'the failure that register exists to prevent.',
    ).toHaveLength(1)
  })

  it('every hex the register names is the token this table ports', () => {
    const line = readFileSync(REGISTER, 'utf8')
      .split('\n')
      .find((l) => l.includes("the console's dark palette IS the public site's"))!
    // "canvas #060A12, surface #0B1220, …" → the pairs the runbook reader actually sees
    const named = new Map<string, string>()
    for (const m of line.matchAll(/([a-z-]+)\s+(#[0-9A-Fa-f]{6})/g)) named.set(m[1], m[2].toLowerCase())

    expect(named.size, `no "<token> #HEX" pairs found in the register line: ${line}`).toBeGreaterThanOrEqual(5)
    for (const [token, hex] of named) {
      expect(PORTED[token as TokenName], `the register names a token this table does not port: ${token}`).toBeDefined()
      expect(tokens.dark[token as TokenName].toLowerCase(), `${token} disagrees with the register`).toBe(hex)
    }
  })
})

describe('the dark theme is the site, or says exactly where it is not', () => {
  it('the classification is total — every dark token is ported, diverged, or has no counterpart', () => {
    const declared = Object.keys(tokens.dark) as TokenName[]
    const classified = new Set<string>([
      ...Object.keys(PORTED),
      ...Object.keys(DIVERGED),
      ...NO_COUNTERPART,
    ])
    const unclassified = declared.filter((t) => !classified.has(t))
    expect(
      unclassified,
      `token(s) with no stated relationship to the site: ${unclassified.join(', ')} — port it, or say why it differs`,
    ).toEqual([])
  })

  it('no token claims two relationships at once', () => {
    const seen = new Map<string, number>()
    for (const t of [...Object.keys(PORTED), ...Object.keys(DIVERGED), ...NO_COUNTERPART]) {
      seen.set(t, (seen.get(t) ?? 0) + 1)
    }
    const doubled = [...seen].filter(([, n]) => n > 1).map(([n]) => n)
    expect(doubled, `token(s) classified twice: ${doubled.join(', ')}`).toEqual([])
  })

  for (const [token, siteVar] of Object.entries(PORTED) as [TokenName, SiteVar][]) {
    it(`${token} IS the site's ${siteVar}`, () => {
      expect(tokens.dark[token].toLowerCase()).toBe(SITE[siteVar])
    })
  }

  for (const [token, note] of Object.entries(DIVERGED) as [TokenName, { from: string; because: string }][]) {
    it(`${token} diverges from ${note.from}, and still does`, () => {
      // The point of asserting the divergence: if someone later "fixes" it back to the site
      // value, the reason above is lost silently. This makes that a failing test instead.
      expect(tokens.dark[token].toLowerCase()).not.toBe(note.from.toLowerCase())
      expect(note.because.length, `${token}'s divergence has no stated measurement`).toBeGreaterThan(60)
    })
  }

  it('the accent is the ONE electric hue — it stands further out than the palette stands apart', () => {
    /**
     * "ONE electric accent used sparingly" erodes by a second hue drifting into the
     * accent's neighbourhood, never by someone declaring a second accent. So the check
     * is a comparison, not a magic constant:
     *
     *   the accent's distance to its NEAREST neighbour  >=  the closest two other hues
     *                                                       are to each other
     *
     * Self-calibrating: it asks whether the accent is at least as distinct from the
     * palette as the palette's own members are from each other. If the ledger hues are
     * later spread apart, the bar the accent must clear rises with them.
     *
     * ⚠ IT WAS RED BEFORE THE PORT, which is why it is here. On the palette this
     * replaced, the accent (#3ABDC9) sat 28.4 from tier1 while the tightest other pair
     * (lens↔tier3) sat 30.6 apart: the accent was literally closer to the routing ramp
     * than the palette was to itself, and three hues crowded it. Ported, the accent's
     * nearest is 42.8 against the same 30.6 floor.
     *
     * ⚠ SEPARATELY MEASURED, NOT FIXED HERE: lens↔tier3 = 30.6 is tight in absolute
     * terms — copper and warm amber are hard to tell apart as 2px ticks. That is a real
     * finding about the ledger hues and it is NOT this port's to change; recorded so the
     * next palette pass starts from a number.
     */
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
    const dist = (a: string, b: string) => {
      const [x, y, z] = rgb(a)
      const [p, q, r] = rgb(b)
      return Math.sqrt((x - p) ** 2 + (y - q) ** 2 + (z - r) ** 2)
    }
    let tightestOther = Infinity
    for (let i = 0; i < NO_COUNTERPART.length; i++) {
      for (let j = i + 1; j < NO_COUNTERPART.length; j++) {
        tightestOther = Math.min(tightestOther, dist(tokens.dark[NO_COUNTERPART[i]], tokens.dark[NO_COUNTERPART[j]]))
      }
    }
    const nearest = NO_COUNTERPART.map((t) => ({ t, d: dist(tokens.dark[t], tokens.dark.accent) })).sort(
      (a, b) => a.d - b.d,
    )[0]
    expect(
      nearest.d,
      `${nearest.t} sits ${nearest.d.toFixed(1)} from the accent while the palette's own tightest pair is ` +
        `${tightestOther.toFixed(1)} apart — the accent is no longer the one electric thing`,
    ).toBeGreaterThanOrEqual(tightestOther)
  })
})
