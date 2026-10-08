import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { agentCredential } from '../src/kya.ts'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B30.118 — kya-credential against the stub Lens (selftest/stub-kya.ts): it passes on a Lens whose credentials verify with
// only the published keys and are revoked as a rule change and a pause happen, and FAILs when a pause leaves the credential
// unrevoked, when a rule change does, and when the JWKS publishes a key the credentials are not signed with.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'kya-key', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'kya-key')
  const evidence: Evidence[] = []
  const ctx = { env: { lens }, evidence } as unknown as ScenarioCtx
  return { verdict: await agentCredential(9).run(ctx), evidence }
}

describe('kya-credential (B30.118)', () => {
  it('passes on a Lens whose credentials verify with the published keys and are revoked by a rule change and a pause', async () => {
    const { verdict } = await runAgainstStub('')
    expect(verdict.detail).toMatch(/^KYA check 9-\d+'s credential kya_\S+ — the owner's and wallet_credential's — verified with only the published JWKS at 5000000 µLXC a day, a copy raised by hand did not, and verify said valid; the rule change listed it "rules changed" and the next, kya_\S+, states 9000000; paused, kya_\S+ is listed "frozen", verify says "revoked: frozen", the route is 409 and wallet_credential hands it none$/)
    expect(verdict.pass).toBe(true)
  })

  it('FAILs when Lens stops revoking a frozen agent\'s credential', async () => {
    const { verdict } = await runAgainstStub('kya-frozen-kept')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^after KYA check 9-\d+ was paused, \/\.well-known\/talyvor-kya\/revoked\.json does not list its credential kya_\S+: freezing an agent must revoke its credential as it happens$/)
  })

  it('FAILs when a rule change leaves the credential unrevoked', async () => {
    const { verdict } = await runAgainstStub('kya-rules-kept')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/daily limit changed, \/\.well-known\/talyvor-kya\/revoked\.json does not list its credential kya_\S+: a rule change must revoke it as it happens$/)
  })

  it('FAILs when the published JWKS does not hold the key the credentials are signed with', async () => {
    const { verdict } = await runAgainstStub('kya-jwks-wrong')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/'s first credential: a platform holding only the published JWKS cannot verify it: its kid \S+ is not in the published JWKS, which lists \S+$/)
  })
}, 60_000)
