import { useMutation } from '@tanstack/react-query'
import { Button, Card, CardHeader } from '@talyvor/ui'
import { ApiError } from '../../lib/api'
import { isSessionExpired, isUnconfigured, notConfiguredCopy } from '../../lib/productState'
import { meteredCallCopy, priorityLabel } from './format'
import { readTriage, type TriageSuggestion } from './triage'

// TriageIssue — Track's triage suggestion, the fourth of its five AI features to reach a browser,
// and the first to reach one WITHOUT the write half it ships with.
//
// ⚠⚠ WHY THIS FEATURE SAT UNREACHABLE FOR SIX CLAIMS OF W1.7, AND WHAT CHANGED. talyvor-track's
// `ai.Handler.Triage` takes `?apply=true` and then OVERWRITES the issue's priority AND labels with
// the model's suggestion, discarding the write error (`_, _ = h.issues.Update(…)`). The queue's
// verdict — "a button that silently rewrites two fields on a ticket is a product decision and not a
// session's" — is right and stands. It is not a reason to leave the SUGGESTION unreachable: reading
// what the model thinks changes nothing. So this card asks, and the BFF forwards NO query string at
// all, so the apply path is not "off by default" here — from a browser it does not exist
// (apps/bff/track_triage.go, and TestTrackTriage_TheApplyParameterNeverTravels).
//
// ⚠ IT IS A BUTTON, NOT A PAGE LOAD, BECAUSE IT COSTS. MEASURED, not read: the request leaving
// Track for Lens carries `X-Talyvor-Feature: <this issue's identifier>` and `claude-haiku-4-6`, so
// the charge lands on this issue's `ai_cost_usd` — the number the Details card above renders.
// WHEN it lands there is a separate fact and the card used to get it wrong: see meteredCallCopy.
// Asking on mount would spend on every ticket anyone opened, and there is no cache upstream for
// this one, so a second press is a second call and a second charge.
//
// ⚠⚠ WHAT THIS CARD MAY NOT SAY, ALL OF IT MEASURED (tab-7f6b, talyvor-track's own engine at
// `655a0a0` over a recording fake Lens; rows in apps/bff/track_triage_test.go):
//
//   · `suggested_priority: 0` IS TWO FACTS. Track's vocabulary calls 0 "None"; Go's zero value fills
//     the field when the model omits it, and the struct carries no omitempty. The two replies are
//     byte-identical on the wire, so drawing "None" would report a suggestion no model may have
//     made. The card says which two facts it cannot separate.
//   · `confidence: 0` IS THE SAME SHAPE, so a 0 draws no percentage at all.
//   · A PRIORITY OUTSIDE 0..4 IS NOT DRAWN — measured travelling intact (9, -1). `priorityLabel`
//     ends `?? 'None'`, which would turn a value nobody recognises into a confident answer: the
//     tier-dot defect (#149) in another costume.
//   · `is_duplicate` AND `suggested_assignee` ARE NEVER DRAWN. The triage prompt asks the model for
//     priority, labels, a summary and a confidence — and for neither of those two. They ride on
//     every response as zero values, so a card reporting "not a duplicate" would be answering a
//     question nobody asked. Track's duplicate finder is a different route with its own prompt and
//     its own card.
export function TriageIssue({ issueId }: { issueId: string }) {
  // The answer belongs to the issue it was asked about. React Router matches /track/issues/:id to
  // ONE element, so arriving at another issue changes `issueId` underneath this component without
  // remounting it — the issue id IS the mutation's variable, so an answer whose variable is not the
  // issue on screen is not shown at all. (FindDuplicates.tsx carries the same guard and the reason.)
  const run = useMutation({ mutationFn: (id: string) => askForTriage(id) })
  const answeredForThisIssue = run.variables === issueId
  const view = run.data === undefined || !answeredForThisIssue ? null : readTriage(run.data)
  const busy = run.isPending && answeredForThisIssue
  const failed = run.isError && answeredForThisIssue

  return (
    <Card>
      <CardHeader>Triage suggestion</CardHeader>
      <div className="flex flex-col gap-3 px-gutter py-4">
        <p className="text-body text-muted">
          Track can ask its AI to read this issue and suggest a priority, some labels and a
          one-line summary.
        </p>
        {/* ⚠ ONE STRING, FROM ./format — see meteredCallCopy for the measurement. */}
        <p className="text-body text-muted">{meteredCallCopy}</p>
        {/* ⚠ SAID BEFORE THE ASK AND AFTER IT, because it is a property of the button and not of the
            answer. Track can apply a triage suggestion; this app does not offer that, and the
            request it sends carries no parameter that could ask for it. */}
        <p className="text-caption text-muted">
          A suggestion only — nothing is changed on the issue, and this app never asks Track to
          apply one.
        </p>
        <div>
          <Button onClick={() => run.mutate(issueId)} disabled={busy || issueId === ''}>
            {busy ? 'Asking Track…' : 'Ask for a triage suggestion'}
          </Button>
        </div>

        {/* ⚠ ONE CHAIN, FAILURE FIRST — not two sibling containers. "The AI suggested nothing" must
            never be what a failed ask looks like; emptyVsFault.test.ts measured exactly that shape
            shipping on IssueList.tsx. */}
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
          // ⚠ THE `ai_available` CONSUMPTION W1.7 ASKED FOR, on a third surface. The reason is
          // Track's own sentence, rendered VERBATIM: it names the variable to set
          // (TRACK_LENS_MINT_KEY) and deliberately does not name Lens's global admin key.
          <>
            <p className="text-body text-ink">Track’s AI is not configured on this deployment.</p>
            {view.reason !== '' && <p className="text-body text-muted">{view.reason}</p>}
          </>
        ) : view.kind === 'unrecognised' ? (
          <p className="text-body text-muted">
            Track answered in a shape this app does not recognise, so nothing is shown rather than a
            blank suggestion that would read as “the AI had no opinion”.
          </p>
        ) : view.kind === 'none' ? (
          // ⚠ THE EMPTY ARM LIVES IN THIS CHAIN AND NOT INSIDE <Suggestion>, AND THE JUDGEMENT
          // BEHIND IT LIVES IN THE READER — neither is a style choice, and neither was my first
          // draft. `emptyVsFault.test.ts` flagged both earlier shapes by name, first the early
          // return inside `Suggestion` and then the `suggestedNothing` predicate that replaced it:
          // its rule reads one component at a time, so an empty state reached inside a child looks
          // exactly like one drawn over a failed read, however carefully the parent branched. Here
          // every failure arm is literally above this line, and `none` vs `suggestion` is decided
          // where the rest of the payload is read.
          <div className="flex flex-col gap-1">
            {/* A description of the ANSWER, never of the issue. Measured: a model replying `{}`
                produces exactly this response, and so does one whose reply carried only the two
                fields nobody asked for. */}
            <p className="text-body text-ink">Track’s AI answered without suggesting anything.</p>
            <ZeroNote
              priorityZero={view.suggestion.priorityAmbiguous}
              confidenceZero={view.suggestion.confidenceAmbiguous}
            />
          </div>
        ) : (
          <Suggestion s={view.suggestion} />
        )}
      </div>
    </Card>
  )
}

