// Docs-area API layer.
//
// ── THE CLAIM THIS FILE USED TO MAKE ─────────────────────────────────────────
//
// "ONE route is live today … everything else a read-only Docs UI needs does NOT exist on the
// BFF yet". Both halves were false: the BFF registers /api/docs/spaces/{spaceID},
// /api/docs/spaces/{spaceID}/pages and /api/docs/spaces/{spaceID}/pages/{pageID} — the exact
// two reads the tree and the reader claimed were missing. The page tree and page reader ran on
// seven fabricated pages (with view counts of 128, 64, 31, …) under a footnote asserting the
// routes did not exist.
//
// The routes exist. What does not exist is a Docs UPSTREAM on this deployment: no DOCS_*
// variables, and the service is not in the compose stack, so all four routes answer 503. So
// the fixtures are deleted rather than re-captioned, and the screens probe instead — see
// lib/productState.ts for why the "not configured" state must be detected rather than written
// down, and areas/docs/BFF-GAPS.md for the Tier-2/3 reads that genuinely do not exist yet.
//
// The shapes below are a DECLARED SUBSET of talyvor-docs internal/model/model.go, not a copy of
// it. Each interface names the upstream fields it does not mirror (`UPSTREAM-ONLY <Interface>: …`,
// `?` meaning the upstream tag carries omitempty); interface fields ∪ that list = the whole
// upstream struct, and deploy/decision-expiry.sh tells a deployer to check that union against the
// Go source. mirrorSubsetRegister.test.ts keeps the two halves equal.
//
// ⚠ THE SENTENCE THAT USED TO BE HERE WAS FALSE. It read "Shapes mirror talyvor-docs
// internal/model/model.go VERBATIM (field-for-field, at e0cf605), so wiring the tree and reader is
// adding a fetch — the types already speak the upstream shape". MEASURED at talyvor-docs d89a005:
// `DocsPage` held 29 of `model.Page`'s 31 json fields, and both missing ones — `own_ai_cost_usd`
// and `total_ai_cost_usd` — carry NO omitempty, so they are on every page response. One of them
// is the column suite #204 registered an entire front-page premise about, added upstream while
// this header went on saying the types already spoke the upstream shape. Nothing broke (the BFF
// streams the body and the extra keys are invisible to TypeScript); the promise was what was
// false, and no change in this repository could have made it go red.
import { ApiError } from '../../lib/api'

/** talyvor-docs model.Space (model.go).
 *  UPSTREAM-ONLY DocsSpace: none */
export interface DocsSpace {
  id: string
  workspace_id: string
  name: string
  slug: string
  description: string
  /** Emoji identifier. Rendered as-is. */
  icon: string
  /** Upstream stores a space colour; this UI deliberately never renders it
   *  (text is never a hue, and a per-space accent is a hue looking for text). */
  color: string
  private: boolean
  created_by: string
  created_at: string
  updated_at: string
}

/** talyvor-docs model.Page (model.go). `content` is the canonical ProseMirror doc JSON
 *  (string-encoded); `content_text` is the plain-text projection the server derives for search.
 *
 *  ⚠ THE TWO OMITTED FIELDS ARE THE PER-PAGE AI SPEND, AND THEY ARE NOT MIRRORED ON PURPOSE.
 *  `own_ai_cost_usd` is a documented LOWER BOUND upstream (docs-ai-ask and docs-search have no
 *  single page and are excluded by design) and `ai_cost_usd`, which IS mirrored, is recomputed
 *  and overwritten from the linked issues on every sweep. Rendering either as "the cost of this
 *  document" is a claim decision this app has not made — see deploy/decision-expiry.sh, where
 *  that premise is already registered. Mirroring them here would put the number one `.tsx` away
 *  from a screen, which is not a shape decision.
 *  UPSTREAM-ONLY DocsPage: own_ai_cost_usd, total_ai_cost_usd */
export interface DocsPage {
  id: string
  space_id: string
  workspace_id: string
  parent_id?: string | null
  title: string
  slug: string
  content: string
  content_text: string
  icon: string
  cover_url: string
  position: number
  depth: number
  is_template: boolean
  created_by: string
  updated_by: string
  linked_issues?: string[]
  ai_cost_usd: number
  view_count: number
  last_viewed_at?: string | null
  last_verified_at?: string | null
  verified_by?: string | null
  stale_after_days: number
  doc_status?: string
  locked: boolean
  locked_by?: string | null
  locked_at?: string | null
  page_type?: string
  created_at: string
  updated_at: string
}

