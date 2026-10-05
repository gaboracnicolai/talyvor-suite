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
	mu   sync.Mutex
	got  []string // method, path and body of every request
	keys []string // the Idempotency-Key of every request
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
		f.keys = append(f.keys, r.Header.Get("Idempotency-Key"))
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
		case strings.HasSuffix(r.URL.Path, "/agents/agt_1/card") && r.Method == http.MethodGet:
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "economy: this agent has no card"})
		case strings.HasSuffix(r.URL.Path, "/agents/agt_1/card"):
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "ic_1", "agent_id": "agt_1", "last4": "4242", "livemode": false})
		case strings.HasSuffix(r.URL.Path, "/transfers/xfr_1/refund"):
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "xfr_2", "from_agent_id": "agt_1", "to_agent_id": "agt_bea", "amount_ulxc": 1_500_000, "refund_of": "xfr_1"})
		case strings.HasSuffix(r.URL.Path, "/transfers/xfr_given/refund"):
			w.WriteHeader(http.StatusConflict)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "economy: this transfer was already refunded"})
		case strings.HasSuffix(r.URL.Path, "/agents/agt_1/rules/history"):
			_ = json.NewEncoder(w).Encode(map[string]any{"versions": []map[string]any{
				{"version": 2, "rules": map[string]any{"daily_limit_ulxc": 1_000_000}, "changed_by": "jwt:user:ws_1", "change": "template researcher", "created_at": "2026-10-05T09:01:00Z"},
				{"version": 1, "rules": map[string]any{"daily_limit_ulxc": 5_000_000}, "changed_by": "jwt:user:ws_1", "change": "set", "created_at": "2026-10-05T09:00:00Z"},
			}})
		case strings.HasSuffix(r.URL.Path, "/agents/agt_1/rules/rollback"):
			_ = json.NewEncoder(w).Encode(map[string]any{"daily_limit_ulxc": 5_000_000})
		case strings.HasSuffix(r.URL.Path, "/agents/agt_1/rules/simulate"):
			_ = json.NewEncoder(w).Encode(map[string]any{"verdict": "refused", "reason": "the agent has spent 0 LXC of its daily limit of 5 LXC, and this request would cost up to 6 LXC", "amount_ulxc": 6_000_000, "balance_ulxc": 10_000_000})
		case strings.HasSuffix(r.URL.Path, "/agents/agt_1/archive"):
			_ = json.NewEncoder(w).Encode(map[string]any{"agent_id": "agt_1", "swept_ulxc": 750_000, "revoked_keys": []string{"key_1"}})
		case strings.HasSuffix(r.URL.Path, "/agents/agt_1") && r.Method == http.MethodPatch:
			_, _ = w.Write(raw)
		case strings.HasSuffix(r.URL.Path, "/agents/agt_1/claim"):
			_ = json.NewEncoder(w).Encode(map[string]any{"agent_id": "agt_1", "owner_user_id": "ws_1"})
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

