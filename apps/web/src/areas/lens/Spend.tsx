import { useState } from 'react'
import { Button, Card, CardHeader, MuNumeral, Row, TierDot } from '@talyvor/ui'
import { FixtureNotice } from './FixtureNotice'
import { fixtureCache, fixtureModelTiers, fixtureMonthSpend, fixtureSpendRows } from './fixtures'
import { byModel, inWindow } from './spendMath'

// Spend & routing. The screen the design system's central distinction was
// built for:
//
//   · EXACT values — µ counts straight off ledger rows — render as MuNumeral,
//     the µ-split numeral. Never rounded, never a float.
//   · DERIVED values — rates, ratios, month-USD — are ≈-marked muted captions.
//     They are estimates and they dress like estimates.
//
// The per-model table derives from mint-ledger-shaped rows via pure functions
// (spend.ts); the live /api/tokens/history route serves this exact shape, so
// wiring it is a data-source swap once querying screens are permitted (see the
// scaffold-test note in the lens-area report). Cache stats and month-USD have
// NO live source at all yet — Lens exposes no per-model usage endpoint, and
// spend/current-month + distill stats are unproxied — so those are sample
// values under the fixture notice. Two-step TierDot only: hue is category
// (cheap | capable), never a rank.
export function Spend({ now = new Date() }: { now?: Date }) {
  const [days, setDays] = useState<7 | 30>(7)
  const agg = byModel(inWindow(fixtureSpendRows, days, now))

  return (
    <div className="flex flex-col gap-4 px-gutter py-4">
      <FixtureNotice awaiting="a Lens per-model usage endpoint and its BFF proxy (ledger-derived rows shown meanwhile)" />

      <Card>
        <CardHeader>Spend &amp; routing</CardHeader>
        <Row label="Window" hint="By model, derived from the mint ledger">
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
      </Card>

      <Card>
        <CardHeader>Cache</CardHeader>
        <Row label="Hit rate" hint={`${fixtureCache.cache_lookups.toLocaleString('en-US')} lookups`}>
          <span className="text-caption text-muted">≈ {Math.round(fixtureCache.cache_hit_rate * 100)}%</span>
        </Row>
        <Row label="Hits" hint="Exact count">
          <span className="font-mono text-body tabular-nums text-ink">
            {fixtureCache.cache_hits.toLocaleString('en-US')}
          </span>
        </Row>
      </Card>

      <Card>
        <CardHeader>Month to date</CardHeader>
        <Row label="Provider spend" hint="Lens spend/current-month — a float upstream, so it dresses as derived">
          <span className="text-caption text-muted">≈ ${fixtureMonthSpend.current_month_usd.toFixed(2)}</span>
        </Row>
      </Card>
    </div>
  )
}
