import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tokens, type TokenName } from '../tokens'

/**
 * THE BOARD, MADE AUDITABLE.
 *
 * The console speaks the brand board of 4 Oct 2026. Its token file ships beside this package as
 * brand/tokens.json — copied byte for byte from the brand package (brand-v4/tokens/tokens.json) —
 * and this file READS it, so the board is a check rather than a paraphrase. Every dark token is in
 * exactly one of four categories, and the partition must be total:
 *
 *   PORTED         — the dark value IS one of the board's five colours (Obsidian, Surface, Teal,
 *                    Frost, Muted). Drift fails here.
 *   BOARD_TOKEN    — the value IS the board file's themed token, in BOTH themes.
 *   DIVERGED       — deliberately different, with the reason.
 *   NO_COUNTERPART — the board has no such colour (no ledger hues, no routing ramp), so there is
 *                    nothing to port and nothing to drift from.
 *
 * ⚠ UNTIL B29.2 THE REFERENCE WAS A THIRD-PARTY DEPLOYMENT: the `@theme` block of the stylesheet
 * talyvor.higgsfield.app served (measured 2026-08-09, #88). Four of its values are the board's —
 * canvas, ink, muted, accent — and one is not: its `--color-ink-raise` #0B1220 is the board's
 * Surface #081220 three steps lighter in red, which is the one plane B29.2 moved.
 */

const BOARD_FILE = resolve(import.meta.dirname, '../../brand/tokens.json')

interface BoardToken {
  name: string
  value: string | { dark: string; light: string }
}
const board = JSON.parse(readFileSync(BOARD_FILE, 'utf8')) as { version: number; color: { tokens: BoardToken[] } }

function boardToken(name: string): BoardToken {
  const t = board.color.tokens.find((x) => x.name === name)
  if (t === undefined) throw new Error(`brand/tokens.json has no token named ${name}`)
  return t
}

/** The board's five colours, by the board's own names, and the token each is in the file. */
const FIVE = {
  Obsidian: 'brand-obsidian',
  Surface: 'brand-surface',
  Teal: 'brand-teal',
  Frost: 'brand-frost',
  Muted: 'brand-muted',
} as const
type BoardColour = keyof typeof FIVE

function colour(c: BoardColour): string {
  const v = boardToken(FIVE[c]).value
  if (typeof v !== 'string') throw new Error(`${FIVE[c]} is themed; a board colour is one value`)
  return v.toLowerCase()
}

/** Tokens whose dark value IS the named board colour. */
const PORTED: Partial<Record<TokenName, BoardColour>> = {
  canvas: 'Obsidian',
  surface: 'Surface',
  sidebar: 'Surface',
  ink: 'Frost',
  muted: 'Muted',
  accent: 'Teal',
}

/** Tokens that ARE the board file's themed token, light and dark: this name → the board's name. */
const BOARD_TOKEN: Partial<Record<TokenName, string>> = {
  raised: 'raised',
  label: 'label',
  'accent-hover': 'accent-hover',
  'accent-ink': 'on-accent',
  'accent-tint': 'accent-tint',
  settled: 'positive',
  held: 'caution',
  slashed: 'critical',
}

/**
 * Deliberate divergences. Each carries its reason — a divergence without one is drift with a
 * comment on it.
 */
const DIVERGED: Partial<Record<TokenName, { from: string; because: string }>> = {
  faint: {
    from: '(the board has no third text step)',
    because:
      "the board's secondary text is ink-muted and it stops there. This console puts `faint` on the µ-tail of " +
      "every money figure at 12.5px, lifted along the earlier site's txt-faint → txt-dim ray to the first point " +
      'that clears 4.5:1 on the dark canvas and surface (#6B7F96 = 4.81 / 4.56). It does not clear raised ' +
      '(4.25), so planes.ts refuses it on a card.',
  },
  rule: {
    from: 'rgba(126,147,171,0.18)',
    because:
      "the board's `line` is the Muted hue at .18; this is still the earlier site's hairline, rgba(156,196,224,.14). " +
      'B29.2 moves the planes and adds raised and label; the rules move with the screens that draw them.',
  },
  'rule-strong': {
    from: 'rgba(126,147,171,0.32)',
    because:
      "the board's `line-strong` is the Muted hue at .32; this is the earlier site's hairline at .26. Like `rule`, " +
      'it moves with the screens that draw it, not with the planes.',
  },
}

/** The board has no ledger hues and no routing ramp — nothing to port. */
const NO_COUNTERPART: readonly TokenName[] = ['lens', 'lxc', 'tier1', 'tier3']

/** The hues that are not the accent: the ledger, the ramp and the three states. */
const HUES: readonly TokenName[] = ['lens', 'lxc', 'tier1', 'tier3', 'settled', 'held', 'slashed']

/**
 * ⚠ THE SAME DECISION IS WRITTEN DOWN TWICE. `deploy/decision-expiry.sh` states this palette a
 * second time, in prose, as the DECISION line of its palette premise — "canvas #060A12, surface
 * #081220, ink #E6EEF7, muted #7E93AB, accent #3AD6C0". Two copies of one decision with nothing
 * between them: move the board, update one, and the other keeps asserting the old numbers with
 * total confidence and no red anywhere.
 *
 * This reads the register and requires the two to agree. It is keyed on the PORTED tokens — the
 * register names the ones a reader of a runbook would recognise.
 */
