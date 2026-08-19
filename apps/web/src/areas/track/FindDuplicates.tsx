import { useMutation } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button, Card, CardHeader, focusRing } from '@talyvor/ui'
import { ApiError } from '../../lib/api'
import { isSessionExpired, isUnconfigured, notConfiguredCopy } from '../../lib/productState'
import { readDuplicates, type DuplicateRow } from './duplicates'
import { meteredCallCopy } from './format'

// FindDuplicates — Track's duplicate finder, the third of its five AI features to reach a browser.
//
// ⚠ W1.7 RECORDED, TWICE AND FROM TWO INDEPENDENT SESSIONS, that Track's AI is reachable only by
// curl. The thread summary (#225) and the semantic search (#230) closed two of the five; this
// closes a third. Of the two left, triage optionally OVERWRITES the issue's priority and labels
// (`?apply=true`) and the sprint suggestion needs a cycle screen this app does not have — so this
// is the last one that changes nothing and needs no new surface.
//
// ⚠ IT IS A BUTTON, NOT A PAGE LOAD, BECAUSE IT COSTS. MEASURED, not read: the request that leaves
// Track for Lens carries `X-Talyvor-Feature: <this issue's identifier>` and `claude-haiku-4-6`, so
// the charge lands on this issue's `ai_cost_usd` — the number the Details card above renders.
// WHEN it lands there is a separate fact and the card used to get it wrong: see meteredCallCopy.
// Asking on mount would spend on every ticket anyone opened. There is no cache upstream for this
// one (unlike the summary's hour), so a second press is a second call and a second charge.
//
// ⚠⚠ WHAT THIS CARD MAY NOT SAY, AND WHY. tab-9f27 ran talyvor-track's own handler at `6b31a75`
// over a REAL Postgres and a recording fake Lens (rows in apps/bff/track_duplicates_test.go):
//
//   · `200 []` is AT LEAST FOUR FACTS — nobody matched; somebody matched below Track's 0.7
//     threshold; the model named an issue outside the candidate window, which the id lookup drops
//     in silence; or the window was empty. So the empty arm describes the ANSWER and never claims
//     the issue has no duplicate.
//   · THE WINDOW IS ONE TEAM. A byte-identical twin in another team of the same workspace was
//     measured NOT to be in the prompt, and the answer was `[]`. The card says so out loud,
//     because "no duplicates" over a workspace-wide claim would be false.
//   · THE SUBJECT IS ITS OWN CANDIDATE. Track's prompt carried the issue being asked about under
//     "Existing issues", and echoing that id back produced a row saying the issue duplicates
//     itself at 1.0. `readDuplicates` drops that row and reports that it arrived; this card prints
//     that sentence rather than swallowing it, because the repair is upstream's to make.
//   · THE SCORE IS THE MODEL'S OWN CLAIM, not a measurement — Track passes the number through from
//     the completion. It is drawn with that attribution attached, never as a bare percentage.
export function FindDuplicates({ issueId }: { issueId: string }) {
  // ⚠ THE FILE IS `FindDuplicates.tsx` AND THE READER IS `duplicates.ts`, WHICH IS NOT A STYLE
  // CHOICE. Naming this component file `Duplicates.tsx` made `import … from './duplicates'`
  // resolve to THIS FILE on a case-insensitive filesystem (macOS, the default): the import
  // silently returned the module importing it, and every test failed with "element type is
  // invalid … got: undefined" rather than a missing module. It would have resolved correctly on
  // CI's Linux, so the two would have disagreed. Every other pair in this area already avoids a
  // case-only collision (SearchIssues.tsx/issueSearch.ts, AISummary.tsx/summary.ts).
  //
  // ⚠ THE ANSWER BELONGS TO THE ISSUE IT WAS ASKED ABOUT. React Router matches /track/issues/:id to
  // ONE element, so arriving at another issue changes `issueId` underneath this component without
  // remounting it — the same trap AISummary's reset guards. Here the issue id IS the mutation's
  // variable, so the check is a comparison rather than a state reset: an answer whose variable is
  // not the issue on screen is not shown at all, and there is no window in which A's duplicates
  // are drawn under B's title.
  const run = useMutation({ mutationFn: (id: string) => askForDuplicates(id) })
  const answeredForThisIssue = run.variables === issueId
  const view = run.data === undefined || !answeredForThisIssue ? null : readDuplicates(run.data, issueId)
  const busy = run.isPending && answeredForThisIssue
  const failed = run.isError && answeredForThisIssue

  return (
    <Card>
      <CardHeader>Possible duplicates</CardHeader>
      <div className="flex flex-col gap-3 px-gutter py-4">
        <p className="text-body text-muted">
          Track can ask its AI whether one of this team’s recent issues describes the same problem.
        </p>
        {/* ⚠ ONE STRING, FROM ./format — see meteredCallCopy for why the old sentence's tense was
            the false part of it. */}
        <p className="text-body text-muted">{meteredCallCopy}</p>
        <div>
          <Button onClick={() => run.mutate(issueId)} disabled={busy || issueId === ''}>
            {busy ? 'Asking Track…' : 'Look for duplicates'}
          </Button>
        </div>

        {/* ⚠ ONE CHAIN, FAILURE FIRST — not two sibling containers. "No duplicates" must never be
            what a failed ask looks like; emptyVsFault.test.ts measured exactly that shape shipping
            on IssueList.tsx. */}
        {failed ? (
          isSessionExpired(run.error) ? (
            // Said once at the top of the app — a panel that cannot read for want of a credential
            // says only that it is unavailable, and the bar explains why.
            <p className="text-body text-muted">Unavailable.</p>
          ) : isUnconfigured(run.error) ? (
            <p className="text-body text-muted">{notConfiguredCopy('Track')}</p>
          ) : (
            // ⚠ NO CLAIM ABOUT THE MONEY HERE. A fault reaching this arm may be the BFF failing to
            // dial (nothing was spent) or Track answering 502 after its completion already ran
            // (something was). The response cannot tell them apart, so this sentence does not try.
            <p className="text-body text-muted">
              Couldn’t get an answer from Track. This is a fault, not an empty result.
            </p>
          )
        ) : view === null ? null : view.kind === 'ai-unavailable' ? (
          // ⚠ THE `ai_available` CONSUMPTION W1.7 ASKED FOR, on a second surface. The reason is
          // Track's own sentence, rendered VERBATIM: it names the variable to set
          // (TRACK_LENS_MINT_KEY) and deliberately does not name Lens's global admin key.
          // Paraphrasing would be this app inventing operator instructions for a service it does
          // not run.
          <>
            <p className="text-body text-ink">Track’s AI is not configured on this deployment.</p>
            {view.reason !== '' && <p className="text-body text-muted">{view.reason}</p>}
          </>
        ) : view.kind === 'unrecognised' ? (
          <p className="text-body text-muted">
            Track answered in a shape this app does not recognise, so nothing is shown rather than
            an empty list that would read as “no duplicates”.
          </p>
        ) : view.kind === 'none' ? (
          <div className="flex flex-col gap-1">
            {/* ⚠ A SENTENCE ABOUT THE ANSWER, NOT ABOUT THE ISSUE. Four different situations
                produce this same empty array and nothing in it says which. */}
            <p className="text-body text-ink">Track named no duplicate.</p>
            <WindowNote />
            {view.selfNamed ? <SelfNote /> : null}
            {view.dropped > 0 ? <DroppedNote n={view.dropped} /> : null}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <ul className="flex flex-col gap-2">
              {view.rows.map((r) => (
                <Candidate key={r.id} row={r} />
              ))}
            </ul>
            <p className="text-caption text-faint">
              Scored by Track’s AI, not measured — the number is the model’s own claim about how
              alike two issues are.
            </p>
            <WindowNote />
            {view.selfNamed ? <SelfNote /> : null}
            {view.dropped > 0 ? <DroppedNote n={view.dropped} /> : null}
          </div>
        )}
      </div>
    </Card>
  )
}

