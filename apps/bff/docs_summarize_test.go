package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// THE SUMMARISE ROUTE, AND THE TWO THINGS ABOUT IT THAT ARE NOT ORDINARY PROXYING.
//
// ⚠⚠ (1) THE ACTION AND THE PAGE ARE CHOSEN HERE, NOT BY THE BROWSER. Docs' upstream is ONE route
// with FOUR actions — `POST /v1/workspaces/{ws}/ai/transform` dispatches summarize / grammar /
// shorter / longer (talyvor-docs internal/ai/handler.go#Transform) — and the page whose AI cost the
// call lands on arrives as a BODY field, `page_id`. Forwarding the caller's body verbatim (which is
// what every other Docs route here does, for good reasons written on each of them) would expose all
// four: three of them REWRITE text for insertion, and this app has nowhere to put the result — the
// only text box on the page reader writes `content_text`, the search projection, which is an open
// product decision and not a place to quietly land model output. So this route builds the upstream
// body itself from a fixed action and the page id IN ITS OWN PATH.
//
// ⚠⚠ (2) AN EMPTY PAGE IS A BILLED COMPLETION UPSTREAM, AND THIS ROUTE REFUSES IT HERE.
// MEASURED, NOT READ (tab-7b42, talyvor-docs at e70ff61, a scratch copy in /tmp — that repo was
// held by another tab and was never written to): the transform handler mounted over a fake Lens
// that COUNTS completions answers
//
//	{"action":"summarize","text":"","page_id":"pg-1"}       → 200, completions 0→1, user bytes 0
//	{"action":"summarize","text":"   \n\t  ","page_id":"pg-1"} → 200, completions 1→2, user bytes 7
//
// There is no empty-content guard anywhere on that path: Handler.Transform switches on the action
// and calls Engine.Summarize, and Engine.run's only precondition is IsAvailable(). So a browser
// button on a blank page is a real metered Lens call, attributed to that page, that summarises
// nothing. A button is what turns that from a thing curl can do into a thing a click does, which is
// why the refusal lands with the button rather than being left upstream.
//
// The refusal is EXACTLY as wide as the measurement — empty after trimming, and nothing else. A
// "too short to be worth summarising" rule would be this file inventing a product threshold.
//
// ⚠ AND THE SIZE CAP IS NOT INHERITED EITHER. Same harness: a 2 MiB text reached the fake Lens
// whole (2,097,152 user bytes, 200). Nothing upstream bounds what one click can send. The cap here
// is maxDocsBody — the PAGE cap, not maxDocsAskBody, the question cap — because the text this route
// sends is a page's stored projection, so any page this BFF would accept a write of is a page it
// will accept a summarise of.

// transformUpstream is a stand-in for Docs that registers exactly the ONE pattern this route
// addresses, transcribed from talyvor-docs internal/ai/handler.go Mount, with the status and body
// it answers settable per test.
type transformUpstream struct {
	srv     *httptest.Server
	mu      chan struct{}
	seen    []string
	status  int
	body    string
	gotAuth string
	gotBody string
}

func newTransformUpstream(t *testing.T, status int, body string) *transformUpstream {
	t.Helper()
	u := &transformUpstream{mu: make(chan struct{}, 1), status: status, body: body}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/workspaces/{wsID}/ai/transform", func(w http.ResponseWriter, r *http.Request) {
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

func (u *transformUpstream) requests() []string {
	u.mu <- struct{}{}
	defer func() { <-u.mu }()
	return append([]string(nil), u.seen...)
}

func summarizeApp(t *testing.T, u *transformUpstream) (*app, *http.Cookie) {
	t.Helper()
	return productApp(t, &captureUpstream{srv: u.srv}, &captureUpstream{srv: u.srv})
}

func postSummarize(t *testing.T, a *app, sess *http.Cookie, pageID, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/docs/pages/"+pageID+"/summarize", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if sess != nil {
		req.AddCookie(sess)
	}
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	return rec
}

