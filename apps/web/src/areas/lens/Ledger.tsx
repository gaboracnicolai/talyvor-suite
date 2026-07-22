import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Button, Card, CardHeader, MuNumeral, Pill } from '@talyvor/ui'
import { api, type LedgerRow, type Token } from '../../lib/api'
import { formatWhen, humanizeType, ledgerStatus } from './format'

const PAGE = 20

// The Ledger renders EITHER token ledger. The two are structurally identical — same
// columns (when / status / description / amount / balance) — and differ only in the µ-field
// name (normalized away in api.ledger) and the unit tick. So this is ONE table component
// taking a `token` discriminator, not two wrappers that would duplicate the whole
// table + pagination + status logic to vary one enum. And it is ONE screen with a
// LENS/LXC switch, not two routes: it is the same view of two ledgers, so one mental model
// and one URL. The unit tick follows the token (copper LENS / steel LXC) via MuNumeral —
// the two-token colour signature that keeps them from being confused.

function StatusCell({ type }: { type: string }) {
  const status = ledgerStatus(type)
  if (status) return <Pill status={status}>{status}</Pill>
  // Movements (grant/purchase/spend) have no lifecycle status → a plain ink label. The
  // mislabeled bootstrap `purchase` shows verbatim: the data is wrong, not the display.
  return <span className="text-caption uppercase tracking-wide text-muted">{humanizeType(type)}</span>
}

function LedgerTableRow({ r, token }: { r: LedgerRow; token: Token }) {
  return (
    <tr className="border-b border-rule last:border-b-0">
      <td className="whitespace-nowrap px-gutter py-2 text-caption tabular-nums text-muted">{formatWhen(r.created_at)}</td>
      <td className="px-gutter py-2">
        <StatusCell type={r.type} />
      </td>
      <td className="px-gutter py-2 text-body text-ink">{r.description || humanizeType(r.type)}</td>
      <td className="px-gutter py-2 text-right">
        <div className="flex justify-end">
          <MuNumeral micros={r.amount} unit={token} />
        </div>
      </td>
      <td className="px-gutter py-2 text-right">
        <div className="flex justify-end">
          <MuNumeral micros={r.balanceAfter} unit={token} />
        </div>
      </td>
    </tr>
  )
}

const TOKENS: { id: Token; label: string }[] = [
  { id: 'lens', label: 'LENS' },
  { id: 'lxc', label: 'LXC' },
]

export function Ledger() {
  const [token, setTokenRaw] = useState<Token>('lens')
  const [offset, setOffset] = useState(0)
  const setToken = (t: Token) => {
    setTokenRaw(t)
    setOffset(0) // a different ledger starts at its own first page
  }

  const q = useQuery({
    queryKey: ['ledger', token, offset],
    queryFn: () => api.ledger(token, PAGE, offset),
    placeholderData: keepPreviousData,
  })
  const rows = q.data ?? []
  const hasPrev = offset > 0
  const hasNext = rows.length === PAGE

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-gutter">
      <div className="flex items-center justify-between gap-gutter">
        <div className="flex gap-1" role="group" aria-label="Ledger token">
          {TOKENS.map((t) => (
            <Button
              key={t.id}
              variant={token === t.id ? 'primary' : 'default'}
              aria-pressed={token === t.id}
              onClick={() => setToken(t.id)}
            >
              {t.label}
            </Button>
          ))}
        </div>
        <span className="text-caption tabular-nums text-muted">newest first</span>
      </div>

      <Card>
        <CardHeader>{token === 'lxc' ? 'LXC ledger' : 'LENS token ledger'}</CardHeader>
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
                {rows.map((r) => (
                  <LedgerTableRow key={r.id} r={r} token={token} />
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
