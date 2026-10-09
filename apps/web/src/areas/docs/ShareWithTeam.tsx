import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, cn, focusRing } from '@talyvor/ui'
import { useState } from 'react'

import { ApiError, getJSONArray } from '../../lib/api'
import type { TrackMember } from '../track/types'
import { type DocsGrant, type DocsTeam, type TeamAccess, docsApi } from './api'

const field = cn(
  'min-w-0 max-w-full rounded-control border border-rule bg-canvas px-2 py-1 text-caption text-ink placeholder:text-faint transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50',
  focusRing,
)

const status = (e: unknown): number | undefined => (e instanceof ApiError ? e.status : undefined)

/** B28.450 — share this page with a team: everyone on it gets the access, and taking someone off takes it away. */
export function ShareWithTeam({ spaceId, pageId }: { spaceId: string; pageId: string }) {
  const [open, setOpen] = useState(false)
  if (open) return <TeamsPanel spaceId={spaceId} pageId={pageId} />
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className={cn('rounded-control px-2 py-1 text-caption text-muted transition-colors duration-200 hover:text-ink', focusRing)}
    >
      Share with a team
    </button>
  )
}

function TeamsPanel({ spaceId, pageId }: { spaceId: string; pageId: string }) {
  const qc = useQueryClient()
  const teams = useQuery({ queryKey: ['docs-teams'], queryFn: docsApi.teams })
  const roster = useQuery({ queryKey: ['members'], queryFn: () => getJSONArray<TrackMember>('/api/members'), staleTime: 60_000 })
  const grants = useQuery({ queryKey: ['docs-grants', spaceId, pageId], queryFn: () => docsApi.pageGrants(spaceId, pageId) })
  const [name, setName] = useState('')
  const create = useMutation({
    mutationFn: (n: string) => docsApi.createTeam(n),
    onSuccess: async () => {
      setName('')
      await qc.invalidateQueries({ queryKey: ['docs-teams'] })
    },
  })
  return (
    <section aria-label="Share with a team" className="flex min-w-0 basis-full flex-col gap-3 rounded-control border border-rule p-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim() !== '' && !create.isPending) create.mutate(name.trim())
        }}
      >
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-caption text-muted">Team name</span>
          <input
            className={cn(
              'rounded-control border border-rule bg-canvas px-2 py-1 text-caption text-ink placeholder:text-faint transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50',
              focusRing,
            )}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Design"
          />
        </label>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create team'}
        </Button>
      </form>
      {create.isError ? (
        <p role="alert" className="text-caption text-ink">
          {status(create.error) === 409 ? 'There is already a team with that name.' : 'The team wasn’t made — try again.'}
        </p>
      ) : null}
      {teams.isError ? (
        <p role="alert" className="text-caption text-ink">
          Teams can’t be read right now.
        </p>
      ) : teams.data?.length === 0 ? (
        <p className="text-caption text-muted">No teams yet. Create one above, add people to it, then give it access to this page.</p>
      ) : null}
      <ul className="flex flex-col gap-3">
        {(teams.data ?? []).map((t) => (
          <TeamRow
            key={t.id}
            team={t}
            spaceId={spaceId}
            pageId={pageId}
            roster={roster.data ?? []}
            grant={(grants.data ?? []).filter((g) => g.subject_type === 'team' && g.subject_id === t.id).at(-1)}
          />
        ))}
      </ul>
    </section>
  )
}

function TeamRow({ team, spaceId, pageId, roster, grant }: {
  team: DocsTeam
  spaceId: string
  pageId: string
  roster: TrackMember[]
  grant: DocsGrant | undefined
}) {
  const qc = useQueryClient()
  const [memberId, setMemberId] = useState('')
  const [access, setAccess] = useState<TeamAccess>('edit')
  const member = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => docsApi.teamMember(team.id, id, on),
    onSuccess: async () => {
      setMemberId('')
      await qc.invalidateQueries({ queryKey: ['docs-teams'] })
    },
  })
  const give = useMutation({
    mutationFn: () => docsApi.grantTeam(spaceId, pageId, team.id, access),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['docs-grants', spaceId, pageId] }),
  })
  const emailOf = (id: string) => roster.find((m) => m.id === id)?.email ?? id
  const others = roster.filter((m) => !team.members.includes(m.id))
  return (
    <li className="flex flex-col gap-2 border-t border-rule pt-2">
      <p className="text-body text-ink">
        {team.name}{' '}
        <span className="text-caption text-muted">
          {grant !== undefined ? `can ${grant.access} this page` : 'has no access to this page yet'}
        </span>
      </p>
      <ul aria-label={`Who is on ${team.name}`} className="flex flex-col gap-1">
        {team.members.map((id) => (
          <li key={id} className="flex min-w-0 flex-wrap items-center gap-2 text-caption text-ink">
            <span className="min-w-0 break-all font-mono">{emailOf(id)}</span>
            {team.can_manage ? (
              <button
                type="button"
                disabled={member.isPending}
                onClick={() => member.mutate({ id, on: false })}
                className={cn('rounded-control px-1 text-caption text-muted transition-colors duration-200 hover:text-ink', focusRing)}
              >
                Remove<span className="sr-only"> {emailOf(id)} from {team.name}</span>
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {team.can_manage ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <select aria-label={`Add a member to ${team.name}`} className={field} value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            <option value="">Choose someone…</option>
            {others.map((m) => (
              <option key={m.id} value={m.id}>
                {m.email}
              </option>
            ))}
          </select>
          <Button type="button" disabled={memberId === '' || member.isPending} onClick={() => member.mutate({ id: memberId, on: true })}>
            Add<span className="sr-only"> to {team.name}</span>
          </Button>
        </div>
      ) : (
        <p className="text-caption text-muted">Only the person who made this team can change who is on it.</p>
      )}
      {member.isError ? (
        <p role="alert" className="text-caption text-ink">
          {status(member.error) === 400 ? 'They aren’t in Docs yet — add them on Members first.' : 'Who is on the team didn’t change — try again.'}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label={`Access for ${team.name}`} className={field} value={access} onChange={(e) => setAccess(e.target.value as TeamAccess)}>
          <option value="view">Can view</option>
          <option value="comment">Can comment</option>
          <option value="edit">Can edit</option>
        </select>
        <Button type="button" disabled={give.isPending} onClick={() => give.mutate()}>
          Give access<span className="sr-only"> to {team.name}</span>
        </Button>
      </div>
      {give.isError ? (
        <p role="alert" className="text-caption text-ink">
          {status(give.error) === 403 ? 'Only an admin of this page can share it.' : 'The access wasn’t given — try again.'}
        </p>
      ) : null}
    </li>
  )
}
