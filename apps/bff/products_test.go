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
	"encoding/json"
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
			name: "track PAIR on oidc boots — TRACK_WORKSPACE_ID is no longer part of it",
			env: with(with(validOIDCEnv(),
				"TRACK_BASE_URL", "http://127.0.0.1:8081"),
				"TRACK_GATEWAY_SECRET", testTrackSecret),
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
			env: with(with(validOIDCEnv(),
				"DOCS_BASE_URL", "http://127.0.0.1:8082"),
				"DOCS_GATEWAY_SECRET", testDocsSecret),
		},
		{
			// DOCS_WORKSPACE_ID is gone — the workspace comes from the session — so the pair rule
			// is now two variables, not three, and a lone base URL is what refuses.
			name: "docs base url without the gateway secret refuses",
			env: with(validOIDCEnv(),
				"DOCS_BASE_URL", "http://127.0.0.1:8082"),
			wantErr: "DOCS_GATEWAY_SECRET",
		},
		{
			name:    "docs secret alone refuses",
			env:     with(validOIDCEnv(), "DOCS_GATEWAY_SECRET", testDocsSecret),
			wantErr: "DOCS_BASE_URL",
		},
		{
			// The gateway secret rides every request as X-Gateway-Auth — the same
			// transport rule as LENS_BASE_URL: https anywhere, http only loopback.
			name: "track remote http base URL refuses — the secret would travel in clear",
			env: with(with(validOIDCEnv(),
				"TRACK_BASE_URL", "http://track.internal:8081"),
				"TRACK_GATEWAY_SECRET", testTrackSecret),
			wantErr: "TRACK_BASE_URL",
		},
		{
			name: "track https base URL boots",
			env: with(with(validOIDCEnv(),
				"TRACK_BASE_URL", "https://track.example.com"),
				"TRACK_GATEWAY_SECRET", testTrackSecret),
		},
		{
			name: "docs remote http base URL refuses — the secret would travel in clear",
			env: with(with(validOIDCEnv(),
				"DOCS_BASE_URL", "http://docs.internal:8082"),
				"DOCS_GATEWAY_SECRET", testDocsSecret),
			wantErr: "DOCS_BASE_URL",
		},
		{
			// Identity forwarding requires an authenticated identity to forward.
			name: "track pair in disabled mode refuses",
			env: map[string]string{
				"LENS_PROVISION_SECRET": testProvisionSecret,
				"BFF_AUTH_MODE":         "disabled",
				"TRACK_BASE_URL":        "http://127.0.0.1:8081",
				"TRACK_GATEWAY_SECRET":  testTrackSecret,
			},
			wantErr: "oidc",
		},
		{
			name: "docs triple in disabled mode refuses",
			env: map[string]string{
				"LENS_PROVISION_SECRET": testProvisionSecret,
				"BFF_AUTH_MODE":         "disabled",
				"DOCS_BASE_URL":         "http://127.0.0.1:8082",
				"DOCS_GATEWAY_SECRET":   testDocsSecret,
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
		// TRACK_WORKSPACE_ID is no longer read (Track is per-session), but it is still cleared:
		// a developer with it exported must not get different behaviour from CI.
		"TRACK_BASE_URL", "TRACK_GATEWAY_SECRET", "TRACK_WORKSPACE_ID",
		"DOCS_BASE_URL", "DOCS_GATEWAY_SECRET", "DOCS_WORKSPACE_ID",
	} {
		t.Setenv(k, "")
	}
	for k, v := range overrides {
		t.Setenv(k, v)
	}
}

// captureUpstream is a fake Track/Docs: records the exact headers, path and query
// of the last request and answers a fixed JSON body (200 by default).
type captureUpstream struct {
	srv      *httptest.Server
	path     string
	rawQuery string
	headers  http.Header
	// reqBody is what the BFF actually SENT upstream. Every other field describes the envelope;
	// on a write route the body IS the contract, and asserting a 200 came back says nothing about
	// what was written.
	reqBody []byte
}

func newCaptureUpstream(t *testing.T, body string) *captureUpstream {
	return newStatusUpstream(t, http.StatusOK, body)
}

