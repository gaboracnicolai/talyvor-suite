import { useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Card, CardHeader, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@talyvor/ui'
import { IssueDetail } from './IssueDetail'
import { IssueList } from './IssueList'
import { useTrackWorkspaces } from './data'

// The Track area root. App.tsx mounts this under /track/* (wildcard), so ALL Track
// sub-routing lives here — the area owns its URL space, per the ownership contract.
//
//   /track                  → the issue list (the core screen)
//   /track/issues/:issueId  → read-only issue detail
//
// The workspace strip at the top is the area's ONE live read (/api/track/workspaces —
// the only Track route the BFF proxies today, membership-scoped upstream). Everything
// below it is fixture-backed and says so per-card; see data.ts and the PR's BFF gap
// list. The strip is deliberately un-badged: the contrast between the live strip and
// the badged cards is itself the honest signal of where the seam is.

function WorkspaceStrip() {
  const q = useTrackWorkspaces()
  const [selected, setSelected] = useState<string | null>(null)

  if (q.isLoading) {
    return <div className="px-gutter py-2 text-body text-muted">Loading workspaces…</div>
  }
  if (q.isError || !q.data) {
    // A dead upstream is a fault to name, not to dress up: the BFF proxies Track only
    // when TRACK_BASE_URL + TRACK_GATEWAY_SECRET are both set (apps/bff/main.go
    // fail-closed pairing). Say so, keep the fixtures below usable.
    return (
      <Card>
        <CardHeader>Track upstream unreachable</CardHeader>
        <p className="px-gutter py-3 text-body text-muted">
          /api/track/workspaces did not answer. If this BFF should serve Track, set both
          TRACK_BASE_URL and TRACK_GATEWAY_SECRET on it (they fail closed as a pair). The
          screens below run on marked fixtures either way.
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
        <span className="text-caption uppercase tracking-wide text-faint">Workspace</span>
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
        <Route path="issues/:issueId" element={<IssueDetail />} />
        {/* Anything else under /track/* is this area's to answer: fall back to the list. */}
        <Route path="*" element={<IssueList />} />
      </Routes>
    </div>
  )
}
