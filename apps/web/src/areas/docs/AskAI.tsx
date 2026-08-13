// The first browser control for any AI feature in this product.
//
// ── WHAT WAS TRUE BEFORE THIS FILE ───────────────────────────────────────────
//
// talyvor-docs ships eight AI operations behind `/v1/workspaces/{ws}/ai/…` and talyvor-track
// ships its own. Measured across apps/web/src at suite `d234144`: NOT ONE file named an `/ai/`
// address, and `ai_available` appeared in zero of them. The only reference to any of it was a
// comment. Every one of those features was reachable only by curl.
//
// Ask is the one that needs no editor: a question, an answer, and the pages it was drawn from.
//
// ── THE THREE STATES, AND WHY THE THIRD IS THE POINT ─────────────────────────
//
//   · Docs not wired here          → the spaces query already says so; this card is not offered.
//   · Docs wired, AI unconfigured  → 503 + code AI_UNAVAILABLE. DIFFERENT INSTRUCTION.
//   · Docs wired, AI configured    → an answer.
//
// The middle state is the reason lib/productState.ts gained `isAIUnavailable`. Docs answers 503
// when its Lens credential is missing, and the BFF answers 503 when this deployment has no Docs
// at all — one status, two opposite diagnoses. Read off the status alone (which is what
// isUnconfigured did, and all this app had) a healthy Docs with no AI key renders as "Docs is not
// configured on this deployment", sending an operator to check DOCS_* variables that are correct.
// productState.ts's own header records that mistake costing a day the last time it was made.
//
// ── WHAT IT COSTS, SAID HONESTLY OR NOT AT ALL ───────────────────────────────
//
// Every ask is a metered Lens completion billed to this workspace. It is attributed to NO PAGE:
// Engine.AskDocs passes an empty page id by design ("an answer drawn from several pages belongs
// to none of them"), so nothing lands in page_ai_spend_events and no page's own_ai_cost_usd
// moves. The response carries no cost field, and this screen has no second source for one — so it
// says where the charge lands and shows no number. A per-answer figure here would be invented.
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button, Card, CardHeader, focusRing } from '@talyvor/ui'
import { docsApi, type AskSource } from './api'
import { aiNotConfiguredCopy, isAIUnavailable, isSessionExpired } from '../../lib/productState'

/**
 * Maps a source URL from DOCS' frontend to THIS app's reader route, and refuses anything else.
 *
 * ⚠ THE UPSTREAM URL IS NOT AN ADDRESS IN THIS APP. talyvor-docs builds `/spaces/{id}/pages/{id}`
 * against its OWN origin (internal/ai/handler.go pageURL, whose comment says the host is unknown
 * to the server). Rendered verbatim as an href it would navigate this SPA to `/spaces/…`, which
 * this app does not route — a dead link on every citation, and a silent one, because the SPA
 * fallback answers 200 with the app shell.
 *
 * The suite's reader is that same path under `/docs`, so the mapping is a prefix. Anything that
 * does not have the expected shape (empty, absolute, a different family) returns null and is
 * rendered as plain text: a source that cannot be linked is still a source worth naming, and a
 * guessed link is worse than none.
 */
export function readerHref(url: string): string | null {
  return /^\/spaces\/[^/]+\/pages\/[^/]+$/.test(url) ? `/docs${url}` : null
}

export function AskAI() {
  const [question, setQuestion] = useState('')
  const ask = useMutation({ mutationFn: (q: string) => docsApi.ask(q) })
  const answer = ask.data

  return (
    <Card>
      <CardHeader>Ask the documentation</CardHeader>
      <form
        className="flex flex-col gap-2 px-gutter py-3"
        onSubmit={(e) => {
          e.preventDefault()
          const q = question.trim()
          if (!q || ask.isPending) return
          ask.mutate(q)
        }}
      >
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-caption text-muted">Question</span>
          <input
            className={`w-full rounded-control border border-rule bg-canvas px-2 py-1 text-body text-ink placeholder:text-faint transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="How do we roll back a release?"
          />
        </label>
        <div className="flex items-center gap-2">
          <Button type="submit" variant="primary" disabled={ask.isPending}>
            {ask.isPending ? 'Asking…' : 'Ask'}
          </Button>
          <span className="text-caption text-faint">
            Answered from the pages you can open, by Docs through Lens.
          </span>
        </div>
      </form>

      {/* ⚠ ONE CHAIN, FAILURE FIRST — not two sibling containers. "No pages were cited" must never
          be what a refused ask looks like, and a sibling error arm that CLOSES before the empty
          branch cannot guard it: emptyVsFault.test.ts measured exactly that on IssueList.tsx, so
          the failure state has to be an ancestor of the empty one rather than a neighbour of it.
          It is also simply true here — an error and an answer are mutually exclusive. */}
      {ask.isError ? (
        <div className="px-gutter pb-3 text-body text-muted">
          {isAIUnavailable(ask.error) ? (
            aiNotConfiguredCopy
          ) : isSessionExpired(ask.error) ? null : (
            <>Couldn’t get an answer — nothing was asked of the model. Try again.</>
          )}
        </div>
      ) : answer ? (
        <div className="flex flex-col gap-2 px-gutter pb-3">
          <p className="whitespace-pre-wrap text-body text-ink">{answer.answer}</p>
          {(answer.sources ?? []).length === 0 ? (
            // NOT an error, and not silence either: it means the corpus had nothing matching (or
            // nothing this reader may open), which changes how much the answer above is worth.
            <p className="text-caption text-muted">
              No pages were cited — the answer is not grounded in anything in this workspace you
              can open.
            </p>
          ) : (
            <Sources sources={answer.sources} />
          )}
          {/* THE COST SENTENCE. It names where the charge lands and shows no number, because
              there is no per-answer number to show — see the header. */}
          <p className="text-caption text-faint">
            This answer was a metered Lens call billed to this workspace under{' '}
            <code>docs-ai-ask</code>. Docs attributes it to no single page, so it does not appear
            in any page’s AI cost.
          </p>
        </div>
      ) : null}
    </Card>
  )
}

/** The citation list. Called only with a NON-empty list — the empty case is a decision its
 *  caller takes, under the failure arm, for the reason written there. */
function Sources({ sources }: { sources: AskSource[] }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption text-muted">Sources</span>
      <ul className="flex flex-col gap-1">
        {sources.map((s, i) => {
          const href = readerHref(s.url)
          return (
            <li key={`${s.url}-${i}`} className="text-body text-ink">
              {href ? (
                <a href={href} className={`underline underline-offset-2 ${focusRing}`}>
                  {s.title}
                </a>
              ) : (
                <span>{s.title}</span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
