package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

// maxDocsAskBody caps an ask-AI request. It is deliberately MUCH smaller than maxDocsBody: that
// cap exists for a ProseMirror document on its way to a page write, and a question is not a
// document. Docs validates the payload itself; this only bounds what is buffered on the way
// through, and bounds it at the size of the thing actually being sent.
const maxDocsAskBody = 8 << 10

// docsAskAI — POST /api/docs/ai/ask → POST /v1/workspaces/{ws}/ai/ask on the Docs upstream.
//
// ⚠ THIS IS THE FIRST BROWSER CONTROL FOR ANY AI FEATURE IN THIS PRODUCT. Docs ships eight of
// them (write, transform, translate, ask, suggest-title, plus search) and until now every one was
// reachable only by curl: no route here named `/ai/`, and no file under apps/web/src did either.
//
// ⚠ THE UPSTREAM PATH IS WORKSPACE-SCOPED AND THE WORKSPACE IS THE SESSION'S. Docs registers
// `/workspaces/{wsID}/ai/ask` (internal/ai/handler.go Mount) and authorizes {wsID} against the
// caller's membership before the question reaches the engine. The id is never read from the body
// — a workspace the browser could name is a workspace the browser could choose, which is the rule
// docsSpaceCreateBody exists for.
//
// ⚠ THE BODY GOES UP VERBATIM, including fields this file does not know. Docs owns the schema
// (`{"question": …}` today); re-encoding here would invent a second schema to drift from. The one
// thing this handler does that forwardProduct would not is read the body first, so an oversize
// request is refused as 413 rather than failing inside the forward and being reported as
// "docs upstream unreachable" — a false statement about a healthy upstream.
//
// ⚠ COST. This operation is metered by Lens and attributed to NO PAGE, by upstream design:
// Engine.AskDocs passes an empty page id ("an answer drawn from several pages belongs to none of
// them"), so nothing lands in page_ai_spend_events and no page's own_ai_cost_usd moves. Its cost
// is visible only in the workspace's Lens spend under the feature tag `docs-ai-ask`. Any screen
// that wants to show what an answer cost must say that, and must not read it off a page.
func (a *app) docsAskAI() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodPost)
			return
		}
		ws, ok := a.docsWorkspaceFor(w, r)
		if !ok {
			return
		}
		raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxDocsAskBody))
		if err != nil {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{
				"error": "question too large"})
			return
		}
		a.forwardProduct(w, r, "docs", a.cfg.docsBaseURL, a.cfg.docsGatewaySecret,
			docsWorkspacePath(ws, "/ai/ask"), "", http.MethodPost,
			strings.NewReader(string(raw)), nil)
	})
}

// docsSummarizeAction is the ONE action this BFF exposes of the four talyvor-docs' transform route
// dispatches (summarize / grammar / shorter / longer, internal/ai/handler.go#Transform).
//
// ⚠ IT IS A CONSTANT HERE RATHER THAN A PARAMETER, AND THAT IS THE ROUTE'S MAIN DECISION. The
// other three REWRITE text for insertion, and this app has nowhere to put the result: the only
// editable box in the reader writes `content_text`, the search projection Docs DERIVES from the
// document — a write path whose semantics are an open product decision (see the queue's W1.1 note
// and areas/docs/EDITOR-SIZING.md). Landing model output there would settle that decision
// sideways. A summary is different in kind: it is READ, not inserted, so it needs no editor at all
// — which is why this is the one that could be built now.
const docsSummarizeAction = "summarize"

// docsSummarizeBody is the upstream schema, built HERE. Every other Docs route in this BFF
// forwards the caller's body verbatim, and each of them says why; this one does not, because two
// of the three fields are authority, not content: `action` chooses which operation the workspace
// pays for, and `page_id` is what Docs binds the COST to (Engine.run → BindAISpend → later
// `UPDATE pages SET own_ai_cost_usd …`). A body the browser writes is a body the browser chooses.
//
// The keys Docs' Transform BINDS that this route deliberately does not send. Asked of a deployer
// by deploy/decision-expiry.sh and held to this declaration by aiRequestBodyRegister.test.ts — an
// absent key on these routes is a DEFAULT, not a refusal, so an omission is a decision.
// UPSTREAM-BINDS-ONLY docsSummarizeBody: none
type docsSummarizeBody struct {
	Action string `json:"action"`
	Text   string `json:"text"`
	PageID string `json:"page_id"`
}

