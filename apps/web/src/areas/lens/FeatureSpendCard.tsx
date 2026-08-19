import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Card, CardHeader, Row } from '@talyvor/ui'
import { api } from '../../lib/api'
import { PanelFailure } from '../../components/SessionExpiredBar'
import { readFeatureSpend } from './featureSpend'

// Spend by feature tag — the first surface in this product that can answer the question its own
// AI cards ask a reader to go and check.
//
// ── WHY IT EXISTS ───────────────────────────────────────────────────────────
//
// Six cards across Docs and Track end their cost sentence by NAMING a tag: "a metered Lens call
// billed to this workspace under `docs-ai-summarize`", "…under `track-search`", and so on. A tag
// is a join key; printing one is only honest if the reader can join on it. MEASURED at suite
// `fe114149` and talyvor-lens `469a255751c8a124fb132d875ecd0ca32664f88e`: Lens records the
// dimension (`token_events.feature`), Lens serves the aggregate
// (`/v1/api/spend/by-feature` → internal/api/server.go#Server.handleSpendBy), the BFF mounted
// nothing onto it, and the whole of `areas/lens` contained ZERO occurrences of the word
// `feature`. The evidence existed and the product could not show it.
//
// ── THE THREE THINGS THIS CARD SAYS OUT LOUD, EACH BECAUSE THE ALTERNATIVE IS A FALSE PICTURE ──
//
//  1. THE UNTAGGED BUCKET IS A ROW. `feature` is written from a header no caller must send, so
//     every tool a customer points at Lens off this product's Setup page lands in the empty tag.
//     Filtering it would turn a slice of a workspace's spend into a picture of all of it.
//  2. THE WINDOW IS NOT THE MONTH CARD'S. Both figures sum the same `token_events.cost_usd`
//     column (the month card's upstream is internal/tenant/store.go#monthSpendSQL), but this one
//     is a rolling `days` window and that one is calendar month-to-date. They are not expected to
//     agree; a reader who assumed they should would read the difference as a defect.
//  3. THE TAGS ARE NOT ALL OPERATION NAMES. Docs sends the operation and its own client explains
//     why a page-scoped tag would "blow up the cardinality of Lens's by-feature aggregation".
//     Track sends the ISSUE'S IDENTIFIER (`internal/ai/engine.go` passes `issue.Identifier` for
//     triage, find-duplicates and summarise), so a Track workspace gets one row per issue beside
//     the operation rows.
//
// ⚠ NO TOP-N SLICE. The whole list renders, so the order is upstream's `ORDER BY cost_usd DESC`
// and nothing here is quietly left out — a card about money that hid its tail would understate
// exactly the rows a reader came to find.
export function FeatureSpendCard({ days }: { days: 7 | 30 }) {
  const q = useQuery({
    queryKey: ['spend-by-feature', days],
    queryFn: () => api.spendByFeature(days),
  })
  const view = q.data === undefined ? null : readFeatureSpend(q.data)

  return (
    <Card>
      <CardHeader>Spend by feature</CardHeader>
      <div className="px-gutter pb-1 pt-2.5 text-caption font-normal text-muted">
        Provider USD for the last {days} days, grouped by the tag each call carried — the tag the
        AI cards in Docs and Track print. This window is not the month-to-date figure above, so
        the two are not expected to match. Track tags its calls with the issue’s own identifier,
        so an issue key here is a row like any other.
      </div>

      {q.isLoading ? (
        <div className="px-gutter py-3 text-body text-muted">Loading…</div>
      ) : q.isError || view === null ? (
        <PanelFailure error={q.error} what="spend by feature" />
      ) : view.kind === 'empty' ? (
        // NOT "$0.00". A zero would be a measurement; an empty window is the absence of one.
        <div data-testid="feature-spend-empty" className="px-gutter py-3 text-body text-muted">
          {/* ⚠ THE LINK TEXT IS DELIBERATELY A THIRD PHRASE. Two other cards on THIS screen
              already link to /setup — the mint card's "point a tool at Lens" and CacheCard's
              "send a request through it" — and CacheCard's own comment records why a repeated
              accessible name is a defect rather than a repetition: it is ambiguous to a screen
              reader and it makes a by-name query resolve to whichever came first. */}
          Nothing went through Lens in this window, so there is nothing to break down yet. Tags
          appear once calls do —{' '}
          <Link className="underline" to="/setup">
            connect a tool in Setup
          </Link>
          .
        </div>
      ) : view.kind === 'unrecognised' ? (
        // A payload this app cannot read is a FAULT. Rendering it as an empty window would report
        // "you spent nothing" about money it simply failed to read.
        <div data-testid="feature-spend-unreadable" className="px-gutter py-3 text-body text-muted">
          Lens answered with something this screen can’t read, so the breakdown isn’t shown. This
          is a fault, not an empty window.
        </div>
      ) : (
        <>
          <div data-testid="lens-by-feature">
            {view.rows.map((r) => (
              <Row
                key={r.feature}
                label={r.feature}
                hint={`${r.requests} request${r.requests === 1 ? '' : 's'}`}
              >
                {/* ≈-marked and muted: a float from SUM(cost_usd) is derived, and this screen
                    reserves numerals for exact µ counts off ledger rows. Four decimals because
                    one AI call rounds to $0.00 at two, and a card whose every row read $0.00
                    would say the features are free. */}
                <span className="font-figure text-body text-muted">≈ ${r.costUSD.toFixed(4)}</span>
              </Row>
            ))}
          </div>
          {view.dropped > 0 ? (
            <div className="px-gutter py-3 text-caption text-muted">
              {/* font-figure because it IS a figure — the repo-wide numeral-face guard caught
                  this one in the body sans on its first run. */}
              <span data-testid="feature-spend-dropped" className="font-figure">
                {view.dropped}
              </span>{' '}
              row
              {view.dropped === 1 ? '' : 's'} in this window could not be read and{' '}
              {view.dropped === 1 ? 'is' : 'are'} not counted above, so the totals here are a
              floor.
            </div>
          ) : null}
        </>
      )}
    </Card>
  )
}
