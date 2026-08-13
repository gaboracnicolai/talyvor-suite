import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Ledger } from './Ledger'
import { ledgerStatus } from './format'

// ── THE PILL VOCABULARY BELONGS TO ONE OF THE TWO LEDGERS ───────────────────────────────
//
// settled / held / slashed describe a MINT's lifecycle — a mined LENS token's state. The LXC
// ledger has no mints in it at all: every row is a movement of a purchased balance. One
// component renders BOTH ledgers (Ledger.tsx takes a `token` discriminator), and it handed
// `ledgerStatus` the row TYPE without the token, so the mint vocabulary was applied to LXC.
//
// lxc_ledger writes SIX types, all Lens constants:
//
//   lens internal/economy/dualtoken.go#LXCTypeConvertFromLENS,      convert_from_lens, spend,
//        #LXCTypeSpend, #LXCTypePurchase, #LXCTypeGrant             purchase, admin_grant
//   lens internal/economy/agent_subbudget.go                        reservation_hold,
//        #LXCTypeReservationHold, #LXCTypeReservationRelease        reservation_release
//
// The movement allow-list in format.ts named FOUR of the six (plus convert_to_lxc, a LENS-side
// type), and the `*_held` suffix rule misses `reservation_hold` BY ONE LETTER — so both
// reservation types fell through to the default and were labelled `settled`, documented in
// that same file as "a counted mint in circulation".
//
// MEASURED IN REAL CHROME on the real BFF binary serving the real bundle, one served
// request's actual footprint on the wire (the -3270 hold, its +3270 release and the -920 that
// was billed — the production amounts spendMath.ts records):
//
//     spend                 SPEND               plain label   ✓
//     reservation_release   SETTLED             a PILL        ✗
//     reservation_hold      SETTLED             a PILL        ✗
//     purchase              PURCHASE            plain label   ✓
//     convert_from_lens     CONVERT FROM LENS   plain label   ✓
//     admin_grant           ADMIN GRANT         plain label   ✓
//
// The only two rows on the screen wearing a lifecycle Pill were the two that have no
// lifecycle — and they are the most numerous rows in the ledger: a reserved request writes
// three, and two of the three are these.

/** Every type lxc_ledger can hold, pinned as a literal. A list derived from the source would
 *  go quietly empty the day the source moves; this one has to be edited to shrink. */
const LXC_TYPES = [
  'spend',
  'reservation_hold',
  'reservation_release',
  'purchase',
  'admin_grant',
  'convert_from_lens',
] as const

const RESERVATION_ROWS = [
  { id: 'x1', workspace_id: 'w', amount_ulxc: -920, balance_after_ulxc: 49999080, type: 'spend', description: 'reservation settle: delivered charge', metadata: {}, created_at: '2026-07-21T10:00:07Z' },
  { id: 'x2', workspace_id: 'w', amount_ulxc: 3270, balance_after_ulxc: 50000000, type: 'reservation_release', description: 'reservation settle: release hold', metadata: {}, created_at: '2026-07-21T10:00:06Z' },
  { id: 'x3', workspace_id: 'w', amount_ulxc: -3270, balance_after_ulxc: 49996730, type: 'reservation_hold', description: 'reservation hold (pre-serve)', metadata: {}, created_at: '2026-07-21T10:00:00Z' },
]

const MINT_ROWS = [
  { id: 'l1', workspace_id: 'w', amount_ulens: 1000, balance_after_ulens: 1000, type: 'pattern_mine_held', description: 'pattern shared (held)', metadata: {}, created_at: '2026-07-19T14:52:59Z' },
  { id: 'l2', workspace_id: 'w', amount_ulens: 1000, balance_after_ulens: 2000, type: 'pattern_mine', description: 'pattern shared', metadata: {}, created_at: '2026-07-19T14:35:21Z' },
]

function mockBothLedgers() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const rows = url.startsWith('/api/lxc/history')
      ? RESERVATION_ROWS
      : url.startsWith('/api/tokens/history')
        ? MINT_ROWS
        : null
    if (rows) return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } })
    return new Response('null', { status: 404 })
  })
}

function renderLedger() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <Ledger />
    </QueryClientProvider>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('the mapper is told WHICH ledger it is describing', () => {
  it('no LXC type ever wears a mint lifecycle status', () => {
    for (const t of LXC_TYPES) {
      expect(ledgerStatus(t, 'lxc'), `lxc type ${t}`).toBeNull()
    }
  })

  it('the pinned LXC type list still holds all six', () => {
    // A floor on the list itself: a shrunken list would make the sweep above pass by
    // covering less, which is the one way it can go quiet without failing.
    expect(LXC_TYPES).toHaveLength(6)
    expect([...LXC_TYPES]).toContain('reservation_hold')
    expect([...LXC_TYPES]).toContain('reservation_release')
  })

  it('MUST STAY GREEN — the mint ledger keeps every rule it had', () => {
    expect(ledgerStatus('pattern_mine', 'lens')).toBe('settled')
    expect(ledgerStatus('pool_royalty', 'lens')).toBe('settled')
    expect(ledgerStatus('compute_mine', 'lens')).toBe('settled')
    expect(ledgerStatus('pattern_mine_held', 'lens')).toBe('held')
    expect(ledgerStatus('pattern_mine_revoked', 'lens')).toBe('slashed')
    expect(ledgerStatus('a_brand_new_mint_kind', 'lens')).toBe('settled')
    for (const t of ['spend', 'purchase', 'admin_grant', 'convert_to_lxc', 'convert_from_lens']) {
      expect(ledgerStatus(t, 'lens'), `lens movement ${t}`).toBeNull()
    }
  })

  it('the two ledgers DISAGREE about the same string — which is the whole point', () => {
    // If this ever reads the same on both sides, the token argument is being ignored.
    expect(ledgerStatus('pattern_mine', 'lens')).toBe('settled')
    expect(ledgerStatus('pattern_mine', 'lxc')).toBeNull()
  })
})

describe('the Ledger screen — a reservation is a bound, not a lifecycle', () => {
  it('paints NO lifecycle pill on the LXC ledger', async () => {
    mockBothLedgers()
    renderLedger()
    // The screen opens on LXC (Ledger.tsx picks it deliberately).
    await screen.findByText('reservation hold (pre-serve)')
    expect(screen.queryByText('settled')).toBeNull()
    expect(screen.queryByText('held')).toBeNull()
    expect(screen.queryByText('slashed')).toBeNull()
  })

  it('shows each reservation row as its own name instead', async () => {
    mockBothLedgers()
    renderLedger()
    await screen.findByText('reservation hold (pre-serve)')
    // ⚠ Asserted in the DOM STRING, lower case. The cell carries Tailwind `uppercase`, and
    // text-transform never touches the text a query can see — the browser paints
    // "RESERVATION HOLD" over a DOM that says "reservation hold".
    expect(screen.getByText('reservation hold')).toBeInTheDocument()
    expect(screen.getByText('reservation release')).toBeInTheDocument()
  })

  it('MUST STAY GREEN — the mint ledger still wears its pills on the same screen', async () => {
    mockBothLedgers()
    renderLedger()
    await screen.findByText('reservation hold (pre-serve)')
    fireEvent.click(screen.getByRole('button', { name: /lens/i }))
    expect(await screen.findByText('held')).toBeInTheDocument()
    expect(screen.getByText('settled')).toBeInTheDocument()
  })
})
