package main

// Increment 6: the BFF speaks to Track and Docs. Both gate /v1 behind
// gatewayauth (their internal/gatewayauth, byte-similar packages): a request
// must carry X-Gateway-Auth equal to their GATEWAY_AUTH_SECRET (constant-time
// compared) BEFORE any identity header is trusted; then X-User-Email is the
// workspace-membership join key, X-User-Id the auth-system sub, X-Auth-Iss the
// issuer. The BFF plays the gateway's role for its session-authenticated user:
// it attaches the transit proof AND the session's identity SERVER-SIDE. No
// credential of any kind may reach the browser — same principle, same
// assertion shape as the Lens key.

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Distinctive secret shapes so a leak sweep can hunt the prefix, exactly like
// tlv_ws_ for the Lens key.
const (
	testTrackSecret = "gwsecret_track_MUST_NEVER_REACH_THE_BROWSER_5555"
	testDocsSecret  = "gwsecret_docs_MUST_NEVER_REACH_THE_BROWSER_7777"
)

// TestLoadConfigProductMatrix: Track/Docs upstream config is fail-closed —
// half-configured pairs refuse to boot, and configuring either product at all
// requires oidc mode, because the BFF forwards the IDENTITY it authenticated;
// in disabled mode it would be fabricating the very headers the transit proof
// exists to protect.
func TestLoadConfigProductMatrix(t *testing.T) {
	cases := []struct {
		name    string
		env     map[string]string
		wantErr string
	}{
		{
			name: "track triple on oidc boots",
			env: with(with(with(validOIDCEnv(),
				"TRACK_BASE_URL", "http://127.0.0.1:8081"),
				"TRACK_GATEWAY_SECRET", testTrackSecret),
				"TRACK_WORKSPACE_ID", "track-ws-7"),
		},
		{
			// inc "shared-unblock": /api/members pins its upstream path to a
			// CONFIGURED Track workspace, exactly like DOCS_WORKSPACE_ID.
			name: "track pair without workspace id refuses",
			env: with(with(validOIDCEnv(),
				"TRACK_BASE_URL", "http://127.0.0.1:8081"),
				"TRACK_GATEWAY_SECRET", testTrackSecret),
			wantErr: "TRACK_WORKSPACE_ID",
		},
		{
			name:    "track base URL without secret refuses",
			env:     with(validOIDCEnv(), "TRACK_BASE_URL", "http://127.0.0.1:8081"),
			wantErr: "TRACK_GATEWAY_SECRET",
		},
		{
			name:    "track secret without base URL refuses",
			env:     with(validOIDCEnv(), "TRACK_GATEWAY_SECRET", testTrackSecret),
			wantErr: "TRACK_BASE_URL",
		},
		{
			name: "docs triple on oidc boots",
			env: with(with(with(validOIDCEnv(),
				"DOCS_BASE_URL", "http://127.0.0.1:8082"),
				"DOCS_GATEWAY_SECRET", testDocsSecret),
				"DOCS_WORKSPACE_ID", "docs-ws-9"),
		},
		{
			name: "docs pair without workspace id refuses",
			env: with(with(validOIDCEnv(),
				"DOCS_BASE_URL", "http://127.0.0.1:8082"),
				"DOCS_GATEWAY_SECRET", testDocsSecret),
			wantErr: "DOCS_WORKSPACE_ID",
		},
		{
			name:    "docs secret alone refuses",
			env:     with(validOIDCEnv(), "DOCS_GATEWAY_SECRET", testDocsSecret),
			wantErr: "DOCS_BASE_URL",
		},
		{
			// Identity forwarding requires an authenticated identity to forward.
			name: "track triple in disabled mode refuses",
			env: map[string]string{
				"LENS_WORKSPACE_KEY": testKey, "LENS_WORKSPACE_ID": "trial-ws-1",
				"BFF_AUTH_MODE":        "disabled",
				"TRACK_BASE_URL":       "http://127.0.0.1:8081",
				"TRACK_GATEWAY_SECRET": testTrackSecret,
				"TRACK_WORKSPACE_ID":   "track-ws-7",
			},
			wantErr: "oidc",
		},
		{
			name: "docs triple in disabled mode refuses",
			env: map[string]string{
				"LENS_WORKSPACE_KEY": testKey, "LENS_WORKSPACE_ID": "trial-ws-1",
				"BFF_AUTH_MODE":       "disabled",
				"DOCS_BASE_URL":       "http://127.0.0.1:8082",
				"DOCS_GATEWAY_SECRET": testDocsSecret,
				"DOCS_WORKSPACE_ID":   "docs-ws-9",
			},
			wantErr: "oidc",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			clearProductEnv(t, c.env)
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

// clearProductEnv is clearBFFEnv plus the product upstream variables.
func clearProductEnv(t *testing.T, overrides map[string]string) {
	t.Helper()
	clearBFFEnv(t, nil)
	for _, k := range []string{
		"TRACK_BASE_URL", "TRACK_GATEWAY_SECRET", "TRACK_WORKSPACE_ID",
		"DOCS_BASE_URL", "DOCS_GATEWAY_SECRET", "DOCS_WORKSPACE_ID",
	} {
		t.Setenv(k, "")
	}
	for k, v := range overrides {
		t.Setenv(k, v)
	}
}

// captureUpstream is a fake Track/Docs: records the exact headers and path of
// the last request and answers a fixed JSON body.
type captureUpstream struct {
	srv     *httptest.Server
	path    string
	headers http.Header
}

func newCaptureUpstream(t *testing.T, body string) *captureUpstream {
	t.Helper()
	c := &captureUpstream{}
	c.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c.path = r.URL.Path
		c.headers = r.Header.Clone()
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(c.srv.Close)
	return c
}

// productApp builds an oidc-mode app (session store only — no live IdP needed)
// with Track and Docs pointed at capture upstreams, and one seeded session.
func productApp(t *testing.T, track, docs *captureUpstream) (*app, *http.Cookie) {
	t.Helper()
	cfg := config{
		lensBaseURL: "http://127.0.0.1:1", workspaceKey: testKey, workspaceID: "trial-ws-1",
		authMode: authModeOIDC, oidcIssuer: "https://idp.example.com", sessionTTL: time.Hour,
	}
	if track != nil {
		cfg.trackBaseURL = track.srv.URL
		cfg.trackGatewaySecret = testTrackSecret
	}
	if docs != nil {
		cfg.docsBaseURL = docs.srv.URL
		cfg.docsGatewaySecret = testDocsSecret
		cfg.docsWorkspaceID = "docs-ws-9"
	}
	auth := newSessionOnlyAuthenticator(cfg)
	auth.sessions.put("prod-sid", session{sub: "user-123", email: "ng@example.com", expires: time.Now().Add(time.Hour)})
	a := newApp(cfg, auth)
	a.cfg.webDist = t.TempDir()
	return a, &http.Cookie{Name: sessionCookieName, Value: "prod-sid"}
}

// TestTrackProxyAttachesGatewayCredentials: the BFF acts as the gateway for its
// authenticated user — transit proof + identity headers attached server-side,
// upstream body streamed back, and the secret never in the response.
func TestTrackProxyAttachesGatewayCredentials(t *testing.T) {
	track := newCaptureUpstream(t, `[{"id":"ws-t1","name":"Talyvor"}]`)
	a, sess := productApp(t, track, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/track/workspaces", nil)
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("got %d (%s), want 200", rec.Code, rec.Body.String())
	}
	if track.path != "/v1/workspaces" {
		t.Fatalf("upstream path = %q, want /v1/workspaces", track.path)
	}
	if got := track.headers.Get("X-Gateway-Auth"); got != testTrackSecret {
		t.Fatalf("X-Gateway-Auth = %q — the transit proof must be attached server-side", got)
	}
	if got := track.headers.Get("X-User-Email"); got != "ng@example.com" {
		t.Fatalf("X-User-Email = %q, want the session's email", got)
	}
	if got := track.headers.Get("X-User-Id"); got != "user-123" {
		t.Fatalf("X-User-Id = %q, want the session's sub", got)
	}
	if got := track.headers.Get("X-Auth-Iss"); got != "https://idp.example.com" {
		t.Fatalf("X-Auth-Iss = %q, want the configured issuer", got)
	}
	if !strings.Contains(rec.Body.String(), "ws-t1") {
		t.Fatalf("upstream body not streamed: %s", rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "gwsecret_") {
		t.Fatalf("gateway secret leaked into the response: %s", rec.Body.String())
	}
}

// TestDocsProxyPinsWorkspaceAndAttachesCredentials: same contract for Docs, and
// the upstream path is built from the CONFIGURED workspace id — never client input.
func TestDocsProxyPinsWorkspaceAndAttachesCredentials(t *testing.T) {
	docs := newCaptureUpstream(t, `[{"id":"sp-1","name":"Handbook"}]`)
	a, sess := productApp(t, nil, docs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/docs/spaces?workspace_id=SOMEBODY-ELSE", nil)
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("got %d (%s), want 200", rec.Code, rec.Body.String())
	}
	if docs.path != "/v1/workspaces/docs-ws-9/spaces" {
		t.Fatalf("upstream path = %q — must be pinned to the CONFIGURED docs workspace", docs.path)
	}
	if got := docs.headers.Get("X-Gateway-Auth"); got != testDocsSecret {
		t.Fatalf("X-Gateway-Auth = %q", got)
	}
	if got := docs.headers.Get("X-User-Email"); got != "ng@example.com" {
		t.Fatalf("X-User-Email = %q", got)
	}
}

// TestProductUpstreamsUnconfigured503: routes exist even when the upstream is
// not configured, and say so explicitly — never a silent empty result.
func TestProductUpstreamsUnconfigured503(t *testing.T) {
	a, sess := productApp(t, nil, nil)
	for _, ep := range []string{"/api/track/workspaces", "/api/docs/spaces"} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, ep, nil)
		req.AddCookie(sess)
		a.ServeHTTP(rec, req)
		if rec.Code != http.StatusServiceUnavailable {
			t.Errorf("%s unconfigured: got %d (%s), want 503", ep, rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "not configured") {
			t.Errorf("%s: body must say the upstream is not configured: %s", ep, rec.Body.String())
		}
	}
}

// TestProductRoutesRequireSession: the new routes sit behind requireSession
// exactly like the existing eight.
func TestProductRoutesRequireSession(t *testing.T) {
	track := newCaptureUpstream(t, `[]`)
	docs := newCaptureUpstream(t, `[]`)
	a, _ := productApp(t, track, docs)
	for _, ep := range []string{"/api/track/workspaces", "/api/docs/spaces"} {
		rec := httptest.NewRecorder()
		a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, ep, nil))
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s without session: got %d, want 401", ep, rec.Code)
		}
	}
	if track.headers != nil || docs.headers != nil {
		t.Fatal("an unauthenticated request must never reach a product upstream")
	}
}

