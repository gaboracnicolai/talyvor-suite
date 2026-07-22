package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// testKey is a stand-in workspace key with the real tlv_ws_ shape. If a single byte of
// it ever appears in a response the proxy has failed at its one job.
const testKey = "tlv_ws_SECRET0000_must_never_reach_the_browser_0123456789"

// newTestApp wires the BFF against a fake Lens that records the inbound Authorization
// header and echoes a JSON body. The fake stands in for the real Lens on :8080.
func newTestApp(t *testing.T, gotAuth *string) *app {
	t.Helper()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if gotAuth != nil {
			*gotAuth = r.Header.Get("Authorization")
		}
		w.Header().Set("Content-Type", "application/json")
		// Echo the query so limit/offset sanitisation is observable in tests.
		_, _ = io.WriteString(w, `{"path":"`+r.URL.Path+`","query":"`+r.URL.RawQuery+`"}`)
	}))
	t.Cleanup(upstream.Close)
	return newApp(config{
		addr:         "127.0.0.1:0",
		lensBaseURL:  upstream.URL,
		workspaceKey: testKey,
		workspaceID:  "trial-ws-1",
		webDist:      t.TempDir(), // no bundle; SPA-specific tests set their own
		authMode:     authModeDisabled,
	}, nil)
}

// TestKeyNeverReachesResponse is THE assertion of this increment: the Lens key is
// attached to the upstream request server-side, and never appears in any response the
// browser would receive (body or headers), on any /api endpoint.
func TestKeyNeverReachesResponse(t *testing.T) {
	var gotAuth string
	a := newTestApp(t, &gotAuth)

	endpoints := []string{
		"/api/context",
		"/api/lxc/balance",
		"/api/tokens/balance",
		"/api/tokens/history?limit=5&offset=0",
		"/api/lxc/history?limit=5&offset=0",
		"/api/workspaces",
		"/api/bonds",
		"/api/track/workspaces", // unconfigured in disabled mode → 503, still swept
		"/api/docs/spaces",
		"/api/keys", // GET list only here — the POST mint has its own tight test
		"/api/spend/month",
		"/api/members",
	}
	for _, ep := range endpoints {
		rec := httptest.NewRecorder()
		a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, ep, nil))

		if strings.Contains(rec.Body.String(), testKey) {
			t.Fatalf("%s: the workspace key LEAKED into the response body", ep)
		}
		if strings.Contains(rec.Body.String(), "tlv_ws_") {
			t.Fatalf("%s: a tlv_ws_ token appeared in the response body", ep)
		}
		for name, vals := range rec.Header() {
			for _, v := range vals {
				if strings.Contains(v, testKey) || strings.Contains(v, "tlv_ws_") {
					t.Fatalf("%s: the workspace key LEAKED into response header %s", ep, name)
				}
			}
		}
	}

	// And the flip side: the upstream MUST have received the key — proving the proxy is
	// actually attaching it server-side, not simply dropping it.
	if gotAuth != "Bearer "+testKey {
		t.Fatalf("upstream did not receive the key server-side: got %q", gotAuth)
	}
}

// gatedApp points /api/bonds at an upstream that returns the given status/body, so the
// capability-gating translation can be exercised without the real Lens.
func gatedApp(t *testing.T, status int, body string) *app {
	t.Helper()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(upstream.Close)
	return newApp(config{lensBaseURL: upstream.URL, workspaceKey: testKey, workspaceID: "trial-ws-1", webDist: t.TempDir(), authMode: authModeDisabled}, nil)
}