// newStatusUpstream is captureUpstream with a chosen status — for the routes whose
// contract turns on the upstream code (a 404 that must stay a 404, not become "off").
func newStatusUpstream(t *testing.T, status int, body string) *captureUpstream {
	t.Helper()
	c := &captureUpstream{}
	c.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		c.path = r.URL.Path
		c.rawQuery = r.URL.RawQuery
		c.headers = r.Header.Clone()
		c.reqBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
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
		lensBaseURL: "http://127.0.0.1:1", provisionSecret: testProvisionSecret,
		authMode: authModeOIDC, oidcIssuer: "https://idp.example.com", sessionTTL: time.Hour,
	}
	if track != nil {
		cfg.trackBaseURL = track.srv.URL
		cfg.trackGatewaySecret = testTrackSecret
		// A PAIR now, not a triple: TRACK_WORKSPACE_ID is gone. Track's workspace comes from
		// the session, seeded below — see track_tenant.go.
	}
	if docs != nil {
		cfg.docsBaseURL = docs.srv.URL
		cfg.docsGatewaySecret = testDocsSecret
		// DOCS NOW DEPENDS ON TRACK. The Docs workspace comes from the session, which Track
		// bootstraps at login — Docs derives its tenancy from Track upstream too (it enumerates
		// workspaces from GET /v1/service/workspaces). A Docs-only deployment cannot resolve a
		// workspace, so these harnesses point Track at the same capture server when the test only
		// cares about Docs.
		if cfg.trackBaseURL == "" {
			cfg.trackBaseURL = docs.srv.URL
			cfg.trackGatewaySecret = testTrackSecret
		}
	}
	auth := newSessionOnlyAuthenticator(cfg)
	seedProvisionedSession(auth, "prod-sid", "user-123", "ng@example.com", "u-test-workspace")
	if track != nil || docs != nil {
		// The session's Track workspace, as a completed login leaves it. DOCS NEEDS IT TOO now:
		// its workspace is the session's, which Track mints — so a Docs test without one would be
		// exercising the bootstrap-retry path rather than the route under test.
		s, _ := auth.sessions.get("prod-sid")
		s.trackWorkspaceID = "track-ws-7"
		auth.sessions.put("prod-sid", s)
	}
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
func TestDocsProxyScopesToTheSessionWorkspaceAndAttachesCredentials(t *testing.T) {
	docs := newCaptureUpstream(t, `[{"id":"sp-1","name":"Handbook"}]`)
	a, sess := productApp(t, nil, docs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/docs/spaces?workspace_id=SOMEBODY-ELSE", nil)
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("got %d (%s), want 200", rec.Code, rec.Body.String())
	}
	if docs.path != "/v1/workspaces/track-ws-7/spaces" {
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
		// Docs Tier-1 id-routes: the never-leaks guarantee covers them too.
		"/api/docs/spaces/sp-1", "/api/docs/spaces/sp-1/pages", "/api/docs/spaces/sp-1/pages/pg-1",
		// Track Tier-1 routes (this PR): same guarantee, same sweep.
		"/api/track/issues", "/api/track/issues/isu-1", "/api/track/issues/isu-1/comments", "/api/track/teams",
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

// ─── Docs Tier-1 id-routes (this PR) ──────────────────────────────────────────
// Space detail, page list, page detail. Same non-negotiables as every product
// route: requireSession, transit proof + session identity attached server-side,
// upstream path built from the id (never the workspace from client input), no
// secret in any response. Plus two things specific to id-routes: a genuine 404
// stays a 404 (NOT laundered to "disabled"), and the page LIST projects away the
// heavy content fields a tree view never needs.

// TestDocsSpaceDetail_BuildsUpstreamPath: GET /api/docs/spaces/{id} →
// GET /v1/spaces/{id} (no workspace in the path — upstream scopes by membership),
// credentials attached server-side, body streamed, secret absent.
func TestDocsSpaceDetail_BuildsUpstreamPath(t *testing.T) {
	docs := newCaptureUpstream(t, `{"id":"sp-1","name":"Handbook"}`)
	a, sess := productApp(t, nil, docs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/docs/spaces/sp-1", nil)
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("got %d (%s), want 200", rec.Code, rec.Body.String())
	}
	if docs.path != "/v1/workspaces/track-ws-7/spaces/sp-1" {
		t.Fatalf("upstream path = %q, want /v1/spaces/sp-1", docs.path)
	}
	if got := docs.headers.Get("X-Gateway-Auth"); got != testDocsSecret {
		t.Fatalf("X-Gateway-Auth = %q — transit proof must be attached server-side", got)
	}
	if got := docs.headers.Get("X-User-Email"); got != "ng@example.com" {
		t.Fatalf("X-User-Email = %q, want the session email", got)
	}
	if !strings.Contains(rec.Body.String(), "Handbook") {
		t.Fatalf("upstream body not streamed: %s", rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "gwsecret_") {
		t.Fatalf("gateway secret leaked: %s", rec.Body.String())
	}
}

// TestDocsPageDetail_BuildsNestedPathAndStreamsFullContent: page detail needs BOTH
// ids (there is no top-level /v1/pages/{id} upstream); the full page content is
// served here verbatim — this is the route that legitimately carries the document.
func TestDocsPageDetail_BuildsNestedPathAndStreamsFullContent(t *testing.T) {
	docs := newCaptureUpstream(t, `{"id":"pg-1","title":"Home","content":"{\"type\":\"doc\"}"}`)
	a, sess := productApp(t, nil, docs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/docs/spaces/sp-1/pages/pg-1", nil)
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("got %d (%s), want 200", rec.Code, rec.Body.String())
	}
	if docs.path != "/v1/workspaces/track-ws-7/spaces/sp-1/pages/pg-1" {
		t.Fatalf("upstream path = %q, want /v1/spaces/sp-1/pages/pg-1", docs.path)
	}
	if !strings.Contains(rec.Body.String(), `"content"`) {
		t.Fatalf("page DETAIL must carry full content verbatim: %s", rec.Body.String())
	}
	if got := docs.headers.Get("X-Gateway-Auth"); got != testDocsSecret {
		t.Fatalf("X-Gateway-Auth = %q", got)
	}
}

// TestDocsPageList_ProjectsContentAway: the upstream ships every row's full
// ProseMirror `content` (+ `content_text`); the BFF strips BOTH for the list so a
// tree view doesn't transfer whole documents, while preserving every other field.
func TestDocsPageList_ProjectsContentAway(t *testing.T) {
	body := `[{"id":"pg-1","title":"Home","depth":0,"position":1,` +
		`"content":"{\"type\":\"doc\",\"BIGDOC\":true}","content_text":"BIGPLAINTEXT"},` +
		`{"id":"pg-2","title":"Sub","depth":1,"position":2,"content":"MORE","content_text":"MORE"}]`
	docs := newCaptureUpstream(t, body)
	a, sess := productApp(t, nil, docs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/docs/spaces/sp-1/pages?limit=50", nil)
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("got %d (%s), want 200", rec.Code, rec.Body.String())
	}
	if docs.path != "/v1/workspaces/track-ws-7/spaces/sp-1/pages" {
		t.Fatalf("upstream path = %q, want /v1/spaces/sp-1/pages", docs.path)
	}
	if !strings.Contains(docs.rawQuery, "limit=50") {
		t.Fatalf("limit not forwarded: rawQuery=%q", docs.rawQuery)
	}
	out := rec.Body.String()
	// The heavy fields are gone…
	if strings.Contains(out, `"content"`) || strings.Contains(out, "content_text") ||
		strings.Contains(out, "BIGDOC") || strings.Contains(out, "BIGPLAINTEXT") || strings.Contains(out, "MORE") {
		t.Fatalf("list still ships page content: %s", out)
	}
	// …but the tree fields survive.
	for _, keep := range []string{"pg-1", "pg-2", "Home", "Sub", `"depth"`, `"position"`} {
		if !strings.Contains(out, keep) {
			t.Fatalf("list dropped a tree field %q: %s", keep, out)
		}
	}
}

// TestDocsPageList_CapsLimitAt500 mirrors the upstream store's own cap so the BFF
// never asks for an unbounded list.
func TestDocsPageList_CapsLimitAt500(t *testing.T) {
	docs := newCaptureUpstream(t, `[]`)
	a, sess := productApp(t, nil, docs)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/docs/spaces/sp-1/pages?limit=99999", nil)
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)
	if !strings.Contains(docs.rawQuery, "limit=500") {
		t.Fatalf("limit not capped at 500: rawQuery=%q", docs.rawQuery)
	}
}

// TestDocs404StaysNotFound is the case proxyGated's doc comment warned about: these
// routes take ids, so a genuine not-found must surface as 404 — NOT be laundered
// into a 200 {enabled:false}. The plain proxy path preserves the upstream status.
func TestDocs404StaysNotFound(t *testing.T) {
	docs := newStatusUpstream(t, http.StatusNotFound, `{"error":"not found","code":"PAGE_NOT_FOUND"}`)
	a, sess := productApp(t, nil, docs)
	for _, ep := range []string{"/api/docs/spaces/sp-x", "/api/docs/spaces/sp-1/pages/pg-x"} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, ep, nil)
		req.AddCookie(sess)
		a.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("%s: got %d, want 404 (a real not-found must NOT become 'disabled')", ep, rec.Code)
		}
		if strings.Contains(rec.Body.String(), "enabled") {
			t.Fatalf("%s: 404 laundered into a capability signal: %s", ep, rec.Body.String())
		}
	}
}

