// Semantic page search — the second AI feature W1.7 listed as reachable only by curl, and the
// other one of the eight that needs no editor.
//
// ── WHAT THIS CARD MAY AND MAY NOT SAY ───────────────────────────────────────
//
// Docs' search runs two halves: full text in Postgres, and a semantic half that embeds the query
// through Lens and matches page vectors. The response merges them and tags each row `fulltext`,
// `semantic` or `both`.
//
// ⚠⚠ THE ENVELOPE HAS NO FIELD FOR WHETHER THE SEMANTIC HALF RAN. MEASURED, not read: at docs
// `7bfa1cf`, its own Search handler mounted over a stub store with Lens unconfigured — which is
// this deployment — answers `?q=auth` with `200 {"results":[…"source":"fulltext"…],"total":1}` and
// `?q=auth&type=semantic` with `200 {"results":[],"total":0}`. `SemanticSearch.Search` returns an
// empty slice and NO error when `IsEnabled()` is false, and the handler merges that in silently.
//
// So the sentence a screen most wants to write here — "semantic search is not configured on this
// deployment" — is one no response can support: an all-full-text answer looks identical when the
// half ran and matched nothing. What IS available is one-directional, and it is all this card
// claims: a row tagged `semantic` or `both` proves the half ran; nothing proves it did not.
//
// ⚠⚠ AND THE CARD SAID BOTH HALVES OF THAT WRONG, MEASURED, ON THE ROW SHAPE UPSTREAM ACTUALLY
// SHIPS. The `dropped` note in search.ts records that talyvor-docs has twice served a hit this app
// cannot draw, and BOTH TIMES it was a semantic hit — so the undrawable row is the proof-carrying
// row, not an unrelated edge. Driven through this component:
//
//   one `source:"semantic"` row with no title      → "Nothing in this workspace matched", "1 result
//                                                     arrived and could not be drawn", and "this
//                                                     answer CANNOT SAY whether the semantic half
//                                                     ran" — while holding the proof that it had.
//   one full-text row drawn + one semantic dropped → "At least one of THESE came from the semantic
//                                                     index", pointing at a list where none did.
//
// The first hedged over evidence it was holding; the second is the worse one — a false sentence
// about a visible list. One root: the card read "the half ran" and wrote "one of these", so where
// the evidence arrived was discarded. `semantic` and `semanticShown` are now two facts and the
// sentence is chosen from both, in evidenceNote, once.
//
// ⚠ THAT IS ALSO WHY THERE IS NO type TOGGLE. A "Semantic only" control would, on a deployment
// without Lens, empty the list every time and be unable to say why — a button whose only visible
// effect is an empty panel it must then hedge about. The BFF route accepts all three types and is
// tested on them (docs_search.go), so the contract is complete; the CONTROL waits until the answer
// can say whether the half ran. Adding the toggle is a decision about a claim, not about a widget.
//
// ⚠ WHAT IT COSTS. The full-text half is Postgres and free. The semantic half embeds the query via
// Lens on every call, so where Lens is wired a search is a metered call billed to this workspace
// and attributed to no page — the embedding is of the QUERY, and there is no page to charge. That
// is why this is a submitted form and not a keystroke-driven one: Docs' own SPA debounces at 300ms
// and its search package sizes a rate limiter for ~200 embeddings a minute from one typist.
//
// ⚠⚠ EVERY WORD OF THAT PARAGRAPH WAS TRUE AND LIVED ONLY HERE. Four sibling Docs cards printed a
// cost sentence to the reader; this one — the highest-frequency metered surface in the product —
// printed nothing, and the knowledge sat in this comment where no reader could reach it. It is now
// on screen: see CostNote below, and meteredCostCensus.test.tsx for the census over all five
// surfaces that makes "a card that spends says so" a rule rather than four coincidences.
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button, Card, CardHeader, focusRing } from '@talyvor/ui'
import { readerHref } from './AskAI'
import { docsApi } from './api'
import { readSearch, type SearchRow } from './search'
import { isSessionExpired } from '../../lib/productState'

/** The hedge. One string, used by every state that has no proof either way, so the three cannot
 *  drift into three different promises. */
const cannotSayCopy =
  'This answer cannot say whether the semantic half ran — Docs merges an unconfigured semantic ' +
  'search in as an empty list and the response has no field for it.'

/** Proof, and it is ON SCREEN. Requires a DRAWN row: "these" names the list under it. */
const shownCopy =
  'At least one of these came from the semantic index, so that half ran here and this workspace’s ' +
  'pages are embedded.'

/** Proof, and the row carrying it is one the card could not draw. A separate sentence rather than
 *  a softened `shownCopy`, because the two differ in what they point AT: this one may not say
 *  "these", and the previous version's only options were to say it falsely or to hedge over proof
 *  it was holding. It ends on the drop deliberately — the reader's next question is which row. */