// docsSummarizePage — POST /api/docs/pages/{pageID}/summarize → POST /v1/workspaces/{ws}/ai/transform.
//
// ⚠⚠ THE EMPTY-PAGE REFUSAL IS THE FINDING, AND IT WAS MEASURED UPSTREAM RATHER THAN ASSUMED.
// talyvor-docs at e70ff61, its own Transform handler mounted in a scratch copy over a fake Lens
// that COUNTS completions (tab-7b42; that repo was held by another tab and was never written to):
//
//	{"action":"summarize","text":"",         "page_id":"pg-1"} → 200, completions 0→1, user bytes 0
//	{"action":"summarize","text":"   \n\t  ","page_id":"pg-1"} → 200, completions 1→2, user bytes 7
//
// Nothing on that path has an empty-content precondition — Transform switches on the action and
// Engine.run's only gate is IsAvailable() — so summarising a blank page is a real metered Lens
// completion, attributed to that page, that summarises nothing. Refused here, before the money
// moves. THE REFUSAL IS EXACTLY AS WIDE AS THE MEASUREMENT: empty after trimming, and nothing
// else. "Too short to be worth summarising" would be a product threshold invented in a proxy.
//
// ⚠ THE CAP IS maxDocsBody, THE PAGE CAP — not maxDocsAskBody, the question cap. What travels here
// is a page's stored text, so any page this BFF would accept a WRITE of is one it will accept a
// summarise of. Upstream has no cap at all: in the same harness a 2 MiB text reached Lens whole.
//
// ⚠ THE PAGE ID IS A PATH SEGMENT, WHICH IS WHY IT CANNOT ARRIVE EMPTY. Upstream, an empty
// `page_id` is explicitly ALLOWED and gated by nothing — attributable() returns early on it — so
// an empty id does not fail, it silently produces an UNATTRIBUTED charge. ServeMux only matches
// `{pageID}` against a non-empty segment, so the shape of the route is what forbids that, and
// docs_summarize_test.go drives the empty-segment address to keep it that way.
//
// ⚠ COST, AND IT IS THE OPPOSITE OF ASK'S. Ask passes an empty page id by upstream design, so no
// page's AI cost moves. This one names the page, so the charge DOES land on it: Lens meters the
// completion under the feature tag `docs-ai-summarize` and Docs rolls it onto that page's
// `own_ai_cost_usd`. Any screen offering this button must say that, and must not imply the
// summary is free.
func (a *app) docsSummarizePage() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodPost)
			return
		}
		ws, ok := a.docsWorkspaceFor(w, r)
		if !ok {
			return
		}
		raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxDocsBody))
		if err != nil {
			// 413 rather than a failure inside the forward, which reads from the outside as
			// "docs upstream unreachable" — a false statement about a healthy upstream.
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{
				"error": "page text too large to summarise"})
			return
		}
		var in struct {
			Text string `json:"text"`
		}
		if err := json.Unmarshal(raw, &in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad json"})
			return
		}
		if strings.TrimSpace(in.Text) == "" {
			// NOT a fault: nothing is broken and nothing is missing — there is simply nothing
			// to summarise. Upstream would answer 200 to this and bill for it.
			writeJSON(w, http.StatusBadRequest, map[string]string{
				"error": "there is no text on this page to summarise"})
			return
		}
		payload, err := json.Marshal(docsSummarizeBody{
			Action: docsSummarizeAction,
			Text:   in.Text,
			PageID: r.PathValue("pageID"),
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{
				"error": "could not build the summarise request"})
			return
		}
		a.forwardProduct(w, r, "docs", a.cfg.docsBaseURL, a.cfg.docsGatewaySecret,
			docsWorkspacePath(ws, "/ai/transform"), "", http.MethodPost,
			bytes.NewReader(payload), nil)
	})
}

