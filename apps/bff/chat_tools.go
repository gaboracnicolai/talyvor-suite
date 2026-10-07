package main

// chat_tools.go — B28.349: Chat answers "what did my agents spend?" through Lens's wallet MCP tools.
// B28.374: and through Talyvor's own tools in Track and Docs — "file this as a bug" files a Track issue.
//
//	GET  /api/chat/tools                                           the tools Chat may offer the model: Lens's, Track's and Docs' /mcp tools/list, chatTools only
//	POST /api/chat/tools/call {"name", "arguments", "confirmed"}   one tool call the model made, through its product's /mcp tools/call → {"text", "is_error"}
//
// The browser runs the tool loop (chatApi.ts askChat): it offers the model these tools, and when the model
// calls one, the call comes here and goes to Lens on the session's own workspace token, as every Agent
// Wallets route does — so Lens answers for this workspace's agents and no other. A Track or Docs tool goes
// to that product's /mcp as the signed-in person, through forwardProductWith like every /api/track and
// /api/docs route, with the workspace set here from the session: the model never names one.
//
// ⚠ ONLY THE TOOLS chatTools NAMES ARE RELAYED, WHATEVER THE MODEL ASKS FOR. Lens's /mcp also lists tools
// that move money (wallet_send, agent_pay, …). A question in Chat is not a payment, and a prompt-injected
// document must not be able to make one, so a tool is listed and called only when chatTools names it — and
// none of them moves money. The one that changes something (Track's create_issue) runs only with
// "confirmed": true, which Chat sends once the person has said yes to that one call on screen.
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
	"slices"
	"strings"
	"sync"
)

const lensMCPPath = "/mcp"

// productMCPPath is Track's and Docs' MCP endpoint, behind the same gateway proof and identity as their /v1.
const productMCPPath = "/mcp"

// chatToolSpec is how Chat may use one tool: whose /mcp answers it, whether it changes anything, and the
// arguments the BFF sets itself — left out of the schema the model sees, and whatever the model sent for
// them dropped. For Track and Docs, workspace_id is the session's workspace and team_id its first team; Lens
// reads the workspace from the session's token.
type chatToolSpec struct {
	product string
	writes  bool
	session []string
}

// chatTools are the MCP tools Chat may use. All of them read, but Track's create_issue, which files an issue
// and runs only once the person has confirmed it.
var chatTools = map[string]chatToolSpec{
	"wallet_agents_spend": {product: "lens"},
	"get_spend_summary":   {product: "lens", session: []string{"workspace_id"}},
	"get_cache_stats":     {product: "lens", session: []string{"workspace_id"}},
	"create_issue":        {product: "track", writes: true, session: []string{"workspace_id", "team_id"}},
	"search_issues":       {product: "track", session: []string{"workspace_id"}},
	"list_issues":         {product: "track", session: []string{"workspace_id"}},
	"get_issue":           {product: "track"},
	"search_docs":         {product: "docs", session: []string{"workspace_id"}},
	"get_page":            {product: "docs"},
}

// productNames are the products' names as a person reads them in an error.
var productNames = map[string]string{"lens": "Lens", "track": "Track", "docs": "Docs"}

