import { useQuery } from '@tanstack/react-query'
import { Pill, type PillStatus } from '@talyvor/ui'
import { Region, RegionScreen } from '../../components/Region'
import { ApiError, readable } from '../../lib/api'
import { isSessionExpired } from '../../lib/productState'
import { formatWhen } from './format'
import { CAPABILITIES_KEY } from './WalletMoney'
import { type WalletCapability, agentBankApi } from './agentBankApi'

// OperatorCompliance.tsx — B30.104: the operator's Compliance page. Every money capability with its class and the
// clearance in force (Lens B22.1, `lens clearances`); what customers hold in each currency against what the account
// partner reports holding for them (the safeguarding view); and each day's reconciliation against the partner's
// statements with every break (Lens B30.11). The BFF reads the last two on the operator read key
// (apps/bff/operator_reconciliation.go), and only someone on OPERATOR_SUBS gets an answer.

/** Lens economy.ReconciliationBreak: one payment the ledger and the partner's statement disagree on. */
export interface ReconciliationBreak {
  kind: string
  workspace_id: string
  account_id: string
  payment_ref: string
  ledger_minor: number
  statement_minor: number
  amount_minor: number
}

/** Lens economy.ReconciliationRun: one currency's reconciliation for one day. */
export interface ReconciliationRun {
  id: string
  day: string
  currency: string
  funding: string
  partner: string
  customers_hold_minor: number
  partner_holds_minor: number
  shortfall_minor: number
  break_count: number
  breaks: ReconciliationBreak[] | null
  ran_at: string
}

class OperatorError extends ApiError {
  constructor(
    status: number,
    path: string,
    readonly sentence: string,
  ) {
    super(status, path)
  }
}

async function readOperator<T extends object>(path: string, shape: Record<string, 'list'>): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    let sentence = ''
    try {
      sentence = ((await res.json()) as { error?: string }).error ?? ''
    } catch {
      // a body that is not JSON carries no sentence
    }
    throw new OperatorError(res.status, path, sentence)
  }
  return readable<T>(path, await res.json(), shape)
}

const readRuns = () =>
  readOperator<{ runs: ReconciliationRun[] | null }>('/api/admin/reconciliation', { runs: 'list' }).then((r) => r.runs ?? [])
const readSafeguarding = () =>
  readOperator<{ currencies: ReconciliationRun[] | null }>('/api/admin/safeguarding', { currencies: 'list' }).then(
    (r) => r.currencies ?? [],
  )

function failure(err: unknown, what: string): string {
  if (isSessionExpired(err)) return `The ${what} can’t be read until you sign in again.`
  if (err instanceof OperatorError && err.status === 403) return 'Only Talyvor’s operators can see this screen.'
  // The BFF's 501 and 502 name what to fix: the operator read key unset, or not the one Lens holds.
  if (err instanceof OperatorError && err.sentence && (err.status === 501 || err.status === 502)) return err.sentence
  return `The ${what} could not be read just now.`
}

/** Lens keeps USDC to six decimal places and pounds, euros and dollars to two. */
export function minorText(minor: number, currency: string): string {
  const ccy = currency.toUpperCase()
  if (ccy === 'USDC') {
    return `${(minor / 1e6).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDC`
  }
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: ccy }).format(minor / 100)
  } catch {
    return `${(minor / 100).toFixed(2)} ${ccy}`
  }
}

const CLASS_PILL: Record<WalletCapability['class'], PillStatus> = { GREEN: 'settled', AMBER: 'held', RED: 'slashed' }

const BREAK_KIND: Record<string, string> = {
  missing: 'Not on the statement',
  extra: 'Only on the statement',
  amount_differs: 'Amounts differ',
}

const day = (iso: string) => iso.slice(0, 10)

