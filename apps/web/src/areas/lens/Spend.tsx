import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button, Card, CardHeader, MuNumeral, Row } from '@talyvor/ui'
import { api } from '../../lib/api'
import { CacheCard } from './CacheCard'
import { InlineFailure, PanelFailure } from '../../components/SessionExpiredBar'
import { ModelTier } from './ModelTier'
import { byModel, debitTotal, inWindow, lxcDebitsByModel } from './spendMath'

// Spend & routing — LIVE. The screen the design system's central distinction
// was built for:
//
//   · EXACT values — µ counts straight off ledger rows — render as MuNumeral,
//     the µ-split numeral. Never rounded, never a float.
//   · DERIVED values — rates, month-USD — are ≈-marked muted captions. They
//     are estimates and they dress like estimates.
//
// THE TWO LEDGERS, kept apart (the inversion fix, same as Overview's):
// /api/tokens/history is lens_token_ledger — LENS EARNED by mining, and its
// by-model table is MINT ATTRIBUTION (copper), not provider spend. What you
// SPEND is LXC (steel): /api/lxc/history debits — whose rows carry no model
// attribution on any writer, so spend is shown as a window total, never
// per-model. The month card reads /api/spend/month. Only the cache card is
// still a sample: Lens exposes no workspace cache-rate endpoint, and it says
// so. Two-step TierDot only: hue is category (cheap | capable), never a rank.
export function Spend({ now = new Date() }: { now?: Date }) {
  const [days, setDays] = useState<7 | 30>(7)
  const ledger = useQuery({ queryKey: ['spend-ledger'], queryFn: () => api.tokensHistory(200, 0) })
  const lxc = useQuery({ queryKey: ['lxc-history', 200, 0], queryFn: () => api.lxcLedger(200, 0) })
  const month = useQuery({ queryKey: ['spend-month'], queryFn: api.spendMonth })
  const agg = ledger.data ? byModel(inWindow(ledger.data, days, now)) : []
  const lxcSplit = lxc.data ? lxcDebitsByModel(lxc.data, days, now) : []

  return (
    <div className="flex flex-col gap-4 px-gutter py-4">
      <Card>
        <CardHeader>Earned by model — LENS mint attribution</CardHeader>
        <Row label="Window" hint="Mint credits by model (copper — the mined token, not provider spend)">
          <div className="flex items-center gap-2">
            {([7, 30] as const).map((d) => (
              <Button
                key={d}
                variant={days === d ? 'primary' : 'default'}
                aria-pressed={days === d}
                onClick={() => setDays(d)}
              >
                {d}d
              </Button>
            ))}
          </div>
        </Row>
        {ledger.isLoading ? (
          <div className="px-gutter py-3 text-body text-muted">Loading…</div>
        ) : ledger.isError ? (
          <PanelFailure error={lxc.error} what="the ledger" />
        ) : (
          <>
            <div data-testid="lens-by-model">
              {agg.map((a) => (
                <Row
                  key={a.model}
                  label={
                    <span className="inline-flex items-center gap-2">
                      <ModelTier model={a.model} />
                      {a.model}
                    </span>
                  }
                  hint={`${a.requests} request${a.requests === 1 ? '' : 's'}`}
                >
                  <MuNumeral micros={a.ulens} unit="lens" />
                </Row>
              ))}
            </div>
            {agg.length === 0 ? (
              // ⚠ THE 7-DAY BRANCH IS NOT DECORATION. "Widen the window" is only true when there is
              // a wider one; the control offers 7 and 30, so at 30 that half of the sentence would
              // be an instruction the screen cannot honour. Naming an action the UI does not have
              // is the same defect as naming one the product does not have.
              <div className="px-gutter py-3 text-body text-muted">
                No ledger rows in this window. A row appears when your traffic answers a question
                another company later asks
                {days === 7 ? ', so try the 30-day window above first' : ''} —{' '}
                <Link className="underline" to="/setup">
                  point a tool at Lens
                </Link>{' '}
                if nothing has run yet.
              </div>
            ) : null}
          </>
        )}
      </Card>

      <CacheCard days={days} />

      <Card>
        <CardHeader>Spent — LXC</CardHeader>
        <Row label="Provider spend, month to date" hint="Lens spend/current-month — a float upstream, so it dresses as derived">
          {month.isLoading ? (
            <span className="text-body text-muted">Loading…</span>
          ) : month.isError || !month.data ? (
            <InlineFailure error={month.error} />
          ) : (
            <span className="font-figure text-body text-muted">≈ ${month.data.current_month_usd.toFixed(2)}</span>
          )}
        </Row>
        <Row
          label={`Inference debits — ${days}d`}
          hint="every model — the window total that left the balance"
        >
          {lxc.isLoading ? (
            <span className="text-body text-muted">Loading…</span>
          ) : lxc.isError || !lxc.data ? (
            <InlineFailure error={lxc.error} />
          ) : (
            <MuNumeral micros={debitTotal(lxc.data, days, now)} unit="lxc" />
          )}
        </Row>
        {/* The per-model split of that total — attributed to the model that SERVED,
            falling back to the requested one. The caption this replaces said the split
            was impossible; it had been possible since #343, and api.lxcLedger was
            dropping the field so nothing could contradict it. */}
        {lxcSplit.length > 0 ? (
          <div data-testid="lxc-by-model">
            {lxcSplit.map((a) => (
              <Row
                key={a.model}
                label={
                  <span className="inline-flex items-center gap-2">
                    <ModelTier model={a.model} />
                    {a.model}
                  </span>
                }
                hint={`${a.requests} charge${a.requests === 1 ? '' : 's'}`}
              >
                <MuNumeral micros={a.ulxc} unit="lxc" />
              </Row>
            ))}
          </div>
        ) : null}
      </Card>
    </div>
  )
}
