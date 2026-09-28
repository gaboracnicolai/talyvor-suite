package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// B18.61 — cancel and resume reach Lens B1.5 on the session's own workspace and answer Stripe's state
// after the change; Lens's refusal when there is no live subscription reaches the screen with its
// sentence; and the read of the subscription comes back in the gated envelope the allowance uses.
func TestSubscriptionCancelAndResumeReachTheSessionsWorkspace(t *testing.T) {
	var mu sync.Mutex
	var got []string
	live := true
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		mu.Lock()
		got = append(got, r.Method+" "+r.URL.Path)
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch {
		case !live:
			w.WriteHeader(http.StatusConflict)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "billing: this workspace has no live subscription"})
		case strings.HasSuffix(r.URL.Path, "/billing/subscription/cancel"):
			_, _ = io.WriteString(w, `{"subscribed":true,"status":"active","current_period_end":"2026-10-28T00:00:00Z","cancel_at_period_end":true,"livemode":false}`)
		case strings.HasSuffix(r.URL.Path, "/billing/subscription"):
			_, _ = io.WriteString(w, `{"subscribed":true,"status":"active","current_period_end":"2026-10-28T00:00:00Z","cancel_at_period_end":false,"livemode":false}`)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	rec := doJSON(a, http.MethodGet, "/api/billing/subscription", "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"enabled":true`) || !strings.Contains(rec.Body.String(), `"cancel_at_period_end":false`) {
		t.Fatalf("read = %d %s", rec.Code, rec.Body.String())
	}
	rec = doJSON(a, http.MethodPost, "/api/billing/subscription/cancel", "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"cancel_at_period_end":true`) {
		t.Fatalf("cancel = %d %s", rec.Code, rec.Body.String())
	}
	live = false
	rec = doJSON(a, http.MethodPost, "/api/billing/subscription/resume", "")
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "no live subscription") {
		t.Fatalf("resume with nothing live = %d %s, want Lens's 409 and its sentence", rec.Code, rec.Body.String())
	}
	ws := strings.Split(strings.TrimPrefix(strings.Fields(got[1])[1], "/v1/workspaces/"), "/")[0]
	want := []string{
		"GET /v1/workspaces/" + ws + "/billing/subscription",
		"POST /v1/workspaces/" + ws + "/billing/subscription/cancel",
		"POST /v1/workspaces/" + ws + "/billing/subscription/resume",
	}
	if ws == "" || strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("Lens received %q, want %q", got, want)
	}
}
