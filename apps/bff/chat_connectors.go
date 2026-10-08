package main

// chat_connectors.go — B28.122: external MCP connectors in Chat. A person adds an MCP server by its URL, and the token
// it wants if any, on /chat/connectors; Chat offers the model that server's tools beside Talyvor's own, and a call the
// model makes runs here, against the connector:
//
//	POST /api/chat/connectors/tools {"url", "token"}                       its tools/list → {"server", "tools": [{name, description, input_schema}]}
//	POST /api/chat/connectors/call  {"url", "token", "name", "arguments"}  one tools/call → {"text", "is_error"}
//
// The connectors are the person's own and kept in their browser (apps/web/src/areas/chat/connectors.ts), as their
// custom instructions are, so each request names the one it is for. Nothing here is stored, and the token is never
// logged. Each request is one MCP session over the Streamable HTTP transport: initialize, notifications/initialized,
// then the one request, carrying the Mcp-Session-Id the server gave, its answer read as JSON or as an event stream.
//
// ⚠ A CONNECTOR IS DIALLED ONLY AT A PUBLIC ADDRESS. The URL is the browser's to name, so an address that is loopback,
// private, link-local or otherwise not on the internet (127.0.0.1, 10.x, 169.254.169.254, fc00::/7, …) is refused when
// the connection is made, after DNS, so a public name that resolves inside cannot reach in either. The URL must be
// https, no proxy is used, and a redirect is not followed.
//
// Talyvor test tools is a connector anyone can add to try connectors (testToolsPath, on this app's own origin): its one
// tool, fingerprint, answers what no model can work out without calling it. The relay serves it in-process — it is not
// on the public mux, so nothing outside Chat can call it and it needs no Origin exemption.

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// testToolsPath is where Talyvor test tools is, on this app's own origin.
const testToolsPath = "/mcp/test-tools"

// testToolsName is the test connector's name, as its initialize answer gives it and the Connectors page shows it.
const testToolsName = "Talyvor test tools"

// connectorProtocolVersion is the MCP revision the relay asks a connector for.
const connectorProtocolVersion = "2025-06-18"

// connectorTimeout bounds one request to a connector, from dialling to the end of its answer.
const connectorTimeout = 30 * time.Second

// connectorMaxPages is how many pages of tools/list are read: a connector with more tools than that offers the first ones.
const connectorMaxPages = 10

var (
	errConnectorPrivate = errors.New("that address is not on the public internet, so Talyvor will not call it")
	errConnectorAuth    = errors.New("the connector refused the token")
	errConnectorNoReply = errors.New("the connector did not answer as an MCP server does")
)

// notPublic are ranges netip does not name that are not the internet either (IANA's special-purpose registries): this
// network, CGNAT, IETF protocol assignments, documentation, benchmarking and reserved, and the IPv6 prefixes that carry
// an IPv4 address inside them (NAT64, 6to4, Teredo) or are discard-only.
var notPublic = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("64:ff9b::/96"),
	netip.MustParsePrefix("64:ff9b:1::/48"),
	netip.MustParsePrefix("100::/64"),
	netip.MustParsePrefix("2001::/32"),
	netip.MustParsePrefix("2001:db8::/32"),
	netip.MustParsePrefix("2002::/16"),
}

// globalIPv6 is where the internet's IPv6 unicast addresses are; anything outside it (site-local fec0::/10, …) is not.
var globalIPv6 = netip.MustParsePrefix("2000::/3")

// publicAddress: an address on the internet, which a connector may be at.
func publicAddress(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || (ip.Is6() && !globalIPv6.Contains(ip)) {
		return false
	}
	for _, p := range notPublic {
		if p.Contains(ip) {
			return false
		}
	}
	return true
}

// refusePrivateAddress is the dialler's check on the address it is about to connect to, after DNS.
func refusePrivateAddress(_, address string, _ syscall.RawConn) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return err
	}
	ip, err := netip.ParseAddr(host)
	if err != nil || !publicAddress(ip) {
		return errConnectorPrivate
	}
	return nil
}

