import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  focusRing,
} from '@talyvor/ui'
import { Region, RegionScreen } from '../../components/Region'
import { ApiError, getJSON, getJSONArray } from '../../lib/api'
import { isSessionExpired, isUnconfigured, notConfiguredCopy } from '../../lib/productState'
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
//
// ── W1.1.8: WHAT THE REBUILD CHANGED, AND WHAT IT DELIBERATELY DID NOT ───────────────────────
//
// The screen was a back-link, a title, and then four anonymous `<Card>`s in a column — Description,
// Details, Comments, and the three AI panels between them — so a reader arriving by landmark got
// ONE stop on a page that answers six different questions. It is now six REGIONS, one idea each,
// every one a named landmark, opened by the console's single page-scale heading (Region.tsx).
//
// ⚠ THE THREE AI CARDS KEPT THEIR CARDS ON PURPOSE. They are shared with `aiCostClaim.test.tsx`,
// which renders each one STANDALONE and counts the metered-call sentence across all three; they are
// also W1.1.8's neighbours rather than its subject (FindDuplicates.tsx and TriageIssue.tsx are named
// by no item). A region names the question — "what Track's AI makes of it" — and the cards inside it
// name the three answers, which is Overview's pattern applied one level up.
//
// ⚠ AND `TrackArea.tsx` IS UNTOUCHED, the same deliberate non-change W1.1.7 recorded: it routes
// BOTH Track screens, so a branch that edits it collides in main rather than in either CI.

const UNASSIGNED = '__unassigned__'

// ⚠ THE STATUS AND PRIORITY WORDS COME FROM ./format AND ARE NOT WRITTEN HERE. This screen used
// to speak two vocabularies for one field at the same moment: <StatusPill> beside these controls
// renders "In progress" through `statusLabel`, while the control itself mapped the RAW enum, so
// the row read "Status · In progress · in_progress". Priority was the mirror image — a hand-rolled
// five-entry list here, and an exported, documented, unit-tested `priorityLabel` with no callers.
// issueVocabulary.test.tsx asserts the rendered control per enum value; format.test.ts pins the
// words against model.go. Do not re-inline either list.

/**
 * THE FOUR HEADLINES, AND THE ONE A LIST DOES NOT HAVE.
 *
 * W1.1.7 wrote three of these for the issue LIST, from the rule this area has stated since its
 * first commit: "Track is not deployed here" (503), "Track is broken" (5xx) and "there is nothing
 * here" mean completely different things to a tester, and laundering any into another tells them
 * their work vanished or that a fault is normal. A page-scale heading is the LOUDEST claim on the
 * screen, so it is the worst place to collapse them.
 *
 * ⚠ A TICKET HAS A FOURTH STATE, AND THE OLD SCREEN GAVE ALL FOUR ONE SENTENCE. `if (!it)` printed
 * "That issue could not be read." for a 404, a 500, a 503 and a dead session alike — and the 404 is
 * the ONLY one of the four that is not a fault. The link is stale, or the issue lives in another
 * workspace; nothing is broken, and the reader was told the product had failed.
 *
 * ⚠ THE 404 IS AMBIGUOUS UPSTREAM AND THIS SCREEN MUST NOT RESOLVE IT. talyvor-track's
 * `issue.Handler.Get` answers 404 for a FOREIGN id as well as an absent one, and says why in its
 * own source — "SEC-5: scoped read — foreign id → ErrNotFound → 404 (no disclosure, no oracle)".
 * "This issue was deleted" would be the browser inventing the disclosure the server refused to
 * make, so the sentence is true of both readings and stops there.
 *
 * ⚠ AND IT REACHES THE BROWSER INTACT, which is what makes this a state and not a decoration:
 * `apps/bff/lens.go#forwardProduct` ends `w.WriteHeader(resp.StatusCode)` and copies the body — no
 * remapping anywhere on the path. Measured read-only in both repositories rather than assumed,
 * because a discriminator no upstream can trigger is a branch that cannot fire.
 *
 * ⚠ THIS IS A SCREEN-LEVEL READING OF 404, NOT A CHANGE TO `lib/productState.ts`. That module says
 * "404/500/502/403 remain genuine faults" and it is right about the reads it classifies, which are
 * COLLECTIONS: a 404 from a list route means the BFF has no such route, which is a fault. This one
 * read is by id, where 404 is the upstream's ordinary answer for "not yours, or not there".
 */
