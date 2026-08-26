import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Earnings, usdAtPeg } from './Earnings'
import type { EarningsSummary } from '../../lib/api'

// Earnings — W4.6.1 step 7. Every assertion here is about a claim the screen MAKES, because the
// hazard on this screen is a confident wrong number rather than a missing one.

/** talyvor-lens earnings.Summary, at cbf2dbf. 6 LENS earned at the 10 LENS/$ peg = $0.60. */
function summary(over: Partial<EarningsSummary> = {}): EarningsSummary {
  return {
    workspace_id: 'ws-1',
    contribution_settled_ulens: 6_000_000,
    capital_settled_ulens: 0,
    settled_ulens: 6_000_000,
    held_ulens: 1_000_000,
    revoked_ulens: 0,
    contribution_settled_usd_at_peg: 0.6,
    settled_usd_at_peg: 0.6,
    held_usd_at_peg: 0.1,
    lens_per_usd: 10,
    earning_enabled: true,
    disabled_gates: [],
    by_type: [
      {
        type: 'pool_royalty',
        class: 'settled',
        kind: 'contribution',
        amount_ulens: 6_000_000,
        rows: 3,
        reason: 'a cross-tenant pooled hit on this workspace answer, settled',
      },
    ],
    unclassified_types: [],
    ...over,
  }
}

function mockBff(res: { status?: number; body: unknown }) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () =>
      new Response(JSON.stringify(res.body), {
        status: res.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  )
}

