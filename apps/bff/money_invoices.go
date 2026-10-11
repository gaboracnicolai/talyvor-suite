package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"regexp"
)

// money_invoices.go — B30.97: invoices and the public pay page (Lens B30.20), on this session's own token:
//
//	GET  /api/money/accounts                        the company's and its agents' currency accounts (Lens B30.13)
//	POST /api/money/accounts   {currency, agent_id}  open one, the company's or an agent's, on test money
//	GET  /api/money/invoices                        every invoice the workspace's agents issued, with payments and reminders
//	POST /api/money/invoices   {account_id, customer_name, customer_email, customer_address, customer_vat_number,
//	                            seller_vat_number, lines, due_date, remind_days_before, memo, send}   issue one from an agent's account
//	POST /api/money/invoices/{id}/send              a draft's pay link opens
//	POST /api/money/invoices/{id}/void              a draft or sent one is voided
//	POST /api/money/pay/{token}/agent {agent_id}    one of this workspace's agents pays an invoice from its account
//
// and, with NO session — the payer has no account here, the pay link is the credential:
//
//	GET  /api/public/pay/{token}                    the invoice, what is due and how to pay it ("Preview — test money only")
//	POST /api/public/pay/{token}/card               a Stripe test-mode Checkout for what is due: {url}
//
// Lens decides everything: whose account may issue, what is due, which states may be paid and what each payment posts.
// A refusal comes back with its sentence (lensRelay). The funding of an agent's payment is test until Lens's capability
// is cleared for live money: Lens is the judge of that, so the page never names it.

// payToken is how Lens mints a pay link's token (randomHex(24)); checked for shape before any dial.
var payToken = regexp.MustCompile(`^[A-Za-z0-9_-]{16,128}$`)

type invoiceLine struct {
	Description     string `json:"description"`
	Quantity        int64  `json:"quantity"`
	UnitAmountMinor int64  `json:"unit_amount_minor"`
	VATRateBPS      int64  `json:"vat_rate_bps"`
}

// handleMoneyAccounts — GET /api/money/accounts lists them; POST opens one.
func (a *app) handleMoneyAccounts(w http.ResponseWriter, r *http.Request, t tenant) {
	switch r.Method {
	case http.MethodGet:
		a.agentBankRelayPath(w, r, t, http.MethodGet, "/v1/money/accounts", nil)
	case http.MethodPost:
		var in struct {
			Currency string `json:"currency"`
			AgentID  string `json:"agent_id"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<12)).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		// UPSTREAM-BINDS-ONLY lensMoneyAccountOpenBody: funding
		body, _ := json.Marshal(map[string]string{"currency": in.Currency, "agent_id": in.AgentID})
		a.agentBankRelayPath(w, r, t, http.MethodPost, "/v1/money/accounts", body)
	default:
		methodNotAllowed(w, "GET, POST")
	}
}

// handleMoneyInvoices — GET /api/money/invoices lists them; POST issues one.
func (a *app) handleMoneyInvoices(w http.ResponseWriter, r *http.Request, t tenant) {
	switch r.Method {
	case http.MethodGet:
		a.agentBankRelayPath(w, r, t, http.MethodGet, "/v1/money/invoices", nil)
	case http.MethodPost:
		var in struct {
			AccountID         string        `json:"account_id"`
			CustomerName      string        `json:"customer_name"`
			CustomerEmail     string        `json:"customer_email"`
			CustomerAddress   string        `json:"customer_address"`
			CustomerVATNumber string        `json:"customer_vat_number"`
			SellerVATNumber   string        `json:"seller_vat_number"`
			Lines             []invoiceLine `json:"lines"`
			DueDate           string        `json:"due_date"`
			RemindDaysBefore  int           `json:"remind_days_before"`
			Memo              string        `json:"memo"`
			Send              bool          `json:"send"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<18)).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		// UPSTREAM-BINDS-ONLY lensMoneyInvoiceCreateBody: currency
		body, _ := json.Marshal(in)
		a.agentBankRelayPath(w, r, t, http.MethodPost, "/v1/money/invoices", body)
	default:
		methodNotAllowed(w, "GET, POST")
	}
}

// handleMoneyInvoiceMove — POST /api/money/invoices/{id}/send and …/void.
func (a *app) handleMoneyInvoiceMove(action string) func(http.ResponseWriter, *http.Request, tenant) {
	return func(w http.ResponseWriter, r *http.Request, t tenant) {
		if r.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodPost)
			return
		}
		id, ok := pathID(w, "id", r.PathValue("id"))
		if !ok {
			return
		}
		a.agentBankRelayPath(w, r, t, http.MethodPost, "/v1/money/invoices/"+url.PathEscape(id)+"/"+action, nil)
	}
}

// handleInvoicePayByAgent — POST /api/money/pay/{token}/agent: one of the workspace's agents pays the invoice.
func (a *app) handleInvoicePayByAgent(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	token := r.PathValue("token")
	if !payToken.MatchString(token) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such invoice"})
		return
	}
	var in struct {
		AgentID string `json:"agent_id"`
		Funding string `json:"funding"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<12)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	if in.AgentID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "choose the agent that pays"})
		return
	}
	if in.Funding == "" {
		in.Funding = "test"
	}
	// UPSTREAM-BINDS-ONLY lensInvoicePayByAgentBody: none
	body, _ := json.Marshal(map[string]string{"agent_id": in.AgentID, "funding": in.Funding})
	a.agentBankRelayPath(w, r, t, http.MethodPost, "/v1/pay/"+url.PathEscape(token)+"/agent", body)
}

// publicPayPage — GET /api/public/pay/{token}: the invoice as its payer sees it, with no credential.
func (a *app) publicPayPage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	token := r.PathValue("token")
	if !payToken.MatchString(token) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such invoice"})
		return
	}
	a.lensRelay(w, r, "", http.MethodGet, "/v1/pay/"+url.PathEscape(token), nil, "pay page")
}

// publicPayByCard — POST /api/public/pay/{token}/card: Lens opens a Stripe test-mode Checkout for what is due.
func (a *app) publicPayByCard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	token := r.PathValue("token")
	if !payToken.MatchString(token) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such invoice"})
		return
	}
	a.lensRelay(w, r, "", http.MethodPost, "/v1/pay/"+url.PathEscape(token)+"/card", nil, "pay by card")
}