// docsSuggestTitleBody is the upstream schema, built HERE for the same reason summarise's and
// translate's are: `page_id` is authority rather than content — it decides which document the
// charge lands on — and it comes from this route's path.
//
// ⚠⚠ THE CONTENT FIELD IS NAMED `content`, AND ON THIS ROUTE THE WRONG NAME IS THE ONE ITS OWN
// SIBLINGS USE. talyvor-docs binds ``Content string `json:"content"``
// (internal/ai/handler.go#Handler.SuggestTitle). Summarise and translate both call it `text`, in
// this app AND on the wire, so `text` is what a caller copying either of them would send — and
// upstream that is not an error.
//
// MEASURED, NOT READ (tab-2f4d, talyvor-docs at f515db8, a `git archive` scratch export in /tmp;
// that repo was held by tab-4d19 and was never written to). Its real SuggestTitle handler mounted
// over a fake Lens that COUNTS completions and captures the user content:
//
//	{"content":"Some real page text…","page_id":"pg-1"} → 200, 1 completion, 34 user bytes
//	{"page_id":"pg-1"}                                  → 200, 1 completion,  0 user bytes
//	{"content":"","page_id":"pg-1"}                     → 200, 1 completion,  0 user bytes
//	{"content":"   \n\t  ","page_id":"pg-1"}            → 200, 1 completion,  7 user bytes
//	{"text":"Some real page text.","page_id":"pg-1"}    → 200, 1 completion,  0 user bytes
//	{"content":"Some real page text."}                  → 200, 1 completion, 20 user bytes
//
// Every row is a 200 and a real billed completion tagged `docs-ai-title`. Rows two to five buy a
// title for a page the model never read; row six buys one no page accounts for. Nothing in the
// status can separate them, which is why docs_suggesttitle_test.go decodes the SENT body through
// these same struct tags rather than asserting a response.
//
// The keys Docs' SuggestTitle BINDS that this route deliberately does not send. This is the route
// whose key was the finding, so the declaration is not a formality: `content` here and `text` on
// its two siblings, and upstream neither refuses the other.
// UPSTREAM-BINDS-ONLY docsSuggestTitleBody: none
type docsSuggestTitleBody struct {
	Content string `json:"content"`
	PageID  string `json:"page_id"`
}

