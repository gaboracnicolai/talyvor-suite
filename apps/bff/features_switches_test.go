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

// fakeLensSettings is a Lens that keeps what it is told, the way Lens does: a guardrail POST
// REPLACES the whole policy, logging is a PUT, and a budget is created by POST and has its limit,
// thresholds, enforcement, period and end date replaced together by PATCH.
type fakeLensSettings struct {
	mu        sync.Mutex
	workspace map[string]any
	policy    map[string]any
	budgets   []map[string]any
	// optedIn is workspace_pattern_optin; miningOff is LENS_PATTERN_MINING_ENABLED unset.
	optedIn, miningOff bool
}

func newFakeLensSettings(t *testing.T) (*app, *fakeLensSettings) {
	t.Helper()
	f := &fakeLensSettings{
		workspace: map[string]any{"id": "ws", "logging_policy": "full"},
		policy: map[string]any{"workspace_id": "ws", "enable_injection": true, "enable_pii": true,
			"blocked_words": []any{"x"}, "pii_action": "redact"},
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		raw, _ := io.ReadAll(io.LimitReader(r.Body, 1<<16))
		var in map[string]any
		_ = json.Unmarshal(raw, &in)
		w.Header().Set("Content-Type", "application/json")
		p := r.URL.Path
		switch {
		case strings.HasSuffix(p, "/guardrails") && r.Method == http.MethodPost:
			f.policy = in
			_ = json.NewEncoder(w).Encode(f.policy)
		case strings.HasSuffix(p, "/guardrails"):
			_ = json.NewEncoder(w).Encode(f.policy)
		case strings.HasSuffix(p, "/logging") && r.Method == http.MethodPut:
			f.workspace["logging_policy"] = in["logging_policy"]
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "logging_policy": in["logging_policy"]})
		case strings.HasSuffix(p, "/budgets") && r.Method == http.MethodPost:
			in["id"], in["spent_usd"], in["alert_thresholds"] = "b1", 12.5, []any{0.5, 0.8, 0.9}
			f.budgets = append(f.budgets, in)
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(in)
		case strings.HasSuffix(p, "/budgets"):
			_ = json.NewEncoder(w).Encode(f.budgets)
		case strings.HasSuffix(p, "/budgets/b1") && r.Method == http.MethodPatch:
			for _, k := range []string{"limit_usd", "alert_thresholds", "enforcement", "period", "ends_at"} {
				f.budgets[0][k] = in[k]
			}
			_ = json.NewEncoder(w).Encode(f.budgets[0])
		case strings.HasSuffix(p, "/pattern-mining/opt-in") && r.Method == http.MethodPost:
			if f.miningOff {
				w.WriteHeader(http.StatusServiceUnavailable)
				_ = json.NewEncoder(w).Encode(map[string]any{"error": "pattern mining disabled"})
				return
			}
			f.optedIn = true
			_ = json.NewEncoder(w).Encode(map[string]any{"opted_in": true})
		case strings.HasSuffix(p, "/pattern-mining/opt-in") && r.Method == http.MethodDelete:
			f.optedIn = false
			_ = json.NewEncoder(w).Encode(map[string]any{"opted_in": false})
		case strings.HasSuffix(p, "/pattern-mining/opt-in"):
			_ = json.NewEncoder(w).Encode(map[string]any{"opted_in": f.optedIn, "enabled": !f.miningOff})
		default:
			_ = json.NewEncoder(w).Encode(f.workspace)
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

func readFeaturesState(t *testing.T, a *app) featuresState {
	t.Helper()
	rec := doJSON(a, http.MethodGet, "/api/features", "")
	var st featuresState
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &st) != nil {
		t.Fatalf("GET /api/features = %d %s", rec.Code, rec.Body.String())
	}
	return st
}

