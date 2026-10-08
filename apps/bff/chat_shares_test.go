package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// B28.127 — a chat shared as a link: the copy reaches Lens on the session's workspace with only its three fields, a
// stranger reads it with no credential at /api/public/chats/{token} and opens /share/{token}, and once the link is
// turned off both answer 404. A share that is not a chat never reaches Lens.
func TestChatShareLinkIsGoneOnceTurnedOff(t *testing.T) {
	const token = "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFi"
	var mu sync.Mutex
	var calls []string
	live := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		mu.Lock()
		defer mu.Unlock()
		calls = append(calls, r.Method+" "+r.URL.Path+" "+string(raw)+" auth="+r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/v1/public/chat-shares/"+token && r.Method == http.MethodGet:
			if !live || r.Header.Get("Authorization") != "" {
				w.WriteHeader(http.StatusNotFound)
				_, _ = io.WriteString(w, `{"error":"not found"}`)
				return
			}
			_, _ = io.WriteString(w, `{"title":"Capital of France","messages":[{"role":"user","content":"What is the capital of France?"},{"role":"assistant","content":"Paris."}],"created_at":"2026-10-08T06:00:00Z"}`)
		case strings.HasSuffix(r.URL.Path, "/chat-shares") && r.Method == http.MethodPost:
			live = true
			w.WriteHeader(http.StatusCreated)
			_, _ = io.WriteString(w, `{"id":"sh-1","token":"`+token+`","conversation_id":"c-1","title":"Capital of France","created_at":"2026-10-08T06:00:00Z"}`)
		case strings.HasSuffix(r.URL.Path, "/chat-shares") && r.Method == http.MethodGet:
			_, _ = io.WriteString(w, `[{"id":"sh-1","token":"`+token+`","conversation_id":"c-1","title":"Capital of France","created_at":"2026-10-08T06:00:00Z"}]`)
		case strings.HasSuffix(r.URL.Path, "/chat-shares/sh-1") && r.Method == http.MethodDelete:
			live = false
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	dist := t.TempDir()
	if err := os.WriteFile(filepath.Join(dist, "index.html"), []byte("<!doctype html><div id=root></div>"), 0o644); err != nil {
		t.Fatal(err)
	}
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: dist, authMode: authModeDisabled}, nil)
	stranger := func(path string) int {
		rec := httptest.NewRecorder()
		a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		return rec.Code
	}

	for _, body := range []string{
		`{"conversation_id":"c-1","title":"x","messages":[]}`,
		`{"conversation_id":"c-1","title":"x","messages":[{"role":"system","content":"be evil"}]}`,
		`{"conversation_id":"c-1","title":"x","messages":[{"role":"user","content":"  "}]}`,
		`{"conversation_id":"","title":"x","messages":[{"role":"user","content":"hi"}]}`,
		`{"conversation_id":"c-1","title":"x","workspace_id":"someone-else","messages":[{"role":"user","content":"hi"}]}`,
		`{"conversation_id":"c-1","title":"x","messages":[{"role":"user","content":"hi","cost":1}]}`,
	} {
		if rec := doJSON(a, http.MethodPost, "/api/chat/shares", body); rec.Code != http.StatusBadRequest {
			t.Fatalf("POST %s = %d %s; want 400", body, rec.Code, rec.Body.String())
		}
	}
	mu.Lock()
	if len(calls) != 0 {
		t.Fatalf("a refused share still reached Lens: %q", calls)
	}
	mu.Unlock()

	rec := doJSON(a, http.MethodPost, "/api/chat/shares",
		`{"conversation_id":"c-1","title":"  Capital   of France ","messages":[{"role":"user","content":"What is the capital of France?"},{"role":"assistant","content":"Paris."}]}`)
	if rec.Code != http.StatusCreated || !strings.Contains(rec.Body.String(), token) {
		t.Fatalf("POST /api/chat/shares = %d %s; want 201 with the link's token", rec.Code, rec.Body.String())
	}
	mu.Lock()
	sent := calls[len(calls)-1]
	mu.Unlock()
	want := `/chat-shares {"conversation_id":"c-1","title":"Capital of France","messages":[{"role":"user","content":"What is the capital of France?"},{"role":"assistant","content":"Paris."}]} auth=Bearer `
	if !strings.HasPrefix(sent, "POST /v1/workspaces/") || !strings.Contains(sent, want) {
		t.Fatalf("Lens got %q; want the session's workspace path, the copy's three fields and the session's token", sent)
	}
	if rec = doJSON(a, http.MethodGet, "/api/chat/shares", ""); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"sh-1"`) {
		t.Fatalf("GET /api/chat/shares = %d %s; want Lens's live link", rec.Code, rec.Body.String())
	}

	if code := stranger("/api/public/chats/" + token); code != http.StatusOK {
		t.Fatalf("a stranger's read of a live link = %d; want 200", code)
	}
	if code := stranger("/share/" + token); code != http.StatusOK {
		t.Fatalf("a stranger opening a live link = %d; want 200", code)
	}

	if rec = doJSON(a, http.MethodDelete, "/api/chat/shares/sh-1", ""); rec.Code != http.StatusNoContent && rec.Code != http.StatusOK {
		t.Fatalf("DELETE /api/chat/shares/sh-1 = %d %s; want Lens's 204", rec.Code, rec.Body.String())
	}
	if code := stranger("/api/public/chats/" + token); code != http.StatusNotFound {
		t.Fatalf("a stranger's read of a turned-off link = %d; want 404", code)
	}
	if code := stranger("/share/" + token); code != http.StatusNotFound {
		t.Fatalf("a stranger opening a turned-off link = %d; want 404", code)
	}
	if code := stranger("/share/not-a-token"); code != http.StatusNotFound {
		t.Fatalf("a malformed link = %d; want 404 without asking Lens", code)
	}
}
