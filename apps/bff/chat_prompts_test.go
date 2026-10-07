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

// B28.370 — Chat's prompt library reads and saves the workspace's named prompts through Lens's /v1/prompts on the
// session's own token; a malformed name never reaches Lens.
func TestChatPromptsListAndSaveThroughLens(t *testing.T) {
	var mu sync.Mutex
	var calls []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		mu.Lock()
		calls = append(calls, r.Method+" "+r.URL.Path+" "+string(raw))
		mu.Unlock()
		if r.URL.Path != "/v1/prompts" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPost {
			w.WriteHeader(http.StatusCreated)
			_, _ = io.WriteString(w, `{"id":"p2","name":"support-tone","version":1,"content":"Answer as a calm support agent.","description":"Support","workspace_id":"ws","is_active":true}`)
			return
		}
		_, _ = io.WriteString(w, `[{"id":"p1","name":"french","version":3,"content":"Answer in French.","description":"","workspace_id":"ws","is_active":true,"updated_at":"2026-10-07T10:00:00Z"}]`)
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	rec := doJSON(a, http.MethodGet, "/api/chat/prompts", "")
	var listed struct {
		Prompts []chatPrompt `json:"prompts"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &listed)
	if rec.Code != http.StatusOK || len(listed.Prompts) != 1 || listed.Prompts[0].Name != "french" || listed.Prompts[0].Version != 3 || listed.Prompts[0].Content != "Answer in French." {
		t.Fatalf("GET /api/chat/prompts = %d %s; want Lens's french prompt, version 3, with its text", rec.Code, rec.Body.String())
	}

	rec = doJSON(a, http.MethodPost, "/api/chat/prompts", `{"name":"support-tone","content":"  Answer as a calm support agent.  ","description":"Support","workspace_id":"someone-else"}`)
	var saved chatPrompt
	_ = json.Unmarshal(rec.Body.Bytes(), &saved)
	if rec.Code != http.StatusCreated || saved.Name != "support-tone" || saved.Version != 1 {
		t.Fatalf("POST /api/chat/prompts = %d %s; want 201 with the prompt Lens saved", rec.Code, rec.Body.String())
	}
	mu.Lock()
	last := calls[len(calls)-1]
	before := len(calls)
	mu.Unlock()
	if last != `POST /v1/prompts {"content":"Answer as a calm support agent.","description":"Support","name":"support-tone"}` {
		t.Fatalf("Lens got %q; want the name, the trimmed text and the description, and no workspace of the browser's choosing", last)
	}

	for _, body := range []string{`{"name":"has space","content":"x"}`, `{"name":"ok","content":"   "}`, `{"name":"","content":"x"}`} {
		if rec = doJSON(a, http.MethodPost, "/api/chat/prompts", body); rec.Code != http.StatusBadRequest {
			t.Fatalf("POST %s = %d %s; want 400", body, rec.Code, rec.Body.String())
		}
	}
	mu.Lock()
	defer mu.Unlock()
	if len(calls) != before {
		t.Fatalf("a refused prompt still reached Lens: %q", calls[before:])
	}
}

// B28.370 — Lens's X-Talyvor-Prompt-Resolved on a streamed answer reaches the chat, which says under the answer that
// the named prompt was used; without it, the chat receives none.
func TestStream_PromptResolvedReachesTheChat(t *testing.T) {
	for _, resolved := range []string{"true", ""} {
		up := newStreamUpstream(t)
		up.noBlock = true
		if resolved != "" {
			up.answerHeaders = map[string]string{"X-Talyvor-Prompt-Resolved": resolved}
		}
		a, sess := streamApp(t, up)
		ts := httptest.NewServer(a)
		req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/ai/stream/anthropic/v1/messages", strings.NewReader(`{"stream":true,"system":"lens:prompt:french"}`))
		req.AddCookie(sess)
		req.Header.Set("Origin", "https://app.talyvor.com")
		req.Header.Set("Content-Type", "application/json")
		resp, err := ts.Client().Do(req)
		if err != nil {
			t.Fatalf("do: %v", err)
		}
		_, _ = io.ReadAll(resp.Body)
		resp.Body.Close()
		ts.Close()
		if got := resp.Header.Get("X-Talyvor-Prompt-Resolved"); got != resolved {
			t.Errorf("Lens said %q: the chat received X-Talyvor-Prompt-Resolved %q", resolved, got)
		}
	}
}