// newConnectorTransport is how the relay reaches a connector: public addresses only, and never through a proxy, which
// would make the connection the check sees the proxy's rather than the connector's.
func newConnectorTransport() http.RoundTripper {
	dialer := &net.Dialer{Timeout: 10 * time.Second, Control: refusePrivateAddress}
	return &http.Transport{
		Proxy:                 nil,
		DialContext:           dialer.DialContext,
		ForceAttemptHTTP2:     true,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: connectorTimeout,
		MaxIdleConns:          20,
		IdleConnTimeout:       60 * time.Second,
	}
}

// connectorTransport sends Talyvor test tools' requests to it in-process, and every other connector's out.
type connectorTransport struct {
	self []string // this app's own hosts: the public origin's, and the one this request came in on
	out  http.RoundTripper
}

func (c connectorTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if !isTestTools(req.URL, c.self) {
		return c.out.RoundTrip(req)
	}
	cw := newCapturedResponse()
	serveTestTools(cw, req)
	if cw.status == 0 {
		cw.status = http.StatusOK
	}
	return &http.Response{StatusCode: cw.status, Status: http.StatusText(cw.status), Header: cw.header, Body: io.NopCloser(&cw.body),
		ContentLength: int64(cw.body.Len()), Proto: "HTTP/1.1", ProtoMajor: 1, ProtoMinor: 1, Request: req}, nil
}

func isTestTools(u *url.URL, self []string) bool {
	return u.Path == testToolsPath && u.RawQuery == "" && slices.Contains(self, u.Host)
}

// ownHosts are the hosts Talyvor test tools answers on: this app's public origin's, and the one the request came in on.
func (a *app) ownHosts(r *http.Request) []string {
	hosts := []string{r.Host}
	if u, err := url.Parse(a.cfg.publicBaseURL); err == nil && u.Host != "" {
		hosts = append(hosts, u.Host)
	}
	return hosts
}

// connectorURL is the connector's URL as the browser sent it, or why it cannot be one.
func (a *app) connectorURL(r *http.Request, raw string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") {
		return nil, errors.New("that is not a connector's address: it starts https:// and names the server")
	}
	if u.User != nil {
		return nil, errors.New("put the connector's token in its own box, not in its address")
	}
	if u.Scheme != "https" && !isTestTools(u, a.ownHosts(r)) {
		return nil, errors.New("a connector must be reached over https")
	}
	u.Fragment = ""
	return u, nil
}

// connectorSession is one MCP session with a connector: where it is, the token it was given, and the session id and
// protocol version its initialize answer set.
type connectorSession struct {
	client  *http.Client
	url     string
	token   string
	session string
	version string
	id      int
}

