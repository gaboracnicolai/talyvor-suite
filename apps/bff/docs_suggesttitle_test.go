package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// THE SUGGEST-TITLE ROUTE — the sixth of W1.7's eight AI controls, and the first whose output is
// meant to be WRITTEN BACK rather than read and forgotten.
//
// ⚠⚠ (1) THE FIELD NAME IS THE SAME CLASS OF FINDING AS TRANSLATE'S, AND HERE THE WRONG NAME IS
// THE ONE THIS APP'S OWN SIBLINGS USE. talyvor-docs' SuggestTitle handler binds
// `Content string \`json:"content"\`` (internal/ai/handler.go#Handler.SuggestTitle). Summarise and
// translate both take `text` — from the browser AND on the wire — so `text` is exactly what a
// caller copying either of them would send, and upstream a wrong key is not an error.
//
// MEASURED, NOT READ (tab-2f4d, talyvor-docs at f515db8, a scratch `git archive` export in /tmp —
// that repo was held by tab-4d19 and was never written to). Docs' real handler mounted over a fake
// Lens that COUNTS completions and captures the user content:
//
//	{"content":"Some real page text…","page_id":"pg-1"} → 200, 1 completion, 34 user bytes
//	{"page_id":"pg-1"}                                  → 200, 1 completion,  0 user bytes
//	{"content":"","page_id":"pg-1"}                     → 200, 1 completion,  0 user bytes
//	{"content":"   \n\t  ","page_id":"pg-1"}            → 200, 1 completion,  7 user bytes
//	{"text":"Some real page text.","page_id":"pg-1"}    → 200, 1 completion,  0 user bytes
//	{"content":"Some real page text."}                  → 200, 1 completion, 20 user bytes
//
// Every row is a 200 with a real billed completion under the feature tag `docs-ai-title`. Rows two
// to five buy a title for a page whose text the model never saw. So the status code cannot
// separate a suggestion from a hallucination bought on nothing, which is why this file decodes the
// SENT body through docs' own struct tags instead of asserting a response.
//
// ⚠⚠ (2) BLANK TEXT IS REFUSED HERE, BEFORE THE MONEY MOVES — the same rule summarise and
// translate record, RE-MEASURED on this route rather than inherited from theirs (rows two to four).
//
// ⚠⚠ (3) THE LAST ROW IS WHY THE PAGE ID IS A PATH SEGMENT. Upstream an absent `page_id` is
// explicitly allowed — attributable() returns early on it — so it does not fail, it produces a
// completion the workspace pays for and NO page accounts for.
//
// ⚠ WHAT THIS ROUTE DOES **NOT** DO: it does not write the title. The suggestion comes back and the
// screen decides; the write is the existing PATCH (docsUpdatePage), which already carries its own
// gate. Two operations, two decisions — a route that suggested AND applied would spend money and
// change a document in one unreviewable click.

// suggestTitleUpstream stands in for Docs registering exactly the ONE pattern this route
// addresses, transcribed from talyvor-docs internal/ai/handler.go#Handler.Mount.
type suggestTitleUpstream struct {
	srv     *httptest.Server
	mu      chan struct{}
	seen    []string
	status  int
	body    string
	gotAuth string
	gotBody string
}

