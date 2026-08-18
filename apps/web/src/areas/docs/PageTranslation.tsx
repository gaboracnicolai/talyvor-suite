// Translate one page — the fourth AI control to reach a browser in this product, and the second
// whose cost lands on a document rather than on the workspace at large.
//
// ── WHY THIS ONE COULD BE BUILT, LIKE SUMMARISE AND UNLIKE THE OTHER THREE ───
//
// Same argument PageSummary.tsx makes, and it holds for the same measured reason: the family needs
// the editor to put the result BACK, not to produce it. `POST /workspaces/{ws}/ai/translate` is
// text in, text out. A translation is read beside the page rather than pasted into it — you do not
// replace an English document with its French version in place — so it is finished when it is
// displayed. `shorter`, `longer` and `grammar` still are not: their output REPLACES the text you
// sent, and this app has nowhere to put a replacement.
//
// ── THE DEFAULT THIS COMPONENT REFUSES TO HAVE, WHICH IS THE WHOLE POINT ─────
//
// MEASURED upstream (tab-7c3e, talyvor-docs 6aca7db, a scratch `git archive` export, its real
// Translate handler over a fake Lens that captures the SYSTEM PROMPT — the only place the target
// language actually lands):
//
//	{"text":"hello","language":"French"}        → 200, 1 completion, "…to French…"
//	{"text":"hello"}                            → 200, 1 completion, "…to English…"
//	{"text":"hello","language":""}              → 200, 1 completion, "…to English…"
//	{"text":"hello","target_language":"French"} → 200, 1 completion, "…to English…"
//
// A missing language is NOT an error upstream. It is a billed completion that answers in English,
// and it is indistinguishable from success at the status code. So this component ships with NO
// default language and no pre-selected option: a default here would be a second author of that
// same silent choice, made in a component this time instead of in `defaultLang`. The user names
// the language or nothing is sent.
//
// ── AND NO LIST OF LANGUAGES, FOR THE SAME REASON ────────────────────────────
//
// A `<select>` of "the languages we support" would be this screen inventing a vocabulary that
// exists nowhere below it: Docs interpolates whatever string it is given straight into a prompt,
// so "fr", "Français" and "Brazilian Portuguese" are all equally real to it. A free-text field is
// the honest control for a free-text parameter. The one rule is the one that was measured — blank
// spends money and lies — and it is enforced here and again at the BFF, which is the half that
// holds when the caller is not this screen.
//
// ── WHAT IT COSTS, SAID HONESTLY OR NOT AT ALL ──────────────────────────────
//
// This operation names a page, so Docs binds Lens's request id to it and the charge lands on THAT
// page's `own_ai_cost_usd` under the feature tag `docs-ai-translate`. The response carries no
// number and this app has no second source for one, so the sentence names where the charge lands
// and shows no figure — the rule AskAI.tsx and PageSummary.tsx both follow.
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button, Card, CardHeader, Input } from '@talyvor/ui'
import { docsApi } from './api'
import { aiNotConfiguredCopy, isAIUnavailable, isSessionExpired } from '../../lib/productState'

/**
 * @param pageId the page the cost will be attributed to.
 * @param text   the page's STORED text. Not the editor's draft: the charge lands on the page, so
 *               billing it for words it does not contain would make the cost sentence false.
 */
export function PageTranslation({ pageId, text }: { pageId: string; text: string }) {
  // ⚠ THE EMPTY STRING IS THE INITIAL VALUE ON PURPOSE. See the header: any default here is the
  // same silent choice `defaultLang` makes upstream, relocated into a component.
  const [language, setLanguage] = useState('')
  const translate = useMutation({ mutationFn: () => docsApi.translatePage(pageId, text, language) })

  // The same two predicates the BFF applies, for the same measured reasons, and deliberately no
  // wider. "Too short to be worth translating" and "is that a real language" would both be product
  // rules invented in a component.
  const nothingToTranslate = text.trim() === ''
  const noLanguageChosen = language.trim() === ''

  return (
    <Card>
      <CardHeader>Translation</CardHeader>
      <div className="flex flex-col gap-2 px-gutter py-3">
        {nothingToTranslate ? (
          // NOT a disabled button with no explanation, and not a fault either. Docs would answer
          // this 200 and charge for it, so the screen says what it is instead of offering a click.
          <p className="text-caption text-muted">
            This page has no text yet, so there is nothing to translate.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <label className="text-caption text-muted" htmlFor="translate-language">
                Translate into
              </label>
              <Input
                id="translate-language"
                className="max-w-48"
                value={language}
                placeholder="e.g. French"
                onChange={(e) => setLanguage(e.target.value)}
              />
              {/* The default variant, deliberately: `primary` is this app's ink-on-colour and Save
                  below already owns it. A metered call is not the main action on a reader. */}
              <Button
                disabled={translate.isPending || noLanguageChosen}
                onClick={() => translate.mutate()}
              >
                {translate.isPending ? 'Translating…' : 'Translate this page'}
              </Button>
            </div>
            {noLanguageChosen ? (
              // ⚠ THIS SENTENCE IS THE FINDING, MADE VISIBLE. Upstream this exact state is a 200
              // and a billed completion in English. Here it is a button that does not fire and a
              // reason a reader can act on.
              <span className="text-caption text-faint">
                Name a language first — without one, Docs would translate this page into English
                and still charge for it.
              </span>
            ) : (
              <span className="text-caption text-faint">
                Translates the page as saved, by Docs through Lens.
              </span>
            )}
          </>
        )}

        {/* ⚠ ONE CHAIN, FAILURE FIRST — not two sibling containers. A refused translate must never
            be able to render as a short answer, and a sibling error arm that closes before the
            success branch cannot guard that: emptyVsFault.test.ts measured exactly that shape on
            IssueList.tsx. */}
        {translate.isError ? (
          <p className="text-body text-muted">
            {isAIUnavailable(translate.error) ? (
              aiNotConfiguredCopy
            ) : isSessionExpired(translate.error) ? null : (
              <>Couldn’t translate this page — nothing was asked of the model. Try again.</>
            )}
          </p>
        ) : translate.data ? (
          <>
            <p className="whitespace-pre-wrap text-body text-ink">{translate.data.text}</p>
            {/* THE COST SENTENCE. It names where the charge lands and shows no number, because
                there is no per-call number to show — see the header. */}
            <p className="text-caption text-faint">
              This translation was a metered Lens call billed to this workspace under{' '}
              <code>docs-ai-translate</code>. Docs attributes it to this page, so it moves this
              page’s own AI cost.
            </p>
            {/* Said out loud because a box of model-written prose under a page editor is exactly
                the shape a reader would expect to be editable. */}
            <p className="text-caption text-muted">
              Generated on request. It is not saved to the page and does not change it.
            </p>
          </>
        ) : null}
      </div>
    </Card>
  )
}
