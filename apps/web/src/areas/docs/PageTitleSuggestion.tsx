// Suggest a title for one page — the sixth AI control to reach a browser in this product, the
// third whose cost lands on a document, and the FIRST whose output is meant to be written back.
//
// ── WHY THIS ONE COULD BE BUILT WHILE SHORTER/LONGER/GRAMMAR STILL CANNOT ────
//
// PageSummary.tsx recorded the rule those three are stuck behind: their output REPLACES the text
// you sent, and the only editable box in this app writes `content_text` — the search projection
// Docs derives from the canonical document — which is an open product decision (W2.3,
// ./EDITOR-SIZING.md). Landing model output there would settle that decision sideways.
//
// A title is not in that argument at all. It is a column of its own, already in Docs'
// `updatableFields`, and this app already PATCHes it (docsApi.updatePage). So the suggestion has
// somewhere honest to land, and applying it touches nothing the editor question owns.
//
// ── TWO CLICKS, BECAUSE THEY ARE TWO DECISIONS ──────────────────────────────
//
// Suggesting SPENDS; applying CHANGES A DOCUMENT. One button doing both would make a single press
// an unreviewable spend-and-mutate, and would put a write behind the suggestion's gate rather than
// its own. So the card asks, shows, and waits.
//
// ── THE TWO MEASURED CASES ──────────────────────────────────────────────────
//
// MEASURED against talyvor-docs' own handler over a fake Lens that counts completions (tab-2f4d,
// docs f515db8, a `git archive` scratch export; that repo was held by another tab and was never
// written to):
//
//  1. A BLANK PAGE IS A MONEY CASE. `{"content":""}`, `{"content":"   \n\t  "}` and a body naming
//     no content at all are each **200 with a real billed completion** — a title invented for a
//     page the model never read. Nothing upstream refuses it. So "there is nothing to title" is a
//     state, not a disabled button, and it is refused twice: here, where it costs not even a round
//     trip, and again at the BFF, which is the half that holds when the caller is not this screen.
//
//  2. AN EMPTY SUGGESTION COMES BACK AS A 200. Engine.SuggestTitle trims ` \t\n"'` off the
//     completion and returns what is left, so a model answering `""`, `"''"` or `"\n\n"` yields
//     `{"title":""}` — five completion shapes measured, all of them. This card must not offer to
//     write that over a real title. It is NOT reported as a failure either: the completion is
//     bought by the time it arrives, and a screen calling it an error would hide a charge the
//     workspace has taken.
//
// ── WHAT IT COSTS, SAID HONESTLY OR NOT AT ALL ──────────────────────────────
//
// This operation names a page, so Docs binds Lens's request id to it and the charge lands on THAT
// page's `own_ai_cost_usd` under the feature tag `docs-ai-title`. The response carries no number
// and this app has no second source for one, so the sentence names where the charge lands and
// shows no figure — the rule AskAI.tsx and PageSummary.tsx already follow.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, Card, CardHeader } from '@talyvor/ui'
import { docsApi } from './api'
import { MeteredNote } from './components'
import { aiNotConfiguredCopy, isAIUnavailable, isSessionExpired } from '../../lib/productState'

/**
 * @param spaceId the space the page lives in — needed by the PATCH that applies the title, not by
 *                the suggestion, whose upstream route is workspace-scoped.
 * @param pageId  the page the cost will be attributed to, and the page that gets the new title.
 * @param text    the page's STORED text. Not the editor's draft: the charge lands on the page, so
 *                billing it for words it does not contain would make the cost sentence false.
 */
