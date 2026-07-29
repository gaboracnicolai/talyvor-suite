import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Overview } from './Overview'
import { ConvertLens } from './ConvertLens'

// HELD LENS, ASSERTED AS THE TESTER SAW IT.
//
// ⚠ THE INCIDENT. The first pool royalty ever minted was 822 µLENS with type pool_royalty_held.
// lens_token_ledger said 822, pool_royalty_mints said 822, and the Overview LENS balance said 0.
// The 0 was CORRECT — a held mint credits held_balance and only becomes spendable when Lens's
// finalize sweeper settles it after the holdback window (72h by default). A correct system that
// explains nothing reads as a broken one, and the tester's reaction was "this is weird".
//
// Held is NOT spendable and NOT lost. Three states; the screen showed one.
//
// These assert the RENDERED TEXT, because the claim is about what a person can see. A test on the
// query response would pass on a screen that dropped the number on the floor.

const balance = {
  workspace_id: 'ws1',
  balance_ulens: 0,
  held_balance_ulens: 822,
  // Deliberately DIFFERENT from held, so "822 appears once" is a meaningful assertion below. With
  // both set to 822 the count is 2 for an innocent reason and the check proves nothing.
  lifetime_earned_ulens: 900,
  lifetime_spent_ulens: 0,
  updated_at: new Date().toISOString(),
}

function mockBff(over: Partial<typeof balance> = {}) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (b: unknown) =>
      new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/api/tokens/balance') return json({ ...balance, ...over })
    if (url === '/api/lxc/balance')
      return json({
        workspace_id: 'ws1',
        balance_ulxc: 0,
        lifetime_minted_ulxc: 0,
        lifetime_spent_ulxc: 0,
        usd_value_uusd: 0,
      })
    if (url.startsWith('/api/tokens/history') || url.startsWith('/api/lxc/history')) return json([])
    if (url.startsWith('/api/usage')) return json({ models: [], cache: null })
    if (url === '/api/bonds') return json({ enabled: false })
    return json(null)
  })
}

function renderOverview() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <Overview />
    </QueryClientProvider>,
  )
}

beforeEach(() => mockBff())
afterEach(() => vi.restoreAllMocks())

describe('a held royalty is shown, and shown as not yet spendable', () => {
  // ⚠ THE REPORTED STATE: everything earned is held, nothing is spendable.
  it('shows the held amount instead of only a bare 0', async () => {
    renderOverview()
    expect(await screen.findByText(/Held — not yet spendable/i)).toBeInTheDocument()
  })

  it('says it settles on its own, so nobody waits for a button that does not exist', async () => {
    renderOverview()
    expect(await screen.findByText(/settles automatically/i)).toBeInTheDocument()
  })

  // ⚠ AND IT MUST NOT BE ADDED TO THE SPENDABLE HEADLINE. Counting held would offer money the
  // workspace cannot spend, and the conversion would then refuse an amount just displayed.
  it('does not fold held into the spendable balance', async () => {
    renderOverview()
    await screen.findByText(/Held — not yet spendable/i)
    // The headline is the SPENDABLE figure. With 0 spendable and 822 held, a summed headline would
    // render 822 twice — once as the balance, once as the held row. Lifetime earned is 900 here so
    // it cannot contribute a match.
    expect(screen.getAllByText(/822/).length).toBe(1)
  })

  // A workspace that has never earned a royalty must not carry a permanent "Held 0" row.
  it('says nothing about held when there is none', async () => {
    mockBff({ held_balance_ulens: 0, balance_ulens: 5000 })
    renderOverview()
    await screen.findByText(/Lifetime earned/i)
    expect(screen.queryByText(/Held — not yet spendable/i)).not.toBeInTheDocument()
  })

  // Deployment skew: a Lens older than the field omits it. The screen must degrade to today's
  // behaviour rather than render "undefined" or crash.
  it('tolerates a Lens that does not report held yet', async () => {
    mockBff({ held_balance_ulens: undefined })
    renderOverview()
    await screen.findByText(/Lifetime earned/i)
    expect(screen.queryByText(/Held — not yet spendable/i)).not.toBeInTheDocument()
  })
})

describe('the convert panel explains a refusal it would otherwise not', () => {
  function renderConvert(spendable: number, held: number) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input) === '/api/lens/convert-quote') {
        return new Response(
          JSON.stringify({
            lens_per_lxc: 1,
            usd_per_lxc: 0.1,
            min_lxc_ulxc: 100_000,
            reversible: false,
            reversible_note: 'LENS converts to LXC and not back.',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('null', { status: 404 })
    })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={qc}>
        <ConvertLens lensBalanceMicros={spendable} heldMicros={held} />
      </QueryClientProvider>,
    )
  }

  // ⚠ THE FAILURE THIS PREVENTS: someone looking at 822 held tries to convert it and gets
  // "not enough LENS" — which reads as a broken conversion rather than the holdback working.
  it('names the held amount when the shortfall is held LENS', async () => {
    renderConvert(0, 822)
    fireEvent.click(await screen.findByRole('button', { name: /convert to lxc/i }))
    const input = await screen.findByLabelText(/lxc to receive/i)
    fireEvent.change(input, { target: { value: '1' } })
    expect(await screen.findByText(/held and not yet spendable/i)).toBeInTheDocument()
  })

  it('quotes against SPENDABLE, never spendable plus held', async () => {
    // 1 LXC costs 1 LENS here. 1 spendable + 822 held: if the panel counted held it would allow
    // this, and the server would refuse it.
    renderConvert(1_000_000, 822)
    fireEvent.click(await screen.findByRole('button', { name: /convert to lxc/i }))
    const input = await screen.findByLabelText(/lxc to receive/i)
    fireEvent.change(input, { target: { value: '2' } }) // costs 2 LENS, only 1 spendable
    expect(await screen.findByText(/cannot spend right now|more LENS than/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^convert$/i })).toBeDisabled()
  })
})
