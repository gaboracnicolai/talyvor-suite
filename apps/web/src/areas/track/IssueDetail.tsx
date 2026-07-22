import { Link, useParams } from 'react-router-dom'
import { Card, CardHeader, Row } from '@talyvor/ui'
import { FixtureBadge } from './FixtureBadge'
import { StatusPill } from './StatusPill'
import { memberName, teamIdentifier, useComments, useIssue, useMembers, useTeams } from './data'
import { formatUSD, formatWhen, priorityLabel } from './format'
import type { TrackComment, TrackMember } from './types'

// ISSUE DETAIL — read-only (the brief's scope): title, description, status, assignee,
// comments. Settings idiom: a stack of cards, facts as Rows, the description and the
// thread as quiet text blocks. Writes (edit / comment / transition) come later with the
// BFF's write proxies — nothing here pretends otherwise.

function Comment({ c, members }: { c: TrackComment; members: TrackMember[] }) {
  return (
    <div className="border-b border-rule px-gutter py-3 last:border-b-0">
      <div className="flex items-baseline justify-between gap-gutter">
        <span className="text-body font-medium text-ink">{memberName(members, c.author_id)}</span>
        <span className="whitespace-nowrap text-caption tabular-nums text-faint">
          {formatWhen(c.created_at)}
          {c.edited_at ? ' · edited' : ''}
        </span>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-body text-ink">{c.body}</p>
    </div>
  )
}

export function IssueDetail() {
  const { issueId = '' } = useParams()
  const issue = useIssue(issueId)
  const comments = useComments(issueId)
  const members = useMembers()
  const teams = useTeams()

  if (!issue.data) {
    // Fixture miss ≡ the live 404 (SEC-5 scoped read: unknown and foreign ids are the
    // same "not found"). Calm state, a way back, no error theatre.
    return (
      <Card>
        <CardHeader>Issue not found</CardHeader>
        <div className="px-gutter py-3 text-body text-muted">
          Nothing at this id.{' '}
          <Link to="/track" className="text-ink underline">
            Back to issues
          </Link>
        </div>
      </Card>
    )
  }

  const i = issue.data
  return (
    <div className="flex flex-col gap-gutter">
      <div>
        <Link to="/track" className="text-caption uppercase tracking-wide text-muted hover:text-ink">
          ← Issues
        </Link>
      </div>

      <Card>
        <CardHeader>
          <div className="flex w-full items-center justify-between gap-gutter">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0 font-mono text-caption text-faint">{i.identifier}</span>
              <span className="truncate">{i.title}</span>
            </span>
            <FixtureBadge standsInFor={issue.standsInFor} />
          </div>
        </CardHeader>
        <Row label="Status">
          <StatusPill status={i.status} />
        </Row>
        <Row label="Assignee">
          <span className={`text-body ${i.assignee_id ? 'text-ink' : 'text-faint'}`}>
            {memberName(members.data, i.assignee_id)}
          </span>
        </Row>
        <Row label="Team">
          <span className="text-caption uppercase tracking-wide text-muted">{teamIdentifier(teams.data, i.team_id)}</span>
        </Row>
        <Row label="Priority">
          <span className={`text-body ${i.priority === 0 ? 'text-faint' : 'text-ink'}`}>{priorityLabel(i.priority)}</span>
        </Row>
        {i.ai_cost_usd > 0 ? (
          // Track's distinctive column: per-issue AI spend, reconciled in from Lens
          // (model.Issue.ai_cost_usd/ai_tokens). Worth a Row the moment it is non-zero.
          <Row label="AI cost" hint={`${i.ai_tokens.toLocaleString('en-US')} tokens via ${i.lens_feature || 'lens'}`}>
            <span className="text-body tabular-nums text-ink">{formatUSD(i.ai_cost_usd)}</span>
          </Row>
        ) : null}
        <Row label="Created" hint={`by ${memberName(members.data, i.creator_id)}`}>
          <span className="text-caption tabular-nums text-muted">{formatWhen(i.created_at)}</span>
        </Row>
        <Row label="Updated">
          <span className="text-caption tabular-nums text-muted">{formatWhen(i.updated_at)}</span>
        </Row>
      </Card>

      <Card>
        <CardHeader>Description</CardHeader>
        {i.description ? (
          <p className="whitespace-pre-wrap px-gutter py-3 text-body text-ink">{i.description}</p>
        ) : (
          <div className="px-gutter py-3 text-body text-faint">No description.</div>
        )}
      </Card>

      <Card>
        <CardHeader>
          <div className="flex w-full items-center justify-between gap-gutter">
            <span>Comments</span>
            <span className="flex items-center gap-2">
              <FixtureBadge standsInFor={comments.standsInFor} />
              <span className="text-caption tabular-nums text-faint">{comments.data.length}</span>
            </span>
          </div>
        </CardHeader>
        {comments.data.length === 0 ? (
          <div className="px-gutter py-3 text-body text-faint">No comments yet.</div>
        ) : (
          comments.data.map((c) => <Comment key={c.id} c={c} members={members.data} />)
        )}
      </Card>
    </div>
  )
}
