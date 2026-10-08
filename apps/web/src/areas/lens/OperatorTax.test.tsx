import { createHash } from 'node:crypto'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { RATES_HEADER } from './OperatorTax'

// B32.63 — the DONE line: an operator opens Operator → Tax, uploads a rates CSV and sees its rows, adds a
// registration, and downloads a platform report whose sha256 matches the one the mock BFF recorded. The mock
// answers the way apps/bff/operator_tax.go relays Lens.

const RATES_CSV =
  `${RATES_HEADER}\n` +
  'GB,GBP,ecb,true,,digital_service,2000,2026-01-01,,HMRC VAT notice 700\n' +
  'DE,EUR,ecb,true,EU,digital_service,1900,2026-01-01,,BZSt\n' +
  'FR,EUR,ecb,true,EU,digital_service,2000,2025-01-01,2025-12-31,DGFiP\n'

const REPORT = 'seller_id,country,quarter,consideration_usd_micros,fees_usd_micros\r\nsel_1,GB,2026Q4,90000000,13500000\r\n'
const REPORT_SHA = createHash('sha256').update(REPORT).digest('hex')

interface Rate {
  jurisdiction: string
  tax_code: string
  rate_bps: number
  valid_from: string
  valid_to?: string
  source: string
}

function mockBff(opts: { stripeLive?: boolean; reportSha?: string } = {}) {
  let rates: Rate[] = []
  let registrations: Array<Record<string, string>> = []
  const runs: Array<Record<string, unknown>> = []
  const saved: Array<{ name: string; text: Promise<string> }> = []
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-08T12:00:00Z'))
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  URL.createObjectURL = vi.fn((b: Blob) => {
    const text =
      typeof b.text === 'function'
        ? b.text()
        : new Promise<string>((resolve) => {
            const fr = new FileReader()
            fr.onload = () => resolve(String(fr.result))
            fr.readAsText(b)
          })
    saved.push({ name: '', text })
    return 'blob:report'
  }) as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved[saved.length - 1].name = this.download
  })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    const post = init?.method === 'POST'
    const body = post ? (JSON.parse(String(init?.body)) as Record<string, unknown>) : {}
    if (url === '/auth/me') return json({ mode: 'oidc', authenticated: true, user: { sub: 's1', email: 'ng@example.com' }, operator: true })
    if (url === '/api/admin/tax/status') return json({ stripe_live: opts.stripeLive ?? false, tax_partner: 'test' })
    if (url === '/api/admin/tax/rates') return json({ rates })
    if (url === '/api/admin/tax/rates/import' && post) {
      const [head, ...lines] = String(body.csv).trim().split('\n')
      const cols = head.split(',')
      rates = lines.map((l) => {
        const v = Object.fromEntries(l.split(',').map((x, i) => [cols[i], x]))
        return {
          jurisdiction: v.jurisdiction, tax_code: v.tax_code, rate_bps: Number(v.rate_bps), source: v.source,
          valid_from: `${v.valid_from}T00:00:00Z`, ...(v.valid_to ? { valid_to: `${v.valid_to}T00:00:00Z` } : {}),
        }
      })
      return json({ rates: rates.length, jurisdictions: new Set(rates.map((r) => r.jurisdiction)).size })
    }
    if (url === '/api/admin/tax/registrations' && post) {
      const r = { ...body, effective_from: `${String(body.effective_from)}T00:00:00Z` } as Record<string, string>
      registrations = [...registrations, r]
      return json(r, 201)
    }
    if (url === '/api/admin/tax/registrations') return json({ registrations })
    if (url === '/api/admin/tax/return?jurisdiction=GB&quarter=2026Q4&funding=live')
      return json({
        jurisdiction: 'GB', quarter: '2026Q4', funding: 'live', currency: 'USD',
        lines: [{ jurisdiction: 'GB', treatment: 'standard', rate_bps: 2000, sales: 9, taxable_usd_micros: 90_000_000,
          tax_usd_micros: 18_000_000, refunds: 0, refunded_taxable_usd_micros: 0, refunded_tax_usd_micros: 0,
          net_taxable_usd_micros: 90_000_000, net_tax_usd_micros: 18_000_000 }],
        taxable_usd_micros: 90_000_000, tax_usd_micros: 18_000_000, journal_tax_usd_micros: 18_000_000,
      })
    if (url === '/api/admin/platform-reports' && post) {
      runs.unshift({ id: 'pr_1', year: body.year, funding: body.funding, format: body.format, generated_at: '2026-10-08T12:00:00Z',
        operator: 'ng@example.com sub=s1', rows: 1, sha256: REPORT_SHA })
      return new Response(REPORT, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="platform-report-2026.csv"',
          'X-Platform-Report-Sha256': opts.reportSha ?? REPORT_SHA,
          'X-Platform-Report-Rows': '1',
        },
      })
    }
    if (url === '/api/admin/platform-reports') return json({ runs })
    return new Response('null', { status: 404 })
  })
  return { saved, posted: () => vi.mocked(globalThis.fetch).mock.calls.filter(([, i]) => i?.method === 'POST') }
}