// B17.26 — a Fund's Idempotency-Key reaches Lens, so the screen's retry through a restart moves once.
func TestAgentBankForwardsAMovesIdempotencyKey(t *testing.T) {
	a, f := newFakeLensAgentBank(t)
	req := httptest.NewRequest(http.MethodPost, "/api/agents/agt_1/fund", strings.NewReader(`{"amount_ulxc":10000000}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "move-1")
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || len(f.keys) != 1 || f.keys[0] != "move-1" {
		t.Fatalf("fund = %d, Lens received Idempotency-Key %q, want 200 and [move-1]", rec.Code, f.keys)
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

// B28.24 — the hourly and weekly caps reach Lens with the other rules; a save that does not name them
// sends null, which Lens reads as "keep the caps it holds", never as "no cap".
func TestAgentRulesCarryTheHourlyAndWeeklyCaps(t *testing.T) {
	a, f := newFakeLensAgentBank(t)
	doJSON(a, http.MethodPut, "/api/agents/agt_1/rules", `{"hourly_limit_ulxc":1000000,"weekly_limit_ulxc":20000000}`)
	doJSON(a, http.MethodPut, "/api/agents/agt_1/rules", `{"daily_limit_ulxc":5000000}`)
	if len(f.got) != 2 {
		t.Fatalf("Lens received %d requests, want 2: %q", len(f.got), f.got)
	}
	if !strings.Contains(f.got[0], `"hourly_limit_ulxc":1000000`) || !strings.Contains(f.got[0], `"weekly_limit_ulxc":20000000`) {
		t.Fatalf("Lens received %q, want both caps", f.got[0])
	}
	if !strings.Contains(f.got[1], `"hourly_limit_ulxc":null`) || !strings.Contains(f.got[1], `"weekly_limit_ulxc":null`) {
		t.Fatalf("Lens received %q, want both caps null when the save does not name them", f.got[1])
	}
}

// B28.25 — the per-model daily caps reach Lens as a map; a save that does not name them sends null, which
// Lens reads as "keep the caps it holds", never as "no caps".
func TestAgentRulesCarryTheModelDailyCaps(t *testing.T) {
	a, f := newFakeLensAgentBank(t)
	doJSON(a, http.MethodPut, "/api/agents/agt_1/rules", `{"model_daily_limits_ulxc":{"claude-opus-4-1":1,"claude-haiku-4-5":2000000}}`)
	doJSON(a, http.MethodPut, "/api/agents/agt_1/rules", `{"daily_limit_ulxc":5000000}`)
	if len(f.got) != 2 {
		t.Fatalf("Lens received %d requests, want 2: %q", len(f.got), f.got)
	}
	if !strings.Contains(f.got[0], `"model_daily_limits_ulxc":{"claude-haiku-4-5":2000000,"claude-opus-4-1":1}`) {
		t.Fatalf("Lens received %q, want both models' caps", f.got[0])
	}
	if !strings.Contains(f.got[1], `"model_daily_limits_ulxc":null`) {
		t.Fatalf("Lens received %q, want the model caps null when the save does not name them", f.got[1])
	}
}

// B28.26 — the owner's cap on requests a minute reaches Lens; a save that does not name it sends null, which
// Lens reads as "keep the cap it holds", never as "no cap".
func TestAgentRulesCarryTheRequestsPerMinuteCap(t *testing.T) {
	a, f := newFakeLensAgentBank(t)
	doJSON(a, http.MethodPut, "/api/agents/agt_1/rules", `{"requests_per_minute":60}`)
	doJSON(a, http.MethodPut, "/api/agents/agt_1/rules", `{"daily_limit_ulxc":5000000}`)
	if len(f.got) != 2 {
		t.Fatalf("Lens received %d requests, want 2: %q", len(f.got), f.got)
	}
	if !strings.Contains(f.got[0], `"requests_per_minute":60`) {
		t.Fatalf("Lens received %q, want the cap of 60 a minute", f.got[0])
	}
	if !strings.Contains(f.got[1], `"requests_per_minute":null`) {
		t.Fatalf("Lens received %q, want the cap null when the save does not name it", f.got[1])
	}
}

// B28.27 — the payee lists reach Lens with the other rules; a save that does not name them sends null, which
// Lens reads as "keep the lists it holds", never as "pay anyone".
func TestAgentRulesCarryThePayeeLists(t *testing.T) {
	a, f := newFakeLensAgentBank(t)
	doJSON(a, http.MethodPut, "/api/agents/agt_1/rules", `{"allowed_payees":["agt_2"],"blocked_payees":["agt_3","merchant_9"]}`)
	doJSON(a, http.MethodPut, "/api/agents/agt_1/rules", `{"daily_limit_ulxc":5000000}`)
	if len(f.got) != 2 {
		t.Fatalf("Lens received %d requests, want 2: %q", len(f.got), f.got)
	}
	if !strings.Contains(f.got[0], `"allowed_payees":["agt_2"]`) || !strings.Contains(f.got[0], `"blocked_payees":["agt_3","merchant_9"]`) {
		t.Fatalf("Lens received %q, want both payee lists", f.got[0])
	}
	if !strings.Contains(f.got[1], `"allowed_payees":null`) || !strings.Contains(f.got[1], `"blocked_payees":null`) {
		t.Fatalf("Lens received %q, want both payee lists null when the save does not name them", f.got[1])
	}
}

// B28.28 — the per-payee daily caps reach Lens with the other rules; a save that does not name them sends null, which
// Lens reads as "keep the caps it holds", never as "no caps".
func TestAgentRulesCarryThePayeeDailyCaps(t *testing.T) {
	a, f := newFakeLensAgentBank(t)
	doJSON(a, http.MethodPut, "/api/agents/agt_1/rules", `{"payee_daily_limits_ulxc":{"agt_2":500000}}`)
	doJSON(a, http.MethodPut, "/api/agents/agt_1/rules", `{"daily_limit_ulxc":5000000}`)
	if len(f.got) != 2 {
		t.Fatalf("Lens received %d requests, want 2: %q", len(f.got), f.got)
	}
	if !strings.Contains(f.got[0], `"payee_daily_limits_ulxc":{"agt_2":500000}`) {
		t.Fatalf("Lens received %q, want the payee's daily cap", f.got[0])
	}
	if !strings.Contains(f.got[1], `"payee_daily_limits_ulxc":null`) {
		t.Fatalf("Lens received %q, want the payee caps null when the save does not name them", f.got[1])
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

// B19.22 — a period statement, for one agent or the whole bank, reaches Lens with only from, to and
// format, and comes back as Lens wrote it: the CSV file with its name, or Lens's sentence on a bad date.
func TestAgentStatementDownloadsForAPeriod(t *testing.T) {
	var got []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		got = append(got, r.URL.Path+"?"+r.URL.RawQuery)
		if r.URL.Query().Get("from") == "2026-09-31" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"from must be an RFC 3339 time or a YYYY-MM-DD date"}`))
			return
		}
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="agent-statement-2026-08-01-2026-09-01.csv"`)
		_, _ = w.Write([]byte("posting_id,entry_id,at,account,kind,amount_ulxc,counterparty,ref,balance_after_ulxc\n" +
			",,2026-08-01T00:00:00Z,agent:agt_1,opening,,,,0\n" +
			",,2026-09-01T00:00:00Z,agent:agt_1,closing,,,,5000000\n"))
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	for _, path := range []string{"/api/agents/agt_1/statement", "/api/agents/statement"} {
		rec := doJSON(a, http.MethodGet, path+"?from=2026-08-01&to=2026-09-01&format=csv&workspace_id=ws_other", "")
		if rec.Code != http.StatusOK || !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/csv") ||
			!strings.Contains(rec.Header().Get("Content-Disposition"), "agent-statement-2026-08-01-2026-09-01.csv") ||
			!strings.Contains(rec.Body.String(), "opening") || !strings.Contains(rec.Body.String(), "closing,,,,5000000") {
			t.Fatalf("%s = %d %v %s", path, rec.Code, rec.Header(), rec.Body.String())
		}
	}
	rec := doJSON(a, http.MethodGet, "/api/agents/statement?from=2026-09-31", "")
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "YYYY-MM-DD") {
		t.Fatalf("bad date = %d %s", rec.Code, rec.Body.String())
	}
	if len(got) != 3 || !strings.HasSuffix(got[0], "/agents/agt_1/statement?format=csv&from=2026-08-01&to=2026-09-01") ||
		!strings.HasSuffix(got[1], "/agents/statement?format=csv&from=2026-08-01&to=2026-09-01") {
		t.Fatalf("Lens got %v", got)
	}
}

// B19.23 — claiming an ownerless agent reaches Lens as a POST with no body: Lens names the owner from
// the session's credential, so nothing a browser sends can name someone else.
func TestAgentClaimReachesLens(t *testing.T) {
	a, f := newFakeLensAgentBank(t)
	rec := doJSON(a, http.MethodPost, "/api/agents/agt_1/claim", `{"owner_user_id":"someone_else"}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"owner_user_id":"ws_1"`) {
		t.Fatalf("claim = %d %s", rec.Code, rec.Body.String())
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.got) != 1 || !strings.HasSuffix(f.got[0], "/agents/agt_1/claim ") || !strings.HasPrefix(f.got[0], "POST ") {
		t.Fatalf("Lens got %q", f.got)
	}
}

// B28.21 — renaming and describing an agent sends Lens only the two fields (null for the one not given, which
// Lens leaves as it is), and archiving it reaches Lens's archive route and answers what Lens swept.
func TestAgentRenameAndArchiveReachLens(t *testing.T) {
	a, f := newFakeLensAgentBank(t)
	if rec := doJSON(a, http.MethodPatch, "/api/agents/agt_1", `{"description":"Summarises the weekly reports","workspace_id":"ws_other"}`); rec.Code != http.StatusOK {
		t.Fatalf("describe = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodPatch, "/api/agents/agt_1", `{}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("an empty change = %d %s; want 400 before Lens", rec.Code, rec.Body.String())
	}
	rec := doJSON(a, http.MethodPost, "/api/agents/agt_1/archive", `{"agent_id":"agt_2"}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"swept_ulxc":750000`) {
		t.Fatalf("archive = %d %s", rec.Code, rec.Body.String())
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.got) != 2 {
		t.Fatalf("Lens got %q; want the describe and the archive", f.got)
	}
	if want := `/agents/agt_1 {"name":null,"description":"Summarises the weekly reports"}`; !strings.HasPrefix(f.got[0], "PATCH /v1/workspaces/") || !strings.HasSuffix(f.got[0], want) {
		t.Fatalf("Lens got %q; want PATCH …%s", f.got[0], want)
	}
	if !strings.HasPrefix(f.got[1], "POST /v1/workspaces/") || !strings.HasSuffix(f.got[1], "/agents/agt_1/archive ") {
		t.Fatalf("Lens got %q; want POST …/agents/agt_1/archive with no body", f.got[1])
	}
}

