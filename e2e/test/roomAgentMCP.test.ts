import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { roomAgentMCP } from '../src/roomAgentMCP.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B32.88 — room-agent-mcp against the stub Lens (selftest/stub-rooms.ts, stub-bank.ts): it passes on a Lens whose
// room_* tools bill an agent's run paying itself within its rules once on its owner's bill, refuse one above its limit
// per request and one paying room without may_spend writing nothing, and log every call; it FAILs when the refused run
// is billed anyway, and when refused calls go unlogged.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'agent-room-key', STUB_MODERATOR_KEY: 'tlv_mod_agent_room', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'agent-room-key', undefined, undefined, undefined, 'tlv_mod_agent_room')
  const [user] = await lens.createUsers(1)
  const evidence: Evidence[] = []
  const ctx = { app: { user }, env: { lens, judgeModel: 'gpt-4o-mini' }, evidence } as unknown as ScenarioCtx
  return { verdict: await roomAgentMCP(8).run(ctx), evidence }
}

describe('room-agent-mcp (B32.88)', () => {
  it('passes on a Lens that bills an agent within its rules once, refuses it above them and without may_spend, and logs every call', async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict.detail).toMatch(/its run of the \$0\.10 prompt paying itself is use use_\w+, the one row for its listing on its owner's bill, billed 1000000 µLXC by agt_\w+, named by the room's one run message; the \$0\.50 run was isError naming its limit per request and paying room isError naming may_spend, neither billed; Lens refused its call after 7 calls and 13 reads at its limit of 20 a minute/)
    expect(verdict.pass).toBe(true)
    expect(evidence.map((e) => `${e.note} ${e.answer ?? ''}`).join('\n')).toMatch(/calls room_run .*"pay":"self".*limit per request is 2 LXC.*"isError":true/)
  })

  it('FAILs when the run above the agent\'s limit per request is refused and billed anyway', async () => {
    const { verdict } = await runAgainstStub('room-agent-over-billed')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the refused runs were billed: the \$0\.50 prompt's listing lst_\w+ or the owner's bill \(paying room\) holds \[\{"use_id"/)
  })

  it('FAILs when the refused calls have no agent_tool_calls row', async () => {
    const { verdict } = await runAgainstStub('room-agent-unlogged')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^Lens refused Room scout 8 at its limit of 20 room calls a minute after 7 calls and 15 reads: 2 of its calls have no agent_tool_calls row/)
  })
}, 60_000)