// TestDocs403StaysForbidden: a workspace member lacking the space tier gets the
// upstream 403 honestly (the area distinguishes it), never masked.
func TestDocs403StaysForbidden(t *testing.T) {
	docs := newStatusUpstream(t, http.StatusForbidden, `{"error":"forbidden","code":"TIER"}`)
	a, sess := productApp(t, nil, docs)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/docs/spaces/sp-1", nil)
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("got %d, want 403 passed through", rec.Code)
	}
}

// TestDocsPathParamRejectsTraversal: the id segments are client input; a traversal
// or slash-bearing id is refused at the BFF and never reaches the upstream, so the
// pinned upstream path can't be rewritten.
func TestDocsPathParamRejectsTraversal(t *testing.T) {
	docs := newCaptureUpstream(t, `{}`)
	a, sess := productApp(t, nil, docs)
	// %2e%2e%2f = "../" — if it survived decoding into the upstream path it would escape.
	for _, ep := range []string{
		"/api/docs/spaces/%2e%2e",
		"/api/docs/spaces/sp-1/pages/%2e%2e%2fadmin",
	} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, ep, nil)
		req.AddCookie(sess)
		a.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: got %d, want 400 (a traversal id must be refused)", ep, rec.Code)
		}
	}
	if docs.headers != nil {
		t.Fatal("a rejected id must never reach the docs upstream")
	}
}

