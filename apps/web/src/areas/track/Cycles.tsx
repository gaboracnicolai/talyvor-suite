import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@talyvor/ui'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Region, RegionScreen } from '../../components/Region'
import { ApiError, getJSONArray } from '../../lib/api'
import { isSessionExpired, isUnconfigured } from '../../lib/productState'
import { asList } from './data'
import { formatCost } from './format'
import { StatusPill } from './StatusPill'
import type { TrackCycle, TrackCycleProgress, TrackIssue, TrackTeam } from './types'

// CYCLES — B4.1. Start a cycle for a team, put issues in it, see how far it has got.
//
// Everything here is Track's: the cycles and their progress are talyvor-track's cycle routes
// (apps/bff/track_cycles.go), and putting an issue in a cycle is the ordinary issue PATCH with a
// `cycle_id`. Progress is Track's own aggregate — its status buckets and the SUM of the issues'
// AI cost — so this screen does no counting of its own that could disagree with it.

const DAY = 24 * 60 * 60 * 1000

/** A date input's value (local calendar day) for `d`. */
function dayValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** "12 Oct" — a cycle's dates are calendar days, so they are shown in UTC, as they were sent. */
function shortDay(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

async function readJSON<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new ApiError(res.status, path)
  return (await res.json()) as T
}

const cyclesPath = (teamId: string) => `/api/track/teams/${encodeURIComponent(teamId)}/cycles`

async function createCycle(teamId: string, name: string, startDay: string, endDay: string): Promise<void> {
  const path = cyclesPath(teamId)
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ name, start_date: `${startDay}T00:00:00Z`, end_date: `${endDay}T00:00:00Z` }),
  })
  if (!res.ok) throw new ApiError(res.status, path)
}

/** Putting an issue in a cycle is the ordinary issue PATCH with a `cycle_id`. */
async function addToCycle(issueId: string, cycleId: string): Promise<void> {
  const path = `/api/track/issues/${encodeURIComponent(issueId)}`
  const res = await fetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ cycle_id: cycleId }),
  })
  if (!res.ok) throw new ApiError(res.status, path)
}

