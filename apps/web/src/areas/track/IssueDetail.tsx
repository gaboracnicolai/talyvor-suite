import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Button,
  Card,
  CardHeader,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  focusRing,
} from '@talyvor/ui'
import { getJSON, getJSONArray } from '../../lib/api'
import { StatusPill } from './StatusPill'
import { PRIORITY_VALUES, formatCost, priorityLabel, statusLabel } from './format'
import { memberName, teamIdentifier } from './data'
import { ISSUE_STATUSES, type IssueStatus, type TrackIssue, type TrackComment, type TrackMember, type TrackTeam } from './types'

// IssueDetail — the ticket.
//
// ⚠ WHY THIS EXISTS. The suite rendered Ref, Title and Status and nothing else: you could see that
// an issue existed and never read it. A tracker whose tickets cannot be opened is not a tracker,
// and that single gap did more damage than every missing page combined.
//
// ⚠ ALMOST NONE OF THIS IS NEW PLUMBING, WHICH IS THE POINT. trackUpdateIssue already forwards its
// body verbatim, so all twelve of Track's updatableFields were reachable the whole time.
// /api/track/teams was proxied with no caller. filterIssues, memberName and teamIdentifier were
// written in data.ts and nothing imported them. The only genuinely missing piece was POST on the
// comments route — the GET half already existed, so the app could show a thread it could not answer.
//
// ⚠ TEAM IS SHOWN, NOT EDITED, and that is not an oversight: team_id is NOT in Track's
// updatableFields (title, description, status, priority, assignee_id, project_id, cycle_id,
// parent_id, due_date, labels, sort_order, lens_feature). Offering a control that silently drops
// the field would be worse than showing the value.
//
// ⚠ THE AI COST IS THE POINT OF THE SCREEN. issues.ai_cost_usd is a running sum of Track's
// ai_spend_events ledger, attributed per request. No other tracker has it, it has worked all along,
// and until now it was invisible.

const UNASSIGNED = '__unassigned__'

// ⚠ THE STATUS AND PRIORITY WORDS COME FROM ./format AND ARE NOT WRITTEN HERE. This screen used
// to speak two vocabularies for one field at the same moment: <StatusPill> beside these controls
// renders "In progress" through `statusLabel`, while the control itself mapped the RAW enum, so
// the row read "Status · In progress · in_progress". Priority was the mirror image — a hand-rolled
// five-entry list here, and an exported, documented, unit-tested `priorityLabel` with no callers.
// issueVocabulary.test.tsx asserts the rendered control per enum value; format.test.ts pins the
// words against model.go. Do not re-inline either list.