/**
 * Reads the upstream's own `code` off a FAILING response, so a caller can tell two errors that
 * share a status apart. See ApiError#code — on this area's AI route 503 means "no Docs upstream
 * here" from the BFF and "Docs has no Lens credential" from Docs, and only the code separates
 * them.
 *
 * A body that is not JSON, or one with no `code`, leaves it undefined: the status is then the
 * whole diagnosis, which is what it was before this existed. The parse failure is deliberately
 * not surfaced — this is reading an OPTIONAL hint off an error that is already being thrown, and
 * turning a malformed error body into a second, different error would replace the real failure
 * with a parsing one.
 */
async function failure(res: Response, path: string): Promise<ApiError> {
  let code: string | undefined
  try {
    const body: unknown = await res.json()
    const c = (body as { code?: unknown } | null)?.code
    if (typeof c === 'string' && c !== '') code = c
  } catch {
    // not JSON — no code to read
  }
  return new ApiError(res.status, path, code)
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' } })
  // The shared ApiError, so a 401 here trips App.tsx's QueryCache handler and
  // re-probes the auth gate exactly like every live area.
  if (!res.ok) throw await failure(res, path)
  return (await res.json()) as T
}

/** A page as the list route returns it (content projected away by the BFF). */
export interface DocsPageRow {
  id: string
  title: string
}

async function send<T>(path: string, method: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw await failure(res, path)
  return res.json() as Promise<T>
}

/** One grounding source Docs cited for an answer. `url` is a path in DOCS' OWN frontend. */
export interface AskSource {
  title: string
  url: string
}

/** POST /api/docs/ai/ask → talyvor-docs askResponse (internal/ai/handler.go).
 *
 *  ⚠ IT CARRIES NO COST, AND THAT IS UPSTREAM'S SHAPE RATHER THAN AN OMISSION HERE. The response
 *  is `{answer, sources}` and nothing else. Engine.AskDocs passes an EMPTY page id — "an answer
 *  drawn from several pages belongs to none of them" — so no page_ai_spend_events row is written
 *  and no page's own_ai_cost_usd moves either. What an ask cost is visible only in the workspace's
 *  Lens spend, under the feature tag `docs-ai-ask`. A per-answer number would have to be invented,
 *  so none is shown. */
export interface AskAnswer {
  answer: string
  sources: AskSource[]
}

/** POST /api/docs/pages/{pageID}/summarize → talyvor-docs' transform response, which is
 *  `{"text": …}` and nothing else (internal/ai/handler.go#Transform).
 *
 *  ⚠ ITS COST IS THE OPPOSITE OF AN ASK'S, AND THAT IS WHY THIS TYPE IS NOT `AskAnswer`. Ask
 *  passes an empty page id upstream and no page's AI cost moves. Summarise NAMES the page, so
 *  Engine.run binds Lens's request id to it and the charge later lands on that page's
 *  `own_ai_cost_usd` under the feature tag `docs-ai-summarize`. The response still carries no
 *  number — this app has no per-call figure to show and will not invent one — but the sentence a
 *  screen must print beside it is a different sentence. */
export interface DocsSummary {
  text: string
}

/** POST /api/docs/pages/{pageID}/translate → talyvor-docs' translate response, which is
 *  `{"text": …}` and nothing else (internal/ai/handler.go#Handler.Translate).
 *
 *  ⚠ IT IS A DISTINCT TYPE FROM `DocsSummary` DESPITE AN IDENTICAL SHAPE, because the sentence a
 *  screen must print beside it is different: this charge lands under the feature tag
 *  `docs-ai-translate`, and — unlike a summary — the reader cannot tell from the text alone
 *  whether the language they asked for is the language they got. */
export interface DocsTranslation {
  text: string
}

