import { describe, expect, it } from 'vitest'
import { ChargeBook } from '../src/app.ts'
import type { Fees, LedgerRow } from '../src/lens.ts'
import { type RunEnv, checkLedger } from '../src/scenarios.ts'

const fees: Fees = { market_take_bps: 1500, services_take_bps: 500, platform_fee_bps: { free: 550, team: 300, business: 100, enterprise: 100 } }

/** A 700 µLXC spend row and, unless `bps` is undefined, its platform_fee row of `bps` beside it. */
function charge(n: number, bps: number | undefined): LedgerRow[] {
  const after = 1_000_000 - 1000 * n
  const spend = { id: `s${n}`, type: 'spend', description: 'spend', amount_ulxc: -700, balance_after_ulxc: after, created_at: '' }
  if (bps === undefined) return [spend]
  const fee = Math.ceil((700 * bps) / 10_000)
  return [{ id: `f${n}`, type: 'platform_fee', description: `Platform fee ${bps / 100}%`, amount_ulxc: -fee, balance_after_ulxc: after - fee,
    metadata: { platform_fee_bps: bps, spend_ulxc: 700 }, created_at: '' }, spend]
}

function envOf(book: ChargeBook, rows: LedgerRow[], plan = 'team'): RunEnv {
  return { book, fees, lens: { ledger: async () => rows, workspacePlan: async () => ({ plan }) } } as unknown as RunEnv
}

describe('the ledger read-back after a network drop (B35.8)', () => {
  it('cannot judge a ledger with the one row a lost answer may have written, and still fails one row more', async () => {
    const user = { index: 355, workspaceID: 'ws_355', token: 't', expiresAt: '' }
    const book = new ChargeBook()
    book.add(user.workspaceID, 700)
    book.lost(user.workspaceID)
    const env = (rows: number) => envOf(book, Array.from({ length: rows }, (_, n) => charge(n, 300)).flat())
    await expect(checkLedger(env(2), user)).rejects.toThrow('2 spend rows for 1 charged answers and 1 lost to a network drop')
    expect((await checkLedger(env(1), user)).pass).toBe(true)
    expect(await checkLedger(env(3), user)).toMatchObject({ pass: false, detail: '3 spend rows for 1 charged answers' })
  })
})

describe('the ledger read-back (B35.7)', () => {
  it("finds each spend row's platform_fee row beside it at the rate Lens states for the workspace's plan", async () => {
    const user = { index: 3, workspaceID: 'ws_3', token: 't', expiresAt: '' }
    const book = new ChargeBook()
    book.add(user.workspaceID, 700)
    expect(await checkLedger(envOf(book, charge(0, 300)), user)).toMatchObject({ pass: true })
    expect(await checkLedger(envOf(book, charge(0, 100), 'business'), user)).toMatchObject({ pass: true })
    // Free's 5.5% on a Team workspace, and no fee row at all, are each a spend row with none beside it.
    for (const rows of [charge(0, 550), charge(0, undefined)]) {
      expect(await checkLedger(envOf(book, rows), user)).toMatchObject({
        pass: false, detail: '1 of 1 spend rows have no platform_fee row of 3% beside them, as Lens states the fee on team: 700 µLXC at  wants a 21 µLXC fee',
      })
    }
  })
})
