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
import { ApiError, getJSON, getJSONArray } from '../../lib/api'
import { isSessionExpired } from '../../lib/productState'
import { AISummary } from './AISummary'
import { FindDuplicates } from './FindDuplicates'
import { TriageIssue } from './TriageIssue'
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
  // ⚠ THE ERROR IS KEPT, NOT JUST ITS SENTENCE. Both write paths used to `catch {}` and set a
  // finished string, so the screen chose its words with no error in hand — and every failure got
  // the same ones. A 401 read "You can try again", byte-identical to a 500, on a screen whose
  // reads had already succeeded. Holding the error lets the render classify it the way this app
  // classifies every other refusal, with the shared predicate already imported below.
  const [failure, setFailure] = useState<{ outcome: string; error: unknown } | null>(null)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const [comment, setComment] = useState('')

  // ⚠ ALL FOUR OF THOSE BELONG TO ONE ISSUE, AND NOTHING USED TO SAY SO.
  //
  // React Router matches /track/issues/:id to ONE <Route> element, so moving from issue A to
  // issue B changes `id` underneath this component and does NOT remount it — every useState above
  // survives. MEASURED, not reasoned about (the probe is now IssueDetail.test.tsx's 'the state on
  // this screen belongs to the issue that is open'): with a draft open on A, arriving at B sent
  //
  //     PATCH /api/track/issues/b {"description":"<the words typed on A>"}
  //
  // — A's description written into B, under B's title, from a Save the reader had every reason to
  // press. The typed comment carried across the same way, and a refusal sentence about A stayed on
  // screen over B.
  //
  // ⚠ IT IS NOT REACHABLE FROM THIS UI TODAY and it is still fixed here. Nothing on this screen
  // links to another issue — "‹ Issues" goes up to the list and DOES remount — so it takes one
  // ordinary addition (a parent link; `parent_id` is already on the type, a related list, a search
  // result, prev/next) to become silent data loss, and whoever adds that link has no reason to
  // suspect this file. This is the same shape and the same decision as `f4c1e97` (#190) in
  // areas/docs/PageView.tsx; the two screens were written months apart and grew it independently.
  //
  // Resetting during render rather than in an effect is React's documented way to adjust state
  // when the thing it belongs to changes: the reset lands BEFORE the browser sees anything, so
  // the previous issue's words are never painted under the new issue's title.
  const [stateOf, setStateOf] = useState(id)
  if (stateOf !== id) {
    setStateOf(id)
    setDraft(null)
    setComment('')
    setFailure(null)
  }

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
    setFailure(null)
    const path = `/api/track/issues/${encodeURIComponent(id)}`
    try {
      const res = await fetch(path, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(fields),
      })
      // ⚠ ApiError, NOT `new Error(String(res.status))`. Every shared mechanism in this app keys on
      // `instanceof ApiError`, so a bare Error carrying the status in its MESSAGE is invisible to
      // all of them — the fifth instance of the repair recorded at IssueList.tsx:282, and the one
      // `errorTypes.test.ts` says up front it cannot see, because that rule matches class
      // declarations and this shape declares nothing.
      if (!res.ok) throw new ApiError(res.status, path)
      // Re-read rather than trusting the click: the screen shows what Track RECORDED.
      await qc.invalidateQueries({ queryKey: ['track-issue', id] })
      setDraft(null)
    } catch (err) {
      setFailure({ outcome: 'That did not save, so nothing changed.', error: err })
    } finally {
      setBusy(false)
    }
  }

  async function addComment() {
    const body = comment.trim()
    if (body === '') return
    setBusy(true)
    setFailure(null)
    const path = `/api/track/issues/${encodeURIComponent(id)}/comments`
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ body }),
      })
      if (!res.ok) throw new ApiError(res.status, path)
      setComment('')
      await qc.invalidateQueries({ queryKey: ['track-comments', id] })
    } catch (err) {
      setFailure({ outcome: 'That comment did not post, so nothing was added.', error: err })
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

      {/* ⚠ IT SITS BELOW Details AND ABOVE Comments ON PURPOSE. It summarises the thread under it,
          and what it costs is attributed to the AI cost row above it — the panel is between its
          subject and its price. WHEN that price appears there is a different question, and this
          comment used to answer it wrongly: see meteredCallCopy in ./format, which the card now
          prints. Nothing on the AI request path writes that number. */}
      <AISummary issueId={id} />

      {/* ⚠ BESIDE THE SUMMARY FOR THE SAME REASON, AND ABOVE THE COMMENTS DELIBERATELY: what it
          asks about is the ISSUE — its title and description — not the thread, and what it costs
          is attributed to the AI cost row above it (arriving there out-of-band — meteredCallCopy).
          It carries no `key`: the answer is bound to the issue
          id it was asked with, inside the component, so a route change to another issue cannot
          leave one issue's duplicates drawn under another's title. */}
      <FindDuplicates issueId={id} />

      {/* ⚠ THE THIRD AI CARD, AND THE ONE THAT DELIBERATELY DOES LESS THAN ITS UPSTREAM. Track's
          triage route can APPLY its suggestion — `?apply=true` overwrites this issue's priority and
          labels and discards the write error — so this app asks for the suggestion and the BFF
          forwards no query at all, which is what makes the write unreachable rather than merely
          unused (apps/bff/track_triage.go). Same placement argument as the two above: it reads the
          issue's own title and description, and what it costs is attributed to the AI cost row
          above (arriving there out-of-band — meteredCallCopy). */}
      <TriageIssue issueId={id} />

      <Card>
        <CardHeader>Comments</CardHeader>
        <div className="flex flex-col gap-4 px-gutter py-4">
          {/* ⚠ THE FAULT ARM IS NOT DECORATION — WITHOUT IT THIS PANEL PRINTED "No comments yet."
              OVER A THREAD IT HAD FAILED TO READ. `comments.data` is undefined on a refused read,
              so the empty branch below caught 500, 403 and 401 alike and rendered the same
              sentence a genuinely empty thread gets. That sentence also INVITES A WRITE, which is
              why this panel is worse than a list: it asks someone to re-post a reply that may
              already be there. Same shape and same reasoning as IssueList's issues and
              SpaceView's pages; emptyVsFault.test.ts now enumerates all thirteen.

              The 401 arm is separate because `sessionExpiredCopy` is said ONCE at the top of the
              app — a panel that cannot read for want of a credential says only that it is
              unavailable, and the bar explains why. */}
          {comments.isLoading ? (
            <p className="text-body text-muted">Loading the thread…</p>
          ) : isSessionExpired(comments.error) ? (
            <p className="text-body text-muted">Unavailable.</p>
          ) : comments.isError ? (
            <p className="text-body text-muted">
              Couldn’t reach Track, so the thread can’t be shown. This is a fault, not an empty
              thread.
            </p>
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

      {/* ⚠ ONLY THE ADVICE MOVES — the rule IssueList applies at its create and its status change,
          and Documents.tsx states: "You can try again" is true of a blip and false of a dead
          credential, which will refuse the identical request until the session is renewed. The
          OUTCOME is owed either way, because the reader pressed a button and needs to know it did
          not take.
          ⚠ AND THE BAR IS NOT GUARANTEED TO BE HERE, unlike at the surfaces that rule came from.
          It is derived from errors in the QUERY cache; these two writes are not queries, and on
          this screen the reads have already succeeded — so a mid-session expiry leaves the remedy
          unsaid rather than said twice. Measured, and pinned in writeUnderDeadCredential.test.tsx
          for all three write surfaces rather than papered over here: one screen inventing its own
          sign-in sentence is how the app comes to have two. */}
      {failure && (
        <p className="border-l-2 border-l-slashed pl-2 text-body text-ink">
          {isSessionExpired(failure.error) ? failure.outcome : `${failure.outcome} You can try again.`}
        </p>
      )}
    </div>
  )
}
