package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"
)

// prompt_schedules.go — B28.377 (the talyvor-suite side of B28.125): a prompt scheduled from Chat, asked at the time
// set, on an agent's own wallet.
//
//	GET  /api/agents/prompt-schedules                every prompt schedule in the workspace, each with its runs
//	POST /api/agents/{id}/prompt-schedules           {prompt, provider, model, every, first_run_at}: the agent pays
//	POST /api/agents/prompt-schedules/{sid}/stop     stops it (Lens: DELETE …/agents/prompt-schedules/{sid})
//
// THE LENS SIDE (B28.125) is the same three routes under /v1/workspaces/{ws}, on the session's workspace token, beside
// B19.8's payment schedules (…/agents/{id}/schedules), run by the same minute tick:
//
//	POST   …/agents/{id}/prompt-schedules  {"prompt", "provider", "model", "every": "once"|"day"|"week",
//	                                        "first_run_at": RFC 3339}  → 201 the schedule
//	GET    …/agents/prompt-schedules       → {"schedules": [schedule, newest first]}
//	DELETE …/agents/prompt-schedules/{sid} → {"id", "active": false}
//
//	schedule = {"id", "agent_id", "prompt", "provider", "model", "every", "next_run_at" (absent once it will not
//	            run again), "active", "created_at", "runs": [run, newest first]}
//	run      = {"ran_at", "outcome": "answered"|"refused", "answer", "detail" (why it was refused), "request_id",
//	            "charged_ulxc" (all the run took from the agent's wallet, its platform fee included),
//	            "entry_id" (the agent's statement line the answer was charged on)}
//
// At first_run_at, and then every day or week while it is active, Lens asks the model the prompt as a call on the
// agent's own key is asked: judged by the agent's rules first and charged to the agent's wallet, so what it cost is
// a line on the agent's statement and nothing else pays. A run the rules refuse is a run with Lens's sentence and no
// charge. A schedule that runs once is inactive after its run. Chat polls the list for the answer.

// promptScheduleEvery is how often a scheduled prompt is asked: once, or every day or week from its first time.
var promptScheduleEvery = map[string]bool{"once": true, "day": true, "week": true}

// promptScheduleSkew is how far in the past a first time may be and still be taken as now: the browser's clock and
// this one disagree by a little, and a person who picks the current minute means it.
const promptScheduleSkew = 2 * time.Minute

// handlePromptSchedules — GET /api/agents/prompt-schedules.
func (a *app) handlePromptSchedules(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.agentBankRelay(w, r, t, http.MethodGet, "/agents/prompt-schedules", nil)
}

// handlePromptSchedule — POST /api/agents/{id}/prompt-schedules: the agent's wallet pays for every run.
func (a *app) handlePromptSchedule(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	suffix, ok := agentSuffix(w, r, "prompt-schedules")
	if !ok {
		return
	}
	var in struct {
		Prompt     string `json:"prompt"`
		Provider   string `json:"provider"`
		Model      string `json:"model"`
		Every      string `json:"every"`
		FirstRunAt string `json:"first_run_at"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	prompt := strings.TrimSpace(in.Prompt)
	first, err := time.Parse(time.RFC3339, in.FirstRunAt)
	switch {
	case prompt == "":
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a scheduled prompt needs saying what to ask"})
		return
	case utf8.RuneCountInString(prompt) > maxTaskChars:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a scheduled prompt is at most 8,000 characters"})
		return
	case !streamProviders[in.Provider]:
		// The provider is a path segment on Lens's proxy when the prompt runs, so it is refused here as the stream relay does.
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown provider"})
		return
	case strings.TrimSpace(in.Model) == "" || len(in.Model) > 200:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a scheduled prompt needs a model"})
		return
	case !promptScheduleEvery[in.Every]:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a scheduled prompt runs once, every day or every week"})
		return
	case err != nil:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a scheduled prompt needs the time it runs"})
		return
	case first.Before(time.Now().Add(-promptScheduleSkew)):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "that time has passed — pick a time to come"})
		return
	}
	in.Prompt, in.FirstRunAt = prompt, first.UTC().Format(time.RFC3339)
	// UPSTREAM-BINDS-ONLY lensPromptScheduleBody: none
	body, _ := json.Marshal(in)
	a.agentBankRelay(w, r, t, http.MethodPost, suffix, body)
}

// handlePromptScheduleStop — POST /api/agents/prompt-schedules/{sid}/stop.
func (a *app) handlePromptScheduleStop(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	id, ok := pathID(w, "schedule id", r.PathValue("sid"))
	if !ok {
		return
	}
	a.agentBankRelay(w, r, t, http.MethodDelete, "/agents/prompt-schedules/"+url.PathEscape(id), nil)
}