export function Cycles() {
  const teams = useQuery({ queryKey: ['track', 'teams'], queryFn: () => getJSONArray<TrackTeam>('/api/track/teams') })
  const [chosen, setChosen] = useState<string | null>(null)
  const teamId = chosen ?? teams.data?.[0]?.id ?? ''

  const cycles = useQuery({
    queryKey: ['track', 'cycles', teamId],
    queryFn: () => readJSON<TrackCycle[] | null>(cyclesPath(teamId)),
    enabled: teamId !== '',
  })
  const list = [...asList(cycles.data)].sort((a, b) => b.number - a.number)

  const qc = useQueryClient()
  const today = new Date()
  const [name, setName] = useState('')
  const [starts, setStarts] = useState(dayValue(today))
  const [ends, setEnds] = useState(dayValue(new Date(today.getTime() + 14 * DAY)))
  const create = useMutation({
    mutationFn: () => createCycle(teamId, name.trim(), starts, ends),
    onSuccess: async () => {
      setName('')
      await qc.invalidateQueries({ queryKey: ['track', 'cycles', teamId] })
    },
  })
  const datesOk = starts !== '' && ends !== '' && ends > starts

  const unavailable = isUnconfigured(teams.error) || isSessionExpired(teams.error)

  return (
    <RegionScreen>
      <Region index="00" label="Cycles" heading="Cycles" sectionClassName="pb-10 pt-4 wide:pb-12">
        <p className="max-w-2xl text-body text-muted">
          A cycle is a stretch of time a team commits issues to. Start one, put issues in it, and
          watch it fill in as they close.
        </p>
        <p className="mt-4">
          <Link className="text-body underline" to="/track">
            Back to all issues
          </Link>
        </p>
      </Region>

      {teams.isError ? (
        <Region index="01" label="Teams">
          <p className="max-w-2xl text-body text-muted">
            {unavailable
              ? 'Track is not reachable from this session, so there are no teams to plan for.'
              : 'Couldn’t read this workspace’s teams from Track. This is a fault, not an empty workspace.'}
          </p>
        </Region>
      ) : teams.isPending ? (
        <Region index="01" label="Teams">
          <p className="text-body text-muted">Reading teams from Track…</p>
        </Region>
      ) : asList(teams.data).length === 0 ? (
        <Region index="01" label="Teams">
          <p className="max-w-2xl text-body text-muted">
            This Track workspace has no teams yet, and cycles belong to a team. Create a team in
            Track, then come back to plan its first cycle.
          </p>
        </Region>
      ) : (
        <>
          <Region index="01" label="Start a cycle">
            {asList(teams.data).length > 1 ? (
              <div className="mb-4 flex items-center gap-2">
                <span className="font-figure text-eyebrow uppercase text-muted">Team</span>
                <Select value={teamId} onValueChange={setChosen}>
                  <SelectTrigger aria-label="Team" className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {asList(teams.data).map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <form
              className="flex max-w-3xl flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                if (name.trim() !== '' && datesOk && !create.isPending) create.mutate()
              }}
            >
              <label className="flex min-w-48 flex-1 flex-col gap-1">
                <span className="font-figure text-eyebrow uppercase text-muted">Name</span>
                <Input id="cycle-name" value={name} placeholder="Sprint 12" onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-figure text-eyebrow uppercase text-muted">Starts</span>
                <Input type="date" className="font-figure" value={starts} onChange={(e) => setStarts(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-figure text-eyebrow uppercase text-muted">Ends</span>
                <Input type="date" className="font-figure" value={ends} onChange={(e) => setEnds(e.target.value)} />
              </label>
              <Button type="submit" variant="primary" disabled={create.isPending || name.trim() === '' || !datesOk}>
                {create.isPending ? 'Starting…' : 'Start cycle'}
              </Button>
            </form>
            {!datesOk ? (
              <p className="mt-2 text-caption text-muted">A cycle has to end after it starts.</p>
            ) : null}
            {create.isError ? (
              <p className="mt-2 text-caption text-ink" role="alert">
                Track refused that cycle, so none was created. Check the name and dates and try again.
              </p>
            ) : null}
          </Region>

          <Region index="02" label="This team’s cycles">
            {cycles.isError ? (
              <p className="max-w-2xl text-body text-muted">
                Couldn’t read this team’s cycles from Track. This is a fault, not a team with no cycles.
              </p>
            ) : cycles.isPending ? (
              <p className="text-body text-muted">Reading cycles from Track…</p>
            ) : list.length === 0 ? (
              <div className="flex flex-col items-start gap-3">
                <p className="max-w-2xl text-body text-muted">
                  No cycles yet. Name one above and start it — then put this team’s issues in it.
                </p>
                {/* B3.4 — the empty state goes where it points: the caret lands in Name. */}
                <Button variant="primary" onClick={() => document.getElementById('cycle-name')?.focus()}>
                  Start the first cycle
                </Button>
              </div>
            ) : (
              <ul className="flex flex-col gap-4">
                {list.map((c) => (
                  <li key={c.id}>
                    <CycleCard cycle={c} />
                  </li>
                ))}
              </ul>
            )}
          </Region>
        </>
      )}
    </RegionScreen>
  )
}

function CycleCard({ cycle }: { cycle: TrackCycle }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const progress = useQuery({
    queryKey: ['track', 'cycle-progress', cycle.id],
    queryFn: () =>
      readJSON<TrackCycleProgress>(
        `${cyclesPath(cycle.team_id)}/${encodeURIComponent(cycle.id)}/progress`,
      ),
  })
  const inCycle = useQuery({
    queryKey: ['track', 'cycle-issues', cycle.id],
    queryFn: () =>
      readJSON<TrackIssue[] | null>(
        `/api/track/issues?cycle_id=${encodeURIComponent(cycle.id)}&order_by=updated_at&order_dir=desc&limit=100`,
      ),
    enabled: open,
  })
  const candidates = useQuery({
    queryKey: ['track', 'cycle-candidates', cycle.team_id],
    queryFn: () =>
      readJSON<TrackIssue[] | null>(
        `/api/track/issues?team_id=${encodeURIComponent(cycle.team_id)}&order_by=updated_at&order_dir=desc&limit=100`,
      ),
    enabled: open,
  })
  const add = useMutation({
    mutationFn: (issueId: string) => addToCycle(issueId, cycle.id),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['track', 'cycle-progress', cycle.id] }),
        qc.invalidateQueries({ queryKey: ['track', 'cycle-issues', cycle.id] }),
        qc.invalidateQueries({ queryKey: ['track', 'cycle-candidates', cycle.team_id] }),
      ])
    },
  })

  const p = progress.data
  const pct = p === undefined ? 0 : Math.max(0, Math.min(100, p.completion_pct))
  const unplanned = asList(candidates.data).filter(
    (i) => !i.cycle_id && i.status !== 'done' && i.status !== 'cancelled',
  )

  return (
    <div className="rounded-control border border-rule bg-surface px-gutter py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="font-figure text-eyebrow uppercase text-faint">Cycle {cycle.number}</span>
          <p className="text-title text-ink">{cycle.name}</p>
          <p className="font-figure text-caption text-muted">
            {shortDay(cycle.start_date)} – {shortDay(cycle.end_date)} · {cycle.status}
          </p>
        </div>
        <Button onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'Close' : 'Open'}
        </Button>
      </div>

      <div className="mt-4" data-testid="cycle-progress">
        {progress.isError ? (
          <p className="text-caption text-muted">Couldn’t read this cycle’s progress from Track.</p>
        ) : p === undefined ? (
          <p className="text-caption text-muted">Reading progress…</p>
        ) : p.total_issues === 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-caption text-muted">
              No issues in this cycle yet{open ? ' — add them from this team’s list below.' : '.'}
            </p>
            {open ? null : <Button onClick={() => setOpen(true)}>Add issues</Button>}
          </div>
        ) : (
          <>
            <div
              className="h-1.5 w-full overflow-hidden rounded-pill bg-rule"
              role="progressbar"
              aria-label={`${cycle.name} progress`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(pct)}
            >
              <div className="h-full rounded-pill bg-accent transition-all duration-200" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-2 font-figure text-caption text-muted">
              {p.completed} of {p.total_issues} done · {Math.round(pct)}% · {p.in_progress} in progress ·{' '}
              {p.not_started} not started · AI {formatCost(p.total_ai_cost_usd)}
            </p>
          </>
        )}
      </div>

      {open ? (
        <div className="mt-4 flex flex-col gap-4 border-t border-rule pt-4">
          <div>
            <span className="font-figure text-eyebrow uppercase text-muted">In this cycle</span>
            {inCycle.isError ? (
              <p className="mt-2 text-caption text-muted">Couldn’t read this cycle’s issues from Track.</p>
            ) : inCycle.isPending ? (
              <p className="mt-2 text-caption text-muted">Reading…</p>
            ) : asList(inCycle.data).length === 0 ? (
              <p className="mt-2 text-caption text-muted">Nothing in it yet — add issues from the list below.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1">
                {asList(inCycle.data).map((i) => (
                  <li key={i.id} className="flex items-center gap-2">
                    <StatusPill status={i.status} />
                    <Link className="text-body text-ink underline" to={`/track/issues/${encodeURIComponent(i.id)}`}>
                      {i.title}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <span className="font-figure text-eyebrow uppercase text-muted">Add from this team</span>
            {candidates.isError ? (
              <p className="mt-2 text-caption text-muted">Couldn’t read this team’s issues from Track.</p>
            ) : candidates.isPending ? (
              <p className="mt-2 text-caption text-muted">Reading…</p>
            ) : unplanned.length === 0 ? (
              <p className="mt-2 text-caption text-muted">
                Every open issue in this team is already in a cycle.{' '}
                <Link className="underline" to="/track">
                  File a new issue
                </Link>{' '}
                to plan more.
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1">
                {unplanned.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <StatusPill status={i.status} />
                      <span className="truncate text-body text-ink">{i.title}</span>
                    </span>
                    <Button disabled={add.isPending} onClick={() => add.mutate(i.id)}>
                      Add to cycle
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {add.isError ? (
              <p className="mt-2 text-caption text-ink" role="alert">
                Track refused that change, so the issue was not added.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