// B28.30 — "would this pass my rules?" reaches Lens's simulator with only the request's fields (a browser's
// workspace id goes nowhere) and answers Lens's verdict and reason.
func TestRuleSimulationReachesLens(t *testing.T) {
	a, f := newFakeLensAgentBank(t)
	rec := doJSON(a, http.MethodPost, "/api/agents/agt_1/rules/simulate",
		`{"amount_ulxc":6000000,"payee":{"kind":"agent","id":"agt_bea"},"at":"2026-10-05T09:00:00Z","workspace_id":"ws_other"}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"verdict":"refused"`) || !strings.Contains(rec.Body.String(), "daily limit of 5 LXC") {
		t.Fatalf("simulate = %d %s", rec.Code, rec.Body.String())
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	want := `/agents/agt_1/rules/simulate {"amount_ulxc":6000000,"model":"","provider":"","payee":{"kind":"agent","id":"agt_bea"},"at":"2026-10-05T09:00:00Z"}`
	if len(f.got) != 1 || !strings.HasPrefix(f.got[0], "POST /v1/workspaces/") || !strings.HasSuffix(f.got[0], want) || strings.Contains(f.got[0], "ws_other") {
		t.Fatalf("Lens got %q; want POST …%s", f.got, want)
	}
}

// B28.31 — the rules' history reaches Lens's rules/history and answers its versions; a rollback reaches Lens's
// rules/rollback with only the version (a browser's workspace id goes nowhere) and answers the rules now in force.
func TestRulesHistoryAndRollbackReachLens(t *testing.T) {
	a, f := newFakeLensAgentBank(t)
	rec := doJSON(a, http.MethodGet, "/api/agents/agt_1/rules/history", "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"change":"template researcher"`) {
		t.Fatalf("history = %d %s", rec.Code, rec.Body.String())
	}
	rec = doJSON(a, http.MethodPost, "/api/agents/agt_1/rules/rollback", `{"version":1,"workspace_id":"ws_other"}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"daily_limit_ulxc":5000000`) {
		t.Fatalf("rollback = %d %s", rec.Code, rec.Body.String())
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.got) != 2 || !strings.HasPrefix(f.got[0], "GET /v1/workspaces/") || !strings.HasSuffix(f.got[0], "/agents/agt_1/rules/history ") ||
		!strings.HasPrefix(f.got[1], "POST /v1/workspaces/") || !strings.HasSuffix(f.got[1], `/agents/agt_1/rules/rollback {"version":1}`) ||
		strings.Contains(f.got[1], "ws_other") {
		t.Fatalf("Lens got %q; want GET …/rules/history and POST …/rules/rollback {\"version\":1}", f.got)
	}
}

// B28.23 — giving back a received transfer reaches Lens's refund route for that transfer with no body (a browser's
// fields go nowhere), answers Lens's refund, and one already given back comes back as Lens's 409 and sentence.
func TestTransferRefundReachesLens(t *testing.T) {
	a, f := newFakeLensAgentBank(t)
	rec := doJSON(a, http.MethodPost, "/api/wallets/transfers/xfr_1/refund", `{"amount_ulxc":1}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"refund_of":"xfr_1"`) {
		t.Fatalf("refund = %d %s", rec.Code, rec.Body.String())
	}
	rec = doJSON(a, http.MethodPost, "/api/wallets/transfers/xfr_given/refund", `{}`)
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "already refunded") {
		t.Fatalf("a second refund = %d %s; want Lens's 409 and its sentence", rec.Code, rec.Body.String())
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.got) != 2 || !strings.HasPrefix(f.got[0], "POST /v1/workspaces/") || !strings.HasSuffix(f.got[0], "/transfers/xfr_1/refund ") {
		t.Fatalf("Lens got %q; want POST …/transfers/xfr_1/refund with no body, then the second", f.got)
	}
}