// docsSuggestTitlePage — POST /api/docs/pages/{pageID}/suggest-title →
// POST /v1/workspaces/{ws}/ai/suggest-title.
//
// ⚠ THE SIXTH OF W1.7'S EIGHT AI CONTROLS, AND THE FIRST WHOSE OUTPUT IS MEANT TO BE WRITTEN BACK.
// That is why it could be built while `shorter`, `longer` and `grammar` still cannot: those three
// replace the DOCUMENT, and the only editable box in this app writes `content_text`, the search
// projection Docs derives — an open product decision (W2.3, areas/docs/EDITOR-SIZING.md) that a
// model's output must not settle sideways. A title is a column of its own, already in Docs'
// `updatableFields`, and this app already PATCHes it (docsUpdatePage). So the suggestion has
// somewhere honest to land without touching the question the editor owns.
//
// ⚠ THIS ROUTE DOES NOT WRITE IT. Suggesting costs money; applying changes a document. Doing both
// in one call would make a single click an unreviewable spend-and-mutate, and would put the write
// behind a gate (this route's) that is not the write's own. The screen shows the suggestion and
// the existing PATCH applies it.
//
// ⚠ BLANK TEXT IS REFUSED BEFORE THE MONEY MOVES — rows two to four above, re-measured on THIS
// route rather than inherited from its siblings. The refusal is EXACTLY as wide as the
// measurement: empty after trimming, and nothing else. "Too short to deserve a title" would be a
// product threshold invented in a proxy.
//
// ⚠ AN EMPTY SUGGESTION IS PASSED THROUGH AS ITSELF. Engine.SuggestTitle trims ` \t\n"'` off the
// completion and returns what is left, so a model answering `""`, `"''"` or `"\n\n"` yields
// `{"title":""}` with a 200 — measured, five completion shapes, all `{"title":""}`. By then the
// completion is bought. Turning it into a 502 here would report a healthy upstream as broken and
// hide a charge the workspace has taken; the refusal belongs at the button that would otherwise
// write that empty title over a real one (PageTitleSuggestion.tsx).
//
// ⚠ THE PAGE ID GOES THROUGH pathID, WHICH IS STRICTER THAN THE TWO SIBLING AI ROUTES. They pass
// r.PathValue straight into the body; this one refuses "", ".", "..", separators and control
// characters the way every other id-bearing route here does (docsSpaceDetail, docsUpdatePage).
// Upstream an empty page_id does not fail — attributable() returns early on it — so it produces a
// completion the workspace pays for and no page accounts for.
//
// ⚠ THE CAP IS maxDocsBody, THE PAGE CAP, for summarise's reason: what travels is a page's stored
// text. Upstream has no cap at all.
//
// ⚠ COST. Lens meters this under the feature tag `docs-ai-title` and Docs rolls it onto the named
// page's `own_ai_cost_usd`. Any screen offering this button must say so.
func (a *app) docsSuggestTitlePage() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodPost)
			return
		}
		pageID, ok := pathID(w, "pageID", r.PathValue("pageID"))
		if !ok {
			return
		}
		ws, ok := a.docsWorkspaceFor(w, r)
		if !ok {
			return
		}
		raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxDocsBody))
		if err != nil {
			// 413 rather than a failure inside the forward, which reads from the outside as
			// "docs upstream unreachable" — a false statement about a healthy upstream.
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{
				"error": "page text too large to title"})
			return
		}
		var in struct {
			Text string `json:"text"`
		}
		if err := json.Unmarshal(raw, &in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad json"})
			return
		}
		if strings.TrimSpace(in.Text) == "" {
			// NOT a fault: nothing is broken and nothing is missing — there is simply nothing to
			// title. Upstream would answer 200 to this and bill for it, having read no page.
			writeJSON(w, http.StatusBadRequest, map[string]string{
				"error": "there is no text on this page to suggest a title from"})
			return
		}
		payload, err := json.Marshal(docsSuggestTitleBody{Content: in.Text, PageID: pageID})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{
				"error": "could not build the suggest-title request"})
			return
		}
		a.forwardProduct(w, r, "docs", a.cfg.docsBaseURL, a.cfg.docsGatewaySecret,
			docsWorkspacePath(ws, "/ai/suggest-title"), "", http.MethodPost,
			bytes.NewReader(payload), nil)
	})
}

// docsTranslateBody is the upstream schema, built HERE for the same reason summarise's is: two of
// the three fields are authority rather than content. `page_id` is what Docs binds the COST to,
// and it comes from this route's path.
//
// ⚠⚠ THE FIELD NAME IS NOT A DETAIL — IT IS THE WHOLE FINDING. talyvor-docs' Translate handler
// binds `Language string `json:"language"`` (internal/ai/handler.go#Handler.Translate). A body that names
// this field anything else is not rejected: the field decodes to "", Engine.Translate substitutes
// `defaultLang = "English"` (internal/ai/engine.go#Engine.Translate, via the defaultLang constant), and the caller gets 200, a billed Lens
// completion, and English.
//
// Docs' own in-repo fixture gets this wrong: internal/ai/handler_test.go's sibling-routes loop sends
// `{"text":"hello","target_language":"French"}` and asserts only that the status is 200 — which it
// is, in English. That test is green and would stay green with the binding deleted.
//
// MEASURED, NOT READ (tab-7c3e, talyvor-docs at 6aca7db, a `git archive` scratch export in /tmp;
// that repo was held by tab-a7f3 and was never written to). Its real Translate handler mounted
// over a fake Lens that captures the SYSTEM PROMPT — the only place the target language actually
// lands:
//
//	{"text":"hello","target_language":"French"} → 200, 1 completion, "…to English…"
//	{"text":"hello","language":"French"}        → 200, 1 completion, "…to French…"
//	{"text":"hello"}                            → 200, 1 completion, "…to English…"
//	{"text":"hello","language":""}              → 200, 1 completion, "…to English…"
//	{"text":"hello","language":"   "}           → 200, 1 completion, "…to English…"
//	{"text":"","language":"French"}             → 200, 1 completion, 0 user bytes
//
// docs_translate_test.go pins the name by decoding the SENT body through these same tags, because
// every row above is a 200 and no status assertion can separate them.
//
// The keys Docs' Translate BINDS that this route deliberately does not send. `language` is the
// reason this declaration is required rather than inferred: omitting it is not "no language", it
// is Engine.Translate's `defaultLang = "English"` and a billed completion nobody asked for.
// UPSTREAM-BINDS-ONLY docsTranslateBody: none
type docsTranslateBody struct {
	Text     string `json:"text"`
	Language string `json:"language"`
	PageID   string `json:"page_id"`
}

