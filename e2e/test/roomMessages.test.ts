import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { roomMessages } from '../src/roomMessages.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B32.83 — room-messages against the stub Lens (selftest/stub-rooms.ts): it passes on a Lens that streams a post live,
// refuses a key in a public room, keeps an edit and a tombstone and holds a member to its minute's messages; it FAILs
// when a public room's message carrying a key is stored.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'messages-key', STUB_MODERATOR_KEY: 'tlv_mod_messages', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'messages-key', undefined, undefined, undefined, 'tlv_mod_messages')
  const [user] = await lens.createUsers(1, 'team')
  const evidence: Evidence[] = []
  const ctx = { app: { user }, env: { lens }, evidence } as unknown as ScenarioCtx
  return { verdict: await roomMessages(8).run(ctx), evidence }
}

describe('room-messages (B32.83)', () => {
  it('passes on a Lens that streams, scans, edits, deletes and limits a room’s messages', async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict.detail).toMatch(/message 21 in a minute was 429 naming LENS_ROOM_MESSAGES_PER_MINUTE \(20, Retry-After \d+s\) and Lens holds the 20 allowed$/)
    expect(verdict.pass).toBe(true)
    expect(evidence.map((e) => e.note).join('\n')).toMatch(/the member's stream: message\.posted msg_\w+ \+\d+ms/)
  })

  it('FAILs when a public room stores a message carrying a key', async () => {
    const { verdict } = await runAgainstStub('room-secret')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^a message carrying an AWS access key in a public room was answered 201 .*, not 422$/)
  })
}, 60_000)