// TestGatewaySecretsNeverReachResponse is the inc2 assertion extended to the
// product secrets: with a live session and configured upstreams, no response —
// body or header — on ANY endpoint contains either gateway secret (or the Lens
// key), and the flip side: the upstreams DID receive their secrets.
func TestGatewaySecretsNeverReachResponse(t *testing.T) {
	track := newCaptureUpstream(t, `[{"id":"ws-t1"}]`)
	docs := newCaptureUpstream(t, `[{"id":"sp-1"}]`)
	a, sess := productApp(t, track, docs)

	endpoints := []string{
		"/api/context", "/api/lxc/balance", "/api/tokens/balance",
		"/api/tokens/history", "/api/lxc/history", "/api/workspaces", "/api/bonds",
		"/api/track/workspaces", "/api/docs/spaces", "/auth/me",
		"/api/keys", "/api/members", "/api/spend/month", // GET sweeps; the POST mint is deliberately absent — see keys_test.go
	}
	for _, ep := range endpoints {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, ep, nil)
		req.AddCookie(sess)
		a.ServeHTTP(rec, req)
		body := rec.Body.String()
		for _, needle := range []string{testKey, "tlv_ws_", testTrackSecret, testDocsSecret, "gwsecret_"} {
			if strings.Contains(body, needle) {
				t.Fatalf("%s: secret %q reached the response body", ep, needle[:12])
			}
		}
		for name, vals := range rec.Header() {
			for _, v := range vals {
				for _, needle := range []string{testKey, testTrackSecret, testDocsSecret} {
					if strings.Contains(v, needle) {
						t.Fatalf("%s: a secret reached response header %s", ep, name)
					}
				}
			}
		}
	}
	if track.headers.Get("X-Gateway-Auth") != testTrackSecret {
		t.Fatal("track upstream never received its transit proof")
	}
	if docs.headers.Get("X-Gateway-Auth") != testDocsSecret {
		t.Fatal("docs upstream never received its transit proof")
	}
}
