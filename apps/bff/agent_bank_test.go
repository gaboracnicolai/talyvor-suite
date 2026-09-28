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

// fakeLensAgentBank records every agent-bank request Lens receives and answers the way Lens's
// B19.1–B19.3 routes do: a daily limit refused with its sentence (403), a fund answered with the
// new balance, and a 500 whose body Lens has already redacted.
type fakeLensAgentBank struct {
	mu  sync.Mutex
	got []string // method, path and body of every request
}

func newFakeLensAgentBank(t *testing.T) (*app, *fakeLensAgentBank) {
	t.Helper()
	f := &fakeLensAgentBank{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		f.mu.Lock()
		f.got = append(f.got, r.Method+" "+r.URL.Path+" "+string(raw))
		f.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(r.URL.Path, "/agents/agt_1/pay"):
			w.WriteHeader(http.StatusForbidden)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "economy: the agent's spending rules refuse this request: the agent has spent 0 LXC of its daily limit of 5 LXC, and this payment would cost up to 6 LXC"})
		case strings.HasSuffix(r.URL.Path, "/agents/agt_1/fund"):
			_ = json.NewEncoder(w).Encode(map[string]any{"agent_id": "agt_1", "balance_ulxc": 10_000_000})
		case strings.HasSuffix(r.URL.Path, "/agents/pause-all"), strings.HasSuffix(r.URL.Path, "/agents/resume-all"):
			_ = json.NewEncoder(w).Encode(map[string]any{"all_paused": strings.HasSuffix(r.URL.Path, "pause-all")})
		case strings.HasSuffix(r.URL.Path, "/agents/agt_1/pause"):
			_ = json.NewEncoder(w).Encode(map[string]any{"agent_id": "agt_1", "paused": true})
		case strings.HasSuffix(r.URL.Path, "/agents/agt_1/schedules"):
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write(raw)
		case strings.HasSuffix(r.URL.Path, "/agents/schedules/sch_1"):
			_ = json.NewEncoder(w).Encode(map[string]any{"schedule_id": "sch_1", "active": false})
		case strings.HasSuffix(r.URL.Path, "/agents/agt_1/topup") && r.Method == http.MethodGet:
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "the agent has no automatic top-up"})
		case strings.HasSuffix(r.URL.Path, "/agents/agt_1/topup"):
			_, _ = w.Write(raw)
		case strings.HasSuffix(r.URL.Path, "/agents/agt_1/rules"):
			_, _ = w.Write(raw)
		case strings.HasSuffix(r.URL.Path, "/agents/approvals"):
			w.WriteHeader(http.StatusInternalServerError)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "internal server error"})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return newApp(config{
		addr:            "127.0.0.1:0",
		lensBaseURL:     srv.URL,
		provisionSecret: testProvisionSecret,
		webDist:         t.TempDir(),
		authMode:        authModeDisabled,
	}, nil), f
}

// B19.4 — the screen's writes reach Lens on the session's own workspace, with only the fields Lens
// reads: a workspace id or anything else a browser adds is dropped.
func TestAgentBankForwardsToTheSessionsWorkspaceWithRebuiltBodies(t *testing.T) {
	a, f := newFakeLensAgentBank(t)
	rec := doJSON(a, http.MethodPost, "/api/agents/agt_1/fund", `{"amount_ulxc":10000000,"workspace_id":"ws_other"}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"balance_ulxc":10000000`) {
		t.Fatalf("fund = %d %s", rec.Code, rec.Body.String())
	}
	rec = doJSON(a, http.MethodPut, "/api/agents/agt_1/rules", `{"daily_limit_ulxc":5000000,"secret":"x"}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"daily_limit_ulxc":5000000`) || strings.Contains(rec.Body.String(), "secret") {
		t.Fatalf("rules = %d %s", rec.Code, rec.Body.String())
	}
	if len(f.got) != 2 {
		t.Fatalf("Lens received %d requests, want 2: %q", len(f.got), f.got)
	}
	ws := strings.Split(strings.TrimPrefix(strings.Fields(f.got[0])[1], "/v1/workspaces/"), "/")[0]
	if ws == "" || ws == "ws_other" {
		t.Fatalf("the fund reached workspace %q, want the session's", ws)
	}
	if want := "POST /v1/workspaces/" + ws + "/agents/agt_1/fund {\"amount_ulxc\":10000000}"; f.got[0] != want {
		t.Fatalf("Lens received %q, want %q", f.got[0], want)
	}
	if !strings.HasPrefix(f.got[1], "PUT /v1/workspaces/"+ws+"/agents/agt_1/rules {\"max_per_request_ulxc\":0,\"daily_limit_ulxc\":5000000,") ||
		strings.Contains(f.got[1], "secret") {
		t.Fatalf("Lens received %q", f.got[1])
	}
}

// B19.4 — a refusal reaches the screen with Lens's status and its sentence, which names the rule; a
// Lens 5xx is a 502 that says nothing more.
func TestAgentBankRelaysLensRefusalSentence(t *testing.T) {
	a, _ := newFakeLensAgentBank(t)
	rec := doJSON(a, http.MethodPost, "/api/agents/agt_1/pay", `{"to_agent_id":"agt_2","amount_ulxc":6000000}`)
	if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "daily limit of 5 LXC") {
		t.Fatalf("pay over the daily limit = %d %s, want Lens's 403 and its sentence", rec.Code, rec.Body.String())
	}
	rec = doJSON(a, http.MethodGet, "/api/agents/approvals", "")
	if rec.Code != http.StatusBadGateway || strings.Contains(rec.Body.String(), "internal server error") {
		t.Fatalf("a Lens 500 = %d %s, want a 502 of the BFF's own", rec.Code, rec.Body.String())
	}
}

