import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { roomWallet } from '../src/roomWallet.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B32.85 — room-wallet against the stub Lens (selftest/stub-rooms.ts, stub-bank.ts): it passes on a Lens whose room
// wallet is one agent of kind room with one key, funded in two postings, whose budget past the plan is refused and saved
// nowhere, and whose member may spend only once given may_spend; it FAILs when the refused budget is saved anyway.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'wallet-key', STUB_MODERATOR_KEY: 'tlv_mod_wallet', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'wallet-key', undefined, undefined, undefined, 'tlv_mod_wallet')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { app: { user }, env: { lens }, evidence } as unknown as ScenarioCtx
  return { verdict: await roomWallet(0).run(ctx), evidence }
}

describe('room-wallet (B32.85)', () => {
  it('passes on a Lens whose room wallet is funded in two postings, refuses a budget past the plan and lets a member spend once given may_spend', async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict.detail).toMatch(/funded in one entry, workspace −5000000 and wallet \+5000000 µLXC; .* saved no rules, 100000000 µLXC was saved as one version; the member read may_spend false naming may_spend, then true once given it$/)
    expect(verdict.pass).toBe(true)
    expect(evidence.map((e) => e.note).join('\n')).toMatch(/a monthly limit of 1000000001 µLXC: 402 \{"error":"[^"]*rooms_plan_limits/)
  })

  it('FAILs when a budget past the plan is refused and saved anyway', async () => {
    const { verdict } = await runAgainstStub('room-budget-saved')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toBe('the refused budget saved rules: the wallet\'s rules history holds 1 versions and its monthly limit reads 1000000001 µLXC, not none and 0')
  })
}, 60_000)
