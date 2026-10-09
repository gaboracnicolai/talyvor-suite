import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { CHARGED_IN_USD, consumerShows, convertedRange, marketBuyerCurrency, shownFault } from '../src/buyerCurrency.ts'
import { LensClient } from '../src/lens.ts'
import type { Evidence, ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B32.100 — market-buyer-currency against the stub Lens (selftest/stub-tax.ts, stub-bank.ts): it passes on a Lens that shows a
// $20.00 rent to a GB consumer in pounds with the VAT its bill charges and to a GB business in pounds "+ VAT", its US-dollar
// price unchanged; it FAILs when the offers carry no display, when the US-dollar price moves, when the consumer's VAT is left
// out and when the business is shown the VAT. Without a GB registration the consumer's rent reads without VAT, and may be
// in dollars by default, and that passes.

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
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'fx-key', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    stub?.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub?.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'fx-key')
  const evidence: Evidence[] = []
  const ctx = { env: { lens, judgeModel: 'claude-haiku-4-5', fees: { market_take_bps: 1500 } }, evidence } as unknown as ScenarioCtx
  return { verdict: await marketBuyerCurrency(4).run(ctx), evidence }
}

describe('market-buyer-currency (B32.100)', () => {
  it('passes on a Lens that shows the rent in pounds, VAT included for the GB consumer and "+ VAT" for the GB business', async () => {
    const { verdict } = await runAgainstStub('')
    expect(verdict.detail).toBe("the consumer's use was taxed standard at 2000 bps; the $20.00 rent read 1855 GBP incl. VAT for the GB consumer and 1545 GBP + VAT for the " +
      'GB business at 0.772727 GBP to the dollar (ECB, 2026-10-02T00:00:00Z), 2182 EUR incl. VAT with ?currency=EUR; by default 1855 GBP incl. VAT and 1545 GBP + VAT; ' +
      `the US-dollar prices unchanged, the note "${CHARGED_IN_USD}…", ?currency=pounds 400`)
    expect(verdict.pass).toBe(true)
  })

  it('FAILs when the offers carry no display', async () => {
    const { verdict } = await runAgainstStub('display-missing')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toMatch(/^the GB consumer reads the rent offer with no display: price_note "Charged in US dollars/)
  })

  it('FAILs when the US-dollar price moves', async () => {
    const { verdict } = await runAgainstStub('display-usd-moved')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toBe('the GB consumer reads the rent offer at 24000000 µUSD; it was published at 20000000 µUSD, and the US-dollar price never moves')
  })

  it("FAILs when the consumer's price is labelled incl. VAT and leaves the VAT out", async () => {
    const { verdict } = await runAgainstStub('display-vat-left-out')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toBe('the GB consumer reads the rent as 1545 GBP minor units; 24000000 µUSD at 0.772727 GBP to the dollar is 1855')
  })

  it('FAILs when the business is shown the price with VAT', async () => {
    const { verdict } = await runAgainstStub('display-business-taxed')
    expect(verdict).toMatchObject({ pass: false })
    expect(verdict.detail).toBe('the GB business reads the rent as 1855 GBP minor units; 20000000 µUSD at 0.772727 GBP to the dollar is 1545')
  })
}, 60_000)

describe('the GB consumer without a GB registration (B32.100)', () => {
  it('reads the rent without VAT and unlabelled, in dollars by default, and nothing else', () => {
    const shows = consumerShows({ treatment: 'not_registered', rate_bps: 0 })
    expect(shows).toEqual({ gross: 20_000_000, label: '' })
    const listing = (display: object) => ({ id: 'lst_1', price_note: `${CHARGED_IN_USD}.`, offers: [{ kind: 'rent', licence: 'commercial', price_usd_micros: 20_000_000,
      display: { currency: 'USD', amount_minor: 2000, includes_tax: false, rate: '1', source: 'none', ...display } }] })
    const published = new Map([['rent', 20_000_000]])
    expect(shownFault('the GB consumer', listing({}), published, ['GBP', 'USD'], shows.gross, shows.label)).toBeUndefined()
    expect(shownFault('the GB consumer', listing({ includes_tax: true, tax_label: 'incl. VAT' }), published, ['GBP', 'USD'], shows.gross, shows.label))
      .toBe('the GB consumer reads the rent labelled "incl. VAT", includes_tax true; it should be unlabelled, without tax')
  })

  it('checks a figure against every value the six-place rate allows', () => {
    expect(convertedRange(24_000_000, '0.772727')).toEqual([1855, 1855])
    expect(convertedRange(20_000_000, '1')).toEqual([2000, 2000])
    // $10.00 at 0.125000 to one decimal is exactly 12.5: the unrounded rate may sit either side of it, so either figure is Lens's.
    expect(convertedRange(10_000_000, '0.125000', 1)).toEqual([12, 13])
  })
})
