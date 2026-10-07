package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
)

// chat_history_sync.go — B28.365: Chat's history, synced across a person's devices when they turn it on.
//
// THE BROWSER ENCRYPTS; LENS KEEPS WHAT IT CANNOT READ. apps/web's historySync.ts seals the whole history with
// AES-GCM under a key derived in the browser from a passphrase the person chooses, and only the sealed copy leaves
// it. Without the passphrase the copy is noise to the BFF and to Lens alike, so a private chat's words still never
// reach a server in a form anyone there can read. Sync off, the browser makes none of these calls.
//
//	GET    /api/chat/history-sync   the sealed copy: {"version","salt","iv","ciphertext","updated_at"}; version 0
//	                                and empty strings while nothing is stored
//	PUT    /api/chat/history-sync   {"base_version","salt","iv","ciphertext"} stores a new copy over base_version:
//	                                200 {"version","updated_at"}, or 409 when another device stored one first
//	DELETE /api/chat/history-sync   removes the stored copy
//
// THE LENS SIDE (B28.107) is /v1/workspaces/{ws}/chat-history with the session's workspace token, the same three
// methods and bodies: it stores the three strings as they arrive, versions them (the stored version + 1 on every PUT
// whose base_version is the stored one, 409 otherwise), and answers GET with version 0 while it holds none. A 404
// from Lens therefore means the route is not there, and the screen says sync is not available rather than that
// nothing is stored. The workspace is the session's, in the path, never one the browser names.

// historySyncMaxBytes bounds a sealed copy in both directions. A history lives in localStorage, which a browser holds
// to about 5 MB, and base64 adds a third.
const historySyncMaxBytes = 8 << 20

// historySyncKeys are the keys a PUT carries: nothing else the screen sends reaches Lens.
var historySyncKeys = map[string][]string{"base_version": nil, "salt": nil, "iv": nil, "ciphertext": nil}

// handleChatHistorySync — GET, PUT and DELETE /api/chat/history-sync.
func (a *app) handleChatHistorySync(w http.ResponseWriter, r *http.Request, t tenant) {
	var body []byte
	switch r.Method {
	case http.MethodGet, http.MethodDelete:
	case http.MethodPut:
		var ok bool
		if body, ok = roomBody(w, r, historySyncMaxBytes, historySyncKeys); !ok {
			return
		}
	default:
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPut+", "+http.MethodDelete)
		return
	}
	a.historySyncRelay(w, r, t, body)
}

// historySyncRelay is marketRelay with room for a whole sealed history in the reply: Lens's JSON on a 2xx (an
// empty 204 as {}), its sentence and status on a 4xx, 502 otherwise.
func (a *app) historySyncRelay(w http.ResponseWriter, r *http.Request, t tenant, body []byte) {
	lensPath := lensWorkspacePath(t, "/chat-history")
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(r.Context(), r.Method, a.cfg.lensBaseURL+lensPath, rd)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream request"})
		return
	}
	req.Header.Set("Authorization", "Bearer "+t.token) // server-side only
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := a.client.Do(req)
	if err != nil {
		log.Printf("bff: chat history sync %s %s: %v", r.Method, lensPath, err)
		writeUpstreamFailure(w, "lens", err)
		return
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, historySyncMaxBytes+64<<10))
	switch {
	case resp.StatusCode == http.StatusNoContent:
		writeJSON(w, http.StatusOK, map[string]any{})
	case resp.StatusCode >= 200 && resp.StatusCode < 300 && json.Valid(raw):
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(resp.StatusCode)
		_, _ = w.Write(raw)
	case resp.StatusCode >= 400 && resp.StatusCode < 500:
		var refusal struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(raw, &refusal) != nil || refusal.Error == "" {
			refusal.Error = "Lens refused this"
		}
		writeJSON(w, resp.StatusCode, map[string]string{"error": refusal.Error})
	default:
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens could not answer just now"})
	}
}
