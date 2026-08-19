import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button, Card, CardHeader } from '@talyvor/ui'
import { getJSON } from '../../lib/api'
import { isSessionExpired, isUnconfigured, notConfiguredCopy } from '../../lib/productState'
import { meteredCallCopy } from './format'
import { readSummary } from './summary'

// AISummary — Track's AI thread summary, and the FIRST browser control for any Track AI feature.
//
// ⚠ WHAT W1.7 RECORDED, TWICE, FROM TWO INDEPENDENT SESSIONS: "Track's AI ENTIRELY" is
// unreachable — the frontend never calls these endpoints and does not consume `ai_available` at
// all. Track ships five AI features (triage, find-duplicates, thread summary, sprint suggestion,
// semantic search) and every one of them was reachable only by curl. This is the first one that
// is not, and it is the only one of the five that is a plain read: triage can overwrite priority
// and labels, two are POSTs, and semantic search belongs to the list screen.
//
// ⚠ IT IS A BUTTON, NOT A PAGE LOAD, BECAUSE IT COSTS. A summary that actually runs is a metered
// Lens call attributed to THIS issue — `SummarizeThread` passes `issue.Identifier` as the feature
// id and Track's syncer resolves a row with no issue header by `identifier = lens_feature`
// (internal/issue/store.go RecordRequestSpendAttributed), so the money lands on
// `issues.ai_cost_usd`, the number the Details card above renders. ⚠ THIS HEADER ALREADY NAMED
// THE SYNCER while the card below it printed "what it costs is added to the AI cost above" — the
// timing was wrong on screen and right here. See meteredCallCopy. Fetching on mount would spend
// on every ticket anyone opened. Track caches for an hour, so a second press inside the hour is
// free — and this screen cannot tell a cached answer from a fresh one, so it does not claim to.
//
// ⚠⚠ THE STATE THIS SCREEN IS CAREFUL ABOUT — MEASURED, NOT READ. tab-9e42 ran talyvor-track's
// engine at `eb0b39b` with a Lens URL and NO mint credential (i.e. AI configured nowhere) and
// drove SummarizeThread at 0, 1, 9 and 10 comments. `SummarizeThread` checks the COMMENT COUNT
// FIRST, so 0/1/9 all answered `{"min_comments":10,"summary_available":false}` and only 10 reached
// the availability check and answered `{"ai_available":false,…}`. The too-short reply is therefore
// IDENTICAL on a deployment with a working AI and on one where AI has never run — and since most
// issues have fewer than ten comments, it is what almost every ticket returns on a box like this
// one. Rendering it as "add ten comments and you'll get a summary" would be a promise this app
// cannot keep, which is precisely what W1.7 asked not to ship ("must say so plainly rather than
// offering a button that 502s"). So the too-short arm says what Track's rule is and says, in one
// clause, that this answer does not report on AI at all.
//
// ⚠ AND TRACK AND DOCS SIGNAL "AI IS OFF" DIFFERENTLY, so the shared classifier cannot be reused
// here. Docs sends 503 + `code:"AI_UNAVAILABLE"` (lib/productState.ts#isAIUnavailable); Track
// sends 200 + `ai_available:false` in the BODY. One is an error the query layer throws, the other
// is a successful read — no predicate over `err` can see Track's. That is why the discrimination
// lives in readSummary and not beside isAIUnavailable.
export function AISummary({ issueId }: { issueId: string }) {
  const [asked, setAsked] = useState(false)

  // ⚠ THE ASK BELONGS TO THE ISSUE THAT IS OPEN — the same rule, and the same reason, as the four
  // useStates at the top of IssueDetail. React Router matches /track/issues/:id to ONE element, so
  // arriving at another issue changes `issueId` underneath this component without remounting it.
  // Without this reset, a summary requested on issue A would still be showing over issue B's
  // title, attributed to B, and the reader has no way to tell. Resetting during render lands
  // before the browser paints, so A's words are never drawn under B's heading.
  const [stateOf, setStateOf] = useState(issueId)
  if (stateOf !== issueId) {
    setStateOf(issueId)
    setAsked(false)
  }

  const q = useQuery({
    queryKey: ['track-issue-summary', issueId],
    queryFn: () => getJSON<unknown>(`/api/track/issues/${encodeURIComponent(issueId)}/summary`),
    enabled: asked && issueId !== '',
    // A summary is a paid call. Nothing re-asks on its own: no retry, no refetch on focus.
    retry: false,
    refetchOnWindowFocus: false,
    // Track's own cache is an hour; matching it here means a second press inside the hour does not
    // even leave the browser. Longer would outlive the thread it summarises.
    staleTime: 60 * 60 * 1000,
  })

  const view = q.data === undefined ? null : readSummary(q.data)

  return (
    <Card>
      <CardHeader>AI summary</CardHeader>
      <div className="flex flex-col gap-3 px-gutter py-4">
        {!asked ? (
          <>
            <p className="text-body text-muted">Track can summarise a long comment thread.</p>
            {/* ⚠ ONE STRING, FROM ./format, AND IT IS A DIFFERENT CLAIM FROM THE ONE THAT WAS
                HERE. See meteredCallCopy for the two writers of issues.ai_cost_usd, measured in
                talyvor-track — neither is on this request path. */}
            <p className="text-body text-muted">{meteredCallCopy}</p>
            <div>
              <Button onClick={() => setAsked(true)}>Summarise the thread</Button>
            </div>
          </>
        ) : q.isPending ? (
          <p className="text-body text-muted">Asking Track…</p>
        ) : isSessionExpired(q.error) ? (
          // Said once at the top of the app — a panel that cannot read for want of a credential
          // says only that it is unavailable, and the bar explains why.
          <p className="text-body text-muted">Unavailable.</p>
        ) : isUnconfigured(q.error) ? (
          <p className="text-body text-muted">{notConfiguredCopy('Track')}</p>
        ) : q.isError ? (
          <p className="text-body text-muted">
            Couldn’t reach Track, so there is no summary. This is a fault, not an empty thread —
            nothing was charged.
          </p>
        ) : view?.kind === 'ai-unavailable' ? (
          // ⚠ THE `ai_available` CONSUMPTION W1.7 ASKED FOR. The reason is Track's own sentence and
          // is rendered VERBATIM: it names the variable to set (TRACK_LENS_MINT_KEY) and
          // deliberately does not name Lens's global admin key. Paraphrasing it here would be this
          // app inventing operator instructions for a service it does not run.
          <>
            <p className="text-body text-ink">Track’s AI is not configured on this deployment.</p>
            {view.reason !== '' && <p className="text-body text-muted">{view.reason}</p>}
          </>
        ) : view?.kind === 'too-short' ? (
          <>
            <p className="text-body text-ink">
              {view.minComments === null
                ? 'This thread is too short for Track to summarise.'
                : `Track summarises a thread once it has ${view.minComments} comments. This one has fewer.`}
            </p>
            {/* ⚠ THE CLAUSE THAT STOPS THIS BEING A PROMISE. Track checks the comment count before
                it checks whether AI is configured at all, so this exact answer is what a
                deployment with no AI returns for almost every issue. Saying "then you'll get a
                summary" would be a guarantee nothing here can make. */}
            <p className="text-body text-muted">
              Track checks the length before it checks anything else, so this answer does not say
              whether its AI is configured here.
            </p>
          </>
        ) : view?.kind === 'summary' ? (
          <>
            <p className="whitespace-pre-wrap text-body text-ink">{view.summary}</p>
            {view.keyPoints.length > 0 && (
              <ul className="flex list-disc flex-col gap-1 pl-5">
                {view.keyPoints.map((k) => (
                  <li key={k} className="text-body text-ink">
                    {k}
                  </li>
                ))}
              </ul>
            )}
            {view.nextAction !== '' && (
              <p className="text-body text-ink">
                <span className="text-caption text-muted">Next · </span>
                {view.nextAction}
              </p>
            )}
            {view.sentiment !== '' && <p className="text-caption text-faint">Thread reads as {view.sentiment}.</p>}
            {/* ⚠ WHOSE WORDS THESE ARE. A model wrote them from the thread; nobody on the team
                did. A summary that looks like a colleague's note is the one kind of fake data a
                tracker must not draw silently. */}
            <p className="text-caption text-faint">
              Written by Track’s AI from the comments above, not by a person.
            </p>
          </>
        ) : (
          // ⚠ THE FOURTH STATE. Track answered, and it was none of the three shapes this screen
          // knows. Drawing an empty summary panel here is exactly the failure this area has
          // already shipped twice under other names.
          <p className="text-body text-muted">
            Track answered with something this screen doesn’t recognise, so no summary is shown.
          </p>
        )}
      </div>
    </Card>
  )
}
