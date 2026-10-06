package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"
)

// agent_task.go — B28.359 (the talyvor-suite side of B28.96): hand a task to an agent from Chat, and the task
// runs on the agent's own wallet.
//
//	POST /api/agents/{id}/tasks   {"task", "provider", "model"}
//	  → {"agent_id", "answer", "model", "request_id", "replayed", "usage": {"input_tokens", "output_tokens"}, "key_revoked"}
//
// The BFF issues the agent a key of its own for this one task (Lens's agent key route, the one Agent Wallets'
// "Issue a key" calls), sends the task to the model through Lens's proxy with that key, and revokes the key
// once the answer is in. Lens bills a call made with an agent's key to that agent's wallet and judges it by
// the agent's rules first, exactly as when the agent calls with a key it holds, so nothing here decides who
// pays: the key does. A refusal — the agent paused, over a limit, out of money, waiting for a person — comes
// back with Lens's status and its sentence.
//
// ⚠ THE KEY NEVER LEAVES THIS HANDLER. It is not logged and not answered, and once it is issued it is revoked
// on every path, on a context of its own: a person who closes Chat mid-task stops the model (the browser's
// context bounds the call, as the stream relay's does), and still leaves no live key behind.

// taskTimeout bounds one task's call to the model, as marketUseTimeout bounds a listing's use.
const taskTimeout = 5 * time.Minute

// taskClient carries the task's call. No Timeout field: taskTimeout on the request's context bounds the whole
// exchange, and a whole-exchange client timeout would cut a long answer short.
var taskClient = &http.Client{}

// maxTaskChars is the longest task Chat hands over, in characters.
const maxTaskChars = 8000

// taskMaxTokens is what the answer may run to: Chat's own (chatApi.ts requestBody), sent where the provider
// needs one.
const taskMaxTokens = 4096

// taskKeyName names the key on Agent Wallets and the Keys screen, where its revocation shows.
const taskKeyName = "Task from Chat"

