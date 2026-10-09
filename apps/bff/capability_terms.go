package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
)

// capability_terms.go — B30.103: each money capability's terms (Lens B30.9), read and accepted with this session's
// own token:
//
//	GET  /api/terms                                every capability with terms: its latest version, and whether this
//	                                               workspace has accepted it
//	GET  /api/terms/{capability}                   the latest version's text, and whether it is accepted
//	POST /api/terms/{capability}/accept  {version} accept that version, which must be the latest
//
// Lens decides everything: who may accept (the workspace's owner, never the operator), which version is the latest (an
// older one is a 409 saying a newer one is published) and what an acceptance lets through — until it is recorded the
// capability refuses its money, test or live. A refusal comes back with its sentence (agentBankRelay).

// termsSuffix is the Lens suffix for one capability's terms, or false having answered 400.
func termsSuffix(w http.ResponseWriter, r *http.Request, action string) (string, bool) {
	c, ok := pathID(w, "capability", r.PathValue("capability"))
	if !ok {
		return "", false
	}
	return "/terms/" + url.PathEscape(c) + action, true
}

// handleTerms — GET /api/terms.
func (a *app) handleTerms(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.agentBankRelay(w, r, t, http.MethodGet, "/terms", nil)
}

// handleTermsFor — GET /api/terms/{capability}.
func (a *app) handleTermsFor(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	suffix, ok := termsSuffix(w, r, "")
	if !ok {
		return
	}
	a.agentBankRelay(w, r, t, http.MethodGet, suffix, nil)
}

// handleTermsAccept — POST /api/terms/{capability}/accept: the owner accepts the version they read.
func (a *app) handleTermsAccept(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	suffix, ok := termsSuffix(w, r, "/accept")
	if !ok {
		return
	}
	var in struct {
		Version int `json:"version"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<12)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensTermsAcceptBody: none
	body, _ := json.Marshal(in)
	a.agentBankRelay(w, r, t, http.MethodPost, suffix, body)
}
