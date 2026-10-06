import { describe, expect, it } from 'vitest'
import { ChargeBook } from '../src/app.ts'
import { type RunEnv, checkLedger } from '../src/scenarios.ts'

describe('the ledger read-back after a network drop (B35.8)', () => {
  it('cannot judge a ledger with the one row a lost answer may have written, and still fails one row more', async () => {
    const user = { index: 355, workspaceID: 'ws_355', token: 't', expiresAt: '' }
    const row = (n: number) => ({ id: `r${n}`, type: 'spend', amount_ulxc: -700, created_at: '' })
    const book = new ChargeBook()
    book.add(user.workspaceID, 700)
    book.lost(user.workspaceID)
    const env = (rows: number) => ({ book, lens: { ledger: async () => Array.from({ length: rows }, (_, n) => row(n)) } }) as unknown as RunEnv
    await expect(checkLedger(env(2), user)).rejects.toThrow('2 spend rows for 1 charged answers and 1 lost to a network drop')
    expect((await checkLedger(env(1), user)).pass).toBe(true)
    expect(await checkLedger(env(3), user)).toMatchObject({ pass: false, detail: '3 spend rows for 1 charged answers' })
  })
})
