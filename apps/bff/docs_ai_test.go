package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// THE ASK-AI ROUTE, AND THE ONE THING ABOUT IT THAT IS NOT ORDINARY PROXYING.
//
// ⚠ TWO DIFFERENT 503s ARRIVE AT THE BROWSER ON THIS ROUTE AND THEY MEAN OPPOSITE THINGS.
//
//	{"error":"docs upstream not configured on this BFF"}                  ← forwardProduct, no DOCS_*
//	{"error":"AI unavailable. Check Lens configuration.","code":"AI_UNAVAILABLE"}  ← Docs, running fine
//
// lib/productState.ts's isUnconfigured() keys on the STATUS ALONE, and its own header records what
// that cost the last time a diagnosis was read off a status code: "Docs is not configured on this
// deployment — no upstream is wired" was shown while Docs was running and had just served the space
// list, "sending them to check env vars that were correct". The second body above reproduces that
// exactly — Docs up, its Lens credential missing — so the two must be separable on the wire, and the
// only thing that separates them is `code`.
//
// This file pins that: the BFF's own 503 carries NO code, and Docs' 503 reaches the browser WITH
// its code intact. Laundering either one (a rewritten body, a transform, a "friendlier" status)
// puts the wrong instruction back on the operator's screen.

// askUpstream is a stand-in for Docs that registers exactly the ONE pattern this route addresses
// — `POST /v1/workspaces/{wsID}/ai/ask`, transcribed from talyvor-docs internal/ai/handler.go
// Mount — with the status and body it answers settable per test. It exists so an ask that
// addresses a path Docs does not register 404s here exactly as it does on the box, which is the
// property docs_routeshape_test.go exists for, extended to the AI surface.
type askUpstream struct {
	srv    *httptest.Server
	mu     chan struct{}
	seen   []string
	status int
	body   string
	// gotAuth/gotEmail record what the gateway attached, so "the credential is attached
	// server-side" is measured on this route rather than assumed from the shared helper.
	gotAuth  string
	gotEmail string
	gotBody  string
}

func newAskUpstream(t *testing.T, status int, body string) *askUpstream {
	t.Helper()
	u := &askUpstream{mu: make(chan struct{}, 1), status: status, body: body}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/workspaces/{wsID}/ai/ask", func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		u.mu <- struct{}{}
		u.seen = append(u.seen, r.Method+" "+r.URL.Path)
		u.gotAuth = r.Header.Get("X-Gateway-Auth")
		u.gotEmail = r.Header.Get("X-User-Email")
		u.gotBody = string(raw)
		<-u.mu
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(u.status)
		_, _ = io.WriteString(w, u.body)
	})
	// The BFF's provisioning probe and Track's bootstrap share this server, as in docsApp.
	mux.HandleFunc(provisionPath, func(w http.ResponseWriter, r *http.Request) { serveFakeProvision(w, r) })
	mux.HandleFunc(trackBootstrapPath, func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"workspace_id":"track-ws-7"}`)
	})
	u.srv = httptest.NewServer(mux)
	t.Cleanup(u.srv.Close)
	return u
}

func (u *askUpstream) requests() []string {
	u.mu <- struct{}{}
	defer func() { <-u.mu }()
	return append([]string(nil), u.seen...)
}

func askApp(t *testing.T, u *askUpstream) (*app, *http.Cookie) {
	t.Helper()
	return productApp(t, &captureUpstream{srv: u.srv}, &captureUpstream{srv: u.srv})
}

func postAsk(t *testing.T, a *app, sess *http.Cookie, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/docs/ai/ask", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(sess)
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	return rec
}

// The route exists, addresses the path Docs registers, and does so in the SESSION's workspace.
func TestDocsAsk_AddressesDocsAskPathInTheSessionWorkspace(t *testing.T) {
	u := newAskUpstream(t, http.StatusOK, `{"answer":"42","sources":[{"title":"Runbook","url":"/spaces/sp-1/pages/pg-1"}]}`)
	a, sess := askApp(t, u)

	rec := postAsk(t, a, sess, `{"question":"what is the runbook"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST /api/docs/ai/ask → %d: %s", rec.Code, strings.TrimSpace(rec.Body.String()))
	}
	got := u.requests()
	if len(got) != 1 || got[0] != "POST /v1/workspaces/track-ws-7/ai/ask" {
		t.Fatalf("upstream saw %v, want [POST /v1/workspaces/track-ws-7/ai/ask]", got)
	}
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("body is not JSON: %v (%s)", err, rec.Body.String())
	}
	if out["answer"] != "42" {
		t.Errorf("answer = %v, want 42 — the upstream body must stream through verbatim", out["answer"])
	}
}