export function PageTitleSuggestion({
  spaceId,
  pageId,
  text,
}: {
  spaceId: string
  pageId: string
  text: string
}) {
  const qc = useQueryClient()
  const suggest = useMutation({ mutationFn: () => docsApi.suggestTitle(pageId, text) })
  const apply = useMutation({
    mutationFn: (title: string) => docsApi.updatePage(spaceId, pageId, { title }),
    // ⚠ THE READER HAS TO SEE THE TITLE IT NOW HAS, NOT THE ONE IT HAD. PageView renders the header
    // from its own `['docs-page', spaceId, pageId]` query; without this the write lands and the
    // header goes on showing the old title — the "optimistic echo" shape PageView.tsx's save
    // mutation already records this app as refusing everywhere it writes.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['docs-page', spaceId, pageId] }),
  })

  // The same predicate the BFF applies, for the same measured reason — and deliberately no wider.
  const nothingToTitle = text.trim() === ''
  // ⚠ TRIMMED, NOT MERELY `!== ''`. Upstream's trim set is ` \t\n"'`, which does not include every
  // space character a model can emit — a suggestion of "  \r " survives it and is still no title.
  const suggested = suggest.data?.title.trim() ?? ''

  return (
    <Card>
      <CardHeader>Title</CardHeader>
      <div className="flex flex-col gap-2 px-gutter py-3">
        {nothingToTitle ? (
          // NOT a disabled button with no explanation, and not a fault either. Docs would answer
          // this 200 and charge for it, so the screen says what it is instead of offering a click.
          <p className="text-caption text-muted">
            This page has no text yet, so there is nothing to suggest a title from.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              {/* The default variant, deliberately: `primary` is this app's ink-on-colour and the
                  page's Save owns it. A metered call is not the main action on a reader. */}
              <Button disabled={suggest.isPending} onClick={() => suggest.mutate()}>
                {suggest.isPending ? 'Suggesting…' : 'Suggest a title'}
              </Button>
              <span className="text-caption text-faint">
                Reads the page as saved, by Docs through Lens. It does not rename anything.
              </span>
            </div>
            {/* THE COST SENTENCE. ⚠ IT IS HERE, BESIDE THE BUTTON, AND NOT INSIDE THE SUCCESS
                BRANCH IT USED TO LIVE IN — this card's empty-title arm tells a reader who paid for
                nothing that "the call was still billed", and that must never be the first time the
                charge is mentioned. Only the opening clause moves between price and receipt. */}
            <MeteredNote tag="docs-ai-title" payer="page">
              {suggest.isSuccess ? <>Suggesting a title was</> : <>Suggesting a title buys</>}
            </MeteredNote>
          </>
        )}

        {/* ⚠ ONE CHAIN, FAILURE FIRST — not two sibling containers. A refused suggestion must never
            be able to render as a title, and a sibling error arm that closes before the success
            branch cannot guard that: emptyVsFault.test.ts measured exactly that shape on
            IssueList.tsx. */}
        {suggest.isError ? (
          <p className="text-body text-muted">
            {isAIUnavailable(suggest.error) ? (
              aiNotConfiguredCopy
            ) : isSessionExpired(suggest.error) ? null : (
              <>Couldn’t suggest a title — nothing was asked of the model. Try again.</>
            )}
          </p>
        ) : suggest.isSuccess ? (
          <>
            {suggested === '' ? (
              // MEASURED, REACHABLE, AND NOT AN ERROR. See the header: the completion is bought.
              <p className="text-body text-muted">
                The model returned no title. Nothing was changed — and the call was still billed.
              </p>
            ) : (
              <>
                <p className="text-body text-ink">{suggested}</p>
                <div className="flex items-center gap-2">
                  <Button disabled={apply.isPending} onClick={() => apply.mutate(suggested)}>
                    {apply.isPending ? 'Applying…' : 'Use this title'}
                  </Button>
                  {apply.isSuccess ? (
                    <span className="text-caption text-muted">Renamed.</span>
                  ) : apply.isError ? (
                    // The failure names what did NOT happen. A refused write leaves the suggestion
                    // on screen, which is the only place it exists.
                    <span className="text-caption text-muted">
                      Couldn’t apply it — this page’s title is unchanged. Try again.
                    </span>
                  ) : (
                    // ⚠ NOT "Nothing is renamed until you press this." That wording tripped
                    // EmptyStates.test.tsx's detector, which reads a text node opening with
                    // "No…"/"Nothing…" as an ABSENCE that must name a next action. This sentence is
                    // not an absence — it describes a pending state beside an enabled button — so
                    // it is reworded rather than exempted: an EXEMPT entry would assert it IS an
                    // empty state, which is false, and the guard would then be carrying a wrong
                    // claim to stay green.
                    <span className="text-caption text-faint">
                      The page keeps its current title until you press this.
                    </span>
                  )}
                </div>
              </>
            )}
            {/* ⚠ THE COST SENTENCE MOVED UP, BESIDE THE BUTTON — see MeteredNote there; it now
                reads in the past tense in exactly this state, and it is rendered for the empty
                suggestion too, because that call cost exactly as much as a useful one. What stays
                HERE is the half that is only true where the second button is: applying is a PATCH
                this app makes, not a completion, so it buys nothing. */}
            <p className="text-caption text-faint">Applying it costs nothing.</p>
          </>
        ) : null}
      </div>
    </Card>
  )
}
