import { describe, expect, it } from 'vitest'
import type { AgentTransfer, LedgerRow } from '../src/lens.ts'
import { type CrossCompanyMoney, testMoneyVerdict } from '../src/testmoney.ts'

// What Lens reads back after a send of 0.4 LXC, a loan of 0.6 LXC the other way and its cash-out, all test money.
const at = '2026-10-07T20:00:00Z'
const transfer = (id: string, from: string, to: string, amount: number, extra: Partial<AgentTransfer> = {}): AgentTransfer =>
  ({ id, from_workspace_id: `ws-${from}`, from_agent_id: from, to_workspace_id: `ws-${to}`, to_agent_id: to, amount_ulxc: amount, class: 'AMBER', test_funded_ulxc: amount, created_at: at, ...extra })
const row = (id: string, amount: number, type: string, metadata: Record<string, unknown>): LedgerRow =>
  ({ id, amount_ulxc: amount, balance_after_ulxc: 0, type, description: type, metadata, created_at: at })
const send = transfer('xfer_send', 'a', 'b', 400_000)
const payout = transfer('xfer_loan', 'b', 'a', 600_000, { loan_id: 'loan_1' })
const money: CrossCompanyMoney = {
  agents: ['a', 'b'],
  transfers: [[send, payout], [payout, send]],
  sent: { id: 'xfer_send', amount: 400_000 },
  loan: { id: 'loan_1', principal: 600_000 },
  cashOut: { id: 'cash_1', agent_id: 'a', amount_ulxc: 600_000, destination: 'Test Bank 0', partner: 'test', status: 'paid', test_funded_ulxc: 600_000 },
  cashOutAmount: 600_000,
  fresh: [
    [row('r1', -400_000, 'agent_transfer', { transfer_id: 'xfer_send', class: 'AMBER' }), row('r2', 600_000, 'agent_transfer', { transfer_id: 'xfer_loan', class: 'AMBER' }),
      row('r3', -600_000, 'agent_cash_out', { cash_out_id: 'cash_1', partner: 'test', class: 'RED' })],
    [row('r4', 400_000, 'agent_transfer', { transfer_id: 'xfer_send', class: 'AMBER' }), row('r5', -600_000, 'agent_transfer', { transfer_id: 'xfer_loan', class: 'AMBER' })],
  ],
}

describe('money between two companies stays test money (B28.290)', () => {
  it('passes a send, a loan and its cash-out that are test money in their class on both ledgers', () => {
    expect(testMoneyVerdict(money)).toEqual({ pass: true, detail: expect.stringContaining('none of the 5 rows the two ledgers gained is real money') })
  })

  it('fails a transfer between the companies that is not all test money', () => {
    const real = { ...payout, test_funded_ulxc: 0 }
    const v = testMoneyVerdict({ ...money, transfers: [[send, real], [real, send]] })
    expect(v).toEqual({ pass: false, detail: expect.stringContaining("the loan's principal moved 600000 µLXC of which 0 is test money") })
  })

  it('fails a ledger row written meanwhile that is real money', () => {
    const live = row('r6', 1_000_000, 'purchase', { funding: 'live' })
    const v = testMoneyVerdict({ ...money, fresh: [money.fresh[0], [...money.fresh[1], live]] })
    expect(v).toEqual({ pass: false, detail: expect.stringContaining('1 ledger row(s) written meanwhile are real money (funding live)') })
  })
})
