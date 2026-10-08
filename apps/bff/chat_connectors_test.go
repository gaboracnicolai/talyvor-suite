package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
)

// connectorsAt sends every connector request to one test server, whatever address the connector has.
type connectorsAt string

func (c connectorsAt) RoundTrip(r *http.Request) (*http.Response, error) {
	to, err := url.Parse(string(c))
	if err != nil {
		return nil, err
	}
	r = r.Clone(r.Context())
	r.URL.Scheme, r.URL.Host, r.Host = to.Scheme, to.Host, to.Host
	return http.DefaultTransport.RoundTrip(r)
}

// B28.122 — a connector is an MCP server over Streamable HTTP: the relay initializes, carries the session id the
// server gave and the person's token on every request after, lists the tools with their schemas, and runs a call
// whose answer comes back as an event stream with a progress notice ahead of it.
func TestConnectorToolsAndCallOverStreamableHTTP(t *testing.T) {
	var mu sync.Mutex
	var seen []string
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var rpc struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
		}
		_ = json.Unmarshal(raw, &rpc)
		mu.Lock()
		seen = append(seen, rpc.Method+" session="+r.Header.Get("Mcp-Session-Id")+" auth="+r.Header.Get("Authorization"))
		mu.Unlock()
		if r.Header.Get("Authorization") != "Bearer tok_123" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if rpc.Method != "initialize" && r.Header.Get("Mcp-Session-Id") != "sess_1" {
			http.Error(w, "no session", http.StatusBadRequest)
			return
		}
		switch rpc.Method {
		case "initialize":
			w.Header().Set("Mcp-Session-Id", "sess_1")
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"jsonrpc":"2.0","id":`+string(rpc.ID)+`,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"Weather","version":"2"}}}`)
		case "notifications/initialized":
			w.WriteHeader(http.StatusAccepted)
		case "tools/list":
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"jsonrpc":"2.0","id":`+string(rpc.ID)+`,"result":{"tools":[
				{"name":"forecast","description":"Tomorrow's weather","inputSchema":{"type":"object","properties":{"city":{"type":"string"}}},"annotations":{"readOnlyHint":true}},
				{"name":"set_alert","description":"Alert me","inputSchema":{"type":"object"}}]}}`)
		case "tools/call":
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = io.WriteString(w, "event: message\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\",\"params\":{\"progress\":1}}\n\n")
			_, _ = io.WriteString(w, "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":"+string(rpc.ID)+",\n")
			_, _ = io.WriteString(w, "data: \"result\":{\"content\":[{\"type\":\"text\",\"text\":\"Rain in Lisbon, 17°C\"}]}}\n\n")
		}
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", webDist: t.TempDir(), authMode: authModeDisabled}, nil)
	a.connectorOut = srv.Client().Transport // the test server is on loopback, which the real transport refuses

	rec := doJSON(a, http.MethodPost, "/api/chat/connectors/tools", `{"url":"`+srv.URL+`/mcp","token":"tok_123"}`)
	var listed struct {
		Server string          `json:"server"`
		Tools  []connectorTool `json:"tools"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &listed)
	if rec.Code != http.StatusOK || listed.Server != "Weather" || len(listed.Tools) != 2 ||
		listed.Tools[0].Name != "forecast" || listed.Tools[1].Name != "set_alert" || !strings.Contains(string(listed.Tools[0].InputSchema), `"city"`) {
		t.Fatalf("tools = %d %s; want Weather's forecast (with its schema) and set_alert", rec.Code, rec.Body.String())
	}

	rec = doJSON(a, http.MethodPost, "/api/chat/connectors/call", `{"url":"`+srv.URL+`/mcp","token":"tok_123","name":"forecast","arguments":{"city":"Lisbon"}}`)
	var got chatToolResult
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if rec.Code != http.StatusOK || got.IsError || got.Text != "Rain in Lisbon, 17°C" {
		t.Fatalf("call = %d %s; want the forecast read out of the event stream", rec.Code, rec.Body.String())
	}
	mu.Lock()
	last := seen[len(seen)-1]
	mu.Unlock()
	if last != "tools/call session=sess_1 auth=Bearer tok_123" {
		t.Fatalf("the call reached the connector as %q; want it in the session the server gave, with the token", last)
	}

	rec = doJSON(a, http.MethodPost, "/api/chat/connectors/tools", `{"url":"`+srv.URL+`/mcp","token":"wrong"}`)
	if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "refused the token") {
		t.Fatalf("a wrong token = %d %s; want 502 saying the connector refused it", rec.Code, rec.Body.String())
	}
}

// B28.122 — the browser names the connector's address, so the BFF never dials one that is not on the internet: a
// connector on loopback is refused at connect time and the server there hears nothing; plain http is refused outright.
func TestConnectorAtAPrivateAddressIsNeverDialled(t *testing.T) {
	var mu sync.Mutex
	hits := 0
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		hits++
		mu.Unlock()
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	for _, u := range []string{srv.URL + "/mcp", strings.Replace(srv.URL, "127.0.0.1", "localhost", 1) + "/mcp"} {
		rec := doJSON(a, http.MethodPost, "/api/chat/connectors/tools", `{"url":"`+u+`"}`)
		if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "not on the public internet") {
			t.Fatalf("a connector at %s = %d %s; want 502, refused as not on the internet", u, rec.Code, rec.Body.String())
		}
	}
	rec := doJSON(a, http.MethodPost, "/api/chat/connectors/tools", `{"url":"http://mcp.example.com/mcp"}`)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "https") {
		t.Fatalf("a connector over plain http = %d %s; want 400 asking for https", rec.Code, rec.Body.String())
	}
	mu.Lock()
	defer mu.Unlock()
	if hits != 0 {
		t.Fatalf("the server on loopback was reached %d times; want never", hits)
	}
}

// B28.122 — Talyvor test tools, on this app's own origin, is answered in-process: its fingerprint tool is listed, and a
// call answers the first 12 hex digits of the text's SHA-256.
func TestTalyvorTestToolsAnswerInProcess(t *testing.T) {
	a := newApp(config{addr: "127.0.0.1:0", webDist: t.TempDir(), authMode: authModeDisabled}, nil)
	a.connectorOut = nil                        // nothing may leave the process
	own := "http://example.com" + testToolsPath // httptest.NewRequest's host

	rec := doJSON(a, http.MethodPost, "/api/chat/connectors/tools", `{"url":"`+own+`"}`)
	var listed struct {
		Server string          `json:"server"`
		Tools  []connectorTool `json:"tools"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &listed)
	if rec.Code != http.StatusOK || listed.Server != testToolsName || len(listed.Tools) != 1 || listed.Tools[0].Name != "fingerprint" {
		t.Fatalf("test tools = %d %s; want fingerprint alone", rec.Code, rec.Body.String())
	}
	rec = doJSON(a, http.MethodPost, "/api/chat/connectors/call", `{"url":"`+own+`","name":"fingerprint","arguments":{"text":"hello"}}`)
	var got chatToolResult
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if rec.Code != http.StatusOK || got.IsError || got.Text != "2cf24dba5fb0" {
		t.Fatalf("fingerprint of hello = %d %s; want 2cf24dba5fb0, the start of its SHA-256", rec.Code, rec.Body.String())
	}
}
