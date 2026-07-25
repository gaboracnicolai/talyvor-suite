import { Card, CardHeader } from '@talyvor/ui'
import { notConfiguredCopy } from '../../lib/productState'
import type { UpstreamState } from './data'

// The one card the Track area draws for a read it cannot serve — and the replacement for
// fourteen invented issues.
//
// Four states, each a fact about THIS deployment as observed a moment ago:
//
//   loading      → checking.
//   unconfigured → the 503 the BFF returns when TRACK_* is unset. Named as state, not fault:
//                  nothing is broken, the product simply is not wired here.
//   error        → anything else. Named as a failure without pretending to know the cause,
//                  and never laundered into "off" — a broken upstream must not read as calm.
//   configured   → the upstream answered. The data is REACHABLE and this view does not read
//                  it yet, which is the honest sentence and a visible prompt to finish. The
//                  screen still shows no rows, because inventing them is the thing we removed.
//
// None of these sentences is reachable without a response, which is the point: the copy cannot
// outlive its truth the way the #339 cache caption did. The day Track appears, this card
// changes what it says with no edit here.
export function UpstreamCard({
  title,
  state,
  reads,
}: {
  title: string
  state: UpstreamState
  /** The BFF route this view will read — shown only in the configured case, where it is
   *  the actionable next step rather than a claim about what does or does not exist. */
  reads: string
}) {
  return (
    <Card>
      <CardHeader>{title}</CardHeader>
      <div className="px-gutter py-3 text-body text-muted">
        {state === 'loading' ? (
          'Checking…'
        ) : state === 'unconfigured' ? (
          notConfiguredCopy('Track')
        ) : state === 'error' ? (
          'The Track proxy answered with an error — nothing is shown rather than something stale or invented.'
        ) : (
          <>
            Track is configured on this deployment, but this view does not read it yet — so
            nothing is shown here rather than a stand-in.{' '}
            <span className="font-mono text-caption">{reads}</span> is the read it needs.
          </>
        )}
      </div>
    </Card>
  )
}
