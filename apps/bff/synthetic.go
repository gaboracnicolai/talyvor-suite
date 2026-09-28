package main

import (
	"crypto/subtle"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"regexp"
	"time"
)

// B17.2 — SYNTHETIC USERS SIGN IN TO THE REAL WEB APP.
//
//	POST /auth/synthetic   X-Talyvor-Synthetic-Key: <LENS_SYNTHETIC_KEY>
//	                       {"workspace_id":"s…","token":"…","expires_at":"…"}
//
// The body is one entry of what Lens's POST /v1/synthetic/workspaces returned (B17.1). The BFF gives
// that workspace an ordinary browser session — the same __Host- cookie a Google sign-in gets — so a
// headless browser uses the real app exactly as a person does.
//
// ONLY A SYNTHETIC WORKSPACE, AND LENS IS THE ONE WHO SAYS SO. The BFF asks Lens for the workspace
// with the presented token (GET /v1/workspaces/{id}): Lens's isolation middleware refuses a token
// for any other workspace, and the answer must carry "synthetic": true, which only Lens's
// CreateSynthetic ever sets and nothing clears. A real workspace — even with its own valid token —
// is refused. The session is marked synthetic and is never re-provisioned (tenant.go), so it cannot
// turn into, or create, a real account either.
//
// Unset LENS_SYNTHETIC_KEY (the default) and the route answers 404. The key is compared in constant
// time; every attempt is logged, never with the key or the token.

const (
	// syntheticKeyHeader is the header Lens's synthetic routes read (cmd/lens/synthetic_handler.go).
	syntheticKeyHeader = "X-Talyvor-Synthetic-Key"
	// syntheticEmailDomain is reserved (.invalid, RFC 2606): the address can never reach anyone.
	syntheticEmailDomain = "@synthetic.talyvor.invalid"
)

// syntheticWorkspaceIDShape bounds the id before it becomes a path segment. It is not the proof of
// being synthetic — Lens's answer is.
var syntheticWorkspaceIDShape = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

func (a *app) handleSyntheticSignIn(w http.ResponseWriter, r *http.Request) {
	if a.cfg.syntheticKey == "" || a.auth == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "synthetic sign-in is not enabled on this BFF"})
		return
	}
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	if subtle.ConstantTimeCompare([]byte(r.Header.Get(syntheticKeyHeader)), []byte(a.cfg.syntheticKey)) != 1 {
		log.Printf("bff: synthetic sign-in REFUSED from %s: wrong or missing %s", r.RemoteAddr, syntheticKeyHeader)
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "the synthetic operator key is required"})
		return
	}
	var in struct {
		WorkspaceID string `json:"workspace_id"`
		Token       string `json:"token"`
		ExpiresAt   string `json:"expires_at"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 16<<10)).Decode(&in); err != nil ||
		!syntheticWorkspaceIDShape.MatchString(in.WorkspaceID) || in.Token == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": `send {"workspace_id","token"} — one workspace from Lens's POST /v1/synthetic/workspaces`})
		return
	}

	t := tenant{workspaceID: in.WorkspaceID, token: in.Token}
	ws, status := a.lensWorkspace(r, t)
	if status != http.StatusOK || ws.ID != in.WorkspaceID || !ws.Synthetic || !ws.Active {
		log.Printf("bff: synthetic sign-in REFUSED for workspace %s: lens %d, synthetic=%t active=%t",
			in.WorkspaceID, status, ws.Synthetic, ws.Active)
		writeJSON(w, http.StatusForbidden, map[string]string{
			"error": "only a synthetic workspace can sign in this way, and Lens does not vouch for this one"})
		return
	}

	expires := time.Now().Add(a.cfg.sessionTTL)
	tokenExp := parseExpiry(in.ExpiresAt)
	if !tokenExp.IsZero() && tokenExp.Before(expires) {
		expires = tokenExp
	}
	if !time.Now().Before(expires) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "that synthetic token has expired — create new workspaces"})
		return
	}
	if err := a.startSession(w, r, session{
		sub:          "synthetic:" + ws.ID,
		email:        ws.ID + syntheticEmailDomain,
		expires:      expires,
		workspaceID:  ws.ID,
		lensToken:    in.Token,
		lensTokenExp: tokenExp,
		// Lens turned pooling on when it created the workspace; there is no question to ask.
		cachePoolable: ws.CachePoolable,
		synthetic:     true,
	}, int(time.Until(expires).Seconds())); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "entropy unavailable"})
		return
	}
	log.Printf("bff: synthetic session created for workspace %s", ws.ID)
	writeJSON(w, http.StatusOK, map[string]any{"workspace_id": ws.ID, "synthetic": true,
		"expires_at": expires.UTC().Format(time.RFC3339)})
}

// lensWorkspaceRecord is the part of Lens's GET /v1/workspaces/{id} this file reads.
type lensWorkspaceRecord struct {
	ID            string `json:"id"`
	Active        bool   `json:"active"`
	CachePoolable bool   `json:"cache_poolable"`
	Synthetic     bool   `json:"synthetic"`
}

// lensWorkspace reads t's workspace from Lens with t's own token. Any failure is a zero record.
func (a *app) lensWorkspace(r *http.Request, t tenant) (lensWorkspaceRecord, int) {
	var ws lensWorkspaceRecord
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, a.cfg.lensBaseURL+lensWorkspacePath(t, ""), nil)
	if err != nil {
		return ws, http.StatusBadGateway
	}
	req.Header.Set("Authorization", "Bearer "+t.token)
	req.Header.Set("Accept", "application/json")
	resp, err := a.client.Do(req)
	if err != nil {
		return ws, http.StatusBadGateway
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ws, resp.StatusCode
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&ws); err != nil {
		return lensWorkspaceRecord{}, http.StatusBadGateway
	}
	return ws, http.StatusOK
}
