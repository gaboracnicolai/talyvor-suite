import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Card, CardHeader, Row } from '@talyvor/ui'
import { api } from '../../lib/api'
import { PanelFailure } from '../../components/SessionExpiredBar'

// The cache panel — the product's central claim, on MEASURED numbers.
//
// ── WHAT THIS REPLACES ───────────────────────────────────────────────────────
//
// Both screens used to render a fixture: 1,240 cached serves, an 87% hit rate, 1,421 lookups,
// under a caption explaining that no Lens endpoint served this. The endpoint existed the
// whole time — GET /v1/api/usage, described in Lens's own source as "per-model usage +
// serve_source cache hit rate (trial core), one call", and its doc comment names this very
// card as the consumer. Nothing in the suite had ever called it. On a real trial workspace
// the numbers are single digits.
//
// ── THE THREE STATES, AND WHY THE EMPTY ONE IS NOT 0% ────────────────────────
//
//   loading   → "Loading…"
//   error     → "Couldn't load the cache rate." A number would be a guess wearing a
//               measurement's clothes; this is the one thing the panel must never do.
//   no rows   → "No requests recorded in this window yet." NOT 0%. A zero rate is a real
//               measurement meaning "the cache never hit"; with an empty denominator there
//               is nothing measured at all, and printing 0% would assert the cache is
//               failing. This is the same reasoning that made Lens abandon its `cached`
//               boolean: nothing wrote it true, so its rate was a structural zero reported
//               as a measurement.
//   measured  → hits as an exact count (mono ink), rate as a ≈-marked derived caption,
//               and the DENOMINATOR always beside it — a rate without its sample size is
//               not a reading.
//
// The `days` window is passed to Lens, so the number matches whatever window the screen
// claims in its caption rather than silently always being 30.
export function CacheCard({ days }: { days: number }) {
  const q = useQuery({ queryKey: ['usage', days], queryFn: () => api.usage(days) })
  const cache = q.data?.cache

  return (
    <Card>
      <CardHeader>Cache</CardHeader>
      <div className="px-gutter pb-1 pt-2.5 text-caption font-normal text-muted">
        A cache hit serves the response without calling the provider.
      </div>

      {q.isLoading ? (
        <div className="px-gutter py-3 text-body text-muted">Loading…</div>
      ) : q.isError || !cache ? (
        <PanelFailure error={q.error} what="the cache rate" />
      ) : cache.total_requests === 0 ? (
        <div className="px-gutter py-3 text-body text-muted">
          {/* ⚠ THE LINK TEXT IS DELIBERATELY NOT "point a tool at it". This card renders on
              Overview BESIDE the activity empty state, which already uses that phrase for the same
              destination — two links with one accessible name on one screen. It is ambiguous to a
              screen reader and it made Overview's own test resolve to whichever came first. */}
          No requests recorded in this window yet. The rate appears once traffic goes through
          Lens —{' '}
          <Link className="underline" to="/setup">
            send a request through it
          </Link>{' '}
          and check back.
        </div>
      ) : (
        <>
          <Row label="Cached serves" hint="responses answered from cache">
            <span className="font-mono text-body text-ink">
              {cache.cache_hits.toLocaleString('en-US')}
            </span>
          </Row>
          <Row
            label="Hit rate"
            hint={`${cache.total_requests.toLocaleString('en-US')} requests recorded in the last ${days} days`}
          >
            <span className="text-body text-muted">≈ {Math.round(cache.hit_rate * 100)}%</span>
          </Row>
        </>
      )}
    </Card>
  )
}