// TestGatedCapabilityDisabled: a flag-off Lens route returns a generic 404 (indistinguishable
// from a real not-found). The BFF must translate that into an explicit "disabled" signal —
// a 200 the client can read as OFF — NOT pass a 404 the browser renders as a fault.
func TestGatedCapabilityDisabled(t *testing.T) {
	a := gatedApp(t, http.StatusNotFound, "404 page not found")
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/bonds", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("gated 404 must become 200 (a normal state), got %d", rec.Code)
	}
	var got struct {
		Capability string `json:"capability"`
		Enabled    bool   `json:"enabled"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("body is not the disabled envelope: %v (%s)", err, rec.Body.String())
	}
	if got.Enabled || got.Capability != "bonds" {
		t.Fatalf("expected {capability:bonds, enabled:false}, got %+v", got)
	}
}

// TestGatedCapabilityEnabled: when the capability is on, the upstream payload is wrapped in
// {enabled:true, data:<upstream>} so the client discriminates on `enabled`, never on shape.
func TestGatedCapabilityEnabled(t *testing.T) {
	a := gatedApp(t, http.StatusOK, `[{"id":"b1","kind":"reputation"}]`)
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/bonds", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("got %d", rec.Code)
	}
	var got struct {
		Enabled bool              `json:"enabled"`
		Data    []json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("body is not the enabled envelope: %v (%s)", err, rec.Body.String())
	}
	if !got.Enabled || len(got.Data) != 1 {
		t.Fatalf("expected {enabled:true, data:[1 bond]}, got %+v", got)
	}
}

// TestGatedRealErrorStillErrors: a genuine upstream failure (5xx) must NOT be laundered into
// "disabled" — only a 404 means disabled. Everything else stays an error.
func TestGatedRealErrorStillErrors(t *testing.T) {
	a := gatedApp(t, http.StatusInternalServerError, `{"error":"boom"}`)
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/bonds", nil))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("a real 500 must stay an error, got %d", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "\"enabled\":false") {
		t.Fatalf("a 500 must not be laundered into disabled: %s", rec.Body.String())
	}
}

// TestContextExposesWorkspaceNotKey checks /api/context returns the workspace coordinates
// the UI needs and nothing secret.
func TestContextExposesWorkspaceNotKey(t *testing.T) {
	a := newTestApp(t, nil)
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/context", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("context: got %d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "trial-ws-1") {
		t.Fatalf("context: missing workspace id: %s", body)
	}
	if strings.Contains(body, "tlv_ws_") {
		t.Fatalf("context: leaked a key: %s", body)
	}
}

// TestReadOnly proves the proxy refuses writes and only serves the endpoints it declares.
func TestReadOnly(t *testing.T) {
	a := newTestApp(t, nil)

	for _, m := range []string{http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodPatch} {
		rec := httptest.NewRecorder()
		a.ServeHTTP(rec, httptest.NewRequest(m, "/api/lxc/balance", nil))
		if rec.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s /api/lxc/balance: got %d, want 405", m, rec.Code)
		}
		if got := rec.Header().Get("Allow"); got != "GET" {
			t.Fatalf("%s: Allow header = %q, want GET", m, got)
		}
	}

	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/does-not-exist", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown /api path: got %d, want 404", rec.Code)
	}
}

// TestLimitOffsetSanitised proves that only limit/offset pass through, clamped, and no
// other client query parameter reaches Lens.
func TestLimitOffsetSanitised(t *testing.T) {
	a := newTestApp(t, nil)
	cases := []struct{ in, wantQuery string }{
		{"/api/tokens/history", "limit=20&offset=0"},                        // defaults
		{"/api/tokens/history?limit=5&offset=10", "limit=5&offset=10"},      // passthrough
		{"/api/tokens/history?limit=9999&offset=-4", "limit=200&offset=0"},  // clamped
		{"/api/tokens/history?limit=abc", "limit=20&offset=0"},              // junk → default
		{"/api/tokens/history?evil=DROP+TABLE&limit=3", "limit=3&offset=0"}, // extra param dropped
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, c.in, nil))
		body := rec.Body.String()
		if !strings.Contains(body, `"query":"`+c.wantQuery+`"`) {
			t.Fatalf("%s: upstream query = %s, want %s", c.in, body, c.wantQuery)
		}
		if strings.Contains(body, "evil") {
			t.Fatalf("%s: an extra client query parameter reached upstream: %s", c.in, body)
		}
	}
}

// TestUpstreamStatusPassthrough proves a stale/absent Lens endpoint surfaces honestly
// (the exact reason the running :latest image's 404 on /lxc/history is visible, not
// masked as a 200).
func TestUpstreamStatusPassthrough(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "404 page not found", http.StatusNotFound)
	}))
	t.Cleanup(upstream.Close)
	a := newApp(config{lensBaseURL: upstream.URL, workspaceKey: testKey, workspaceID: "trial-ws-1", webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/lxc/history", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("upstream 404 should pass through: got %d", rec.Code)
	}
}

// TestUpstreamUnreachable proves a dead Lens becomes a clean 502, not a panic or a leak.
func TestUpstreamUnreachable(t *testing.T) {
	a := newApp(config{
		lensBaseURL:  "http://127.0.0.1:1", // nothing listens
		workspaceKey: testKey,
		workspaceID:  "trial-ws-1",
		webDist:      t.TempDir(),
		authMode:     authModeDisabled,
	}, nil)
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/tokens/balance", nil))
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("dead upstream: got %d, want 502", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "tlv_ws_") {
		t.Fatalf("error path leaked a key: %s", rec.Body.String())
	}
}

// TestSPAFallback proves same-origin app serving: real files are served, and unknown
// non-/api paths fall back to index.html so client routes survive a hard refresh.
func TestSPAFallback(t *testing.T) {
	dist := t.TempDir()
	if err := os.WriteFile(filepath.Join(dist, "index.html"), []byte("<!doctype html><title>app</title>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dist, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dist, "assets", "app.js"), []byte("console.log(1)"), 0o644); err != nil {
		t.Fatal(err)
	}
	a := newApp(config{lensBaseURL: "http://127.0.0.1:1", workspaceKey: testKey, workspaceID: "trial-ws-1", webDist: dist, authMode: authModeDisabled}, nil)

	// A real asset is served as itself.
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/assets/app.js", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "console.log") {
		t.Fatalf("asset: got %d %q", rec.Code, rec.Body.String())
	}

	// A client route falls back to index.html.
	rec = httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/ledger", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "<title>app</title>") {
		t.Fatalf("client route fallback: got %d %q", rec.Code, rec.Body.String())
	}
}

// TestRequireLoopback is the start-up guard: loopback binds are allowed, everything else
// is refused. This is what makes "no auth yet" safe.
func TestRequireLoopback(t *testing.T) {
	ok := []string{"127.0.0.1:8787", "localhost:8787", "[::1]:8787", "127.9.9.9:1"}
	for _, addr := range ok {
		if err := requireLoopback(addr); err != nil {
			t.Errorf("requireLoopback(%q) = %v, want nil", addr, err)
		}
	}
	bad := []string{"0.0.0.0:8787", ":8787", "192.168.1.10:8787", "10.0.0.1:8787", "example.com:8787", "[::]:8787"}
	for _, addr := range bad {
		if err := requireLoopback(addr); err == nil {
			t.Errorf("requireLoopback(%q) = nil, want refusal", addr)
		}
	}
}

// TestLoadConfigFailClosed proves the process refuses to start without a key or workspace.
func TestLoadConfigFailClosed(t *testing.T) {
	for _, k := range []string{"BFF_ADDR", "LENS_BASE_URL", "LENS_WORKSPACE_KEY", "LENS_WORKSPACE_ID", "WEB_DIST"} {
		t.Setenv(k, "")
	}
	if _, err := loadConfig(); err == nil {
		t.Fatal("loadConfig with no key should fail")
	}
	t.Setenv("LENS_WORKSPACE_KEY", testKey)
	if _, err := loadConfig(); err == nil {
		t.Fatal("loadConfig with no workspace id should fail")
	}
	t.Setenv("LENS_WORKSPACE_ID", "trial-ws-1")
	t.Setenv("BFF_ADDR", "0.0.0.0:8787")
	if _, err := loadConfig(); err == nil {
		t.Fatal("loadConfig with a non-loopback bind should fail")
	}
	t.Setenv("BFF_ADDR", "127.0.0.1:8787")
	// inc5: an auth mode is now REQUIRED — key+id+loopback alone no longer boots.
	if _, err := loadConfig(); err == nil {
		t.Fatal("loadConfig without BFF_AUTH_MODE should fail (silence is not a mode)")
	}
	t.Setenv("BFF_AUTH_MODE", "disabled")
	if _, err := loadConfig(); err != nil {
		t.Fatalf("loadConfig with key+id+loopback+mode should succeed: %v", err)
	}
}

// TestLoadConfigLensBaseURLTransport proves LENS_BASE_URL obeys the same
// transport rule as the OIDC URLs (https anywhere; http only on loopback, for
// dev). The workspace key rides EVERY upstream request as a bearer header, so
// a remote http URL would put the credential on the wire in clear — that must
// be a boot refusal, not a footnote in the deploy docs.
func TestLoadConfigLensBaseURLTransport(t *testing.T) {
	cases := []struct {
		name    string
		lensURL string
		wantErr string
	}{
		{
			name:    "remote http refuses — the key would travel in clear",
			lensURL: "http://lens.internal:8080",
			wantErr: "LENS_BASE_URL",
		},
		{name: "loopback http boots (dev)", lensURL: "http://127.0.0.1:8080"},
		{name: "localhost http boots (dev)", lensURL: "http://localhost:8080"},
		{name: "https boots anywhere", lensURL: "https://lens.example.com"},
		{name: "unset boots — the default is loopback dev", lensURL: ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			clearBFFEnv(t, map[string]string{
				"LENS_WORKSPACE_KEY": testKey,
				"LENS_WORKSPACE_ID":  "trial-ws-1",
				"BFF_AUTH_MODE":      "disabled",
				"LENS_BASE_URL":      c.lensURL,
			})
			_, err := loadConfig()
			if c.wantErr == "" {
				if err != nil {
					t.Fatalf("want success, got: %v", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("want error containing %q, got success", c.wantErr)
			}
			if !strings.Contains(err.Error(), c.wantErr) {
				t.Fatalf("want error containing %q, got: %v", c.wantErr, err)
			}
		})
	}
}
