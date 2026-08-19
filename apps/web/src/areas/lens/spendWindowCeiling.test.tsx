import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Overview } from './Overview'
import { Spend } from './Spend'
import { LEDGER_PAGE, windowExceedsPage } from './spendMath'
import type { SignedRow } from './spendMath'

// ── THE PAGE CEILING ────────────────────────────────────────────────────────────────────
//
// Every window figure on /spend and on the console's landing screen is derived from ONE
// ledger page. The page is 200 rows and 200 is a CEILING, not a request — clamped in TWO
// independent places:
//
//   apps/bff/lens.go:422          clampInt(r.URL.Query().Get("limit"), 20, 1, 200)
//   lens internal/economy/dualtoken.go#DualTokenStore.GetLXCHistory   if limit > 200 { limit = 200 }
//
// MEASURED on the real BFF binary against an upstream holding 260 rows: asking for
// limit=1000 served 200. The control — the same binary, the same question, an upstream
// holding 150 — served 150. So 200 is what the wire will give, not what the fixture chose.
//
// The rows arrive `ORDER BY created_at DESC`, so a full page is the NEWEST 200 and the
// truncation drops the OLDEST rows in the window: every total over it is a FLOOR.
//
// ⚠ ORDINARY VOLUME REACHES IT. A reserved request writes THREE lxc_ledger rows —
// reservation_hold, reservation_release and spend (lens agent_subbudget.go#ReserveLXCForAgent,
// and #SettleLXCReservation's release + delivered-charge writes) —
// so 200 rows is ~67 requests. Overview's window is THIRTY DAYS.
//
// This stub is the WIRE, not a fixture opinion: it holds `rows` and answers `limit`/`offset`
// with the same clamp the two servers apply. A test that hands the screen all 260 rows would
// be measuring a network that does not exist.

const PAGE_CEILING = 200

function ledgerRow(i: number, now: Date, ulxc: number) {
  const created = new Date(now.getTime() - (i + 1) * 20 * 60 * 1000) // 20 min apart
  return {
    id: `s${String(i).padStart(4, '0')}`,
    workspace_id: 'w',
    amount_ulxc: -ulxc,
    balance_after_ulxc: 50_000_000 - ulxc * (i + 1),
    type: 'spend',
    description: 'reservation settle: delivered charge',
    metadata: { requested_model: 'claude-sonnet-5', served_model: 'claude-haiku-4-5', request_id: `rq${i}` },
    created_at: created.toISOString(),
  }
}

const NOW = new Date('2026-07-22T12:00:00Z')
const PER_ROW = 1_000

/** Serves `total` newest-first spend rows through the measured wire clamp. */
function stubWire(total: number) {
  const all = Array.from({ length: total }, (_, i) => ledgerRow(i, NOW, PER_ROW))
  const asked: { limit: number; offset: number }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      const json = (v: unknown) =>
        new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (path.includes('/api/lxc/history')) {
        const u = new URL(path, 'http://x')
        const limit = Math.min(Number(u.searchParams.get('limit') ?? 20), PAGE_CEILING)
        const offset = Number(u.searchParams.get('offset') ?? 0)
        asked.push({ limit, offset })
        return json(all.slice(offset, offset + limit))
      }
      if (path.includes('/api/tokens/history')) return json([])
      if (path.includes('/api/spend/month')) return json({ current_month_usd: (total * PER_ROW) / 1_000_000 })
      if (path.includes('/api/usage'))
        return json({
          period_days: 30,
          models: [],
          cache: { total_requests: total, cache_hits: 0, misses: total, hit_rate: 0, by_source: { upstream: total } },
        })
      if (path.includes('/api/lxc/balance'))
        return json({ workspace_id: 'w', balance_ulxc: 1, lifetime_minted_ulxc: 1, lifetime_spent_ulxc: 1, usd_value_uusd: 1 })
      if (path.includes('/api/tokens/balance'))
        return json({ workspace_id: 'w', balance_ulens: 0, lifetime_earned_ulens: 0, lifetime_spent_ulens: 0, updated_at: NOW.toISOString() })
      if (path.includes('/api/bonds')) return new Response('{}', { status: 404 })
      return json([])
    }),
  )
  return { asked, trueTotal: total * PER_ROW }
}

