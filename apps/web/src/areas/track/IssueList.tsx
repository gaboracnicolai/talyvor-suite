import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, CardHeader } from '@talyvor/ui'
import { useState } from 'react'
import { ApiError } from '../../lib/api'
import { isUnconfigured } from '../../lib/productState'
import { isSessionExpired } from '../../lib/productState'
import { StatusPill } from './StatusPill'
import { UpstreamCard } from './UpstreamCard'
import { ISSUE_STATUSES, type IssueStatus, type TrackIssue } from './types'

// THE ISSUE LIST. It used to render fourteen FABRICATED issues — plausible titles, assignees, AI
// costs — behind a filter rail that could never query anything, all marked with a fixture badge.
// That was deleted, and this screen became a probe card: it asked /api/track/issues and reported
// whether the upstream answered, which told a tester the wiring was alive and gave them nothing to do.
//
// Now it is the real thing, and the rule from that deletion still holds: NOTHING HERE IS INVENTED.
// An empty tracker renders an empty state because the API returned [], not because a fixture said so.
// A brand-new workspace showing "No issues yet" is the CORRECT output, not a gap to paper over.
//
// Scope is deliberately small — list, create, change status. Not a tracker: no filter rail (its
// semantics stay unit-tested in data.ts for when it returns), no assignee picker, no priority, no
// comments. Enough that a tester is not looking at a locked door.
//
// WHOSE ISSUES: the BFF resolves the workspace from the SESSION, so this screen never names one.
// That claim is asserted in the BFF suite against the upstream path, not here — a form posting to
// the wrong tenant would look identical on this screen.

const ISSUES_KEY = ['track', 'issues'] as const

async function listIssues(): Promise<TrackIssue[]> {
  const res = await fetch('/api/track/issues', { headers: { Accept: 'application/json' } })
  // The SHARED ApiError, so isUnconfigured() classifies a Track read exactly as it classifies
  // every other product read — a local !res.ok check would lose the 503/5xx distinction.
  if (!res.ok) throw new ApiError(res.status, '/api/track/issues')
  const body: unknown = await res.json()
  // Track returns a BARE ARRAY, no envelope. A null body is an empty tracker, never a crash.
  return Array.isArray(body) ? (body as TrackIssue[]) : []
}

export function IssueList() {
  const qc = useQueryClient()
  const issues = useQuery({ queryKey: ISSUES_KEY, queryFn: listIssues, retry: false })
  const [title, setTitle] = useState('')

  // INVALIDATION IS THE POINT. A create that does not refetch leaves the tester looking at the list
  // they just added to, and the natural conclusion is that it failed. Both mutations invalidate the
  // one list key on success, so the row appears with no reload.
  const create = useMutation({
    mutationFn: async (t: string) => {
      const res = await fetch('/api/track/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ title: t }),
      })
      if (!res.ok) throw new Error(`create: ${res.status}`)
      return res.json()
    },
    onSuccess: async () => {
      setTitle('')
      await qc.invalidateQueries({ queryKey: ISSUES_KEY })
    },
  })

  const setStatus = useMutation({
    mutationFn: async (v: { id: string; status: IssueStatus }) => {
      // Track's Update decodes map[string]any, so a bare {"status":…} is a valid patch; the BFF
      // forwards it verbatim and the upstream rejects {} with EMPTY_UPDATE.
      const res = await fetch(`/api/track/issues/${encodeURIComponent(v.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ status: v.status }),
      })
      if (!res.ok) throw new Error(`status: ${res.status}`)
      return res.json()
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ISSUES_KEY })
    },
  })

  // THREE STATES THAT MUST NOT COLLAPSE INTO EACH OTHER, and the reason the shared classifier is
  // reused rather than a local !res.ok check: "Track is not deployed here" (503), "Track is broken"
  // (5xx), and "you have no issues yet" ([]) mean completely different things to a tester, and
  // laundering any of them into another tells them their work vanished or that a fault is normal.
  // The unconfigured case keeps its existing card verbatim.
  if (isUnconfigured(issues.error)) {
    return <UpstreamCard title="Issues" state="unconfigured" reads="GET /api/track/issues" />
  }

  const rows = issues.data ?? []

  return (
    <Card>
      <CardHeader>Issues</CardHeader>
      <div className="flex flex-col gap-4 px-gutter py-4">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const t = title.trim()
            // An empty title posts a blank issue Track would accept and nobody wants; refuse here
            // rather than create noise the tester then has to clean up.
            if (!t || create.isPending) return
            create.mutate(t)
          }}
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-caption text-muted">Title</span>
            <input
              className="w-full rounded border border-hairline bg-canvas px-2 py-1 text-body text-ink"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs doing?"
            />
          </label>
          <Button type="submit" variant="primary" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create issue'}
          </Button>
        </form>

        {create.isError ? (
          <p className="text-caption text-muted">
            Couldn’t create that issue — nothing was saved. Try again.
          </p>
        ) : null}

        {issues.isLoading ? (
          <p className="text-caption text-muted">Loading issues…</p>
        ) : isSessionExpired(issues.error) ? (
          <p className="text-caption text-muted">Unavailable.</p>
        ) : issues.isError ? (
          // A fault must not read as an empty tracker: those are different states and conflating
          // them tells a tester their work vanished.
          <p className="text-caption text-muted">
            Couldn’t reach Track, so no issues can be shown. This is a fault, not an empty tracker.
          </p>
        ) : rows.length === 0 ? (
          <p className="text-caption text-muted">
            No issues yet. Create the first one above — it lands in your own workspace.
          </p>
        ) : (
          <table className="w-full border-collapse text-body">
            <thead>
              <tr className="text-left text-caption text-muted">
                <th className="py-1 font-normal">Ref</th>
                <th className="py-1 font-normal">Title</th>
                <th className="py-1 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((it) => (
                <tr key={it.id} className="border-t border-hairline align-middle">
                  <td className="py-2 pr-3 font-mono text-caption text-muted">{it.identifier}</td>
                  <td className="py-2 pr-3 text-ink">{it.title}</td>
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      <StatusPill status={it.status} />
                      <select
                        aria-label={`Status for ${it.identifier}`}
                        className="rounded border border-hairline bg-canvas px-1 py-0.5 text-caption text-ink"
                        value={it.status}
                        disabled={setStatus.isPending}
                        onChange={(e) =>
                          setStatus.mutate({ id: it.id, status: e.target.value as IssueStatus })
                        }
                      >
                        {ISSUE_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s.replace('_', ' ')}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  )
}
