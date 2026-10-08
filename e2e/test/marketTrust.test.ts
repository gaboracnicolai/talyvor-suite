import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { marketTrust } from '../src/marketTrust.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B32.89 — market-trust against the stub Lens (selftest/stub-trust.ts, stub-bank.ts): it passes on a Lens whose trust
// panel counts only the reviews of buyers who paid for a use and share no card with the seller, and FAILs when a refused
// review is written anyway, when a linked buyer may review, and when MCP's trust differs from the read.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'trust-key', STUB_MODERATOR_KEY: 'tlv_mod_trust', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'trust-key', undefined, undefined, undefined, 'tlv_mod_trust')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { app: { user }, env: { lens, judgeModel: 'claude-haiku-4-5' }, evidence } as unknown as ScenarioCtx
  return { verdict: await marketTrust(4).run(ctx), evidence }
}

describe('market-trust (B32.89)', () => {
  it('passes on a Lens that counts only paying buyers not linked to the seller, and answers MCP the same', async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict.detail).toMatch(/^2 paying buyers' billed uses on their bills, reviews mrv_\w+ 5 and mrv_\w+ 3 counted: count 2, average 4, stars \[0,0,1,0,1\], the seller's reply on the 3; a workspace that never paid was refused 403 and, once it paid \(use_\w+\), still nothing of its counted; a buyer sharing a card with the seller paid for a use and was refused 403; MCP market_listing's trust equals the read$/)
    expect(verdict.pass).toBe(true)
    expect(evidence.map((e) => `${e.note} ${e.answer ?? ''}`).join('\n')).toMatch(/the buyer linked to the seller reviews it 5 refused 403: market: only a buyer who paid/)
  })

  it('SKIPs after everything else has passed on a Lens with no synthetic card link', async () => {
    await expect(runAgainstStub('card-link-missing')).rejects.toThrow(/^the rest passed \(2 paying buyers' billed uses .*\), but a buyer sharing a card with the seller cannot be made: this Lens has no synthetic card link .*B32\.102\): 404$/)
  })

  it('FAILs when a refused review is written anyway', async () => {
    const { verdict } = await runAgainstStub('review-refused-kept')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^only the two paying buyers' reviews count, but the trust read holds more — a refused review was written .*: count 3, average 4\.33/)
  })

  it('FAILs when a buyer sharing a card with the seller may review', async () => {
    const { verdict } = await runAgainstStub('review-linked')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^a buyer who paid for a use but shares a card with the seller must be refused 403 reviewing the listing; Lens answered 200/)
  })

  it("FAILs when MCP market_listing's trust leaves the seller's reply out", async () => {
    const { verdict } = await runAgainstStub('trust-mcp-unreplied')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^MCP market_listing's trust differs from the trust read/)
  })
}, 60_000)