// TestDocsIdRoutesRequireSession: the three id-routes sit behind requireSession
// exactly like the collection routes.
func TestDocsIdRoutesRequireSession(t *testing.T) {
	docs := newCaptureUpstream(t, `{}`)
	a, _ := productApp(t, nil, docs)
	for _, ep := range []string{
		"/api/docs/spaces/sp-1", "/api/docs/spaces/sp-1/pages", "/api/docs/spaces/sp-1/pages/pg-1",
	} {
		rec := httptest.NewRecorder()
		a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, ep, nil))
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s without session: got %d, want 401", ep, rec.Code)
		}
	}
	if docs.headers != nil {
		t.Fatal("an unauthenticated request must never reach the docs upstream")
	}
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// CREATE SPACE — the route that made the product reachable.
//
// GET-only on /api/docs/spaces meant a workspace with zero spaces was a dead end: every create-page
// form lives inside a space, so with none there was no way in. These pin the two things a create
// form cannot verify for itself — where the request goes, and whose workspace it lands in.
// ────────────────────────────────────────────────────────────────────────────────────────────────

// TestDocsCreateSpace_PostsToTheCreateRouteWithTheSessionWorkspace: Docs registers create as
// POST /v1/spaces and reads the workspace from the BODY — it is NOT under /workspaces/{wsID} like
// the list. Sending it to the list path would 405 upstream and create nothing.
func TestDocsCreateSpace_PostsToTheCreateRouteWithTheSessionWorkspace(t *testing.T) {
	docs := newStatusUpstream(t, http.StatusCreated, `{"id":"sp-1","name":"Engineering"}`)
	a, sess := productApp(t, nil, docs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/docs/spaces", strings.NewReader(`{"name":"Engineering"}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("got %d (%s), want 201", rec.Code, rec.Body.String())
	}
	if docs.path != "/v1/spaces" {
		t.Fatalf("upstream path = %q, want /v1/spaces — the list path does not create", docs.path)
	}
	var sent map[string]any
	if err := json.Unmarshal(docs.reqBody, &sent); err != nil {
		t.Fatalf("forwarded body is not JSON (%v): %s", err, docs.reqBody)
	}
	if sent["workspace_id"] != "track-ws-7" {
		t.Fatalf("workspace_id = %v, want the SESSION's track-ws-7", sent["workspace_id"])
	}
	// The name must survive verbatim: Docs decodes into model.Space, where a key it does not
	// recognise is not an error — it is a zero value, and an empty name is the failure that looks
	// like a default rather than a bug.
	if sent["name"] != "Engineering" {
		t.Fatalf("name = %v, want Engineering", sent["name"])
	}
}