// B19.24 — an agent's card: issuing it sends Lens the cardholder and nothing else a browser adds, and a
// card-less agent's 404 comes back with Lens's sentence, which the screen reads as "no card yet". B27.21:
// the holder's phone is one of those fields; Lens hands it to Stripe as the cardholder's phone_number.
func TestAgentCardReachesLensWithOnlyTheCardholder(t *testing.T) {
	a, f := newFakeLensAgentBank(t)
	rec := doJSON(a, http.MethodPost, "/api/agents/agt_1/card",
		`{"first_name":"Ada","last_name":"Lovelace","email":"ada@example.com","phone_number":"+447700900123","line1":"1 High St","city":"London","postal_code":"N1 1AA","country":"GB","workspace_id":"ws_other"}`)
	if rec.Code != http.StatusCreated || !strings.Contains(rec.Body.String(), `"last4":"4242"`) {
		t.Fatalf("issue = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodGet, "/api/agents/agt_1/card", ``); rec.Code != http.StatusNotFound ||
		!strings.Contains(rec.Body.String(), "has no card") {
		t.Fatalf("read = %d %s", rec.Code, rec.Body.String())
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.got) != 2 || !strings.HasPrefix(f.got[0], "POST ") || !strings.Contains(f.got[0], "/agents/agt_1/card ") {
		t.Fatalf("Lens got %q", f.got)
	}
	var sent map[string]string
	if err := json.Unmarshal([]byte(f.got[0][strings.Index(f.got[0], "{"):]), &sent); err != nil {
		t.Fatal(err)
	}
	if _, leaked := sent["workspace_id"]; leaked || sent["first_name"] != "Ada" || sent["postal_code"] != "N1 1AA" ||
		sent["phone_number"] != "+447700900123" || len(sent) != 9 {
		t.Fatalf("Lens was sent %v; want exactly the nine cardholder fields, the phone among them", sent)
	}
}
