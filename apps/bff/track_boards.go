package main

// B27.30 — public issue boards. A workspace owner turns on a link; anyone holding it opens a
// read-only board at /board/{token}, signed out.
//
//	GET    /api/track/boards           → GET    /v1/workspaces/{ws}/issue-boards       (the live links)
//	POST   /api/track/boards           → POST   /v1/workspaces/{ws}/issue-boards       {"project_id"?}
//	DELETE /api/track/boards/{id}      → DELETE /v1/workspaces/{ws}/issue-boards/{id}
//	GET    /api/public/boards/{token}  → GET    /v1/public/issue-boards/{token}        NO SESSION
//
// The public read is the one Track call this BFF makes for a stranger, so it carries NOTHING of
// the BFF's: no gateway secret, no identity headers. Track serves /v1/public/ without them, and
// the token — checked for shape here before any dial — is the whole credential.

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
)

const maxBoardBody = 1 << 10

type trackBoardCreateBody struct {
	ProjectID *string `json:"project_id,omitempty"`
}

func (a *app) trackBoards() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodPost {
			methodNotAllowed(w, "GET, POST")
			return
		}
		ws, ok := a.trackWorkspaceFor(w, r)
		if !ok {
			return
		}
		path := trackWorkspacePath(ws, "/issue-boards")
		if r.Method == http.MethodGet {
			a.forwardProduct(w, r, "track", a.cfg.trackBaseURL, a.cfg.trackGatewaySecret,
				path, "", http.MethodGet, nil, nil)
			return
		}
		raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBoardBody))
		if err != nil {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "board request too large"})
			return
		}
		var in trackBoardCreateBody
		if len(bytes.TrimSpace(raw)) > 0 {
			if err := json.Unmarshal(raw, &in); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad json"})
				return
			}
		}
		if in.ProjectID != nil {
			p := strings.TrimSpace(*in.ProjectID)
			if p == "" {
				in.ProjectID = nil
			} else if !trackQueryValue(p) {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid project_id"})
				return
			} else {
				in.ProjectID = &p
			}
		}
		payload, err := json.Marshal(in)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not build the board request"})
			return
		}
		a.forwardProduct(w, r, "track", a.cfg.trackBaseURL, a.cfg.trackGatewaySecret,
			path, "", http.MethodPost, bytes.NewReader(payload), nil)
	})
}

func (a *app) trackBoardRevoke() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			methodNotAllowed(w, http.MethodDelete)
			return
		}
		id, ok := pathID(w, "id", r.PathValue("id"))
		if !ok {
			return
		}
		ws, ok := a.trackWorkspaceFor(w, r)
		if !ok {
			return
		}
		a.forwardProduct(w, r, "track", a.cfg.trackBaseURL, a.cfg.trackGatewaySecret,
			trackWorkspacePath(ws, "/issue-boards/"+url.PathEscape(id)), "", http.MethodDelete, nil, nil)
	})
}

// boardToken mirrors Track's own check (internal/issueboard validToken): a link token is 16–64
// URL-safe base64 characters. Anything else is answered here, without a dial.
func boardToken(t string) bool {
	if len(t) < 16 || len(t) > 64 {
		return false
	}
	for _, c := range t {
		if !tokenRune(c) {
			return false
		}
	}
	return true
}

// tokenRune reports whether c is in the URL-safe base64 alphabet a link token is written in.
func tokenRune(c rune) bool {
	switch {
	case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '-', c == '_':
		return true
	}
	return false
}

func (a *app) publicBoard() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		token := r.PathValue("token")
		if !boardToken(token) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "board not found"})
			return
		}
		if a.cfg.trackBaseURL == "" {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{
				"error": "track upstream not configured on this BFF"})
			return
		}
		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet,
			a.cfg.trackBaseURL+"/v1/public/issue-boards/"+url.PathEscape(token), nil)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "track upstream request"})
			return
		}
		req.Header.Set("Accept", "application/json")
		resp, err := a.client.Do(req)
		if err != nil {
			// The URL holds the token, which is the board's whole credential — log the cause only.
			cause := err
			var ue *url.Error
			if errors.As(err, &ue) {
				cause = ue.Err
			}
			log.Printf("bff: track public board: %v", cause)
			writeUpstreamFailure(w, "track", err)
			return
		}
		defer resp.Body.Close()
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, io.LimitReader(resp.Body, 4<<20))
	}
}
