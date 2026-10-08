package main

import (
	"encoding/json"
	"io"
	"net/http"
)

// verification.go — B30.116: the owner's verification levels (Lens B30.4), reached with this session's own token:
//
//	GET  /api/verification                                    the level, the live level and every check
//	POST /api/verification/contact   {email, phone}           L1: email and phone confirmed
//	POST /api/verification/identity  {name, country, date_of_birth}
//	                                                          L2: identity checked
//	POST /api/verification/company   {name, country, company_number, directors, people_with_significant_control}
//	                                                          L3: company checked
//
// Lens decides everything: the order (a check before the level below it is a 409 naming that level), the
// provider that checks, and what a Test provider's pass counts for. Each answers 201 with the check and the
// record, and a refusal comes back with its sentence (agentBankRelay). Every body is rebuilt from the fields its
// own check confirms, so a contact check never carries a name and an identity check never a phone number. The
// level each capability needs for live money is level_needed on GET /api/wallets/capabilities (wallet_money.go).

// handleVerification — GET /api/verification.
func (a *app) handleVerification(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.agentBankRelay(w, r, t, http.MethodGet, "/verification", nil)
}

// handleVerificationContact — POST /api/verification/contact: the email and phone check (L1).
func (a *app) handleVerificationContact(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	var in struct {
		Email string `json:"email"`
		Phone string `json:"phone"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensVerificationContactBody: company_number, country, date_of_birth, directors, name, people_with_significant_control
	body, _ := json.Marshal(in)
	a.agentBankRelay(w, r, t, http.MethodPost, "/verification/contact", body)
}

// handleVerificationIdentity — POST /api/verification/identity: the identity check (L2).
func (a *app) handleVerificationIdentity(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	var in struct {
		Name        string `json:"name"`
		Country     string `json:"country"`
		DateOfBirth string `json:"date_of_birth"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensVerificationIdentityBody: company_number, directors, email, people_with_significant_control, phone
	body, _ := json.Marshal(in)
	a.agentBankRelay(w, r, t, http.MethodPost, "/verification/identity", body)
}

// handleVerificationCompany — POST /api/verification/company: the company check (L3).
func (a *app) handleVerificationCompany(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	var in struct {
		Name               string   `json:"name"`
		Country            string   `json:"country"`
		CompanyNumber      string   `json:"company_number"`
		Directors          []string `json:"directors"`
		SignificantControl []string `json:"people_with_significant_control"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensVerificationCompanyBody: date_of_birth, email, phone
	body, _ := json.Marshal(in)
	a.agentBankRelay(w, r, t, http.MethodPost, "/verification/company", body)
}
