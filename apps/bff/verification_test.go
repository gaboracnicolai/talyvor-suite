package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"
)

// B30.116 — each verification check reaches Lens under the session's workspace with only the fields its own check
// confirms, the record comes back as Lens answers it, and Lens's refusal of a check out of order comes back with its
// sentence.
func TestVerificationChecksReachLensWithOnlyTheirOwnFields(t *testing.T) {
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
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/verification"):
			_, _ = w.Write([]byte(`{"level":"L1","live_level":"L0","checks":[{"level":"L1","test":true,"evidence_ref":"kyc_1"}]}`))
		case strings.HasSuffix(r.URL.Path, "/verification/company"):
			w.WriteHeader(http.StatusConflict)
			_, _ = w.Write([]byte(`{"error":"economy: verification levels are reached in order: the company checked check (L3) needs L2"}`))
		default:
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"check":{"level":"L1"},"verification":{"level":"L1"}}`))
		}
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	if rec := doJSON(a, http.MethodPost, "/api/verification/contact", `{"email":"o@example.com","phone":"+447700900123","name":"Smuggled"}`); rec.Code != http.StatusCreated {
		t.Fatalf("contact = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodPost, "/api/verification/identity", `{"name":"Ada Owner","country":"GB","date_of_birth":"1990-04-01","phone":"+1"}`); rec.Code != http.StatusCreated {
		t.Fatalf("identity = %d %s", rec.Code, rec.Body.String())
	}
	rec := doJSON(a, http.MethodPost, "/api/verification/company", `{"name":"Owner Ltd","country":"GB","company_number":"01234567","directors":["Ada Owner"],"people_with_significant_control":["Ada Owner"]}`)
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "needs L2") {
		t.Fatalf("company out of order = %d %s, want Lens's 409 and its sentence", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodGet, "/api/verification", ""); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"evidence_ref":"kyc_1"`) {
		t.Fatalf("record = %d %s", rec.Code, rec.Body.String())
	}

	if len(got) != 4 {
		t.Fatalf("Lens received %d requests, want 4: %q", len(got), got)
	}
	ws := strings.Split(strings.TrimPrefix(strings.Fields(got[0])[1], "/v1/workspaces/"), "/")[0]
	want := []struct {
		line string
		keys []string
	}{
		{"POST /v1/workspaces/" + ws + "/verification/contact ", []string{"email", "phone"}},
		{"POST /v1/workspaces/" + ws + "/verification/identity ", []string{"country", "date_of_birth", "name"}},
		{"POST /v1/workspaces/" + ws + "/verification/company ", []string{"company_number", "country", "directors", "name", "people_with_significant_control"}},
		{"GET /v1/workspaces/" + ws + "/verification ", nil},
	}
	for i, w := range want {
		if !strings.HasPrefix(got[i], w.line) {
			t.Fatalf("Lens's request %d was %q, want it to begin %q", i+1, got[i], w.line)
		}
		if w.keys == nil {
			continue
		}
		var sent map[string]any
		if err := json.Unmarshal([]byte(strings.TrimPrefix(got[i], w.line)), &sent); err != nil {
			t.Fatalf("request %d's body is not JSON: %q", i+1, got[i])
		}
		keys := []string{}
		for k := range sent {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		if strings.Join(keys, " ") != strings.Join(w.keys, " ") {
			t.Fatalf("request %d sent %v, want exactly the keys %v", i+1, sent, w.keys)
		}
	}
}