// handleAgentTask — POST /api/agents/{id}/tasks.
func (a *app) handleAgentTask(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	keys, ok := agentSuffix(w, r, "keys")
	if !ok {
		return
	}
	var in struct {
		Task     string `json:"task"`
		Provider string `json:"provider"`
		Model    string `json:"model"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	task := strings.TrimSpace(in.Task)
	switch {
	case task == "":
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a task needs saying what to do"})
		return
	case utf8.RuneCountInString(task) > maxTaskChars:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a task is at most 8,000 characters"})
		return
	case !streamProviders[in.Provider]:
		// ⚠ BEFORE ANY UPSTREAM CALL, as the stream relay refuses it: the provider is a path segment on Lens.
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown provider"})
		return
	case strings.TrimSpace(in.Model) == "" || len(in.Model) > 200:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a task needs a model"})
		return
	}

	// The agent's key for this task, on the session's own token — Lens refuses an agent that is not this
	// workspace's (404) or is archived (409), and a person who may not issue its keys.
	issued, status, refusal := a.issueTaskKey(r.Context(), t, keys)
	if issued.Key == "" {
		writeJSON(w, status, map[string]string{"error": refusal})
		return
	}

	// The server's 30-second write deadline would drop a long answer on the floor after the agent paid for it.
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(taskTimeout + 30*time.Second))
	ctx, cancel := context.WithTimeout(r.Context(), taskTimeout)
	answered, status, refusal := a.runTask(ctx, in.Provider, in.Model, task, issued.Key)
	cancel()

	revoked := a.revokeTaskKey(context.WithoutCancel(r.Context()), t, issued.ID)
	if refusal != "" {
		writeJSON(w, status, map[string]string{"error": refusal})
		return
	}
	writeJSON(w, http.StatusOK, taskReply{
		AgentID:    r.PathValue("id"),
		Answer:     answered.text,
		Model:      answered.model,
		RequestID:  answered.requestID,
		Replayed:   answered.replayed,
		Usage:      answered.usage,
		KeyRevoked: revoked,
	})
}

// taskKey is what Lens answers an agent key's issue with; the key itself is held only for the task.
type taskKey struct {
	Key string `json:"key"`
	ID  string `json:"id"`
}

// issueTaskKey asks Lens for a key of the agent's own. With none, it answers the status and sentence to refuse with.
func (a *app) issueTaskKey(ctx context.Context, t tenant, suffix string) (taskKey, int, string) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.cfg.lensBaseURL+lensWorkspacePath(t, suffix), bytes.NewReader(agentKeyBody(taskKeyName)))
	if err != nil {
		return taskKey{}, http.StatusBadGateway, "lens upstream request"
	}
	req.Header.Set("Authorization", "Bearer "+t.token) // the SESSION's workspace token, server-side only
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := a.client.Do(req)
	if err != nil {
		log.Printf("bff: agent task key: %v", err)
		return taskKey{}, http.StatusBadGateway, "lens upstream unreachable"
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if resp.StatusCode >= 400 && resp.StatusCode < 500 {
		return taskKey{}, resp.StatusCode, lensSentence(raw, "Lens refused this")
	}
	var k taskKey
	if resp.StatusCode != http.StatusCreated || json.Unmarshal(raw, &k) != nil || k.Key == "" || k.ID == "" {
		log.Printf("bff: agent task key: Lens answered %d with no key", resp.StatusCode)
		return taskKey{}, http.StatusBadGateway, "Lens could not answer just now"
	}
	return k, 0, ""
}

// revokeTaskKey revokes the task's key — the Keys screen's revoke, on the session's token — and reports whether
// Lens said it did. Its own ten seconds, whatever became of the browser.
func (a *app) revokeTaskKey(ctx context.Context, t tenant, keyID string) bool {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, a.cfg.lensBaseURL+lensWorkspacePath(t, "/api-keys/"+url.PathEscape(keyID)), nil)
	if err != nil {
		return false
	}
	req.Header.Set("Authorization", "Bearer "+t.token)
	req.Header.Set("Accept", "application/json")
	resp, err := a.client.Do(req)
	if err != nil {
		log.Printf("bff: agent task key %s not revoked: %v", keyID, err)
		return false
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		log.Printf("bff: agent task key %s not revoked: Lens answered %d", keyID, resp.StatusCode)
	}
	return resp.StatusCode == http.StatusOK
}

// taskReply is the task's answer, as the card shows it.
type taskReply struct {
	AgentID    string    `json:"agent_id"`
	Answer     string    `json:"answer"`
	Model      string    `json:"model,omitempty"`
	RequestID  string    `json:"request_id,omitempty"`
	Replayed   bool      `json:"replayed"`
	Usage      taskUsage `json:"usage"`
	KeyRevoked bool      `json:"key_revoked"`
}

type taskUsage struct {
	InputTokens  int64 `json:"input_tokens"`
	OutputTokens int64 `json:"output_tokens"`
}

// taskAnswer is what the model answered the task, and what Lens said about the call.
type taskAnswer struct {
	text, model, requestID string
	replayed               bool
	usage                  taskUsage
}

// runTask sends the task to the model through Lens's proxy with the agent's key: Anthropic's shape on
// /v1/messages, the OpenAI shape every other provider takes on /v1/chat/completions (chatApi.ts chatPath).
func (a *app) runTask(ctx context.Context, provider, model, task, key string) (taskAnswer, int, string) {
	path := "v1/chat/completions"
	payload := map[string]any{"model": model, "messages": []map[string]string{{"role": "user", "content": task}}}
	if provider == "anthropic" {
		path = "v1/messages"
	}
	if provider == "anthropic" || provider == "bedrock" {
		payload["max_tokens"] = taskMaxTokens
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.cfg.lensBaseURL+"/v1/proxy/"+provider+"/"+path, bytes.NewReader(body))
	if err != nil {
		return taskAnswer{}, http.StatusBadGateway, "lens upstream request"
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := taskClient.Do(req)
	if err != nil {
		log.Printf("bff: agent task: %v", err)
		return taskAnswer{}, http.StatusBadGateway, "The task did not finish: Lens did not answer in time."
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode >= 400 && resp.StatusCode < 500 {
		return taskAnswer{}, resp.StatusCode, lensSentence(raw, "Lens refused this task")
	}
	if resp.StatusCode != http.StatusOK {
		return taskAnswer{}, http.StatusBadGateway, "Lens could not answer just now"
	}
	var out struct {
		Model   string `json:"model"`
		Choices []struct {
			Message struct {
				Content json.RawMessage `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		Usage struct {
			PromptTokens     int64 `json:"prompt_tokens"`
			CompletionTokens int64 `json:"completion_tokens"`
			InputTokens      int64 `json:"input_tokens"`
			OutputTokens     int64 `json:"output_tokens"`
		} `json:"usage"`
	}
	if json.Unmarshal(raw, &out) != nil {
		return taskAnswer{}, http.StatusBadGateway, "Lens answered, but the answer could not be read."
	}
	var text strings.Builder
	for _, c := range out.Content {
		if c.Type == "text" {
			text.WriteString(c.Text)
		}
	}
	for _, c := range out.Choices {
		var s string
		if json.Unmarshal(c.Message.Content, &s) == nil {
			text.WriteString(s)
		}
	}
	return taskAnswer{
		text:      text.String(),
		model:     out.Model,
		requestID: resp.Header.Get(requestIDHeader),
		replayed:  resp.Header.Get("X-Talyvor-Cache-Replay") == "true",
		usage: taskUsage{
			InputTokens:  out.Usage.InputTokens + out.Usage.PromptTokens,
			OutputTokens: out.Usage.OutputTokens + out.Usage.CompletionTokens,
		},
	}, 0, ""
}

// lensSentence is the sentence in a Lens refusal — {"error": "…"}, or a provider's {"error": {"message": "…"}}
// Lens passed on — or fallback.
func lensSentence(raw []byte, fallback string) string {
	var flat struct {
		Error string `json:"error"`
	}
	if json.Unmarshal(raw, &flat) == nil && flat.Error != "" {
		return flat.Error
	}
	var nested struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(raw, &nested) == nil && nested.Error.Message != "" {
		return nested.Error.Message
	}
	return fallback
}
