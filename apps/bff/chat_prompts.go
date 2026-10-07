package main

// chat_prompts.go — B28.370: Chat's prompt library, the workspace's named prompts in Lens.
//
//	GET  /api/chat/prompts                                   the workspace's prompts → {"prompts": [{name, version, description, content, updated_at}]}
//	POST /api/chat/prompts {"name", "content", "description"} saves a new one → the prompt as Lens stored it
//
// Both go to Lens's /v1/prompts on the session's own workspace token, so they read and write this workspace's
// prompts and no other's (Lens forces a non-admin to its own workspace on both).
//
// A chat uses a prompt by name: its request carries a system message of exactly "lens:prompt:<name>", Lens swaps in
// the prompt's active version before the model reads it and says so with X-Talyvor-Prompt-Resolved: true, which the
// stream relay passes on (stream.go). Chat shows that under the answer.

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"
)

const lensPromptsPath = "/v1/prompts"

// promptResolvedHeader is Lens saying it swapped a request's "lens:prompt:<name>" for the named prompt.
const promptResolvedHeader = "X-Talyvor-Prompt-Resolved"

// promptNamePattern is the shape of a prompt name Chat saves: letters, digits, '.', '_' and '-', at most 64. A chat
// names it inside a system message, so it carries no spaces or line breaks.
var promptNamePattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)

// promptContentMaxBytes bounds the text of one prompt. A system prompt is long, but not this long.
const promptContentMaxBytes = 32 << 10

// chatPrompt is one prompt as Chat lists it: the active version's text.
type chatPrompt struct {
	Name        string    `json:"name"`
	Version     int       `json:"version"`
	Description string    `json:"description"`
	Content     string    `json:"content"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func (a *app) handleChatPrompts(w http.ResponseWriter, r *http.Request, t tenant) {
	switch r.Method {
	case http.MethodGet:
		raw, err := a.lensGet(r.Context(), t, lensPromptsPath)
		if err != nil {
			log.Printf("bff: chat prompts: %v", err)
			writeJSON(w, upstreamStatusOr(err, http.StatusBadGateway), map[string]string{"error": "lens could not list the prompts"})
			return
		}
		var all []chatPrompt
		if err := json.Unmarshal(raw, &all); err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens answered with something that is not a list of prompts"})
			return
		}
		if all == nil {
			all = []chatPrompt{}
		}
		writeJSON(w, http.StatusOK, map[string]any{"prompts": all})
	case http.MethodPost:
		var in struct {
			Name        string `json:"name"`
			Content     string `json:"content"`
			Description string `json:"description"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, promptContentMaxBytes+(4<<10))).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name and content required"})
			return
		}
		in.Content = strings.TrimSpace(in.Content)
		in.Description = strings.TrimSpace(in.Description)
		if !promptNamePattern.MatchString(in.Name) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a name is letters, digits, dots, dashes and underscores, at most 64"})
			return
		}
		if in.Content == "" || len(in.Content) > promptContentMaxBytes || len(in.Description) > 512 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "the prompt's text is required, at most 32 KB, and its description at most 512 characters"})
			return
		}
		// UPSTREAM-BINDS-ONLY lensPromptCreateBody: id, version, workspace_id, is_active, created_by, created_at, updated_at
		body, _ := json.Marshal(map[string]string{"name": in.Name, "content": in.Content, "description": in.Description})
		raw, err := a.lensSend(r.Context(), t, http.MethodPost, lensPromptsPath, body, http.StatusCreated)
		if err != nil {
			log.Printf("bff: chat prompt save: %v", err)
			writeJSON(w, upstreamStatusOr(err, http.StatusBadGateway), map[string]string{"error": "lens did not save the prompt"})
			return
		}
		var saved chatPrompt
		if err := json.Unmarshal(raw, &saved); err != nil || saved.Name != in.Name {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens answered without the prompt it saved"})
			return
		}
		writeJSON(w, http.StatusCreated, saved)
	default:
		methodNotAllowed(w, "GET, POST")
	}
}

// lensSend sends body to a Lens route on the session's workspace token, and returns Lens's reply when it answers with
// want.
func (a *app) lensSend(ctx context.Context, t tenant, method, path string, body []byte, want int) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, method, a.cfg.lensBaseURL+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+t.token)
	resp, err := a.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != want {
		return nil, &lensStatusError{path: method + " " + path, status: resp.StatusCode}
	}
	return raw, nil
}