func newSuggestTitleUpstream(t *testing.T, status int, body string) *suggestTitleUpstream {
	t.Helper()
	u := &suggestTitleUpstream{mu: make(chan struct{}, 1), status: status, body: body}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/workspaces/{wsID}/ai/suggest-title", func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		u.mu <- struct{}{}
		u.seen = append(u.seen, r.Method+" "+r.URL.Path)
		u.gotAuth = r.Header.Get("X-Gateway-Auth")
		u.gotBody = string(raw)
		<-u.mu
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(u.status)
		_, _ = io.WriteString(w, u.body)
	})
	mux.HandleFunc(provisionPath, func(w http.ResponseWriter, r *http.Request) { serveFakeProvision(w, r) })
	mux.HandleFunc(trackBootstrapPath, func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"workspace_id":"track-ws-7"}`)
	})
	u.srv = httptest.NewServer(mux)
	t.Cleanup(u.srv.Close)
	return u
}

func (u *suggestTitleUpstream) requests() []string {
	u.mu <- struct{}{}
	defer func() { <-u.mu }()
	return append([]string(nil), u.seen...)
}

func suggestTitleApp(t *testing.T, u *suggestTitleUpstream) (*app, *http.Cookie) {
	t.Helper()
	return productApp(t, &captureUpstream{srv: u.srv}, &captureUpstream{srv: u.srv})
}

func postSuggestTitle(t *testing.T, a *app, sess *http.Cookie, pageID, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/docs/pages/"+pageID+"/suggest-title", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if sess != nil {
		req.AddCookie(sess)
	}
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	return rec
}

// docsSuggestTitleWire is talyvor-docs' SuggestTitle request struct, TRANSCRIBED FIELD FOR FIELD
// from internal/ai/handler.go#Handler.SuggestTitle including its json tags.
//
// ⚠ THIS TYPE IS THE POINT OF THE FILE. Decoding the sent body into the SAME shape the upstream
// decodes it into is what makes a wrong key visible: `text` does not bind to `json:"content"`, so
// Content comes back "" — exactly as it does upstream, where "" is still a 200 and still a billed
// completion, on a page the model never read.
type docsSuggestTitleWire struct {
	Content string `json:"content"`
	PageID  string `json:"page_id"`
}

// ⚠⚠ THE FINDING, PINNED. The page text must arrive under the name the upstream BINDS.
func TestDocsSuggestTitle_SendsTheKeyTheUpstreamActuallyBinds(t *testing.T) {
	u := newSuggestTitleUpstream(t, http.StatusOK, `{"title":"How Caching Works"}`)
	a, sess := suggestTitleApp(t, u)

	rec := postSuggestTitle(t, a, sess, "pg-1", `{"text":"A page about caching."}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST suggest-title → %d: %s", rec.Code, strings.TrimSpace(rec.Body.String()))
	}

	var sent docsSuggestTitleWire
	if err := json.Unmarshal([]byte(u.gotBody), &sent); err != nil {
		t.Fatalf("upstream body is not JSON: %v (%s)", err, u.gotBody)
	}
	if sent.Content != "A page about caching." {
		t.Errorf("the page text arrived upstream as %q, want \"A page about caching.\".\n"+
			"This is decoded through talyvor-docs' OWN struct tags (json:\"content\"), so a %q here "+
			"means the key sent does not bind: upstream answers 200 with a billed completion and "+
			"suggests a title for a page it never read. Sent body: %s",
			sent.Content, sent.Content, u.gotBody)
	}
	// `text` is what this app's two sibling AI routes send, and it binds to nothing here.
	var loose map[string]any
	if err := json.Unmarshal([]byte(u.gotBody), &loose); err != nil {
		t.Fatalf("upstream body is not a JSON object: %v", err)
	}
	if _, present := loose["text"]; present {
		t.Errorf("`text` reached the upstream: %s — that is the name summarise and translate use, "+
			"and on this route it binds to nothing", u.gotBody)
	}
	if sent.PageID != "pg-1" {
		t.Errorf("page_id = %q, want pg-1 (this route's path) — page_id is what Docs binds the "+
			"COST to", sent.PageID)
	}
	if got := u.requests(); len(got) != 1 || got[0] != "POST /v1/workspaces/track-ws-7/ai/suggest-title" {
		t.Fatalf("upstream saw %v, want [POST /v1/workspaces/track-ws-7/ai/suggest-title]", got)
	}
	if u.gotAuth != testDocsSecret {
		t.Errorf("X-Gateway-Auth = %q, want the docs secret attached server-side", u.gotAuth)
	}
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("response is not JSON: %v (%s)", err, rec.Body.String())
	}
	if out["title"] != "How Caching Works" {
		t.Errorf("title = %v, want the upstream body streamed through verbatim", out["title"])
	}
}

