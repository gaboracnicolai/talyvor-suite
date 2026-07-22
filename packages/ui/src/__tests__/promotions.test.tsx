import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FixtureNotice } from '../components/FixtureNotice'
import { Pill } from '../components/Pill'
import { RevealOnce } from '../components/RevealOnce'
import { formatDay } from '../lib/format'

// The promotion PR's contracts. Each promoted piece is tested HERE, at the
// design-system layer, because five areas consume it: the contract must hold
// for callers that do not exist yet.

describe('Pill — the two neutral statuses (the StatusPill resolution)', () => {
  // 'idle' returns exactly per its removal note ("re-add it only alongside a
  // real state that needs it"): Track's todo/backlog are real states that are
  // neither settled, held nor slashed. 'parked' is the dimmer sibling.
  it('idle renders a muted-grey dot with a muted label — never a hue on text', () => {
    render(<Pill status="idle">Todo</Pill>)
    const label = screen.getByText('Todo')
    expect(label.className).toContain('text-muted')
    expect(label.querySelector('[aria-hidden]')?.className).toContain('bg-muted')
  })
  it('parked renders the faintest dot (shelved, not dead)', () => {
    render(<Pill status="parked">Backlog</Pill>)
    expect(screen.getByText('Backlog').querySelector('[aria-hidden]')?.className).toContain('bg-faint')
  })
  it('multi-word labels never wrap mid-pill', () => {
    render(<Pill status="idle">In review</Pill>)
    expect(screen.getByText('In review').className).toContain('whitespace-nowrap')
  })
})

describe('FixtureNotice — sample data is never silent', () => {
  it('names what it awaits, in faint ink with a hueless dot', () => {
    render(<FixtureNotice awaiting="GET /api/example" />)
    const el = screen.getByText(/sample data — awaiting get \/api\/example/i)
    expect(el.parentElement?.className).toContain('text-faint')
  })
})

describe('RevealOnce — the one-time-credential contract', () => {
  // The component owns: the secret's single rendering slot, the copy action
  // that copies THE SECRET and nothing else, the separated not-a-credential
  // identifier block, and the explicit final dismissal. The ONCE-ness (never
  // re-rendered after dismissal) is the consumer's unmount, proven end-to-end
  // by the lens /keys suite — both layers hold the pattern.
  const writeText = vi.fn(() => Promise.resolve())
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    writeText.mockClear()
  })
  afterEach(() => vi.restoreAllMocks())

  const props = {
    title: 'Service token — shown once',
    secret: 'tok_SAMPLE_secret_value_0000',
    copyLabel: 'Copy token',
    identifier: 'tok_5ample00',
    identifierNote: 'Safe to share; this is how the token appears in lists.',
    onDone: () => {},
  }

  it('renders the secret, the warning, and the identifier under a not-a-credential label', () => {
    render(<RevealOnce {...props} />)
    expect(screen.getByText(props.secret)).toBeInTheDocument()
    expect(screen.getByText(/will not be shown again/i)).toBeInTheDocument()
    expect(screen.getByText(/not a credential/i)).toBeInTheDocument()
    expect(screen.getByText(props.identifier)).toBeInTheDocument()
  })

  it('the copy action copies THE SECRET — never the identifier — and confirms in text', async () => {
    render(<RevealOnce {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /copy token/i }))
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith(props.secret)
    expect(writeText).not.toHaveBeenCalledWith(props.identifier)
    expect(await screen.findByRole('button', { name: /^copied$/i })).toBeInTheDocument()
  })

  it('the explicit dismissal calls onDone (the consumer then unmounts it, forever)', () => {
    const onDone = vi.fn()
    render(<RevealOnce {...props} onDone={onDone} />)
    fireEvent.click(screen.getByRole('button', { name: /i stored it/i }))
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('no text on the card carries a hue (the invariant)', () => {
    const { container } = render(<RevealOnce {...props} />)
    for (const el of container.querySelectorAll('*')) {
      for (const cls of el.classList) {
        expect(cls).not.toMatch(/^text-(settled|held|slashed|lens|lxc|tier1|tier3|accent)$/)
      }
    }
  })
})

describe('formatDay — date-only, UTC, deterministic in every timezone', () => {
  it('formats an ISO instant to its UTC calendar day', () => {
    expect(formatDay('2026-07-22T23:59:00Z')).toBe('Jul 22, 2026')
    expect(formatDay('2026-01-01T00:00:00Z')).toBe('Jan 1, 2026')
  })
  it('returns unparseable input verbatim rather than NaN-ing', () => {
    expect(formatDay('not-a-date')).toBe('not-a-date')
  })
})
