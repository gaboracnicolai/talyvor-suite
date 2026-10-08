import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { roomRuns } from '../src/roomRuns.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B32.86 — room-runs against the stub Lens (selftest/stub-rooms.ts, stub-bank.ts): it passes on a Lens whose run on the
// room's budget is one billed use on the owner's bill by the room's wallet, refused past the wallet's monthly limit with
// nothing billed, billed to the member paying itself, and whose room's AI answers into the room; it FAILs when the run
// refused past the monthly limit is billed anyway.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'runs-key', STUB_MODERATOR_KEY: 'tlv_mod_runs', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'runs-key', undefined, undefined, undefined, 'tlv_mod_runs')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { app: { user }, env: { lens, judgeModel: 'gpt-4o-mini' }, evidence } as unknown as ScenarioCtx
  return { verdict: await roomRuns(9).run(ctx), evidence }
}

describe('room-runs (B32.86)', () => {
  it("passes on a Lens that bills a room's run to its owner by the wallet, refuses one past the monthly limit, bills a member paying itself and answers an ask", async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict.detail).toMatch(/billed 1000000 µLXC on the owner's bill by the wallet ag_room_\w+, named by the runner's run message; again past the 1500000 µLXC monthly limit it was 403 naming it and billed nothing; on its own account it was use use_\w+, billed 1000000 µLXC on its own bill; the room's AI answered/)
    expect(verdict.pass).toBe(true)
    expect(evidence.map((e) => e.note).join('\n')).toMatch(/the same run again, pay room: 403 \{"error":"[^"]*of its monthly limit of 1\.5 LXC/)
  })

  it('FAILs when the run refused past the monthly limit is billed anyway', async () => {
    const { verdict } = await runAgainstStub('room-run-limit')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the run refused past the monthly limit was billed anyway: the owner's bill holds 2 rows for listing lst_\w+/)
  })
}, 60_000)