// B18.22 — switching one detection off changes that flag and nothing else in the policy.
func TestFeaturesGuardrailSwitchChangesOneFlagAndKeepsTheRestOfThePolicy(t *testing.T) {
	a, f := newFakeLensSettings(t)
	rec := doJSON(a, http.MethodPost, "/api/features/guardrails", `{"injection":false}`)
	if rec.Code != http.StatusOK || rec.Body.String() != `{"injection":false,"pii":true}`+"\n" {
		t.Fatalf("POST /api/features/guardrails = %d %s", rec.Code, rec.Body.String())
	}
	if g := readFeaturesState(t, a).Guardrails; g == nil || g.Injection || !g.PII {
		t.Fatalf("read back from Lens: %+v", g)
	}
	if f.policy["pii_action"] != "redact" || len(f.policy["blocked_words"].([]any)) != 1 {
		t.Fatalf("the rest of the policy was not kept: %v", f.policy)
	}
	if rec := doJSON(a, http.MethodPost, "/api/features/guardrails", `{"injection":true,"pii":true}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("two flags in one write = %d, want 400", rec.Code)
	}
}

// B18.22 — the logging policy chosen on the screen is the one Lens then reports.
func TestFeaturesLoggingSwitchIsReadBackFromLens(t *testing.T) {
	a, _ := newFakeLensSettings(t)
	rec := doJSON(a, http.MethodPost, "/api/features/logging", `{"logging_policy":"metadata"}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"logging_policy":"metadata"`) {
		t.Fatalf("POST /api/features/logging = %d %s", rec.Code, rec.Body.String())
	}
	if p := readFeaturesState(t, a).LoggingPolicy; p == nil || *p != "metadata" {
		t.Fatalf("read back from Lens: %v", p)
	}
	if rec := doJSON(a, http.MethodPost, "/api/features/logging", `{"logging_policy":"verbose"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("an unknown policy = %d, want 400", rec.Code)
	}
}

// B18.22 — the first limit creates a monthly workspace budget; a later change keeps its period and
// alert thresholds, because Lens's PATCH replaces them all.
func TestFeaturesBudgetIsCreatedThenChangedKeepingItsPeriodAndThresholds(t *testing.T) {
	a, f := newFakeLensSettings(t)
	if rec := doJSON(a, http.MethodGet, "/api/features/budget", ""); rec.Body.String() != `{"budget":null,"several":false}`+"\n" {
		t.Fatalf("GET with no budget = %d %s", rec.Code, rec.Body.String())
	}
	rec := doJSON(a, http.MethodPost, "/api/features/budget", `{"limit_usd":50,"enforcement":"hard_block"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("create = %d %s", rec.Code, rec.Body.String())
	}
	if b := f.budgets[0]; b["scope"] != "workspace" || b["period"] != "monthly" || b["limit_usd"] != 50.0 {
		t.Fatalf("Lens was asked to create %v", b)
	}
	if rec := doJSON(a, http.MethodPost, "/api/features/budget", `{"limit_usd":80,"enforcement":"off"}`); rec.Code != http.StatusOK {
		t.Fatalf("change = %d %s", rec.Code, rec.Body.String())
	}
	if len(f.budgets) != 1 || len(f.budgets[0]["alert_thresholds"].([]any)) != 3 {
		t.Fatalf("the change did not keep the one budget's thresholds: %v", f.budgets)
	}
	rec = doJSON(a, http.MethodGet, "/api/features/budget", "")
	want := `{"budget":{"period":"monthly","limit_usd":80,"spent_usd":12.5,"enforcement":"off"},"several":false}` + "\n"
	if rec.Body.String() != want {
		t.Fatalf("read back from Lens = %s, want %s", rec.Body.String(), want)
	}
}

// B18.55 — opting in and out of pattern mining is what Lens then reads back; with mining off on the
// deployment Lens refuses the opt-in and the read says so.
func TestFeaturesPatternMiningSwitchIsReadBackFromLens(t *testing.T) {
	a, f := newFakeLensSettings(t)
	if pm := readFeaturesState(t, a).PatternMining; pm == nil || pm.OptedIn || !pm.Enabled {
		t.Fatalf("before any choice: %+v", pm)
	}
	rec := doJSON(a, http.MethodPost, "/api/features/pattern-mining", `{"opted_in":true}`)
	if rec.Code != http.StatusOK || rec.Body.String() != `{"opted_in":true,"enabled":true}`+"\n" {
		t.Fatalf("opt in = %d %s", rec.Code, rec.Body.String())
	}
	if pm := readFeaturesState(t, a).PatternMining; pm == nil || !pm.OptedIn || !f.optedIn {
		t.Fatalf("read back after opting in: %+v (Lens holds %v)", pm, f.optedIn)
	}
	if rec := doJSON(a, http.MethodPost, "/api/features/pattern-mining", `{"opted_in":false}`); rec.Code != http.StatusOK {
		t.Fatalf("opt out = %d %s", rec.Code, rec.Body.String())
	}
	if pm := readFeaturesState(t, a).PatternMining; pm == nil || pm.OptedIn || f.optedIn {
		t.Fatalf("read back after opting out: %+v (Lens holds %v)", pm, f.optedIn)
	}
	f.miningOff = true
	if rec := doJSON(a, http.MethodPost, "/api/features/pattern-mining", `{"opted_in":true}`); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("opt in with mining off = %d %s, want Lens's 503", rec.Code, rec.Body.String())
	}
	if pm := readFeaturesState(t, a).PatternMining; pm == nil || pm.Enabled || f.optedIn {
		t.Fatalf("with mining off: %+v (Lens holds %v)", pm, f.optedIn)
	}
	if rec := doJSON(a, http.MethodPost, "/api/features/pattern-mining", `{}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("no choice = %d, want 400", rec.Code)
	}
}
