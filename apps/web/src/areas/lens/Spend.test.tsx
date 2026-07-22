import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Spend } from './Spend'

// Spend & routing: exact values are µ-split numerals; derived values (rates,
// month-USD) are ≈-marked muted text — the design system's central distinction,
// on the screen it was built for. Two-step TierDot only.

const NOW = new Date('2026-07-22T12:00:00Z')

describe('Spend', () => {
  it('shows per-model rows with request counts and a two-step tier dot each', () => {
    render(<Spend now={NOW} />)
    expect(screen.getByText('claude-sonnet-5')).toBeInTheDocument()
    expect(screen.getByText('claude-haiku-4-5')).toBeInTheDocument()
    // 7-day default window: haiku has 2 requests, sonnet 1.
    expect(screen.getByText(/2 requests/)).toBeInTheDocument()
    expect(screen.getByText(/1 request\b/)).toBeInTheDocument()
    // Two-step ramp only: every dot is cheap or capable.
    const dots = screen.getAllByRole('img', { name: /cheap|capable/ })
    expect(dots.length).toBe(2)
  })

  it('widening the window recounts (30d picks up the older row)', () => {
    render(<Spend now={NOW} />)
    fireEvent.click(screen.getByRole('button', { name: /30d/i }))
    expect(screen.getByText(/3 requests/)).toBeInTheDocument()
  })

  it('exact µ amounts render as numerals; derived values carry ≈ and never a numeral', () => {
    render(<Spend now={NOW} />)
    // Exact: µ-integer amounts from the ledger rows (950 and 600 in the 7d window).
    expect(screen.getByText(/950/)).toBeInTheDocument()
    expect(screen.getByText(/600/)).toBeInTheDocument()
    // Derived: cache hit rate and month-USD are ≈-marked.
    expect(screen.getByText(/≈\s*87%/)).toBeInTheDocument()
    expect(screen.getByText(/≈\s*\$4\.31/)).toBeInTheDocument()
  })

  it('renders exactly one fixture notice', () => {
    render(<Spend now={NOW} />)
    expect(screen.getAllByText(/placeholder/i)).toHaveLength(1)
  })
})
