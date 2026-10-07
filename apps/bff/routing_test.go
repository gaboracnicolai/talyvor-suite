package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// B28.364 — the hint's read asks Lens for the session's workspace with the provider and input range
// Chat sent, and answers the model, provider and basis Lens named, nothing else of its reply.
// B28.106 — in the cohort Chat's questions are tagged with, "chat".
func TestRoutingRecommendationIsLensPickForTheWorkspace(t *testing.T) {
	var asked, bearer string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		asked, bearer = r.URL.Path+"?"+r.URL.RawQuery, r.Header.Get("Authorization")
		_, _ = io.WriteString(w, `{"model":"gpt-6-luna","provider":"openai","basis":"quality_per_dollar","sample_size":420,
			"distinct_workspaces":9,"confidence":"high","expected_quality":0.91,"expected_cost_per_1k":0.0002,"reason":"best for /small"}`)
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	rec := doJSON(a, http.MethodGet, "/api/routing/recommendation?provider=openai&input_range=small", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/routing/recommendation = %d %s", rec.Code, rec.Body.String())
	}
	ws := strings.TrimSuffix(strings.TrimPrefix(asked, "/v1/workspaces/"), "/routing/recommendation?feature=chat&input_range=small&provider=openai")
	if ws == "" || strings.Contains(ws, "/") || bearer != "Bearer jwt-for-"+ws {
		t.Fatalf("Lens was asked %q with %q, want the session's workspace's route with its own key", asked, bearer)
	}
	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"model": "gpt-6-luna", "provider": "openai", "basis": "quality_per_dollar", "confidence": "high"}
	if len(got) != len(want) {
		t.Fatalf("answered %v, want exactly %v", got, want)
	}
	for k, v := range want {
		if got[k] != v {
			t.Fatalf("answered %v, want %v", got, want)
		}
	}

	if rec := doJSON(a, http.MethodGet, "/api/routing/recommendation?provider=admin&input_range=small", ""); rec.Code != http.StatusBadRequest {
		t.Fatalf("an unknown provider = %d, want 400", rec.Code)
	}
}
