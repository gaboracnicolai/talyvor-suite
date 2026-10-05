package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
)

// agent_bank.go — B19.4: the Agent Bank screen. Lens's agent accounts (B19.1), their spending rules
// and the approvals those rules ask a person for (B19.2), and payments between one company's agents
// (B19.3), reached with this session's own token:
//
//	GET  /api/agents                                   the agents and their balances, reconciled with the workspace
//	POST /api/agents                    {"name"}       create an agent
//	POST /api/agents/{id}/fund          {"amount_ulxc"}   move the workspace's LXC to the agent
//	POST /api/agents/{id}/withdraw      {"amount_ulxc"}   take it back
//	POST /api/agents/{id}/keys          {"name"}       issue the agent a proxy key of its own, shown once
//	GET  /api/agents/{id}/rules, PUT {rules}           the agent's spending rules
//	GET  /api/agents/{id}/statement                    the agent's account, newest first
//	GET  /api/agents/{id}/statement?from=&to=&format=json|csv   B19.22: its statement for a period, to download
//	GET  /api/agents/statement?from=&to=&format=json|csv        B19.22: every account in the bank, for a period
//	POST /api/agents/{id}/claim                        B19.23: the signed-in person becomes an ownerless agent's owner
//	PATCH /api/agents/{id}              {"name"?, "description"?}   B28.21: rename it, describe it
//	POST /api/agents/{id}/archive                      B28.21: retire it — its balance back to the workspace, its keys revoked
//	GET  /api/agents/{id}/card                         B19.24: its test-mode card and every purchase on it (404: none)
//	POST /api/agents/{id}/card          {cardholder}   B19.24: issue it one, the cardholder's name and billing address
//	POST /api/agents/{id}/pay           {"to_agent_id", "amount_ulxc", "memo"}   pay another of this workspace's agents
//	GET  /api/agents/approvals                         what the agents' rules sent to a person, newest first
//	POST /api/agents/approvals/{id}/approve, …/deny    decide one
//
// Lens decides who may move money (the workspace's owner or an admin) and judges every rule. A
// refusal comes back with Lens's status AND its sentence — which rule, what the agent holds, which
// approval to approve — because that sentence is the screen's whole answer to "why not?". Lens
// redacts its own 5xx bodies, so only a 4xx sentence is relayed. Every body sent up is rebuilt from
// the fields each handler names, so nothing else a browser sends reaches Lens — but one header: the
// Idempotency-Key a Fund or Take back (B17.26) or a pot's Move in or Move out (B17.33) is retried under
// through a restart, which Lens reads on those four routes and nowhere else.

// agentBankRelay sends body (nil for none) to a workspace-scoped Lens agent route and answers what
// Lens answered: its JSON on success, its status and sentence on a 4xx, a 502 otherwise.
func (a *app) agentBankRelay(w http.ResponseWriter, r *http.Request, t tenant, method, suffix string, body []byte) {
	a.agentBankRelayPath(w, r, t, method, lensWorkspacePath(t, suffix), body)
}

