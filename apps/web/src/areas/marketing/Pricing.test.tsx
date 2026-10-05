import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BYOK, PLANS } from '../lens/planApi'
import { formatCents } from '../lens/topupApi'
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

  // B28.3: plans, BYOK and the marketplace all bill monthly, so the page may not say no charge ever recurs.
  it('does not claim no charge recurs, and says a plan or BYOK is billed every month', async () => {
    serve({ min_usd_cents: 1000, max_usd_cents: 1_000_000, preset_usd_cents: [1000] })
    const { container } = render(<Pricing />)
    await screen.findByText(/did not confirm its credit rate/i)
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/nothing\s+recurs|only charge is the requests you run|self-hosted/i)
    expect(text).toMatch(/a plan or BYOK, if you choose one, is billed every month/i)
  })

  // B28.4: plans for people, BYOK and the Marketplace bill, each listed once, at the prices /plans sells.
  it('lists Plus, Pro, Max and BYOK once each at planApi’s prices, and the Marketplace bill once', async () => {
    serve({ min_usd_cents: 1000, max_usd_cents: 1_000_000, preset_usd_cents: [1000] })
    render(<Pricing />)
    await screen.findByText(/did not confirm its credit rate/i)

    const offers = screen.getAllByTestId('pricing-plan').map((card) => ({
      name: within(card).getByTestId('pricing-plan-name').textContent,
      price: within(card).getByTestId('pricing-plan-price').textContent,
    }))
    expect(offers).toEqual([...PLANS, BYOK].map((p) => ({ name: p.name, price: formatCents(p.usd_cents) })))
    expect(screen.getAllByText('$199')).toHaveLength(1)
    expect(screen.getAllByRole('heading', { name: /one bill a month/i })).toHaveLength(1)
  })

  // B29.5: the board's look — raised plan cards, one teal button each, Pro outlined, mono prices,
  // and an eyebrow over every section.
  it('puts each plan on a raised card with one teal button, outlines Pro, and sets every price in mono', async () => {
    serve({ min_usd_cents: 1000, max_usd_cents: 1_000_000, preset_usd_cents: [1000] })
    const { container } = render(<Pricing />)
    await screen.findByText(/did not confirm its credit rate/i)

    const cards = screen.getAllByTestId('pricing-plan')
    for (const [i, card] of cards.entries()) {
      const name = [...PLANS, BYOK][i].name
      expect(card).toHaveClass('bg-raised', 'rounded-card')
      const buttons = within(card).getAllByRole('link')
      expect(buttons).toHaveLength(1)
      expect(buttons[0]).toHaveAccessibleName(`Choose ${name}`)
      expect(buttons[0]).toHaveAttribute('href', '/plans')
      expect(buttons[0]).toHaveClass('bg-accent')
      expect(within(card).getByTestId('pricing-plan-price')).toHaveClass('font-figure')
    }
    expect(cards.filter((c) => c.classList.contains('border-accent')).map((c) => within(c).getByTestId('pricing-plan-name').textContent)).toEqual(['Pro'])
    // Every section opens with an eyebrow in the label colour, and its headline is unchanged.
    for (const section of container.querySelectorAll('main section')) {
      const heading = section.querySelector('h1, h2')!
      if (heading.id === 'pricing-close-heading') continue
      expect(section.querySelector('.text-eyebrow.text-label')).not.toBeNull()
    }
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Credit for your agents. A plan for your people.')
  })
})