// The credential is attached server-side and the question reaches Docs unaltered.
func TestDocsAsk_AttachesGatewayCredentialsAndForwardsTheQuestionVerbatim(t *testing.T) {
	u := newAskUpstream(t, http.StatusOK, `{"answer":"ok","sources":[]}`)
	a, sess := askApp(t, u)

	rec := postAsk(t, a, sess, `{"question":"hello","unknown_field":1}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	if u.gotAuth != testDocsSecret {
		t.Errorf("X-Gateway-Auth = %q, want the docs secret", u.gotAuth)
	}
	if u.gotEmail != "ng@example.com" {
		t.Errorf("X-User-Email = %q, want the session identity", u.gotEmail)
	}
	// VERBATIM, including a field this file has never heard of: Docs owns the schema, and
	// re-encoding here would invent a second one to drift from (docsCreatePage's rule).
	if u.gotBody != `{"question":"hello","unknown_field":1}` {
		t.Errorf("upstream body = %q, want the caller's body unaltered", u.gotBody)
	}
	if strings.Contains(rec.Body.String(), testDocsSecret) {
		t.Error("the gateway secret appears in the response body")
	}
}

// ⚠ THE POINT OF THE FILE. Docs' AI_UNAVAILABLE reaches the browser with its code, so the screen
// can tell "Docs has no AI credential" from "this deployment has no Docs".
func TestDocsAsk_AIUnavailableKeepsItsCodeSoItIsNotReadAsAnUnwiredDeployment(t *testing.T) {
	u := newAskUpstream(t, http.StatusServiceUnavailable,
		`{"error":"AI unavailable. Check Lens configuration.","code":"AI_UNAVAILABLE"}`)
	a, sess := askApp(t, u)

	rec := postAsk(t, a, sess, `{"question":"anything"}`)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 passed through honestly", rec.Code)
	}
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("body is not JSON: %v (%s)", err, rec.Body.String())
	}
	if out["code"] != "AI_UNAVAILABLE" {
		t.Fatalf("code = %v, want AI_UNAVAILABLE. Without it the browser sees a bare 503 and "+
			"productState.isUnconfigured() reports \"Docs is not configured on this deployment\" "+
			"while Docs is running — the exact misdiagnosis that file was written about.", out["code"])
	}
}

// The other half of the same claim: the BFF's OWN "not wired" 503 carries no code, so the two
// are separable. A code appearing here would collapse the distinction from the other side.
func TestDocsAsk_UnwiredDeploymentAnswers503WithNoAICode(t *testing.T) {
	a, sess := productApp(t, nil, nil) // no docs upstream configured
	rec := postAsk(t, a, sess, `{"question":"anything"}`)
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
	if !strings.Contains(out["error"].(string), "not configured on this BFF") {
		t.Errorf("error = %v, want the BFF's own unwired sentence", out["error"])
	}
}

// AI_FAILED (Docs reached Lens and Lens failed) is a 502 and stays one — it is a fault, not a
// configuration state, and laundering it to 503 would put it in the calm bucket.
func TestDocsAsk_AIFailedStaysAFault(t *testing.T) {
	u := newAskUpstream(t, http.StatusBadGateway,
		`{"error":"AI unavailable. Check Lens configuration.","code":"AI_FAILED"}`)
	a, sess := askApp(t, u)
	rec := postAsk(t, a, sess, `{"question":"anything"}`)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502 preserved", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "AI_FAILED") {
		t.Errorf("body = %s, want AI_FAILED preserved", rec.Body.String())
	}
}

// A body naming a workspace cannot move the upstream path: the workspace is the session's.
func TestDocsAsk_WorkspaceComesFromTheSessionNotTheBody(t *testing.T) {
	u := newAskUpstream(t, http.StatusOK, `{"answer":"ok","sources":[]}`)
	a, sess := askApp(t, u)
	postAsk(t, a, sess, `{"question":"q","workspace_id":"someone-elses-ws","wsID":"someone-elses-ws"}`)
	got := u.requests()
	if len(got) != 1 || got[0] != "POST /v1/workspaces/track-ws-7/ai/ask" {
		t.Fatalf("upstream saw %v — the body must not be able to choose the workspace", got)
	}
}

// GET is not this route. Answering the SPA fallback or the /api/ catch-all here would be a
// silent 404 in the browser.
func TestDocsAsk_MethodGate(t *testing.T) {
	u := newAskUpstream(t, http.StatusOK, `{"answer":"ok","sources":[]}`)
	a, sess := askApp(t, u)
	req := httptest.NewRequest(http.MethodGet, "/api/docs/ai/ask", nil)
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

// No session, no ask — and no upstream call either.
func TestDocsAsk_RequiresASession(t *testing.T) {
	u := newAskUpstream(t, http.StatusOK, `{"answer":"ok","sources":[]}`)
	a, _ := askApp(t, u)
	req := httptest.NewRequest(http.MethodPost, "/api/docs/ai/ask", strings.NewReader(`{"question":"q"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated POST → %d, want 401", rec.Code)
	}
	if len(u.requests()) != 0 {
		t.Errorf("upstream was called without a session: %v", u.requests())
	}
}

// An oversize question is refused as an oversize request — 413 — rather than surfacing as
// "docs upstream unreachable", which is what a MaxBytesReader failing inside the forward looks
// like from the outside and is a false statement about the upstream.
func TestDocsAsk_OversizeQuestionIs413AndNotAnUpstreamDiagnosis(t *testing.T) {
	u := newAskUpstream(t, http.StatusOK, `{"answer":"ok","sources":[]}`)
	a, sess := askApp(t, u)
	huge := `{"question":"` + strings.Repeat("x", maxDocsAskBody+1) + `"}`
	rec := postAsk(t, a, sess, huge)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversize ask → %d, want 413 (body: %s)", rec.Code, strings.TrimSpace(rec.Body.String()))
	}
	if strings.Contains(rec.Body.String(), "unreachable") {
		t.Errorf("the refusal blames the upstream: %s", rec.Body.String())
	}
	if len(u.requests()) != 0 {
		t.Errorf("an oversize body was forwarded: %v", u.requests())
	}
}
