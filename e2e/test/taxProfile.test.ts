import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'
import { buyerTaxProfile } from '../src/taxProfile.ts'

// B32.92 — buyer-tax-profile against the stub Lens (selftest/stub-tax.ts): it passes on a Lens that keeps each VAT number
// with its check, makes a business of a valid one alone and refuses the agent key, and FAILs when a never-issued number
// makes a business, when the read leaves the check out, and when the agent key may change the profile.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'tax-key', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'tax-key')
  const evidence: Evidence[] = []
  const ctx = { env: { lens }, evidence } as unknown as ScenarioCtx
  return { verdict: await buyerTaxProfile().run(ctx), evidence }
}

describe('buyer-tax-profile (B32.92)', () => {
  it('passes on a Lens that keeps each number with its check, makes a business of the valid one alone, and refuses the agent key', async () => {
    const { verdict, evidence } = await runAgainstStub('')
    expect(verdict.detail).toMatch(/^before saving, no profile and resolved unknown; DE123456789 checked valid at \S+: a DE business, decided_by declared, read back as saved; DE999999999 checked at \S+, invalid \("test mode: this number is on the list of numbers no authority issued"\): a DE consumer, read back as saved; "Germany" refused 400 and the agent key 403 reading and writing, the profile unchanged$/)
    expect(verdict.pass).toBe(true)
    expect(evidence.map((e) => `${e.note} ${e.answer ?? ''}`).join('\n')).toMatch(/the workspace's agent key declares DE123456789 403 .*only the workspace's owner or an admin/)
  })

  it('FAILs when a number never issued makes a business', async () => {
    const { verdict } = await runAgainstStub('tax-id-never-issued')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toBe('saving DE999999999: DE999999999 is marked valid; the Test tax partner finds it never issued')
  })

  it('FAILs when the read leaves out when the number was checked', async () => {
    const { verdict } = await runAgainstStub('tax-check-unread')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toBe('the read after saving DE123456789: DE123456789 carries no tax_id_checked_at (undefined): nothing says it was checked')
  })

  it('FAILs when the agent key may change the profile', async () => {
    const { verdict } = await runAgainstStub('tax-profile-agent')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the workspace's agent key must be refused 403 reading its tax profile \(its legal name and address\); Lens answered 200 /)
  })
}, 60_000)
