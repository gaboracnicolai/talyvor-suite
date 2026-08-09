import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from '../components/Button'
import { Mark } from '../components/Mark'
import { MuNumeral } from '../components/MuNumeral'
import { NavItem } from '../components/NavItem'
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
  it('body 14, caption 12, head 17, title 24', () => {
    expect(size('body')).toBe('14px')
    expect(size('caption')).toBe('12px')
    expect(size('head')).toBe('17px')
    expect(size('title')).toBe('24px')
  })
  it('the µ-tail moves with the scale (dimmer AND smaller than the whole)', () => {
    expect(size('micro')).toBe('12.5px')
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
  it('nav hover and selection are accent-tinted; the label stays ink', () => {
    render(<NavItem active>Ledger</NavItem>)
    const active = screen.getByRole('button', { name: 'Ledger' })
    expect(active.className).toContain('bg-accent-tint')
    expect(active.className).toContain('text-ink')
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

describe('correction 4 — the mark', () => {
  it('renders a rounded tile holding a partially-filled hairline (the hold indicator abstracted)', () => {
    render(<Mark />)
    const mark = screen.getByRole('img', { name: /talyvor/i })
    // The tile: rounded, hairline-bordered, themed surface.
    expect(mark.className).toContain('rounded-control')
    expect(mark.className).toContain('border-rule')
    // The fill: accent, partial — the one place the accent lives permanently.
    const fill = mark.querySelector('[data-fill]')!
    expect(fill.className).toContain('bg-accent')
    expect((fill as HTMLElement).style.width).toBe('62.5%')
  })
})
