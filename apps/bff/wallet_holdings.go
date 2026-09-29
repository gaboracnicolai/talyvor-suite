package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"time"
)

// wallet_holdings.go — B22.12: Agent Wallets' escrow, pots, simulated investing and cash-out. Lens's
// escrow between agents (B22.6), an agent's pots (B22.7), simulated portfolios and orders (B22.8) and
// cash-out through a partner (B22.9), reached with this session's own token:
//
//	POST /api/agents/{id}/escrows      {to, amount_ulxc, release_at, memo}   pay into escrow for any agent
//	GET  /api/wallets/escrows                                                what the workspace's agents paid in and are owed
//	POST /api/wallets/escrows/{eid}/confirm, …/dispute {reason}              the payer's side
//	GET  /api/agents/{id}/pots                                               the agent's pots
//	POST /api/agents/{id}/pots         {name, kind, target_ulxc, locked_until}
//	POST /api/agents/{id}/pots/{pid}/in, …/out {amount_ulxc}
//	PUT  /api/agents/{id}/pots/{pid}/lock {locked_until}
//	GET  /api/wallets/quotes                                                 every instrument the simulator trades, at its price
//	GET  /api/agents/{id}/portfolios                                         the agent's simulated portfolios
//	POST /api/agents/{id}/portfolios   {name, cash_uusd}
//	POST /api/agents/{id}/portfolios/{pfid}/orders {instrument, side, type, quantity_micros, limit_price_usd}
//	POST /api/agents/{id}/portfolios/{pfid}/orders/{oid}/cancel
//	GET  /api/wallets/cash-outs                                              every cash-out and where it stands
//	POST /api/agents/{id}/cash-outs    {amount_ulxc, destination}
//
// Lens decides everything — who may move money, each capability's class, whether live money is refused —
// and a refusal comes back with its sentence (agentBankRelay). Every body sent up is rebuilt from the
// fields each handler names; an order never carries a mode, so it is always simulated.

// handleAgentEscrow — POST /api/agents/{id}/escrows: the agent pays credits into escrow for any agent.
func (a *app) handleAgentEscrow(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	suffix, ok := agentSuffix(w, r, "escrows")
	if !ok {
		return
	}
	var in struct {
		To         string    `json:"to"`
		AmountULXC int64     `json:"amount_ulxc"`
		ReleaseAt  time.Time `json:"release_at"`
		Memo       string    `json:"memo"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensAgentEscrowBody: none
	body, _ := json.Marshal(in)
	a.agentBankRelay(w, r, t, http.MethodPost, suffix, body)
}

// handleEscrows — GET /api/wallets/escrows.
func (a *app) handleEscrows(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.agentBankRelay(w, r, t, http.MethodGet, "/escrows", nil)
}

// handleEscrowConfirm — POST /api/wallets/escrows/{eid}/confirm: delivered, release it to the payee.
func (a *app) handleEscrowConfirm(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	id, ok := pathID(w, "escrow id", r.PathValue("eid"))
	if !ok {
		return
	}
	a.agentBankRelay(w, r, t, http.MethodPost, "/escrows/"+url.PathEscape(id)+"/confirm", nil)
}

// handleEscrowDispute — POST /api/wallets/escrows/{eid}/dispute: hold it for the operator to decide.
func (a *app) handleEscrowDispute(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	id, ok := pathID(w, "escrow id", r.PathValue("eid"))
	if !ok {
		return
	}
	var in struct {
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensEscrowDisputeBody: none
	body, _ := json.Marshal(in)
	a.agentBankRelay(w, r, t, http.MethodPost, "/escrows/"+url.PathEscape(id)+"/dispute", body)
}

// handleAgentPots — GET and POST /api/agents/{id}/pots: the agent's pots, or a new one.
func (a *app) handleAgentPots(w http.ResponseWriter, r *http.Request, t tenant) {
	suffix, ok := agentSuffix(w, r, "pots")
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		a.agentBankRelay(w, r, t, http.MethodGet, suffix, nil)
	case http.MethodPost:
		var in struct {
			Name        string     `json:"name"`
			Kind        string     `json:"kind"`
			TargetULXC  int64      `json:"target_ulxc"`
			LockedUntil *time.Time `json:"locked_until"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		// UPSTREAM-BINDS-ONLY lensAgentPotBody: none
		body, _ := json.Marshal(in)
		a.agentBankRelay(w, r, t, http.MethodPost, suffix, body)
	default:
		methodNotAllowed(w, "GET, POST")
	}
}