/** POST /api/docs/pages/{pageID}/suggest-title → talyvor-docs' suggest-title response, which is
 *  `{"title": …}` and nothing else (internal/ai/handler.go#Handler.SuggestTitle).
 *
 *  ⚠ IT IS A DISTINCT TYPE FROM `DocsSummary` AND `DocsTranslation` DESPITE THE SAME ONE-FIELD
 *  SHAPE, and the field is `title`, not `text` — those two answer with prose a screen prints and
 *  forgets; this one answers with a value a screen may WRITE BACK into the document.
 *
 *  ⚠⚠ THE TITLE CAN BE EMPTY, AND THAT IS A 200. Engine.SuggestTitle trims ` \t\n"'` off the
 *  completion and returns what is left, so a model answering `""`, `"''"` or `"\n\n"` yields
 *  `{"title":""}` — MEASURED against docs' own handler over a fake Lens, five completion shapes,
 *  all `{"title":""}`. The completion is bought by then, so neither the BFF nor this client turns
 *  it into an error; the refusal lives at the button that would otherwise write an empty title over
 *  a real one (PageTitleSuggestion.tsx). A caller that assumes this string is non-empty is wrong. */
export interface DocsTitleSuggestion {
  title: string
}

/** POST /api/docs/spaces/{spaceID}/pages/{pageID}/changelog/generate → the changelog entry
 *  talyvor-docs CREATED (internal/changelog/handler.go#Handler.Generate → Store.CreateEntry,
 *  201 with the row).
 *
 *  ⚠ THIS IS THE ONE DOCS RESPONSE IN THIS FILE THAT DESCRIBES A ROW RATHER THAN AN ANSWER. The
 *  other four W1.7 controls return text a screen displays and forgets. This one persists: the
 *  entry it describes is on the page until something deletes it, and `…/entries/{id}/publish`
 *  puts it into the workspace's public RSS feed. So the fields worth mirroring are the ones that
 *  say WHAT WAS WRITTEN — `summary` carries upstream's own count ("Generated from N issues"),
 *  which is the honest oracle for whether the entry documents anything.
 *
 *  UPSTREAM-ONLY DocsChangelogEntry: workspace_id, content, created_by, created_at?,
 *  published_at? — `content` is a ProseMirror JSON document this app has no renderer for (the
 *  editor question W2.3 owns), and the other four are provenance no screen here shows. */
export interface DocsChangelogEntry {
  id: string
  page_id: string
  version: string
  title: string
  summary: string
  type: string
  issue_ids: string[]
}