const HEADLINE_LOADING = 'Opening the issue…'
const HEADLINE_MISSING = 'There is no issue at this address.'
const HEADLINE_FAULT = 'Track can’t be reached, so this issue can’t be shown.'
const HEADLINE_OFF = 'Track is not configured here.'
const HEADLINE_UNAVAILABLE = 'Unavailable.'

/** A read that answered 404 — see §THE FOUR HEADLINES for why this screen reads it as a state. */
function isMissing(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404
}

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

  // ⚠ THE NEXT ACTION IS PERFORMED, NOT DESCRIBED — the rule W1.1.7 applied to the empty tracker
  // and this screen has two of. "Add the first one below" names no control and means nothing to a
  // reader navigating by rotor; a button that puts the caret in the field it is talking about is a
  // destination. The comment box is always mounted so a ref reaches it directly; the description
  // EDITOR does not exist until the draft opens, so that one focus is deferred by one commit.
  //
  // ⚠ IT IS `focusEditor` AND NOT `focusDraft` FOR A REASON THAT IS NOT STYLE, AND THE REASON IS
  // A DEFECT IN AN INSTRUMENT RATHER THAN IN THIS FILE. `figureFace.test.ts` classifies a call as
  // money by `/usd|cents|cost|price/i` against the bare identifier, so `setFoc-usD-raft` matched
  // `usd`; TypeScript generics are read as JSX open tags by the same file's `tags()` scanner, so
  // an ordinary statement in a function body was reported as RENDERED, and the guard failed with
  // "money rendered in the body sans" over a boolean. MEASURED both directions: removing the
  // `useRef<…>` generic and keeping the name still fails (the file has other generics); keeping
  // the generic and renaming away the three letters passes. A census of both packages finds this
  // was the FIRST false positive — the other eight matches (formatUSD, formatCents, formatCost,
  // lensCostForLXC, costState, CostNote, IssueCostProbe, USD) are all genuinely money. The rename
  // is the local unblock; the instrument is filed as W1.1.18 rather than repaired here, because a
  // tightened pattern needs its own positive controls (`\b` alone would stop matching `formatUSD`,
  // which is the call the rule exists for).
  const commentRef = useRef<HTMLInputElement | null>(null)
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null)
  const [focusEditor, setFocusEditor] = useState(false)
  useEffect(() => {
    if (focusEditor && descriptionRef.current) {
      descriptionRef.current.focus()
      setFocusEditor(false)
    }
  }, [focusEditor])

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
  // links to another issue — "All issues" goes up to the list and DOES remount — so it takes one
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
    setFocusEditor(false)
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

  /**
   * The way back, and it is a DESTINATION rather than a direction.
   *
   * It read "‹ Issues" in `text-caption text-muted underline` — a chevron and a plural noun, muted
   * to the size of a field label. "Back" and "‹" are both instructions about history rather than
   * names of a place, and this is the only exit the screen has in three of its four states.
   */
  const wayBack = (
    <Link className="text-body text-accent underline underline-offset-2" to="/track">
      All issues
    </Link>
  )

  // ⚠ THE HEADLINE IS CHOSEN FROM THE READ'S ACTUAL STATE, never from whether `it` is undefined.
  // `!it` is true while the read is still in flight, true on a 404, true on a fault and true on a
  // dead credential — one predicate over four causes is exactly what put one sentence on all four.
  // See §THE FOUR HEADLINES.
  const off = isUnconfigured(issue.error)
  const expired = isSessionExpired(issue.error)
  const missing = isMissing(issue.error)
  const heading = it
    ? it.title
    : off
      ? HEADLINE_OFF
      : expired
        ? HEADLINE_UNAVAILABLE
        : missing
          ? HEADLINE_MISSING
          : issue.isError
            ? HEADLINE_FAULT
            : HEADLINE_LOADING

  if (!it) {
    // Every state that has no issue to draw still gets the screen's own landmark and its one
    // page-scale claim, so a reader always knows where they are and always has the way out. The
    // other five regions are not rendered at all rather than hidden: a region is an idea, and
    // there is no description, no filing, no cost and no thread to have an idea about.
    return (
      <RegionScreen>
        <Region index="00" label="Issue" heading={heading} sectionClassName="pb-10 pt-4 wide:pb-12">
          <p className="max-w-2xl text-body text-muted">
            {off
              ? notConfiguredCopy('Track')
              : expired
                ? // Said ONCE at the top of the app — a screen that cannot read for want of a
                  // credential says only that it is unavailable, and the bar explains why and
                  // offers the one click that fixes it.
                  'The session that reads this workspace is no longer good.'
                : missing
                  ? // True of BOTH readings of a 404, because the upstream refuses to say which.
                    'Either it never existed, or it belongs to a workspace this session cannot read. Track answers the same way for both, on purpose.'
                  : issue.isError
                    ? 'This is a fault, not a missing issue — Track answered with an error, so nothing is drawn rather than something stale.'
                    : 'Reading it from Track…'}
          </p>
          <div className="mt-8">{wayBack}</div>
        </Region>
      </RegionScreen>
    )
  }

  return (
    <RegionScreen>
      <Region
        index="00"
        label="Issue"
        heading={heading}
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="max-w-none"
      >
        {/* The identifier is the thing you paste into a commit message, so it stays mono and stays
            beside the title. The pill repeats the status the filing region can CHANGE — one is the
            fact, the other is the control, and a reader scanning the top of a ticket wants the fact.

            ⚠ THE TITLE IS AN h2 AND STILL IS. `a19c18f` (#126) made the shell's banner the console's
            one top-level heading at every address, and this page is reached at /track/issues/<id>,
            which matches /track/* — so with the issue actually served, the rendered DOM once carried
            TWO <h1>s: "Track" and this title. That address is deeper than any entry in
            CONSOLE_ROUTES, so ConsoleHeading.test.tsx's sweep could not see the one page in the
            product that broke the rule it enforces twelve times over. ConsoleDeepHeading.test.tsx
            pins the level and sweeps the addresses below the console; `Region` emits an `h2` for
            the same reason, stated in its own docstring, so the outline still reads h1 → h2. */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-caption text-muted">{it.identifier}</span>
          <StatusPill status={it.status} />
          {wayBack}
        </div>
      </Region>

      <Region index="01" label="What this issue says">
        {draft === null ? (
          <div className="flex flex-col gap-6">
            {it.description.trim() === '' ? (
              // ⚠ THE EMPTY STATE NAMES ITS NEXT ACTION AND PERFORMS IT. "No description." is a
              // fact with nothing to do about it; EmptyStates.test.tsx's rule is that an absence
              // must name what fills it, and the button below opens the editor and puts the caret
              // in it rather than telling a reader to look for a control.
              <p className="max-w-2xl text-body text-muted">
                Nothing has been written down yet. A description is what someone picking this up
                cold reads first.
              </p>
            ) : (
              <p className="max-w-2xl whitespace-pre-wrap text-body text-ink">{it.description}</p>
            )}
            <div>
              {/* ⚠ PRIMARY ONLY WHEN IT IS AN INVITATION. `primary` is this system's one
                  ink-on-colour and a screen with several of them has none; the empty state's
                  performed next action earns it, the same edit on a written description does not.
                  A brand-new ticket does show TWO accents at once — this one and the thread's —
                  and that is the honest reading: there are exactly two things missing. */}
              <Button
                variant={it.description.trim() === '' ? 'primary' : 'default'}
                onClick={() => {
                  setDraft(it.description)
                  setFocusEditor(true)
                }}
              >
                {it.description.trim() === '' ? 'Write the description' : 'Edit description'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="text-caption text-muted" htmlFor="issue-description">
              Description
            </label>
            <textarea
              id="issue-description"
              ref={descriptionRef}
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
          </div>
        )}
      </Region>

      <Region index="02" label="How it is filed">
        <div className="flex flex-col gap-6">
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
        </div>
      </Region>

      {/* ⚠ THE NUMBER NO OTHER TRACKER HAS, AND IT IS NOW THE ONLY THING IN ITS REGION. It has
          worked all along and was the fifth row of a settings card, at the same size as "Team".
          Its own region is the design decision this rebuild is for: one idea per view, and this is
          the idea the product is about. */}
      <Region index="03" label="What it has cost so far">
        <div className="flex flex-col gap-3">
          {/* Both numbers, because the zero needs the other one to be read correctly: a
              pooled or node-served issue carries tokens against a zero cost, and the amount
              alone cannot tell that apart from an issue no AI ever touched. */}
          <span className="font-figure text-title text-ink">
            {formatCost(it.ai_cost_usd, it.ai_tokens)}
          </span>
          {it.ai_tokens > 0 && (
            <span className="text-caption text-faint">{it.ai_tokens} tokens</span>
          )}
          <p className="max-w-2xl text-body text-muted">
            Every AI request Track makes about this issue is metered by Lens and attributed back to
            it. No other tracker can tell you this.
          </p>
        </div>
      </Region>

      {/* ⚠ IT SITS BELOW THE COST AND ABOVE THE THREAD ON PURPOSE. The summary summarises the
          thread under it, and what all three cards cost is attributed to the AI cost ABOVE them —
          the region is between its subject and its price, and `meteredCallCopy` says "above" in
          those words, so the order is load-bearing rather than aesthetic. WHEN that price appears
          is a different question and the cards answer it: see meteredCallCopy in ./format. Nothing
          on the AI request path writes that number.

          ⚠ FindDuplicates AND TriageIssue ASK ABOUT THE ISSUE, NOT THE THREAD — its title and
          description — which is why all three sit above the comments rather than beside them.
          Neither carries a `key`: each answer is bound to the issue id it was asked with, inside
          the component, so a route change cannot leave one issue's duplicates under another's
          title. TriageIssue deliberately does LESS than its upstream: Track's triage route can
          APPLY its suggestion (`?apply=true` overwrites priority and labels and discards the write
          error), so this app asks for the suggestion and the BFF forwards no query at all, which
          is what makes the write unreachable rather than merely unused (apps/bff/track_triage.go). */}
      <Region index="04" label="What Track’s AI makes of it">
        <div className="flex flex-col gap-gutter">
          <AISummary issueId={id} />
          <FindDuplicates issueId={id} />
          <TriageIssue issueId={id} />
        </div>
      </Region>

      <Region index="05" label="What has been said">
        <div className="flex flex-col gap-6">
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
            <div className="flex flex-col gap-6">
              <p className="max-w-2xl text-body text-muted">
                No comments yet. A thread is where the decision that is not in the description ends
                up.
              </p>
              {/* The second performed next action on this screen — same rule as the description. */}
              <div>
                <Button variant="primary" onClick={() => commentRef.current?.focus()}>
                  Write the first comment
                </Button>
              </div>
            </div>
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

          <div className="flex flex-col gap-2 border-t border-rule pt-6">
            <label className="text-caption text-muted" htmlFor="new-comment">
              Add a comment
            </label>
            <Input
              id="new-comment"
              ref={commentRef}
              value={comment}
              disabled={busy}
              onChange={(e) => setComment(e.target.value)}
            />
            <div className="pt-2">
              <Button disabled={busy || comment.trim() === ''} onClick={() => void addComment()}>
                {busy ? 'Posting…' : 'Comment'}
              </Button>
            </div>
          </div>

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
              sign-in sentence is how the app comes to have two.
              ⚠ IT MOVED INSIDE THE LAST REGION IN THE REBUILD. It used to be the last child of the
              screen, OUTSIDE every panel — which is text outside a landmark, the thing `Region`
              exists to stop, and it sat below three AI cards that have nothing to do with it. Both
              writes it reports on live in this region. */}
          {failure && (
            <p className="border-l-2 border-l-slashed pl-2 text-body text-ink">
              {isSessionExpired(failure.error) ? failure.outcome : `${failure.outcome} You can try again.`}
            </p>
          )}
        </div>
      </Region>
    </RegionScreen>
  )
}
