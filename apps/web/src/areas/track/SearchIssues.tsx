// Track's issue search — the fourth of the five AI features W1.7 recorded as "LIVE and reachable
// only by curl", and the only one of the four left that needs neither an editor nor a decision
// about what a button is allowed to CHANGE (triage optionally overwrites priority and labels,
// find-duplicates and sprint-planning are POSTs). track_ai.go said as much when it shipped the
// thread summary: "semantic search is a workspace-wide read that belongs to the list screen, not
// the ticket". This is that list screen.
//
// ── WHAT THIS CARD MAY AND MAY NOT SAY ───────────────────────────────────────
//
// ⚠⚠ IT MAY NOT USE THE WORD "SEMANTIC", AND THAT IS MEASURED RATHER THAN CAUTIOUS. Track's route
// is named `semantic-search` and its answer is a BARE ARRAY — no envelope, no per-row source tag,
// no field of any kind recording which half produced it. `SemanticSearch` falls back to plain
// full-text whenever Lens is unavailable, the pool is nil, the embedding call fails, the vector
// query fails, or the embeddings JOIN comes back empty, and its own docstring calls that a
// feature: "The fallback path is invisible to callers — they always get a useful result."
// Measured at track `b6fec98` in a scratch export, the AI-off answer and the AI-on-but-fell-back
// answer are BYTE-IDENTICAL. So a card headed "AI search" would be making, on every single
// result, a claim no response it receives is able to support — and on this deployment
// (TRACK_LENS_MINT_KEY unset) it would be false every time.
//
// ⚠ THE DOCS SIBLING SAYS MORE THAN THIS ONE, AND THE DIFFERENCE IS EVIDENCE, NOT CONFIDENCE.
// SearchDocs.tsx can print "at least one of these came from the semantic index" because Docs tags
// each row `fulltext`/`semantic`/`both`. Track ships no tag, so the one-directional claim
// available over there is unavailable here in BOTH directions. This card therefore says nothing
// about halves at all — the honest sentence is about the SEARCH, not about the machinery.
//
// ⚠ "NOTHING MATCHED" IS A STATEMENT ABOUT THE RESPONSE, NEVER ABOUT THE WORKSPACE. An empty array
// is at least four facts: nothing matched; no search backend is wired (`fullTextFallback` returns
// nil with no error); the store has no pool (`issue.Store.Search` returns nil with no error); or
// the vector path fell through to a full-text query that matched nothing. A deployment where
// search is not plumbed in at all reports "no results" forever, with a 200.
//
// ⚠ WHAT IT COSTS, AND WHY IT IS A SUBMITTED FORM. Where Lens IS wired the semantic half embeds
// the QUERY on every call under the feature tag `track-search` — a metered call billed to the
// workspace and attributed to no issue, because the embedding is of the query and there is no
// issue to charge. Keystroke-driven search would meter every keystroke. On this deployment the
// engine is unavailable, so the full-text path runs and costs nothing; the form is submitted
// either way, because which of those is true is exactly what this app cannot see.
//
// ⚠⚠ THAT PARAGRAPH IS ON SCREEN NOW — SEE CostNote BELOW — AND UNTIL `16d2218` IT WAS NOT. This
// was the FOURTH metered Track surface and the only one that printed nothing: the knowledge was
// in this header, written by whoever measured it, and no reader could reach it. The identical
// shape shipped on the Docs search card (#240). meteredCostCensus.test.tsx is the census over
// Track's whole metered population, so a fifth surface cannot be missed the same way.
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button, Card, CardHeader, focusRing } from '@talyvor/ui'
import { StatusPill } from './StatusPill'
import { priorityLabel } from './format'
import { readIssueSearch, type IssueSearchRow } from './issueSearch'
import { ApiError } from '../../lib/api'
import { isSessionExpired, isUnconfigured } from '../../lib/productState'

async function searchIssues(q: string): Promise<unknown> {
  const path = `/api/track/issues/search?${new URLSearchParams({ q }).toString()}`
  const res = await fetch(path, { headers: { Accept: 'application/json' } })
  // The SHARED ApiError, so isUnconfigured() classifies this read exactly as it classifies every
  // other product read — one rule for "Track is off on this deployment", in one place.
  if (!res.ok) throw new ApiError(res.status, path)
  return (await res.json()) as unknown
}

