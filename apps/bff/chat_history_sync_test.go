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

// B28.365 — the sealed history goes to Lens's /v1/workspaces/{ws}/chat-history on the session's workspace exactly as
// the screen sent it, a key the screen did not send never reaches Lens, a copy another device stored first comes back
// as Lens's 409, and a whole sealed history (more than marketRelay's 1 MiB) comes back unclipped.
func TestChatHistorySyncRelaysTheSealedCopyToTheSessionsWorkspace(t *testing.T) {
	big := strings.Repeat("A", 3<<20)
	var mu sync.Mutex
	var got []string
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
		switch r.Method {
		case http.MethodGet:
			_ = json.NewEncoder(w).Encode(map[string]any{"version": 3, "salt": "s", "iv": "i", "ciphertext": big, "updated_at": "2026-10-07T09:00:00Z"})
		case http.MethodPut:
			w.WriteHeader(http.StatusConflict)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": "another device stored a newer copy", "version": 4})
		case http.MethodDelete:
			w.WriteHeader(http.StatusNoContent)
		}
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	rec := doJSON(a, http.MethodGet, "/api/chat/history-sync", "")
	var sealed struct {
		Version    int64  `json:"version"`
		Ciphertext string `json:"ciphertext"`
	}
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &sealed) != nil || sealed.Version != 3 || len(sealed.Ciphertext) != len(big) {
		t.Fatalf("GET = %d (%d bytes), want Lens's version 3 with all %d bytes of its ciphertext", rec.Code, rec.Body.Len(), len(big))
	}
	put := `{"base_version":3,"salt":"s","iv":"i2","ciphertext":"c2"}`
	if rec = doJSON(a, http.MethodPut, "/api/chat/history-sync", put); rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "another device") {
		t.Fatalf("PUT = %d %s, want Lens's 409 and its sentence", rec.Code, rec.Body.String())
	}
	if rec = doJSON(a, http.MethodPut, "/api/chat/history-sync", `{"base_version":3,"ciphertext":"c","plaintext":"hello"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("PUT with a key the screen does not send = %d, want 400 before Lens is asked", rec.Code)
	}
	if rec = doJSON(a, http.MethodDelete, "/api/chat/history-sync", ""); rec.Code != http.StatusOK {
		t.Fatalf("DELETE = %d %s, want 200 for Lens's 204", rec.Code, rec.Body.String())
	}
	if len(got) != 3 {
		t.Fatalf("Lens received %d requests, want 3", len(got))
	}
	ws := strings.Split(strings.TrimPrefix(strings.Fields(got[0])[1], "/v1/workspaces/"), "/")[0]
	want := "/v1/workspaces/" + ws + "/chat-history"
	if ws == "" || got[0] != "GET "+want+" " || got[1] != "PUT "+want+" "+put || got[2] != "DELETE "+want+" " {
		t.Fatalf("Lens received %q, want GET, PUT (the screen's body) and DELETE on %s", got, want)
	}
}
