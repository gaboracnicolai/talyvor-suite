import { ApiError, readable } from '../../lib/api'

// operatorTaxApi.ts — B32.63: what the operator's Tax page reads and writes, through the BFF's
// /api/admin/tax/* and /api/admin/platform-reports (apps/bff/operator_tax.go). Amounts are µUSD, as Lens keeps them.

/** GET /api/admin/tax/status: whether Lens's Stripe key is live, and which tax partner works the tax out. */
export interface TaxStatus {
  stripe_live: boolean
  tax_partner: string
}

/** One tax_rates row. valid_to is absent while the rate has no end. */
export interface TaxRate {
  jurisdiction: string
  tax_code: string
  rate_bps: number
  valid_from: string
  valid_to?: string | null
  source: string
}

/** One of Talyvor's tax registrations. */
export interface TaxRegistration {
  jurisdiction: string
  scheme: string
  number: string
  effective_from: string
}

/** One jurisdiction, treatment and rate in a quarter's return. */
export interface TaxReturnLine {
  jurisdiction: string
  treatment: string
  rate_bps: number
  sales: number
  taxable_usd_micros: number
  tax_usd_micros: number
  refunds: number
  refunded_taxable_usd_micros: number
  refunded_tax_usd_micros: number
  net_taxable_usd_micros: number
  net_tax_usd_micros: number
}

/** A quarter's VAT return figures for GB, the EU or one member state. */
export interface TaxReturn {
  jurisdiction: string
  quarter: string
  funding: string
  lines: TaxReturnLine[] | null
  taxable_usd_micros: number
  tax_usd_micros: number
  journal_tax_usd_micros: number
}

/** One platform report run: never its contents, which hold the sellers' TINs. */
export interface PlatformReportRun {
  id: string
  year: number
  funding: string
  format: string
  generated_at: string
  operator: string
  rows: number
  sha256: string
}

/** A platform report the browser received: the file, the sha256 Lens recorded, and the sha256 of these bytes. */
export interface PlatformReportFile {
  name: string
  blob: Blob
  rows: number
  recorded: string
  received: string
}

export class TaxError extends ApiError {
  constructor(
    status: number,
    path: string,
    readonly sentence: string,
  ) {
    super(status, path)
  }
}

async function refusal(res: Response, path: string): Promise<TaxError> {
  let sentence = ''
  try {
    sentence = ((await res.json()) as { error?: string }).error ?? ''
  } catch {
    // a body that is not JSON carries no sentence
  }
  return new TaxError(res.status, path, sentence)
}

async function send(path: string, body?: object): Promise<Response> {
  const res = await fetch(
    path,
    body === undefined
      ? { headers: { Accept: 'application/json' } }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body),
        },
  )
  if (!res.ok) throw await refusal(res, path)
  return res
}

/** The lowercase hex sha256 of bytes, as Lens writes it. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** The file name in Content-Disposition, or a name of the report's year. */
function fileName(disposition: string | null, year: number, format: string): string {
  const m = /filename="([^"]+)"/.exec(disposition ?? '')
  return m ? m[1] : `platform-report-${year}.${format}`
}

const e = encodeURIComponent

export const taxApi = {
  status: async () =>
    readable<TaxStatus>('/api/admin/tax/status', await (await send('/api/admin/tax/status')).json(), {
      stripe_live: 'boolean',
      tax_partner: 'string',
    }),
  rates: async () =>
    readable<{ rates: TaxRate[] | null }>('/api/admin/tax/rates', await (await send('/api/admin/tax/rates')).json(), {
      rates: 'list',
    }).rates ?? [],
  importRates: async (csv: string) =>
    readable<{ rates: number; jurisdictions: number }>(
      '/api/admin/tax/rates/import',
      await (await send('/api/admin/tax/rates/import', { csv })).json(),
      { rates: 'number', jurisdictions: 'number' },
    ),
  registrations: async () =>
    readable<{ registrations: TaxRegistration[] | null }>(
      '/api/admin/tax/registrations',
      await (await send('/api/admin/tax/registrations')).json(),
      { registrations: 'list' },
    ).registrations ?? [],
  addRegistration: async (r: TaxRegistration) =>
    readable<TaxRegistration>('/api/admin/tax/registrations', await (await send('/api/admin/tax/registrations', r)).json(), {
      jurisdiction: 'string',
    }),
  taxReturn: async (jurisdiction: string, quarter: string, funding: string) => {
    const path = `/api/admin/tax/return?jurisdiction=${e(jurisdiction)}&quarter=${e(quarter)}&funding=${e(funding)}`
    return readable<TaxReturn>(path, await (await send(path)).json(), {
      lines: 'list',
      taxable_usd_micros: 'number',
      tax_usd_micros: 'number',
      journal_tax_usd_micros: 'number',
    })
  },
  reportRuns: async () =>
    readable<{ runs: PlatformReportRun[] | null }>('/api/admin/platform-reports', await (await send('/api/admin/platform-reports')).json(), {
      runs: 'list',
    }).runs ?? [],
  /** Runs the year's report and reads the file it answers, with both sha256s for the page to compare. */
  runReport: async (year: number, funding: string, format: string): Promise<PlatformReportFile> => {
    const res = await send('/api/admin/platform-reports', { year, funding, format })
    const bytes = await res.arrayBuffer()
    return {
      name: fileName(res.headers.get('Content-Disposition'), year, format),
      blob: new Blob([bytes], { type: res.headers.get('Content-Type') ?? 'application/octet-stream' }),
      rows: Number(res.headers.get('X-Platform-Report-Rows') ?? 0),
      recorded: (res.headers.get('X-Platform-Report-Sha256') ?? '').toLowerCase(),
      received: await sha256Hex(bytes),
    }
  },
}

/** The sentence the page shows for a refusal: the BFF's and Lens's own sentences where they gave one. */
export function taxFailure(err: unknown, fallback: string): string {
  if (err instanceof TaxError && err.status === 403) return 'Only Talyvor’s operators can see this screen.'
  if (err instanceof TaxError && err.sentence) return err.sentence
  return fallback
}

/** A rate in basis points as a percentage: 2000 is "20%", 550 is "5.5%". */
export function rateText(bps: number): string {
  return `${(bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`
}

/** The quarter a day falls in, such as 2026Q4. */
export function quarterOf(d: Date): string {
  return `${d.getUTCFullYear()}Q${Math.floor(d.getUTCMonth() / 3) + 1}`
}

/** The quarter before q. */
export function quarterBefore(q: string): string {
  const y = Number(q.slice(0, 4))
  const n = Number(q.slice(5))
  return n === 1 ? `${y - 1}Q4` : `${y}Q${n - 1}`
}
