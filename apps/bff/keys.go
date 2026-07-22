package main

// The BFF's first write path: minting a workspace API key. Two disciplines live
// here, argued rather than assumed:
//
// CSRF. The session cookie is __Host-/Secure/HttpOnly/SameSite=Lax. Lax
// withholds it from cross-SITE POSTs — most of CSRF — but SameSite groups every
// *.talyvor.com sibling into ONE site, so a compromised or future sibling
// subdomain could still forge a credential-minting POST with the cookie
// attached. The added layer is a strict Origin check: browsers attach Origin to
// every POST and scripts cannot forge it, so requiring Origin == the configured
// public origin (fail-closed when absent) exactly closes the same-site gap and
// the legacy-browser gap, statelessly. A synchronizer token was considered and
// rejected: everything a token defends against in a browser, Origin already
// covers here (a token earns its machinery when Origin can be absent on
// legitimate traffic — proxies we don't control — which is not this
// deployment: our own Caddy fronts the only public path). Reads stay GET-only,
// so Lax's cross-site-GET allowance stays harmless.
//
// THE RESPONSE CARRIES A SECRET, exactly once, on purpose. The blanket
// never-leaks sweeps stay fully strict everywhere else (this route's POST is
// simply not in their GET sweep lists); the tight guarantees for this one
// response are: Cache-Control: no-store (no cache layer may retain it), the
// BFF never logs the body (the one log line here is transport-error-only), and
// the key appears in no other response — the list serves prefixes.

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"
)

// requireSameOrigin is the write-path CSRF layer. In disabled mode there is no
// public origin to compare and the loopback bind is the guard, as everywhere
// else in that mode.
func (a *app) requireSameOrigin(w http.ResponseWriter, r *http.Request) bool {
	if a.cfg.authMode == authModeDisabled {
		return true
	}
	if origin := r.Header.Get("Origin"); origin != a.cfg.publicBaseURL {
		writeJSON(w, http.StatusForbidden, map[string]string{
			"error": "cross-origin write refused: the Origin header must be the app origin"})
		return false
	}
	return true
}

func (a *app) handleKeys(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		a.forward(w, r, "/v1/workspaces/"+a.cfg.workspaceID+"/api-keys", "")
	case http.MethodPost:
		a.handleMintKey(w, r)
	default:
		methodNotAllowed(w, "GET, POST")
	}
}

func (a *app) handleMintKey(w http.ResponseWriter, r *http.Request) {
	if !a.requireSameOrigin(w, r) {
		return
	}

	// Sanitise by reconstruction: decode the known fields, re-encode, and send
	// ONLY that upstream — unknown client fields never reach Lens, and the raw
	// client body is never streamed anywhere.
	var in struct {
		Name      string   `json:"name"`
		Scopes    []string `json:"scopes"`
		ExpiresAt *string  `json:"expires_at,omitempty"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	if strings.TrimSpace(in.Name) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name is required"})
		return
	}
	body, err := json.Marshal(in)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "encode"})
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost,
		a.cfg.lensBaseURL+"/v1/workspaces/"+a.cfg.workspaceID+"/api-keys", bytes.NewReader(body))
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream request"})
		return
	}
	req.Header.Set("Authorization", "Bearer "+a.cfg.workspaceKey) // server-side only, as everywhere
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := a.client.Do(req)
	if err != nil {
		// Transport error only — the response (and any credential in it) is
		// never logged on any path through this handler.
		log.Printf("bff: keys mint upstream: %v", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream unreachable"})
		return
	}
	defer resp.Body.Close()

	// The one response that carries a credential: no cache layer may keep it.
	w.Header().Set("Cache-Control", "no-store")
	if ct := resp.Header.Get("Content-Type"); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}