const ranButDroppedCopy =
  'The semantic half ran here and this workspace’s pages are embedded — the row that proves it is ' +
  'one of the rows that could not be drawn.'

/**
 * The evidence sentence, chosen in ONE place.
 *
 * ⚠ IT IS A FUNCTION AND NOT TWO TERNARIES IN THE JSX BECAUSE THE TWO BRANCHES DRIFTED. The
 * results branch read the weaker fact and wrote the stronger sentence; the empty branch could not
 * read the fact at all. One rule, evaluated from the same two inputs in both places, is what stops
 * a third state from being invented in one of them.
 */
function evidenceNote(semantic: 'ran' | 'unknown', shown: boolean): string {
  if (semantic !== 'ran') return cannotSayCopy
  return shown ? shownCopy : ranButDroppedCopy
}

export function SearchDocs() {
  const [term, setTerm] = useState('')
  const run = useMutation({ mutationFn: (q: string) => docsApi.search(q) })
  const view = run.data === undefined ? null : readSearch(run.data)

  return (
    <Card>
      <CardHeader>Search the documentation</CardHeader>
      <form
        className="flex flex-col gap-2 px-gutter py-3"
        onSubmit={(e) => {
          e.preventDefault()
          const q = term.trim()
          // Docs refuses a query under two characters and this app does not restate that number —
          // but an EMPTY box is not a search, and sending one would spend a request to be told so.
          if (!q || run.isPending) return
          run.mutate(q)
        }}
      >
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-caption text-muted">Search</span>
          <input
            className={`w-full rounded-control border border-rule bg-canvas px-2 py-1 text-body text-ink placeholder:text-faint transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="rollback procedure"
          />
        </label>
        <div className="flex items-center gap-2">
          <Button type="submit" variant="primary" disabled={run.isPending}>
            {run.isPending ? 'Searching…' : 'Search'}
          </Button>
          <span className="text-caption text-faint">
            Across the pages you can open, in this workspace.
          </span>
        </div>
      </form>

      {/* ⚠ ONE CHAIN, FAILURE FIRST — not two sibling containers. "Nothing matched" must never be
          what a failed search looks like, and a sibling error arm that closes before the empty
          branch cannot guard it (emptyVsFault.test.ts measured exactly that on IssueList.tsx). */}
      {run.isError ? (
        <div className="px-gutter pb-3 text-body text-muted">
          {isSessionExpired(run.error) ? null : (
            <>Couldn’t search — nothing was read, so nothing is shown. Try again.</>
          )}
        </div>
      ) : view === null ? null : view.kind === 'unrecognised' ? (
        // A FAULT, not an empty list. Docs answered, and the answer was a shape this app cannot
        // read — which is a different instruction to an operator than "no matching documents".
        <div className="px-gutter pb-3 text-body text-muted">
          Docs answered in a shape this app does not recognise, so nothing is shown rather than an
          empty list that would read as “no matches”.
        </div>
      ) : view.kind === 'empty' ? (
        <div className="flex flex-col gap-1 px-gutter pb-3">
          {/* The next action is real, not decorative: Docs' full-text half is a `tsquery` over the
              document text, so a long phrase narrows fast — and the semantic half, where it runs,
              only returns rows above a 0.75 cosine floor. Fewer words is genuinely the move. */}
          <p className="text-body text-muted">
            Nothing in this workspace matched that. Widen the query — fewer words, or different ones.
          </p>
          {view.dropped > 0 ? <DroppedNote n={view.dropped} /> : null}
          {/* `false` is not a hedge here: nothing was drawn, so no shown row can carry proof —
              but a DROPPED one still can, and on this route it is the likely carrier. */}
          <p className="text-caption text-faint">{evidenceNote(view.semantic, false)}</p>
          <CostNote semantic={view.semantic} />
        </div>
      ) : (
        <div className="flex flex-col gap-2 px-gutter pb-3">
          <ul className="flex flex-col gap-2">
            {view.rows.map((r) => (
              <Hit key={r.pageID} row={r} />
            ))}
          </ul>
          {view.dropped > 0 ? <DroppedNote n={view.dropped} /> : null}
          {/* ⚠ `semanticShown`, NOT `semantic`. This used to read the weaker fact and print the
              stronger sentence: with one full-text row drawn and a semantic row dropped it said
              "at least one of THESE came from the semantic index" over a list where none did. */}
          <p className="text-caption text-faint">{evidenceNote(view.semantic, view.semanticShown)}</p>
          {/* ⚠ `semantic`, NOT `semanticShown` — and the asymmetry with the line above is the
              point. The evidence sentence needs a DRAWN row because it says "these"; the charge
              needs only that the half RAN, and a dropped row proves that just as well. Reading
              `semanticShown` here would hedge about money the workspace has certainly been
              billed for. */}
          <CostNote semantic={view.semantic} />
        </div>
      )}
    </Card>
  )
}

/**
 * What the search cost, keyed on the SAME evidence `evidenceNote` is keyed on.
 *
 * ⚠ THIS CARD IS THE ONE METERED DOCS SURFACE THAT SAID NOTHING, and the fact was already in this
 * file — the "⚠ WHAT IT COSTS" paragraph in the header above states it in full. It was written by
 * whoever measured it and no reader ever saw it. meteredCostCensus.test.tsx is the guard on the
 * whole population so the next surface cannot be missed the same way.
 *
 * ⚠⚠ THE SENTENCE HAS TWO BRANCHES AND THAT IS NOT HEDGING — IT IS THE SAME CONSTRAINT THE REST OF
 * THIS CARD OBEYS. The four sibling cards spend on a click, so each may say "This summary WAS a
 * metered call" flatly. Here the charge is the SEMANTIC half, and the envelope has no field saying
 * whether that half ran (see the header). On a deployment with no Lens the half returns an empty
 * list that merges in silently and NOTHING was billed. So an unconditional "this search was a
 * metered Lens call" would be a false claim on exactly the deployment this one is — the same
 * defect class #239 deleted from Track's three cards, re-introduced on a fifth surface.
 *
 * A row tagged `semantic` or `both` proves the half ran, which proves the embedding was bought.
 * That is the only state in which this card may use the past tense.
 *
 * ⚠ IT IS RENDERED ONLY WHERE A SEARCH ACTUALLY RAN — the results and empty branches. A fault arm
 * makes NO claim about money, because a failed read may be the BFF failing to dial (nothing spent)
 * or Docs failing after the embedding was bought (something spent), and the response cannot tell
 * them apart. FindDuplicates records the same rule for the same reason.
 *
 * ⚠ THE UNPROVEN BRANCH DOES NOT RE-HEDGE, AND THE FIRST DRAFT DID. It ended "…this answer cannot
 * say whether this search was billed", which is a FOURTH sentence saying what `cannotSayCopy`
 * exists to say once — and two existing tests caught it immediately by matching two elements where
 * they expect one. `evidenceNote` already prints the hedge in every state this branch renders in;
 * this note states the COST and points at the evidence rule, and the hedging stays in one place.
 *
 * ⚠ PROSE AS JSX TEXT, NOT A STRING CONSTANT — see DroppedNote below for the scanner that reads a
 * quoted string of lowercase words as a Tailwind class list.
 */
function CostNote({ semantic }: { semantic: 'ran' | 'unknown' }) {
  return semantic === 'ran' ? (
    <p className="text-caption text-faint">
      Embedding the query was a metered Lens call billed to this workspace under{' '}
      <code>docs-search</code>. Docs attributes it to no single page, so it does not appear in any
      page’s AI cost.
    </p>
  ) : (
    <p className="text-caption text-faint">
      Where Lens is configured, embedding the query is a metered Lens call billed to this workspace
      under <code>docs-search</code>, attributed to no single page. Only a row from the semantic
      index proves it happened here.
    </p>
  )
}

/** A row that arrived and could not be drawn is SAID, never silently discarded — see search.ts for
 *  the two upstream defects that produced exactly such rows. */
function DroppedNote({ n }: { n: number }) {
  // ⚠ THE SENTENCE IS JSX TEXT AND THE COUNT IS THE ONLY INTERPOLATION, DELIBERATELY. Written as
  // `{n === 1 ? '1 result was not shown' : …}` it is a quoted string of space-separated lowercase
  // words, which is indistinguishable from a class list to deadClasses.test.ts's literal scanner:
  // it read `not` as a Tailwind class and reported it dead. Prose belongs in the document, not in
  // a string.
  return (
    <p className="text-caption text-muted">
      {n} {n === 1 ? 'result' : 'results'} arrived and could not be drawn — the response carried a
      row with no title or no address, which is a line with nothing written on it.
    </p>
  )
}

function Hit({ row }: { row: SearchRow }) {
  const href = readerHref(row.url)
  return (
    <li className="flex flex-col gap-0.5">
      <span className="text-body text-ink">
        {href ? (
          <a href={href} className={`underline underline-offset-2 ${focusRing}`}>
            {row.title}
          </a>
        ) : (
          // A hit whose address this app cannot route is still a hit worth naming, and a guessed
          // link is worse than none — the same rule AskAI's citations follow.
          <span>{row.title}</span>
        )}
        {row.spaceName ? <span className="text-muted"> · {row.spaceName}</span> : null}
      </span>
      {/* Upstream's ts_headline wraps matches in <mark>. It is rendered AS TEXT, tags and all:
          this app never puts an upstream string into the document as markup. */}
      {row.headline ? <span className="text-caption text-muted">{row.headline}</span> : null}
    </li>
  )
}
