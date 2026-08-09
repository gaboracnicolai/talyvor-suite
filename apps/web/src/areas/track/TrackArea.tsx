import { useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Card, CardHeader, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@talyvor/ui'
import { IssueDetail } from './IssueDetail'
import { IssueList } from './IssueList'
import { useTrackWorkspaces } from './data'
import { isUnconfigured } from '../../lib/productState'
import { isSessionExpired } from '../../lib/productState'

// The Track area root. App.tsx mounts this under /track/* (wildcard), so ALL Track
// sub-routing lives here — the area owns its URL space, per the ownership contract.
//
//   /track  → the issues view
//
// The /track/issues/:issueId route is GONE with the fixture it read. A detail screen whose
// only data source was four invented comments is a dead route, not a placeholder; it returns
// with the live wiring.
//
// The workspace strip is a live read (/api/track/workspaces, membership-scoped upstream).
// Below it, the issues view PROBES its route and reports what this deployment answers — see
// data.ts for why the fourteen fixture issues were deleted rather than re-badged.

function WorkspaceStrip() {
  const q = useTrackWorkspaces()
  const [selected, setSelected] = useState<string | null>(null)

  if (q.isLoading) {
    return <div className="px-gutter py-2 text-body text-muted">Loading workspaces…</div>
  }
  if (q.isError || !q.data) {
    // Three states, matching Docs' SpaceList exactly: a 503 is the BFF's proxyProduct
    // saying "upstream not configured on this BFF", and a 404 is a BFF built before the
    // Track routes — both are INFORMATION, not faults (the same reading Overview's product
    // probe uses, and the shared rule in lib/productState). Everything else is a real
    // failure, named as such without claiming to know why.
    //
    // Both messages used to end by promising "a design preview on marked sample data" below.
    // There is no sample data below any more, so the promise is gone with it.
    return isUnconfigured(q.error) ? (
      <Card>
        <CardHeader>Track is not configured on this deployment</CardHeader>
        <p className="px-gutter py-3 text-body text-muted">
          The BFF has no Track upstream wired (its TRACK_* trio is unset) — off, not broken.
        </p>
      </Card>
    ) : isSessionExpired(q.error) ? (
      // The bar at the top of the app already says what happened and offers the fix; this card
      // must not add a second, differently-worded diagnosis of the same one cause.
      <Card>
        <CardHeader>Track</CardHeader>
        <p className="px-gutter py-3 text-body text-muted">Unavailable.</p>
      </Card>
    ) : (
      <Card>
        <CardHeader>Couldn’t load workspaces</CardHeader>
        <p className="px-gutter py-3 text-body text-muted">
          The Track proxy answered with an error — nothing is shown rather than something stale.
        </p>
      </Card>
    )
  }
  if (q.data.length === 0) {
    return <div className="px-gutter py-2 text-body text-muted">No Track workspaces for this identity.</div>
  }

  const current = selected ?? q.data[0].id
  return (
    <div className="flex items-center justify-between gap-gutter">
      <div className="flex items-center gap-2">
        <span className="font-figure text-eyebrow uppercase text-faint">Workspace</span>
        {q.data.length === 1 ? (
          <span className="text-body text-ink">{q.data[0].name}</span>
        ) : (
          <Select value={current} onValueChange={setSelected}>
            <SelectTrigger aria-label="Workspace" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {q.data.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <span className="text-caption text-faint">live · membership-scoped</span>
    </div>
  )
}

export function TrackArea() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-gutter px-gutter py-4">
      <WorkspaceStrip />
      <Routes>
        <Route index element={<IssueList />} />
        {/* The ticket. Restored: this route was retired while the detail screen did not exist,
            which left the suite able to LIST issues and unable to open one. */}
        <Route path="issues/:id" element={<IssueDetail />} />
        {/* Anything else under /track/* is this area's to answer: fall back to the list, so an
            old or mistyped link lands somewhere real rather than on a dead end. */}
        <Route path="*" element={<IssueList />} />
      </Routes>
    </div>
  )
}
