import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from '../components/Button'
import { Mark } from '../components/Mark'
import { MuNumeral } from '../components/MuNumeral'
import { NavItem } from '../components/NavItem'
import preset from '../preset'
import { tokens } from '../tokens'

// The four deployed-app corrections, pinned at the design-system layer.

describe('correction 1 — numerals are SANS with tabular figures; mono is for identifiers', () => {
  it('MuNumeral carries tabular-nums and NO font-mono', () => {
    const { container } = render(<MuNumeral micros={12_340_567} unit="lens" />)
    const wrap = container.firstElementChild!
    expect(wrap.className).toContain('tabular-nums')
    expect(wrap.className).not.toContain('font-mono')
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
    // Light was #E4F0F1: 1.07:1 against the #F4F5F6 sidebar — under the
    // threshold where a hover reads as a hover. #CDE5E8 mirrors dark's
    // working deltas (1.20:1 vs canvas, 1.32:1 vs surface ≈ dark's 1.21/1.35)
    // while staying a pale tint: ink on it is 12.9:1, and it sits 3.9:1 away
    // from the full accent fill. Dark was already correct; it is pinned so a
    // future "symmetry" cleanup cannot quietly reintroduce the mistake.
    expect(tokens.light['accent-tint']).toBe('#CDE5E8')
    expect(tokens.dark['accent-tint']).toBe('#11333A')
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
