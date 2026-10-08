import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { roomContributions } from '../src/roomContributions.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B32.84 — room-contributions against the stub Lens (selftest/stub-rooms.ts): it passes on a Lens whose contribution is a
// listing for the room's members alone at the room's default price, whose fork records a room_fork edge at the room's
// remix share and whose votes count each member's latest; it FAILs when the fork's edge is a remix at the original's share.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'contributions-key', STUB_MODERATOR_KEY: 'tlv_mod_contributions', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'contributions-key', undefined, undefined, undefined, 'tlv_mod_contributions')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { app: { user }, env: { lens, judgeModel: 'gpt-4o-mini' }, evidence } as unknown as ScenarioCtx
  return { verdict: await roomContributions(9).run(ctx), evidence }
}

describe('room-contributions (B32.84)', () => {
  it('passes on a Lens that keeps a contribution to its room, records its fork’s lineage and counts each member’s latest vote', async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict.detail).toMatch(/one room_fork lineage edge to it at 1200 bps; after \+1, -1 and the owner's \+1 it reads up 1, down 1, tally 0, accepted by the owner$/)
    expect(verdict.pass).toBe(true)
    expect(evidence.map((e) => e.note).join('\n')).toMatch(/a third company \(\w+\) reads listing lst_\w+: 404/)
  })

  it('FAILs when a fork’s lineage edge is a remix at the original’s own share', async () => {
    const { verdict } = await runAgainstStub('room-fork-lineage')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toBe("the fork's lineage edge to the original is remix at 0 bps, not room_fork at the room's 1200")
  })
}, 60_000)