/** POST /api/track/issues/{id}/find-duplicates — no body and no query, because Track's handler
 *  decodes neither (measured). The SHARED ApiError, so `isUnconfigured` classifies this exactly as
 *  it classifies every other product read — one rule for "Track is off on this deployment". */
async function askForDuplicates(issueId: string): Promise<unknown> {
  const path = `/api/track/issues/${encodeURIComponent(issueId)}/find-duplicates`
  const res = await fetch(path, { method: 'POST', headers: { Accept: 'application/json' } })
  if (!res.ok) throw new ApiError(res.status, path)
  return (await res.json()) as unknown
}

/** ⚠ THE WINDOW IS STATED EVERY TIME AN ANSWER IS DRAWN, in both arms. It is Track's rule, not a
 *  finding about this workspace: candidates are the 20 most recent issues in the SAME TEAM, so an
 *  answer of any length says nothing about the rest of the workspace. Measured — a byte-identical
 *  twin in a sibling team was not even in the prompt. */
function WindowNote() {
  return (
    <p className="text-caption text-muted">
      Track compares against the most recent issues in this team only, so this is not a check of the
      whole workspace.
    </p>
  )
}

/** ⚠ THE UPSTREAM DEFECT, SAID RATHER THAN SWALLOWED. Track puts the issue being asked about into
 *  its own candidate list, so the model can name it — measured, at similarity 1. The row is not
 *  drawn (an issue cannot duplicate itself) and its arrival is reported, because a list that
 *  quietly shortens is the lie the dropped count exists to prevent. */
function SelfNote() {
  return (
    <p className="text-caption text-muted">
      Track’s answer also named this issue itself, which it cannot be a duplicate of — that row is
      not shown.
    </p>
  )
}

/** A row that arrived and could not be drawn is SAID, never silently discarded. */
function DroppedNote({ n }: { n: number }) {
  // The sentence is JSX text and the count is the only interpolation, deliberately: written as one
  // quoted string it is a run of space-separated lowercase words, which deadClasses.test.ts's
  // literal scanner reads as a Tailwind class list. Prose belongs in the document.
  return (
    <p className="text-caption text-muted">
      {n} {n === 1 ? 'row' : 'rows'} arrived and could not be drawn — the response carried a
      candidate with no id or no title, which is a line with nothing written on it.
    </p>
  )
}

function Candidate({ row }: { row: DuplicateRow }) {
  return (
    <li className="flex min-w-0 items-baseline gap-2">
      {/* The identifier is Track's own human key. Absent ⇒ nothing is drawn in its place: a
          fabricated key on a link is worse than no key. */}
      {row.identifier ? (
        <span className="font-figure text-caption text-faint">{row.identifier}</span>
      ) : null}
      <Link
        to={`/track/issues/${encodeURIComponent(row.id)}`}
        className={`min-w-0 flex-1 truncate text-body text-ink underline underline-offset-2 ${focusRing}`}
      >
        {row.title}
      </Link>
      {/* ⚠ A SCORE THIS APP CANNOT READ DRAWS NOTHING AT ALL — never a 0. A confident "0%" for a
          value nobody recognised is the tier-dot defect (#149) in another costume. */}
      {row.similarity === null ? null : (
        <span className="font-figure text-caption text-muted">
          {Math.round(row.similarity * 100)}%
        </span>
      )}
    </li>
  )
}