// ⚠⚠ Blank page text is a BILLED completion that suggests a title from nothing. Refused here, and
// nothing is spent — no upstream call at all.
func TestDocsSuggestTitle_BlankTextIsRefusedAndSpendsNothing(t *testing.T) {
	for _, tc := range []struct{ name, body string }{
		{"absent", `{}`},
		{"empty", `{"text":""}`},
		{"whitespace only", `{"text":"   \n\t "}`},
		{"the key docs itself binds, which this route does not read", `{"content":"real text"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			u := newSuggestTitleUpstream(t, http.StatusOK, `{"title":"should never be reached"}`)
			a, sess := suggestTitleApp(t, u)
			rec := postSuggestTitle(t, a, sess, "pg-1", tc.body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("%s text → %d, want 400 (body: %s)", tc.name, rec.Code,
					strings.TrimSpace(rec.Body.String()))
			}
			if len(u.requests()) != 0 {
				t.Errorf("a suggest-title with no page text reached the upstream — that is a billed "+
					"Lens completion attributed to this page, titling a document the model never "+
					"read: %v (body %s)", u.requests(), u.gotBody)
			}
			if strings.Contains(strings.ToLower(rec.Body.String()), "unreachable") {
				t.Errorf("the refusal blames the upstream: %s", rec.Body.String())
			}
		})
	}
}

// The companion that keeps the blank refusal from being a catch-all: any non-blank text goes, and
// travels verbatim. This route owns no opinion about how long a page must be to deserve a title —
// that would be a product threshold invented in a proxy.
func TestDocsSuggestTitle_AnyNonBlankTextGoes(t *testing.T) {
	for _, text := range []string{"x", "a b", "  padded  ", strings.Repeat("word ", 400)} {
		u := newSuggestTitleUpstream(t, http.StatusOK, `{"title":"ok"}`)
		a, sess := suggestTitleApp(t, u)
		body, _ := json.Marshal(map[string]string{"text": text})
		rec := postSuggestTitle(t, a, sess, "pg-1", string(body))
		if rec.Code != http.StatusOK {
			t.Errorf("text %q → %d, want 200", text, rec.Code)
			continue
		}
		var sent docsSuggestTitleWire
		if err := json.Unmarshal([]byte(u.gotBody), &sent); err != nil {
			t.Errorf("text %q: upstream body is not JSON: %v", text, err)
			continue
		}
		if sent.Content != text {
			t.Errorf("text %q arrived as %q — it must travel verbatim, untrimmed", text, sent.Content)
		}
	}
}

// ⚠⚠ THE EMPTY SUGGESTION IS A REAL 200, MEASURED UPSTREAM, AND IT IS PASSED THROUGH RATHER THAN
// TURNED INTO AN ERROR. Engine.SuggestTitle trims ` \t\n"'` off the completion and returns what is
// left, so each of these completions yields `{"title":""}` with a 200 — measured on docs' real
// handler over a fake Lens (five completion shapes, all `{"title":""}`):
//
//	""      "''"      "\n\n"
//
// The money is already spent by the time this arrives. Rewriting it into a 502 here would report a
// healthy upstream as broken AND hide a charge the workspace has taken; the honest place for the
// refusal is the button that would otherwise write that empty title over a real one, and that is
// where it lives (PageTitleSuggestion.tsx).
func TestDocsSuggestTitle_AnEmptySuggestionIsStreamedThroughAsItself(t *testing.T) {
	u := newSuggestTitleUpstream(t, http.StatusOK, `{"title":""}`)
	a, sess := suggestTitleApp(t, u)
	rec := postSuggestTitle(t, a, sess, "pg-1", `{"text":"real page text"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want the upstream 200 preserved: %s", rec.Code, rec.Body.String())
	}
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("response is not JSON: %v (%s)", err, rec.Body.String())
	}
	title, present := out["title"]
	if !present {
		t.Fatalf("the title field was dropped: %s — a screen cannot tell an empty suggestion from a "+
			"malformed response if the key disappears", rec.Body.String())
	}
	if title != "" {
		t.Errorf("title = %v, want the empty string upstream actually sent", title)
	}
}

// The caller must not be able to move the cost onto another page, or name a workspace.
func TestDocsSuggestTitle_ThePageIsChosenHereNotByTheCaller(t *testing.T) {
	u := newSuggestTitleUpstream(t, http.StatusOK, `{"title":"ok"}`)
	a, sess := suggestTitleApp(t, u)

	rec := postSuggestTitle(t, a, sess, "pg-mine",
		`{"text":"hello","page_id":"pg-someone-elses","workspace_id":"other-ws"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	var sent docsSuggestTitleWire
	if err := json.Unmarshal([]byte(u.gotBody), &sent); err != nil {
		t.Fatalf("upstream body is not JSON: %v (%s)", err, u.gotBody)
	}
	if sent.PageID != "pg-mine" {
		t.Errorf("page_id sent upstream = %q, want pg-mine (this route's path)", sent.PageID)
	}
	var loose map[string]any
	_ = json.Unmarshal([]byte(u.gotBody), &loose)
	if _, present := loose["workspace_id"]; present {
		t.Errorf("a workspace_id reached the upstream body: %s", u.gotBody)
	}
	if got := u.requests(); len(got) != 1 || !strings.Contains(got[0], "track-ws-7") {
		t.Errorf("upstream path = %v, want the session's workspace", got)
	}
}

// Docs' AI_UNAVAILABLE reaches the browser with its code, so the screen can tell "Docs has no AI
// credential" from "this deployment has no Docs".
func TestDocsSuggestTitle_AIUnavailableKeepsItsCode(t *testing.T) {
	u := newSuggestTitleUpstream(t, http.StatusServiceUnavailable,
		`{"error":"AI unavailable. Check Lens configuration.","code":"AI_UNAVAILABLE"}`)
	a, sess := suggestTitleApp(t, u)
	rec := postSuggestTitle(t, a, sess, "pg-1", `{"text":"anything"}`)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 passed through honestly", rec.Code)
	}
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("body is not JSON: %v (%s)", err, rec.Body.String())
	}
	if out["code"] != "AI_UNAVAILABLE" {
		t.Fatalf("code = %v, want AI_UNAVAILABLE preserved", out["code"])
	}
}

// The other half of the same claim: an unwired deployment must not borrow Docs' code.
func TestDocsSuggestTitle_UnwiredDeploymentAnswers503WithNoAICode(t *testing.T) {
	a, sess := productApp(t, nil, nil)
	rec := postSuggestTitle(t, a, sess, "pg-1", `{"text":"anything"}`)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("body is not JSON: %v (%s)", err, rec.Body.String())
	}
	if _, present := out["code"]; present {
		t.Errorf("the BFF's own \"not configured\" 503 carries code=%v; it must not, or it "+
			"becomes indistinguishable from Docs' AI_UNAVAILABLE", out["code"])
	}
}

// An upstream 404 — Docs' answer when page_id is not in the billed workspace — stays a 404.
func TestDocsSuggestTitle_UpstreamNotFoundStaysNotFound(t *testing.T) {
	u := newSuggestTitleUpstream(t, http.StatusNotFound,
		`{"error":"not found: page_id is not in the workspace this operation is billed to"}`)
	a, sess := suggestTitleApp(t, u)
	rec := postSuggestTitle(t, a, sess, "pg-elsewhere", `{"text":"anything"}`)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 preserved", rec.Code)
	}
}

// GET is not this route.
func TestDocsSuggestTitle_MethodGate(t *testing.T) {
	u := newSuggestTitleUpstream(t, http.StatusOK, `{"title":"ok"}`)
	a, sess := suggestTitleApp(t, u)
	req := httptest.NewRequest(http.MethodGet, "/api/docs/pages/pg-1/suggest-title", nil)
	req.AddCookie(sess)
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET → %d, want 405", rec.Code)
	}
	if got := rec.Header().Get("Allow"); got != http.MethodPost {
		t.Errorf("Allow = %q, want POST", got)
	}
	if len(u.requests()) != 0 {
		t.Errorf("upstream was called on a refused method: %v", u.requests())
	}
}

