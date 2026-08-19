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
	"net/url"
	"strings"
)

func (a *app) handleKeys(w http.ResponseWriter, r *http.Request, t tenant) {
	switch r.Method {
	case http.MethodGet:
		a.forward(w, r, t, lensWorkspacePath(t, "/api-keys"), "")
	case http.MethodPost:
		a.handleMintKey(w, r, t)
	default:
		methodNotAllowed(w, "GET, POST")
	}
}

// handleKeyByID serves /api/keys/{id}. Today that is revocation and nothing else.
//
// ⚠ THE WORKSPACE IS NEVER READ FROM THE REQUEST. The upstream path is lensWorkspacePath(t, …),
// built from the SESSION tenant, so the only caller-controlled part of it is the key id. That is
// what makes this route safe to expose at all: a revoke that took a workspace from the caller would
// be a cross-tenant delete wearing a session cookie, and no amount of upstream checking would make
// the BFF's own behaviour correct.
//
// Lens re-checks ownership independently — it lists the workspace's keys and 404s an id that is not
// among them — so a foreign id fails on both sides rather than relying on either.
func (a *app) handleKeyByID(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodDelete {
		methodNotAllowed(w, http.MethodDelete)
		return
	}
	// The id is the one segment a caller controls, so it goes through the same validator every
	// other id route in this BFF uses — no traversal, no separators, no control characters.
	id, ok := pathID(w, "key id", r.PathValue("id"))
	if !ok {
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodDelete,
		a.cfg.lensBaseURL+lensWorkspacePath(t, "/api-keys/"+url.PathEscape(id)), nil)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream request"})
		return
	}
	req.Header.Set("Authorization", "Bearer "+t.token) // the SESSION's workspace token, server-side only
	req.Header.Set("Accept", "application/json")

	resp, err := a.client.Do(req)
	if err != nil {
		log.Printf("bff: revoke key: %v", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream unreachable"})
		return
	}
	defer resp.Body.Close()

	// The upstream status passes through UNCHANGED. A 404 means Lens refused because the key is not
	// this workspace's (or is already gone) — laundering that into a 200 would tell someone a
	// credential was destroyed when it was not, which on a revoke is the dangerous direction to be
	// wrong in.
	if ct := resp.Header.Get("Content-Type"); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

func (a *app) handleMintKey(w http.ResponseWriter, r *http.Request, t tenant) {

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
	// UPSTREAM-BINDS-ONLY lensMintKeyBody: none
	// ⚠ THE TWO KEYS ON THIS ROUTE FAIL IN OPPOSITE DIRECTIONS, MEASURED against lens f09348d1 by
	// executing tenant.Store.CreateAPIKey directly.
	//
	//   scopes  → LOUD. An empty list is refused AT ISSUANCE, and that refusal is load-bearing:
	//             auth.RequireScope deliberately grandfathers len(Scopes)==0 into passing EVERY
	//             scope check so keys predating scopes keep working. The issuance refusal is the
	//             only thing between a renamed `scopes` and a console-minted key that satisfies
	//             the proxy gate which spends the workspace's credit.
	//   name    → SILENT. CreateAPIKey accepts "" and stores it; the blank-name refusal is ours,
	//             above, so an upstream rename is the one way to reach that arm — a key appears
	//             on the Keys screen with no name and no error anywhere.
	body, err := json.Marshal(in)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "encode"})
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost,
		a.cfg.lensBaseURL+lensWorkspacePath(t, "/api-keys"), bytes.NewReader(body))
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream request"})
		return
	}
	req.Header.Set("Authorization", "Bearer "+t.token) // the SESSION's workspace token, server-side only
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
