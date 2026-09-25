import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Pricing } from './Pricing'

// The page renders BARE — no router, no query client — like Landing. What it prints is what
// GET /api/pricing served, so each test serves a peg this repo never writes down (0.2, not the
// production 0.10) and asserts the page followed the server rather than a constant.

function serve(body: unknown, status = 200) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (String(input) !== '/api/pricing') return new Response('null', { status: 404 })
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

afterEach(() => vi.restoreAllMocks())

describe('/pricing', () => {
  it('prints the served peg, the served range, and what each amount buys at that peg', async () => {
    serve({ usd_per_lxc: 0.2, min_usd_cents: 1000, max_usd_cents: 1_000_000, preset_usd_cents: [1000, 5000] })
    render(<Pricing />)

    expect(await screen.findByText('$0.20')).toBeInTheDocument()
    expect(screen.getByText(/top up any amount from/i)).toHaveTextContent('Top up any amount from $10 to $10,000.')
    expect(screen.getByText('buys 50 LXC')).toBeInTheDocument() // $10 at $0.20
    expect(screen.getByText('buys 12,500 LXC')).toBeInTheDocument() // the $2,500 "any amount" example
    // And the buyer can check it: the page names the address it read.
    expect(screen.getByRole('link', { name: /get \/api\/pricing/i })).toHaveAttribute('href', '/api/pricing')
  })

  it('prints no rate when the deployment will not confirm one', async () => {
    serve({ min_usd_cents: 1000, max_usd_cents: 1_000_000, preset_usd_cents: [1000] })
    render(<Pricing />)

    expect(await screen.findByText(/did not confirm its credit rate/i)).toBeInTheDocument()
    expect(screen.queryByText(/buys .* LXC/)).not.toBeInTheDocument()
    expect(screen.getByText(/top up any amount from/i)).toHaveTextContent('from $10 to $10,000')
  })
})
