package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// THE TRANSLATE ROUTE. Its two non-ordinary properties are both about a request that SUCCEEDS
// while doing the wrong thing, and neither is visible in a status code.
//
// ⚠⚠ (1) THE PARAMETER NAME IS THE FINDING. talyvor-docs' Translate handler binds
// `Language string \`json:"language"\`` (internal/ai/handler.go#Handler.Translate) and passes it to
// Engine.Translate, which turns a blank into `defaultLang = "English"` (internal/ai/engine.go#Engine.Translate) and
// interpolates it into the system prompt (internal/ai/engine.go#Engine.Translate). A caller that names the field anything
// else does not get an error — it gets a 200, a real metered completion, and English.
//
// Docs' OWN in-repo fixture sends the wrong name: internal/ai/handler_test.go's sibling-routes loop drives
// `{"text":"hello","target_language":"French"}`, and asserts only `rr.Code == 200`. It is green,
// and it would be green with the binding deleted.
//
// MEASURED, NOT READ (tab-7c3e, talyvor-docs at 6aca7db, a scratch `git archive` export in /tmp —
// that repo was held by tab-a7f3 and was never written to). Docs' real Translate handler mounted
// over a fake Lens that captures the SYSTEM PROMPT, which is the only place the target language
// actually lands:
//
//	{"text":"hello","target_language":"French"} → 200, 1 completion, "…to English…"
//	{"text":"hello","language":"French"}        → 200, 1 completion, "…to French…"
//	{"text":"hello"}                            → 200, 1 completion, "…to English…"
//	{"text":"hello","language":""}              → 200, 1 completion, "…to English…"
//	{"text":"hello","language":"   "}           → 200, 1 completion, "…to English…"
//	{"text":"","language":"French"}             → 200, 1 completion, 0 user bytes
//
// So THREE distinct mistakes — wrong key, absent key, blank value — all produce the same
// indistinguishable success: the user asked for French, paid for a completion, and got English.
// This file pins the key by DECODING THE SENT BODY INTO DOCS' OWN STRUCT SHAPE rather than by
// checking that the request succeeded, because every one of the six rows above succeeded.
//
// ⚠⚠ (2) A BLANK LANGUAGE IS REFUSED HERE, BEFORE THE MONEY MOVES. Upstream has no precondition
// on it at all: blank becomes English and bills. A button is what turns that from a thing curl can
// do into a thing a click does, so the refusal lands with the button. The refusal is EXACTLY as
// wide as the measurement — blank after trimming, and nothing else. This route does NOT validate
// the language against a list: "French"/"fr"/"Français" are all things the model handles and a
// whitelist here would be this proxy inventing a vocabulary Docs does not have.
//
// ⚠ The empty-TEXT refusal is the same rule docs_summarize_test.go records, re-measured on THIS
// route rather than inherited from that one: row six above is a billed completion on zero bytes.

// translateUpstream is a stand-in for Docs registering exactly the ONE pattern this route
// addresses, transcribed from talyvor-docs internal/ai/handler.go#Handler.Mount.
type translateUpstream struct {
	srv     *httptest.Server
	mu      chan struct{}
	seen    []string
	status  int
	body    string
	gotAuth string
	gotBody string
}

func newTranslateUpstream(t *testing.T, status int, body string) *translateUpstream {
	t.Helper()
	u := &translateUpstream{mu: make(chan struct{}, 1), status: status, body: body}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/workspaces/{wsID}/ai/translate", func(w http.ResponseWriter, r *http.Request) {
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

func (u *translateUpstream) requests() []string {
	u.mu <- struct{}{}
	defer func() { <-u.mu }()
	return append([]string(nil), u.seen...)
}

func translateApp(t *testing.T, u *translateUpstream) (*app, *http.Cookie) {
	t.Helper()
	return productApp(t, &captureUpstream{srv: u.srv}, &captureUpstream{srv: u.srv})
}

func postTranslate(t *testing.T, a *app, sess *http.Cookie, pageID, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/docs/pages/"+pageID+"/translate", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if sess != nil {
		req.AddCookie(sess)
	}
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	return rec
}

