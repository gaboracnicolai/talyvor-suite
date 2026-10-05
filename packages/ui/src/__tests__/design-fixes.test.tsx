import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { Mark } from '../components/Mark'
import { MuNumeral } from '../components/MuNumeral'
import { NavItem } from '../components/NavItem'
import { Wordmark } from '../components/Wordmark'
import preset from '../preset'
import { tokens } from '../tokens'

// The four deployed-app corrections, pinned at the design-system layer.

/**
 * ⚠ CORRECTION 1 HAS BEEN REVERSED, and the reversal is deliberate rather than a drift.
 *
 * It used to read "numerals are SANS with tabular figures; mono is for identifiers", on the
 * premise that mono was a FOREIGN face here — it appeared only on SHAs, key prefixes and
 * endpoints, so seeing it meant "machine string you might copy", and "this is a number" is
 * not a message worth a face.
 *
 * The premise was true of a system-font stack. It is not true of the ported type language:
 * the site's one small-label utility IS the mono face (`font-family: var(--font-mono);
 * font-feature-settings: "tnum" 1`), so mono is now on every eyebrow label on every screen.
 * It no longer says "identifier" — it says "measured" — and W1.1 asks for monospace on every
 * numeral. What still separates an identifier from a figure is the tracking and the size
 * step, not the family.
 *
 * The assertion is kept, inverted, rather than deleted: a future "restore the sans numerals"
 * cleanup should have to argue with this, not slip past a gap.
 */
describe('correction 1, REVERSED — numerals are MONO with tabular figures (the figure face)', () => {
  it('MuNumeral carries font-figure and no loose tabular-nums', () => {
    const { container } = render(<MuNumeral micros={12_340_567} unit="lens" />)
    const wrap = container.firstElementChild!
    expect(wrap.className).toContain('font-figure')
    expect(wrap.className).not.toContain('tabular-nums')
  })
  it('the µ-split survives the face change: whole emphasised, tail dimmed and underscored', () => {
    render(<MuNumeral micros={12_340_567} unit="lens" />)
    expect(screen.getByText('12').className).toContain('text-ink')
    const tail = screen.getByText('.340567')
    expect(tail.className).toContain('text-faint')
    expect(tail.className).toContain('underline')
  })
})

describe('correction 2 — the scale steps up one', () => {
  const size = (name: string) => (preset.theme!.extend!.fontSize as Record<string, [string, unknown]>)[name][0]
  /**
   * The RENDERED size of a step at the browser's default root, in px.
   *
   * ⚠ THESE FOUR ASSERTIONS USED TO READ THE LITERAL `'14px'`. The console scale is now declared
   * in `rem` so that the reader's own browser font-size preference reaches it (preset.ts
   * §THE CONSOLE SCALE), and the SIZES did not move: 0.875rem × 16 is the same 14px it always
   * was. This correction is about the RAMP — 14/12/17/24, and a µ-tail smaller than the whole —
   * so it is asserted as the ramp rather than as a string that happens to spell it.
   * The unit itself is guarded, in both directions, by apps/web/src/typeScaleUnits.test.ts.
   */
  const px = (name: string): number => {
    const decl = size(name)
    const m = /^([0-9]*\.?[0-9]+)(rem|px)$/.exec(decl)
    if (!m) throw new Error(`\`${name}\` is declared \`${decl}\`, which is neither a rem nor a px length`)
    return m[2] === 'rem' ? Number(m[1]) * 16 : Number(m[1])
  }
  it('body 14, caption 12, head 17, title 24', () => {
    expect(px('body')).toBe(14)
    expect(px('caption')).toBe(12)
    expect(px('head')).toBe(17)
    expect(px('title')).toBe(24)
  })
  it('the µ-tail moves with the scale (dimmer AND smaller than the whole)', () => {
    expect(px('micro')).toBe(12.5)
    expect(px('micro')).toBeLessThan(px('body'))
  })
})