// B19.19 — the listings an agent may use reach Lens with its other rules; a save that does not name them
// sends null, which Lens reads as "keep the listings it holds", never as "allow any".
func TestAgentRulesCarryTheAllowedListings(t *testing.T) {
	a, f := newFakeLensAgentBank(t)
	doJSON(a, http.MethodPut, "/api/agents/agt_1/rules", `{"daily_limit_ulxc":5000000,"allowed_listings":["lst_1"],"pause_on_unusual_spend":true}`)
	doJSON(a, http.MethodPut, "/api/agents/agt_1/rules", `{"daily_limit_ulxc":5000000}`)
	if len(f.got) != 2 {
		t.Fatalf("Lens received %d requests, want 2: %q", len(f.got), f.got)
	}
	if !strings.Contains(f.got[0], `"allowed_listings":["lst_1"]`) || !strings.Contains(f.got[0], `"pause_on_unusual_spend":true`) {
		t.Fatalf("Lens received %q, want the listing and the pause switch", f.got[0])
	}
	if !strings.Contains(f.got[1], `"allowed_listings":null`) {
		t.Fatalf("Lens received %q, want allowed_listings null when the save does not name them", f.got[1])
	}
}

// B19.20 — pausing every agent, and one, reaches Lens on the session's workspace with only the reason;
// resuming every agent sends nothing but the request.
func TestAgentPauseSendsOnlyTheReason(t *testing.T) {
	a, f := newFakeLensAgentBank(t)
	if rec := doJSON(a, http.MethodPost, "/api/agents/pause-all", `{"reason":"audit","workspace_id":"ws_other"}`); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"all_paused":true`) {
		t.Fatalf("pause-all = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodPost, "/api/agents/resume-all", ""); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"all_paused":false`) {
		t.Fatalf("resume-all = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodPost, "/api/agents/agt_1/pause", `{"reason":"odd spend"}`); rec.Code != http.StatusOK {
		t.Fatalf("pause = %d %s", rec.Code, rec.Body.String())
	}
	ws := strings.Split(strings.TrimPrefix(strings.Fields(f.got[0])[1], "/v1/workspaces/"), "/")[0]
	want := []string{
		"POST /v1/workspaces/" + ws + `/agents/pause-all {"reason":"audit"}`,
		"POST /v1/workspaces/" + ws + "/agents/resume-all ",
		"POST /v1/workspaces/" + ws + `/agents/agt_1/pause {"reason":"odd spend"}`,
	}
	if ws == "" || ws == "ws_other" || strings.Join(f.got, "|") != strings.Join(want, "|") {
		t.Fatalf("Lens received %q, want %q", f.got, want)
	}
}

// B19.21 — a schedule and a top-up reach Lens on the session's workspace with only the fields Lens reads;
// stopping a schedule is Lens's DELETE; an agent with no top-up is Lens's 404 and its sentence.
func TestAgentSchedulesAndTopUpReachLens(t *testing.T) {
	a, f := newFakeLensAgentBank(t)
	rec := doJSON(a, http.MethodPost, "/api/agents/agt_1/schedules", `{"to_agent_id":"agt_2","amount_ulxc":1000000,"every":"week","memo":"rent","x":1}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("schedule = %d %s", rec.Code, rec.Body.String())
	}
	if rec = doJSON(a, http.MethodPost, "/api/agents/schedules/sch_1/stop", ""); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"active":false`) {
		t.Fatalf("stop = %d %s", rec.Code, rec.Body.String())
	}
	if rec = doJSON(a, http.MethodGet, "/api/agents/agt_1/topup", ""); rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "no automatic top-up") {
		t.Fatalf("no top-up = %d %s", rec.Code, rec.Body.String())
	}
	if rec = doJSON(a, http.MethodPut, "/api/agents/agt_1/topup", `{"below_ulxc":5000000,"to_ulxc":8000000}`); rec.Code != http.StatusOK {
		t.Fatalf("top-up = %d %s", rec.Code, rec.Body.String())
	}
	ws := strings.Split(strings.TrimPrefix(strings.Fields(f.got[0])[1], "/v1/workspaces/"), "/")[0]
	want := []string{
		"POST /v1/workspaces/" + ws + `/agents/agt_1/schedules {"to_agent_id":"agt_2","to_listing_id":"","amount_ulxc":1000000,"memo":"rent","every":"week","first_run_at":null}`,
		"DELETE /v1/workspaces/" + ws + "/agents/schedules/sch_1 ",
		"GET /v1/workspaces/" + ws + "/agents/agt_1/topup ",
		"PUT /v1/workspaces/" + ws + `/agents/agt_1/topup {"below_ulxc":5000000,"to_ulxc":8000000}`,
	}
	if ws == "" || strings.Join(f.got, "|") != strings.Join(want, "|") {
		t.Fatalf("Lens received %q, want %q", f.got, want)
	}
}