export function IssueDetail() {
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const [failed, setFailed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const [comment, setComment] = useState('')

  const issue = useQuery({
    queryKey: ['track-issue', id],
    queryFn: () => getJSON<TrackIssue>(`/api/track/issues/${encodeURIComponent(id)}`),
    enabled: id !== '',
  })
  const comments = useQuery({
    queryKey: ['track-comments', id],
    queryFn: () => getJSONArray<TrackComment>(`/api/track/issues/${encodeURIComponent(id)}/comments`),
    enabled: id !== '',
  })
  // Both were already proxied and neither had a caller. They turn ids into names.
  const members = useQuery({
    queryKey: ['members'],
    queryFn: () => getJSONArray<TrackMember>('/api/members'),
    staleTime: 60_000,
  })
  const teams = useQuery({
    queryKey: ['track-teams'],
    queryFn: () => getJSONArray<TrackTeam>('/api/track/teams'),
    staleTime: 60_000,
  })

  const it = issue.data

  // ⚠ ONE WRITE PATH FOR EVERY FIELD. Track's Update takes a field map and drops unknown keys, and
  // the BFF forwards verbatim — so a single patch() covers status, priority, assignee and the
  // description without a handler per control.
  async function patch(fields: Record<string, unknown>) {
    setBusy(true)
    setFailed(null)
    try {
      const res = await fetch(`/api/track/issues/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(fields),
      })
      if (!res.ok) throw new Error(String(res.status))
      // Re-read rather than trusting the click: the screen shows what Track RECORDED.
      await qc.invalidateQueries({ queryKey: ['track-issue', id] })
      setDraft(null)
    } catch {
      setFailed('That did not save, so nothing changed. You can try again.')
    } finally {
      setBusy(false)
    }
  }

  async function addComment() {
    const body = comment.trim()
    if (body === '') return
    setBusy(true)
    setFailed(null)
    try {
      const res = await fetch(`/api/track/issues/${encodeURIComponent(id)}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ body }),
      })
      if (!res.ok) throw new Error(String(res.status))
      setComment('')
      await qc.invalidateQueries({ queryKey: ['track-comments', id] })
    } catch {
      setFailed('That comment did not post, so nothing was added. You can try again.')
    } finally {
      setBusy(false)
    }
  }

  if (issue.isLoading) return <p className="text-body text-muted">Loading the issue…</p>
  if (!it) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-body text-muted">That issue could not be read.</p>
        <Link className="text-body text-accent underline" to="/track">
          Back to issues
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-gutter">
      <div className="flex flex-col gap-2">
        <Link className="text-caption text-muted underline" to="/track">
          ‹ Issues
        </Link>
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="font-mono text-caption text-muted">{it.identifier}</span>
          {/* h2, NOT h1 — the level is the only thing that changed here. `a19c18f` (#126) made the
              shell's banner the console's one top-level heading at every address, and this page is
              reached at /track/issues/<id>, which matches /track/* — so with the issue actually
              served, the rendered DOM carried TWO <h1>s: "Track" and this title. That address is
              deeper than any entry in CONSOLE_ROUTES, so ConsoleHeading.test.tsx's sweep could not
              see the one page in the product that broke the rule it enforces twelve times over.
              The outline now reads h1 "Track" → h2 "<issue title>", which is what the screen has
              always shown: the issue is a thing inside Track, not a second page.
              MEASURED ZERO-PIXEL out of the built stylesheet — its only rules naming a heading tag
              list h1 through h6 together (`font-size:inherit;font-weight:inherit` and the margin
              reset), there is no h1-only or h2-only rule in the sheet, and `.text-title` supplies
              24px/640 either way. ConsoleDeepHeading.test.tsx pins the level and sweeps the
              addresses below the console. */}
          <h2 className="text-title text-ink">{it.title}</h2>
        </div>
      </div>

      <Card>
        <CardHeader>Description</CardHeader>
        <div className="flex flex-col gap-3 px-gutter py-4">
          {draft === null ? (
            <>
              {it.description.trim() === '' ? (
                <p className="text-body text-muted">No description.</p>
              ) : (
                <p className="whitespace-pre-wrap text-body text-ink">{it.description}</p>
              )}
              <div>
                <Button onClick={() => setDraft(it.description)}>Edit description</Button>
              </div>
            </>
          ) : (
            <>
              <label className="text-caption text-muted" htmlFor="issue-description">
                Description
              </label>
              <textarea
                id="issue-description"
                className={`min-h-32 w-full rounded-control border border-rule bg-surface p-3 text-body text-ink transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <div className="flex gap-2">
                <Button disabled={busy} onClick={() => void patch({ description: draft })}>
                  {busy ? 'Saving…' : 'Save description'}
                </Button>
                <Button disabled={busy} onClick={() => setDraft(null)}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader>Details</CardHeader>
        <div className="flex flex-col gap-4 px-gutter py-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-caption text-muted">Status</span>
            <StatusPill status={it.status} />
            <Select
              value={it.status}
              disabled={busy}
              onValueChange={(v) => void patch({ status: v as IssueStatus })}
            >
              <SelectTrigger aria-label="Status" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ISSUE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {statusLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-caption text-muted">Priority</span>
            <Select
              value={String(it.priority)}
              disabled={busy}
              onValueChange={(v) => void patch({ priority: Number(v) })}
            >
              <SelectTrigger aria-label="Priority" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITY_VALUES.map((p) => (
                  <SelectItem key={p} value={String(p)}>
                    {priorityLabel(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-caption text-muted">Assignee</span>
            <Select
              value={it.assignee_id ?? UNASSIGNED}
              disabled={busy}
              onValueChange={(v) => void patch({ assignee_id: v === UNASSIGNED ? null : v })}
            >
              <SelectTrigger aria-label="Assignee" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* Radix forbids an empty-string item value, so the "nobody" case needs a
                    sentinel that is translated back to null on the way to Track. */}
                <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                {(members.data ?? []).map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {memberName(members.data ?? [], m.id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Team is READ-ONLY on purpose — see the note at the top of this file. */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-caption text-muted">Team</span>
            <span className="text-body text-ink">{teamIdentifier(teams.data ?? [], it.team_id)}</span>
          </div>

          {/* ⚠ THE NUMBER NO OTHER TRACKER HAS. It has worked all along and was never shown. */}
          <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-4">
            <span className="text-caption text-muted">AI cost</span>
            {/* Both numbers, because the zero needs the other one to be read correctly: a
                pooled or node-served issue carries tokens against a zero cost, and the amount
                alone cannot tell that apart from an issue no AI ever touched. */}
            <span className="font-figure text-body text-ink">
              {formatCost(it.ai_cost_usd, it.ai_tokens)}
            </span>
            {it.ai_tokens > 0 && (
              <span className="text-caption text-faint">{it.ai_tokens} tokens</span>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader>Comments</CardHeader>
        <div className="flex flex-col gap-4 px-gutter py-4">
          {comments.isLoading ? (
            <p className="text-body text-muted">Loading the thread…</p>
          ) : (comments.data ?? []).length === 0 ? (
            <p className="text-body text-muted">No comments yet. Add the first one below.</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {(comments.data ?? []).map((c) => (
                <li key={c.id} className="flex flex-col gap-1">
                  <span className="text-caption text-muted">
                    {memberName(members.data ?? [], c.author_id)}
                  </span>
                  <p className="whitespace-pre-wrap text-body text-ink">{c.body}</p>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-col gap-2 border-t border-rule pt-4">
            <label className="text-caption text-muted" htmlFor="new-comment">
              Add a comment
            </label>
            <Input
              id="new-comment"
              value={comment}
              disabled={busy}
              onChange={(e) => setComment(e.target.value)}
            />
            <div>
              <Button disabled={busy || comment.trim() === ''} onClick={() => void addComment()}>
                {busy ? 'Posting…' : 'Comment'}
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {failed && <p className="border-l-2 border-l-slashed pl-2 text-body text-ink">{failed}</p>}
    </div>
  )
}