describe('correction 3 — the accent appears on interaction (never on text)', () => {
  it('the tint values are PINNED — chosen against the surfaces, not symmetrically', () => {
    // The original pin: light was #E4F0F1, 1.07:1 against the sidebar — under the
    // threshold where a hover reads as a hover. It was replaced by a value chosen
    // against the surfaces rather than by symmetry with dark, and pinned so a future
    // "symmetry" cleanup could not quietly reintroduce the mistake.
    //
    // ⚠ THE VALUES MOVED WITH THE PALETTE; THE CRITERION DID NOT. Re-derived against
    // the ported surfaces and re-measured, not eyeballed across:
    //
    //   dark  #0E2B2E — exactly the site's own --color-acc-dim composited over its
    //                   --color-ink, i.e. what the site actually renders. 1.32:1 vs
    //                   canvas, 1.25:1 vs surface (the band the old pin worked in was
    //                   1.35/1.21); ink on it 12.78:1; 8.24:1 clear of the full fill.
    //   light #C9E6E0 — 1.22:1 vs canvas, 1.32:1 vs surface (old: 1.20/1.32 — the same
    //                   deltas); ink on it 14.16:1; 3.95:1 clear of the fill (old: 3.86).
    //
    // contrast.test.ts holds the floors these numbers must not fall below; this holds
    // the exact values, so a nudge is a decision someone makes on purpose.
    expect(tokens.light['accent-tint']).toBe('#C9E6E0')
    expect(tokens.dark['accent-tint']).toBe('#0E2B2E')
  })
  // B29.7 — the board's PRODUCT UI tile puts the selected row's label in the accent, on the tint.
  it('nav hover and selection are accent-tinted; the selected label is accent-strong', () => {
    render(<NavItem active>Ledger</NavItem>)
    const active = screen.getByRole('button', { name: 'Ledger' })
    expect(active.className).toContain('bg-accent-tint')
    expect(active.className).toContain('text-accent-strong')
    render(<NavItem>Keys</NavItem>)
    expect(screen.getByRole('button', { name: 'Keys' }).className).toContain('hover:bg-accent-tint')
  })
  it('every button variant presses accent-tinted (primary presses deeper accent)', () => {
    render(<Button>Plain</Button>)
    expect(screen.getByRole('button', { name: 'Plain' }).className).toContain('active:bg-accent-tint')
    render(<Button variant="danger">Risky</Button>)
    expect(screen.getByRole('button', { name: 'Risky' }).className).toContain('active:bg-accent-tint')
    render(<Button variant="primary">Go</Button>)
    expect(screen.getByRole('button', { name: 'Go' }).className).toContain('active:bg-accent-hover')
  })
})

describe('input-width — a width passed to Input is the width it gets', () => {
  // cn() is plain clsx, and w-full comes after w-28 in Tailwind's sheet, so a field given w-28
  // beside the old hard-coded w-full rendered full width anyway: every Wallets form field (B23.10).
  it('full width by default, the given width instead of it, and full width under a responsive one', () => {
    render(
      <>
        <Input aria-label="plain" />
        <Input aria-label="amount" className="w-28 font-figure" />
        <Input aria-label="memo" className="wide:w-56" />
      </>,
    )
    const cls = (name: string) => screen.getByRole('textbox', { name }).className.split(/\s+/)
    expect(cls('plain')).toContain('w-full')
    expect(cls('amount')).toContain('w-28')
    expect(cls('amount')).not.toContain('w-full')
    expect(cls('memo')).toEqual(expect.arrayContaining(['w-full', 'wide:w-56']))
  })
})