function mount(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('the predicate: did this page reach back past the window?', () => {
  const rows = (n: number): SignedRow[] =>
    Array.from({ length: n }, (_, i) => {
      const r = ledgerRow(i, NOW, PER_ROW)
      return { amount: r.amount_ulxc, created_at: r.created_at, type: r.type }
    })

  it('a FULL page whose oldest row is still inside the window has NOT covered it', () => {
    // 200 rows 20 minutes apart reach back 2.8 days — well short of the 7-day edge.
    expect(windowExceedsPage(rows(PAGE_CEILING), PAGE_CEILING, 7, NOW)).toBe(true)
  })

  it('a SHORT page proves the ledger was exhausted, so the window is covered', () => {
    expect(windowExceedsPage(rows(PAGE_CEILING - 1), PAGE_CEILING, 7, NOW)).toBe(false)
  })

  it('a full page that reaches back PAST the cutoff has covered the window', () => {
    // Same 200 rows, but asked about a window narrower than the page's reach.
    expect(windowExceedsPage(rows(PAGE_CEILING), PAGE_CEILING, 1, NOW)).toBe(false)
  })

  it('an empty page is covered, not truncated', () => {
    expect(windowExceedsPage([], PAGE_CEILING, 7, NOW)).toBe(false)
  })

  it('finds the oldest row by VALUE, not by position — order is the upstream’s promise', () => {
    // Every other case here arrives newest-first, so `rows[rows.length - 1]` and `min` are
    // the same answer and neither is under test. Rotate the page so the row that decides
    // the verdict is in the middle: a full page whose oldest row IS past the cutoff has
    // covered the window, and reading the LAST element would report the opposite.
    const page = rows(PAGE_CEILING)
    const old = { amount: -1, created_at: new Date(NOW.getTime() - 40 * 864e5).toISOString(), type: 'spend' }
    const rotated = [...page.slice(0, 90), old, ...page.slice(90, PAGE_CEILING - 1)]
    expect(rotated).toHaveLength(PAGE_CEILING)
    expect(windowExceedsPage(rotated, PAGE_CEILING, 7, NOW)).toBe(false)
  })

  it('LEDGER_PAGE is the wire ceiling both servers clamp to', () => {
    // Hardcoded, NOT read back from the constant under test: a guard that compares a
    // constant to itself passes for every value.
    expect(LEDGER_PAGE).toBe(200)
  })
})

describe('/spend — a window total it cannot know is never dressed as one it can', () => {
  it('MARKS the debits figure as a floor when the window overflows the page', async () => {
    const { trueTotal } = stubWire(260)
    mount(<Spend now={NOW} />)
    const row = await screen.findByTestId('lxc-debit-total')
    // The number on screen is the first page only — 23% under the truth.
    expect(row).toHaveTextContent('200,000')
    expect(trueTotal).toBe(260_000)
    // …so it must not be presented as the total.
    expect(row).toHaveTextContent(/at least/i)
    expect(await screen.findByTestId('lxc-window-incomplete')).toBeInTheDocument()
  })

  it('the per-model split carries the same mark — its charge counts are floors too', async () => {
    stubWire(260)
    mount(<Spend now={NOW} />)
    const split = await screen.findByTestId('lxc-by-model')
    expect(split).toHaveTextContent('200 charges')
    expect(split).toHaveTextContent(/at least/i)
  })

  it('MUST STAY GREEN — under the ceiling the exact numeral stands, unqualified', async () => {
    stubWire(150)
    mount(<Spend now={NOW} />)
    const row = await screen.findByTestId('lxc-debit-total')
    expect(row).toHaveTextContent('150,000')
    expect(row).not.toHaveTextContent(/at least/i)
    expect(screen.queryByTestId('lxc-window-incomplete')).toBeNull()
  })

  it('the predicate is asked about the SAME page size the fetch used', async () => {
    const { asked } = stubWire(260)
    mount(<Spend now={NOW} />)
    await screen.findByTestId('lxc-debit-total')
    // If the fetch ever asks for a page the predicate does not know about, the mark
    // becomes an opinion about a number it is not describing.
    expect(asked.length).toBeGreaterThan(0)
    expect(asked.every((a) => a.limit === LEDGER_PAGE && a.offset === 0)).toBe(true)
  })
})

describe('the console landing screen — same seam, a THIRTY-day window on the same one page', () => {
  it('MARKS the debits figure as a floor when the window overflows the page', async () => {
    stubWire(260)
    mount(<Overview now={NOW} />)
    const row = await screen.findByTestId('lxc-debit-total')
    expect(row).toHaveTextContent('200,000')
    expect(row).toHaveTextContent(/at least/i)
  })

  it('MUST STAY GREEN — under the ceiling the exact numeral stands, unqualified', async () => {
    stubWire(150)
    mount(<Overview now={NOW} />)
    const row = await screen.findByTestId('lxc-debit-total')
    expect(row).toHaveTextContent('150,000')
    expect(row).not.toHaveTextContent(/at least/i)
  })
})
