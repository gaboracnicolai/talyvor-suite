package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// B28.349 — Chat lists and calls Lens's wallet MCP tools through the BFF: only the read-only ones are
// listed, a call reaches Lens's /mcp tools/call with the model's arguments, Lens's answer comes back as
// its text, and a tool that moves money is refused here without reaching Lens.
func TestChatToolsReachLensMCPAndOnlyReadOnlyOnes(t *testing.T) {
	var mu sync.Mutex
	var calls []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		mu.Lock()
		calls = append(calls, r.Method+" "+r.URL.Path+" "+string(raw))
		mu.Unlock()
		if r.URL.Path != "/mcp" {
			http.NotFound(w, r)
			return
		}
		var rpc struct {
			Method string `json:"method"`
		}
		_ = json.Unmarshal(raw, &rpc)
		w.Header().Set("Content-Type", "application/json")
		switch rpc.Method {
		case "tools/list":
			_, _ = io.WriteString(w, `{"jsonrpc":"2.0","id":1,"result":{"tools":[
				{"name":"wallet_agents_spend","description":"What your agents spent","inputSchema":{"type":"object","properties":{"from":{"type":"string"}}}},
				{"name":"wallet_send","description":"Send credits","inputSchema":{"type":"object"}},
				{"name":"agent_pay","description":"Pay an agent","inputSchema":{"type":"object"}}]}}`)
		case "tools/call":
			_, _ = io.WriteString(w, `{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"{\"agents\":[{\"agent_id\":\"agt_1\",\"name\":\"Researcher\",\"spent_ulxc\":1230000,\"lines\":[{\"entry_id\":\"ent_9\",\"kind\":\"pay\",\"amount_ulxc\":-1230000,\"at\":\"2026-10-05T06:00:00Z\"}]}]}"}]}}`)
		}
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	rec := doJSON(a, http.MethodGet, "/api/chat/tools", "")
	var listed struct {
		Tools []chatTool `json:"tools"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &listed)
	if rec.Code != http.StatusOK || len(listed.Tools) != 1 || listed.Tools[0].Name != "wallet_agents_spend" || !strings.Contains(string(listed.Tools[0].InputSchema), `"from"`) {
		t.Fatalf("GET /api/chat/tools = %d %s; want wallet_agents_spend alone, with its schema", rec.Code, rec.Body.String())
	}

	rec = doJSON(a, http.MethodPost, "/api/chat/tools/call", `{"name":"wallet_agents_spend","arguments":{"from":"2026-10-01"}}`)
	var got chatToolResult
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if rec.Code != http.StatusOK || got.IsError || !strings.Contains(got.Text, `"spent_ulxc":1230000`) || !strings.Contains(got.Text, `"entry_id":"ent_9"`) {
		t.Fatalf("call = %d %s; want Lens's text with the 1.23 LXC line", rec.Code, rec.Body.String())
	}
	mu.Lock()
	last := calls[len(calls)-1]
	mu.Unlock()
	if !strings.HasPrefix(last, "POST /mcp ") || !strings.Contains(last, `"method":"tools/call"`) || !strings.Contains(last, `"params":{"arguments":{"from":"2026-10-01"},"name":"wallet_agents_spend"}`) {
		t.Fatalf("Lens got %q; want tools/call of wallet_agents_spend with the model's arguments", last)
	}

	mu.Lock()
	before := len(calls)
	mu.Unlock()
	for _, name := range []string{"wallet_send", "agent_pay"} {
		rec = doJSON(a, http.MethodPost, "/api/chat/tools/call", `{"name":"`+name+`","arguments":{"to":"@x","amount_ulxc":1000000}}`)
		if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "may not use that tool") {
			t.Fatalf("calling %s = %d %s; want 400 — a question in Chat must never move money", name, rec.Code, rec.Body.String())
		}
	}
	mu.Lock()
	defer mu.Unlock()
	if len(calls) != before {
		t.Fatalf("a refused tool still reached Lens: %q", calls[before:])
	}
}