export const docsApi = {
  /** LIVE — spaces in the SESSION's workspace (the BFF no longer pins one). */
  spaces: (): Promise<DocsSpace[]> => getJSON<DocsSpace[]>('/api/docs/spaces'),

  /**
   * Creates a space in the SESSION's workspace.
   *
   * ⚠ `name` is the field Docs reads (model.Space, `json:"name"`) — it is required, and a wrong key
   * would not error, it would decode to "" and be refused as an empty name. `slug`, `icon` and
   * `color` are DERIVED and defaulted by Docs' own store, so nothing is invented here.
   *
   * ⚠ NO workspace_id. Docs takes it from the body on this route and the BFF injects the pinned one
   * — a workspace this client named would be a workspace the browser chose.
   */
  createSpace: (name: string) => send<DocsSpace>('/api/docs/spaces', 'POST', { name }),

  page: (spaceId: string, pageId: string): Promise<DocsPageRow & { content_text?: string }> =>
    getJSON(`/api/docs/spaces/${encodeURIComponent(spaceId)}/pages/${encodeURIComponent(pageId)}`),

  pages: (spaceId: string): Promise<DocsPageRow[]> =>
    getJSON<DocsPageRow[]>(`/api/docs/spaces/${encodeURIComponent(spaceId)}/pages`),

  /** Docs owns the schema; the BFF forwards this body verbatim. */
  createPage: (spaceId: string, title: string) =>
    send<DocsPageRow>(`/api/docs/spaces/${encodeURIComponent(spaceId)}/pages`, 'POST', { title }),

  /**
   * Ask the workspace's documentation a question.
   *
   * ⚠ THE KEY IS THE CLAIM HERE, AND THIS IS THE ONLY PLACE THAT MAKES IT. The BFF forwards this
   * body VERBATIM (apps/bff/docs_ai.go#docsAskAI), so unlike summarise / translate / suggest-title
   * there is no Go struct between this object and talyvor-docs — one renamed key here IS the wire.
   * Docs binds `question` and, measured against its own handler over a Lens that counts
   * completions, REFUSES every other spelling before the money moves (`{"q":…}`, `{"text":…}`,
   * `{"query":…}`, `{}`, `{"question":""}` → 400, 0 completions), which is what separates this
   * route from suggest-title, where the wrong key was a 200 and a billed completion. That refusal
   * is upstream's and can be withdrawn upstream, so the key is registered rather than trusted.
   * UPSTREAM-BINDS-ONLY ask: none
   *
   * ⚠ NO workspace_id, and no page id either. The BFF builds the upstream path from the SESSION's
   * workspace (docs_ai.go), and Docs grounds the answer in the pages this caller may VIEW — the
   * client names neither, because a workspace the browser could name is a workspace the browser
   * could choose.
   */
  ask: (question: string) => send<AskAnswer>('/api/docs/ai/ask', 'POST', { question }),

  /**
   * Search this workspace's documents — full text and, where Lens is wired, semantic.
   *
   * ⚠ IT RETURNS `unknown` ON PURPOSE, AND THAT IS THE ONLY SHAPE THIS FILE IS WILLING TO PROMISE.
   * Every other read here declares an interface because a wrong field would be visible as a wrong
   * value; on this one the whole diagnosis lives in the SHAPE — `{results:[]}` and a renamed
   * `results` are the same "nothing to show" to a typed cast and opposite facts to a reader. So
   * the parse is a decision (readSearch in ./search), not an assertion, and the type says so.
   *
   * ⚠ NO `type`, NO `offset`. The BFF accepts both (docs_search.go, which refuses the values
   * upstream answers with a confident empty list); this caller sends neither. An absent type is
   * upstream's own default and a default written here would be a second author of it; an absent
   * offset is why this card never reaches the 50-row merged window the BFF refuses.
   */
  search: (q: string): Promise<unknown> => getJSON<unknown>(`/api/docs/search?q=${encodeURIComponent(q)}`),

  /**
   * Summarise ONE page's stored text.
   *
   * ⚠ NO `action`, AND NO `page_id` IN THE BODY. Upstream is one transform route with four
   * actions and a body-named page; the BFF fixes the action and takes the page from the path
   * (docs_ai.go#docsSummarizePage), because both are authority rather than content — the action
   * decides what the workspace pays for, and the page id decides which document the charge lands
   * on. A body this client wrote is a body this client chose.
   *
   * ⚠ THE TEXT IS THE PAGE AS STORED, NOT WHAT IS IN THE EDITOR — the caller's job, stated here
   * because it is the whole reason the cost claim is honest. The charge lands on this page, so the
   * bytes sent must be this page's; summarising an unsaved draft would bill a document for words
   * it does not contain.
   */
  summarizePage: (pageId: string, text: string) =>
    send<DocsSummary>(`/api/docs/pages/${encodeURIComponent(pageId)}/summarize`, 'POST', { text }),

  /**
   * Translate ONE page's stored text into a named language.
   *
   * ⚠⚠ THE FIELD IS `language`, AND THAT IS NOT A STYLE CHOICE. talyvor-docs binds
   * `json:"language"` (internal/ai/handler.go#Handler.Translate). A body naming it anything else
   * is NOT rejected: it decodes to "", Engine.Translate substitutes `defaultLang = "English"`, and
   * the caller gets 200, a billed Lens completion, and English. MEASURED against docs' own handler
   * over a fake Lens that captures the system prompt — `target_language:"French"` produced
   * "…translate the following text to English…". Docs' own in-repo fixture sends that wrong name.
   *
   * So a wrong key here is invisible from the response, which is why the BFF's guard decodes the
   * SENT body through docs' struct tags rather than asserting a status (docs_translate_test.go).
   *
   * ⚠ NO `page_id` IN THE BODY. The BFF takes the page from the path
   * (docs_ai.go#docsTranslatePage) because it is authority, not content — it decides which
   * document the charge lands on.
   *
   * ⚠ NO DEFAULT LANGUAGE, AND THIS CLIENT WILL NOT INVENT ONE. A blank language is exactly the
   * case that silently costs money and answers in the wrong tongue; the BFF refuses it and
   * PageTranslation.tsx never sends it.
   *
   * ⚠ THE TEXT IS THE PAGE AS STORED, NOT WHAT IS IN THE EDITOR — the caller's job, stated here
   * because it is the whole reason the cost claim is honest.
   */
  translatePage: (pageId: string, text: string, language: string) =>
    send<DocsTranslation>(`/api/docs/pages/${encodeURIComponent(pageId)}/translate`, 'POST', {
      text,
      language,
    }),

  /**
   * Suggest a title for ONE page from its stored text.
   *
   * ⚠⚠ THE FIELD IS `text` HERE AND `content` ON THE WIRE, AND THE RENAME IS DELIBERATE. Upstream
   * binds `json:"content"` (internal/ai/handler.go#Handler.SuggestTitle) while both sibling AI
   * routes bind `text` — so `text` is exactly what a caller copying either of them would send, and
   * upstream a wrong key is NOT an error: it decodes to "", the model is asked to title a page it
   * never read, and the caller gets 200 and a billed completion. MEASURED against docs' own handler
   * over a fake Lens that counts completions. The BFF owns the rename so this app has ONE name for
   * "the page's stored text", and docs_suggesttitle_test.go pins it by decoding the SENT body
   * through docs' own struct tags — a status assertion could not tell the two apart.
   *
   * ⚠ NO `page_id` IN THE BODY. The BFF takes the page from the path
   * (docs_ai.go#docsSuggestTitlePage) because it is authority, not content — it decides which
   * document the charge lands on, and upstream an absent page_id is a 200 whose charge no page
   * accounts for.
   *
   * ⚠ THE TEXT IS THE PAGE AS STORED, NOT WHAT IS IN THE EDITOR — the caller's job, stated here
   * because it is the whole reason the cost claim is honest.
   *
   * ⚠ THIS DOES NOT WRITE THE TITLE. Applying it is `updatePage(spaceId, pageId, { title })`, a
   * separate call with a separate gate. Suggesting spends money; applying changes a document.
   */
  suggestTitle: (pageId: string, text: string) =>
    send<DocsTitleSuggestion>(`/api/docs/pages/${encodeURIComponent(pageId)}/suggest-title`, 'POST', {
      text,
    }),

  /**
   * Generate ONE changelog entry on a page from a list of Track issue ids.
   *
   * ⚠⚠ THIS ONE IS NOT AN AI CALL AND SPENDS NOTHING, WHICH IS WHY IT IS SHAPED UNLIKE THE FOUR
   * ABOVE. W1.7 lists changelog generation among eight "metered Lens calls"; measured against
   * talyvor-docs' own route, it reaches Lens never — `GenerateFromIssues` reads Track issues and
   * groups them by label. What a click costs is a durable, publishable ROW, not a charge.
   *
   * ⚠ NO `workspace_id` IN THE BODY. Upstream's `generateBody` has the field and OVERRIDES it
   * from the page's own context (`in.WorkspaceID = ws`), so sending one changes nothing — which
   * is exactly why it must not be sent. A field that travels the whole way and is ignored is
   * decoration a reader can mistake for tenancy. The BFF drops it too (docs_changelog.go).
   *
   * ⚠ THE CALLER SENDS A FILTERED LIST, AND THE BFF RE-CHECKS IT. Measured, an empty list — and a
   * list of blank strings — are both 201 Created upstream, the first writing "Generated from 0
   * issues" over the words "No issues.", the second claiming three issues over three empty
   * bullets. Neither is an error there, so the refusal lives at the button and again at the BFF,
   * which is the half that holds when the caller is not this screen.
   *
   * ⚠ NO VERSION RULE HERE. Upstream has a real regexp and answers for itself (400 for "",
   * "   " and "banana"; 201 for "v1.0.0" and "2026-08-18"), so a second rule in this client would
   * drift from it the day Docs widens the pattern.
   */
  generateChangelog: (spaceId: string, pageId: string, version: string, issueIds: string[]) =>
    send<DocsChangelogEntry>(
      `/api/docs/spaces/${encodeURIComponent(spaceId)}/pages/${encodeURIComponent(pageId)}/changelog/generate`,
      'POST',
      { version, issue_ids: issueIds },
    ),

  updatePage: (spaceId: string, pageId: string, patch: { title?: string; content_text?: string }) =>
    send<DocsPageRow>(
      `/api/docs/spaces/${encodeURIComponent(spaceId)}/pages/${encodeURIComponent(pageId)}`,
      'PATCH',
      patch,
    ),
}
