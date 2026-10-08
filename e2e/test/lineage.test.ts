import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { lineage, split } from '../src/lineage.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B32.65 — lineage against the stub Lens (selftest/stub-bank.ts): it passes on a Lens whose remix's sale pays its parent
// and grandparent their royalties and whose refund reverses every row; it FAILs when the royalty stops at the parent and
// when a refund leaves the originals' royalties in place.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'lineage-key', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'lineage-key')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { app: { user }, env: { lens, judgeModel: 'claude-haiku-4-5', fees: { market_take_bps: 1500 } }, evidence } as unknown as ScenarioCtx
  return { verdict: await lineage(2).run(ctx), evidence }
}

describe('lineage (B32.65)', () => {
  it("splits the design's worked example: a $20.00 rent at a 15% take", () => {
    expect(split(20_000_000, 1500)).toEqual({ fee: 3_000_000, c: 15_300_000, b: 1_360_000, a: 340_000 })
  })

  it("passes on a Lens that pays a remix's originals from its sale and reverses every row on a refund", async () => {
    const { verdict } = await runAgainstStub('')
    expect(verdict.detail).toMatch(/paid, the 20000000 µUSD rent split fee 3000000, C 15300000, B 1360000, A 340000, each author's row on its earnings and its journal, reconciled; refunded, all four reversed, every journal back to 0$/)
    expect(verdict.pass).toBe(true)
  })

  it('FAILs when the royalty stops at the parent and the grandparent earns nothing', async () => {
    const { verdict } = await runAgainstStub('lineage-one-generation')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the paid rent of C: B's earnings should hold one row for it, a royalty of generation 1 naming B's listing lst_\w+, keeping 1360000 µUSD; they hold \[\{"use_id":"use_\w+",.*"share_usd_micros":1700000/)
  })

  it("FAILs when a refund leaves the originals' royalties in place", async () => {
    const { verdict } = await runAgainstStub('lineage-refund-kept')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the refunded rent of C: B's row still reads unrefunded/)
  })
}, 120_000)
