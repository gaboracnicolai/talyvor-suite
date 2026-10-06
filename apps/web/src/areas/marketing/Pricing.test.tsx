import { render, screen, within } from '@testing-library/react'
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

/** A price card no deployment states: every figure differs from Nicolai's, so only a page that reads the
 *  server prints them. */
const CHANGED_CARD = {
  usd_per_lxc: 0.2,
  min_usd_cents: 1000,
  max_usd_cents: 1_000_000,
  preset_usd_cents: [1000],
  plans: [
    { id: 'plus', usd_cents: 2100, included_ulxc: 180_000_000 },
    { id: 'pro', usd_cents: 11000, included_ulxc: 1_090_000_000 },
    { id: 'max', usd_cents: 21000, included_ulxc: 2_000_000_000 },
  ],
  company_plans: [
    { id: 'team', usd_cents: 5900 },
    { id: 'business', usd_cents: 34900 },
  ],
  byok_add_on_usd_cents: 20900,
  enterprise_from_usd_cents: 300000,
  plan_gates: {
    order: ['free', 'team', 'business', 'enterprise'],
    plans: {
      free: { agents: 3, seats: 1, own_provider_keys: 'none', live_money: false, slack_teams_approvals: false, sso: false, audit_export: false, edge: false },
      team: { agents: 40, seats: 6, own_provider_keys: 'add_on', live_money: true, slack_teams_approvals: true, sso: false, audit_export: false, edge: false },
      business: { agents: -1, seats: 30, own_provider_keys: 'included', live_money: true, slack_teams_approvals: true, sso: true, audit_export: true, edge: false },
      enterprise: { agents: -1, seats: -1, own_provider_keys: 'included', live_money: true, slack_teams_approvals: true, sso: true, audit_export: true, edge: true },
    },
  },
  fees: {
    market_take_bps: 1200,
    services_take_bps: 400,
    compute_take_bps: 400,
    lending_fee_bps: 150,
    platform_fee_bps: { free: 600, team: 325, business: 150, enterprise: 100 },
    fx_margin_bps: { free: 0, team: 60, business: 30, enterprise: 15 },
    intl_payment_fee_minor: { EUR: 500, GBP: 400, USD: 800 },
    merchant_fee_bps: 80,
    merchant_a2a_fee_bps: 110,
  },
}

