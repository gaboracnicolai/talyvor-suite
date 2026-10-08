import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { sellerWeekStatement } from '../src/weekStatement.ts'

// B32.96 — seller-week-statement against the stub Lens (selftest/stub-bank.ts): it passes on a Lens whose statements sum to
// their net before and after the payout run pays the seller, the net the payout's wherever it is read, and refuse the
// seller's agent key; it FAILs when a paid week's lines leave its Stripe fees out, when the list gives a week's net as its
// payout's gross, and when the agent key reads the statements.

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number }
      s.close(() => resolve(port))
    })
  })
}

let stub: ChildProcess | undefined
afterEach(() => {
  stub?.kill()
  stub = undefined
})

async function runAgainstStub(broken: string): Promise<{ verdict: Verdict; evidence: Evidence[] }> {
  const port = await freePort()
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'statement-key', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'statement-key')
  const evidence: Evidence[] = []
  const ctx = { env: { lens, catalog: [{ id: 'gpt-4o-mini' }], fees: { market_take_bps: 1500 } }, evidence } as unknown as ScenarioCtx
  return { verdict: await sellerWeekStatement(8).run(ctx), evidence }
}

describe('seller-week-statement (B32.96)', () => {
  it("passes on a Lens whose statements sum to the payout's net and are the owner's alone", async () => {
    const { verdict } = await runAgainstStub('')
    expect(verdict.detail).toMatch(/^not yet paid, \d{4}-W\d{2} named no payout, its lines \(1 sale of 30000000, 25500000 carried forward\) summing to a net of 0, nothing listed; 2026-W54 was 400 and the agent key 403; paid mpo_\w+ \(25500000 µUSD gross, 23190000 net\), the payout page read paid this week and the list started with \d{4}-W\d{2}, whose lines summed to 23190000 — the payout's net, as listed — its Stripe fees -2310000; the agent key 403 on it too$/)
    expect(verdict.pass).toBe(true)
  })

  it("FAILs when a paid week's lines leave its Stripe fees out", async () => {
    const { verdict } = await runAgainstStub('statement-unsummed')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the lines of \d{4}-W\d{2} sum to 25500000, and its net is 23190000/)
  })

  it("FAILs when the list gives a week's net as its payout's gross", async () => {
    const { verdict } = await runAgainstStub('statement-list-gross')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the net of \d{4}-W\d{2} must be the payout's 23190000 µUSD everywhere it is read; .* the list of statements 25500000 and the payout page 23190000$/)
  })

  it("FAILs when the seller's agent key reads its statements", async () => {
    const { verdict } = await runAgainstStub('statement-agent')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the seller's agent key is neither its owner nor an admin, so it must be refused 403 reading \/v1\/workspaces\/[^/]+\/marketplace\/statements; Lens answered 200/)
  })
}, 60_000)
