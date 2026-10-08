import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { roomInviteLimits } from '../src/roomInvites.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B32.82 — room-invite-limits against the stub Lens (selftest/stub-rooms.ts): it passes on a Lens that refuses Free's
// fourth public room and a private one, and counts a join through an invite link; it FAILs when the link's use is not counted.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'invites-key', STUB_MODERATOR_KEY: 'tlv_mod_invites', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'invites-key', undefined, undefined, undefined, 'tlv_mod_invites')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { app: { user }, env: { lens }, evidence } as unknown as ScenarioCtx
  return { verdict: await roomInviteLimits(4).run(ctx), evidence }
}

describe('room-invite-limits (B32.82)', () => {
  it("passes on a Lens that holds Free to its room limits and counts a link's use", async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict.detail).toContain('Free opened 3 public rooms and was refused one more (402 public_rooms 3) and a private one (402 private_rooms 0)')
    expect(verdict.pass).toBe(true)
    expect(evidence.map((e) => e.note).join('\n')).toMatch(/with the revoked link: preview 404, join 404/)
  })

  it('FAILs when a join through the link does not use it', async () => {
    const { verdict } = await runAgainstStub('room-invite-uses')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^after one join through the link Lens holds the invite as .*"uses":0/)
  })
}, 60_000)
