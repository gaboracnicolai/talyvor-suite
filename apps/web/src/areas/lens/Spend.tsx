import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button, Card, CardHeader, FixtureNotice, MuNumeral, Row, TierDot } from '@talyvor/ui'
import { api } from '../../lib/api'
import { fixtureCache, fixtureModelTiers } from './fixtures'
import { byModel, inWindow } from './spendMath'

// Spend & routing — LIVE. The screen the design system's central distinction
// was built for:
//
//   · EXACT values — µ counts straight off ledger rows — render as MuNumeral,
//     the µ-split numeral. Never rounded, never a float.
//   · DERIVED values — rates, month-USD — are ≈-marked muted captions. They
//     are estimates and they dress like estimates.
//
// The per-model table derives from the REAL /api/tokens/history via the pure
// functions in spendMath.ts — the same functions the fixture version ran, so
// going live moved the data source and not one number (the unit tests pin
// them). The month card reads /api/spend/month. Only the cache card is still a
// sample: Lens exposes no workspace cache-rate endpoint, and the card says so.
// Two-step TierDot only: hue is category (cheap | capable), never a rank.
export function Spend({ now = new Date() }: { now?: Date }) {
  const [days, setDays] = useState<7 | 30>(7)
  const ledger = useQuery({ queryKey: ['spend-ledger'], queryFn: () => api.tokensHistory(200, 0) })
  const month = useQuery({ queryKey: ['spend-month'], queryFn: api.spendMonth })
  const agg = ledger.data ? byModel(inWindow(ledger.data, days, now)) : []

  return (
    <div className="flex flex-col gap-4 px-gutter py-4">
      <Card>
        <CardHeader>Spend &amp; routing</CardHeader>
        <Row label="Window" hint="By model, derived from the mint ledger (newest 200 rows)">
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
          <span className="text-caption text-muted">≈ {Math.round(fixtureCache.cache_hit_rate * 100)}%</span>
        </Row>
      </Card>

      <Card>
        <CardHeader>Month to date</CardHeader>
        <Row label="Provider spend" hint="Lens spend/current-month — a float upstream, so it dresses as derived">
          {month.isLoading ? (
            <span className="text-caption text-muted">Loading…</span>
          ) : month.isError || !month.data ? (
            <span className="text-caption text-muted">Couldn’t load</span>
          ) : (
            <span className="text-caption text-muted">≈ ${month.data.current_month_usd.toFixed(2)}</span>
          )}
        </Row>
      </Card>
    </div>
  )
}