// agentBankRelayPath is agentBankRelay for any Lens path, still with the session's own token (B22.10:
// /v1/wallets/… is not under the workspace).
func (a *app) agentBankRelayPath(w http.ResponseWriter, r *http.Request, t tenant, method, path string, body []byte) {
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(r.Context(), method, a.cfg.lensBaseURL+path, rd)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream request"})
		return
	}
	req.Header.Set("Authorization", "Bearer "+t.token) // the SESSION's workspace token, server-side only
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if k := r.Header.Get("Idempotency-Key"); k != "" && len(k) <= 128 {
		req.Header.Set("Idempotency-Key", k)
	}
	resp, err := a.client.Do(req)
	if err != nil {
		log.Printf("bff: agent bank %s %s: %v", method, strings.TrimPrefix(path, lensWorkspacePath(t, "")), err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream unreachable"})
		return
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	switch {
	case resp.StatusCode >= 200 && resp.StatusCode < 300 && json.Valid(raw):
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(resp.StatusCode)
		_, _ = w.Write(raw)
	case resp.StatusCode >= 400 && resp.StatusCode < 500:
		var refusal struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(raw, &refusal) != nil || refusal.Error == "" {
			refusal.Error = "Lens refused this"
		}
		writeJSON(w, resp.StatusCode, map[string]string{"error": refusal.Error})
	default:
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens could not answer just now"})
	}
}

// handleAgents — GET /api/agents reads the book; POST creates an agent.
func (a *app) handleAgents(w http.ResponseWriter, r *http.Request, t tenant) {
	switch r.Method {
	case http.MethodGet:
		a.agentBankRelay(w, r, t, http.MethodGet, "/agents", nil)
	case http.MethodPost:
		var in struct {
			Name string `json:"name"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		if in.Name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "an agent needs a name"})
			return
		}
		// UPSTREAM-BINDS-ONLY lensAgentCreateBody: none
		body, _ := json.Marshal(map[string]string{"name": in.Name})
		a.agentBankRelay(w, r, t, http.MethodPost, "/agents", body)
	default:
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
	}
}

// agentSuffix is the Lens suffix for one of this workspace's agents, or false having answered 400.
func agentSuffix(w http.ResponseWriter, r *http.Request, action string) (string, bool) {
	id, ok := pathID(w, "agent id", r.PathValue("id"))
	if !ok {
		return "", false
	}
	return "/agents/" + url.PathEscape(id) + "/" + action, true
}

// handleAgentMove — POST /api/agents/{id}/fund and /withdraw.
func (a *app) handleAgentMove(action string) func(http.ResponseWriter, *http.Request, tenant) {
	return func(w http.ResponseWriter, r *http.Request, t tenant) {
		if r.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodPost)
			return
		}
		suffix, ok := agentSuffix(w, r, action)
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
		// UPSTREAM-BINDS-ONLY lensAgentMoveBody: none
		body, _ := json.Marshal(map[string]int64{"amount_ulxc": in.AmountULXC})
		a.agentBankRelay(w, r, t, http.MethodPost, suffix, body)
	}
}

// handleAgentKeys — POST /api/agents/{id}/keys issues the agent a proxy key. Lens answers the key
// once; the screen shows it once and keeps nothing.
func (a *app) handleAgentKeys(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	suffix, ok := agentSuffix(w, r, "keys")
	if !ok {
		return
	}
	var in struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	keyName := in.Name
	// UPSTREAM-BINDS-ONLY lensAgentKeyBody: none
	body, _ := json.Marshal(map[string]string{"name": keyName})
	a.agentBankRelay(w, r, t, http.MethodPost, suffix, body)
}

// handleAgentRules — GET and PUT /api/agents/{id}/rules.
func (a *app) handleAgentRules(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet && r.Method != http.MethodPut {
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPut)
		return
	}
	suffix, ok := agentSuffix(w, r, "rules")
	if !ok {
		return
	}
	if r.Method == http.MethodGet {
		a.agentBankRelay(w, r, t, http.MethodGet, suffix, nil)
		return
	}
	// Lens's economy.AgentRules. Lens decodes it with DisallowUnknownFields, so a field named here
	// that Lens does not have is a 400, never a rule silently dropped.
	var in struct {
		MaxPerRequestULXC int64 `json:"max_per_request_ulxc"`
		DailyLimitULXC    int64 `json:"daily_limit_ulxc"`
		MonthlyLimitULXC  int64 `json:"monthly_limit_ulxc"`
		// B28.24 — absent (null) keeps the cap Lens holds, as AllowedListings does; zero clears it.
		HourlyLimitULXC *int64 `json:"hourly_limit_ulxc"`
		WeeklyLimitULXC *int64 `json:"weekly_limit_ulxc"`
		// B28.25 — a daily cap per model, keyed by the model as the agent asks for it. Absent (null) keeps
		// the caps Lens holds; sent, it replaces them whole, so a model left out has no cap.
		ModelDailyLimitsULXC map[string]int64 `json:"model_daily_limits_ulxc"`
		// B28.26 — the questions the agent may ask in any sixty seconds. Absent (null) keeps the cap Lens
		// holds; zero clears it.
		RequestsPerMinute *int64   `json:"requests_per_minute"`
		ApprovalAboveULXC int64    `json:"approval_above_ulxc"`
		AllowedModels     []string `json:"allowed_models"`
		AllowedProviders  []string `json:"allowed_providers"`
		// B19.19 — the marketplace listings the agent may use; empty allows any. Absent (null) keeps
		// what Lens holds, so a client that does not send it cannot clear it.
		AllowedListings []string `json:"allowed_listings"`
		// B28.27 — who the agent may pay and who it may not, by payee id (an agent, a listing, a company or
		// a card merchant). Absent (null) keeps the lists Lens holds; an empty list clears one.
		AllowedPayees []string `json:"allowed_payees"`
		BlockedPayees []string `json:"blocked_payees"`
		// B28.28 — what the agent may pay one payee in a day, keyed by the payee's id as the lists above name
		// it. Absent (null) keeps the caps Lens holds; sent, it replaces them whole, so a payee left out has no cap.
		PayeeDailyLimitsULXC map[string]int64 `json:"payee_daily_limits_ulxc"`
		ActiveFrom           string           `json:"active_from"`
		ActiveUntil          string           `json:"active_until"`
		Timezone             string           `json:"timezone"`
		// B19.6 — Lens replaces every other rule on a save, so this is carried back as it was read.
		PauseOnUnusualSpend bool `json:"pause_on_unusual_spend"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensAgentRulesBody: none
	body, _ := json.Marshal(in)
	a.agentBankRelay(w, r, t, http.MethodPut, suffix, body)
}

// handleAgentStatement — GET /api/agents/{id}/statement: the agent's last 100 lines. With ?from=, ?to=
// or ?format= (B19.22) it is the agent's statement for that period instead, as JSON or a CSV file.
func (a *app) handleAgentStatement(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	suffix, ok := agentSuffix(w, r, "statement")
	if !ok {
		return
	}
	if q := r.URL.Query(); q.Has("from") || q.Has("to") || q.Has("format") {
		a.agentStatementRelay(w, r, t, suffix)
		return
	}
	a.agentBankRelay(w, r, t, http.MethodGet, suffix, nil)
}

// handleBankStatement — GET /api/agents/statement?from=&to=&format=: B19.22, every account in the
// workspace's agent bank for the period.
func (a *app) handleBankStatement(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.agentStatementRelay(w, r, t, "/agents/statement")
}

// maxStatementBytes bounds a period statement the BFF passes on; a longer one asks for a shorter period.
const maxStatementBytes = 32 << 20

// agentStatementRelay asks Lens for a period statement (Lens B19.5) and answers with it: JSON, or the
// CSV file with Lens's filename. Only from, to and format are sent up; Lens reads the dates (a
// YYYY-MM-DD date is midnight UTC, the period is [from, to)) and its sentence on a bad one is relayed.
func (a *app) agentStatementRelay(w http.ResponseWriter, r *http.Request, t tenant, suffix string) {
	in, up := r.URL.Query(), url.Values{}
	for _, k := range []string{"from", "to", "format"} {
		if v := in.Get(k); v != "" {
			up.Set(k, v)
		}
	}
	target := a.cfg.lensBaseURL + lensWorkspacePath(t, suffix)
	if len(up) > 0 {
		target += "?" + up.Encode()
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target, nil)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream request"})
		return
	}
	req.Header.Set("Authorization", "Bearer "+t.token) // the SESSION's workspace token, server-side only
	resp, err := a.client.Do(req)
	if err != nil {
		log.Printf("bff: agent statement %s: %v", suffix, err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream unreachable"})
		return
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxStatementBytes+1))
	asCSV := up.Get("format") == "csv"
	switch {
	case err != nil:
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens could not answer just now"})
	case resp.StatusCode >= 200 && resp.StatusCode < 300 && len(raw) > maxStatementBytes:
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "This statement is too long to download at once — choose a shorter period."})
	case resp.StatusCode >= 200 && resp.StatusCode < 300 && asCSV:
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		if cd := resp.Header.Get("Content-Disposition"); cd != "" {
			w.Header().Set("Content-Disposition", cd)
		}
		w.WriteHeader(resp.StatusCode)
		_, _ = w.Write(raw)
	case resp.StatusCode >= 200 && resp.StatusCode < 300 && json.Valid(raw):
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(resp.StatusCode)
		_, _ = w.Write(raw)
	case resp.StatusCode >= 400 && resp.StatusCode < 500:
		var refusal struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(raw, &refusal) != nil || refusal.Error == "" {
			refusal.Error = "Lens refused this"
		}
		writeJSON(w, resp.StatusCode, map[string]string{"error": refusal.Error})
	default:
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens could not answer just now"})
	}
}

