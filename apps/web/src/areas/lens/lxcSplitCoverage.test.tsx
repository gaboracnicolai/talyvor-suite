import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Overview } from './Overview'
import { Spend } from './Spend'

// ⚠ THE PER-MODEL SPLIT SITS DIRECTLY UNDER THE WINDOW TOTAL AND CANNOT ADD UP TO IT.
//
// Both screens render `debitTotal` — "every model — the window total that left the balance" —
// and immediately below it the rows of `lxcDebitsByModel`, which Overview's own source calls
// "The per-model split of that total". Two things are in the total and in NO row of the split,
// and today nothing on either screen says so:
//
//   (a) A SETTLED CHARGE WHOSE ROW NAMES NO MODEL. `lxcDebitsByModel` drops it on purpose
//       ("absence of provenance is not a model") and `debitTotal` counts it. MEASURED in
//       talyvor-lens at `a04310a`, this is not hypothetical — THREE writers put `type='spend'`
//       rows on lxc_ledger and two of them can omit the model:
//         · internal/proxy/shadow_lxc.go:73 → DualTokenStore.SpendLXC → insertLXCLedger(...,
//           LXCTypeSpend, description, nil) — metadata literally nil
//           (dualtoken.go#DualTokenStore.SpendLXC);
//         · SettleLXCReservation stamps AgentDebitMeta.toMap, which OMITS an empty scalar
//           (agent_subbudget.go#AgentDebitMeta.toMap), so a settle whose reservation carried no
//           requested_model and whose caller passed no ServedModel writes a spend row with
//           neither key.
//       api.ts then maps `metadata: r.metadata ?? {}`, so an absent document arrives as `{}`
//       and the row reaches the split with no model claim.
//
//   (b) AN ATTRIBUTED CHARGE THE SCREEN LEAVES OUT. Overview renders `.slice(0, 5)`. The
//       sixth model's µLXC is in the total above it and in none of the five rows.
//
// The MINT card one card away already carries the sentence for its own version of (a)
// (`lens-unattributed`): "N ledger rows landed in this window, and none of them records which
// model it came from". The LXC card renders `lxcSplit.length > 0 ? … : null` — when the split
// is empty the total stands alone with no explanation at all, and when it is PARTIAL the rows
// simply under-sum the figure above them in silence.
//
// ⚠ WHY THE EXISTING TESTS ARE GREEN ON ALL OF IT. `spendHolds.test.tsx`'s second case is
// NAMED "so the split agrees with the total" and only asserts that a WRONG figure (8,380) is
// absent — it never adds the rendered rows up. Its fixture attributes every spend row to one
// model, so the split and the total agree by construction and disagreement is unreachable
// from it.

const NOW = new Date('2026-07-22T12:00:00Z')

type Row = {
  id: string
  amount_ulxc: number
  type: string
  metadata: Record<string, unknown>
  created_at: string
}

function row(id: string, amount: number, metadata: Record<string, unknown>, type = 'spend'): Row {
  return {
    id,
    amount_ulxc: amount,
    type,
    metadata,
    created_at: '2026-07-21T10:00:00Z',
  }
}

function stub(lxcRows: Row[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      const json = (v: unknown) =>
        new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (path.includes('/api/lxc/history')) return json(lxcRows)
      if (path.includes('/api/tokens/history')) return json([])
      if (path.includes('/api/spend/month')) return json({ current_month_usd: 0 })
      if (path.includes('/api/usage')) return json({ period_days: 30, models: [] })
      return json({})
    }),
  )
}

