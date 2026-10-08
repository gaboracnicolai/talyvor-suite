import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Input, focusRing } from '@talyvor/ui'
import { Region, RegionScreen } from '../../components/Region'
import { selectClass } from '../marketplace/parts'
import { formatUSD, formatWhen } from './format'
import {
  type PlatformReportFile,
  type TaxRate,
  type TaxRegistration,
  quarterBefore,
  quarterOf,
  rateText,
  taxApi,
  taxFailure,
} from './operatorTaxApi'

// OperatorTax.tsx — B32.63: the operator's Tax page, beside Workspaces under Operator. Load the tax rates from a
// CSV and see each one's validity; record Talyvor's registrations; see a quarter's tax by jurisdiction and
// treatment, checked against the journal; and run the year's platform report, downloading the file once its
// bytes match the sha256 Lens recorded. While Lens's Stripe key is live and only the Test tax partner exists, a
// standing notice says so. The BFF relays every call to Lens on the operator keys (apps/bff/operator_tax.go).

const STATUS_KEY = ['operator-tax-status']
const RATES_KEY = ['operator-tax-rates']
const REGISTRATIONS_KEY = ['operator-tax-registrations']
const RUNS_KEY = ['operator-platform-reports']

/** The header a rates file starts with (Lens's partners.TaxRatesCSVHeader), shown so the operator can build one. */
export const RATES_HEADER =
  'jurisdiction,currency,rate_source,registration_from_first_sale,union,tax_code,rate_bps,valid_from,valid_to,source'

const TREATMENTS: Record<string, string> = {
  standard: 'Standard',
  reverse_charge: 'Reverse charge',
  zero: 'Zero-rated',
  outside_scope: 'Outside scope',
  not_registered: 'Not registered',
  no_rate: 'No rate loaded',
}

function day(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : ''
}

/** Whether a rate applies today, has ended, or starts later. */
function validity(r: TaxRate, today: string): string {
  if (day(r.valid_from) > today) return `Starts ${day(r.valid_from)}`
  if (r.valid_to && day(r.valid_to) <= today) return 'Ended'
  return 'In force'
}

const labelClass = 'font-figure text-eyebrow uppercase text-muted'
const tableWrap = 'mt-4 overflow-x-auto rounded-card border border-rule bg-raised'
const headRow = 'whitespace-nowrap border-b border-rule text-left font-figure text-eyebrow uppercase text-label'
const th = 'px-gutter py-2 font-semibold'
const td = 'px-gutter py-2 text-body'

export function OperatorTax() {
  const status = useQuery({ queryKey: STATUS_KEY, queryFn: taxApi.status })
  const notice = status.data?.stripe_live && status.data.tax_partner === 'test'
  return (
    <RegionScreen>
      <Region index="00" label="Operator" heading="Tax" sectionClassName="pb-10 pt-4 wide:pb-12">
        <p className="max-w-2xl text-body text-muted">
          The tax rates and registrations every marketplace sale is taxed from, each quarter’s tax by jurisdiction
          and treatment for the VAT and OSS returns, and the year’s platform report.
        </p>
        {status.isError ? <p className="mt-4 text-body text-muted">{taxFailure(status.error, 'The tax setup could not be read just now.')}</p> : null}
        {notice ? (
          <div
            role="note"
            data-testid="tax-live-notice"
            className="mt-4 max-w-2xl rounded-card border border-rule border-l-2 border-l-held bg-raised px-4 py-3 text-body text-ink"
          >
            Stripe is live and tax is worked out by the Test tax partner alone. Every live sale is taxed from the
            rates and registrations on this page and nothing else checks them, so keep them complete until a real
            tax partner is connected.
          </div>
        ) : null}
      </Region>
      {status.isError ? null : (
        <>
          <Rates />
          <Registrations />
          <Returns />
          <PlatformReport />
        </>
      )}
    </RegionScreen>
  )
}

/** A chosen file's text. */
function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('That file could not be read.'))
    reader.readAsText(file)
  })
}