export function OperatorCompliance() {
  const caps = useQuery({ queryKey: CAPABILITIES_KEY, queryFn: agentBankApi.capabilities })
  const capList = caps.data?.capabilities ?? []
  const preview = !caps.isSuccess || capList.some((c) => c.class !== 'GREEN' && !c.real_money)
  return (
    <RegionScreen>
      <Region
        index="00"
        label="Compliance"
        heading="Clearances and reconciliation"
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="flex max-w-2xl flex-col gap-3"
      >
        <p className="text-body text-muted">
          Which money capabilities may take live money and on what clearance; what customers hold in each currency
          against what the account partner holds for them; and each day’s check of the ledger against the partner’s
          statements, with every payment they disagree on.
        </p>
        {preview ? (
          <p className="flex flex-wrap items-center gap-2 text-caption text-ink" data-testid="compliance-preview">
            <Pill status="held">Preview — test money only</Pill>
            <span>Accounts, payments, currencies, trading and credit take test money only for now.</span>
          </p>
        ) : null}
      </Region>
      <Region index="01" label="Clearances" heading="Every money capability, its class and its clearance">
        {caps.isError ? (
          <p className="text-body text-muted">{failure(caps.error, 'capabilities')}</p>
        ) : caps.isPending ? (
          <p className="text-body text-muted">Reading…</p>
        ) : (
          <div className="overflow-x-auto rounded-card border border-rule bg-raised">
            <table className="w-full border-collapse">
              <thead>
                <tr className="whitespace-nowrap border-b border-rule text-left font-figure text-eyebrow uppercase text-label">
                  <th className="px-gutter py-2 font-semibold">Capability</th>
                  <th className="px-gutter py-2 font-semibold">Class</th>
                  <th className="px-gutter py-2 font-semibold">Money</th>
                  <th className="px-gutter py-2 font-semibold">Clearance</th>
                </tr>
              </thead>
              <tbody>
                {capList.map((c) => (
                  <CapabilityRow key={c.capability} c={c} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Region>
      <Safeguarding />
      <Reconciliation />
    </RegionScreen>
  )
}

function CapabilityRow({ c }: { c: WalletCapability }) {
  const cl = c.clearance
  return (
    <tr data-testid="compliance-capability" className="border-b border-rule align-top last:border-b-0">
      <td className="px-gutter py-2">
        <div className="text-body text-ink">{c.name}</div>
        <div className="font-mono text-caption text-muted">{c.capability}</div>
      </td>
      <td className="px-gutter py-2">
        <Pill status={CLASS_PILL[c.class]}>{c.class}</Pill>
      </td>
      <td className="whitespace-nowrap px-gutter py-2 text-body text-ink">{c.real_money ? 'Live' : 'Test only'}</td>
      <td className="px-gutter py-2 text-body text-muted">
        {cl ? (
          <>
            <div className="text-ink">
              Cleared by {cl.by} on <span className="font-figure">{day(cl.at)}</span>
              {cl.expires_at ? (
                <>
                  , until <span className="font-figure">{day(cl.expires_at)}</span>
                </>
              ) : null}
            </div>
            <div className="font-mono text-caption">
              {[cl.reference, cl.licence_reference, cl.partner, (cl.countries ?? []).join(' ')].filter(Boolean).join(' · ')}
            </div>
          </>
        ) : c.class === 'GREEN' ? (
          'Needs none'
        ) : (
          'Not cleared'
        )}
      </td>
    </tr>
  )
}

function Safeguarding() {
  const q = useQuery({ queryKey: ['operator-safeguarding'], queryFn: readSafeguarding })
  const rows = q.data ?? []
  return (
    <Region index="02" label="Safeguarding" heading="What customers hold, against what the partner holds for them">
      {q.isError ? (
        <p className="text-body text-muted">{failure(q.error, 'safeguarding figures')}</p>
      ) : q.isPending ? (
        <p className="text-body text-muted">Reading…</p>
      ) : rows.length === 0 ? (
        <p className="text-body text-muted">Each currency appears here when the first daily reconciliation has run.</p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-rule bg-raised">
          <table className="w-full border-collapse">
            <thead>
              <tr className="whitespace-nowrap border-b border-rule text-left font-figure text-eyebrow uppercase text-label">
                <th className="px-gutter py-2 font-semibold">Currency</th>
                <th className="px-gutter py-2 text-right font-semibold">Customers hold</th>
                <th className="px-gutter py-2 text-right font-semibold">Partner holds</th>
                <th className="px-gutter py-2 font-semibold">Cover</th>
                <th className="px-gutter py-2 font-semibold">As of</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-testid="compliance-safeguarding" className="border-b border-rule last:border-b-0">
                  <td className="whitespace-nowrap px-gutter py-2 font-figure text-body text-ink">
                    {r.currency} {r.funding === 'test' ? <Pill status="idle">Test</Pill> : null}
                  </td>
                  <td className="whitespace-nowrap px-gutter py-2 text-right font-figure text-body text-ink">
                    {minorText(r.customers_hold_minor, r.currency)}
                  </td>
                  <td className="whitespace-nowrap px-gutter py-2 text-right font-figure text-body text-ink">
                    {minorText(r.partner_holds_minor, r.currency)}
                  </td>
                  <td className="whitespace-nowrap px-gutter py-2">
                    {r.shortfall_minor > 0 ? (
                      <Pill status="slashed">Short {minorText(r.shortfall_minor, r.currency)}</Pill>
                    ) : (
                      <Pill status="settled">Covered</Pill>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-gutter py-2 text-muted">
                    <div className="font-figure text-body">{r.day}</div>
                    <div className="text-caption">{r.partner}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Region>
  )
}

function Reconciliation() {
  const q = useQuery({ queryKey: ['operator-reconciliation'], queryFn: readRuns })
  const runs = q.data ?? []
  const breaks = runs.reduce((s, r) => s + r.break_count, 0)
  return (
    <Region index="03" label="Reconciliation" heading="Each day’s ledger against the partner’s statements">
      {q.isError ? (
        <p className="text-body text-muted">{failure(q.error, 'reconciliation runs')}</p>
      ) : q.isPending ? (
        <p className="text-body text-muted">Reading…</p>
      ) : runs.length === 0 ? (
        <p className="text-body text-muted">A run appears here when the daily reconciliation has run: once a day, for the day before.</p>
      ) : (
        <>
          <p data-testid="compliance-run-totals" className="font-figure text-body text-ink">
            {runs.length.toLocaleString('en-GB')} {runs.length === 1 ? 'run' : 'runs'} ·{' '}
            {breaks.toLocaleString('en-GB')} {breaks === 1 ? 'break' : 'breaks'}
          </p>
          <ul className="mt-4 flex flex-col gap-3">
            {runs.map((r) => (
              <RunCard key={r.id} r={r} />
            ))}
          </ul>
        </>
      )}
    </Region>
  )
}

function RunCard({ r }: { r: ReconciliationRun }) {
  const list = r.breaks ?? []
  return (
    <li data-testid="compliance-run" className="rounded-card border border-rule bg-raised px-gutter py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-figure text-body text-ink">
          {r.day} · {r.currency}
        </span>
        {r.funding === 'test' ? <Pill status="idle">Test</Pill> : null}
        {r.break_count > 0 ? (
          <Pill status="slashed">
            {r.break_count} {r.break_count === 1 ? 'break' : 'breaks'}
          </Pill>
        ) : (
          <Pill status="settled">Clean</Pill>
        )}
        <span className="text-caption text-muted">
          {r.partner} · ran <span className="font-figure">{formatWhen(r.ran_at)}</span>
        </span>
      </div>
      {list.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2 border-t border-rule pt-3">
          {list.map((b, i) => (
            <li key={`${b.payment_ref}-${i}`} data-testid="compliance-break" className="flex flex-col gap-0.5">
              <span className="text-body text-ink">
                {BREAK_KIND[b.kind] ?? b.kind}: <span className="font-figure">{minorText(b.amount_minor, r.currency)}</span>
              </span>
              <span className="break-all font-mono text-caption text-muted">
                ledger {minorText(b.ledger_minor, r.currency)} · statement {minorText(b.statement_minor, r.currency)} ·{' '}
                {b.payment_ref} · workspace {b.workspace_id}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}
