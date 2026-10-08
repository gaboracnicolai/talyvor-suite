import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { roomPrizes } from '../src/roomPrizes.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B32.87 — room-prizes against the stub Lens (selftest/stub-rooms.ts, stub-bank.ts): it passes on a Lens that refuses a
// prize above the room's budget, bills an awarded prize once on the owner's bill by the room's wallet with a perpetual
// commercial licence that clears to the author at the take, and closes an unawarded prize at its deadline billing
// nothing; it FAILs when the award of a prize closed at its deadline is refused and billed anyway.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'prizes-key', STUB_MODERATOR_KEY: 'tlv_mod_prizes', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'prizes-key', undefined, undefined, undefined, 'tlv_mod_prizes')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { app: { user }, env: { lens, judgeModel: 'gpt-4o-mini' }, evidence } as unknown as ScenarioCtx
  return { verdict: await roomPrizes(7, 1_500).run(ctx), evidence }
}

describe('room-prizes (B32.87)', () => {
  it('passes on a Lens that refuses a prize over the budget, bills an award once with a commercial licence that clears, and closes one at its deadline', async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict.detail).toMatch(/a \$70 prize was 403 over the \$60 budget and kept nowhere; the \$50 prize awarded to contribution \w+ is use use_\w+, the one row for its listing on the owner's bill, billed 500000000 µLXC by the wallet ag_room_\w+, with the owner's perpetual commercial prize licence lic_\w+; paid, it cleared 42500000 µUSD to the author and 7500000 to Talyvor; the \$5 prize closed at its deadline, its award 409 with no row; the room got four prize messages/)
    expect(verdict.pass).toBe(true)
    expect(evidence.map((e) => e.note).join('\n')).toMatch(/the owner awards the closed \$5 prize: refused 409: rooms: conflict: the prize closed at its deadline/)
  })

  it('FAILs when the award of a prize closed at its deadline is refused and billed anyway', async () => {
    const { verdict } = await runAgainstStub('room-prize-closed-billed')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^awarding the \$5 prize closed at its deadline was answered refused 409: .*, and the owner's bill now holds 2 rows for listing lst_\w+/)
  })
}, 60_000)