// openConnector starts a session with a connector — initialize, then notifications/initialized — and returns the
// server's name as it gave it.
func (a *app) openConnector(r *http.Request, u *url.URL, token string) (*connectorSession, string, error) {
	s := &connectorSession{
		client: &http.Client{
			Timeout:       connectorTimeout,
			Transport:     connectorTransport{self: a.ownHosts(r), out: a.connectorOut},
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
		url:   u.String(),
		token: strings.TrimSpace(token),
	}
	reply, err := s.request(r.Context(), "initialize", map[string]any{
		"protocolVersion": connectorProtocolVersion,
		"capabilities":    map[string]any{},
		"clientInfo":      map[string]any{"name": "Talyvor Chat", "version": "1"},
	})
	if err != nil {
		return nil, "", err
	}
	if reply.Error != nil {
		return nil, "", fmt.Errorf("the connector refused to start: %s", reply.Error.Message)
	}
	var info struct {
		ProtocolVersion string `json:"protocolVersion"`
		ServerInfo      struct {
			Name    string `json:"name"`
			Version string `json:"version"`
		} `json:"serverInfo"`
	}
	if json.Unmarshal(reply.Result, &info) != nil {
		return nil, "", errConnectorNoReply
	}
	s.version = info.ProtocolVersion
	if err := s.notify(r.Context(), "notifications/initialized"); err != nil {
		return nil, "", err
	}
	return s, info.ServerInfo.Name, nil
}

// post sends one JSON-RPC message to the connector with the session's headers.
func (s *connectorSession) post(ctx context.Context, body []byte) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	if s.token != "" {
		req.Header.Set("Authorization", "Bearer "+s.token)
	}
	if s.session != "" {
		req.Header.Set("Mcp-Session-Id", s.session)
	}
	if s.version != "" {
		req.Header.Set("MCP-Protocol-Version", s.version)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		if errors.Is(err, errConnectorPrivate) {
			return nil, errConnectorPrivate
		}
		var timeout interface{ Timeout() bool }
		if errors.As(err, &timeout) && timeout.Timeout() {
			return nil, errors.New("the connector did not answer in time")
		}
		return nil, errors.New("the connector could not be reached")
	}
	switch {
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
		_ = resp.Body.Close()
		if s.token == "" {
			return nil, errors.New("the connector wants a token")
		}
		return nil, errConnectorAuth
	case resp.StatusCode >= 300 && resp.StatusCode < 400:
		_ = resp.Body.Close()
		return nil, errors.New("the connector's address moved; add it again at its new address")
	case resp.StatusCode >= 300:
		_ = resp.Body.Close()
		return nil, fmt.Errorf("the connector answered %d", resp.StatusCode)
	}
	return resp, nil
}

