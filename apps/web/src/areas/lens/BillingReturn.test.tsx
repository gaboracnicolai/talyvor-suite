import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BillingCancel, BillingSuccess } from './BillingReturn'
import { PENDING_TOPUP_KEY } from './topupApi'

// /billing/success and /billing/cancel — the URLs Lens ALREADY redirects Stripe
// back to (LENS_BILLING_SUCCESS_URL defaults to
// app.talyvor.com/billing/success?session_id={CHECKOUT_SESSION_ID}).
//
// THE ONE THING THIS SCREEN MUST NOT DO IS ASSERT. Crediting is asynchronous:
// Stripe redirects the browser back the instant the payment succeeds, while the
// LXC credit only lands when Stripe's webhook reaches Lens and its handler
// commits. Reading the balance ONCE and showing it would routinely tell a paying
// customer their money vanished. So it polls against the balance recorded before
// checkout, with a bounded timeout, and when the timeout wins it says so
// plainly — it never claims success it has not observed, and never implies the
// money is gone.

const before = 42_000_000
const after = 142_000_000

function balanceBody(ulxc: number) {
  return {
    workspace_id: 'trial-ws-1',
    balance_ulxc: ulxc,
    lifetime_minted_ulxc: 0,
    lifetime_spent_ulxc: 0,
    usd_value_uusd: ulxc / 10,
  }
}

/** Serves /api/lxc/balance. `creditsAfter` = how many polls happen before the
 *  webhook's credit shows up (Infinity ⇒ it never lands). */
function mockBalance(creditsAfter: number) {
  let calls = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (String(input) === '/api/lxc/balance') {
      calls += 1
      const ulxc = calls > creditsAfter ? after : before
      return new Response(JSON.stringify(balanceBody(ulxc)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response('null', { status: 404 })
  })
}

function stashPending(balance = before) {
  window.sessionStorage.setItem(
    PENDING_TOPUP_KEY,
    JSON.stringify({ balance_ulxc: balance, usd_cents: 10000, at: Date.now() }),
  )
}

function renderSuccess(url = '/billing/success?session_id=cs_test_a1b2c3') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route
            path="/billing/success"
            element={<BillingSuccess pollIntervalMs={5} timeoutMs={400} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  window.sessionStorage.clear()
})

describe('BillingSuccess — it polls, it does not assert', () => {
  it('does not claim the credit landed while the balance is still the pre-purchase one', async () => {
    stashPending()
    mockBalance(Infinity)
    renderSuccess()

    expect(await screen.findByText(/confirming/i)).toBeInTheDocument()
    // The failure this prevents: announcing success on a balance that has not moved.
    expect(screen.queryByText(/credit has landed|added to your balance/i)).not.toBeInTheDocument()
  })

  it('confirms only once the balance actually rises above the pre-purchase figure', async () => {
    stashPending()
    mockBalance(2) // lands on the third read
    renderSuccess()

    expect(await screen.findByText(/added to your balance/i, undefined, { timeout: 3000 })).toBeInTheDocument()
  })

  it('confirms immediately when the webhook beat the redirect back', async () => {
    // The common case: the credit committed before this page ever mounted. A
    // baseline captured at mount would never see a change and would time out.
    stashPending()
    mockBalance(0) // already credited on the very first read
    renderSuccess()

    expect(await screen.findByText(/added to your balance/i)).toBeInTheDocument()
    expect(screen.queryByText(/hasn’t appeared yet/i)).not.toBeInTheDocument()
  })

  it('when the credit never lands it says so, says the payment is not lost, and says what to do', async () => {
    stashPending()
    mockBalance(Infinity)
    renderSuccess()

    const timedOut = await screen.findByText(/hasn’t appeared yet/i, undefined, { timeout: 3000 })
    expect(timedOut).toBeInTheDocument()
    // Never "your money vanished": the payment IS recorded at Stripe, and the
    // customer needs the actual cause and a next step.
    expect(screen.getByText(/webhook/i)).toBeInTheDocument()
    expect(screen.getByText(/nothing is lost|payment is recorded|still recorded/i)).toBeInTheDocument()
    expect(screen.queryByText(/added to your balance/i)).not.toBeInTheDocument()
  })

  it('stops polling once it has an answer rather than hammering the BFF', async () => {
    stashPending()
    let calls = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input) === '/api/lxc/balance') {
        calls += 1
        return new Response(JSON.stringify(balanceBody(after)), { status: 200 })
      }
      return new Response('null', { status: 404 })
    })
    renderSuccess()

    await screen.findByText(/added to your balance/i)
    const settled = calls
    await new Promise((r) => setTimeout(r, 120)) // many poll intervals
    expect(calls).toBe(settled)
  })

  it('shows the Stripe session id as the reference for support', async () => {
    stashPending()
    mockBalance(0)
    renderSuccess()
    expect(await screen.findByText(/cs_test_a1b2c3/)).toBeInTheDocument()
  })

  it('without a recorded pre-purchase balance it says it cannot confirm, rather than guessing', async () => {
    // No stash (different browser, cleared storage): "balance is X" proves
    // nothing about THIS payment, so the page must not imply that it does.
    mockBalance(0)
    renderSuccess()

    expect(await screen.findByText(/can’t confirm this payment from this browser/i)).toBeInTheDocument()
    expect(screen.queryByText(/added to your balance/i)).not.toBeInTheDocument()
  })

  it('treats a stale recorded balance as absent instead of comparing against an old figure', async () => {
    window.sessionStorage.setItem(
      PENDING_TOPUP_KEY,
      JSON.stringify({ balance_ulxc: before, usd_cents: 10000, at: Date.now() - 3 * 60 * 60 * 1000 }),
    )
    mockBalance(0)
    renderSuccess()
    expect(await screen.findByText(/can’t confirm this payment from this browser/i)).toBeInTheDocument()
  })

  it('a balance that cannot be read at all is reported as such, not as a failed payment', async () => {
    stashPending()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 502 }))
    renderSuccess()

    expect(await screen.findByText(/couldn’t read your balance/i, undefined, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.queryByText(/added to your balance/i)).not.toBeInTheDocument()
  })
})

