package main

// chat_shares.go — B28.127: a chat shared as a link, read by anyone who has it, signed out, until it is turned off.
//
//	GET    /api/chat/shares            → GET    /v1/workspaces/{ws}/chat-shares       the live links, newest first
//	POST   /api/chat/shares            → POST   /v1/workspaces/{ws}/chat-shares       {"conversation_id","title","messages"}
//	DELETE /api/chat/shares/{id}       → DELETE /v1/workspaces/{ws}/chat-shares/{id}  turns the link off
//	GET    /api/public/chats/{token}   → GET    /v1/public/chat-shares/{token}        NO SESSION
//	GET    /share/{token}              the page a stranger opens: the app, answered 404 once the link is off
//
// A private chat lives in its person's browser (apps/web history.ts); sharing it is the one act that hands Lens a copy.
// The copy is what the person saw when they shared — each question and answer's text, and the chat's title — and
// nothing else of it: no costs, no attachments, no versions. Turning the link off deletes the copy.
//
// THE LENS SIDE (the talyvor-lens item after B28.127) mounts those four routes. The three on the session's workspace
// token keep {id, token, conversation_id, title, created_at} with the messages; the token is 32 URL-safe base64
// characters from crypto/rand, the whole credential. The public read carries NO credential and answers
// {title, messages, created_at} — never the workspace or the conversation id — or 404 for a token it does not hold.
// Until it lands, Chat says sharing is not available here yet.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

// chatShareMaxBytes bounds a shared copy. A long chat is a few hundred kilobytes of text.
const chatShareMaxBytes = 512 << 10

// chatShareTitleMax is the longest title a link carries, in characters; history.ts derives one of at most 60.
const chatShareTitleMax = 200

// chatShareMessage is one turn of a shared chat: who said it and what.
type chatShareMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// handleChatShares — GET and POST /api/chat/shares.
func (a *app) handleChatShares(w http.ResponseWriter, r *http.Request, t tenant) {
	switch r.Method {
	case http.MethodGet:
		a.marketRelay(w, r, a.client, t.token, http.MethodGet, lensWorkspacePath(t, "/chat-shares"), nil, "")
	case http.MethodPost:
		body, ok := chatShareRequest(w, r)
		if !ok {
			return
		}
		a.marketRelay(w, r, a.client, t.token, http.MethodPost, lensWorkspacePath(t, "/chat-shares"), body, "")
	default:
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
	}
}

// chatShareRequest is the screen's share as Lens is sent it, or false having answered 400: a conversation id, a title
// and at least one turn, each a question or an answer with words in it, and no other key anywhere.
func chatShareRequest(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	raw, err := io.ReadAll(io.LimitReader(r.Body, chatShareMaxBytes+1))
	if err != nil || len(raw) > chatShareMaxBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "this chat is too long to share"})
		return nil, false
	}
	// What a share sends Lens, and all it sends.
	var in struct {
		ConversationID string             `json:"conversation_id"`
		Title          string             `json:"title"`
		Messages       []chatShareMessage `json:"messages"`
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if dec.Decode(&in) != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return nil, false
	}
	in.Title = strings.Join(strings.Fields(in.Title), " ")
	if in.Title == "" || len([]rune(in.Title)) > chatShareTitleMax {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a shared chat needs a title of at most 200 characters"})
		return nil, false
	}
	if in.ConversationID == "" || !trackQueryValue(in.ConversationID) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid conversation_id"})
		return nil, false
	}
	if len(in.Messages) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "there is nothing in this chat to share yet"})
		return nil, false
	}
	for _, m := range in.Messages {
		if (m.Role != "user" && m.Role != "assistant") || strings.TrimSpace(m.Content) == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "each turn is a question or an answer with words in it"})
			return nil, false
		}
	}
	// UPSTREAM-BINDS-ONLY lensChatShareBody: none
	body, err := json.Marshal(in)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not build the share"})
		return nil, false
	}
	return body, true
}

// handleChatShareRevoke — DELETE /api/chat/shares/{id}.
func (a *app) handleChatShareRevoke(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodDelete {
		methodNotAllowed(w, http.MethodDelete)
		return
	}
	id, ok := pathID(w, "share id", r.PathValue("id"))
	if !ok {
		return
	}
	lensPath := lensWorkspacePath(t, "/chat-shares/"+url.PathEscape(id))
	req, err := http.NewRequestWithContext(r.Context(), http.MethodDelete, a.cfg.lensBaseURL+lensPath, nil)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream request"})
		return
	}
	req.Header.Set("Authorization", "Bearer "+t.token) // server-side only
	req.Header.Set("Accept", "application/json")
	resp, err := a.client.Do(req)
	if err != nil {
		log.Printf("bff: chat share revoke %s: %v", lensPath, err)
		writeUpstreamFailure(w, "lens", err)
		return
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	switch {
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		// Lens's 204 has no body for the screen to read, so the answer says what happened.
		writeJSON(w, http.StatusOK, map[string]bool{"revoked": true})
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

// publicChatShare — GET /api/public/chats/{token}, for a stranger. Like the public board, it carries nothing of the
// BFF's to Lens: no credential, no identity. The token, checked for shape before any dial, is the whole credential.
func (a *app) publicChatShare() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		token := r.PathValue("token")
		if !boardToken(token) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "chat not found"})
			return
		}
		resp, err := a.readChatShare(r.Context(), token)
		if err != nil {
			writeUpstreamFailure(w, "lens", err)
			return
		}
		defer func() { _ = resp.Body.Close() }()
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, io.LimitReader(resp.Body, 2*chatShareMaxBytes))
	}
}

// readChatShare asks Lens for a shared chat with no credential. A failure to dial is logged by its cause only: the
// URL holds the token.
func (a *app) readChatShare(ctx context.Context, token string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.cfg.lensBaseURL+"/v1/public/chat-shares/"+url.PathEscape(token), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := a.client.Do(req)
	if err != nil {
		cause := err
		var ue *url.Error
		if errors.As(err, &ue) {
			cause = ue.Err
		}
		log.Printf("bff: public chat share: %v", cause)
		return nil, cause
	}
	return resp, nil
}

// sharePage — GET /share/{token}: the app, whose page reads the chat. A link Lens no longer holds — turned off, or
// never made — is answered 404 with the same page, which says so, so the link itself is gone and not only its words.
// When Lens cannot be asked, the page is served as any other and says it could not read the chat.
func (a *app) sharePage() http.Handler {
	spa := a.spaHandler()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			methodNotAllowed(w, http.MethodGet+", "+http.MethodHead)
			return
		}
		gone := !boardToken(r.PathValue("token"))
		if !gone {
			if resp, err := a.readChatShare(r.Context(), r.PathValue("token")); err == nil {
				gone = resp.StatusCode == http.StatusNotFound
				_ = resp.Body.Close()
			}
		}
		if !gone {
			spa.ServeHTTP(w, r)
			return
		}
		page, err := os.ReadFile(filepath.Join(filepath.Clean(a.cfg.webDist), "index.html"))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusNotFound)
		if r.Method == http.MethodGet {
			_, _ = w.Write(page)
		}
	})
}