// docsTranslateWire is talyvor-docs' Translate request struct, TRANSCRIBED FIELD FOR FIELD from
// internal/ai/handler.go#Handler.Translate including its json tags.
//
// ⚠ THIS TYPE IS THE POINT OF THE FILE. Decoding the sent body into the SAME shape the upstream
// decodes it into is what makes a wrong key visible: `target_language` does not bind to
// `json:"language"`, so Language comes back "" — exactly as it does upstream, where "" silently
// becomes English. An assertion on the response status, or on a map key this file chose itself,
// could not tell the two apart.
type docsTranslateWire struct {
	Text     string `json:"text"`
	Language string `json:"language"`
	PageID   string `json:"page_id"`
}

// ⚠⚠ THE FINDING, PINNED. The language must arrive under the name the upstream BINDS.
func TestDocsTranslate_SendsTheKeyTheUpstreamActuallyBinds(t *testing.T) {
	u := newTranslateUpstream(t, http.StatusOK, `{"text":"bonjour"}`)
	a, sess := translateApp(t, u)

	rec := postTranslate(t, a, sess, "pg-1", `{"text":"hello","language":"French"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST translate → %d: %s", rec.Code, strings.TrimSpace(rec.Body.String()))
	}

	var sent docsTranslateWire
	if err := json.Unmarshal([]byte(u.gotBody), &sent); err != nil {
		t.Fatalf("upstream body is not JSON: %v (%s)", err, u.gotBody)
	}
	if sent.Language != "French" {
		t.Errorf("the language arrived upstream as %q, want \"French\".\n"+
			"This is decoded through talyvor-docs' OWN struct tags (json:\"language\"), so a %q "+
			"here means the key sent does not bind and the upstream will translate to English "+
			"— with a 200 and a billed completion. Sent body: %s",
			sent.Language, sent.Language, u.gotBody)
	}

	// The wrong name must not be present at all — not merely ignored.
	var loose map[string]any
	if err := json.Unmarshal([]byte(u.gotBody), &loose); err != nil {
		t.Fatalf("upstream body is not a JSON object: %v", err)
	}
	if _, present := loose["target_language"]; present {
		t.Errorf("`target_language` reached the upstream: %s — that is the name docs' own "+
			"fixture (internal/ai/handler_test.go's sibling-routes loop) sends, and it binds to nothing", u.gotBody)
	}
	if sent.Text != "hello" {
		t.Errorf("text = %q, want the caller's text", sent.Text)
	}
	if sent.PageID != "pg-1" {
		t.Errorf("page_id = %q, want pg-1 (this route's path) — page_id is what Docs binds the "+
			"COST to", sent.PageID)
	}
	if got := u.requests(); len(got) != 1 || got[0] != "POST /v1/workspaces/track-ws-7/ai/translate" {
		t.Fatalf("upstream saw %v, want [POST /v1/workspaces/track-ws-7/ai/translate]", got)
	}
	if u.gotAuth != testDocsSecret {
		t.Errorf("X-Gateway-Auth = %q, want the docs secret attached server-side", u.gotAuth)
	}
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("response is not JSON: %v (%s)", err, rec.Body.String())
	}
	if out["text"] != "bonjour" {
		t.Errorf("text = %v, want the upstream body streamed through verbatim", out["text"])
	}
}

// ⚠⚠ THE SECOND POINT. A blank language is a BILLED completion that silently returns English.
// Refused here, and nothing is spent — no upstream call at all.
func TestDocsTranslate_BlankLanguageIsRefusedAndSpendsNothing(t *testing.T) {
	for _, tc := range []struct{ name, body string }{
		{"absent", `{"text":"hello"}`},
		{"empty", `{"text":"hello","language":""}`},
		{"whitespace only", `{"text":"hello","language":"   \n\t "}`},
		{"only the name docs' own fixture sends", `{"text":"hello","target_language":"French"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			u := newTranslateUpstream(t, http.StatusOK, `{"text":"should never be reached"}`)
			a, sess := translateApp(t, u)
			rec := postTranslate(t, a, sess, "pg-1", tc.body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("%s language → %d, want 400 (body: %s)", tc.name, rec.Code,
					strings.TrimSpace(rec.Body.String()))
			}
			if len(u.requests()) != 0 {
				t.Errorf("a translate with no usable language reached the upstream — that is a "+
					"billed Lens completion that answers in English while the caller asked for "+
					"something else: %v (body %s)", u.requests(), u.gotBody)
			}
			if strings.Contains(strings.ToLower(rec.Body.String()), "unreachable") {
				t.Errorf("the refusal blames the upstream: %s", rec.Body.String())
			}
		})
	}
}

