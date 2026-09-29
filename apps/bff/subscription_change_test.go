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

// B18.20 — a plan change reaches Lens B18.14 on the session's own workspace with only the plan named,
// answers Stripe's state after the swap, relays Lens's refusal with its sentence, and never sends Lens a
// plan outside the three.
func TestPlanChangeReachesTheSessionsWorkspace(t *testing.T) {
	var got []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		body, _ := io.ReadAll(r.Body)
		got = append(got, r.Method+" "+r.URL.Path+" "+string(body))
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(string(body), `"max"`) {
			w.WriteHeader(http.StatusConflict)
			_, _ = io.WriteString(w, `{"error":"billing: the workspace is already on that plan (max)"}`)
			return
		}
		_, _ = io.WriteString(w, `{"subscribed":true,"status":"active","current_period_end":"2026-10-28T00:00:00Z","cancel_at_period_end":false,"livemode":false}`)
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	rec := doJSON(a, http.MethodPost, "/api/billing/subscription/plan", `{"plan":"pro","workspace":"someone-else"}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"subscribed":true`) {
		t.Fatalf("change to pro = %d %s", rec.Code, rec.Body.String())
	}
	rec = doJSON(a, http.MethodPost, "/api/billing/subscription/plan", `{"plan":"max"}`)
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "already on that plan") {
		t.Fatalf("change to the current plan = %d %s, want Lens's 409 and its sentence", rec.Code, rec.Body.String())
	}
	rec = doJSON(a, http.MethodPost, "/api/billing/subscription/plan", `{"plan":"enterprise"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("unknown plan = %d, want 400 before Lens", rec.Code)
	}
	if len(got) != 2 {
		t.Fatalf("Lens received %d requests %q, want 2 (the unknown plan never leaves the BFF)", len(got), got)
	}
	ws := strings.Split(strings.TrimPrefix(strings.Fields(got[0])[1], "/v1/workspaces/"), "/")[0]
	want := "POST /v1/workspaces/" + ws + `/billing/subscription/plan {"plan":"pro"}`
	if ws == "" || got[0] != want {
		t.Fatalf("Lens received %q, want %q", got[0], want)
	}
}
