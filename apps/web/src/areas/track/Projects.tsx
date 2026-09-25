import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@talyvor/ui'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Region, RegionScreen } from '../../components/Region'
import { ApiError, getJSONArray } from '../../lib/api'
import { isSessionExpired, isUnconfigured } from '../../lib/productState'
import { asList, teamIdentifier } from './data'
import type { TrackProject, TrackTeam } from './types'

// PROJECTS — B4.2. Start a project, put issues in it, see the list of just its issues.
//
// Projects are talyvor-track's (apps/bff/track_projects.go). Putting an issue in one is the issue
// PATCH with a `project_id` (the Project picker on an issue), and "its issues" is the issue list's
// own `project_id` filter — each project here links to /track?project=<id>.

/** A suggested identifier: the name's initials, or its first letters, upper-cased — editable. */
export function suggestIdentifier(name: string): string {
  const words = name.toUpperCase().match(/[A-Z0-9]+/g) ?? []
  const initials = words.map((w) => w.charAt(0)).join('')
  return (initials.length >= 2 ? initials : (words[0] ?? '')).slice(0, 4)
}

async function createProject(p: { team_id: string; name: string; identifier: string; description: string }) {
  const res = await fetch('/api/track/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ team_id: p.team_id, name: p.name, identifier: p.identifier, description: p.description }),
  })
  if (!res.ok) throw new ApiError(res.status, '/api/track/projects')
}

export function Projects() {
  const qc = useQueryClient()
  const teams = useQuery({ queryKey: ['track', 'teams'], queryFn: () => getJSONArray<TrackTeam>('/api/track/teams') })
  const projects = useQuery({
    queryKey: ['track', 'projects'],
    queryFn: () => getJSONArray<TrackProject>('/api/track/projects'),
  })
  const [chosen, setChosen] = useState<string | null>(null)
  const teamId = chosen ?? teams.data?.[0]?.id ?? ''
  const [name, setName] = useState('')
  const [identifier, setIdentifier] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const ident = identifier ?? suggestIdentifier(name)

  const create = useMutation({
    mutationFn: () => createProject({ team_id: teamId, name: name.trim(), identifier: ident.trim(), description }),
    onSuccess: async () => {
      setName('')
      setIdentifier(null)
      setDescription('')
      await qc.invalidateQueries({ queryKey: ['track', 'projects'] })
    },
  })
  const ready = teamId !== '' && name.trim() !== '' && ident.trim() !== ''
  const unavailable = isUnconfigured(projects.error) || isSessionExpired(projects.error)
  const list = [...asList(projects.data)].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <RegionScreen>
      <Region index="00" label="Projects" heading="Projects" sectionClassName="pb-10 pt-4 wide:pb-12">
        <p className="max-w-2xl text-body text-muted">
          A project gathers the issues for one piece of work. Start one here, put issues in it from
          an issue&rsquo;s page, and open it to see just its issues.
        </p>
        <p className="mt-4">
          <Link className="text-body underline" to="/track">
            Back to all issues
          </Link>
        </p>
      </Region>

      <Region index="01" label="Start a project">
        {teams.isError ? (
          <p className="max-w-2xl text-body text-muted">
            Couldn&rsquo;t read this workspace&rsquo;s teams from Track, and a project belongs to a team.
          </p>
        ) : teams.isPending ? (
          <p className="text-body text-muted">Reading teams from Track…</p>
        ) : (teams.data ?? []).length === 0 ? (
          <p className="max-w-2xl text-body text-muted">
            This Track workspace has no teams yet, and a project belongs to a team. Create a team in
            Track first.
          </p>
        ) : (
          <form
            className="flex max-w-3xl flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (ready && !create.isPending) create.mutate()
            }}
          >
            <div className="flex flex-wrap items-end gap-3">
              {(teams.data ?? []).length > 1 ? (
                <label className="flex flex-col gap-1">
                  <span className="font-figure text-eyebrow uppercase text-muted">Team</span>
                  <Select value={teamId} onValueChange={setChosen}>
                    <SelectTrigger aria-label="Team" className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(teams.data ?? []).map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              ) : null}
              <label className="flex min-w-48 flex-1 flex-col gap-1">
                <span className="font-figure text-eyebrow uppercase text-muted">Name</span>
                <Input id="project-name" value={name} placeholder="Billing v2" onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="flex w-32 flex-col gap-1">
                <span className="font-figure text-eyebrow uppercase text-muted">Identifier</span>
                <Input className="font-figure" value={ident} onChange={(e) => setIdentifier(e.target.value.toUpperCase())} />
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="font-figure text-eyebrow uppercase text-muted">Description (optional)</span>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
            <div>
              <Button type="submit" variant="primary" disabled={!ready || create.isPending}>
                {create.isPending ? 'Starting…' : 'Start project'}
              </Button>
            </div>
            {create.isError ? (
              <p className="text-caption text-ink" role="alert">
                Track refused that project, so none was created — an identifier already in use is the
                usual reason. Change it and try again.
              </p>
            ) : null}
          </form>
        )}
      </Region>

      <Region index="02" label="This workspace’s projects">
        {projects.isError ? (
          <p className="max-w-2xl text-body text-muted">
            {unavailable
              ? 'Track is not reachable from this session, so there are no projects to show.'
              : 'Couldn’t read projects from Track. This is a fault, not a workspace with no projects.'}
          </p>
        ) : projects.isPending ? (
          <p className="text-body text-muted">Reading projects from Track…</p>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-start gap-3">
            <p className="max-w-2xl text-body text-muted">
              No projects yet. Name one above and start it — then put issues in it from their pages.
            </p>
            {/* B3.4 — the empty state goes where it points: the caret lands in Name. */}
            <Button variant="primary" onClick={() => document.getElementById('project-name')?.focus()}>
              Start the first project
            </Button>
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-rule border-y border-rule">
            {list.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-body text-ink">
                    <span className="font-figure text-caption text-muted">{p.identifier}</span> {p.name}
                  </p>
                  {p.description !== '' ? <p className="text-caption text-muted">{p.description}</p> : null}
                  <p className="text-caption text-faint">
                    {teamIdentifier(teams.data ?? [], p.team_id)} · {p.status}
                  </p>
                </div>
                <Link className="text-body underline" to={`/track?project=${encodeURIComponent(p.id)}`}>
                  Its issues
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Region>
    </RegionScreen>
  )
}
