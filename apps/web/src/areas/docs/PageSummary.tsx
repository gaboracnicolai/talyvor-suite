// Summarise one page — the third AI control to reach a browser in this product, and the FIRST
// whose cost lands on a document rather than on the workspace at large.
//
// ── WHY THIS ONE COULD BE BUILT AND ITS FOUR SIBLINGS COULD NOT ──────────────
//
// The queue has said for weeks that "summarise / translate / shorten / lengthen / suggest-title
// all need the editor". MEASURED against talyvor-docs' own handler rather than read: they need
// the editor to put the result BACK. `POST /workspaces/{ws}/ai/transform` is text in, text out
// (`{action, text, page_id}` → `{text}`), so the READ-ONLY direction needs nothing but a page and
// somewhere to print the answer. A summary is the member of that family that is genuinely read
// rather than inserted — you do not paste a summary into the document it summarises — so it is
// the one that is finished when it is displayed. `shorter`, `longer` and `grammar` are NOT: their
// output is a replacement for the text you sent, and this app has nowhere to put a replacement
// (the only editable box here writes `content_text`, the search projection, which is an open
// product decision). That is why the BFF exposes one action of four.
//
// ── THE STATE THAT SPENDS NOTHING, AND WHY IT IS A STATE AND NOT A DISABLED BUTTON ──
//
// MEASURED upstream (tab-7b42, talyvor-docs e70ff61, scratch copy, fake Lens counting
// completions): `{"text":""}` answers **200 with a real completion of zero user bytes**, billed
// and attributed to the page. Nothing on that path refuses an empty prompt. So "there is nothing
// to summarise" is a real, reachable, MONEY-SPENDING case, and it is refused twice on purpose:
// here, where it costs not even a round trip, and again at the BFF, which is the half that holds
// when a caller is not this screen.
//
// ── WHAT IT COSTS, SAID HONESTLY OR NOT AT ALL ──────────────────────────────
//
// Unlike an ask, this operation names a page, so Docs binds Lens's request id to it and the
// charge lands on THAT page's `own_ai_cost_usd` under the feature tag `docs-ai-summarize`. The
// response carries no number and this app has no second source for one, so the sentence names
// where the charge lands and shows no figure — the same rule AskAI.tsx follows, applied to the
// opposite fact.
import { useMutation } from '@tanstack/react-query'
import { Button, Card, CardHeader } from '@talyvor/ui'
import { docsApi } from './api'
import { MeteredNote } from './components'
import { aiNotConfiguredCopy, isAIUnavailable, isSessionExpired } from '../../lib/productState'

/**
 * @param pageId the page the cost will be attributed to.
 * @param text   the page's STORED text. Not the editor's draft: the charge lands on the page, so
 *               billing it for words it does not contain would make the cost sentence false.
 */
export function PageSummary({ pageId, text }: { pageId: string; text: string }) {
  const summarize = useMutation({ mutationFn: () => docsApi.summarizePage(pageId, text) })
  // The same predicate the BFF applies, for the same measured reason — and deliberately no wider.
  // "Too short to be worth it" would be a product threshold invented in a component.
  const nothingToSummarize = text.trim() === ''

  return (
    <Card>
      <CardHeader>Summary</CardHeader>
      <div className="flex flex-col gap-2 px-gutter py-3">
        {nothingToSummarize ? (
          // NOT a disabled button with no explanation, and not a fault either. Docs would answer
          // this 200 and charge for it, so the screen says what it is instead of offering a click.
          <p className="text-caption text-muted">
            This page has no text yet, so there is nothing to summarise.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              {/* The default variant, deliberately: `primary` is this app's ink-on-colour and Save
                  below already owns it. A metered call is not the main action on a reader. */}
              <Button disabled={summarize.isPending} onClick={() => summarize.mutate()}>
                {summarize.isPending ? 'Summarising…' : 'Summarise this page'}
              </Button>
              <span className="text-caption text-faint">
                Summarises the page as saved, by Docs through Lens.
              </span>
            </div>
            {/* THE COST SENTENCE — it names where the charge lands and shows no number, because
                there is no per-call number to show (see the header). It differs from AskAI's on
                purpose: this one DOES move a page's AI cost.

                ⚠ IT IS HERE, INSIDE THE BRANCH THAT OFFERS THE BUTTON, AND NOT INSIDE
                `summarize.data`. It used to be the latter, which meant the fact a reader needs in
                order to DECIDE was unreachable until they had already paid for it — a receipt, not
                a price. Only the opening clause moves between the two states. And it stays out of
                the `nothingToSummarize` arm on purpose: that arm offers no click, and a price for
                a control that is not on offer is noise. */}
            <MeteredNote tag="docs-ai-summarize" payer="page">
              {summarize.data ? <>This summary was</> : <>Summarising this page buys</>}
            </MeteredNote>
          </>
        )}

        {/* ⚠ ONE CHAIN, FAILURE FIRST — not two sibling containers. A refused summarise must never
            be able to render as a short answer, and a sibling error arm that closes before the
            success branch cannot guard that: emptyVsFault.test.ts measured exactly that shape on
            IssueList.tsx. An error and a summary are mutually exclusive here in any case. */}
        {summarize.isError ? (
          <p className="text-body text-muted">
            {isAIUnavailable(summarize.error) ? (
              aiNotConfiguredCopy
            ) : isSessionExpired(summarize.error) ? null : (
              <>Couldn’t summarise this page — nothing was asked of the model. Try again.</>
            )}
          </p>
        ) : summarize.data ? (
          <>
            <p className="whitespace-pre-wrap text-body text-ink">{summarize.data.text}</p>
            {/* The summary is not the document, and nothing here writes it back — said out loud
                because a box of model-written text under a page editor is exactly the shape a
                reader would expect to be editable. */}
            <p className="text-caption text-muted">
              Generated on request. It is not saved to the page and does not change it.
            </p>
          </>
        ) : null}
      </div>
    </Card>
  )
}
