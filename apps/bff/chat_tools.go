package main

// chat_tools.go — B28.349: Chat answers "what did my agents spend?" through Lens's wallet MCP tools.
//
//	GET  /api/chat/tools                              the tools Chat may offer the model: Lens's /mcp tools/list, chatTools only
//	POST /api/chat/tools/call {"name", "arguments"}   one tool call the model made, through Lens's /mcp tools/call → {"text", "is_error"}
//
// The browser runs the tool loop (chatApi.ts askChat): it offers the model these tools, and when the model
// calls one, the call comes here and goes to Lens on the session's own workspace token, as every Agent
// Wallets route does — so Lens answers for this workspace's agents and no other.
//
// ⚠ ONLY READ-ONLY TOOLS ARE RELAYED, WHATEVER THE MODEL ASKS FOR. Lens's /mcp also lists tools that move
// money (wallet_send, agent_pay, …). A question in Chat is not a payment, and a prompt-injected document
// must not be able to make one, so a tool is listed and called only when chatTools names it.
//
// The contract for B28.83 (talyvor-lens side): Lens's /mcp, called with a workspace's own token, lists
// and answers wallet_agents_spend — what the workspace's agents spent over a period, per agent, with the
// statement lines it was spent in, as JSON text: {"agents": [{"agent_id", "name", "spent_ulxc", "lines":
// [{"entry_id", "kind", "amount_ulxc", "at"}]}]}. The chat links each line to its row on the agent's
// statement (/agents?agent=…&entry=…). Until Lens lists it, Chat offers no tools and asks as before.

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"
)

const lensMCPPath = "/mcp"

// chatTools are the Lens MCP tools Chat may use: each one only reads.
var chatTools = map[string]bool{"wallet_agents_spend": true}

// chatTool is one tool as Chat offers it to a model: Lens's inputSchema is the JSON Schema both providers take.
type chatTool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"input_schema"`
}

// chatToolResult is what one call answered: its text, and whether Lens refused it (MCP's isError).
type chatToolResult struct {
	Text    string `json:"text"`
	IsError bool   `json:"is_error"`
}

// mcpReply is Lens's JSON-RPC answer.
type mcpReply struct {
	Result json.RawMessage `json:"result"`
	Error  *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// mcpMethodNotFound is JSON-RPC's "no such method", which Lens's /mcp also answers for an unknown tool.
const mcpMethodNotFound = -32601

// mcpCall sends one JSON-RPC request to Lens's /mcp on the session's token. A non-nil error is a failure to
// reach Lens or read its answer; Lens's own refusal comes back in the reply.
func (a *app) mcpCall(r *http.Request, t tenant, method string, params any) (mcpReply, int, error) {
	// UPSTREAM-BINDS-ONLY lensMCPBody: none
	body, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, a.cfg.lensBaseURL+lensMCPPath, bytes.NewReader(body))
	if err != nil {
		return mcpReply{}, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+t.token) // the SESSION's workspace token, server-side only
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := a.client.Do(req)
	if err != nil {
		return mcpReply{}, 0, err
	}
	defer func() { _ = resp.Body.Close() }()
	var out mcpReply
	if resp.StatusCode != http.StatusOK {
		return out, resp.StatusCode, nil
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&out); err != nil {
		return out, resp.StatusCode, err
	}
	return out, resp.StatusCode, nil
}

// handleChatTools — GET /api/chat/tools.
func (a *app) handleChatTools(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	reply, status, err := a.mcpCall(r, t, "tools/list", map[string]any{})
	if err != nil || status != http.StatusOK || reply.Error != nil {
		log.Printf("bff: chat tools: status %d: %v", status, err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens could not list its tools just now"})
		return
	}
	var listed struct {
		Tools []struct {
			Name        string          `json:"name"`
			Description string          `json:"description"`
			InputSchema json.RawMessage `json:"inputSchema"`
		} `json:"tools"`
	}
	_ = json.Unmarshal(reply.Result, &listed)
	tools := []chatTool{}
	for _, tl := range listed.Tools {
		if chatTools[tl.Name] && json.Valid(tl.InputSchema) {
			tools = append(tools, chatTool{Name: tl.Name, Description: tl.Description, InputSchema: tl.InputSchema})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"tools": tools})
}

// handleChatToolCall — POST /api/chat/tools/call {"name", "arguments"}.
func (a *app) handleChatToolCall(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	var in struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil || in.Name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name and arguments required"})
		return
	}
	if !chatTools[in.Name] {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Chat may not use that tool"})
		return
	}
	args := map[string]any{}
	if len(in.Arguments) > 0 && string(in.Arguments) != "null" {
		if err := json.Unmarshal(in.Arguments, &args); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "arguments must be a JSON object"})
			return
		}
	}
	reply, status, err := a.mcpCall(r, t, "tools/call", map[string]any{"name": in.Name, "arguments": args})
	switch {
	case err != nil || status != http.StatusOK:
		log.Printf("bff: chat tool %s: status %d: %v", in.Name, status, err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens could not answer just now"})
		return
	case reply.Error != nil && reply.Error.Code == mcpMethodNotFound:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Lens has no such tool"})
		return
	case reply.Error != nil:
		log.Printf("bff: chat tool %s: lens: %s", in.Name, reply.Error.Message)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens could not answer just now"})
		return
	}
	var result struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		IsError bool `json:"isError"`
	}
	_ = json.Unmarshal(reply.Result, &result)
	var text []string
	for _, c := range result.Content {
		if c.Type == "text" {
			text = append(text, c.Text)
		}
	}
	writeJSON(w, http.StatusOK, chatToolResult{Text: strings.Join(text, "\n"), IsError: result.IsError})
}
