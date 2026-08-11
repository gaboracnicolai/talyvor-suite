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
let quoteFetches = 0

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

  // ⚠ THIS CASE ASSERTED THAT THE WORD "Costs" WAS ON SCREEN. It did the arithmetic in a comment
  // — "1.5 LXC × 2 LENS/LXC = 3 LENS. Rounded UP by the server; the screen must not show less" —
  // and then checked a LABEL, never the number under it. MEASURED: `lensCostForLXC`'s
  // `Math.ceil` -> `Math.floor` left all 1059 tests GREEN, so the one function whose whole job is
  // to round a CHARGE the server's way was pinned by nothing.
  //
  // ⚠ AND THE INPUT COULD NOT HAVE TOLD EITHER. 1.5 × 2 = 3 exactly; ceil and floor agree on every
  // integer, so even reading the number would not have caught it. Both halves were vacuous, which
  // is why the direction has its own case below with a rate whose product is NOT whole.
  it('quotes the cost the arithmetic gives, read off the screen', async () => {
    renderConvert()
    const input = await openPanel()
    fireEvent.change(input, { target: { value: '1.5' } })
    // 1.5 LXC × 2 LENS/LXC = 3 LENS.
    await waitFor(() =>
      expect(screen.getByText(/Costs/i).textContent).toMatch(/3\.000000/),
    )
  })

  // THE ROUNDING DIRECTION, on the only input shape that can show it. A rate of 2.0000005 puts the
  // product at 2,000,000.5 µLENS: ceil charges 2.000001, floor charges 2.000000. Lens rounds a
  // CHARGE up (mining.MulCeil — "the charge never under-collects a sub-unit"), and a panel quoting
  // the floor would promise less than the debit on an irreversible action.
  it('rounds the quote UP, so the button never promises less than the debit', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input) === '/api/lens/convert-quote')
        return new Response(JSON.stringify({ ...quote, lens_per_lxc: 2.0000005 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      return new Response('null', { status: 404 })
    })
    renderConvert()
    const input = await openPanel()
    fireEvent.change(input, { target: { value: '1' } })
    await waitFor(() =>
      expect(screen.getByText(/Costs/i).textContent).toMatch(/2\.000001/),
    )
    expect(screen.getByText(/Costs/i).textContent).not.toMatch(/2\.000000/)
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

// ⚠ THE RECEIPT — what the workspace was ACTUALLY charged, which this panel used to discard.
//
// Every case above runs on a fixture where the quote rate and the convert rate are BOTH 2, so the
// predicted cost and the real debit are the same number and no assertion can tell which one the
// screen is reading. That uniformity is why nothing here could see the defect: the client's
// `lensCostForLXC` mirror and the server's `lens_spent_ulens` were interchangeable in every test.
//
// They are not interchangeable in production. The quote is a SNAPSHOT — Lens computes the charge
// from `CurrentRate(ctx)` at POST time (`internal/economy/dualtoken.go`, the `Convert` path) and this file's own
// header says the rate "changes" — so these run the panel with the rate MOVED between the read and
// the click, which is the only fixture shape in which the two sources can be told apart.
//
// MEASURED before the fix, on the rendered component: with the quote at 2 and the server charging
// at 3, the panel read `Costs 2.000000lens — rounded up, the way the server charges it.` and then
// `Converted. LXC balance is now 5.000000lxc, LENS 7.000000lens.` — the stale promise left
// standing beside a conversion that cost 50% more, and the real debit stated nowhere.
describe('the conversion says what it actually cost', () => {
  /** Quote at `quoted`, charge at `charged` — the divergence the wire allows and the fixtures hid. */
  function mockMovedRate(quoted: number, charged: number) {
    quoteFetches = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url === '/api/lens/convert-quote') {
        quoteFetches += 1
        return new Response(JSON.stringify({ ...quote, lens_per_lxc: quoted }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url === '/api/lens/convert') {
        return new Response(
          JSON.stringify({
            lxc_minted_ulxc: 1_000_000,
            lens_spent_ulens: 1_000_000 * charged,
            rate: charged,
            new_lxc_balance_ulxc: 5_000_000,
            new_lens_balance_ulens: 7_000_000,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('null', { status: 404 })
    })
  }

  async function convertOne() {
    renderConvert()
    const input = await openPanel()
    fireEvent.change(input, { target: { value: '1' } })
    await screen.findByText(/rounded up, the way the server charges it/i)
    fireEvent.click(screen.getByRole('button', { name: /^convert$/i }))
    return await screen.findByText(/^Converted\./i)
  }

  // ⚠ THE ASSERTION IS THE SERVER'S NUMBER, NOT "A NUMBER". 3.000000 is `lens_spent_ulens`;
  // 2.000000 is what the client's own mirror predicts from the quote it holds. A confirmation
  // rendering the prediction would satisfy any looser check and would still never have told this
  // workspace what left its balance.
  it('states the µLENS the server charged, not the µLENS this panel predicted', async () => {
    mockMovedRate(2, 3)
    const line = await convertOne()
    expect(line.textContent).toMatch(/Charged 3\.000000/)
    expect(line.textContent).not.toMatch(/Charged 2\.000000/)
  })

  // A quote the server has already contradicted is a stale read, and this panel's own onSuccess
  // reasoning — "keeps the screen's numbers the server's numbers" — is the argument for refetching
  // it. Counted as REQUESTS, because a rate that only looks refreshed is the failure being guarded.
  it('re-reads the rate it has just been proved wrong about', async () => {
    mockMovedRate(2, 3)
    await convertOne()
    await waitFor(() => expect(quoteFetches).toBeGreaterThan(1))
  })

  // The correction is only true when the rate actually moved, so it must be absent when it did not
  // — otherwise it is decoration that would "pass" on every fixture in this file.
  it('says nothing about a rate move when the rate did not move', async () => {
    mockMovedRate(2, 2)
    const line = await convertOne()
    expect(line.textContent).toMatch(/Charged 2\.000000/)
    expect(line.textContent).not.toMatch(/the rate moved/i)
  })
})