// notify sends a notification, which has no answer.
func (s *connectorSession) notify(ctx context.Context, method string) error {
	resp, err := s.post(ctx, []byte(`{"jsonrpc":"2.0","method":"`+method+`"}`))
	if err != nil {
		return err
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
	return resp.Body.Close()
}

// request sends one request and reads its answer: one JSON object, or an event stream that carries it among others.
func (s *connectorSession) request(ctx context.Context, method string, params any) (mcpReply, error) {
	s.id++
	resp, err := s.post(ctx, mcpRequestID(s.id, method, params))
	if err != nil {
		return mcpReply{}, err
	}
	defer func() { _ = resp.Body.Close() }()
	if id := resp.Header.Get("Mcp-Session-Id"); id != "" && s.session == "" {
		s.session = id
	}
	body := io.LimitReader(resp.Body, 1<<20)
	if strings.HasPrefix(strings.ToLower(resp.Header.Get("Content-Type")), "text/event-stream") {
		return answerInStream(body, s.id)
	}
	var reply mcpReply
	if err := json.NewDecoder(body).Decode(&reply); err != nil || (reply.Result == nil && reply.Error == nil) {
		return mcpReply{}, errConnectorNoReply
	}
	return reply, nil
}

// answerInStream is the answer to request id in an event stream: the first event whose data is a JSON-RPC message with
// that id and a result or an error. Whatever else the server sends on the way — progress, its own requests — is passed over.
func answerInStream(body io.Reader, id int) (mcpReply, error) {
	sc := bufio.NewScanner(body)
	sc.Buffer(make([]byte, 0, 64<<10), 1<<20)
	var data []string
	answer := func() (mcpReply, bool) {
		payload := strings.Join(data, "\n")
		data = nil
		var msg struct {
			ID json.RawMessage `json:"id"`
		}
		var reply mcpReply
		if json.Unmarshal([]byte(payload), &msg) != nil || string(msg.ID) != strconv.Itoa(id) || json.Unmarshal([]byte(payload), &reply) != nil {
			return mcpReply{}, false
		}
		return reply, reply.Result != nil || reply.Error != nil
	}
	for sc.Scan() {
		line := sc.Text()
		if line == "" {
			if reply, ok := answer(); ok {
				return reply, nil
			}
			continue
		}
		if v, ok := strings.CutPrefix(line, "data:"); ok {
			data = append(data, strings.TrimPrefix(v, " "))
		}
	}
	if reply, ok := answer(); ok {
		return reply, nil
	}
	return mcpReply{}, errConnectorNoReply
}

// connectorTool is one of a connector's tools as Chat offers it. Chat asks the person before every call, whatever the
// server says of the tool (MCP's readOnlyHint is not passed on): the call's arguments go to a server outside Talyvor.
type connectorTool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"input_schema"`
}

// connectorBody is what the browser sends for a connector: its address and token, and for a call, the tool and arguments.
type connectorBody struct {
	URL       string          `json:"url"`
	Token     string          `json:"token"`
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

// readConnectorBody reads the browser's body and opens a session with the connector it names, or answers why not.
func (a *app) readConnectorBody(w http.ResponseWriter, r *http.Request) (connectorBody, *connectorSession, string, bool) {
	var in connectorBody
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return in, nil, "", false
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "url required"})
		return in, nil, "", false
	}
	u, err := a.connectorURL(r, in.URL)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": sentence(err)})
		return in, nil, "", false
	}
	s, server, err := a.openConnector(r, u, in.Token)
	if err != nil {
		log.Printf("bff: connector %q: %q", u.Host, err.Error())
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": sentence(err)})
		return in, nil, "", false
	}
	return in, s, server, true
}

// sentence is an error as the screen says it: capitalised, with a full stop.
func sentence(err error) string {
	s := err.Error()
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:] + "."
}

// handleConnectorTools — POST /api/chat/connectors/tools {"url", "token"}: the connector's tools.
func (a *app) handleConnectorTools(w http.ResponseWriter, r *http.Request) {
	_, s, server, ok := a.readConnectorBody(w, r)
	if !ok {
		return
	}
	tools := []connectorTool{}
	cursor := ""
	for page := 0; page < connectorMaxPages; page++ {
		params := map[string]any{}
		if cursor != "" {
			params["cursor"] = cursor
		}
		reply, err := s.request(r.Context(), "tools/list", params)
		if err == nil && reply.Error != nil {
			err = fmt.Errorf("the connector would not list its tools: %s", reply.Error.Message)
		}
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": sentence(err)})
			return
		}
		var listed struct {
			Tools []struct {
				Name        string          `json:"name"`
				Description string          `json:"description"`
				InputSchema json.RawMessage `json:"inputSchema"`
			} `json:"tools"`
			NextCursor string `json:"nextCursor"`
		}
		if json.Unmarshal(reply.Result, &listed) != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": sentence(errConnectorNoReply)})
			return
		}
		for _, tl := range listed.Tools {
			if tl.Name == "" {
				continue
			}
			schema := tl.InputSchema
			if !json.Valid(schema) || !strings.HasPrefix(strings.TrimSpace(string(schema)), "{") {
				schema = json.RawMessage(`{"type":"object"}`)
			}
			tools = append(tools, connectorTool{Name: tl.Name, Description: tl.Description, InputSchema: schema})
		}
		if cursor = listed.NextCursor; cursor == "" {
			break
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"server": server, "tools": tools})
}

// handleConnectorCall — POST /api/chat/connectors/call {"url", "token", "name", "arguments"}: one call the model made.
// What the tool answered, or why it could not, is what the model is told.
func (a *app) handleConnectorCall(w http.ResponseWriter, r *http.Request) {
	in, s, _, ok := a.readConnectorBody(w, r)
	if !ok {
		return
	}
	if in.Name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name required"})
		return
	}
	args := map[string]any{}
	if len(in.Arguments) > 0 && string(in.Arguments) != "null" {
		if err := json.Unmarshal(in.Arguments, &args); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "arguments must be a JSON object"})
			return
		}
	}
	reply, err := s.request(r.Context(), "tools/call", map[string]any{"name": in.Name, "arguments": args})
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": sentence(err)})
		return
	}
	if reply.Error != nil {
		writeJSON(w, http.StatusOK, chatToolResult{Text: reply.Error.Message, IsError: true})
		return
	}
	var result struct {
		Content []struct {
			Type     string `json:"type"`
			Text     string `json:"text"`
			Resource struct {
				URI  string `json:"uri"`
				Text string `json:"text"`
			} `json:"resource"`
		} `json:"content"`
		StructuredContent json.RawMessage `json:"structuredContent"`
		IsError           bool            `json:"isError"`
	}
	_ = json.Unmarshal(reply.Result, &result)
	var text []string
	for _, c := range result.Content {
		switch c.Type {
		case "text":
			text = append(text, c.Text)
		case "resource":
			if c.Resource.Text != "" {
				text = append(text, c.Resource.Text)
			} else {
				text = append(text, "[a resource: "+c.Resource.URI+"]")
			}
		case "image", "audio":
			text = append(text, "[an "+c.Type+", which Chat does not pass on]")
		}
	}
	if len(text) == 0 && len(result.StructuredContent) > 0 {
		text = append(text, string(result.StructuredContent))
	}
	writeJSON(w, http.StatusOK, chatToolResult{Text: strings.Join(text, "\n"), IsError: result.IsError})
}

// fingerprintOf is Talyvor test tools' fingerprint of a text: the first 12 hex digits of its SHA-256.
func fingerprintOf(text string) string {
	sum := sha256.Sum256([]byte(text))
	return hex.EncodeToString(sum[:])[:12]
}

// serveTestTools is Talyvor test tools: an MCP server with one tool, fingerprint, served to the relay in-process.
func serveTestTools(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID     json.RawMessage `json:"id"`
		Method string          `json:"method"`
		Params struct {
			ProtocolVersion string          `json:"protocolVersion"`
			Name            string          `json:"name"`
			Arguments       json.RawMessage `json:"arguments"`
		} `json:"params"`
	}
	if r.Method != http.MethodPost || json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in) != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"jsonrpc": "2.0", "id": nil, "error": map[string]any{"code": -32700, "message": "a JSON-RPC request is POSTed here"}})
		return
	}
	if len(in.ID) == 0 { // a notification
		w.WriteHeader(http.StatusAccepted)
		return
	}
	answer := func(result any) {
		writeJSON(w, http.StatusOK, map[string]any{"jsonrpc": "2.0", "id": in.ID, "result": result})
	}
	switch in.Method {
	case "initialize":
		answer(map[string]any{
			"protocolVersion": connectorProtocolVersion,
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]any{"name": testToolsName, "version": "1"},
		})
	case "ping":
		answer(map[string]any{})
	case "tools/list":
		answer(map[string]any{"tools": []any{map[string]any{
			"name":        "fingerprint",
			"description": "The fingerprint of a piece of text: the first 12 hex digits of its SHA-256. Only this tool can give it.",
			"inputSchema": map[string]any{
				"type":       "object",
				"properties": map[string]any{"text": map[string]any{"type": "string", "description": "The text to fingerprint, exactly."}},
				"required":   []string{"text"},
			},
			"annotations": map[string]any{"readOnlyHint": true},
		}}})
	case "tools/call":
		var args struct {
			Text *string `json:"text"`
		}
		_ = json.Unmarshal(in.Params.Arguments, &args)
		switch {
		case in.Params.Name != "fingerprint":
			writeJSON(w, http.StatusOK, map[string]any{"jsonrpc": "2.0", "id": in.ID, "error": map[string]any{"code": mcpInvalidParams, "message": "Talyvor test tools has no tool " + strconv.Quote(in.Params.Name)}})
		case args.Text == nil:
			answer(map[string]any{"content": []any{map[string]any{"type": "text", "text": "text is required: the text to fingerprint"}}, "isError": true})
		default:
			answer(map[string]any{"content": []any{map[string]any{"type": "text", "text": fingerprintOf(*args.Text)}}})
		}
	default:
		writeJSON(w, http.StatusOK, map[string]any{"jsonrpc": "2.0", "id": in.ID, "error": map[string]any{"code": mcpMethodNotFound, "message": "no such method: " + in.Method}})
	}
}
