package main

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

// kya.go — B30.103: each agent's Know Your Agent credential (Lens B30.5, docs/kya.md), with this session's own token:
//
//	GET  /api/agents/{id}/credential            the agent's credential — a new one when what it held is no longer true;
//	                                            409 with Lens's sentence while the agent is frozen or archived
//	POST /api/kya/verify        {credential}    Talyvor's answer on a credential: valid, or why not, and what it says
//
// Lens signs, revokes and verifies. Verify is Lens's public check — any platform may call it without an account — so
// the owner checks a credential here exactly as the platform their agent shows it to would.

// handleAgentCredential — GET /api/agents/{id}/credential.
func (a *app) handleAgentCredential(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	suffix, ok := agentSuffix(w, r, "credential")
	if !ok {
		return
	}
	a.agentBankRelay(w, r, t, http.MethodGet, suffix, nil)
}

// handleKYAVerify — POST /api/kya/verify.
func (a *app) handleKYAVerify(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	var in struct {
		Credential string `json:"credential"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	in.Credential = strings.TrimSpace(in.Credential)
	if in.Credential == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "paste the credential to check"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensKYAVerifyBody: none
	body, _ := json.Marshal(in)
	a.agentBankRelayPath(w, r, t, http.MethodPost, "/v1/kya/verify", body)
}
