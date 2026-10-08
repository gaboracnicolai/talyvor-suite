import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'
import { platformReport } from '../src/platformReport.ts'
import { CannotTest, type Evidence, type ScenarioCtx, type Verdict } from '../src/scenarios.ts'

// B32.98 — platform-report against the stub Lens (selftest/stub-bank.ts): it passes on a Lens whose export carries the sha256
// it recorded, lists only UK and EU residents, reports the GB seller with what their holdback was credited and leaves the US
// seller out; it FAILs when a US resident is listed, when the GB seller is left out, when their consideration is the price
// before Talyvor's fee, and when the recorded sha256 is not the file's; without the admin key it cannot test, and says so.

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

async function runAgainstStub(broken: string, adminKey = 'report-admin-key'): Promise<{ verdict: Verdict; evidence: Evidence[] }> {
  const port = await freePort()
  stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'report-key', STUB_ADMIN_KEY: 'report-admin-key', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'report-key', undefined, undefined, undefined, '', adminKey)
  const evidence: Evidence[] = []
  const ctx = { env: { lens, catalog: [{ id: 'gpt-4o-mini' }], fees: { market_take_bps: 1500 } }, evidence } as unknown as ScenarioCtx
  return { verdict: await platformReport(9).run(ctx), evidence }
}

describe('platform-report (B32.98)', () => {
  it('passes on a Lens whose export is recorded with its sha256, lists its GB seller with their credited share and leaves its US seller out', async () => {
    const { verdict } = await runAgainstStub('')
    expect(verdict.detail).toMatch(/^the export of \d{4} \(1 records\) came with the sha256 of its bytes, recorded for run rpt_\w+ by nightly-e2e; every record is of a seller resident in the UK or the EU; the GB seller is reported with the 25500000 µUSD their holdback was credited and no tax withheld; the US seller, who sold too, is not in it$/)
    expect(verdict.pass).toBe(true)
  })

  it('FAILs when the export lists a seller resident outside the UK and the EU', async () => {
    const { verdict } = await runAgainstStub('report-lists-us')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the export lists seller \w+, resident in US: only sellers resident in the UK or an EU member state are reported$/)
  })

  it("FAILs when the export leaves out the scenario's GB seller", async () => {
    const { verdict } = await runAgainstStub('report-leaves-gb')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the GB seller \w+ was credited 25500000 µUSD this year, and the export of 0 records leaves them out$/)
  })

  it("FAILs when the GB seller's consideration is not what their journal was credited", async () => {
    const { verdict } = await runAgainstStub('report-consideration-gross')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the GB seller \w+'s holdback was credited 25500000 µUSD this year, as their earnings read back; the export reports 30000000 µUSD of consideration: digital_listing /)
  })

  it("FAILs when the run Lens recorded does not carry the file's sha256", async () => {
    const { verdict } = await runAgainstStub('report-sha-unrecorded')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the runs recorded for the year must list this export's run rpt_\w+ by nightly-e2e with sha256 [0-9a-f]{64}; it reads \{"id":"rpt_/)
  })

  it('cannot test without the global admin key, and says so rather than passing', async () => {
    await expect(runAgainstStub('', '')).rejects.toThrow(CannotTest)
  })
}, 60_000)
