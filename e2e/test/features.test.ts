import { describe, expect, it } from 'vitest'
import { featuresVerdict } from '../src/features.ts'
import type { AgentBook } from '../src/lens.ts'

const agent = (id: string, balance: number) => ({ id, name: id, balance_ulxc: balance, spent_ulxc: 0 })
const book: AgentBook = {
  workspace_balance_ulxc: 50_000_000,
  allocated_ulxc: 12_500_000,
  unallocated_ulxc: 37_500_000,
  spent_ulxc: 0,
  agents: [agent('a', 10_000_000), agent('b', 2_500_000)],
}
const seen = {
  rows: ['Agent Wallets', 'Spending limit', 'Chat', 'Marketplace', 'Answer cache'],
  wallets: '2 agents hold 12.5 LXC of this workspace’s 50 LXC and have spent 0 LXC (measured).',
  market: '1,204 listings are open to use (measured). Every use is a line on this month’s marketplace bill.',
}

describe("Features' wallet-first oracle (B28.441)", () => {
  it("passes Features as the app renders it from Lens's book and catalogue", () => {
    expect(featuresVerdict(seen, [book, book], [1_203, 1_204]).pass).toBe(true)
  })

  it('fails when Agent Wallets is not the first row', () => {
    const v = featuresVerdict({ ...seen, rows: ['Spending limit', 'Agent Wallets', 'Chat', 'Marketplace'] }, [book, book], [1_204, 1_204])
    expect(v).toEqual({ pass: false, detail: expect.stringContaining('opens on Spending limit, not Agent Wallets') })
  })

  it("fails a wallet line or a listing count that is not Lens's, and a missing Marketplace row", () => {
    expect(featuresVerdict({ ...seen, wallets: '2 agents hold 10 LXC of this workspace’s 50 LXC' }, [book, book], [1_204, 1_204]).pass).toBe(false)
    expect(featuresVerdict(seen, [book, book], [1_190, 1_200]).pass).toBe(false)
    expect(featuresVerdict({ ...seen, rows: ['Agent Wallets', 'Chat'] }, [book, book], [1_204, 1_204]).pass).toBe(false)
  })
})
