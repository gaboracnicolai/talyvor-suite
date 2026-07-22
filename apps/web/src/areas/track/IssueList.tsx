import { Link, useSearchParams } from 'react-router-dom'
import { Button, Card, CardHeader, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@talyvor/ui'
import { FixtureBadge } from './FixtureBadge'
import { StatusPill } from './StatusPill'
import { memberName, teamIdentifier, useIssues, useMembers, useTeams } from './data'
import { formatWhen, statusLabel } from './format'
import { ISSUE_STATUSES, type TrackIssue } from './types'

// THE ISSUE LIST — Track's core screen. Dense, table-shaped, System-Settings idiom:
// hairline rules, 11–13px type, fixed ~30px rows, hue only in status dots. Density and
// scanning speed over decoration — this table is the product.
//
// Filters live in the URL (?status=&assignee_id=&team_id=), NOT component state, for
// three reasons: filtered views are shareable/bookmarkable links; back/forward walks
// filter history for free; and the param names are byte-identical to Track's own List
// query params (issue/handler.go), so these URLs translate 1:1 into the live query
// string when the BFF proxy lands. 'all' is a UI sentinel only — it never reaches the
// URL (the param is deleted), matching the server's absent-param semantics.

const ALL = 'all'

function useFilterParam(key: 'status' | 'assignee_id' | 'team_id'): [string, (v: string) => void] {
  const [params, setParams] = useSearchParams()
  const value = params.get(key) ?? ''
  const set = (v: string) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (v === ALL) next.delete(key)
        else next.set(key, v)
        return next
      },
      { replace: true },
    )
  }
  return [value, set]
}

function IssueRow({ issue, assignee, team }: { issue: TrackIssue; assignee: string; team: string }) {
  return (
    <tr className="border-b border-rule transition-colors last:border-b-0 hover:bg-canvas">
      <td className="whitespace-nowrap px-3 py-1.5 font-mono text-caption text-faint">{issue.identifier}</td>
      <td className="w-full max-w-0 px-3 py-1.5">
        <Link to={`/track/issues/${issue.id}`} className="block truncate text-body text-ink hover:underline">
          {issue.title}
        </Link>
      </td>
      <td className="whitespace-nowrap px-3 py-1.5">
        <StatusPill status={issue.status} />
      </td>
      <td className={`whitespace-nowrap px-3 py-1.5 text-body ${issue.assignee_id ? 'text-muted' : 'text-faint'}`}>
        {assignee}
      </td>
      <td className="whitespace-nowrap px-3 py-1.5 text-caption uppercase tracking-wide text-muted">{team}</td>
      <td className="whitespace-nowrap px-3 py-1.5 text-right text-caption tabular-nums text-muted">
        {formatWhen(issue.updated_at)}
      </td>
    </tr>
  )
}

export function IssueList() {
  const [status, setStatus] = useFilterParam('status')
  const [assignee, setAssignee] = useFilterParam('assignee_id')
  const [team, setTeam] = useFilterParam('team_id')
  const [, setParams] = useSearchParams()

  const members = useMembers()
  const teams = useTeams()
  const issues = useIssues({ status, assignee_id: assignee, team_id: team })
  const filtered = status !== '' || assignee !== '' || team !== ''

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between gap-gutter">
          <span>Issues</span>
          <span className="flex items-center gap-2">
            <FixtureBadge standsInFor={issues.standsInFor} />
            <span className="text-caption tabular-nums text-faint">{issues.data.length} issues</span>
          </span>
        </div>
      </CardHeader>

      {/* Filter rail — one dense row, controls only, captions carried by the values. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-rule px-3 py-2">
        <Select value={status === '' ? ALL : status} onValueChange={setStatus}>
          <SelectTrigger aria-label="Filter by status" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {ISSUE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {statusLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={assignee === '' ? ALL : assignee} onValueChange={setAssignee}>
          <SelectTrigger aria-label="Filter by assignee" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All assignees</SelectItem>
            {members.data.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={team === '' ? ALL : team} onValueChange={setTeam}>
          <SelectTrigger aria-label="Filter by team" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All teams</SelectItem>
            {teams.data.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {filtered ? (
          <Button onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear</Button>
        ) : null}
      </div>

      {issues.data.length === 0 ? (
        <div className="px-gutter py-4 text-body text-muted">No issues match these filters.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-rule">
                <th scope="col" className="px-3 py-1.5 text-caption uppercase tracking-wide text-faint">Key</th>
                <th scope="col" className="px-3 py-1.5 text-caption uppercase tracking-wide text-faint">Title</th>
                <th scope="col" className="px-3 py-1.5 text-caption uppercase tracking-wide text-faint">Status</th>
                <th scope="col" className="px-3 py-1.5 text-caption uppercase tracking-wide text-faint">Assignee</th>
                <th scope="col" className="px-3 py-1.5 text-caption uppercase tracking-wide text-faint">Team</th>
                <th scope="col" className="px-3 py-1.5 text-right text-caption uppercase tracking-wide text-faint">Updated</th>
              </tr>
            </thead>
            <tbody>
              {issues.data.map((i) => (
                <IssueRow
                  key={i.id}
                  issue={i}
                  assignee={memberName(members.data, i.assignee_id)}
                  team={teamIdentifier(teams.data, i.team_id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
