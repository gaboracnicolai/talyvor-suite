import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Button, Card, CardHeader, MuNumeral, Pill } from '@talyvor/ui'
import { api, type LedgerEntry } from '../lib/api'
import { formatWhen, humanizeType, ledgerStatus } from '../lib/ledger'

const PAGE = 20

// Ledger: the LENS token ledger (tokens/history), paginated by limit/offset. This is
// the mint ledger — the rows that actually exercise the settled/held/slashed vocabulary.
// The API returns a bare array with no total, so "next" is inferred from a full page.

function StatusCell({ type }: { type: string }) {
  const status = ledgerStatus(type)
  if (status) return <Pill status={status}>{status}</Pill>
  // An account movement (grant/purchase/spend/convert) has no lifecycle status → plain label.
  return <span className="text-caption uppercase tracking-wide text-muted">{humanizeType(type)}</span>
}

function LedgerRow({ e }: { e: LedgerEntry }) {
  return (
    <tr className="border-b border-rule last:border-b-0">
      <td className="whitespace-nowrap px-gutter py-2 text-caption tabular-nums text-muted">{formatWhen(e.created_at)}</td>
      <td className="px-gutter py-2">
        <StatusCell type={e.type} />
      </td>
      <td className="px-gutter py-2 text-body text-ink">{e.description || humanizeType(e.type)}</td>
      <td className="px-gutter py-2 text-right">
        <div className="flex justify-end">
          <MuNumeral micros={e.amount_ulens} unit="lens" />
        </div>
      </td>
      <td className="px-gutter py-2 text-right">
        <div className="flex justify-end">
          <MuNumeral micros={e.balance_after_ulens} unit="lens" />
        </div>
      </td>
    </tr>
  )
}

export function Ledger() {
  const [offset, setOffset] = useState(0)
  const q = useQuery({
    queryKey: ['tokens-history', PAGE, offset],
    queryFn: () => api.tokensHistory(PAGE, offset),
    placeholderData: keepPreviousData,
  })
  const rows = q.data ?? []
  const hasPrev = offset > 0
  const hasNext = rows.length === PAGE // a full page implies there may be more

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-gutter">
      <Card>
        <CardHeader>LENS token ledger</CardHeader>
        {q.isLoading ? (
          <div className="px-gutter py-3 text-body text-muted">Loading…</div>
        ) : q.isError ? (
          <div className="px-gutter py-3 text-body text-muted">Couldn’t load the ledger.</div>
        ) : rows.length === 0 ? (
          <div className="px-gutter py-3 text-body text-muted">
            {hasPrev ? 'No more entries.' : 'No ledger entries yet.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-rule text-left text-caption uppercase tracking-wide text-muted">
                  <th className="px-gutter py-2 font-semibold">When</th>
                  <th className="px-gutter py-2 font-semibold">Status</th>
                  <th className="px-gutter py-2 font-semibold">Description</th>
                  <th className="px-gutter py-2 text-right font-semibold">Amount</th>
                  <th className="px-gutter py-2 text-right font-semibold">Balance after</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <LedgerRow key={e.id} e={e} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="flex items-center justify-between">
        <span className="text-caption tabular-nums text-muted">
          Rows {rows.length ? offset + 1 : 0}–{offset + rows.length}
        </span>
        <div className="flex gap-2">
          <Button onClick={() => setOffset((o) => Math.max(0, o - PAGE))} disabled={!hasPrev}>
            Previous
          </Button>
          <Button onClick={() => setOffset((o) => o + PAGE)} disabled={!hasNext}>
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}
