package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// B18.58 — the chat lists a provider's models only when this deployment's Lens holds its key. The
// fake Lens below answers each proxy route the way the real one does (talyvor-lens
// internal/proxy): 503 "<provider> not configured" before reading the body when the key is absent,
// and 400 "invalid JSON body" at the parse when it is present.
func TestProviders_NamesTheProvidersLensRefusesAndNoOther(t *testing.T) {
	unconfigured := map[string]bool{"google": true, "bedrock": true, "vllm": true}
	var (
		mu     sync.Mutex
		probes = map[string]string{} // provider → the credential its probe carried
		bodies []string
	)
	lens := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == provisionPath:
			serveFakeProvision(w, r)
		case r.URL.Path == lensSessionKeyPath:
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_, _ = io.WriteString(w, fmt.Sprintf(`{"key":%q,"expires_at":%q}`,
				testSessionKey, time.Now().Add(time.Hour).UTC().Format(time.RFC3339)))
		case strings.HasPrefix(r.URL.Path, "/v1/proxy/"):
			provider := strings.SplitN(strings.TrimPrefix(r.URL.Path, "/v1/proxy/"), "/", 2)[0]
			mu.Lock()
			probes[provider] = r.Header.Get("Authorization")
			mu.Unlock()
			if unconfigured[provider] {
				http.Error(w, `{"error":"`+provider+` not configured"}`, http.StatusServiceUnavailable)
				return
			}
			b, _ := io.ReadAll(r.Body)
			mu.Lock()
			bodies = append(bodies, string(b))
			mu.Unlock()
			if !json.Valid(b) {
				http.Error(w, `{"error":"invalid JSON body"}`, http.StatusBadRequest)
				return
			}
			t.Errorf("a probe to %s carried valid JSON %q — it could reach a model", provider, b)
			w.WriteHeader(http.StatusOK)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(lens.Close)

	a, sess := streamApp(t, &streamUpstream{srv: lens})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/ai/providers", nil)
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/ai/providers = %d (%s), want 200", rec.Code, rec.Body.String())
	}
	var got struct {
		Unconfigured []string `json:"unconfigured"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("body %q: %v", rec.Body.String(), err)
	}
	if want := []string{"bedrock", "google", "vllm"}; fmt.Sprint(got.Unconfigured) != fmt.Sprint(want) {
		t.Errorf("unconfigured = %v, want %v", got.Unconfigured, want)
	}
	if len(probes) != len(streamProviders) {
		t.Errorf("probed %d provider(s), want every one of the relay's %d", len(probes), len(streamProviders))
	}
	for p, cred := range probes {
		if cred != "Bearer "+testSessionKey {
			t.Errorf("the %s probe carried %q, want the minted {proxy} session key", p, cred)
		}
	}
	if len(bodies) != len(streamProviders)-len(unconfigured) {
		t.Errorf("%d configured provider(s) read a probe body, want %d", len(bodies), len(streamProviders)-len(unconfigured))
	}
}