// The companion that keeps the language refusal from being a catch-all. This route does not own a
// vocabulary of languages — Docs does not have one either, it interpolates the string into a
// prompt — so anything non-blank goes.
func TestDocsTranslate_AnyNonBlankLanguageGoes(t *testing.T) {
	for _, lang := range []string{"French", "fr", "Français", "Brazilian Portuguese", "x"} {
		u := newTranslateUpstream(t, http.StatusOK, `{"text":"ok"}`)
		a, sess := translateApp(t, u)
		body, _ := json.Marshal(map[string]string{"text": "hello", "language": lang})
		rec := postTranslate(t, a, sess, "pg-1", string(body))
		if rec.Code != http.StatusOK {
			t.Errorf("language %q → %d, want 200: the refusal is about BLANK, and a whitelist "+
				"here would be this proxy inventing a vocabulary Docs does not have",
				lang, rec.Code)
			continue
		}
		var sent docsTranslateWire
		if err := json.Unmarshal([]byte(u.gotBody), &sent); err != nil {
			t.Errorf("language %q: upstream body is not JSON: %v", lang, err)
			continue
		}
		if sent.Language != lang {
			t.Errorf("language %q arrived as %q — it must travel verbatim", lang, sent.Language)
		}
	}
}

// Empty text is a billed completion on nothing, measured on THIS route upstream (0 user bytes,
// one completion, 200). Refused here.
func TestDocsTranslate_EmptyTextIsRefusedAndSpendsNothing(t *testing.T) {
	for _, tc := range []struct{ name, body string }{
		{"empty", `{"text":"","language":"French"}`},
		{"whitespace only", `{"text":"   \n\t  ","language":"French"}`},
		{"absent", `{"language":"French"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			u := newTranslateUpstream(t, http.StatusOK, `{"text":"should never be reached"}`)
			a, sess := translateApp(t, u)
			rec := postTranslate(t, a, sess, "pg-1", tc.body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("%s text → %d, want 400 (body: %s)", tc.name, rec.Code,
					strings.TrimSpace(rec.Body.String()))
			}
			if len(u.requests()) != 0 {
				t.Errorf("an empty translate reached the upstream — a billed Lens completion on "+
					"nothing, attributed to this page: %v", u.requests())
			}
		})
	}
}

// The caller must not be able to move the cost onto another page, or name a workspace.
func TestDocsTranslate_ThePageIsChosenHereNotByTheCaller(t *testing.T) {
	u := newTranslateUpstream(t, http.StatusOK, `{"text":"ok"}`)
	a, sess := translateApp(t, u)

	rec := postTranslate(t, a, sess, "pg-mine",
		`{"text":"hello","language":"French","page_id":"pg-someone-elses","workspace_id":"other-ws"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	var sent docsTranslateWire
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
func TestDocsTranslate_AIUnavailableKeepsItsCode(t *testing.T) {
	u := newTranslateUpstream(t, http.StatusServiceUnavailable,
		`{"error":"AI unavailable. Check Lens configuration.","code":"AI_UNAVAILABLE"}`)
	a, sess := translateApp(t, u)
	rec := postTranslate(t, a, sess, "pg-1", `{"text":"anything","language":"French"}`)
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
func TestDocsTranslate_UnwiredDeploymentAnswers503WithNoAICode(t *testing.T) {
	a, sess := productApp(t, nil, nil)
	rec := postTranslate(t, a, sess, "pg-1", `{"text":"anything","language":"French"}`)
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
func TestDocsTranslate_UpstreamNotFoundStaysNotFound(t *testing.T) {
	u := newTranslateUpstream(t, http.StatusNotFound,
		`{"error":"not found: page_id is not in the workspace this operation is billed to"}`)
	a, sess := translateApp(t, u)
	rec := postTranslate(t, a, sess, "pg-elsewhere", `{"text":"anything","language":"French"}`)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 preserved", rec.Code)
	}
}

// GET is not this route.
func TestDocsTranslate_MethodGate(t *testing.T) {
	u := newTranslateUpstream(t, http.StatusOK, `{"text":"ok"}`)
	a, sess := translateApp(t, u)
	req := httptest.NewRequest(http.MethodGet, "/api/docs/pages/pg-1/translate", nil)
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

// No session, no translate — and no upstream call either.
//
// ⚠⚠ WHAT A GREEN HERE DOES NOT LICENCE, AND IT WAS MEASURED RATHER THAN INHERITED. This route
// refuses anonymously in three places (the wrapper, docsWorkspaceFor→trackWorkspaceFor, and
// forwardProduct), each with a byte-identical 401, so this pins the OUTCOME a stranger gets and
// cannot say which layer produced it. CONTROL C4 (~/talyvor-queue/w17-translate-controls-7c3e.py)
// deleted this route's `requireSession` wrapper: the package compiled, this test RAN, and it
// PASSED. So a green here is NOT evidence that the wrapper is load-bearing — it is evidence only
// that a stranger gets a 401 from somewhere. The same negative is on record for /api/docs/ai/ask.
// It is written down rather than papered over because the next person to refactor these three
// layers will otherwise read this test as coverage they do not have.
func TestDocsTranslate_RequiresASession(t *testing.T) {
	u := newTranslateUpstream(t, http.StatusOK, `{"text":"ok"}`)
	a, _ := translateApp(t, u)
	rec := postTranslate(t, a, nil, "pg-1", `{"text":"anything","language":"French"}`)
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
func TestDocsTranslate_OversizeTextIs413AndNotAnUpstreamDiagnosis(t *testing.T) {
	u := newTranslateUpstream(t, http.StatusOK, `{"text":"ok"}`)
	a, sess := translateApp(t, u)
	huge := `{"language":"French","text":"` + strings.Repeat("x", maxDocsBody+1) + `"}`
	rec := postTranslate(t, a, sess, "pg-1", huge)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversize translate → %d, want 413 (body: %s)", rec.Code,
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
// Upstream an empty page_id does not fail — attributable() returns early on it — so it would
// produce a completion this workspace pays for and NO page accounts for.
func TestDocsTranslate_TheAddressCannotNameAnEmptyPage(t *testing.T) {
	for _, path := range []string{
		"/api/docs/pages//translate",
		"/api/docs/pages/%2F/translate",
	} {
		u := newTranslateUpstream(t, http.StatusOK, `{"text":"ok"}`)
		a, sess := translateApp(t, u)
		req := httptest.NewRequest(http.MethodPost, path,
			strings.NewReader(`{"text":"hello","language":"French"}`))
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
func TestDocsTranslate_BadJSONIsRefusedAndSpendsNothing(t *testing.T) {
	u := newTranslateUpstream(t, http.StatusOK, `{"text":"ok"}`)
	a, sess := translateApp(t, u)
	rec := postTranslate(t, a, sess, "pg-1", `{"text":`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("bad JSON → %d, want 400", rec.Code)
	}
	if len(u.requests()) != 0 {
		t.Errorf("a malformed body was forwarded: %v", u.requests())
	}
}