// chatTool is one tool as Chat offers it to a model: the product's inputSchema is the JSON Schema both providers
// take. Product and Writes are for the screen (which product answered; ask before it runs) and never reach the model.
type chatTool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"input_schema"`
	Product     string          `json:"product"`
	Writes      bool            `json:"writes,omitempty"`
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

// mcpInvalidParams is JSON-RPC's "invalid params": Track and Docs answer it for a call missing what the tool
// needs ("title required"), which the model is told so it can ask again.
const mcpInvalidParams = -32602

// mcpRequest is one JSON-RPC request to an MCP endpoint: the same envelope for Lens's, Track's and Docs'.
func mcpRequest(method string, params any) []byte {
	// UPSTREAM-BINDS-ONLY lensMCPBody: none
	body, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
	return body
}

// mcpCall sends one JSON-RPC request to Lens's /mcp on the session's token. A non-nil error is a failure to
// reach Lens or read its answer; Lens's own refusal comes back in the reply.
func (a *app) mcpCall(r *http.Request, t tenant, method string, params any) (mcpReply, int, error) {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, a.cfg.lensBaseURL+lensMCPPath, bytes.NewReader(mcpRequest(method, params)))
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

// capturedResponse keeps what forwardProductWith wrote, so a Track or Docs MCP answer is read here rather than
// sent to the browser as it came. It keeps the first 1 MiB, as mcpCall reads of Lens's.
type capturedResponse struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func (c *capturedResponse) Header() http.Header { return c.header }

func (c *capturedResponse) WriteHeader(status int) {
	if c.status == 0 {
		c.status = status
	}
}

func (c *capturedResponse) Write(p []byte) (int, error) {
	c.WriteHeader(http.StatusOK)
	if room := 1<<20 - c.body.Len(); room < len(p) {
		c.body.Write(p[:max(room, 0)])
		return 0, io.ErrShortWrite
	}
	return c.body.Write(p)
}

func newCapturedResponse() *capturedResponse { return &capturedResponse{header: http.Header{}} }

// productMCPCall sends one JSON-RPC request to Track's or Docs' /mcp as the signed-in person. It goes through
// forwardProductWith, the one place a product's gateway proof and the session's identity are attached.
func (a *app) productMCPCall(r *http.Request, product, method string, params any) (mcpReply, int, error) {
	base, secret := a.cfg.trackBaseURL, a.cfg.trackGatewaySecret
	if product == "docs" {
		base, secret = a.cfg.docsBaseURL, a.cfg.docsGatewaySecret
	}
	cw := newCapturedResponse()
	a.forwardProductWith(cw, r, product, base, secret, productMCPPath, "", http.MethodPost, bytes.NewReader(mcpRequest(method, params)), nil,
		http.Header{"Content-Type": {"application/json"}})
	var out mcpReply
	if cw.status != http.StatusOK {
		return out, cw.status, nil
	}
	if err := json.Unmarshal(cw.body.Bytes(), &out); err != nil {
		return out, cw.status, err
	}
	return out, cw.status, nil
}

// productConfigured: Track or Docs is set up on this BFF and a person can be signed in to reach it as.
func (a *app) productConfigured(product string) bool {
	if a.auth == nil {
		return false
	}
	if product == "docs" {
		return a.cfg.docsBaseURL != ""
	}
	return a.cfg.trackBaseURL != ""
}

// listedTools is one product's /mcp tools/list, the tools chatTools names for that product only, each with
// the arguments the BFF sets taken out of its schema.
func listedTools(product string, reply mcpReply) []chatTool {
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
		spec, ok := chatTools[tl.Name]
		if !ok || spec.product != product || !json.Valid(tl.InputSchema) {
			continue
		}
		schema, err := withoutArguments(tl.InputSchema, spec.session)
		if err != nil {
			continue
		}
		tools = append(tools, chatTool{Name: tl.Name, Description: tl.Description, InputSchema: schema, Product: product, Writes: spec.writes})
	}
	return tools
}

// withoutArguments is a tool's JSON Schema with the named properties gone, from its properties and from required.
func withoutArguments(schema json.RawMessage, names []string) (json.RawMessage, error) {
	if len(names) == 0 {
		return schema, nil
	}
	var s map[string]any
	if err := json.Unmarshal(schema, &s); err != nil {
		return nil, err
	}
	props, _ := s["properties"].(map[string]any)
	for _, n := range names {
		delete(props, n)
	}
	if req, ok := s["required"].([]any); ok {
		kept := []any{}
		for _, v := range req {
			if n, _ := v.(string); !slices.Contains(names, n) {
				kept = append(kept, v)
			}
		}
		s["required"] = kept
	}
	return json.Marshal(s)
}

// handleChatTools — GET /api/chat/tools. Lens's, Track's and Docs' tools are listed at once; a product that
// cannot list its tools just now offers none, and the others are still offered.
func (a *app) handleChatTools(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	products := []string{"lens"}
	for _, p := range []string{"track", "docs"} {
		if a.productConfigured(p) {
			products = append(products, p)
		}
	}
	lists := make([][]chatTool, len(products))
	failed := make([]bool, len(products))
	var wg sync.WaitGroup
	for i, p := range products {
		wg.Add(1)
		go func() {
			defer wg.Done()
			var reply mcpReply
			var status int
			var err error
			if p == "lens" {
				reply, status, err = a.mcpCall(r, t, "tools/list", map[string]any{})
			} else {
				reply, status, err = a.productMCPCall(r, p, "tools/list", map[string]any{})
			}
			if err != nil || status != http.StatusOK || reply.Error != nil {
				log.Printf("bff: chat tools: %s: status %d: %v", p, status, err)
				failed[i] = true
				return
			}
			lists[i] = listedTools(p, reply)
		}()
	}
	wg.Wait()
	tools := []chatTool{}
	for _, l := range lists {
		tools = append(tools, l...)
	}
	if len(tools) == 0 && slices.Contains(failed, true) {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens could not list its tools just now"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tools": tools})
}

// firstTrackTeam is the team a Chat-filed issue goes to: the first of the session's workspace's teams, as Track lists them.
func (a *app) firstTrackTeam(r *http.Request) (string, bool) {
	cw := newCapturedResponse()
	ws, ok := a.trackWorkspaceFor(cw, r)
	if !ok {
		return "", false
	}
	a.forwardProduct(cw, r, "track", a.cfg.trackBaseURL, a.cfg.trackGatewaySecret, trackWorkspacePath(ws, "/teams"), "", http.MethodGet, nil, nil)
	var teams []struct {
		ID string `json:"id"`
	}
	if cw.status != http.StatusOK || json.Unmarshal(cw.body.Bytes(), &teams) != nil || len(teams) == 0 || teams[0].ID == "" {
		log.Printf("bff: chat tool create_issue: no team in the workspace's teams (status %d)", cw.status)
		return "", false
	}
	return teams[0].ID, true
}

// handleChatToolCall — POST /api/chat/tools/call {"name", "arguments", "confirmed"}.
func (a *app) handleChatToolCall(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	var in struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
		Confirmed bool            `json:"confirmed"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil || in.Name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name and arguments required"})
		return
	}
	spec, ok := chatTools[in.Name]
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Chat may not use that tool"})
		return
	}
	// B28.374 — a tool that changes something runs only once the person said yes to this call in Chat.
	if spec.writes && !in.Confirmed {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "This needs the person's yes in Chat first; nothing was done."})
		return
	}
	args := map[string]any{}
	if len(in.Arguments) > 0 && string(in.Arguments) != "null" {
		if err := json.Unmarshal(in.Arguments, &args); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "arguments must be a JSON object"})
			return
		}
	}
	// Dropped however the model spelled them: Track and Docs decode arguments into Go structs, which match keys
	// case-insensitively, so a "Workspace_ID" left beside the session's workspace_id could still be read.
	for k := range args {
		for _, own := range spec.session {
			if strings.EqualFold(k, own) {
				delete(args, k)
			}
		}
	}
	name := productNames[spec.product]
	var reply mcpReply
	var status int
	var err error
	if spec.product == "lens" {
		reply, status, err = a.mcpCall(r, t, "tools/call", map[string]any{"name": in.Name, "arguments": args})
	} else {
		if !a.productConfigured(spec.product) {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": name + " is not set up here"})
			return
		}
		cw := newCapturedResponse()
		ws, ok := a.trackWorkspaceFor(cw, r) // Docs' workspace is Track's (docsWorkspaceFor)
		if !ok {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Your " + name + " workspace isn't ready yet"})
			return
		}
		if slices.Contains(spec.session, "workspace_id") {
			args["workspace_id"] = ws
		}
		if slices.Contains(spec.session, "team_id") {
			team, ok := a.firstTrackTeam(r)
			if !ok {
				writeJSON(w, http.StatusOK, chatToolResult{Text: "This Track workspace has no team to file an issue in.", IsError: true})
				return
			}
			args["team_id"] = team
		}
		reply, status, err = a.productMCPCall(r, spec.product, "tools/call", map[string]any{"name": in.Name, "arguments": args})
	}
	switch {
	case err != nil || status != http.StatusOK:
		log.Printf("bff: chat tool %s: status %d: %v", in.Name, status, err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": name + " could not answer just now"})
		return
	case reply.Error != nil && reply.Error.Code == mcpMethodNotFound:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": name + " has no such tool"})
		return
	case reply.Error != nil && reply.Error.Code == mcpInvalidParams && spec.product != "lens":
		// What the call lacked, in the product's words, for the model to ask again with.
		writeJSON(w, http.StatusOK, chatToolResult{Text: reply.Error.Message, IsError: true})
		return
	case reply.Error != nil:
		log.Printf("bff: chat tool %s: %s: %s", in.Name, spec.product, reply.Error.Message)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": name + " could not answer just now"})
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