// handlePotMove — POST /api/agents/{id}/pots/{pid}/in and /out.
func (a *app) handlePotMove(dir string) func(http.ResponseWriter, *http.Request, tenant) {
	return func(w http.ResponseWriter, r *http.Request, t tenant) {
		if r.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodPost)
			return
		}
		suffix, ok := agentSuffix(w, r, "pots")
		if !ok {
			return
		}
		pot, ok := pathID(w, "pot id", r.PathValue("pid"))
		if !ok {
			return
		}
		var in struct {
			AmountULXC int64 `json:"amount_ulxc"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		// UPSTREAM-BINDS-ONLY lensPotMoveBody: none
		body, _ := json.Marshal(in)
		a.agentBankRelay(w, r, t, http.MethodPost, suffix+"/"+url.PathEscape(pot)+"/"+dir, body)
	}
}

// handlePotLock — PUT /api/agents/{id}/pots/{pid}/lock: lock the pot until a date (null unlocks one not in force).
func (a *app) handlePotLock(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPut {
		methodNotAllowed(w, http.MethodPut)
		return
	}
	suffix, ok := agentSuffix(w, r, "pots")
	if !ok {
		return
	}
	pot, ok := pathID(w, "pot id", r.PathValue("pid"))
	if !ok {
		return
	}
	var in struct {
		LockedUntil *time.Time `json:"locked_until"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensPotLockBody: none
	body, _ := json.Marshal(in)
	a.agentBankRelay(w, r, t, http.MethodPut, suffix+"/"+url.PathEscape(pot)+"/lock", body)
}

// handleSimQuotes — GET /api/wallets/quotes: the simulator's instruments and prices.
func (a *app) handleSimQuotes(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.walletRelay(w, r, t, "/v1/markets/simulated/quotes")
}

// handleAgentPortfolios — GET and POST /api/agents/{id}/portfolios: the agent's portfolios, or a new one.
func (a *app) handleAgentPortfolios(w http.ResponseWriter, r *http.Request, t tenant) {
	suffix, ok := agentSuffix(w, r, "portfolios")
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		a.agentBankRelay(w, r, t, http.MethodGet, suffix, nil)
	case http.MethodPost:
		var in struct {
			Name     string `json:"name"`
			CashUUSD int64  `json:"cash_uusd"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		// UPSTREAM-BINDS-ONLY lensPortfolioBody: none
		body, _ := json.Marshal(in)
		a.agentBankRelay(w, r, t, http.MethodPost, suffix, body)
	default:
		methodNotAllowed(w, "GET, POST")
	}
}

// handlePortfolioOrder — POST /api/agents/{id}/portfolios/{pfid}/orders: a simulated market or limit order.
func (a *app) handlePortfolioOrder(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	suffix, ok := agentSuffix(w, r, "portfolios")
	if !ok {
		return
	}
	pf, ok := pathID(w, "portfolio id", r.PathValue("pfid"))
	if !ok {
		return
	}
	var in struct {
		Instrument     string `json:"instrument"`
		Side           string `json:"side"`
		Type           string `json:"type"`
		QuantityMicros int64  `json:"quantity_micros"`
		LimitPriceUSD  string `json:"limit_price_usd,omitempty"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensSimOrderBody: mode
	body, _ := json.Marshal(in)
	a.agentBankRelay(w, r, t, http.MethodPost, suffix+"/"+url.PathEscape(pf)+"/orders", body)
}

// handlePortfolioOrderCancel — POST /api/agents/{id}/portfolios/{pfid}/orders/{oid}/cancel.
func (a *app) handlePortfolioOrderCancel(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	suffix, ok := agentSuffix(w, r, "portfolios")
	if !ok {
		return
	}
	pf, ok := pathID(w, "portfolio id", r.PathValue("pfid"))
	if !ok {
		return
	}
	order, ok := pathID(w, "order id", r.PathValue("oid"))
	if !ok {
		return
	}
	a.agentBankRelay(w, r, t, http.MethodPost, suffix+"/"+url.PathEscape(pf)+"/orders/"+url.PathEscape(order)+"/cancel", nil)
}

// handleCashOuts — GET /api/wallets/cash-outs.
func (a *app) handleCashOuts(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.agentBankRelay(w, r, t, http.MethodGet, "/cash-outs", nil)
}

// handleAgentCashOut — POST /api/agents/{id}/cash-outs: the owner asks to turn the agent's credits into money.
func (a *app) handleAgentCashOut(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	suffix, ok := agentSuffix(w, r, "cash-outs")
	if !ok {
		return
	}
	var in struct {
		AmountULXC  int64  `json:"amount_ulxc"`
		Destination string `json:"destination"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensAgentCashOutBody: none
	body, _ := json.Marshal(in)
	a.agentBankRelay(w, r, t, http.MethodPost, suffix, body)
}
