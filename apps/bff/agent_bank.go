package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/url"
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
//	POST /api/agents/{id}/pay           {"to_agent_id", "amount_ulxc", "memo"}   pay another of this workspace's agents
//	GET  /api/agents/approvals                         what the agents' rules sent to a person, newest first
//	POST /api/agents/approvals/{id}/approve, …/deny    decide one
//
// Lens decides who may move money (the workspace's owner or an admin) and judges every rule. A
// refusal comes back with Lens's status AND its sentence — which rule, what the agent holds, which
// approval to approve — because that sentence is the screen's whole answer to "why not?". Lens
// redacts its own 5xx bodies, so only a 4xx sentence is relayed. Every body sent up is rebuilt from
// the fields each handler names, so nothing else a browser sends reaches Lens.

// agentBankRelay sends body (nil for none) to a workspace-scoped Lens agent route and answers what
// Lens answered: its JSON on success, its status and sentence on a 4xx, a 502 otherwise.
func (a *app) agentBankRelay(w http.ResponseWriter, r *http.Request, t tenant, method, suffix string, body []byte) {
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(r.Context(), method, a.cfg.lensBaseURL+lensWorkspacePath(t, suffix), rd)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream request"})
		return
	}
	req.Header.Set("Authorization", "Bearer "+t.token) // the SESSION's workspace token, server-side only
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := a.client.Do(req)
	if err != nil {
		log.Printf("bff: agent bank %s %s: %v", method, suffix, err)
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
		MaxPerRequestULXC int64    `json:"max_per_request_ulxc"`
		DailyLimitULXC    int64    `json:"daily_limit_ulxc"`
		MonthlyLimitULXC  int64    `json:"monthly_limit_ulxc"`
		ApprovalAboveULXC int64    `json:"approval_above_ulxc"`
		AllowedModels     []string `json:"allowed_models"`
		AllowedProviders  []string `json:"allowed_providers"`
		ActiveFrom        string   `json:"active_from"`
		ActiveUntil       string   `json:"active_until"`
		Timezone          string   `json:"timezone"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensAgentRulesBody: none
	body, _ := json.Marshal(in)
	a.agentBankRelay(w, r, t, http.MethodPut, suffix, body)
}

// handleAgentStatement — GET /api/agents/{id}/statement: the agent's last 100 lines.
func (a *app) handleAgentStatement(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	if suffix, ok := agentSuffix(w, r, "statement"); ok {
		a.agentBankRelay(w, r, t, http.MethodGet, suffix, nil)
	}
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
		a.agentBankRelay(w, r, t, http.MethodPost, "/agents/approvals/"+url.PathEscape(id)+"/"+decision, nil)
	}
}