// No session, no suggestion — and no upstream call either.
//
// ⚠⚠ WHAT A GREEN HERE DOES NOT LICENCE, AND THE CLAIM THIS COMMENT FIRST MADE WAS MEASURED FALSE
// BEFORE IT SHIPPED. This route refuses anonymously in three places (the wrapper,
// docsWorkspaceFor→trackWorkspaceFor, and forwardProduct), each with a byte-identical 401, so this
// test pins the OUTCOME a stranger gets and cannot say which layer produced it.
//
// The first draft went on to say the load-bearing guard for the wrapper was the anonymous-write
// population (TestEveryMountedRoute_RefusesAnonymousWrite). CONTROL C4 DELETED THIS ROUTE'S
// `requireSession` AND **NOTHING IN THE PACKAGE WENT RED** — not that sweep, not this test, not
// anything: the sweep still sees a refusal, it is simply produced two layers down. So the honest
// statement is that the wrapper is defence-in-depth here and NO test in this package can observe
// its removal. That is the same negative #224 recorded for /api/docs/ai/ask (its control P5) and
// docs_translate_test.go for translate — a third member of the same family, written down rather
// than assumed to be covered because its neighbours are.
//
// ⚠ WHAT WOULD CATCH IT is a control that removes the wrapper AND makes a downstream layer answer
// — which is a different test from this one, and is not built here on purpose: it would need a
// fixture in which docsWorkspaceFor succeeds for a caller with no session, i.e. a fixture that
// asserts something the product does not do.
func TestDocsSuggestTitle_RequiresASession(t *testing.T) {
	u := newSuggestTitleUpstream(t, http.StatusOK, `{"title":"ok"}`)
	a, _ := suggestTitleApp(t, u)
	rec := postSuggestTitle(t, a, nil, "pg-1", `{"text":"anything"}`)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated POST → %d, want 401", rec.Code)
	}
	if len(u.requests()) != 0 {
		t.Errorf("upstream was called without a session: %v", u.requests())
	}
}