function renderEarnings() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // MemoryRouter because the empty state's next action is a real <Link>, not a sentence about
  // one — see the branch it guards in Earnings.tsx.
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <Earnings />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('Earnings states what was earned, and nothing more', () => {
  it('shows the contribution figure with its peg qualifier, never a bare dollar claim', async () => {
    mockBff({ body: summary() })
    renderEarnings()

    const total = await screen.findByTestId('contribution-total')
    expect(total).toHaveTextContent('6')
    // ⚠ THE QUALIFIER IS THE ASSERTION. LENS has one published peg and no market, so "$0.60" on
    // its own is a claim about what somebody would pay for this. The words have to be there.
    expect(total).toHaveTextContent('$0.60')
    expect(total.textContent).toMatch(/at the published peg/)
    // and the peg itself is on screen, so the conversion is checkable by the reader
    expect(screen.getByText(/10 LENS to the dollar/)).toBeInTheDocument()
  })

  // ⚠ THE CROSS-REPO CHECK. The screen renders the dollars LENS SENT rather than re-deriving them,
  // because two derivations of one number in two repositories drift. This is the independent
  // derivation, and it must agree — if Lens changes the peg or the conversion this reds instead of
  // the screen quietly showing a figure nobody re-derived.
  it('agrees with an independent derivation of the peg conversion', () => {
    const s = summary()
    expect(usdAtPeg(s.contribution_settled_ulens, s.lens_per_usd)).toBeCloseTo(
      s.contribution_settled_usd_at_peg,
      6,
    )
    expect(usdAtPeg(s.held_ulens, s.lens_per_usd)).toBeCloseTo(s.held_usd_at_peg, 6)
    // the control: a WRONG peg must not agree, or the two assertions above are satisfied by
    // anything at all
    expect(usdAtPeg(s.contribution_settled_ulens, 1)).not.toBeCloseTo(
      s.contribution_settled_usd_at_peg,
      6,
    )
  })

  it('keeps staking yield out of the contribution figure while still reporting it', async () => {
    mockBff({ body: summary({ capital_settled_ulens: 9_000_000 }) })
    renderEarnings()

    const total = await screen.findByTestId('contribution-total')
    // ⚠ 6, NOT 15. Yield on locked LENS is income and nobody wrote an answer for it, so folding it
    // in leaves the TOTAL right and makes the SENTENCE false — the worse of the two errors.
    expect(total).toHaveTextContent('6')
    expect(total).not.toHaveTextContent('15')
    const capital = screen.getByTestId('capital-line')
    expect(capital).toHaveTextContent('9')
    expect(capital.textContent).toMatch(/not something you answered/)
  })

  it('reports held separately from earned, and says why it is not yours', async () => {
    mockBff({ body: summary() })
    renderEarnings()

    const held = await screen.findByTestId('held-total')
    expect(held).toHaveTextContent('1')
    expect(screen.getByText(/an adjudicator can still revoke it/)).toBeInTheDocument()
    // it is NOT added into the headline
    expect(screen.getByTestId('contribution-total')).not.toHaveTextContent('7')
  })

  it('names a revocation rather than letting earnings fall without explanation', async () => {
    mockBff({ body: summary({ revoked_ulens: 2_000_000 }) })
    renderEarnings()
    expect(await screen.findByTestId('revoked-line')).toHaveTextContent('2')
  })

  // ⚠ THE STATE A STOCK DEPLOYMENT IS ACTUALLY IN. Every switch a royalty needs ships OFF, so the
  // honest answer is zero and it says nothing about the workspace. A "$0.00" here would state an
  // operator setting as a measurement.
  it('does not render a total when earning is switched off — it names the switches', async () => {
    mockBff({
      body: summary({
        earning_enabled: false,
        contribution_settled_ulens: 0,
        contribution_settled_usd_at_peg: 0,
        disabled_gates: ['LENS_ECONOMY_ENABLED', 'LENS_POOL_ROYALTY_MINTING_ENABLED'],
      }),
    })
    renderEarnings()

    expect(await screen.findByTestId('earning-off')).toHaveTextContent('not zero, unmeasured')
    const gates = screen.getByTestId('disabled-gates')
    expect(gates).toHaveTextContent('LENS_ECONOMY_ENABLED')
    expect(gates).toHaveTextContent('LENS_POOL_ROYALTY_MINTING_ENABLED')
    // no figure is offered at all
    expect(screen.queryByTestId('contribution-total')).toBeNull()
    expect(screen.queryByText(/\$0\.00/)).toBeNull()
  })

  it('distinguishes "earning is on and nothing was reused" from "earning is off"', async () => {
    mockBff({ body: summary({ contribution_settled_ulens: 0, by_type: [] }) })
    renderEarnings()

    const empty = await screen.findByTestId('nothing-earned')
    expect(empty).toHaveTextContent('earning is on')
    // the empty state names a next action rather than stopping at "nothing here"
    // ⚠ THE NEXT ACTION IS ASSERTED AS A LINK, not as prose. A sentence pointing at Setup still
    // leaves the reader to go and find it, and EmptyStates.test says so.
    const go = screen.getByRole('link', { name: /Open Setup/i })
    expect(go).toHaveAttribute('href', '/setup')
    expect(screen.queryByTestId('earning-off')).toBeNull()
  })

  it('reports ledger types Lens could not classify instead of dropping them', async () => {
    mockBff({ body: summary({ unclassified_types: ['some_future_mint'] }) })
    renderEarnings()
    const note = await screen.findByTestId('unclassified')
    expect(note).toHaveTextContent('some_future_mint')
    expect(note.textContent).toMatch(/rather than guessed at/)
  })

  // ⚠ A FAILED READ SAYS NOTHING ABOUT WHETHER THIS WORKSPACE EARNED ANYTHING, so every sentence
  // the screen could offer would be invented. The fault branch has to come BEFORE the empty one.
  it('reports a failed read as a failure, never as zero earnings', async () => {
    mockBff({ status: 500, body: { error: 'lens is down' } })
    renderEarnings()

    expect(await screen.findByText(/your earnings/)).toBeInTheDocument()
    expect(screen.queryByTestId('contribution-total')).toBeNull()
    expect(screen.queryByTestId('nothing-earned')).toBeNull()
    expect(screen.queryByTestId('earning-off')).toBeNull()
  })

  // Lens serialises empty slices as JSON null. The screen must survive it rather than crash on
  // .filter — the same normalisation bug the Members roster hit.
  it('survives null slices on the wire', async () => {
    mockBff({
      body: summary({ by_type: null, disabled_gates: null, unclassified_types: null }),
    })
    renderEarnings()
    expect(await screen.findByTestId('contribution-total')).toBeInTheDocument()
    expect(screen.getByTestId('nothing-earned')).toBeInTheDocument()
  })
})