export function SearchIssues() {
  const [term, setTerm] = useState('')
  const run = useMutation({ mutationFn: searchIssues })
  const view = run.data === undefined ? null : readIssueSearch(run.data)
  // The BFF refuses a blank query before it dials, and the button is disabled for the same input,
  // so the refusal is stated twice on purpose: the disabled button is the one a person meets, and
  // the 400 is the one that holds when something else calls the route.
  const submittable = term.trim() !== '' && !run.isPending

  return (
    <Card>
      <CardHeader>Search issues</CardHeader>
      <form
        className="flex flex-col gap-2 px-gutter py-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (!submittable) return
          run.mutate(term.trim())
        }}
      >
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-caption text-muted">Search</span>
          <input
            className={`w-full rounded-control border border-rule bg-canvas px-2 py-1 text-body text-ink placeholder:text-faint transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="auth token expiry"
          />
        </label>
        <div className="flex items-center gap-2">
          <Button type="submit" variant="primary" disabled={!submittable}>
            {run.isPending ? 'Searching…' : 'Search'}
          </Button>
          <span className="text-caption text-faint">
            Across the issues in this workspace.
          </span>
        </div>
        <CostNote />
      </form>

      {/* ⚠ ONE CHAIN, FAILURE FIRST — not two sibling containers. "Nothing matched" must never be
          what a failed search looks like, and a sibling error arm that closes before the empty
          branch cannot guard it (emptyVsFault.test.ts measured exactly that on IssueList.tsx). */}
      {run.isError ? (
        <div className="px-gutter pb-3 text-body text-muted">
          {isSessionExpired(run.error) ? null : isUnconfigured(run.error) ? (
            <>Track is not configured on this deployment, so there is nothing to search.</>
          ) : (
            <>Couldn’t search — nothing was read, so nothing is shown. Try again.</>
          )}
        </div>
      ) : view === null ? null : view.kind === 'unrecognised' ? (
        // A FAULT, not an empty list. Track answered, and the answer was a shape this app cannot
        // read — a different instruction to an operator than "no matching issues".
        <div className="px-gutter pb-3 text-body text-muted">
          Track answered in a shape this app does not recognise, so nothing is shown rather than an
          empty list that would read as “no matches”.
        </div>
      ) : view.kind === 'empty' ? (
        <div className="flex flex-col gap-1 px-gutter pb-3">
          {/* ⚠ THE SENTENCE DESCRIBES THE ANSWER, NOT THE WORKSPACE. Track returns an empty array
              both when nothing matched and when no search backend is wired at all, and the two are
              indistinguishable from here. */}
          <p className="text-body text-muted">
            Track returned no issues for that. Widen the query — fewer words, or different ones.
          </p>
          {view.dropped > 0 ? <DroppedNote n={view.dropped} /> : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2 px-gutter pb-3">
          <ul className="flex flex-col gap-2">
            {view.rows.map((r) => (
              <Hit key={r.id} row={r} />
            ))}
          </ul>
          {view.dropped > 0 ? <DroppedNote n={view.dropped} /> : null}
        </div>
      )}
    </Card>
  )
}

/**
 * What a search costs, said where the button is.
 *
 * ⚠ IT IS A PROPERTY OF THE BUTTON, NOT OF THE ANSWER, so it renders with the form and in every
 * outcome — TriageIssue's comment records the same rule for the same reason. The charge, where
 * there is one, is bought on submit and BEFORE Track knows whether anything matched: the Docs
 * census's C2 control measured that deleting the note from the EMPTY branch alone left a whole
 * directory green, and the empty answer is the state that reads most like "nothing happened".
 * Rendering it once, outside the outcome chain, is what makes that branch uncoverable rather than
 * merely covered.
 *
 * ⚠⚠ IT IS CONDITIONAL IN BOTH DIRECTIONS, AND THAT IS MEASURED RATHER THAN CAUTIOUS. The three
 * sibling cards spend on a click and may say so flatly. Here the charge is the half this card is
 * forbidden to name, and `SemanticSearch` falls back silently whenever Lens is unavailable, the
 * pool is nil, or any step fails — so "this search WAS billed" is FALSE on a deployment with no
 * Lens, which is this one, and "was NOT billed" is equally unsupported. Track's answer is a bare
 * array with no field for it (issueSearch.ts). The Docs sibling can end on proof because Docs tags
 * its rows; there is no evidence to read here, in either direction.
 *
 * ⚠ AND IT DOES NOT REUSE `meteredCallCopy`. That sentence's payer is the ISSUE, which is true of
 * the three cards — measured, they pass `issue.Identifier` as the Lens feature tag. Search passes
 * the static tag `track-search` and there is no issue to charge, so borrowing the shared sentence
 * would have told the reader that workspace search spend lands on a ticket. The census asserts
 * the payer for exactly that reason.
 *
 * ⚠ THE VOCABULARY IS NARROW ON PURPOSE. searchIssues.test.tsx bans "semantic", "AI", "vector",
 * "embedding" and "full-text" from this card, because no response it receives can say which half
 * served the answer. This sentence is admitted by that guard UNCHANGED — it is about the CHARGE,
 * which is a fact about the route, and says nothing about the machinery that produced any given
 * result. A cost note that needed the ban loosened would have been the wrong sentence.
 *
 * ⚠ PROSE AS JSX TEXT, NOT A STRING CONSTANT — see DroppedNote below for the scanner that reads a
 * quoted string of lowercase words as a Tailwind class list.
 */
function CostNote() {
  return (
    <p className="text-caption text-faint">
      Where Lens is configured, running this search buys a metered Lens call, billed to this
      workspace under <code>track-search</code> and to no issue. Track’s answer carries no record
      either way, so this app cannot say whether this one was billed.
    </p>
  )
}

/** A row that arrived and could not be drawn is SAID, never silently discarded — a quietly shorter
 *  list is a lie about how much matched. */
function DroppedNote({ n }: { n: number }) {
  // The sentence is JSX text and the count is the only interpolation, deliberately: written as one
  // quoted string it is a run of space-separated lowercase words, which deadClasses.test.ts's
  // literal scanner reads as a Tailwind class list. Prose belongs in the document.
  return (
    <p className="text-caption text-muted">
      {n} {n === 1 ? 'result' : 'results'} arrived and could not be drawn — the response carried a
      row with no id or no title, which is a line with nothing written on it.
    </p>
  )
}

function Hit({ row }: { row: IssueSearchRow }) {
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
      {/* ⚠ AN UNRECOGNISED STATUS DRAWS NO PILL AT ALL. StatusPill maps the six-value enum to a
          hue; handed something else it would either crash or need a default, and a default hue is
          a confident claim about a value nobody classified — the tier-dot defect (#149). */}
      {row.status ? <StatusPill status={row.status} /> : null}
      {row.priority === null ? null : (
        <span className="text-caption text-muted">{priorityLabel(row.priority)}</span>
      )}
    </li>
  )
}
