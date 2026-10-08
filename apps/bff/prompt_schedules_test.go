package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// newFakeLensForPromptSchedules records every request Lens receives, with the credential it carried, and answers
// each prompt-schedule route as Lens does.
func newFakeLensForPromptSchedules(t *testing.T) (*app, *[]string) {
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
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/agents/agt_1/prompt-schedules"):
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"id":"psc_1","agent_id":"agt_1","every":"once","active":true,"runs":[]}`))
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/agents/prompt-schedules"):
			_, _ = w.Write([]byte(`{"schedules":[{"id":"psc_1","agent_id":"agt_1","active":false,"runs":[{"outcome":"answered","answer":"4","charged_ulxc":317,"entry_id":"ent_9"}]}]}`))
		case r.Method == http.MethodDelete && strings.HasSuffix(r.URL.Path, "/agents/prompt-schedules/psc_1"):
			_, _ = w.Write([]byte(`{"id":"psc_1","active":false}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil), &got
}

// B28.377 — a prompt scheduled from Chat reaches Lens under the paying agent, on the session's own token, with only the
// five fields Lens takes (the prompt trimmed, its time in UTC); the list with each run's answer and charge comes back
// as Lens answers it, and stopping it is Lens's DELETE.
func TestPromptScheduleReachesLensUnderTheAgentThatPays(t *testing.T) {
	a, got := newFakeLensForPromptSchedules(t)
	at := time.Now().Add(90 * time.Minute).Truncate(time.Minute)
	local := at.In(time.FixedZone("CEST", 2*60*60)).Format(time.RFC3339)
	rec := doJSON(a, http.MethodPost, "/api/agents/agt_1/prompt-schedules",
		`{"prompt":"  What is 2+2?  ","provider":"anthropic","model":"claude-x","every":"once","first_run_at":"`+local+`","agent_id":"agt_other"}`)
	if rec.Code != http.StatusCreated || !strings.Contains(rec.Body.String(), `"psc_1"`) {
		t.Fatalf("schedule = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodGet, "/api/agents/prompt-schedules", ""); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"entry_id":"ent_9"`) {
		t.Fatalf("list = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodPost, "/api/agents/prompt-schedules/psc_1/stop", ""); rec.Code != http.StatusOK {
		t.Fatalf("stop = %d %s", rec.Code, rec.Body.String())
	}
	if len(*got) != 3 {
		t.Fatalf("Lens received %d requests, want 3: %q", len(*got), *got)
	}
	ws := strings.Split(strings.TrimPrefix(strings.Fields((*got)[0])[1], "/v1/workspaces/"), "/")[0]
	steps := []string{
		"POST /v1/workspaces/" + ws + "/agents/agt_1/prompt-schedules Bearer ",
		"GET /v1/workspaces/" + ws + "/agents/prompt-schedules Bearer ",
		"DELETE /v1/workspaces/" + ws + "/agents/prompt-schedules/psc_1 Bearer ",
	}
	for i, s := range steps {
		if !strings.HasPrefix((*got)[i], s) {
			t.Fatalf("Lens's request %d was %q, want it to begin %q", i+1, (*got)[i], s)
		}
	}
	var sent map[string]string
	if err := json.Unmarshal([]byte((*got)[0][strings.Index((*got)[0], "{"):]), &sent); err != nil {
		t.Fatalf("the schedule's body is not JSON: %q", (*got)[0])
	}
	want := map[string]string{"prompt": "What is 2+2?", "provider": "anthropic", "model": "claude-x", "every": "once", "first_run_at": at.UTC().Format(time.RFC3339)}
	if len(sent) != len(want) {
		t.Fatalf("Lens was sent %v, want exactly %v", sent, want)
	}
	for k, v := range want {
		if sent[k] != v {
			t.Fatalf("Lens was sent %s=%q, want %q (all: %v)", k, sent[k], v, sent)
		}
	}
}

// B28.377 — a schedule Lens could not run as asked is refused here, and Lens is not asked.
func TestPromptScheduleRefusedBeforeLens(t *testing.T) {
	a, got := newFakeLensForPromptSchedules(t)
	soon := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	for name, body := range map[string]string{
		"no prompt":        `{"prompt":"  ","provider":"anthropic","model":"claude-x","every":"once","first_run_at":"` + soon + `"}`,
		"unknown provider": `{"prompt":"hi","provider":"../admin","model":"claude-x","every":"once","first_run_at":"` + soon + `"}`,
		"no model":         `{"prompt":"hi","provider":"anthropic","model":"","every":"once","first_run_at":"` + soon + `"}`,
		"every hour":       `{"prompt":"hi","provider":"anthropic","model":"claude-x","every":"hour","first_run_at":"` + soon + `"}`,
		"no time":          `{"prompt":"hi","provider":"anthropic","model":"claude-x","every":"once"}`,
		"a time gone":      `{"prompt":"hi","provider":"anthropic","model":"claude-x","every":"once","first_run_at":"` + time.Now().Add(-time.Hour).UTC().Format(time.RFC3339) + `"}`,
	} {
		if rec := doJSON(a, http.MethodPost, "/api/agents/agt_1/prompt-schedules", body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d %s, want 400", name, rec.Code, rec.Body.String())
		}
	}
	if len(*got) != 0 {
		t.Fatalf("Lens was asked: %q", *got)
	}
}