describe('/pricing', () => {
  it('prints the served peg, the served range, and what each amount buys at that peg', async () => {
    serve({ usd_per_lxc: 0.2, min_usd_cents: 1000, max_usd_cents: 1_000_000, preset_usd_cents: [1000, 5000] })
    render(<Pricing />)

    expect(await screen.findByText('$0.20')).toBeInTheDocument()
    expect(screen.getByText(/top up any amount from/i)).toHaveTextContent('Top up any amount from $10 to $10,000.')
    expect(screen.getByText('buys 50 LXC')).toBeInTheDocument() // $10 at $0.20
    expect(screen.getByText('buys 12,500 LXC')).toBeInTheDocument() // the $2,500 "any amount" example
    // And the buyer can check it: the page names the address it read.
    for (const link of screen.getAllByRole('link', { name: /get \/api\/pricing/i })) {
      expect(link).toHaveAttribute('href', '/api/pricing')
    }
  })

  it('prints no rate when the deployment will not confirm one', async () => {
    serve({ min_usd_cents: 1000, max_usd_cents: 1_000_000, preset_usd_cents: [1000] })
    render(<Pricing />)

    expect(await screen.findByText(/did not confirm its credit rate/i)).toBeInTheDocument()
    expect(screen.queryByText(/buys .* LXC/)).not.toBeInTheDocument()
    expect(screen.getByText(/top up any amount from/i)).toHaveTextContent('from $10 to $10,000')
  })

  // B28.3: plans and the marketplace bill monthly, so the page may not say no charge ever recurs.
  it('does not claim no charge recurs, and says a paid plan is billed every month', async () => {
    serve({ min_usd_cents: 1000, max_usd_cents: 1_000_000, preset_usd_cents: [1000] })
    const { container } = render(<Pricing />)
    await screen.findByText(/did not confirm its credit rate/i)
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/nothing\s+recurs|only charge is the requests you run|self-hosted/i)
    expect(text).toMatch(/a paid plan, if you choose one, is billed every month/i)
  })

  // B32.14: the approved price card, every figure as GET /api/pricing served it. Each test serves figures this
  // repo never writes down, so a page reading a constant instead of the server fails.
  it('prints the companies, individuals and fees exactly as served, and the tax line under them', async () => {
    serve(CHANGED_CARD)
    render(<Pricing />)
    const team = await screen.findByTestId('company-plan-team')

    expect(within(team).getByTestId('price-team')).toHaveTextContent('$59')
    expect(team).toHaveTextContent('Agents40')
    expect(team).toHaveTextContent('Seats6')
    expect(team).toHaveTextContent('Platform fee on AI spend3.25%')
    expect(team).toHaveTextContent('Own provider keys$209 add-on')
    expect(team).toHaveTextContent('Money featuresLive as each is clearedPreview — test money only')
    expect(team).toHaveTextContent('FX margin over the reference rate0.6%')
    expect(team).toHaveTextContent('Slack and Teams approvalsIncluded')
    expect(team).toHaveTextContent('SSO and audit export—')

    const free = screen.getByTestId('company-plan-free')
    expect(within(free).getByTestId('price-free')).toHaveTextContent('$0')
    expect(free).toHaveTextContent('Money featuresPreview — test money only')
    expect(free).toHaveTextContent('FX margin over the reference rate—')
    expect(free).toHaveTextContent('Own provider keys—')
    expect(within(screen.getByTestId('company-plan-business')).getByTestId('price-business')).toHaveTextContent('$349')
    const enterprise = screen.getByTestId('company-plan-enterprise')
    expect(enterprise).toHaveTextContent('From$3,000a month')
    expect(enterprise).toHaveTextContent('Platform fee on AI spendAgreed')
    expect(enterprise).toHaveTextContent('AgentsUnlimited')
    expect(enterprise).toHaveTextContent('Talyvor EdgeIncluded')
    expect(within(enterprise).getByRole('link', { name: 'Talk to us' })).toHaveAttribute('href', 'mailto:nicolai@talyvor.com')

    const offers = screen.getAllByTestId('pricing-plan').map((card) => card.textContent)
    expect(offers).toHaveLength(3)
    expect(offers[0]).toContain('Plus$21a month')
    expect(offers[0]).toContain('180 LXC of usage included')
    expect(offers[1]).toContain('Pro$110a month')
    expect(offers[1]).toContain('6× the included usage of Plus') // 1,090 ÷ 180, computed

    const fees = screen.getByTestId('fees-any-plan')
    expect(fees).toHaveTextContent('Sellers earn 88%; Talyvor keeps 12%')
    expect(fees).toHaveTextContent('Services and compute4%')
    expect(fees).toHaveTextContent('Loans arranged1.5%Preview — test money only')
    expect(fees).toHaveTextContent('£4, €5 or $8 plus the partner’s cost')
    expect(fees).toHaveTextContent('Accepting payments0.8% plus card processing, or 1.1% from an accountPreview')
    expect(screen.getByTestId('tax-line')).toHaveTextContent(
      'Prices are in US dollars. Where Talyvor must charge VAT or sales tax, it is added at checkout and shown before you pay.',
    )
    expect(screen.getAllByRole('heading', { name: /one bill a month/i })).toHaveLength(1)
  })

  it('prints no plan price, gate or fee the server did not state', async () => {
    serve({ min_usd_cents: 1000, max_usd_cents: 1_000_000, preset_usd_cents: [1000] })
    render(<Pricing />)
    expect(await screen.findByText(/what each plan includes could not be read/i)).toBeInTheDocument()
    expect(screen.getByText(/did not state its plans for individuals/i)).toBeInTheDocument()
    expect(screen.getByText(/the fees could not be read/i)).toBeInTheDocument()
    expect(screen.queryByTestId('pricing-plan-price')).not.toBeInTheDocument()
  })

  // B29.5: the board's look — raised plan cards, one teal button each, Pro outlined, mono prices,
  // and an eyebrow over every section.
  it('puts each plan on a raised card with one teal button, outlines Pro, and sets every price in mono', async () => {
    serve(CHANGED_CARD)
    const { container } = render(<Pricing />)
    await screen.findByTestId('company-plan-team')

    const cards = screen.getAllByTestId('pricing-plan')
    for (const [i, card] of cards.entries()) {
      const name = ['Plus', 'Pro', 'Max'][i]
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
