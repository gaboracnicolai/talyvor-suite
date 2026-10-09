package main

import (
	"bufio"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// B28.447 — a Docs page shared as a link: making it reaches Docs as a view-only link whatever the browser asked for,
// and a stranger reads it with no credential at /api/public/docs/{token} and opens /docs/s/{token}; a token Docs
// refuses (one character changed) is 404 on both, and a malformed one never reaches Docs.
func TestDocsShareLink_ViewOnlyAndATamperedTokenIs404(t *testing.T) {
	const token = "s1_0123456789abcdef0123456789abcdef.c2lnbmF0dXJl"
	tampered := token[:len(token)-1] + "F"
	var mu sync.Mutex
	var public []string
	docs := &captureUpstream{}
	docs.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if strings.HasPrefix(r.URL.Path, "/v1/public/s/") {
			mu.Lock()
			public = append(public, r.URL.Path+" proof="+r.Header.Get("X-Gateway-Auth")+" email="+r.Header.Get("X-User-Email"))
			mu.Unlock()
			if r.URL.Path != "/v1/public/s/"+token {
				w.WriteHeader(http.StatusNotFound)
				_, _ = io.WriteString(w, `{"error":"link not found"}`)
				return
			}
			_, _ = io.WriteString(w, `{"page":{"id":"p1","title":"Runbook","content_text":"restart the queue"},"access":"view"}`)
			return
		}
		docs.path, docs.method, docs.headers = r.URL.Path, r.Method, r.Header.Clone()
		docs.reqBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusCreated)
		_, _ = io.WriteString(w, `{"link":{"id":"l1","token":"`+token+`","access":"view"},"share_url":"/s/`+token+`"}`)
	}))
	t.Cleanup(docs.srv.Close)
	a, sess := productApp(t, nil, docs)
	cfg := a.cfg
	cfg.webDist = t.TempDir()
	if err := os.WriteFile(filepath.Join(cfg.webDist, "index.html"), []byte("<!doctype html><div id=root></div>"), 0o644); err != nil {
		t.Fatal(err)
	}
	a = newApp(cfg, a.auth) // the app's page is read from webDist when the routes are made

	rec := cycleReq(t, a, sess, http.MethodPost, "/api/docs/spaces/s1/pages/p1/share", `{"access":"admin"}`)
	if rec.Code != http.StatusCreated || !strings.Contains(rec.Body.String(), token) {
		t.Fatalf("POST share = %d %s; want Docs' 201 with the token", rec.Code, rec.Body.String())
	}
	if docs.method != http.MethodPost || docs.path != "/v1/spaces/s1/pages/p1/share" || string(docs.reqBody) != `{"access":"view"}` {
		t.Fatalf("Docs got %s %s %s; want a view-only link on the page", docs.method, docs.path, docs.reqBody)
	}
	if docs.headers.Get("X-User-Email") == "" || docs.headers.Get("X-Gateway-Auth") != testDocsSecret {
		t.Fatal("the link was asked for without the transit proof and the session's identity, so Docs could not check Admin")
	}

	stranger := func(path string) int {
		rec := httptest.NewRecorder()
		a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		return rec.Code
	}
	for path, want := range map[string]int{
		"/api/public/docs/" + token:    http.StatusOK,
		"/docs/s/" + token:             http.StatusOK,
		"/api/public/docs/" + tampered: http.StatusNotFound,
		"/docs/s/" + tampered:          http.StatusNotFound,
		"/api/public/docs/x..y":        http.StatusNotFound,
		"/docs/s/short":                http.StatusNotFound,
	} {
		if got := stranger(path); got != want {
			t.Errorf("a stranger's GET %s = %d; want %d", path, got, want)
		}
	}
	mu.Lock()
	defer mu.Unlock()
	if len(public) != 4 {
		t.Errorf("Docs was asked %d times for a public link (%v); want 4 — a malformed token is refused before any dial", len(public), public)
	}
	for _, p := range public {
		if !strings.HasSuffix(p, " proof= email=") {
			t.Errorf("a public read carried a credential to Docs: %s", p)
		}
	}
}

// B28.447 — the collab socket: an upgrade from the app's origin reaches Docs' /v1/collab with the transit proof and
// the session's identity and none of the browser's cookies, and bytes then flow both ways; one from another origin is
// refused before any dial.
func TestDocsCollab_TheSocketReachesDocsOnlyFromTheAppOrigin(t *testing.T) {
	var mu sync.Mutex
	var got *http.Request
	docs := &captureUpstream{}
	docs.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		mu.Lock()
		got = r.Clone(r.Context())
		mu.Unlock()
		conn, rw, err := http.NewResponseController(w).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		defer conn.Close()
		_, _ = rw.WriteString("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
		_ = rw.Flush()
		line, _ := rw.ReadString('\n')
		_, _ = rw.WriteString("ack " + line)
		_ = rw.Flush()
	}))
	t.Cleanup(docs.srv.Close)
	a, sess := productApp(t, nil, docs)
	a.cfg.publicBaseURL = "https://app.example.com"
	bff := httptest.NewServer(a)
	t.Cleanup(bff.Close)

	upgrade := func(origin string) (*bufio.Reader, net.Conn, *http.Response) {
		t.Helper()
		conn, err := net.Dial("tcp", strings.TrimPrefix(bff.URL, "http://"))
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = conn.Close() })
		_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
		fmt.Fprintf(conn, "GET /api/docs/collab/p1/ws?client_id=c1&member_name=Ann HTTP/1.1\r\nHost: app.example.com\r\n"+
			"Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"+
			"Origin: %s\r\nCookie: %s=%s\r\n\r\n", origin, sess.Name, sess.Value)
		br := bufio.NewReader(conn)
		resp, err := http.ReadResponse(br, nil)
		if err != nil {
			t.Fatal(err)
		}
		return br, conn, resp
	}

	if _, _, resp := upgrade("https://evil.example"); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("a socket from another origin = %d; want 403", resp.StatusCode)
	}
	mu.Lock()
	if got != nil {
		t.Fatal("a socket from another origin reached Docs")
	}
	mu.Unlock()

	br, conn, resp := upgrade("https://app.example.com")
	if resp.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("a socket from the app = %d; want 101", resp.StatusCode)
	}
	fmt.Fprint(conn, "change 1\n")
	if line, _ := br.ReadString('\n'); line != "ack change 1\n" {
		t.Fatalf("Docs answered %q over the socket; want the frame echoed back through the BFF", line)
	}
	mu.Lock()
	defer mu.Unlock()
	if got.URL.Path != "/v1/collab/p1/ws" || got.URL.Query().Get("client_id") != "c1" || got.URL.Query().Get("member_name") != "Ann" {
		t.Errorf("Docs got %s; want /v1/collab/p1/ws with the client id and name", got.URL)
	}
	if got.Header.Get("X-Gateway-Auth") != testDocsSecret || got.Header.Get("X-User-Email") != "ng@example.com" {
		t.Errorf("Docs got proof %q and email %q; want the transit proof and the session's identity", got.Header.Get("X-Gateway-Auth"), got.Header.Get("X-User-Email"))
	}
	if got.Header.Get("Cookie") != "" || got.Header.Get("Origin") != "" {
		t.Errorf("the browser's cookie or origin reached Docs: %v", got.Header)
	}
	if got.Header.Get("Sec-WebSocket-Key") == "" || !strings.EqualFold(got.Header.Get("Upgrade"), "websocket") {
		t.Errorf("Docs got no WebSocket handshake: %v", got.Header)
	}
}
