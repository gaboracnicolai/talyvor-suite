package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fakeLensFeatures serves a workspace record and its guardrail policy, and records every PUT the
// BFF makes (method, path, body). A PUT answers the way Lens does: {"ok":true, <field>: recorded}.
func fakeLensFeatures(t *testing.T, puts *[]string) *app {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPut:
			raw, _ := io.ReadAll(io.LimitReader(r.Body, 1<<16))
			*puts = append(*puts, r.URL.Path+" "+string(raw))
			var in map[string]any
			_ = json.Unmarshal(raw, &in)
			in["ok"] = true
			_ = json.NewEncoder(w).Encode(in)
		case strings.HasSuffix(r.URL.Path, "/tare/savings"):
			_, _ = io.WriteString(w, `{"by_work_item":[
				{"work_item_id":"ENG-1","requests":3,"tokens_in":9000,"tokens_out":3000,"delta_cost_usd":0.015},
				{"work_item_id":"","requests":1,"tokens_in":1000,"tokens_out":800,"delta_cost_usd":0.0005}]}`)
		case strings.HasSuffix(r.URL.Path, "/guardrails"):
			_, _ = io.WriteString(w, `{"workspace_id":"ws","enable_injection":true,"enable_pii":false,"blocked_words":["x"]}`)
		default:
			_, _ = io.WriteString(w, `{"id":"ws","spend_limit_usd":500,"allowed_models":["gpt-4o"],
				"tare_policy":"disabled","distill_policy":"always","compression_policy":"disabled",
				"logging_policy":"verbose","cache_poolable":true,"distill_poolable":false,
				"cost_optimize_routing":false}`)
		}
	}))
	t.Cleanup(srv.Close)
	return newApp(config{
		addr:            "127.0.0.1:0",
		lensBaseURL:     srv.URL,
		provisionSecret: testProvisionSecret,
		webDist:         t.TempDir(),
		authMode:        authModeDisabled,
	}, nil)
}

func TestFeaturesReadIsTheSettingsAndNothingElseAboutTheTenant(t *testing.T) {
	var puts []string
	rec := doJSON(fakeLensFeatures(t, &puts), http.MethodGet, "/api/features", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/features = %d %s", rec.Code, rec.Body.String())
	}
	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{
		"tare_policy": "disabled", "distill_policy": "always", "compression_policy": "disabled",
		"logging_policy": nil, // "verbose" is not a Lens logging policy: unread, not a claim
		"cache_poolable": true, "distill_poolable": false, "cost_optimize_routing": false,
		"guardrails": map[string]any{"injection": true, "pii": false},
	}
	if len(got) != len(want) {
		t.Errorf("GET /api/features carried %d keys, want %d: %s", len(got), len(want), rec.Body.String())
	}
	for k, v := range want {
		if gb, _ := json.Marshal(got[k]); string(gb) != mustJSON(v) {
			t.Errorf("%s = %s, want %s", k, gb, mustJSON(v))
		}
	}
}

func TestFeaturesTareSwitchWritesLensAndAnswersWhatLensRecorded(t *testing.T) {
	var puts []string
	a := fakeLensFeatures(t, &puts)
	rec := doJSON(a, http.MethodPost, "/api/features/tare", `{"tare_policy":"always"}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"tare_policy":"always"`) {
		t.Fatalf("POST /api/features/tare = %d %s", rec.Code, rec.Body.String())
	}
	if len(puts) != 1 || !strings.HasSuffix(strings.Fields(puts[0])[0], "/tare") ||
		!strings.Contains(puts[0], `{"tare_policy":"always"}`) {
		t.Errorf("Lens saw %q, want one PUT …/tare {\"tare_policy\":\"always\"}", puts)
	}

	puts = nil
	if rec := doJSON(a, http.MethodPost, "/api/features/tare", `{"tare_policy":"banana"}`); rec.Code != http.StatusBadRequest || len(puts) != 0 {
		t.Errorf("an unknown policy = %d and reached Lens %d times, want 400 and never", rec.Code, len(puts))
	}
}

func TestFeaturesCostRoutingSwitchWritesLens(t *testing.T) {
	var puts []string
	rec := doJSON(fakeLensFeatures(t, &puts), http.MethodPost, "/api/features/cost-optimize-routing",
		`{"cost_optimize_routing":true}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"cost_optimize_routing":true`) {
		t.Fatalf("POST /api/features/cost-optimize-routing = %d %s", rec.Code, rec.Body.String())
	}
	if len(puts) != 1 || !strings.HasSuffix(strings.Fields(puts[0])[0], "/cost-optimize-routing") {
		t.Errorf("Lens saw %q, want one PUT …/cost-optimize-routing", puts)
	}
}

func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

// B11.2 — the shared-document-conversions consent is written to Lens's own route, and the reply is
// what Lens recorded.
func TestFeaturesDistillPoolableSwitchWritesLens(t *testing.T) {
	var puts []string
	a := fakeLensFeatures(t, &puts)
	rec := doJSON(a, http.MethodPost, "/api/features/distill-poolable", `{"distill_poolable":true}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"distill_poolable":true`) {
		t.Fatalf("POST /api/features/distill-poolable = %d %s", rec.Code, rec.Body.String())
	}
	if len(puts) != 1 || !strings.HasSuffix(strings.Fields(puts[0])[0], "/distill-poolable") ||
		strings.Fields(puts[0])[1] != `{"distill_poolable":true}` {
		t.Fatalf("Lens received %q", puts)
	}
	if rec := doJSON(a, http.MethodPost, "/api/features/distill-poolable", `{}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("a body without the setting = %d, want 400", rec.Code)
	}
}

// B11.2 — Tare's savings are Lens's per-work-item rows, summed into one reading.
func TestFeaturesTareSavingsSumsLensRows(t *testing.T) {
	var puts []string
	rec := doJSON(fakeLensFeatures(t, &puts), http.MethodGet, "/api/features/tare-savings", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/features/tare-savings = %d %s", rec.Code, rec.Body.String())
	}
	var got tareSavingsTotal
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Requests != 4 || got.TokensBefore != 10000 || got.TokensAfter != 3800 || got.CostSavedUSD < 0.01549 || got.CostSavedUSD > 0.01551 {
		t.Fatalf("summed savings = %+v", got)
	}
}