describe('button-fit — a fixed-height control must never let its label wrap', () => {
  // The defect (measured in a real browser vs the emitted CSS): Button/Select are
  // fixed-height (h-8, for row alignment with Inputs) but had no whitespace-nowrap,
  // so a long label in a constrained slot wrapped to two lines and the second line
  // rendered through the bottom border (scrollHeight 35 > clientHeight 30). The 13→14
  // scale widened labels and exposed it. Fix = forbid the wrap, keep the height.
  it('Button carries whitespace-nowrap', () => {
    render(<Button>Regenerate token</Button>)
    expect(screen.getByRole('button', { name: 'Regenerate token' }).className).toContain('whitespace-nowrap')
  })
  it('Button keeps its fixed h-8 (alignment with h-8 inputs is a design choice, not the bug)', () => {
    render(<Button>x</Button>)
    expect(screen.getByRole('button', { name: 'x' }).className).toContain('h-8')
  })
})

describe('correction 4 — the mark and the wordmark', () => {
  // B29.3: the brand-v4 vectors replace the CSS tile (a hairline track, 62.5% accent) and the
  // name typed in a font. Each is checked against the brand file B29.1 shipped in the web app,
  // so a redrawn or recoloured logo fails here: the paths must be the file's, and in each theme
  // the fills must resolve to that theme's file.
  const svgDir = resolve(import.meta.dirname, '../../../../apps/web/public/brand/svg')
  const css = readFileSync(resolve(import.meta.dirname, '../theme.css'), 'utf8')
  const brandPaths = (file: string) =>
    [...readFileSync(resolve(svgDir, file), 'utf8').matchAll(/<path fill="([^"]+)" d="([^"]+)"/g)].map((m) => ({
      fill: m[1],
      d: m[2],
    }))
  // The logo's colours: the two theme.css blocks that declare --wordmark, keyed by their selector.
  const logoBlocks = [...css.matchAll(/([^{}]*)\{([^{}]*--wordmark[^{}]*)\}/g)]
  expect(logoBlocks).toHaveLength(2)
  const logoVars = (theme: string) => {
    const block = logoBlocks.find((m) => m[1].includes(`[data-theme='${theme}']`))![2]
    return Object.fromEntries([...block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
  }
  const themes = { dark: logoVars('dark'), light: logoVars('light') }
  const resolveFill = (el: Element, vars: Record<string, string>) =>
    vars[(el as SVGElement).style.fill.match(/^var\(--([\w-]+)\)$/)![1]]

  it('the mark is the flat mark file, path for path, in each theme its own file’s colours', () => {
    render(<Mark />)
    const mark = screen.getByRole('img', { name: 'Talyvor' })
    expect(mark.tagName.toLowerCase()).toBe('svg')
    expect(mark.querySelector('[data-fill]'), 'the CSS tile is gone').toBeNull()
    const drawn = [...mark.querySelectorAll('path')]
    for (const [theme, file] of [
      ['dark', 'talyvor-mark-flat-dark.svg'],
      ['light', 'talyvor-mark-flat-light.svg'],
    ] as const) {
      const brand = brandPaths(file)
      expect(brand).toHaveLength(5)
      expect(drawn.map((p) => p.getAttribute('d'))).toEqual(brand.map((p) => p.d))
      expect(drawn.map((p) => resolveFill(p, themes[theme])), theme).toEqual(brand.map((p) => p.fill))
    }
  })

  it('the wordmark is drawn, not typed: the wordmark file’s path, white in dark and obsidian in light', () => {
    render(<Wordmark />)
    const wordmark = screen.getByRole('img', { name: 'Talyvor' })
    expect(wordmark.tagName.toLowerCase()).toBe('svg')
    expect(wordmark.textContent, 'no live-text TALYVOR').toBe('')
    const [drawn] = wordmark.querySelectorAll('path')
    for (const [theme, file] of [
      ['dark', 'talyvor-wordmark-white.svg'],
      ['light', 'talyvor-wordmark-obsidian.svg'],
    ] as const) {
      const [brand] = brandPaths(file)
      expect(drawn.getAttribute('d')).toBe(brand.d)
      expect(resolveFill(drawn, themes[theme]), theme).toBe(brand.fill)
    }
  })
})