function Rates() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: RATES_KEY, queryFn: taxApi.rates })
  const file = useRef<HTMLInputElement>(null)
  const [chosen, setChosen] = useState<File | null>(null)
  const load = useMutation({
    mutationFn: async (f: File) => taxApi.importRates(await readText(f)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: RATES_KEY })
      setChosen(null)
      if (file.current) file.current.value = ''
    },
  })
  const today = new Date().toISOString().slice(0, 10)
  const rows = q.data ?? []
  return (
    <Region index="01" label="Rates" heading="Tax rates" fullWidth sectionClassName="pb-10 pt-4 wide:pb-12">
      <p className="max-w-2xl text-body text-muted">
        Load a CSV of rates. A rate already loaded for the same jurisdiction, tax code and start is replaced; a file
        with one bad line is refused whole. The file starts with this header:
      </p>
      <p className="mt-2 max-w-2xl break-all font-mono text-caption text-ink">{RATES_HEADER}</p>
      <form
        aria-label="Load tax rates"
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (chosen) load.mutate(chosen)
        }}
      >
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Rates file</span>
          <input
            ref={file}
            type="file"
            accept=".csv,text/csv"
            className={`rounded-control text-body text-ink transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing} file:mr-3 file:h-8 file:rounded-control file:border file:border-rule file:bg-surface file:px-3 file:text-body file:text-ink`}
            onChange={(e) => setChosen(e.target.files?.[0] ?? null)}
          />
        </label>
        <Button type="submit" variant="primary" disabled={!chosen || load.isPending}>
          {load.isPending ? 'Loading…' : 'Load rates'}
        </Button>
      </form>
      {load.isSuccess ? (
        <p role="status" data-testid="rates-loaded" className="mt-3 text-body text-ink">
          Loaded {load.data.rates.toLocaleString('en-US')} {load.data.rates === 1 ? 'rate' : 'rates'} in{' '}
          {load.data.jurisdictions.toLocaleString('en-US')} {load.data.jurisdictions === 1 ? 'jurisdiction' : 'jurisdictions'}.
        </p>
      ) : null}
      {load.isError ? <p role="alert" className="mt-3 text-body text-ink">{taxFailure(load.error, 'The rates could not be loaded just now.')}</p> : null}
      {q.isError ? (
        <p className="mt-4 text-body text-muted">{taxFailure(q.error, 'The tax rates could not be read just now.')}</p>
      ) : q.isPending ? (
        <p className="mt-4 text-body text-muted">Reading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-body text-muted">No tax rate is loaded. Choose a rates file above to load them; until then every sale is taxed as “no rate”.</p>
      ) : (
        <div className={tableWrap}>
          <table className="w-full border-collapse">
            <thead>
              <tr className={headRow}>
                <th className={th}>Jurisdiction</th>
                <th className={th}>Tax code</th>
                <th className={`${th} text-right`}>Rate</th>
                <th className={th}>From</th>
                <th className={th}>To</th>
                <th className={th}>Validity</th>
                <th className={th}>Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.jurisdiction}-${r.tax_code}-${r.valid_from}`}
                  data-testid="tax-rate"
                  className="border-b border-rule last:border-b-0"
                >
                  <td className={`${td} font-figure text-ink`}>{r.jurisdiction}</td>
                  <td className={`${td} font-mono text-muted`}>{r.tax_code}</td>
                  <td className={`${td} text-right font-figure text-ink`}>{rateText(r.rate_bps)}</td>
                  <td className={`${td} whitespace-nowrap font-figure text-muted`}>{day(r.valid_from)}</td>
                  <td className={`${td} whitespace-nowrap font-figure text-muted`}>{r.valid_to ? day(r.valid_to) : 'Open'}</td>
                  <td className={`${td} whitespace-nowrap text-ink`}>{validity(r, today)}</td>
                  <td className={`${td} text-muted`}>{r.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Region>
  )
}

const NO_REGISTRATION: TaxRegistration = { jurisdiction: '', scheme: '', number: '', effective_from: '' }

function Registrations() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: REGISTRATIONS_KEY, queryFn: taxApi.registrations })
  const [f, setF] = useState<TaxRegistration>(NO_REGISTRATION)
  const set = (k: keyof TaxRegistration) => (v: string) => setF((was) => ({ ...was, [k]: v }))
  const add = useMutation({
    mutationFn: taxApi.addRegistration,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: REGISTRATIONS_KEY })
      setF(NO_REGISTRATION)
    },
  })
  const complete = Object.values(f).every((v) => v.trim() !== '')
  const rows = q.data ?? []
  return (
    <Region index="02" label="Registrations" heading="Talyvor’s registrations" fullWidth sectionClassName="pb-10 pt-4 wide:pb-12">
      <p className="max-w-2xl text-body text-muted">
        A consumer sale into a jurisdiction is taxed only once Talyvor holds a registration covering it — its own,
        or its union’s, such as EU OSS non-Union. Record one here as it is granted.
      </p>
      <form
        aria-label="Add a registration"
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (complete) add.mutate({ ...f, jurisdiction: f.jurisdiction.trim().toUpperCase() })
        }}
      >
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Jurisdiction</span>
          <Input className="w-24 font-figure" value={f.jurisdiction} onChange={(e) => set('jurisdiction')(e.target.value)} placeholder="GB" />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Scheme</span>
          <Input value={f.scheme} onChange={(e) => set('scheme')(e.target.value)} placeholder="GB VAT" />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Number</span>
          <Input className="font-figure" value={f.number} onChange={(e) => set('number')(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>From</span>
          <Input type="date" className="font-figure" value={f.effective_from} onChange={(e) => set('effective_from')(e.target.value)} />
        </label>
        <Button type="submit" disabled={!complete || add.isPending}>
          {add.isPending ? 'Adding…' : 'Add registration'}
        </Button>
      </form>
      {add.isSuccess ? (
        <p role="status" className="mt-3 text-body text-ink">
          Registered in {add.data.jurisdiction}.
        </p>
      ) : null}
      {add.isError ? <p role="alert" className="mt-3 text-body text-ink">{taxFailure(add.error, 'The registration could not be added just now.')}</p> : null}
      {q.isError ? (
        <p className="mt-4 text-body text-muted">{taxFailure(q.error, 'The registrations could not be read just now.')}</p>
      ) : q.isPending ? (
        <p className="mt-4 text-body text-muted">Reading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-body text-muted">Talyvor holds no tax registration yet.</p>
      ) : (
        <div className={tableWrap}>
          <table className="w-full border-collapse">
            <thead>
              <tr className={headRow}>
                <th className={th}>Jurisdiction</th>
                <th className={th}>Scheme</th>
                <th className={th}>Number</th>
                <th className={th}>From</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.jurisdiction}-${r.scheme}-${r.number}`} data-testid="tax-registration" className="border-b border-rule last:border-b-0">
                  <td className={`${td} font-figure text-ink`}>{r.jurisdiction}</td>
                  <td className={`${td} text-ink`}>{r.scheme}</td>
                  <td className={`${td} font-mono text-muted`}>{r.number}</td>
                  <td className={`${td} whitespace-nowrap font-figure text-muted`}>{day(r.effective_from)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Region>
  )
}

