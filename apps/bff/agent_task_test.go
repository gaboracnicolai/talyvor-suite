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

// newFakeLensForTasks answers as Lens does: the agent key route issues tlv_task_key (id key_task), the proxy
// answers or refuses as `proxy` says, and the key revoke answers ok. Every request is recorded with the
// credential it carried.
func newFakeLensForTasks(t *testing.T, proxy func(w http.ResponseWriter)) (*app, *[]string) {
	t.Helper()
	var mu sync.Mutex
	got := []string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		mu.Lock()
		got = append(got, r.Method+" "+r.URL.Path+" "+r.Header.Get("Authorization")+" "+string(raw))
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(r.URL.Path, "/agents/agt_1/keys"):
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]string{"agent_id": "agt_1", "key": "tlv_task_key", "id": "key_task", "prefix": "tlv_task_ke"})
		case strings.HasPrefix(r.URL.Path, "/v1/proxy/"):
			proxy(w)
		case strings.HasSuffix(r.URL.Path, "/api-keys/key_task") && r.Method == http.MethodDelete:
			_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil), &got
}

// B28.359 — a task handed to an agent goes to the model with a key of the agent's own, so Lens bills the agent's
// wallet; the key is revoked once the answer is in, and the browser never sees it.
func TestAgentTaskRunsOnTheAgentsOwnKeyAndRevokesIt(t *testing.T) {
	a, got := newFakeLensForTasks(t, func(w http.ResponseWriter) {
		w.Header().Set("X-Talyvor-Request-ID", "req_task")
		_ = json.NewEncoder(w).Encode(map[string]any{"model": "claude-x", "content": []map[string]string{{"type": "text", "text": "Three models."}},
			"usage": map[string]int{"input_tokens": 12, "output_tokens": 3}})
	})
	rec := doJSON(a, http.MethodPost, "/api/agents/agt_1/tasks", `{"task":"  Name three models.  ","provider":"anthropic","model":"claude-x","agent_id":"agt_other"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("task = %d %s", rec.Code, rec.Body.String())
	}
	var out taskReply
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	want := taskReply{AgentID: "agt_1", Answer: "Three models.", Model: "claude-x", RequestID: "req_task", Usage: taskUsage{InputTokens: 12, OutputTokens: 3}, KeyRevoked: true}
	if out != want {
		t.Fatalf("answered %+v, want %+v", out, want)
	}
	if strings.Contains(rec.Body.String(), "tlv_task_key") {
		t.Fatalf("the agent's key reached the browser: %s", rec.Body.String())
	}
	if len(*got) != 3 {
		t.Fatalf("Lens received %d requests, want 3: %q", len(*got), *got)
	}
	ws := strings.Split(strings.TrimPrefix(strings.Fields((*got)[0])[1], "/v1/workspaces/"), "/")[0]
	steps := []string{
		"POST /v1/workspaces/" + ws + "/agents/agt_1/keys Bearer ",
		"POST /v1/proxy/anthropic/v1/messages Bearer tlv_task_key " + `{"max_tokens":4096,"messages":[{"content":"Name three models.","role":"user"}],"model":"claude-x"}`,
		"DELETE /v1/workspaces/" + ws + "/api-keys/key_task Bearer ",
	}
	for i, s := range steps {
		if !strings.HasPrefix((*got)[i], s) {
			t.Fatalf("Lens's request %d was %q, want it to begin %q", i+1, (*got)[i], s)
		}
	}
	if strings.Contains((*got)[0], "tlv_task_key") || strings.Contains((*got)[2], "tlv_task_key") {
		t.Fatalf("the key's issue or revoke was sent on the agent's key, not the session's: %q", *got)
	}
}

// B28.359 — the agent's rules refusing the task come back with Lens's status and sentence, and the key issued
// for it is revoked all the same.
func TestAgentTaskRefusedByTheAgentsRulesStillRevokesTheKey(t *testing.T) {
	a, got := newFakeLensForTasks(t, func(w http.ResponseWriter) {
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "economy: the agent's spending rules refuse this request: the agent is paused"})
	})
	rec := doJSON(a, http.MethodPost, "/api/agents/agt_1/tasks", `{"task":"Name three models.","provider":"openai","model":"gpt-x"}`)
	if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "the agent is paused") {
		t.Fatalf("refused task = %d %s", rec.Code, rec.Body.String())
	}
	if len(*got) != 3 || !strings.HasPrefix((*got)[2], "DELETE ") || !strings.HasSuffix(strings.Fields((*got)[2])[1], "/api-keys/key_task") {
		t.Fatalf("the refused task's key was not revoked: %q", *got)
	}
}

// B28.359 — a provider Lens does not proxy is refused before any key is issued.
func TestAgentTaskRefusesAnUnknownProviderBeforeLens(t *testing.T) {
	a, got := newFakeLensForTasks(t, func(w http.ResponseWriter) {})
	rec := doJSON(a, http.MethodPost, "/api/agents/agt_1/tasks", `{"task":"Name three models.","provider":"../admin","model":"m"}`)
	if rec.Code != http.StatusBadRequest || len(*got) != 0 {
		t.Fatalf("unknown provider = %d %s; Lens received %q", rec.Code, rec.Body.String(), *got)
	}
}