function renderScreen(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>{node}</QueryClientProvider>
    </MemoryRouter>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('the LXC per-model split and the total it sits under', () => {
  // ⭐ (a) PARTIAL ATTRIBUTION — the shape the shadow writer produces alongside a settled one.
  it('Spend: a charge whose row names no model is disclosed, not silently missing from the split', async () => {
    stub([
      row('s1', -900, { served_model: 'claude-haiku-4-5', request_id: 'rq1' }),
      // shadow_lxc.go → SpendLXC → metadata nil on the wire → `{}` after api.ts.
      row('s2', -600, {}),
    ])
    renderScreen(<Spend now={NOW} />)

    // The total is the sum of BOTH charges — that part is already right.
    await waitFor(() => {
      expect(screen.getByTestId('lxc-debit-total').textContent ?? '').toMatch(/1[,.]?500/)
    })
    // …and only 900 of it is in the split.
    expect(screen.getByTestId('lxc-by-model').textContent ?? '').toMatch(/900/)

    const unsplit = screen.getByTestId('lxc-unsplit')
    expect(unsplit.textContent ?? '').toMatch(/600/)
  })

  // ⭐ (a) TOTAL ATTRIBUTION FAILURE — the split is empty and the total is not zero. Today the
  // card renders the figure and nothing else: `lxcSplit.length > 0 ? … : null`.
  it('Spend: when NO charge names a model the total does not stand alone unexplained', async () => {
    stub([row('s1', -1500, {})])
    renderScreen(<Spend now={NOW} />)

    await waitFor(() => {
      expect(screen.getByTestId('lxc-debit-total').textContent ?? '').toMatch(/1[,.]?500/)
    })
    expect(screen.queryByTestId('lxc-by-model')).toBeNull()
    expect(screen.getByTestId('lxc-unsplit').textContent ?? '').toMatch(/1[,.]?500/)
  })

  // ⭐ (b) THE TOP-5 SLICE. Every row here names a model; the sixth is still in the total and
  // in none of the five rendered rows.
  it('Overview: the sixth model is in the total and in none of the five rows shown', async () => {
    stub([
      row('m1', -600, { served_model: 'model-a' }),
      row('m2', -500, { served_model: 'model-b' }),
      row('m3', -400, { served_model: 'model-c' }),
      row('m4', -300, { served_model: 'model-d' }),
      row('m5', -200, { served_model: 'model-e' }),
      row('m6', -100, { served_model: 'model-f' }),
    ])
    renderScreen(<Overview now={NOW} />)

    await waitFor(() => {
      expect(screen.getByTestId('lxc-debit-total').textContent ?? '').toMatch(/2[,.]?100/)
    })
    const shown = screen.getByTestId('lxc-by-model').textContent ?? ''
    expect(shown).toMatch(/model-a/)
    expect(shown).not.toMatch(/model-f/)

    expect(screen.getByTestId('lxc-unsplit').textContent ?? '').toMatch(/100/)
  })

  // ⚠ MUST STAY GREEN — the disclosure is not a decoration that renders whenever the card does.
  // Without this, a component that always renders would pass all three cases above.
  it('Spend: says nothing when every charge in the window is in the split', async () => {
    stub([
      row('s1', -900, { served_model: 'claude-haiku-4-5' }),
      row('s2', -600, { served_model: 'claude-sonnet-5' }),
    ])
    renderScreen(<Spend now={NOW} />)

    await waitFor(() => {
      expect(screen.getByTestId('lxc-debit-total').textContent ?? '').toMatch(/1[,.]?500/)
    })
    expect(screen.queryByTestId('lxc-unsplit')).toBeNull()
  })

  // ⚠ MUST STAY GREEN — a reservation hold is not a charge, so it is in NEITHER the total nor
  // the split, and it must not be reported as a shortfall. This is the #157 defect's shape
  // written into the new figure: a rule that counted holds would put -3,270 into "unsplit".
  it('Spend: a hold and its release are not a shortfall', async () => {
    stub([
      row('h1', -3270, { requested_model: 'claude-haiku-4-5' }, 'reservation_hold'),
      row('r1', 3270, { requested_model: 'claude-haiku-4-5' }, 'reservation_release'),
      row('s1', -920, { served_model: 'claude-haiku-4-5' }),
    ])
    renderScreen(<Spend now={NOW} />)

    await waitFor(() => {
      expect(screen.getByTestId('lxc-debit-total').textContent ?? '').toMatch(/920/)
    })
    expect(screen.queryByTestId('lxc-unsplit')).toBeNull()
  })
})