async function at(path: string) {
  window.history.pushState({}, '', path)
  render(<App />)
  return screen.findByRole('navigation', { name: /sections/i })
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('the operator’s Tax page (B32.63)', () => {
  it('uploads a rates CSV and sees each rate with its validity', async () => {
    const bff = mockBff()
    const nav = await at('/operator/tax')
    expect(within(nav).getByRole('link', { name: 'Tax' })).toHaveAttribute('href', '/operator/tax')
    expect(await screen.findByText(/No tax rate is loaded/)).toBeTruthy()
    const form = screen.getByRole('form', { name: 'Load tax rates' })
    fireEvent.change(within(form).getByLabelText('Rates file'), {
      target: { files: [new File([RATES_CSV], 'rates.csv', { type: 'text/csv' })] },
    })
    fireEvent.click(within(form).getByRole('button', { name: 'Load rates' }))
    expect((await screen.findByTestId('rates-loaded')).textContent).toBe('Loaded 3 rates in 3 jurisdictions.')
    expect(bff.posted()[0][0]).toBe('/api/admin/tax/rates/import')
    expect(JSON.parse(String(bff.posted()[0][1]?.body))).toEqual({ csv: RATES_CSV })
    const rows = await screen.findAllByTestId('tax-rate')
    expect(rows.map((r) => Array.from(r.querySelectorAll('td'), (c) => c.textContent))).toEqual([
      ['GB', 'digital_service', '20%', '2026-01-01', 'Open', 'In force', 'HMRC VAT notice 700'],
      ['DE', 'digital_service', '19%', '2026-01-01', 'Open', 'In force', 'BZSt'],
      ['FR', 'digital_service', '20%', '2025-01-01', '2025-12-31', 'Ended', 'DGFiP'],
    ])
  })

  it('adds a registration and lists it', async () => {
    const bff = mockBff()
    await at('/operator/tax')
    expect(await screen.findByText('Talyvor holds no tax registration yet.')).toBeTruthy()
    const form = screen.getByRole('form', { name: 'Add a registration' })
    fireEvent.change(within(form).getByLabelText('Jurisdiction'), { target: { value: 'gb' } })
    fireEvent.change(within(form).getByLabelText('Scheme'), { target: { value: 'GB VAT' } })
    fireEvent.change(within(form).getByLabelText('Number'), { target: { value: 'GB123456789' } })
    fireEvent.change(within(form).getByLabelText('From'), { target: { value: '2026-01-01' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add registration' }))
    const row = await screen.findByTestId('tax-registration')
    expect(Array.from(row.querySelectorAll('td'), (c) => c.textContent)).toEqual(['GB', 'GB VAT', 'GB123456789', '2026-01-01'])
    expect(JSON.parse(String(bff.posted()[0][1]?.body))).toEqual({
      jurisdiction: 'GB', scheme: 'GB VAT', number: 'GB123456789', effective_from: '2026-01-01',
    })
  })

  it('downloads a platform report whose sha256 matches the one recorded', async () => {
    const bff = mockBff()
    await at('/operator/tax')
    const form = await screen.findByRole('form', { name: 'Run the platform report' })
    fireEvent.change(within(form).getByLabelText('Sales'), { target: { value: 'test' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Run and download' }))
    expect((await screen.findByTestId('report-check')).textContent).toBe('Saved. Its sha256 matches the one Lens recorded.')
    expect(screen.getByTestId('report-file').textContent).toContain(`sha256 ${REPORT_SHA}`)
    expect(JSON.parse(String(bff.posted()[0][1]?.body))).toEqual({ year: 2026, funding: 'test', format: 'csv' })
    expect(bff.saved).toHaveLength(1)
    expect(bff.saved[0].name).toBe('platform-report-2026.csv')
    expect(await bff.saved[0].text).toBe(REPORT)
    const run = await screen.findByTestId('report-run')
    expect(run.textContent).toContain(REPORT_SHA)
    expect(run.textContent).toContain('2026 · test · CSV')
  })

  it('never saves a report whose bytes do not match the recorded sha256', async () => {
    const bff = mockBff({ reportSha: 'f'.repeat(64) })
    await at('/operator/tax')
    fireEvent.click(await screen.findByRole('button', { name: 'Run and download' }))
    expect((await screen.findByTestId('report-check')).textContent).toMatch(/^Not saved: the file received does not match/)
    expect(bff.saved).toHaveLength(0)
  })

  it('shows the standing notice while Stripe is live on the Test tax partner, and the quarter’s tax checked against the journal', async () => {
    mockBff({ stripeLive: true })
    await at('/operator/tax')
    expect((await screen.findByTestId('tax-live-notice')).textContent).toMatch(/^Stripe is live and tax is worked out by the Test tax partner alone\./)
    const line = await screen.findByTestId('tax-return-line')
    expect(Array.from(line.querySelectorAll('td'), (c) => c.textContent)).toEqual(['GB', 'Standard', '20%', '9', '0', '$90.00', '$18.00'])
    expect(screen.getByTestId('tax-return-totals').textContent).toBe('$90.00 taxable · $18.00 tax')
    expect(screen.getByTestId('tax-return-journal').textContent).toBe('The journal’s tax accounts agree to the micro-dollar.')
  })

  it('has no notice while Stripe is in test mode', async () => {
    mockBff({ stripeLive: false })
    await at('/operator/tax')
    await waitFor(() => expect(screen.getAllByTestId('tax-return-line')).toHaveLength(1))
    expect(screen.queryByTestId('tax-live-notice')).toBeNull()
  })
})
