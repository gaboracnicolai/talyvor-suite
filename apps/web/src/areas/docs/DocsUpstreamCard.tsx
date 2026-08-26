import { Card, CardHeader } from '@talyvor/ui'
import { useQuery } from '@tanstack/react-query'
import { ApiError } from '../../lib/api'
import { isUnconfigured, notConfiguredCopy } from '../../lib/productState'

// The card the Docs area draws for a read it cannot serve — replacing seven fabricated pages
// and their view counts.
//
// Every sentence below requires a RESPONSE. The footnote this replaces said "the BFF serves
// only /api/docs/spaces today" while the BFF served four Docs routes; that claim could not be
// checked, so it rotted. This one cannot outlive its truth: when a Docs upstream appears, the
// probe answers 200 and the copy changes with no edit here.
// NO SESSION-EXPIRED BRANCH HERE, DELIBERATELY. One was added and then removed: this card is
// rendered ONLY inside `if (isUnconfigured(…))` — that is, only when Docs is unconfigured (503).
// A 401 never reaches it, so the branch was unreachable code that read as coverage. It was caught
// by neutralising each session branch in turn and checking SessionExpired.test.tsx went red: this
// was the one file whose removal changed nothing, anywhere.
//
// ⚠ THE SENTENCE ABOVE NAMED TWO CALLERS — "rendered by SpaceView/PageView" — AND HAS NAMED ONE
// TOO MANY SINCE W1.1.9b. The page reader dropped this card when its rebuilt headline began
// carrying the OFF state itself: a heading reading "Docs is not configured here." beside a card
// free to answer "Docs IS configured on this deployment" is two claims about ONE probe, and
// W1.1.9a had already named that drift. `SpaceView` is the only caller now, and the guarantee is
// unchanged rather than weakened — it still renders this only under `isUnconfigured`, so a 401
// still cannot arrive. Corrected in place, because a comment naming a caller it no longer has is
// how the next reader concludes a branch is reachable when it is not.
export function DocsUpstreamCard({ title, path, reads }: { title: string; path: string; reads: string }) {
  const q = useQuery({
    queryKey: ['docs-probe', path],
    queryFn: async () => {
      const res = await fetch(path, { headers: { Accept: 'application/json' } })
      if (!res.ok) throw new ApiError(res.status, path)
      return res.json() as Promise<unknown>
    },
    retry: false,
  })

  return (
    <Card>
      <CardHeader>{title}</CardHeader>
      <div className="px-gutter py-3 text-body text-muted">
        {q.isLoading ? (
          'Checking…'
        ) : isUnconfigured(q.error) ? (
          notConfiguredCopy('Docs')
        ) : q.isError ? (
          'The Docs proxy answered with an error — nothing is shown rather than something stale or invented.'
        ) : (
          <>
            Docs is configured on this deployment, but this view does not read it yet — so
            nothing is shown here rather than a stand-in.{' '}
            <span className="font-mono text-caption">{reads}</span> is the read it needs.
          </>
        )}
      </div>
    </Card>
  )
}