function Returns() {
  const quarters = [quarterOf(new Date())]
  while (quarters.length < 8) quarters.push(quarterBefore(quarters[quarters.length - 1]))
  const [quarter, setQuarter] = useState(quarters[0])
  const [jurisdiction, setJurisdiction] = useState('GB')
  const [funding, setFunding] = useState('live')
  const q = useQuery({
    queryKey: ['operator-tax-return', jurisdiction, quarter, funding],
    queryFn: () => taxApi.taxReturn(jurisdiction, quarter, funding),
  })
  const lines = q.data?.lines ?? []
  return (
    <Region index="03" label="Returns" heading="Tax by quarter" fullWidth sectionClassName="pb-10 pt-4 wide:pb-12">
      <p className="max-w-2xl text-body text-muted">
        The tax on the sales cleared in a quarter, less what was refunded in it, by jurisdiction, treatment and rate:
        the figures for the UK VAT return and the EU OSS return.
      </p>
      <form aria-label="Choose a return" className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(e) => e.preventDefault()}>
        <label className="flex flex-col">
          <span className={labelClass}>Quarter</span>
          <select className={`${selectClass} font-figure`} value={quarter} onChange={(e) => setQuarter(e.target.value)}>
            {quarters.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className={labelClass}>Return</span>
          <select className={selectClass} value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)}>
            <option value="GB">UK VAT (GB)</option>
            <option value="EU">EU OSS (every member state)</option>
          </select>
        </label>
        <label className="flex flex-col">
          <span className={labelClass}>Sales</span>
          <select className={selectClass} value={funding} onChange={(e) => setFunding(e.target.value)}>
            <option value="live">Live</option>
            <option value="test">Test</option>
          </select>
        </label>
      </form>
      {q.isError ? (
        <p className="mt-4 text-body text-muted">{taxFailure(q.error, 'The quarter’s tax could not be read just now.')}</p>
      ) : q.isPending ? (
        <p className="mt-4 text-body text-muted">Reading…</p>
      ) : lines.length === 0 ? (
        <p className="mt-4 text-body text-muted">No taxed sale cleared in {quarter}.</p>
      ) : (
        <>
          <div className={tableWrap}>
            <table className="w-full border-collapse">
              <thead>
                <tr className={headRow}>
                  <th className={th}>Jurisdiction</th>
                  <th className={th}>Treatment</th>
                  <th className={`${th} text-right`}>Rate</th>
                  <th className={`${th} text-right`}>Sales</th>
                  <th className={`${th} text-right`}>Refunds</th>
                  <th className={`${th} text-right`}>Taxable</th>
                  <th className={`${th} text-right`}>Tax</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={`${l.jurisdiction}-${l.treatment}-${l.rate_bps}`} data-testid="tax-return-line" className="border-b border-rule last:border-b-0">
                    <td className={`${td} font-figure text-ink`}>{l.jurisdiction}</td>
                    <td className={`${td} whitespace-nowrap text-ink`}>{TREATMENTS[l.treatment] ?? l.treatment}</td>
                    <td className={`${td} text-right font-figure text-muted`}>{rateText(l.rate_bps)}</td>
                    <td className={`${td} text-right font-figure text-muted`}>{l.sales.toLocaleString('en-US')}</td>
                    <td className={`${td} text-right font-figure text-muted`}>{l.refunds.toLocaleString('en-US')}</td>
                    <td className={`${td} text-right font-figure text-ink`} title={`${l.net_taxable_usd_micros} µUSD`}>
                      {formatUSD(l.net_taxable_usd_micros)}
                    </td>
                    <td className={`${td} text-right font-figure text-ink`} title={`${l.net_tax_usd_micros} µUSD`}>
                      {formatUSD(l.net_tax_usd_micros)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p data-testid="tax-return-totals" className="mt-3 font-figure text-body text-ink">
            {formatUSD(q.data.taxable_usd_micros)} taxable · {formatUSD(q.data.tax_usd_micros)} tax
          </p>
          <p data-testid="tax-return-journal" className="mt-1 text-body text-muted">
            {q.data.journal_tax_usd_micros === q.data.tax_usd_micros
              ? 'The journal’s tax accounts agree to the micro-dollar.'
              : (
                <>
                  The journal’s tax accounts say <span className="font-figure text-ink">{formatUSD(q.data.journal_tax_usd_micros)}</span>{' '}
                  — find the difference before filing.
                </>
              )}
          </p>
        </>
      )}
    </Region>
  )
}

