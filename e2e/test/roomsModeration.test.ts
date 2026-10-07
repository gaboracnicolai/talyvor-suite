import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { roomsModeration } from '../src/roomsModeration.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B32.91 — rooms-moderation against the stub Lens (selftest/stub-rooms.ts): it passes on a Lens that hides a room at
// its third report, refuses a banned member's post and refuses a closed room's run, and FAILs on each defect planted.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'moderation-key', STUB_MODERATOR_KEY: 'tlv_mod_moderation', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'moderation-key', undefined, undefined, undefined, 'tlv_mod_moderation')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { app: { user }, env: { lens, judgeModel: 'claude-haiku-4-5' }, evidence } as unknown as ScenarioCtx
  return { verdict: await roomsModeration().run(ctx), evidence }
}

describe('rooms-moderation (B32.91)', () => {
  it('passes on a Lens that hides, keeps, bans and closes as B32.52 says', async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict.detail).toContain('left GET /v1/rooms and read under_review after 3')
    expect(verdict.pass).toBe(true)
    expect(evidence.map((e) => e.note).join('\n')).toContain('report 3 of 3, of the room')
  })

  it('FAILs when the third report leaves the room listed', async () => {
    const { verdict } = await runAgainstStub('room-reports')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toContain('reported by 3 workspaces (LENS_ROOM_REPORTS_HIDE), public room')
  })

  it("FAILs when a banned member's post is accepted", async () => {
    const { verdict } = await runAgainstStub('room-ban')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^a banned member's post was answered 201/)
  })

  it("FAILs when a closed room's run adds a line to its wallet's statement", async () => {
    const { verdict } = await runAgainstStub('room-close')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^a run on closed room \S+ added 1 line\(s\) to its wallet's statement/)
  })
}, 60_000)
