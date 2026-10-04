import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, focusRing, inlineLink } from '@talyvor/ui'
import { useState } from 'react'
import { Region, RegionScreen } from '../../components/Region'
import { ApiError, getJSONArray } from '../../lib/api'
import { isSessionExpired, isUnconfigured } from '../../lib/productState'
import { BoardColumns } from './BoardColumns'
import { asList } from './data'
import { UpstreamCard } from './UpstreamCard'
import type { TrackBoardLink, TrackIssue, TrackProject } from './types'

// B27.30 — the board: every issue in a column for where it stands, and the switch that publishes
// it as a read-only link anyone can open signed out (/board/{token}). The cards are issue links,
// so the keys work here as on the list: j/k to a card, s to move it, a to assign, x to close.

/** The most a board reads in one request — the BFF's own cap on a list page. */
const BOARD_LIMIT = 250

async function boardIssues(): Promise<TrackIssue[]> {
  const path = `/api/track/issues?order_by=updated_at&order_dir=desc&limit=${BOARD_LIMIT}`
  const res = await fetch(path, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new ApiError(res.status, '/api/track/issues')
  const body: unknown = await res.json()
  return Array.isArray(body) ? (body as TrackIssue[]) : []
}

/** The address a stranger opens. */
export function boardURL(token: string): string {
  return `${window.location.origin}/board/${token}`
}

export function Board() {
  const qc = useQueryClient()
  const issues = useQuery({ queryKey: ['track', 'issues', 'board'], queryFn: boardIssues, retry: false })
  const links = useQuery({
    queryKey: ['track', 'boards'],
    queryFn: () => getJSONArray<TrackBoardLink>('/api/track/boards'),
    retry: false,
  })
  const projects = useQuery({
    queryKey: ['track', 'projects'],
    queryFn: () => getJSONArray<TrackProject>('/api/track/projects'),
  })
  const [scope, setScope] = useState('all')

  const publish = useMutation({
    mutationFn: async (projectID: string) => {
      const res = await fetch('/api/track/boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(projectID === 'all' ? {} : { project_id: projectID }),
      })
      if (!res.ok) throw new ApiError(res.status, '/api/track/boards')
      return (await res.json()) as TrackBoardLink
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['track', 'boards'] }),
  })
  const turnOff = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/track/boards/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) throw new ApiError(res.status, `/api/track/boards/${id}`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['track', 'boards'] }),
  })

  if (isUnconfigured(issues.error)) {
    return <UpstreamCard title="Board" state="unconfigured" reads="GET /api/track/issues" />
  }
  const rows = issues.data ?? []
  const projectName = (id?: string) =>
    id ? (asList(projects.data).find((p) => p.id === id)?.name ?? 'One project') : 'Every issue'

  return (
    <RegionScreen>
      <Region
        index="00"
        label="Board"
        heading="Every issue, by where it stands."
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="max-w-none"
      >
        {issues.isLoading ? (
          <p className="text-caption text-muted">Loading the board…</p>
        ) : isSessionExpired(issues.error) ? (
          <p className="text-caption text-muted">Unavailable.</p>
        ) : issues.isError ? (
          <p className="text-caption text-muted">
            Couldn’t reach Track, so the board can’t be drawn. This is a fault, not an empty tracker.
          </p>
        ) : (
          <>
            <BoardColumns
              cards={rows.map((it) => ({
                identifier: it.identifier,
                title: it.title,
                status: it.status,
                priority: it.priority,
                issueId: it.id,
              }))}
            />
            <p className="mt-4 text-caption text-muted">
              Keys: <kbd className="font-mono">j</kbd> <kbd className="font-mono">k</kbd> next and previous ·{' '}
              <kbd className="font-mono">s</kbd> move · <kbd className="font-mono">a</kbd> assign ·{' '}
              <kbd className="font-mono">x</kbd> close
              {rows.length === BOARD_LIMIT ? ` · showing the ${BOARD_LIMIT} most recently updated` : ''}
            </p>
          </>
        )}
      </Region>

      <Region index="01" label="Share it read-only">
        <p className="max-w-2xl text-body text-muted">
          A board link opens this board for anyone who has it, without signing in. They see each
          issue’s reference, title, status and priority — nothing else, and they cannot change
          anything. Turn a link off and it stops working at once.
        </p>
        <div className="mt-6 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-caption text-muted">What the link shows</span>
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger aria-label="What the link shows" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Every issue</SelectItem>
                {asList(projects.data).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <Button variant="primary" disabled={publish.isPending} onClick={() => publish.mutate(scope)}>
            {publish.isPending ? 'Publishing…' : 'Publish a board link'}
          </Button>
        </div>
        {publish.isError ? (
          <p className="mt-4 text-caption text-muted" role="status">
            {publish.error instanceof ApiError && publish.error.status === 403
              ? 'Only a workspace owner can publish a board — nothing was published.'
              : 'Couldn’t publish the board — nothing was published. Try again.'}
          </p>
        ) : null}

        <div className="mt-8 flex flex-col gap-3">
          {links.isLoading ? (
            <p className="text-caption text-muted">Reading this workspace’s board links…</p>
          ) : links.isError ? (
            <p className="text-caption text-muted">Couldn’t read this workspace’s board links.</p>
          ) : asList(links.data).length === 0 ? (
            <p className="text-caption text-muted">
              No board links are on, so nothing in this workspace is public. Pick what a link shows
              above and publish one to share the board read-only.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {asList(links.data).map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-3 border-t border-rule pt-3">
                  <span className="text-body text-ink">{projectName(l.project_id)}</span>
                  <input
                    readOnly
                    aria-label={`Board link for ${projectName(l.project_id)}`}
                    value={boardURL(l.token)}
                    onFocus={(e) => e.currentTarget.select()}
                    className={`min-w-0 flex-1 rounded-control border border-rule bg-canvas px-2 py-1 font-mono text-caption text-ink transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
                  />
                  <a className={`text-caption ${inlineLink}`} href={`/board/${l.token}`} target="_blank" rel="noreferrer">
                    Open
                  </a>
                  <Button disabled={turnOff.isPending} onClick={() => turnOff.mutate(l.id)}>
                    Turn off
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {turnOff.isError ? (
            <p className="text-caption text-muted" role="status">
              {turnOff.error instanceof ApiError && turnOff.error.status === 403
                ? 'Only a workspace owner can turn a board link off — it is still on.'
                : 'Couldn’t turn that link off — it is still on. Try again.'}
            </p>
          ) : null}
        </div>
      </Region>
    </RegionScreen>
  )
}