/** POST /api/track/issues/{id}/triage — no body and no query, because Track's handler decodes
 *  neither AND because the one query parameter it does read turns this into a write. The SHARED
 *  ApiError, so `isUnconfigured` classifies this exactly as it classifies every other product
 *  read — one rule for "Track is off on this deployment". */
async function askForTriage(issueId: string): Promise<unknown> {
  const path = `/api/track/issues/${encodeURIComponent(issueId)}/triage`
  const res = await fetch(path, { method: 'POST', headers: { Accept: 'application/json' } })
  if (!res.ok) throw new ApiError(res.status, path)
  return (await res.json()) as unknown
}

function Suggestion({ s }: { s: TriageSuggestion }) {
  return (
    <div className="flex flex-col gap-2">
      {s.summary.trim() !== '' ? <p className="text-body text-ink">{s.summary}</p> : null}

      <dl className="flex flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <dt className="text-caption text-faint">Suggested priority</dt>
          <dd className="text-body text-ink">
            {s.priority === null ? (
              <span className="text-body text-muted">
                {s.priorityAmbiguous
                  ? 'not readable — see below'
                  : 'not one of Track’s five priorities'}
              </span>
            ) : (
              priorityLabel(s.priority)
            )}
          </dd>
        </div>
        {s.labels.length > 0 ? (
          <div className="flex items-baseline gap-2">
            <dt className="text-caption text-faint">Suggested labels</dt>
            <dd className="flex flex-wrap gap-2">
              {s.labels.map((l) => (
                <span key={l} className="text-body text-ink">
                  {l}
                </span>
              ))}
            </dd>
          </div>
        ) : null}
      </dl>

      {s.confidence === null ? null : (
        <p className="text-caption text-muted">
          The model rated its own answer {Math.round(s.confidence * 100)}% — that figure is the
          model’s own claim about itself, not a measurement of anything.
        </p>
      )}
      <ZeroNote priorityZero={s.priorityAmbiguous} confidenceZero={s.confidenceAmbiguous} />
      {s.droppedLabels > 0 ? <DroppedNote n={s.droppedLabels} /> : null}
    </div>
  )
}

/** ⚠ THE TWO ZEROES, SAID RATHER THAN RESOLVED. Track's `TriageResult` carries no omitempty, so a
 *  field the model never mentioned arrives as Go's zero value — and for BOTH of these fields zero is
 *  also a legitimate answer (Track's priority 0 is "None"; a confidence of 0 is a model with no
 *  confidence). Measured byte-identical either way, so this app reports the ambiguity instead of
 *  picking the flattering reading. */
function ZeroNote({ priorityZero, confidenceZero }: { priorityZero: boolean; confidenceZero: boolean }) {
  if (!priorityZero && !confidenceZero) return null
  return (
    <div className="flex flex-col gap-1">
      {priorityZero ? (
        <p className="text-caption text-muted">
          Track sent priority 0, which is both its “None” value and the value a missing field gets —
          so whether the model said no priority or said nothing about priority cannot be told apart
          here.
        </p>
      ) : null}
      {confidenceZero ? (
        <p className="text-caption text-muted">
          Track sent a confidence of 0, which is the same two things — so the model either did not
          say how sure it was, or said it was not sure at all.
        </p>
      ) : null}
    </div>
  )
}

/** A label that arrived and could not be drawn is SAID, never silently discarded. */
function DroppedNote({ n }: { n: number }) {
  // The sentence is JSX text and the count is the only interpolation, deliberately: written as one
  // quoted string it is a run of space-separated lowercase words, which deadClasses.test.ts's
  // literal scanner reads as a Tailwind class list. Prose belongs in the document.
  return (
    <p className="text-caption text-muted">
      {n} suggested {n === 1 ? 'label' : 'labels'} arrived and could not be drawn — the response
      carried an entry that was not a name.
    </p>
  )
}