function saveFile(f: PlatformReportFile) {
  const url = URL.createObjectURL(f.blob)
  const a = document.createElement('a')
  a.href = url
  a.download = f.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function PlatformReport() {
  const qc = useQueryClient()
  const thisYear = new Date().getUTCFullYear()
  const years = [thisYear, thisYear - 1, thisYear - 2]
  const [year, setYear] = useState(thisYear)
  const [funding, setFunding] = useState('live')
  const [format, setFormat] = useState('csv')
  const runs = useQuery({ queryKey: RUNS_KEY, queryFn: taxApi.reportRuns })
  const run = useMutation({
    mutationFn: () => taxApi.runReport(year, funding, format),
    onSuccess: (f) => {
      // A file whose bytes are not the ones Lens recorded is never handed to the browser to save.
      if (f.recorded && f.recorded === f.received) saveFile(f)
      void qc.invalidateQueries({ queryKey: RUNS_KEY })
    },
  })
  const rows = runs.data ?? []
  return (
    <Region index="04" label="Reporting" heading="Platform report" fullWidth sectionClassName="pb-10 pt-4 wide:pb-12">
      <p className="max-w-2xl text-body text-muted">
        The year’s UK and EU (DAC7) platform-reporting file: one record per seller resident in the UK or the EU,
        with each quarter’s consideration, sales and Talyvor’s fees. It holds the sellers’ tax numbers, so it is
        saved straight to this computer. Lens records each file with its sha256.
      </p>
      <form
        aria-label="Run the platform report"
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          run.mutate()
        }}
      >
        <label className="flex flex-col">
          <span className={labelClass}>Year</span>
          <select className={`${selectClass} font-figure`} value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className={labelClass}>Sales</span>
          <select className={selectClass} value={funding} onChange={(e) => setFunding(e.target.value)}>
            <option value="live">Live</option>
            <option value="test">Test</option>
          </select>
        </label>
        <label className="flex flex-col">
          <span className={labelClass}>Format</span>
          <select className={selectClass} value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
          </select>
        </label>
        <Button type="submit" variant="primary" disabled={run.isPending}>
          {run.isPending ? 'Running…' : 'Run and download'}
        </Button>
      </form>
      {run.isError ? <p role="alert" className="mt-3 text-body text-ink">{taxFailure(run.error, 'The report could not be run just now.')}</p> : null}
      {run.isSuccess ? (
        <div role="status" data-testid="report-file" className="mt-3 max-w-2xl text-body text-ink">
          <p>
            {run.data.name} · {run.data.rows.toLocaleString('en-US')} {run.data.rows === 1 ? 'record' : 'records'}
          </p>
          <p className="mt-1 break-all font-mono text-caption text-muted">sha256 {run.data.received}</p>
          <p data-testid="report-check" className="mt-1">
            {run.data.recorded === run.data.received
              ? 'Saved. Its sha256 matches the one Lens recorded.'
              : `Not saved: the file received does not match the sha256 Lens recorded (${run.data.recorded || 'none'}). Run it again.`}
          </p>
        </div>
      ) : null}
      {runs.isError ? (
        <p className="mt-4 text-body text-muted">{taxFailure(runs.error, 'The reports run could not be read just now.')}</p>
      ) : runs.isPending ? (
        <p className="mt-4 text-body text-muted">Reading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-body text-muted">No platform report has been run yet. Pick a year above to run the first.</p>
      ) : (
        <div className={tableWrap}>
          <table className="w-full border-collapse">
            <thead>
              <tr className={headRow}>
                <th className={th}>Run</th>
                <th className={th}>Year</th>
                <th className={th}>Operator</th>
                <th className={`${th} text-right`}>Records</th>
                <th className={th}>sha256</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-testid="report-run" className="border-b border-rule align-top last:border-b-0">
                  <td className={`${td} whitespace-nowrap font-figure text-muted`}>{formatWhen(r.generated_at)}</td>
                  <td className={`${td} whitespace-nowrap font-figure text-ink`}>
                    {r.year} {r.funding === 'test' ? '· test' : ''} · {r.format.toUpperCase()}
                  </td>
                  <td className={`${td} text-muted`}>{r.operator}</td>
                  <td className={`${td} text-right font-figure text-ink`}>{r.rows.toLocaleString('en-US')}</td>
                  <td className={`${td} whitespace-nowrap font-mono text-caption text-muted`}>{r.sha256}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Region>
  )
}