// The route exists, addresses the transform path Docs registers, in the SESSION's workspace, and
// the response streams through verbatim.
func TestDocsSummarize_AddressesTransformInTheSessionWorkspace(t *testing.T) {
	u := newTransformUpstream(t, http.StatusOK, `{"text":"• one\n• two"}`)
	a, sess := summarizeApp(t, u)

	rec := postSummarize(t, a, sess, "pg-1", `{"text":"The rollback runbook."}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST summarize → %d: %s", rec.Code, strings.TrimSpace(rec.Body.String()))
	}
	got := u.requests()
	if len(got) != 1 || got[0] != "POST /v1/workspaces/track-ws-7/ai/transform" {
		t.Fatalf("upstream saw %v, want [POST /v1/workspaces/track-ws-7/ai/transform]", got)
	}
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("body is not JSON: %v (%s)", err, rec.Body.String())
	}
	if out["text"] != "• one\n• two" {
		t.Errorf("text = %v, want the upstream body streamed through verbatim", out["text"])
	}
	if u.gotAuth != testDocsSecret {
		t.Errorf("X-Gateway-Auth = %q, want the docs secret attached server-side", u.gotAuth)
	}
}

// ⚠ THE FIRST OF THE TWO POINTS OF THE FILE. The upstream body is BUILT here: the action is fixed
// and the page is the one in this route's path. A caller naming either must not move it.
func TestDocsSummarize_ActionAndPageAreChosenHereNotByTheCaller(t *testing.T) {
	u := newTransformUpstream(t, http.StatusOK, `{"text":"ok"}`)
	a, sess := summarizeApp(t, u)

	// The caller asks for a REWRITE of someone else's page, and sends a workspace too.
	rec := postSummarize(t, a, sess, "pg-mine",
		`{"text":"hello","action":"longer","page_id":"pg-someone-elses","workspace_id":"other-ws"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	var sent map[string]any
	if err := json.Unmarshal([]byte(u.gotBody), &sent); err != nil {
		t.Fatalf("upstream body is not JSON: %v (%s)", err, u.gotBody)
	}
	if sent["action"] != "summarize" {
		t.Errorf("action sent upstream = %v, want summarize — the caller must not be able to pick "+
			"one of the three REWRITE actions this app has nowhere to put the output of", sent["action"])
	}
	if sent["page_id"] != "pg-mine" {
		t.Errorf("page_id sent upstream = %v, want pg-mine (this route's path) — page_id is what "+
			"Docs binds the COST to (Engine.run → BindAISpend)", sent["page_id"])
	}
	if sent["text"] != "hello" {
		t.Errorf("text = %v, want the caller's text", sent["text"])
	}
	if _, present := sent["workspace_id"]; present {
		t.Errorf("a workspace_id reached the upstream body: %s", u.gotBody)
	}
	if got := u.requests(); len(got) != 1 || !strings.Contains(got[0], "track-ws-7") {
		t.Errorf("upstream path = %v, want the session's workspace", got)
	}
}

// ⚠⚠ THE SECOND POINT OF THE FILE, AND THE ONE THAT WAS MEASURED UPSTREAM RATHER THAN ASSUMED:
// an empty page is a REAL metered completion on the box (200, one completion, zero user bytes).
// Refused here, and nothing is spent — no upstream call at all.
func TestDocsSummarize_EmptyTextIsRefusedAndSpendsNothing(t *testing.T) {
	for _, tc := range []struct{ name, body string }{
		{"empty", `{"text":""}`},
		{"whitespace only", `{"text":"   \n\t  "}`},
		{"absent", `{}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			u := newTransformUpstream(t, http.StatusOK, `{"text":"should never be reached"}`)
			a, sess := summarizeApp(t, u)
			rec := postSummarize(t, a, sess, "pg-1", tc.body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("%s text → %d, want 400 (body: %s)", tc.name, rec.Code, strings.TrimSpace(rec.Body.String()))
			}
			if len(u.requests()) != 0 {
				t.Errorf("an empty summarise reached the upstream — that is a billed Lens "+
					"completion on nothing, attributed to this page: %v", u.requests())
			}
			// The refusal must not read as a fault: nothing is broken, there is nothing to summarise.
			if strings.Contains(strings.ToLower(rec.Body.String()), "unreachable") {
				t.Errorf("the refusal blames the upstream: %s", rec.Body.String())
			}
		})
	}
}

// The companion that keeps the refusal from being a catch-all: a page with real text still goes.
func TestDocsSummarize_TextThatIsOnlyShortStillGoes(t *testing.T) {
	u := newTransformUpstream(t, http.StatusOK, `{"text":"ok"}`)
	a, sess := summarizeApp(t, u)
	rec := postSummarize(t, a, sess, "pg-1", `{"text":"x"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("one-character text → %d, want 200: the refusal is about EMPTY, and a "+
			"'too short to be worth it' rule would be a product threshold invented here",
			rec.Code)
	}
	if len(u.requests()) != 1 {
		t.Errorf("upstream calls = %v, want exactly one", u.requests())
	}
}

// Docs' AI_UNAVAILABLE reaches the browser with its code, so the screen can tell "Docs has no AI
// credential" from "this deployment has no Docs" — the distinction docs_ai_test.go's header
// records as having cost a day when it was collapsed.
func TestDocsSummarize_AIUnavailableKeepsItsCode(t *testing.T) {
	u := newTransformUpstream(t, http.StatusServiceUnavailable,
		`{"error":"AI unavailable. Check Lens configuration.","code":"AI_UNAVAILABLE"}`)
	a, sess := summarizeApp(t, u)
	rec := postSummarize(t, a, sess, "pg-1", `{"text":"anything"}`)
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

// The other half of the same claim.
func TestDocsSummarize_UnwiredDeploymentAnswers503WithNoAICode(t *testing.T) {
	a, sess := productApp(t, nil, nil)
	rec := postSummarize(t, a, sess, "pg-1", `{"text":"anything"}`)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("body is not JSON: %v (%s)", err, rec.Body.String())
	}
	if _, present := out["code"]; present {
		t.Errorf("the BFF's own \"not configured\" 503 carries code=%v; it must not, or it becomes "+
			"indistinguishable from Docs' AI_UNAVAILABLE", out["code"])
	}
}

// An upstream 404 — which is what Docs answers when page_id is not in the billed workspace
// (internal/ai/handler.go#attributable) — stays a 404 rather than being laundered.
func TestDocsSummarize_UpstreamNotFoundStaysNotFound(t *testing.T) {
	u := newTransformUpstream(t, http.StatusNotFound,
		`{"error":"not found: page_id is not in the workspace this operation is billed to"}`)
	a, sess := summarizeApp(t, u)
	rec := postSummarize(t, a, sess, "pg-elsewhere", `{"text":"anything"}`)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 preserved", rec.Code)
	}
}

// GET is not this route.
func TestDocsSummarize_MethodGate(t *testing.T) {
	u := newTransformUpstream(t, http.StatusOK, `{"text":"ok"}`)
	a, sess := summarizeApp(t, u)
	req := httptest.NewRequest(http.MethodGet, "/api/docs/pages/pg-1/summarize", nil)
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

// No session, no summarise — and no upstream call either.
//
// ⚠ WHAT A GREEN HERE DOES NOT LICENCE. This route refuses anonymously in three places (the
// wrapper, docsWorkspaceFor→trackWorkspaceFor, and forwardProduct), each with a byte-identical
// 401, so this assertion pins the OUTCOME a stranger gets and CANNOT say which layer produced it.
// Measured, not inherited: see the control harness for the mutation that removes the wrapper.
// The same property is already recorded one route over at TestDocsAsk_RequiresASession.
func TestDocsSummarize_RequiresASession(t *testing.T) {
	u := newTransformUpstream(t, http.StatusOK, `{"text":"ok"}`)
	a, _ := summarizeApp(t, u)
	rec := postSummarize(t, a, nil, "pg-1", `{"text":"anything"}`)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated POST → %d, want 401", rec.Code)
	}
	if len(u.requests()) != 0 {
		t.Errorf("upstream was called without a session: %v", u.requests())
	}
}

// An oversize page is refused as an oversize request — 413 — rather than surfacing as "docs
// upstream unreachable", which is what a MaxBytesReader failing inside the forward looks like from
// the outside and is a false statement about a healthy upstream.
//
// ⚠ THE CAP IS THE PAGE CAP. Upstream has none at all: a 2 MiB text reached the fake Lens whole.
func TestDocsSummarize_OversizeTextIs413AndNotAnUpstreamDiagnosis(t *testing.T) {
	u := newTransformUpstream(t, http.StatusOK, `{"text":"ok"}`)
	a, sess := summarizeApp(t, u)
	huge := `{"text":"` + strings.Repeat("x", maxDocsBody+1) + `"}`
	rec := postSummarize(t, a, sess, "pg-1", huge)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversize summarise → %d, want 413 (body: %s)", rec.Code, strings.TrimSpace(rec.Body.String()))
	}
	if strings.Contains(rec.Body.String(), "unreachable") {
		t.Errorf("the refusal blames the upstream: %s", rec.Body.String())
	}
	if len(u.requests()) != 0 {
		t.Errorf("an oversize body was forwarded: %v", u.requests())
	}
}

// ⚠ THE PAGE ID CANNOT ARRIVE EMPTY, AND THAT IS A PROPERTY OF THE ADDRESS RATHER THAN A CHECK.
//
// It matters because upstream an empty `page_id` does not FAIL — attributable() returns early on
// it, by design, for the two operations that have no single page — so an empty id would produce a
// completion this workspace pays for and NO page accounts for. There is no code in the handler to
// prevent that; the route's shape is what prevents it, so the addresses that could test the shape
// are driven here instead. MEASURED (not deduced from the pattern grammar): ServeMux path-cleans
// `//` into a 307 and never matches, and an escaped separator falls through to the /api/
// catch-all. Neither reaches Docs.
func TestDocsSummarize_TheAddressCannotNameAnEmptyPage(t *testing.T) {
	for _, path := range []string{
		"/api/docs/pages//summarize",
		"/api/docs/pages/%2F/summarize",
	} {
		u := newTransformUpstream(t, http.StatusOK, `{"text":"ok"}`)
		a, sess := summarizeApp(t, u)
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"text":"hello"}`))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(sess)
		rec := httptest.NewRecorder()
		a.ServeHTTP(rec, req)
		if rec.Code == http.StatusOK {
			t.Errorf("POST %q → 200: an empty page id reached the handler, and upstream would "+
				"bill this workspace for a completion no page accounts for", path)
		}
		if len(u.requests()) != 0 {
			t.Errorf("POST %q reached Docs with body %q", path, u.gotBody)
		}
	}
}

// A body that is not JSON is refused here, spending nothing.
func TestDocsSummarize_BadJSONIsRefusedAndSpendsNothing(t *testing.T) {
	u := newTransformUpstream(t, http.StatusOK, `{"text":"ok"}`)
	a, sess := summarizeApp(t, u)
	rec := postSummarize(t, a, sess, "pg-1", `{"text":`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("bad JSON → %d, want 400", rec.Code)
	}
	if len(u.requests()) != 0 {
		t.Errorf("a malformed body was forwarded: %v", u.requests())
	}
}
