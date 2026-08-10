import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Overview } from './Overview'
import { Spend } from './Spend'

// ── THE MINT LEDGER'S SETTLED ROWS CARRY NO MODEL ATTRIBUTION ───────────────────────────
//
// `spendMath.byModel` groups /api/tokens/history rows by `metadata.model_used` and DROPS
// every row that has none. Two screens then read `agg.length === 0` as "there is nothing
// here" and print a sentence about EARNINGS:
//
//   Spend.tsx     "No ledger rows in this window."
//   Overview.tsx  "No earnings yet."
//
// Those two claims are about the LEDGER. The predicate is about MODEL ATTRIBUTION. They
// are the same sentence only when every mint row carries `model_used`, which Overview.tsx
// asserted in prose ("LENS mint rows carry metadata.model_used") and api.ts repeated ("on
// the live data its keys are provenance (model_used, latency_bucket, …)"). Neither was
// measured.
//
// ⚠ MEASURED IN THE UPSTREAM, 2026-08-10, at talyvor-lens HEAD. Every row that lands in
// `lens_token_ledger` as a SETTLED (counted) mint is written by one of exactly two
// sweepers, and the metadata map is a literal at each:
//
//   internal/mining/traffic_holds.go:181   {"request_id": …, "traffic_hold": true}
//       → cache_mine · compute_mine · embedding_mine · pattern_mine
//   internal/poolroyalty/sweeper.go:257    {"request_id": …}
//       → pool_royalty · eval_contribution · eval_routing_prediction ·
//         eval_latency_locality · eval_confidential_compute
//
// NEITHER STAMPS `model_used`. Of the thirteen `map[string]interface{}` metadata literals
// that reach a `lens_token_ledger` writer, exactly ONE names `model_used` —
// internal/mining/pattern_mining.go:486 — and it is stamped on the HELD row
// (`CreditHeldTx`, type `pattern_mine_held`), behind `if !optedIn || earned <= 0`, for a
// pattern-mine earning stage talyvor-lens COORDINATION.md:154 records as not switched on.
// `GetHistory` (internal/mining/cache_mining.go:813) selects the stored metadata and
// synthesizes nothing.
//
// So on the settled ledger this product actually writes, `byModel` returns [] for every
// page — and the screens report that as "no earnings". Overview prints it directly under a
// "Lifetime earned" figure read from /api/tokens/balance, which is NOT derived from
// metadata and is non-zero the moment anything settles. One card says the workspace earned
// LENS; the card below it says it has not earned any.
//
// THE RULE THIS FILE HOLDS: an empty per-model split may only be reported as an empty
// LEDGER when the ledger window is actually empty. Anything else is the screen describing
// its own key as the world.

const NOW = new Date('2026-07-22T12:00:00Z')

/** The wire shape of one /api/tokens/history row (lib/api.ts LedgerEntry). */
interface MintRow {
  id: string
  workspace_id: string
  amount_ulens: number
  balance_after_ulens: number
  type: string
  description: string
  metadata: Record<string, unknown>
  created_at: string
}

/** A settled traffic mint exactly as internal/mining/traffic_holds.go:181 writes it. */
function settledMintRow(i: number, ulens: number): MintRow {
  const created = new Date(NOW.getTime() - (i + 1) * 60 * 60 * 1000) // an hour apart
  return {
    id: `m${i}`,
    workspace_id: 'w',
    amount_ulens: ulens,
    balance_after_ulens: ulens * (i + 1),
    type: 'cache_mine',
    description: 'traffic mint finalized (held → spendable)',
    metadata: { request_id: `rq-${i}`, traffic_hold: true },
    created_at: created.toISOString(),
  }
}

/** The same row with the attribution the two screens are built to split on. */
function attributedMintRow(i: number, ulens: number, model: string): MintRow {
  return { ...settledMintRow(i, ulens), metadata: { request_id: `rq-${i}`, model_used: model } }
}