describe('BillingCancel', () => {
  it('states plainly that nothing was charged and offers the way back', () => {
    render(
      <MemoryRouter initialEntries={['/billing/cancel']}>
        <BillingCancel />
      </MemoryRouter>,
    )
    expect(screen.getByText(/nothing was charged/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /top up|billing/i })).toBeInTheDocument()
  })

  it('clears the pending record so a later success page cannot compare against an abandoned checkout', () => {
    stashPending()
    render(
      <MemoryRouter initialEntries={['/billing/cancel']}>
        <BillingCancel />
      </MemoryRouter>,
    )
    expect(window.sessionStorage.getItem(PENDING_TOPUP_KEY)).toBeNull()
  })
})

// ─── W1.1.4 — THE REBUILD, ON THE TWO RETURN ADDRESSES ───────────────────────────────────────
//
// These are the same SCREEN as /billing — three routes, one purchase — and they were the same
// single anonymous card. The state a customer is in when they land here is the whole content of
// the page (waiting, confirmed, timed out, unconfirmable, unreadable), and the page named it only
// in a card header. It is the page-scale claim now, which is what it always was.

describe('W1.1.4 — the return pages carry the same marking as the screen they belong to', () => {
  it('the success page opens with exactly one page-scale heading, and it is an h2', async () => {
    stashPending()
    mockBalance(0)
    renderSuccess()
    await screen.findByText(/added to your balance/i)
    const pageScale = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter((h) =>
      h.className.includes('text-page'),
    )
    expect(pageScale.map((h) => h.tagName)).toEqual(['H2'])
  })

  it('the success page names the state at page scale, not only inside a card', async () => {
    // The reader arriving here has one question. Four of the five states answered it in a
    // 17px card header while the page had no heading of its own at all.
    stashPending()
    mockBalance(Infinity)
    renderSuccess()
    await screen.findByText(/hasn’t appeared yet/i, undefined, { timeout: 3000 })
    const pageScale = document.querySelector('h2.text-page')
    expect(pageScale?.textContent ?? '').toMatch(/Stripe/i)
  })

  it('every section of the success page is a NAMED landmark', async () => {
    stashPending()
    mockBalance(0)
    renderSuccess()
    await screen.findByText(/added to your balance/i)
    const sections = Array.from(document.querySelectorAll('section'))
    expect(sections.length).toBeGreaterThan(1)
    expect(screen.getAllByRole('region')).toHaveLength(sections.length)
  })

  it('the cancel page opens with exactly one page-scale heading, and it is an h2', () => {
    render(
      <MemoryRouter initialEntries={['/billing/cancel']}>
        <BillingCancel />
      </MemoryRouter>,
    )
    const pageScale = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter((h) =>
      h.className.includes('text-page'),
    )
    expect(pageScale.map((h) => h.tagName)).toEqual(['H2'])
  })
})
