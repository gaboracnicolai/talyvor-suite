import { UpstreamCard } from './UpstreamCard'
import { useTrackProbe } from './data'

// THE ISSUE LIST. It used to render a dense table of fourteen fabricated issues — plausible
// titles, assignees, AI costs, six statuses — behind a URL-driven filter rail, all marked
// with a fixture badge.
//
// This deployment runs no Track (no TRACK_* variables, not in the compose stack), so there is
// no upstream those filters could ever query. Drawing them was drawing controls that cannot
// work, and the rows they filtered were invented. Both are gone.
//
// What is left asks /api/track/issues and reports the answer. The filter rail comes back with
// the live wiring, along with the table — filterIssues and the URL-param semantics are kept in
// data.ts for exactly that, and are still unit-tested.
export function IssueList() {
  const { state } = useTrackProbe('/api/track/issues')
  return <UpstreamCard title="Issues" state={state} reads="GET /api/track/issues" />
}
