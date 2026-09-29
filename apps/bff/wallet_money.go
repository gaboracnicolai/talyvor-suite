package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
)

// wallet_money.go — B22.10: Agent Wallets' money between owners. Lens's transfers between any agents
// (B22.3), a company's credit line (B22.4) and loans between companies (B22.5), and the class each of
// those capabilities carries (B22.1), reached with this session's own token:
//
//	GET  /api/wallets/capabilities                     each capability, its class and whether it takes real money
//	GET  /api/wallets/address/{address}                who a wallet ID or @handle is, before sending to it
//	PUT  /api/agents/{id}/handle        {handle}       the agent's address besides its wallet ID
//	POST /api/agents/{id}/send          {to, amount_ulxc, memo}     to any agent on Talyvor
//	POST /api/agents/{id}/requests      {from, amount_ulxc, memo}   ask any agent for credits
//	GET  /api/agents/{id}/transfers                    what the agent sent and received
//	GET  /api/wallets/requests                         the requests the workspace's agents made and were made
//	POST /api/wallets/requests/{rid}/accept, …/decline
//	GET  /api/wallets/credit-line                      the company's credit line (404: none)
//	GET  /api/wallets/loans                            the loans the workspace lends and borrows
//	POST /api/agents/{id}/loans         {to, principal_ulxc, interest_bps, instalments, every, late_fee_ulxc, memo}
//	POST /api/wallets/loans/{lid}/accept, …/decline, …/withdraw
//
// Lens decides everything — who may move money, each capability's class, whether live money is refused —
// and a refusal comes back with its sentence (agentBankRelay). Every body sent up is rebuilt from the
// fields each handler names.

// walletRelay is agentBankRelay for a Lens route that is not under the workspace (/v1/wallets/…).
func (a *app) walletRelay(w http.ResponseWriter, r *http.Request, t tenant, path string) {
	a.agentBankRelayPath(w, r, t, http.MethodGet, path, nil)
}

// handleWalletCapabilities — GET /api/wallets/capabilities.
func (a *app) handleWalletCapabilities(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.walletRelay(w, r, t, "/v1/wallets/capabilities")
}

// handleWalletAddress — GET /api/wallets/address/{address}.
func (a *app) handleWalletAddress(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	address, ok := pathID(w, "address", r.PathValue("address"))
	if !ok {
		return
	}
	a.walletRelay(w, r, t, "/v1/wallets/"+url.PathEscape(address))
}

// handleAgentHandle — PUT /api/agents/{id}/handle.
func (a *app) handleAgentHandle(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPut {
		methodNotAllowed(w, http.MethodPut)
		return
	}
	suffix, ok := agentSuffix(w, r, "handle")
	if !ok {
		return
	}
	var in struct {
		Handle string `json:"handle"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensAgentHandleBody: none
	body, _ := json.Marshal(in)
	a.agentBankRelay(w, r, t, http.MethodPut, suffix, body)
}

// handleAgentSend — POST /api/agents/{id}/send: the agent sends credits to any agent, by wallet ID or @handle.
func (a *app) handleAgentSend(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	suffix, ok := agentSuffix(w, r, "send")
	if !ok {
		return
	}
	var in struct {
		To         string `json:"to"`
		AmountULXC int64  `json:"amount_ulxc"`
		Memo       string `json:"memo"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensAgentSendBody: from
	body, _ := json.Marshal(in)
	a.agentBankRelay(w, r, t, http.MethodPost, suffix, body)
}

// handleAgentRequest — POST /api/agents/{id}/requests: the agent asks any agent for credits.
func (a *app) handleAgentRequest(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	suffix, ok := agentSuffix(w, r, "requests")
	if !ok {
		return
	}
	var in struct {
		From       string `json:"from"`
		AmountULXC int64  `json:"amount_ulxc"`
		Memo       string `json:"memo"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensAgentRequestBody: to
	body, _ := json.Marshal(in)
	a.agentBankRelay(w, r, t, http.MethodPost, suffix, body)
}

// handleAgentTransfers — GET /api/agents/{id}/transfers.
func (a *app) handleAgentTransfers(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	suffix, ok := agentSuffix(w, r, "transfers")
	if !ok {
		return
	}
	a.agentBankRelay(w, r, t, http.MethodGet, suffix, nil)
}

// handleMoneyRequests — GET /api/wallets/requests.
func (a *app) handleMoneyRequests(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.agentBankRelay(w, r, t, http.MethodGet, "/money-requests", nil)
}

// handleMoneyRequestAnswer — POST /api/wallets/requests/{rid}/accept and /decline.
func (a *app) handleMoneyRequestAnswer(answer string) func(http.ResponseWriter, *http.Request, tenant) {
	return func(w http.ResponseWriter, r *http.Request, t tenant) {
		if r.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodPost)
			return
		}
		id, ok := pathID(w, "request id", r.PathValue("rid"))
		if !ok {
			return
		}
		a.agentBankRelay(w, r, t, http.MethodPost, "/money-requests/"+url.PathEscape(id)+"/"+answer, nil)
	}
}

// handleCreditLine — GET /api/wallets/credit-line.
func (a *app) handleCreditLine(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.agentBankRelay(w, r, t, http.MethodGet, "/credit-line", nil)
}

// handleLoans — GET /api/wallets/loans.
func (a *app) handleLoans(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.agentBankRelay(w, r, t, http.MethodGet, "/loans", nil)
}

// handleAgentLoan — POST /api/agents/{id}/loans: the agent offers another company's agent a loan.
func (a *app) handleAgentLoan(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	suffix, ok := agentSuffix(w, r, "loans")
	if !ok {
		return
	}
	var in struct {
		To            string `json:"to"`
		PrincipalULXC int64  `json:"principal_ulxc"`
		InterestBPS   int    `json:"interest_bps"`
		Instalments   int    `json:"instalments"`
		Every         string `json:"every"`
		LateFeeULXC   int64  `json:"late_fee_ulxc"`
		Memo          string `json:"memo"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensAgentLoanBody: none
	body, _ := json.Marshal(in)
	a.agentBankRelay(w, r, t, http.MethodPost, suffix, body)
}

// handleLoanAction — POST /api/wallets/loans/{lid}/accept, /decline and /withdraw.
func (a *app) handleLoanAction(action string) func(http.ResponseWriter, *http.Request, tenant) {
	return func(w http.ResponseWriter, r *http.Request, t tenant) {
		if r.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodPost)
			return
		}
		id, ok := pathID(w, "loan id", r.PathValue("lid"))
		if !ok {
			return
		}
		a.agentBankRelay(w, r, t, http.MethodPost, "/loans/"+url.PathEscape(id)+"/"+action, nil)
	}
}
