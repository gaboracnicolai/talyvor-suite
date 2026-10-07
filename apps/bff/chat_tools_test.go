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

// fakeProductMCP is a Track or Docs that answers /mcp tools/list with tools and tools/call with answer, records
// every request it was sent, and lists one team.
type fakeProductMCP struct {
	srv  *httptest.Server
	mu   sync.Mutex
	got  []string
	hdrs []http.Header
}

func newFakeProductMCP(t *testing.T, tools, answer string) *fakeProductMCP {
	t.Helper()
	f := &fakeProductMCP{}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		f.mu.Lock()
		f.got = append(f.got, r.Method+" "+r.URL.Path+" "+string(raw))
		f.hdrs = append(f.hdrs, r.Header.Clone())
		f.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/v1/workspaces/track-ws-7/teams":
			_, _ = io.WriteString(w, `[{"id":"team-eng","name":"Engineering"},{"id":"team-ops","name":"Ops"}]`)
		case r.URL.Path == "/mcp" && strings.Contains(string(raw), `"tools/list"`):
			_, _ = io.WriteString(w, `{"jsonrpc":"2.0","id":1,"result":{"tools":`+tools+`}}`)
		case r.URL.Path == "/mcp":
			_, _ = io.WriteString(w, `{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":`+answer+`}]}}`)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeProductMCP) requests() ([]string, []http.Header) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.got...), append([]http.Header(nil), f.hdrs...)
}

// B28.374 — Chat offers Track's and Docs' own tools beside Lens's, without the workspace the BFF sets itself; Track's
// create_issue runs only once the person said yes, and then files the issue in the session's own workspace and its
// first team, whatever workspace the model named, as the signed-in person.
func TestChatToolsFileATrackIssueOnlyOnceThePersonSaidYes(t *testing.T) {
	track := newFakeProductMCP(t, `[
		{"name":"create_issue","description":"Create an issue","inputSchema":{"type":"object","properties":{"workspace_id":{"type":"string"},"team_id":{"type":"string"},"title":{"type":"string"},"description":{"type":"string"}},"required":["workspace_id","team_id","title"]}},
		{"name":"search_issues","description":"Search issues","inputSchema":{"type":"object","properties":{"workspace_id":{"type":"string"},"query":{"type":"string"}},"required":["workspace_id","query"]}},
		{"name":"update_issue","description":"Patch an issue","inputSchema":{"type":"object"}}]`,
		`"{\"id\":\"iss-1\",\"identifier\":\"ENG-42\",\"title\":\"Export downloads an empty file\",\"url\":\"/issues/ENG-42\"}"`)
	docs := newFakeProductMCP(t, `[
		{"name":"search_docs","description":"Search Docs","inputSchema":{"type":"object","properties":{"workspace_id":{"type":"string"},"query":{"type":"string"}},"required":["query","workspace_id"]}},
		{"name":"create_page","description":"Create a page","inputSchema":{"type":"object"}}]`, `"[]"`)
	a, sess := productApp(t, &captureUpstream{srv: track.srv}, &captureUpstream{srv: docs.srv})
	do := func(method, path, body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.AddCookie(sess)
		req.Header.Set("Content-Type", "application/json")
		a.ServeHTTP(rec, req)
		return rec
	}

	// Lens is unreachable in this harness: Track's and Docs' tools are offered all the same.
	rec := do(http.MethodGet, "/api/chat/tools", "")
	var listed struct {
		Tools []chatTool `json:"tools"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &listed)
	byName := map[string]chatTool{}
	for _, tl := range listed.Tools {
		byName[tl.Name] = tl
	}
	file, search, docsSearch := byName["create_issue"], byName["search_issues"], byName["search_docs"]
	if rec.Code != http.StatusOK || len(listed.Tools) != 3 || file.Product != "track" || !file.Writes || search.Writes || docsSearch.Product != "docs" {
		t.Fatalf("GET /api/chat/tools = %d %s; want create_issue (track, writes), search_issues and search_docs only", rec.Code, rec.Body.String())
	}
	for _, tl := range listed.Tools {
		if s := string(tl.InputSchema); strings.Contains(s, "workspace_id") || strings.Contains(s, "team_id") {
			t.Fatalf("%s is offered with %s; the model must not be asked for a workspace or team", tl.Name, s)
		}
	}
	if !strings.Contains(string(file.InputSchema), `"required":["title"]`) {
		t.Fatalf("create_issue's schema %s; want title still required", file.InputSchema)
	}

	before, _ := track.requests()
	call := `{"name":"create_issue","arguments":{"workspace_id":"someone-elses","Workspace_ID":"someone-elses","title":"Export downloads an empty file","description":"Spend → Export CSV gives 0 bytes."}`
	rec = do(http.MethodPost, "/api/chat/tools/call", call+`}`)
	if rec.Code != http.StatusConflict {
		t.Fatalf("an unconfirmed create_issue = %d %s; want 409 — nothing is filed without the person's yes", rec.Code, rec.Body.String())
	}
	if got, _ := track.requests(); len(got) != len(before) {
		t.Fatalf("an unconfirmed create_issue still reached Track: %q", got[len(before):])
	}

	rec = do(http.MethodPost, "/api/chat/tools/call", call+`,"confirmed":true}`)
	var res chatToolResult
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	if rec.Code != http.StatusOK || res.IsError || !strings.Contains(res.Text, `"identifier":"ENG-42"`) {
		t.Fatalf("a confirmed create_issue = %d %s; want Track's answer naming ENG-42", rec.Code, rec.Body.String())
	}
	got, hdrs := track.requests()
	last, h := got[len(got)-1], hdrs[len(hdrs)-1]
	var sent struct {
		Method string `json:"method"`
		Params struct {
			Name      string            `json:"name"`
			Arguments map[string]string `json:"arguments"`
		} `json:"params"`
	}
	_ = json.Unmarshal([]byte(strings.SplitN(last, " ", 3)[2]), &sent)
	if !strings.HasPrefix(last, "POST /mcp ") || sent.Method != "tools/call" || sent.Params.Name != "create_issue" ||
		sent.Params.Arguments["workspace_id"] != "track-ws-7" || sent.Params.Arguments["team_id"] != "team-eng" ||
		sent.Params.Arguments["title"] != "Export downloads an empty file" || len(sent.Params.Arguments) != 4 {
		t.Fatalf("Track got %q; want tools/call create_issue in the session's workspace track-ws-7 and its first team, with the model's title", last)
	}
	if h.Get("X-Gateway-Auth") != testTrackSecret || h.Get("X-User-Email") != "ng@example.com" {
		t.Fatalf("Track got gateway proof %q and identity %q; want the BFF's proof and the signed-in person", h.Get("X-Gateway-Auth"), h.Get("X-User-Email"))
	}
}
