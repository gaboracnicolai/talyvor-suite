import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Ledger } from './Ledger'

// THE SCREEN MUST DESCRIBE THE ROWS IT IS SHOWING, NOT THE ONES IT ASKED FOR.
//
// The ledger keeps the previous response on screen while the next one loads
// (`placeholderData`) — right for paging, because a table that blanks on every
// Next is unusable. But every LABEL around those rows was derived from the
// REQUEST: the card header, the unit tick, the Pill vocabulary and the row range
// all read the `token`/`offset` STATE, which moves the instant the button is
// pressed. So for one whole upstream round-trip the screen put the new request's
// labels on the old request's money.
//
// MEASURED IN REAL CHROME 151 on the built bundle against the real BFF binary,
// with a fake Lens delaying the read 3s (the round-trip is the whole window; a
// slow upstream makes it longer). Sampling the DOM every ~300ms from the click:
//
//   t=71ms … t=2781ms   header "LENS token ledger"   3 rows, all LXC
//     pre-serve bound        reservation_hold    a SETTLED Pill    -64 µLENS
//     bound released         reservation_release a SETTLED Pill     64 µLENS
//     trial top-up …         admin_grant         plain label     5.000000 LENS
//     copper LENS tick ×6 · steel LXC tick ×0 · "Loading…" absent at every sample
//   t=3083ms            the LENS ledger arrives: 1 row, 1,000 µLENS
//
// Two separate false statements in that window, both about money:
//  · THE UNIT. A purchased fiat LXC grant read `5.000000 LENS` — the mined token.
//    They are different tokens with different values; the copper/steel tick is
//    the product's own signature for not confusing them, and it was pointing the
//    wrong way on every row.
//  · THE LIFECYCLE. `reservation_hold`/`reservation_release` wore the `settled`
//    Pill — "a counted mint in circulation" — which is exactly what `8ab7348`
//    was merged to stop, on exactly those two types. Asking `ledgerStatus` WHICH
//    LEDGER cannot rot, but it was being asked about the ledger being LOADED
//    while the rows on screen came from the other one.
//
// And paging, same cause, measured the same way: for the full round-trip after
// Next the caption read `Rows 21–40` over rows 1–20.
//
// So the fix is not "stop keeping the previous page" — it is that the data
// carries its own identity and the labels come from the data. The token half
// additionally drops the placeholder outright: the previous PAGE of this ledger
// is a reasonable thing to keep looking at, the OTHER LEDGER is not.

const LXC_ROWS = [
  { id: 'x1', workspace_id: 'w', amount_ulxc: -64, balance_after_ulxc: 9999936, type: 'reservation_hold', description: 'pre-serve bound', metadata: {}, created_at: '2026-07-19T15:48:07Z' },
  { id: 'x2', workspace_id: 'w', amount_ulxc: 64, balance_after_ulxc: 10000000, type: 'reservation_release', description: 'bound released', metadata: {}, created_at: '2026-07-19T15:47:07Z' },
  { id: 'x3', workspace_id: 'w', amount_ulxc: 5000000, balance_after_ulxc: 14999936, type: 'admin_grant', description: 'trial top-up via admin grant', metadata: {}, created_at: '2026-07-19T14:47:36Z' },
]
const LENS_ROWS = [
  { id: 'l1', workspace_id: 'w', amount_ulens: 1000, balance_after_ulens: 1000, type: 'pattern_mine', description: 'pattern shared', metadata: {}, created_at: '2026-07-19T14:35:21Z' },
]
const PAGE_ONE = Array.from({ length: 20 }, (_, i) => ({
  id: `pg1-${i}`, workspace_id: 'w', amount_ulxc: -64, balance_after_ulxc: 100, type: 'spend',
  description: `page one row ${i}`, metadata: {}, created_at: '2026-07-19T15:48:07Z',
}))
const PAGE_TWO = [
  { id: 'pg2-0', workspace_id: 'w', amount_ulxc: -64, balance_after_ulxc: 90, type: 'spend', description: 'page two row 0', metadata: {}, created_at: '2026-07-18T15:48:07Z' },
]

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

/** Lets the test stand where the browser stands: the request is made, the answer has not come back. */
function gate() {
  let open: (() => void) | null = null
  const held = new Promise<void>((resolve) => {
    open = resolve
  })
  return { held, open: () => open?.() }
}

/** Renders and lets React settle, exactly as a browser frame would. */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

function renderLedger() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Ledger />
    </QueryClientProvider>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('the ledger names the rows it is showing, not the ones it requested', () => {
  it('a token switch never repaints the other ledger in this ledger’s unit and vocabulary', async () => {
    const lens = gate()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('/api/lxc/history')) return json(LXC_ROWS)
      if (url.startsWith('/api/tokens/history')) {
        await lens.held
        return json(LENS_ROWS)
      }
      return new Response('null', { status: 404 })
    })

    const { container } = renderLedger()

    // THE SUBJECT EXISTS, and the instrument can see both ticks. Without this the
    // absences below would pass over an empty screen.
    expect(await screen.findByText('pre-serve bound')).toBeInTheDocument()
    expect(container.querySelectorAll('.bg-lxc').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('.bg-lens').length).toBe(0)
    expect(screen.queryAllByText('settled').length).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: 'LENS' }))
    await settle()

    // IN THE WINDOW. The read is out, the answer is not back — this is the whole
    // round-trip, ~2.8s of it measured in Chrome at a 3s upstream delay.
    expect(screen.getByText('Loading…')).toBeInTheDocument() // we are really here
    expect(screen.queryByText('pre-serve bound')).toBeNull() // no LXC row under a LENS header
    expect(screen.queryByText('bound released')).toBeNull()
    expect(screen.queryByText('trial top-up via admin grant')).toBeNull()
    expect(container.querySelectorAll('.bg-lens').length).toBe(0) // no copper tick on LXC money
    expect(screen.queryAllByText('settled').length).toBe(0) // no mint lifecycle on a reservation

    lens.open()
    await settle()

    // THE ANSWER ARRIVES — and this is what proves the assertions above were not
    // blind: the copper tick and the settled Pill DO appear, on a real LENS mint.
    expect(await screen.findByText('pattern shared')).toBeInTheDocument()
    expect(container.querySelectorAll('.bg-lens').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('.bg-lxc').length).toBe(0)
    expect(screen.queryAllByText('settled').length).toBeGreaterThan(0)
  })

  it('the row range counts the rows on screen while the next page is in flight', async () => {
    const page2 = gate()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('/api/lxc/history')) {
        if (url.includes('offset=0')) return json(PAGE_ONE)
        await page2.held
        return json(PAGE_TWO)
      }
      return new Response('null', { status: 404 })
    })

    const { container } = renderLedger()
    expect(await screen.findByText('page one row 0')).toBeInTheDocument()
    expect(container.textContent).toContain('Rows 1–20')

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await settle()

    // The rows are still page one — deliberately, so the table does not blank —
    // so the caption must still say page one.
    expect(screen.getByText('page one row 0')).toBeInTheDocument()
    expect(screen.getByText('page one row 19')).toBeInTheDocument()
    expect(container.textContent).toContain('Rows 1–20')
    expect(container.textContent).not.toContain('Rows 21–40')

    page2.open()
    await settle()

    // And it DOES move when the rows do — the assertion above is not a constant.
    expect(await screen.findByText('page two row 0')).toBeInTheDocument()
    expect(screen.queryByText('page one row 0')).toBeNull()
    expect(container.textContent).toContain('Rows 21–21')
  })
})