// docsTranslatePage — POST /api/docs/pages/{pageID}/translate → POST /v1/workspaces/{ws}/ai/translate.
//
// ⚠⚠ A BLANK LANGUAGE IS REFUSED HERE, BEFORE THE MONEY MOVES, and that refusal is this route's
// reason to differ from a plain forward. Upstream has no precondition on the language at all —
// blank silently becomes English and bills for it (rows 3-5 above). A button is what turns that
// from a thing curl can do into a thing a click does, so the refusal lands with the button.
//
// ⚠ THE REFUSAL IS EXACTLY AS WIDE AS THE MEASUREMENT: blank after trimming, and nothing else.
// This route does NOT check the language against a vocabulary — Docs has no vocabulary either, it
// interpolates the string straight into a prompt — so "fr", "Français" and "Brazilian Portuguese"
// all travel verbatim. A whitelist here would be a proxy inventing a product rule.
//
// ⚠ THE EMPTY-TEXT REFUSAL IS THE SAME RULE summarise records, RE-MEASURED ON THIS ROUTE rather
// than inherited: row six is a real completion on zero user bytes.
//
// ⚠ THE CAP IS maxDocsBody, THE PAGE CAP, for summarise's reason — what travels is a page's stored
// text. Upstream has no cap at all.
//
// ⚠ COST. Lens meters this under the feature tag `docs-ai-translate` and Docs rolls it onto the
// named page's `own_ai_cost_usd`. Any screen offering this button must say so.
func (a *app) docsTranslatePage() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodPost)
			return
		}
		ws, ok := a.docsWorkspaceFor(w, r)
		if !ok {
			return
		}
		raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxDocsBody))
		if err != nil {
			// 413 rather than a failure inside the forward, which reads from the outside as
			// "docs upstream unreachable" — a false statement about a healthy upstream.
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{
				"error": "page text too large to translate"})
			return
		}
		var in struct {
			Text     string `json:"text"`
			Language string `json:"language"`
		}
		if err := json.Unmarshal(raw, &in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad json"})
			return
		}
		if strings.TrimSpace(in.Text) == "" {
			// NOT a fault: nothing is broken, there is simply nothing to translate. Upstream
			// would answer 200 to this and bill for it.
			writeJSON(w, http.StatusBadRequest, map[string]string{
				"error": "there is no text on this page to translate"})
			return
		}
		if strings.TrimSpace(in.Language) == "" {
			// The one refusal that is not shared with summarise. Upstream does not fail on a
			// missing language — it quietly translates to English and charges for it, which is
			// indistinguishable from success at the status code.
			writeJSON(w, http.StatusBadRequest, map[string]string{
				"error": "choose a language to translate this page into"})
			return
		}
		payload, err := json.Marshal(docsTranslateBody{
			Text:     in.Text,
			Language: in.Language,
			PageID:   r.PathValue("pageID"),
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{
				"error": "could not build the translate request"})
			return
		}
		a.forwardProduct(w, r, "docs", a.cfg.docsBaseURL, a.cfg.docsGatewaySecret,
			docsWorkspacePath(ws, "/ai/translate"), "", http.MethodPost,
			bytes.NewReader(payload), nil)
	})
}