// TestDocsCreateSpace_ClientSuppliedWorkspaceIsOverwritten is the SEC-4 case, written as the
// NATURAL MISTAKE: relay the body verbatim, as every other Docs write route correctly does. That
// forwards whatever workspace the browser named. Docs would still check membership, so this is not
// a cross-tenant hole — but a person in two workspaces could create in the wrong one, and the field
// an attacker edits should not be in the request at all.
func TestDocsCreateSpace_ClientSuppliedWorkspaceIsOverwritten(t *testing.T) {
	docs := newStatusUpstream(t, http.StatusCreated, `{"id":"sp-1"}`)
	a, sess := productApp(t, nil, docs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/docs/spaces",
		strings.NewReader(`{"name":"Engineering","workspace_id":"SOMEBODY-ELSE"}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	var sent map[string]any
	if err := json.Unmarshal(docs.reqBody, &sent); err != nil {
		t.Fatalf("forwarded body is not JSON (%v): %s", err, docs.reqBody)
	}
	if sent["workspace_id"] == "SOMEBODY-ELSE" {
		t.Fatal("the client NAMED the workspace and the BFF relayed it — the session must win")
	}
	if sent["workspace_id"] != "track-ws-7" {
		t.Fatalf("workspace_id = %v, want the SESSION's track-ws-7", sent["workspace_id"])
	}
}

// TestDocsCreateSpace_PassesOtherFieldsThrough: only workspace_id is rewritten. Decoding into a
// fixed struct here would silently drop any field Docs supports that this BFF has not heard of —
// the same silently-ignored-default failure, moved one layer out.
func TestDocsCreateSpace_PassesOtherFieldsThrough(t *testing.T) {
	docs := newStatusUpstream(t, http.StatusCreated, `{"id":"sp-1"}`)
	a, sess := productApp(t, nil, docs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/docs/spaces",
		strings.NewReader(`{"name":"Ops","description":"how we run","icon":"🛠️","private":true}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	var sent map[string]any
	if err := json.Unmarshal(docs.reqBody, &sent); err != nil {
		t.Fatalf("forwarded body is not JSON (%v): %s", err, docs.reqBody)
	}
	for k, want := range map[string]any{
		"name": "Ops", "description": "how we run", "icon": "🛠️", "private": true,
	} {
		if sent[k] != want {
			t.Errorf("%s = %v, want %v — the BFF must not drop fields Docs owns", k, sent[k], want)
		}
	}
}

// TestDocsSpaces_MethodNotAllowedNamesBothVerbs: the Allow header is what tells a caller the route
// takes a write at all. Leaving it at "GET" after adding POST would advertise the dead end.
func TestDocsSpaces_MethodNotAllowedNamesBothVerbs(t *testing.T) {
	docs := newCaptureUpstream(t, `[]`)
	a, sess := productApp(t, nil, docs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/docs/spaces", nil)
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("DELETE got %d, want 405", rec.Code)
	}
	if got := rec.Header().Get("Allow"); got != "GET, POST" {
		t.Fatalf("Allow = %q, want %q", got, "GET, POST")
	}
}

// TestDocsCreateSpace_RequiresSession: the write path must be gated exactly like the read.
func TestDocsCreateSpace_RequiresSession(t *testing.T) {
	docs := newCaptureUpstream(t, `[]`)
	a, _ := productApp(t, nil, docs)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/docs/spaces", strings.NewReader(`{"name":"X"}`))
	req.Header.Set("Content-Type", "application/json")
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated POST got %d, want 401", rec.Code)
	}
	if len(docs.reqBody) != 0 {
		t.Fatalf("unauthenticated POST reached the upstream: %s", docs.reqBody)
	}
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// CREATE ISSUE — the body, pinned against what Track actually requires.
//
// Track's issue.Store.Create requires WorkspaceID, TeamID, Title and CreatorID. Three of those are
// server-derived: the BFF puts the workspace in the PATH, and Track's handler fills CreatorID from
// the resolved member and TeamID from the workspace's sole team. Only the title travels in the body.
//
// This exists because the create failed in production for months while the BFF's own tests were
// green: they asserted a 2xx from a stub that answered 200 to anything, so nothing noticed the body
// could not satisfy the real validator. Asserting the WIRE is the part a stub cannot fake.
// ────────────────────────────────────────────────────────────────────────────────────────────────

// TestTrackCreateIssue_ForwardsTheBodyVerbatimAndInventsNoTeam.
//
// ⚠ THE NEGATIVE HALF IS THE POINT. The tempting fix for "team_id has no source" is to have the BFF
// look up a team and inject it, mirroring what it does for the Docs workspace id. That would be
// wrong here: Track derives WorkspaceID and CreatorID itself at the same spot, and a BFF that picks
// a team makes the same decision in a second place, for one client only — the MCP tools and any
// direct API caller would still be broken. Team resolution belongs upstream; this pins that it
// stayed there.
func TestTrackCreateIssue_ForwardsTheBodyVerbatimAndInventsNoTeam(t *testing.T) {
	track := newStatusUpstream(t, http.StatusCreated, `{"id":"iss-1","identifier":"GEN-1"}`)
	a, sess := productApp(t, track, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/track/issues", strings.NewReader(`{"title":"Write the thing down"}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("got %d (%s), want 201", rec.Code, rec.Body.String())
	}
	// The workspace is in the PATH, never the body — that is what makes the body safe to relay.
	if track.path != "/v1/workspaces/track-ws-7/issues" {
		t.Fatalf("upstream path = %q — the workspace must come from the session", track.path)
	}
	var sent map[string]any
	if err := json.Unmarshal(track.reqBody, &sent); err != nil {
		t.Fatalf("forwarded body is not JSON (%v): %s", err, track.reqBody)
	}
	if sent["title"] != "Write the thing down" {
		t.Fatalf("title = %v, want it relayed unchanged", sent["title"])
	}
	for _, derived := range []string{"team_id", "creator_id", "workspace_id"} {
		if _, present := sent[derived]; present {
			t.Errorf("the BFF sent %q — Track derives it, and a second decider is how the two disagree", derived)
		}
	}
}

// TestTrackCreateIssue_UpstreamRefusalReachesTheBrowser: the reason has to survive the proxy, or the
// screen cannot show it and the only way to read it is the network tab — which is exactly how this
// bug was found.
func TestTrackCreateIssue_UpstreamRefusalReachesTheBrowser(t *testing.T) {
	const upstreamBody = `{"error":"this workspace has several teams — name one in team_id","code":"TEAM_REQUIRED"}`
	track := newStatusUpstream(t, http.StatusBadRequest, upstreamBody)
	a, sess := productApp(t, track, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/track/issues", strings.NewReader(`{"title":"x"}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("got %d, want the upstream 400 unchanged", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "name one in team_id") {
		t.Fatalf("the upstream reason did not reach the browser: %s", rec.Body.String())
	}
}