const REGISTER = resolve(import.meta.dirname, '../../../../deploy/decision-expiry.sh')
const PREMISE = "the console's dark palette IS the brand board's"

describe('the register and this table are the same decision', () => {
  it('decision-expiry.sh states the palette decision, and states it once', () => {
    const text = readFileSync(REGISTER, 'utf8')
    const lines = text.split('\n').filter((l) => l.includes(PREMISE))
    expect(
      lines,
      'the palette premise is not in deploy/decision-expiry.sh under the wording this test ' +
        'reads. If it moved, move this check with it — do not delete it: an unread register is ' +
        'the failure that register exists to prevent.',
    ).toHaveLength(1)
  })

  it('every hex the register names is the token this table ports', () => {
    const line = readFileSync(REGISTER, 'utf8')
      .split('\n')
      .find((l) => l.includes(PREMISE))!
    // "canvas #060A12, surface #081220, …" → the pairs the runbook reader actually sees
    const named = new Map<string, string>()
    for (const m of line.matchAll(/([a-z-]+)\s+(#[0-9A-Fa-f]{6})/g)) named.set(m[1], m[2].toLowerCase())

    expect(named.size, `no "<token> #HEX" pairs found in the register line: ${line}`).toBeGreaterThanOrEqual(5)
    for (const [token, hex] of named) {
      expect(PORTED[token as TokenName], `the register names a token this table does not port: ${token}`).toBeDefined()
      expect(tokens.dark[token as TokenName].toLowerCase(), `${token} disagrees with the register`).toBe(hex)
    }
  })
})

describe('the board file is the board', () => {
  it('brand/tokens.json is version 4 of the board and names all five colours as hex', () => {
    expect(board.version).toBe(4)
    for (const c of Object.keys(FIVE) as BoardColour[]) expect(colour(c), c).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('the dark theme is the board, or says exactly where it is not', () => {
  it('the classification is total — every dark token is ported, a board token, diverged, or has no counterpart', () => {
    const declared = Object.keys(tokens.dark) as TokenName[]
    const classified = new Set<string>([
      ...Object.keys(PORTED),
      ...Object.keys(BOARD_TOKEN),
      ...Object.keys(DIVERGED),
      ...NO_COUNTERPART,
    ])
    const unclassified = declared.filter((t) => !classified.has(t))
    expect(
      unclassified,
      `token(s) with no stated relationship to the board: ${unclassified.join(', ')} — port it, or say why it differs`,
    ).toEqual([])
  })

  it('no token claims two relationships at once', () => {
    const seen = new Map<string, number>()
    for (const t of [...Object.keys(PORTED), ...Object.keys(BOARD_TOKEN), ...Object.keys(DIVERGED), ...NO_COUNTERPART]) {
      seen.set(t, (seen.get(t) ?? 0) + 1)
    }
    const doubled = [...seen].filter(([, n]) => n > 1).map(([n]) => n)
    expect(doubled, `token(s) classified twice: ${doubled.join(', ')}`).toEqual([])
  })

  for (const [token, c] of Object.entries(PORTED) as [TokenName, BoardColour][]) {
    it(`${token} IS the board's ${c}`, () => {
      expect(tokens.dark[token].toLowerCase()).toBe(colour(c))
    })
  }

  for (const [token, name] of Object.entries(BOARD_TOKEN) as [TokenName, string][]) {
    it(`${token} IS the board's ${name}, light and dark`, () => {
      const v = boardToken(name).value
      expect(typeof v, `${name} is not themed in the board file`).toBe('object')
      const { light, dark } = v as { light: string; dark: string }
      expect(tokens.light[token].toLowerCase(), `light ${token}`).toBe(light.toLowerCase())
      expect(tokens.dark[token].toLowerCase(), `dark ${token}`).toBe(dark.toLowerCase())
    })
  }

  for (const [token, note] of Object.entries(DIVERGED) as [TokenName, { from: string; because: string }][]) {
    it(`${token} diverges from ${note.from}, and still does`, () => {
      // The point of asserting the divergence: if someone later "fixes" it to the board's value,
      // the reason above is lost silently. This makes that a failing test instead.
      expect(tokens.dark[token].replace(/\s+/g, '').toLowerCase()).not.toBe(note.from.toLowerCase())
      expect(note.because.length, `${token}'s divergence has no stated reason`).toBeGreaterThan(60)
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
    for (let i = 0; i < HUES.length; i++) {
      for (let j = i + 1; j < HUES.length; j++) {
        tightestOther = Math.min(tightestOther, dist(tokens.dark[HUES[i]], tokens.dark[HUES[j]]))
      }
    }
    const nearest = HUES.map((t) => ({ t, d: dist(tokens.dark[t], tokens.dark.accent) })).sort(
      (a, b) => a.d - b.d,
    )[0]
    expect(
      nearest.d,
      `${nearest.t} sits ${nearest.d.toFixed(1)} from the accent while the palette's own tightest pair is ` +
        `${tightestOther.toFixed(1)} apart — the accent is no longer the one electric thing`,
    ).toBeGreaterThanOrEqual(tightestOther)
  })
})
