import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button, Card, CardHeader, FixtureNotice, MuNumeral, Row, TierDot } from '@talyvor/ui'
import { api } from '../../lib/api'
import { fixtureCache, fixtureModelTiers } from './fixtures'
import { byModel, debitTotal, inWindow } from './spendMath'

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
          <div className="px-gutter py-3 text-body text-muted">Couldn’t load the ledger.</div>
        ) : (
          <>
            {agg.map((a) => (
              <Row
                key={a.model}
                label={
                  <span className="inline-flex items-center gap-2">
                    <TierDot tier={fixtureModelTiers[a.model] ?? 'cheap'} />
                    {a.model}
                  </span>
                }
                hint={`${a.requests} request${a.requests === 1 ? '' : 's'}`}
              >
                <MuNumeral micros={a.ulens} unit="lens" />
              </Row>
            ))}
            {agg.length === 0 ? (
              <div className="px-gutter py-3 text-body text-muted">No ledger rows in this window.</div>
            ) : null}
          </>
        )}
      </Card>

      <Card>
        <CardHeader>Cache</CardHeader>
        <div className="px-gutter pt-2">
          <FixtureNotice awaiting="a Lens workspace cache-rate endpoint (none exists yet)" />
        </div>
        <Row label="Hit rate" hint={`${fixtureCache.cache_lookups.toLocaleString('en-US')} lookups`}>
          <span className="text-body text-muted">≈ {Math.round(fixtureCache.cache_hit_rate * 100)}%</span>
        </Row>
      </Card>

      <Card>
        <CardHeader>Spent — LXC</CardHeader>
        <Row label="Provider spend, month to date" hint="Lens spend/current-month — a float upstream, so it dresses as derived">
          {month.isLoading ? (
            <span className="text-body text-muted">Loading…</span>
          ) : month.isError || !month.data ? (
            <span className="text-body text-muted">Couldn’t load</span>
          ) : (
            <span className="text-body text-muted">≈ ${month.data.current_month_usd.toFixed(2)}</span>
          )}
        </Row>
        <Row
          label={`Inference debits — ${days}d`}
          hint="all models — LXC ledger rows carry no model attribution, so spend has no per-model split"
        >
          {lxc.isLoading ? (
            <span className="text-body text-muted">Loading…</span>
          ) : lxc.isError || !lxc.data ? (
            <span className="text-body text-muted">Couldn’t load</span>
          ) : (
            <MuNumeral micros={debitTotal(lxc.data, days, now)} unit="lxc" />
          )}
        </Row>
      </Card>
    </div>
  )
}
