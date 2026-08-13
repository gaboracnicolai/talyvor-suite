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
          <p className="text-caption text-faint">{cannotSayCopy}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 px-gutter pb-3">
          <ul className="flex flex-col gap-2">
            {view.rows.map((r) => (
              <Hit key={r.pageID} row={r} />
            ))}
          </ul>
          {view.dropped > 0 ? <DroppedNote n={view.dropped} /> : null}
          <p className="text-caption text-faint">
            {view.semantic === 'ran'
              ? 'At least one of these came from the semantic index, so that half ran here and this workspace’s pages are embedded.'
              : cannotSayCopy}
          </p>
        </div>
      )}
    </Card>
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