/** Serves the console's reads. `history` is the mint ledger; `earned` is the balance card. */
function stubWire(history: MintRow[], earned: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      const json = (v: unknown) =>
        new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (path.includes('/api/tokens/history')) return json(history)
      if (path.includes('/api/lxc/history')) return json([])
      if (path.includes('/api/spend/month')) return json({ current_month_usd: 0 })
      if (path.includes('/api/usage'))
        return json({
          period_days: 30,
          models: [],
          cache: { total_requests: 0, cache_hits: 0, misses: 0, hit_rate: 0, by_source: {} },
        })
      if (path.includes('/api/lxc/balance'))
        return json({
          workspace_id: 'w',
          balance_ulxc: 0,
          lifetime_minted_ulxc: 0,
          lifetime_spent_ulxc: 0,
          usd_value_uusd: 0,
        })
      if (path.includes('/api/tokens/balance'))
        return json({
          workspace_id: 'w',
          balance_ulens: earned,
          lifetime_earned_ulens: earned,
          lifetime_spent_ulens: 0,
          updated_at: NOW.toISOString(),
        })
      if (path.includes('/api/bonds')) return new Response('{}', { status: 404 })
      return json([])
    }),
  )
}

function mount(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  )
}

/** Every panel's loading placeholder is gone — the screen has an answer for every read. */
const settled = () => waitFor(() => expect(screen.queryAllByText('Loading…')).toHaveLength(0))

afterEach(() => vi.unstubAllGlobals())

describe('/spend — an unattributable window is not an empty one', () => {
  it('does NOT claim the window holds no ledger rows when it holds three', async () => {
    stubWire([settledMintRow(0, 1_400_000), settledMintRow(1, 900_000), settledMintRow(2, 500_000)], 2_800_000)
    mount(<Spend now={NOW} />)
    // ⚠ THE ANCHOR IS "EVERY QUERY HAS SETTLED", NOT "THE CARD IS ON SCREEN". The first
    // draft anchored on the CardHeader — which renders while `ledger.isLoading` is still
    // true — and the `toBeNull()` below PASSED against a card showing "Loading…". A
    // negative assertion on a screen that has not resolved is satisfied by the absence of
    // the whole screen.
    await settled()
    expect(screen.getByText('Earned by model — LENS mint attribution')).toBeTruthy()
    expect(screen.queryByText(/No ledger rows in this window/)).toBeNull()
    // The COUNT, not just the branch: a sentence that says "0 ledger rows landed in this
    // window" is the same false claim in different words, and `agg.length` is right there
    // to be printed by mistake.
    expect(screen.getByTestId('lens-unattributed').textContent).toContain('3 ledger rows landed')
  })

  it('MUST STAY GREEN — an actually empty window still says the window is empty', async () => {
    stubWire([], 0)
    mount(<Spend now={NOW} />)
    expect(await screen.findByText(/No ledger rows in this window/)).toBeTruthy()
    expect(screen.queryByTestId('lens-unattributed')).toBeNull()
  })

  it('MUST STAY GREEN — rows that DO carry model_used still render the split', async () => {
    // The control on this file's own fixture: the same wire, the same screen, one metadata
    // key different. Without it, a screen that renders no split for ANY input would satisfy
    // the first case for the wrong reason.
    stubWire([attributedMintRow(0, 1_400_000, 'claude-sonnet-5')], 1_400_000)
    mount(<Spend now={NOW} />)
    expect(await screen.findByTestId('lens-by-model')).toBeTruthy()
    expect(screen.getByText('claude-sonnet-5')).toBeTruthy()
    expect(screen.queryByTestId('lens-unattributed')).toBeNull()
    expect(screen.queryByText(/No ledger rows in this window/)).toBeNull()
  })
})

describe('the console landing screen — "No earnings yet" under a non-zero Lifetime earned', () => {
  it('does NOT say the workspace has no earnings while showing the LENS it earned', async () => {
    const { container } = (stubWire(
      [settledMintRow(0, 1_400_000), settledMintRow(1, 1_400_000)],
      2_800_000,
    ),
    mount(<Overview now={NOW} />))
    // Both halves of the contradiction, on one screen, in one assertion pair.
    await settled()
    expect(screen.getByText('Lifetime earned')).toBeTruthy()
    expect(container.textContent).toContain('2.800000')
    expect(screen.queryByText(/No earnings yet/)).toBeNull()
    expect(screen.getByTestId('lens-unattributed').textContent).toContain('2 ledger rows landed')
  })

  it('MUST STAY GREEN — a workspace with an empty mint ledger still reads "No earnings yet"', async () => {
    stubWire([], 0)
    mount(<Overview now={NOW} />)
    expect(await screen.findByText(/No earnings yet/)).toBeTruthy()
    expect(screen.queryByTestId('lens-unattributed')).toBeNull()
  })
})
