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

// fakeLensMarket records every marketplace request Lens receives, with the credential it came on, and
// answers the way Lens's B20.1–B20.2 routes do: a publish carrying a secret refused 422 with its
// sentence, a use run and answered, and a paid use on a deployment with no marketplace bill (503).
type fakeLensMarket struct {
	mu  sync.Mutex
	got []string // method, path, bearer and body of every request
}

func newFakeLensMarket(t *testing.T) (*app, *fakeLensMarket) {
	t.Helper()
	f := &fakeLensMarket{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == provisionPath:
			serveFakeProvision(w, r)
			return
		case r.URL.Path == lensSessionKeyPath && r.Method == http.MethodPost:
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_, _ = io.WriteString(w, fmt.Sprintf(`{"key":%q,"id":"sk-1","prefix":"tlv_sk_01234567","expires_at":%q}`,
				testSessionKey, time.Now().Add(time.Hour).UTC().Format(time.RFC3339)))
			return
		}
		raw, _ := io.ReadAll(r.Body)
		f.mu.Lock()
		f.got = append(f.got, r.Method+" "+r.URL.RequestURI()+" "+r.Header.Get("Authorization")+" "+string(raw))
		f.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/marketplace/listings"):
			w.WriteHeader(http.StatusUnprocessableEntity)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": "market: the listing cannot be published: it carries a secret (an API key)", "scan": map[string]any{"secrets": []string{"api_key"}}})
		case strings.HasSuffix(r.URL.Path, "/marketplace/listings/lst_paid/use"):
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "service unavailable"})
		case strings.HasSuffix(r.URL.Path, "/use"):
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "use_1", "charge": "billed", "price_ulxc": 500000, "output": "Bonjour"})
		case r.URL.Path == "/v1/marketplace/listings":
			_ = json.NewEncoder(w).Encode(map[string]any{"listings": []any{}})
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

// B20.3 — a publish reaches Lens on the session's own workspace with only the fields a listing has, and
// Lens's refusal (a secret in the artifact) reaches the screen with its sentence; the catalog asks for
// one kind, and a kind Lens does not list is refused before Lens is asked.
func TestMarketplacePublishesOnTheSessionsWorkspaceAndRelaysTheRefusal(t *testing.T) {
	a, f := newFakeLensMarket(t)
	rec := doJSON(a, http.MethodPost, "/api/marketplace/listings",
		`{"kind":"prompt","title":"Translate","price_per_use_ulxc":500000,"artifact":{"template":"sk-live {{text}}"},"workspace_id":"ws_other"}`)
	if rec.Code != http.StatusUnprocessableEntity || !strings.Contains(rec.Body.String(), "it carries a secret") {
		t.Fatalf("publish = %d %s, want Lens's 422 and its sentence", rec.Code, rec.Body.String())
	}
	if rec = doJSON(a, http.MethodGet, "/api/marketplace/listings?kind=prompt", ""); rec.Code != http.StatusOK {
		t.Fatalf("catalog = %d %s", rec.Code, rec.Body.String())
	}
	if rec = doJSON(a, http.MethodGet, "/api/marketplace/listings?kind=anything", ""); rec.Code != http.StatusBadRequest {
		t.Fatalf("catalog of an unknown kind = %d, want 400", rec.Code)
	}
	if len(f.got) != 2 {
		t.Fatalf("Lens received %d requests, want 2: %q", len(f.got), f.got)
	}
	publish := strings.Fields(f.got[0])
	ws := strings.Split(strings.TrimPrefix(publish[1], "/v1/workspaces/"), "/")[0]
	if ws == "" || ws == "ws_other" || publish[1] != "/v1/workspaces/"+ws+"/marketplace/listings" {
		t.Fatalf("the publish reached %q, want the session's workspace", publish[1])
	}
	if want := `{"kind":"prompt","title":"Translate","description":"","price_per_use_ulxc":500000,"visibility":"","artifact":{"template":"sk-live {{text}}"},"changelog":""}`; !strings.HasSuffix(f.got[0], " "+want) {
		t.Fatalf("Lens received %q, want the body %s", f.got[0], want)
	}
	if !strings.HasPrefix(f.got[1], "GET /v1/marketplace/listings?kind=prompt ") {
		t.Fatalf("Lens received %q, want the prompt catalog", f.got[1])
	}
}

// B20.3 — a use goes on the session's narrow {proxy} key, because Lens runs the listing through its own
// proxy with the caller's credential and the workspace token cannot call it; a paid use where Lens has
// no marketplace bill says so, rather than "Lens could not answer".
func TestMarketplaceUseGoesOnTheSessionKey(t *testing.T) {
	a, f := newFakeLensMarket(t)
	rec := doJSON(a, http.MethodPost, "/api/marketplace/listings/lst_1/use", `{"input":"Hello","variables":{"text":"Hello"},"extra":1}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"output":"Bonjour"`) {
		t.Fatalf("use = %d %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(f.got[0], "/marketplace/listings/lst_1/use Bearer "+testSessionKey+" ") || strings.Contains(f.got[0], "extra") {
		t.Fatalf("Lens received %q, want the use on the session key with a rebuilt body", f.got[0])
	}
	rec = doJSON(a, http.MethodPost, "/api/marketplace/listings/lst_paid/use", `{"input":"Hello"}`)
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "no marketplace bill") {
		t.Fatalf("a paid use with no bill = %d %s", rec.Code, rec.Body.String())
	}
}
