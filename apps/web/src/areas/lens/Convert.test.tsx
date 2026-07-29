import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConvertLens } from './ConvertLens'

// CONVERTING EARNED LENS, ASSERTED AS A PERSON DOES IT.
//
// The claim under test is the user-visible one: a workspace with LENS converts it and the LXC
// balance rises by the stated amount. So these drive the rendered affordance — type, click, read —
// and assert on what the screen shows and what the server was ASKED, never on a function's return.
//
// ⚠ AND ON THE PROMISE MADE BEFORE THE CLICK. The conversion is irreversible: Lens has no LXC→LENS
// path at all. A screen that omits that is making an undoable decision look ordinary, so the
// warning is a tested property rather than decoration.

const quote = {
  lens_per_lxc: 2,
  usd_per_lxc: 0.1,
  min_lxc_ulxc: 100_000,
  reversible: false,
  reversible_note:
    'LENS converts to LXC and not back — there is no LXC→LENS conversion in Lens.',
}

let posted: unknown = null

function mockBff(opts: { convertStatus?: number } = {}) {
  posted = null
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (url === '/api/lens/convert-quote') {
      return new Response(JSON.stringify(quote), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url === '/api/lens/convert') {
      posted = JSON.parse(String(init?.body ?? '{}'))
      const status = opts.convertStatus ?? 200
      if (status !== 200) {
        return new Response(JSON.stringify({ error: 'insufficient LENS' }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(
        JSON.stringify({
          lxc_minted_ulxc: 1_000_000,
          lens_spent_ulens: 2_000_000,
          rate: 2,
          new_lxc_balance_ulxc: 5_000_000,
          new_lens_balance_ulens: 8_000_000,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    return new Response('null', { status: 404 })
  })
}

function renderConvert(balance = 10_000_000) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ConvertLens lensBalanceMicros={balance} />
    </QueryClientProvider>,
  )
}

beforeEach(() => mockBff())
afterEach(() => vi.restoreAllMocks())

async function openPanel() {
  fireEvent.click(await screen.findByRole('button', { name: /convert to lxc/i }))
  return screen.findByLabelText(/lxc to receive/i)
}

describe('the conversion tells the truth before the click', () => {
  it('shows the rate READ FROM THE DEPLOYMENT, not a number in the bundle', async () => {
    renderConvert()
    await openPanel()
    // Scoped to the rate line: "2" also appears as part of the minimum, and a bare getByText
    // would pass on either — an ambiguous query is not evidence about the rate.
    const rateLine = await screen.findByText(/LENS per LXC/i)
    expect(rateLine.textContent).toMatch(/Rate:\s*2\s*LENS per LXC/)
  })

  // ⚠ THE ONE THAT MUST NOT REGRESS. An irreversible action described after the fact has been
  // described too late.
  it('warns that it is ONE-WAY before the button, not after', async () => {
    renderConvert()
    await openPanel()
    const warning = await screen.findByText(/not back|cannot be returned|no LXC→LENS/i)
    expect(warning).toBeInTheDocument()
    // Present in the same panel as the button, i.e. readable before committing.
    expect(screen.getByRole('button', { name: /^convert$/i })).toBeInTheDocument()
  })

  it('quotes the cost with the same CEIL the server charges', async () => {
    renderConvert()
    const input = await openPanel()
    fireEvent.change(input, { target: { value: '1.5' } })
    // 1.5 LXC × 2 LENS/LXC = 3 LENS. Rounded UP by the server; the screen must not show less.
    await waitFor(() => expect(screen.getByText(/Costs/i)).toBeInTheDocument())
  })
})

describe('converting moves the balances', () => {
  it('asks for the LXC amount in micros and reports both new balances', async () => {
    renderConvert()
    const input = await openPanel()
    fireEvent.change(input, { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: /^convert$/i }))

    // What the SERVER was asked — the wire unit is µLXC, and a UI that sent whole tokens would
    // convert a millionth of the intended amount.
    await waitFor(() => expect(posted).toEqual({ lxc_amount_ulxc: 1_000_000 }))

    // And what the person is told afterwards: the LXC balance rose, stated from the server's own
    // numbers rather than a local guess.
    expect(await screen.findByText(/LXC balance is now/i)).toBeInTheDocument()
  })

  it('never asks for a workspace — the BFF takes it from the session', async () => {
    renderConvert()
    const input = await openPanel()
    fireEvent.change(input, { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: /^convert$/i }))
    await waitFor(() => expect(posted).not.toBeNull())
    expect(JSON.stringify(posted)).not.toMatch(/workspace/i)
  })
})

describe('the refusals say what happened to the money', () => {
  it('a 402 says nothing was converted', async () => {
    mockBff({ convertStatus: 402 })
    renderConvert()
    const input = await openPanel()
    fireEvent.change(input, { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: /^convert$/i }))
    expect(await screen.findByText(/nothing was converted/i)).toBeInTheDocument()
  })

  it('refuses below the minimum without asking the server', async () => {
    renderConvert()
    const input = await openPanel()
    fireEvent.change(input, { target: { value: '0.01' } }) // 10_000 µLXC < 100_000 minimum
    // The refusal specifically — the rate line also contains the word "minimum".
    expect(await screen.findByText(/Below the .* LXC minimum/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^convert$/i })).toBeDisabled()
    expect(posted).toBeNull()
  })

  it('refuses an amount costing more LENS than the workspace holds', async () => {
    renderConvert(1_000_000) // 1 LENS on hand; 1 LXC costs 2 LENS at this rate
    const input = await openPanel()
    fireEvent.change(input, { target: { value: '1' } })
    // Wording changed deliberately when held balances were surfaced: "has" was ambiguous once a
    // workspace could hold LENS it cannot yet spend. See Held.test.tsx.
    expect(await screen.findByText(/more LENS than this workspace can spend right now/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^convert$/i })).toBeDisabled()
  })
})