// handleAgentClaim — POST /api/agents/{id}/claim (B19.23): Lens B19.11 gives an agent with no owner no
// balance until a person claims it; the owner is whoever the session's credential names. No body.
func (a *app) handleAgentClaim(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	if suffix, ok := agentSuffix(w, r, "claim"); ok {
		a.agentBankRelay(w, r, t, http.MethodPost, suffix, nil)
	}
}

// handleAgent — PATCH /api/agents/{id} (B28.21): renames the agent and/or sets what it is for. Either field
// or both; an absent one is sent as null, which Lens leaves as it is. Lens answers the agent.
func (a *app) handleAgent(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPatch {
		methodNotAllowed(w, http.MethodPatch)
		return
	}
	id, ok := pathID(w, "agent id", r.PathValue("id"))
	if !ok {
		return
	}
	var in struct {
		Name        *string `json:"name"`
		Description *string `json:"description"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	if in.Name == nil && in.Description == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "send a new name, a description, or both"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensAgentUpdateBody: none
	body, _ := json.Marshal(in)
	a.agentBankRelay(w, r, t, http.MethodPatch, "/agents/"+url.PathEscape(id), body)
}

// handleAgentArchive — POST /api/agents/{id}/archive (B28.21): Lens retires the agent in one step — its
// whole balance back to the workspace as one withdraw entry, its proxy keys revoked, its top-up and
// schedules stopped — and answers what it did: swept_ulxc, revoked_keys, archived_at.
func (a *app) handleAgentArchive(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	if suffix, ok := agentSuffix(w, r, "archive"); ok {
		a.agentBankRelay(w, r, t, http.MethodPost, suffix, nil)
	}
}

// handleAgentCard — GET and POST /api/agents/{id}/card (B19.24): Lens B19.12's virtual card, Stripe
// Issuing in test mode. GET is the card and every authorisation on it, approved or declined with Lens's
// reason and the ECB rate it was converted at; Lens answers 404 when the agent has none. POST issues one:
// Stripe needs a cardholder — the person, and the billing address a merchant may ask for.
func (a *app) handleAgentCard(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
		return
	}
	suffix, ok := agentSuffix(w, r, "card")
	if !ok {
		return
	}
	if r.Method == http.MethodGet {
		a.agentBankRelay(w, r, t, http.MethodGet, suffix, nil)
		return
	}
	// Lens agentcard.Cardholder.
	var in struct {
		FirstName  string `json:"first_name"`
		LastName   string `json:"last_name"`
		Email      string `json:"email"`
		Phone      string `json:"phone_number"` // E.164; Lens falls back to an unallocated number in test mode when empty (B27.21)
		Line1      string `json:"line1"`
		Line2      string `json:"line2"`
		City       string `json:"city"`
		PostalCode string `json:"postal_code"`
		Country    string `json:"country"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensAgentCardBody: none
	body, _ := json.Marshal(in)
	a.agentBankRelay(w, r, t, http.MethodPost, suffix, body)
}

// handleAgentPay — POST /api/agents/{id}/pay: the agent pays another of this workspace's agents,
// judged by the payer's rules. A payment above its approval amount is refused naming the approval
// it filed; once a person approves that, the same payment sent again goes through, once.
func (a *app) handleAgentPay(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	suffix, ok := agentSuffix(w, r, "pay")
	if !ok {
		return
	}
	var in struct {
		ToAgentID  string `json:"to_agent_id"`
		AmountULXC int64  `json:"amount_ulxc"`
		Memo       string `json:"memo"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensAgentPayBody: none
	body, _ := json.Marshal(in)
	a.agentBankRelay(w, r, t, http.MethodPost, suffix, body)
}

// handleAgentApprovals — GET /api/agents/approvals.
func (a *app) handleAgentApprovals(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.agentBankRelay(w, r, t, http.MethodGet, "/agents/approvals", nil)
}

// handleAgentDecision — POST /api/agents/approvals/{id}/approve and /deny.
func (a *app) handleAgentDecision(decision string) func(http.ResponseWriter, *http.Request, tenant) {
	return func(w http.ResponseWriter, r *http.Request, t tenant) {
		if r.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodPost)
			return
		}
		id, ok := pathID(w, "approval id", r.PathValue("id"))
		if !ok {
			return
		}
		// B19.10: once the workspace has a passkey, Lens takes the decision only with an assertion over
		// this approval's challenge. A decision without one is sent as before — Lens says whether it may.
		var in struct {
			Assertion *passkeyAssertion `json:"assertion"`
		}
		if r.ContentLength != 0 {
			if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil && err != io.EOF {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
				return
			}
		}
		var body []byte
		if in.Assertion != nil {
			// UPSTREAM-BINDS-ONLY lensApprovalDecisionBody: none
			body, _ = json.Marshal(map[string]*passkeyAssertion{"assertion": in.Assertion})
		}
		a.agentBankRelay(w, r, t, http.MethodPost, "/agents/approvals/"+url.PathEscape(id)+"/"+decision, body)
	}
}

// B19.10 — approvals with Face ID, on the phone. Lens (B19.16) keeps the owner's passkeys, the challenge
// each approval is signed over, and each device's push subscription, because the BFF keeps nothing
// across a restart; these relay the browser's ceremony and subscription to it, rebuilt field by field.
//
//	POST   /api/agents/passkeys/challenge          a registration challenge and the RP ID
//	GET    /api/agents/passkeys                    the workspace's passkeys
//	POST   /api/agents/passkeys                    {credential_id, name, public_key, client_data_json, authenticator_data}
//	POST   /api/agents/approvals/{id}/challenge    the challenge approving or denying one approval is signed over
//	GET    /api/agents/push/public-key             the key a browser subscribes to pushes with
//	POST   /api/agents/push/subscriptions          {endpoint, keys: {p256dh, auth}}
//	DELETE /api/agents/push/subscriptions          {endpoint}
//
// Approve and deny (handleAgentDecision) carry {"assertion": {…}} once the workspace has a passkey.

// passkeyAssertion is a passkey's signature over an approval's challenge, all base64url.
type passkeyAssertion struct {
	CredentialID      string `json:"credential_id"`
	ClientDataJSON    string `json:"client_data_json"`
	AuthenticatorData string `json:"authenticator_data"`
	Signature         string `json:"signature"`
}

// handlePasskeyChallenge — POST /api/agents/passkeys/challenge.
func (a *app) handlePasskeyChallenge(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	a.agentBankRelay(w, r, t, http.MethodPost, "/agents/passkeys/challenge", nil)
}

// handlePasskeys — GET /api/agents/passkeys lists them; POST registers one.
func (a *app) handlePasskeys(w http.ResponseWriter, r *http.Request, t tenant) {
	switch r.Method {
	case http.MethodGet:
		a.agentBankRelay(w, r, t, http.MethodGet, "/agents/passkeys", nil)
	case http.MethodPost:
		var in struct {
			CredentialID      string `json:"credential_id"`
			Name              string `json:"name"`
			PublicKey         string `json:"public_key"`
			ClientDataJSON    string `json:"client_data_json"`
			AuthenticatorData string `json:"authenticator_data"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		// UPSTREAM-BINDS-ONLY lensPasskeyRegisterBody: none
		body, _ := json.Marshal(in)
		a.agentBankRelay(w, r, t, http.MethodPost, "/agents/passkeys", body)
	default:
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
	}
}

// handleApprovalChallenge — POST /api/agents/approvals/{id}/challenge.
func (a *app) handleApprovalChallenge(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	id, ok := pathID(w, "approval id", r.PathValue("id"))
	if !ok {
		return
	}
	a.agentBankRelay(w, r, t, http.MethodPost, "/agents/approvals/"+url.PathEscape(id)+"/challenge", nil)
}

// handlePushPublicKey — GET /api/agents/push/public-key.
func (a *app) handlePushPublicKey(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.agentBankRelay(w, r, t, http.MethodGet, "/agents/push/public-key", nil)
}

// handlePushSubscriptions — POST /api/agents/push/subscriptions subscribes this device; DELETE forgets it.
func (a *app) handlePushSubscriptions(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost && r.Method != http.MethodDelete {
		methodNotAllowed(w, http.MethodPost+", "+http.MethodDelete)
		return
	}
	var in struct {
		Endpoint string `json:"endpoint"`
		Keys     struct {
			P256dh string `json:"p256dh"`
			Auth   string `json:"auth"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil || in.Endpoint == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a push subscription needs its endpoint"})
		return
	}
	if r.Method == http.MethodDelete {
		// UPSTREAM-BINDS-ONLY lensPushUnsubscribeBody: none
		body, _ := json.Marshal(map[string]string{"endpoint": in.Endpoint})
		a.agentBankRelay(w, r, t, http.MethodDelete, "/agents/push/subscriptions", body)
		return
	}
	// UPSTREAM-BINDS-ONLY lensPushSubscribeBody: keys
	// ("keys" IS sent: it is the object p256dh and auth travel in. The register reads leaf json tags,
	// so the container is declared here instead of read.)
	body, _ := json.Marshal(in)
	a.agentBankRelay(w, r, t, http.MethodPost, "/agents/push/subscriptions", body)
}

// B19.20 — the bank's safety controls: one switch that stops every agent (Lens B19.7), pausing one agent,
// the unusual-spend alerts and the month-end forecast (Lens B19.6).
//
//	GET  /api/agents/alerts                      unusual-spend alerts, newest first, and the rule that raises them
//	GET  /api/agents/forecast                    each agent's and the workspace's month-end spend
//	POST /api/agents/pause-all   {"reason"}      every agent, those created later included
//	POST /api/agents/resume-all                  lifts it; an agent paused on its own stays paused
//	POST /api/agents/{id}/pause  {"reason"}      one agent
//	POST /api/agents/{id}/resume

// handleAgentAlerts — GET /api/agents/alerts.
func (a *app) handleAgentAlerts(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.agentBankRelay(w, r, t, http.MethodGet, "/agents/alerts", nil)
}

// handleAgentForecast — GET /api/agents/forecast, as of now.
func (a *app) handleAgentForecast(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.agentBankRelay(w, r, t, http.MethodGet, "/agents/forecast", nil)
}

// handleAgentsPauseAll — POST /api/agents/pause-all {"reason"} and /api/agents/resume-all.
func (a *app) handleAgentsPauseAll(pause bool) func(http.ResponseWriter, *http.Request, tenant) {
	return func(w http.ResponseWriter, r *http.Request, t tenant) {
		if r.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodPost)
			return
		}
		if !pause {
			a.agentBankRelay(w, r, t, http.MethodPost, "/agents/resume-all", nil)
			return
		}
		var in struct {
			Reason string `json:"reason"`
		}
		if r.ContentLength != 0 {
			if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil && err != io.EOF {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
				return
			}
		}
		// UPSTREAM-BINDS-ONLY lensAgentPauseAllBody: none
		body, _ := json.Marshal(map[string]string{"reason": in.Reason})
		a.agentBankRelay(w, r, t, http.MethodPost, "/agents/pause-all", body)
	}
}

// handleAgentPause — POST /api/agents/{id}/pause {"reason"} and /api/agents/{id}/resume.
func (a *app) handleAgentPause(pause bool) func(http.ResponseWriter, *http.Request, tenant) {
	return func(w http.ResponseWriter, r *http.Request, t tenant) {
		if r.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodPost)
			return
		}
		action := "resume"
		if pause {
			action = "pause"
		}
		suffix, ok := agentSuffix(w, r, action)
		if !ok {
			return
		}
		if !pause {
			a.agentBankRelay(w, r, t, http.MethodPost, suffix, nil)
			return
		}
		var why struct {
			Reason string `json:"reason"`
		}
		if r.ContentLength != 0 {
			if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&why); err != nil && err != io.EOF {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
				return
			}
		}
		// UPSTREAM-BINDS-ONLY lensAgentPauseBody: none
		body, _ := json.Marshal(map[string]string{"reason": why.Reason})
		a.agentBankRelay(w, r, t, http.MethodPost, suffix, body)
	}
}

// B19.21 — scheduled payments and automatic top-ups (Lens B19.8; a schedule that pays a marketplace
// listing, B19.17). Lens runs both every minute and pays each tick once.
//
//	GET  /api/agents/schedules                     every schedule in the workspace
//	POST /api/agents/{id}/schedules                {to_agent_id | to_listing_id, amount_ulxc, memo, every, first_run_at}
//	GET  /api/agents/schedules/{sid}/runs          each tick: paid, or refused and why
//	POST /api/agents/schedules/{sid}/stop          stops it (Lens: DELETE …/agents/schedules/{sid})
//	GET, PUT, DELETE /api/agents/{id}/topup        {below_ulxc, to_ulxc}; GET is Lens's 404 when there is none

// handleAgentSchedules — GET /api/agents/schedules.
func (a *app) handleAgentSchedules(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.agentBankRelay(w, r, t, http.MethodGet, "/agents/schedules", nil)
}

// handleAgentSchedule — POST /api/agents/{id}/schedules: the agent pays another agent, or a listing, every
// hour, day, week or month.
func (a *app) handleAgentSchedule(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	suffix, ok := agentSuffix(w, r, "schedules")
	if !ok {
		return
	}
	var in struct {
		ToAgentID   string  `json:"to_agent_id"`
		ToListingID string  `json:"to_listing_id"`
		AmountULXC  int64   `json:"amount_ulxc"`
		Memo        string  `json:"memo"`
		Every       string  `json:"every"`
		FirstRunAt  *string `json:"first_run_at"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensAgentScheduleBody: none
	body, _ := json.Marshal(in)
	a.agentBankRelay(w, r, t, http.MethodPost, suffix, body)
}

// scheduleSuffix is the Lens suffix for one of this workspace's schedules, or false having answered 400.
func scheduleSuffix(w http.ResponseWriter, r *http.Request) (string, bool) {
	id, ok := pathID(w, "schedule id", r.PathValue("sid"))
	if !ok {
		return "", false
	}
	return "/agents/schedules/" + url.PathEscape(id), true
}

// handleAgentScheduleRuns — GET /api/agents/schedules/{sid}/runs.
func (a *app) handleAgentScheduleRuns(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	if suffix, ok := scheduleSuffix(w, r); ok {
		a.agentBankRelay(w, r, t, http.MethodGet, suffix+"/runs", nil)
	}
}

// handleAgentScheduleStop — POST /api/agents/schedules/{sid}/stop.
func (a *app) handleAgentScheduleStop(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	if suffix, ok := scheduleSuffix(w, r); ok {
		a.agentBankRelay(w, r, t, http.MethodDelete, suffix, nil)
	}
}

// handleAgentTopUp — GET, PUT and DELETE /api/agents/{id}/topup.
func (a *app) handleAgentTopUp(w http.ResponseWriter, r *http.Request, t tenant) {
	suffix, ok := agentSuffix(w, r, "topup")
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet, http.MethodDelete:
		a.agentBankRelay(w, r, t, r.Method, suffix, nil)
	case http.MethodPut:
		var in struct {
			BelowULXC int64 `json:"below_ulxc"`
			ToULXC    int64 `json:"to_ulxc"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		// UPSTREAM-BINDS-ONLY lensAgentTopUpBody: none
		body, _ := json.Marshal(in)
		a.agentBankRelay(w, r, t, http.MethodPut, suffix, body)
	default:
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPut+", "+http.MethodDelete)
	}
}