// An oversize page is refused as 413 rather than surfacing as "docs upstream unreachable", which
// is a false statement about a healthy upstream. The cap is maxDocsBody, the PAGE cap, because
// what travels is a page's stored text. Upstream has no cap at all.
func TestDocsSuggestTitle_OversizeTextIs413AndNotAnUpstreamDiagnosis(t *testing.T) {
	u := newSuggestTitleUpstream(t, http.StatusOK, `{"title":"ok"}`)
	a, sess := suggestTitleApp(t, u)
	huge := `{"text":"` + strings.Repeat("x", maxDocsBody+1) + `"}`
	rec := postSuggestTitle(t, a, sess, "pg-1", huge)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversize suggest-title → %d, want 413 (body: %s)", rec.Code,
			strings.TrimSpace(rec.Body.String()))
	}
	if strings.Contains(rec.Body.String(), "unreachable") {
		t.Errorf("the refusal blames the upstream: %s", rec.Body.String())
	}
	if len(u.requests()) != 0 {
		t.Errorf("an oversize body was forwarded: %v", u.requests())
	}
}

// ⚠ THE PAGE ID CANNOT ARRIVE EMPTY, AND THAT IS A PROPERTY OF THE ADDRESS RATHER THAN A CHECK.
// Measured upstream: `{"content":"Some real page text."}` with NO page_id is a 200 and a billed
// completion — attributable() returns early on an empty id — so the workspace pays for a title
// that no page accounts for.
//
// ⚠⚠ THE FIRST TWO ROWS ARE ASSERTED AS ROUTER BEHAVIOUR, NOT AS THIS ROUTE'S GUARD, AND THAT
// DISTINCTION IS #233's LESSON APPLIED BEFORE IT COULD BITE AGAIN. Measured on this route, one id
// at a time, with the URL the mux actually saw:
//
//	//   → URL.Path "/api/docs/pages//suggest-title"    → a REDIRECT, the mux's own path cleaning
//	%2F  → URL.Path "/api/docs/pages///suggest-title"   → 405 from the /api/ catch-all
//	%2E%2E → URL.Path "/api/docs/pages/../suggest-title" → 400 invalid pageID, from pathID
//	a%2Fb  → URL.Path "/api/docs/pages/a/b/suggest-title" → 400 invalid pageID, from pathID
//	%09    → URL.Path "/api/docs/pages/\t/suggest-title"  → 400 invalid pageID, from pathID
//
// The first two never reach this handler at all: %2F unescapes to a separator, the pattern stops
// matching, and `/api/` answers instead. A test that asserted only "not 200" over all five would
// be satisfied by the router for two of them and would stay green with pathID deleted — which is
// precisely the shape #233 found guarding nothing on find-duplicates. So they are separated: two
// rows pin the ROUTER's refusal, three pin THIS ROUTE's, and control C3 deletes pathID and
// predicts exactly the three.
//
// ⚠⚠ THE FIRST ROW'S STATUS IS NOT PINNED, AND THAT IS MEASURED RATHER THAN CAUTIOUS. My first
// version asserted 307, which is what the empty segment answers under this machine's go1.26.3; run
// under the `go 1.25.0` that apps/bff/go.mod pins for CI it answers **301**, and the row RED. The
// difference is not cosmetic — a client following a 301 may rewrite this POST into a GET — so the
// code is reported in the failure message instead of asserted, which is the convention
// track_duplicates_test.go and track_triage_test.go already reached from the same red (#232).
// ⚠ AND THE LESSON IS ABOUT THE INSTRUMENT: a local `go test` green is not CI's green, and this
// row is the second time in this package that gap has been found by running the pinned toolchain
// rather than by reasoning about it.
func TestDocsSuggestTitle_TheAddressCannotNameAnEmptyPage(t *testing.T) {
	t.Run("the empty segment is cleaned by the mux before this route runs", func(t *testing.T) {
		u := newSuggestTitleUpstream(t, http.StatusOK, `{"title":"ok"}`)
		a, sess := suggestTitleApp(t, u)
		req := httptest.NewRequest(http.MethodPost, "/api/docs/pages//suggest-title",
			strings.NewReader(`{"text":"hello"}`))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(sess)
		rec := httptest.NewRecorder()
		a.ServeHTTP(rec, req)
		if rec.Code < 300 || rec.Code > 399 {
			t.Fatalf("got %d (%s), want a redirect — if this changed, the empty segment now REACHES "+
				"this handler and pathID is what must refuse it: upstream bills an empty page_id "+
				"and no page accounts for it", rec.Code, rec.Body.String())
		}
		if rec.Header().Get("Location") == "" {
			t.Fatalf("a %d with no Location: this is not the router cleaning the path", rec.Code)
		}
		if len(u.requests()) != 0 {
			t.Errorf("the empty-segment address reached Docs with body %q", u.gotBody)
		}
	})
	t.Run("an escaped separator stops matching this pattern", func(t *testing.T) {
		u := newSuggestTitleUpstream(t, http.StatusOK, `{"title":"ok"}`)
		a, sess := suggestTitleApp(t, u)
		rec := postSuggestTitle(t, a, sess, "%2F", `{"text":"hello"}`)
		// 405 from the /api/ catch-all, which answers only GET. Pinned because it is NOT a
		// redirect and so carries none of the toolchain variance above.
		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("POST with page id %%2F → %d, want 405 from the /api/ catch-all. If this "+
				"changed the address now reaches THIS route, and pathID is what must refuse it.",
				rec.Code)
		}
		if len(u.requests()) != 0 {
			t.Errorf("the %%2F address reached Docs with body %q", u.gotBody)
		}
	})
	for _, pageID := range []string{"%2E%2E", "a%2Fb", "%09"} {
		t.Run("id "+pageID+" is refused by this route", func(t *testing.T) {
			u := newSuggestTitleUpstream(t, http.StatusOK, `{"title":"ok"}`)
			a, sess := suggestTitleApp(t, u)
			rec := postSuggestTitle(t, a, sess, pageID, `{"text":"hello"}`)
			if rec.Code != http.StatusBadRequest {
				t.Errorf("POST with page id %q → %d, want 400", pageID, rec.Code)
			}
			if len(u.requests()) != 0 {
				t.Errorf("page id %q reached Docs with body %q", pageID, u.gotBody)
			}
		})
	}
}

// A body that is not JSON is refused here, spending nothing.
func TestDocsSuggestTitle_BadJSONIsRefusedAndSpendsNothing(t *testing.T) {
	u := newSuggestTitleUpstream(t, http.StatusOK, `{"title":"ok"}`)
	a, sess := suggestTitleApp(t, u)
	rec := postSuggestTitle(t, a, sess, "pg-1", `{"text":`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("bad JSON → %d, want 400", rec.Code)
	}
	if len(u.requests()) != 0 {
		t.Errorf("a malformed body was forwarded: %v", u.requests())
	}
}
