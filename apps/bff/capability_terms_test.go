package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// B30.103 — the terms and the credential reach Lens under the session's workspace: an acceptance carries only the
// version read, Lens's 409 on a stale version comes back with its sentence, a credential is read at the agent's own
// route, and verify reaches Lens's public check with only the credential.
func TestTermsAndCredentialReachLensWithOnlyTheirOwnFields(t *testing.T) {
	var mu sync.Mutex
	got := []string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		mu.Lock()
		got = append(got, r.Method+" "+r.URL.Path+" "+string(raw))
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(r.URL.Path, "/terms/fx/accept") && strings.Contains(string(raw), `"version":1`):
			w.WriteHeader(http.StatusConflict)
			_, _ = w.Write([]byte(`{"error":"economy: a newer version of these terms is published"}`))
		case strings.HasSuffix(r.URL.Path, "/accept"):
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"acceptance":{"capability":"fx","version":2,"person":"owner@example.com"}}`))
		case r.URL.Path == "/v1/kya/verify":
			_, _ = w.Write([]byte(`{"valid":true}`))
		default:
			_, _ = w.Write([]byte(`{"terms":[]}`))
		}
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	if rec := doJSON(a, http.MethodGet, "/api/terms", ""); rec.Code != http.StatusOK {
		t.Fatalf("terms = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodGet, "/api/terms/fx", ""); rec.Code != http.StatusOK {
		t.Fatalf("fx's terms = %d %s", rec.Code, rec.Body.String())
	}
	rec := doJSON(a, http.MethodPost, "/api/terms/fx/accept", `{"version":1}`)
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "a newer version of these terms is published") {
		t.Fatalf("a stale acceptance = %d %s, want Lens's 409 and its sentence", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodPost, "/api/terms/fx/accept", `{"version":2,"person":"someone@else.com"}`); rec.Code != http.StatusCreated {
		t.Fatalf("accept = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodGet, "/api/agents/agt_1/credential", ""); rec.Code != http.StatusOK {
		t.Fatalf("credential = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodPost, "/api/kya/verify", `{"credential":"  a.b.c ","workspace_id":"other"}`); rec.Code != http.StatusOK {
		t.Fatalf("verify = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodPost, "/api/kya/verify", `{"credential":"  "}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("an empty credential = %d %s, want 400 before Lens is asked", rec.Code, rec.Body.String())
	}

	if len(got) != 6 {
		t.Fatalf("Lens received %d requests, want 6: %q", len(got), got)
	}
	ws := strings.Split(strings.TrimPrefix(strings.Fields(got[0])[1], "/v1/workspaces/"), "/")[0]
	want := []string{
		"GET /v1/workspaces/" + ws + "/terms ",
		"GET /v1/workspaces/" + ws + "/terms/fx ",
		`POST /v1/workspaces/` + ws + `/terms/fx/accept {"version":1}`,
		`POST /v1/workspaces/` + ws + `/terms/fx/accept {"version":2}`,
		"GET /v1/workspaces/" + ws + "/agents/agt_1/credential ",
		`POST /v1/kya/verify {"credential":"a.b.c"}`,
	}
	for i, w := range want {
		if got[i] != w {
			t.Fatalf("Lens's request %d was %q, want %q", i+1, got[i], w)
		}
	}
}
