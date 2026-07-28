package main

// The BFF's FIRST WRITE PATH: POST /api/keys (mint). Two disciplines arrive
// with it, both tested here rather than assumed:
//
// CSRF: the session cookie is __Host-/Secure/HttpOnly/SameSite=Lax. Lax
// withholds it from cross-SITE POSTs, but SameSite treats every *.talyvor.com
// sibling as same-site — a future compromised subdomain could still forge a
// POST. So the mint additionally requires an Origin header equal to the
// configured public origin (browsers attach Origin to every POST and scripts
// cannot spoof it). Missing or foreign Origin → 403, before anything happens.
//
// THE MINT RESPONSE CARRIES A SECRET — deliberately, exactly once. The
// never-leaks sweeps stay fully strict on every other route (the mint route is
// simply not a GET and not in their sweep lists); this file proves the tight
// version: the minted key appears in THE mint response only — not in logs, not
// cacheable (Cache-Control: no-store), not echoed by the list, and never
// accompanied by the workspace key or gateway secrets.

import (
	"bytes"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const testMintedKey = "tlv_ws_MINTED_fresh_credential_for_the_user_9999"

// keysUpstream fakes Lens's api-keys surface: GET list (prefixes only, like
// the real WorkspaceAPIKey shape) and POST mint (201 with key+prefix adjacent,
// like the real response). Records what it saw.
type keysUpstream struct {
	srv        *httptest.Server
	gotAuth    string
	gotMethod  string
	gotPath    string
	gotBody    string
	nextStatus int
}

func newKeysUpstream(t *testing.T) *keysUpstream {
	t.Helper()
	u := &keysUpstream{}
	u.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		u.gotAuth = r.Header.Get("Authorization")
		u.gotMethod = r.Method
		u.gotPath = r.URL.Path
		b, _ := io.ReadAll(r.Body)
		u.gotBody = string(b)
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodDelete {
			// Lens confirms the key belongs to {wsID} and answers 404 when it does not, so the
			// stub has to be able to say that too — otherwise a refusal could never be modelled
			// and "the 404 passes through" would be untestable.
			status := u.nextStatus
			if status == 0 {
				status = http.StatusOK
			}
			w.WriteHeader(status)
			_, _ = io.WriteString(w, `{"ok":true}`)
			return
		}
		if r.Method == http.MethodPost {
			status := u.nextStatus
			if status == 0 {
				status = http.StatusCreated
			}
			w.WriteHeader(status)
			_, _ = io.WriteString(w, `{"key":"`+testMintedKey+`","prefix":"tlv_ws_9f21c4a0","name":"CI","scopes":["proxy"]}`)
			return
		}
		_, _ = io.WriteString(w, `[{"id":"k1","key_prefix":"tlv_ws_9f21c4a0","name":"CI","scopes":["proxy"],"created_at":"2026-07-14T09:12:00Z"}]`)
	}))
	t.Cleanup(u.srv.Close)
	return u
}

// keysApp: oidc-mode app whose LENS upstream is the keys fake, with a seeded
// session and a public origin to enforce.
func keysApp(t *testing.T, up *keysUpstream) (*app, *http.Cookie) {
	t.Helper()
	cfg := config{
		lensBaseURL: up.srv.URL, provisionSecret: testProvisionSecret,
		authMode: authModeOIDC, oidcIssuer: "https://idp.example.com",
		publicBaseURL: "https://app.talyvor.com", sessionTTL: time.Hour,
	}
	auth := newSessionOnlyAuthenticator(cfg)
	seedProvisionedSession(auth, "keys-sid", "u1", "ng@example.com", "u-test-workspace")
	a := newApp(cfg, auth)
	a.cfg.webDist = t.TempDir()
	return a, &http.Cookie{Name: sessionCookieName, Value: "keys-sid"}
}

func TestKeysListProxiesPrefixesNotSecrets(t *testing.T) {
	up := newKeysUpstream(t)
	a, sess := keysApp(t, up)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/keys", nil)
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("got %d (%s)", rec.Code, rec.Body.String())
	}
	if up.gotPath != "/v1/workspaces/u-test-workspace/api-keys" {
		t.Fatalf("upstream path = %q — must be scoped to the SESSION's workspace", up.gotPath)
	}
	if !strings.HasPrefix(up.gotAuth, "Bearer ") || up.gotAuth == "Bearer " {
		t.Fatalf("session's workspace token not attached server-side: %q", up.gotAuth)
	}
	if !strings.Contains(rec.Body.String(), "tlv_ws_9f21c4a0") {
		t.Fatalf("list should carry prefixes: %s", rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), testKey) || strings.Contains(rec.Body.String(), testMintedKey) {
		t.Fatalf("a secret reached the list response: %s", rec.Body.String())
	}
}

// TestMintRequiresSameOrigin: Lax already withholds the cookie cross-site;
// Origin closes the same-SITE sibling-subdomain hole. Fail-closed: absent
// Origin is refused too.
func TestMintRequiresSameOrigin(t *testing.T) {
	up := newKeysUpstream(t)
	a, sess := keysApp(t, up)

	cases := []struct {
		name   string
		origin string // "" = header absent
		want   int
	}{
		{"matching origin allowed", "https://app.talyvor.com", http.StatusCreated},
		{"sibling subdomain refused", "https://evil.talyvor.com", http.StatusForbidden},
		{"foreign origin refused", "https://attacker.example", http.StatusForbidden},
		{"absent origin refused", "", http.StatusForbidden},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			up.gotMethod = ""
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/keys", strings.NewReader(`{"name":"CI","scopes":["proxy"]}`))
			req.Header.Set("Content-Type", "application/json")
			if c.origin != "" {
				req.Header.Set("Origin", c.origin)
			}
			req.AddCookie(sess)
			a.ServeHTTP(rec, req)
			if rec.Code != c.want {
				t.Fatalf("got %d (%s), want %d", rec.Code, rec.Body.String(), c.want)
			}
			if c.want == http.StatusForbidden && up.gotMethod == http.MethodPost {
				t.Fatal("a refused mint must never reach the upstream")
			}
		})
	}
}

// TestMintReturnsSecretExactlyOnce is the tight version of never-leaks for the
// one route that deliberately returns a credential: the minted key is in THE
// mint response and nowhere else — not in the BFF's log output, not cacheable,
// not in the list, and never alongside the workspace key or gateway secrets.
func TestMintReturnsSecretExactlyOnce(t *testing.T) {
	up := newKeysUpstream(t)
	a, sess := keysApp(t, up)

	// Capture everything the BFF logs across the mint.
	var logs bytes.Buffer
	prev := log.Writer()
	log.SetOutput(&logs)
	defer log.SetOutput(prev)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/keys", strings.NewReader(`{"name":"CI","scopes":["proxy"],"junk_field":"dropped"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://app.talyvor.com")
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("mint: got %d (%s)", rec.Code, rec.Body.String())
	}
	// The one permitted appearance.
	if !strings.Contains(rec.Body.String(), testMintedKey) {
		t.Fatalf("the mint response must return the minted key once: %s", rec.Body.String())
	}
	// Never cacheable: this response must not survive in any cache layer.
	if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
		t.Fatalf("mint response Cache-Control = %q, want no-store", cc)
	}
	// The BFF's own secrets still never appear.
	if strings.Contains(rec.Body.String(), testKey) || strings.Contains(rec.Body.String(), "gwsecret_") {
		t.Fatalf("a BFF-held secret leaked into the mint response")
	}
	// Not logged: the credential must not touch the BFF's log stream.
	if strings.Contains(logs.String(), testMintedKey) {
		t.Fatalf("the minted key reached the log output: %s", logs.String())
	}
	// Sanitise-by-reconstruction: unknown client fields never reach Lens.
	if strings.Contains(up.gotBody, "junk_field") {
		t.Fatalf("unsanitised client body reached the upstream: %s", up.gotBody)
	}
	if !strings.Contains(up.gotBody, `"name":"CI"`) {
		t.Fatalf("mint body lost the name: %s", up.gotBody)
	}

	// And nowhere else: the list after the mint carries prefixes only.
	rec2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodGet, "/api/keys", nil)
	req2.AddCookie(sess)
	a.ServeHTTP(rec2, req2)
	if strings.Contains(rec2.Body.String(), testMintedKey) {
		t.Fatalf("the minted key appeared outside the mint response: %s", rec2.Body.String())
	}
}

func TestMintRequiresSession(t *testing.T) {
	up := newKeysUpstream(t)
	a, _ := keysApp(t, up)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/keys", strings.NewReader(`{"name":"x"}`))
	req.Header.Set("Origin", "https://app.talyvor.com")
	a.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("mint without session: got %d, want 401", rec.Code)
	}
	if up.gotMethod == http.MethodPost {
		t.Fatal("an unauthenticated mint must never reach the upstream")
	}
}

func TestKeysMethodSurface(t *testing.T) {
	up := newKeysUpstream(t)
	a, sess := keysApp(t, up)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/keys", nil)
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("DELETE /api/keys: got %d, want 405", rec.Code)
	}
	if got := rec.Header().Get("Allow"); got != "GET, POST" {
		t.Fatalf("Allow = %q, want \"GET, POST\"", got)
	}
}

// TestSpendMonthProxies: GET /api/spend/month → Lens spend/current-month,
// pinned to the configured workspace, key attached server-side.
func TestSpendMonthProxies(t *testing.T) {
	var gotAuth, gotPath string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		gotAuth = r.Header.Get("Authorization")
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"current_month_usd":4.31}`)
	}))
	t.Cleanup(upstream.Close)

	cfg := config{
		lensBaseURL: upstream.URL, provisionSecret: testProvisionSecret,
		authMode: authModeOIDC, sessionTTL: time.Hour,
	}
	auth := newSessionOnlyAuthenticator(cfg)
	seedProvisionedSession(auth, "sm-sid", "u1", "ng@example.com", "u-test-workspace")
	a := newApp(cfg, auth)
	a.cfg.webDist = t.TempDir()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/spend/month", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "sm-sid"})
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "current_month_usd") {
		t.Fatalf("got %d (%s)", rec.Code, rec.Body.String())
	}
	if gotPath != "/v1/workspaces/u-test-workspace/spend/current-month" {
		t.Fatalf("upstream path = %q", gotPath)
	}
	if !strings.HasPrefix(gotAuth, "Bearer ") || gotAuth == "Bearer " {
		t.Fatalf("session's workspace token not attached: %q", gotAuth)
	}
}

// TestMembersUsesTheSessionsTrackWorkspace. This replaces
// TestMembersProxiesPinnedTrackWorkspace, which asserted the route was pinned to
// TRACK_WORKSPACE_ID — correct while Track was one shared workspace, and the defect
// once Lens went per-user. The guarantee it was really defending is unchanged and
// still asserted: the addressed workspace never comes from client input. It now
// comes from the SESSION rather than from config.
func TestMembersUsesTheSessionsTrackWorkspace(t *testing.T) {
	track := newCaptureUpstream(t, `[{"id":"m1","name":"N","email":"ng@example.com","role":"owner","avatar_url":""}]`)
	cfg := config{
		lensBaseURL: "http://127.0.0.1:1", provisionSecret: testProvisionSecret,
		authMode: authModeOIDC, oidcIssuer: "https://idp.example.com", sessionTTL: time.Hour,
		trackBaseURL: track.srv.URL, trackGatewaySecret: testTrackSecret,
	}
	auth := newSessionOnlyAuthenticator(cfg)
	seedProvisionedSession(auth, "mb-sid", "u1", "ng@example.com", "u-test-workspace")
	sess, _ := auth.sessions.get("mb-sid")
	sess.trackWorkspaceID = "track-ws-7" // resolved at login by Track's bootstrap
	auth.sessions.put("mb-sid", sess)
	a := newApp(cfg, auth)
	a.cfg.webDist = t.TempDir()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/members?workspace_id=SOMEBODY-ELSE", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "mb-sid"})
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("got %d (%s)", rec.Code, rec.Body.String())
	}
	if track.path != "/v1/workspaces/track-ws-7/members" {
		t.Fatalf("upstream path = %q — must address the SESSION's Track workspace, and the "+
			"?workspace_id= above must be ignored", track.path)
	}
	if track.headers.Get("X-Gateway-Auth") != testTrackSecret {
		t.Fatal("transit proof missing")
	}
	if track.headers.Get("X-User-Email") != "ng@example.com" {
		t.Fatal("session identity missing")
	}
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// REVOKE — DELETE /api/keys/{id}.
//
// Until this existed a key minted here could never be removed: the product could create credentials
// and not destroy them, so a key you could not use still counted against your list forever. Lens has
// had the capability all along (DELETE /v1/workspaces/{wsID}/api-keys/{keyID}); nothing surfaced it.
//
// ⚠ A DELETE ROUTE IS WHERE TENANCY GOES WRONG, so the isolation claim is tested by ATTACKING it,
// not by exercising the happy path. The happy path proves the plumbing works; it proves nothing
// about whose data the plumbing reaches.
// ────────────────────────────────────────────────────────────────────────────────────────────────

const revokeOrigin = "https://app.talyvor.com"

func revokeReq(t *testing.T, target string, sess *http.Cookie) *http.Request {
	t.Helper()
	req := httptest.NewRequest(http.MethodDelete, target, nil)
	req.Header.Set("Origin", revokeOrigin)
	req.AddCookie(sess)
	return req
}

// TestRevokeForwardsToTheSessionsWorkspace: the upstream path is built from the SESSION tenant and
// the validated key id, and carries the session's workspace token.
func TestRevokeForwardsToTheSessionsWorkspace(t *testing.T) {
	up := newKeysUpstream(t)
	a, sess := keysApp(t, up)

	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, revokeReq(t, "/api/keys/k1", sess))

	if rec.Code != http.StatusOK {
		t.Fatalf("got %d (%s), want 200", rec.Code, rec.Body.String())
	}
	if up.gotMethod != http.MethodDelete {
		t.Fatalf("upstream method = %q, want DELETE", up.gotMethod)
	}
	if up.gotPath != "/v1/workspaces/u-test-workspace/api-keys/k1" {
		t.Fatalf("upstream path = %q — the workspace must come from the session", up.gotPath)
	}
	if up.gotAuth == "" {
		t.Fatal("no Authorization attached — the workspace token is added server-side")
	}
}

// TestRevokeCannotNameAnotherWorkspace is THE isolation test, written as the attack.
//
// ⚠ EVERY CHANNEL A CALLER CONTROLS IS TRIED AT ONCE — query string, header, and a body naming
// another workspace. The property being asserted is not "these particular tricks fail" but that the
// upstream path is a pure function of the SESSION: whatever the caller sends, the workspace segment
// is theirs. lensWorkspacePath(t, …) makes that structural, and this pins it so a later refactor
// that starts reading a workspace off the request fails here rather than in production.
func TestRevokeCannotNameAnotherWorkspace(t *testing.T) {
	up := newKeysUpstream(t)
	a, sess := keysApp(t, up)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete,
		"/api/keys/victim-key?workspace_id=SOMEBODY-ELSE&wsID=SOMEBODY-ELSE",
		strings.NewReader(`{"workspace_id":"SOMEBODY-ELSE"}`))
	req.Header.Set("Origin", revokeOrigin)
	req.Header.Set("X-Workspace-Id", "SOMEBODY-ELSE")
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if strings.Contains(up.gotPath, "SOMEBODY-ELSE") {
		t.Fatalf("upstream path = %q — a caller-supplied workspace reached Lens", up.gotPath)
	}
	if up.gotPath != "/v1/workspaces/u-test-workspace/api-keys/victim-key" {
		t.Fatalf("upstream path = %q, want the SESSION's workspace with the given key id", up.gotPath)
	}
}

// TestRevokeForeignKeyRefusalPassesThrough: Lens confirms the key belongs to {wsID} and answers 404
// when it does not (cmd/lens/main.go — it lists the workspace's keys and refuses an unowned id).
// That refusal must reach the browser unchanged rather than being laundered into a success.
func TestRevokeForeignKeyRefusalPassesThrough(t *testing.T) {
	up := newKeysUpstream(t)
	up.nextStatus = http.StatusNotFound
	a, sess := keysApp(t, up)

	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, revokeReq(t, "/api/keys/another-tenants-key", sess))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("got %d, want the upstream 404 unchanged — a refused delete must not read as done", rec.Code)
	}
}

// TestRevokeRequiresSameOrigin: destructive and state-changing, so it carries the same CSRF posture
// as the mint. Without this a cross-origin page could delete a workspace's credentials with the
// user's cookie.
func TestRevokeRequiresSameOrigin(t *testing.T) {
	up := newKeysUpstream(t)
	a, sess := keysApp(t, up)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/keys/k1", nil)
	req.Header.Set("Origin", "https://evil.example.com")
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("cross-origin DELETE got %d, want 403", rec.Code)
	}
	if up.gotMethod == http.MethodDelete {
		t.Fatal("a cross-origin DELETE reached the upstream")
	}
}

// TestRevokeRequiresSession: no session, no delete, and nothing reaches Lens.
func TestRevokeRequiresSession(t *testing.T) {
	up := newKeysUpstream(t)
	a, _ := keysApp(t, up)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/keys/k1", nil)
	req.Header.Set("Origin", revokeOrigin)
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated DELETE got %d, want 401", rec.Code)
	}
	if up.gotMethod == http.MethodDelete {
		t.Fatal("an unauthenticated DELETE reached the upstream")
	}
}

// TestRevokeRejectsATraversingID: the id is the ONE caller-controlled segment of the upstream path,
// so it goes through the same validator every other id route uses. Without it, "../../workspaces/x"
// would address a path this BFF never intended to expose.
func TestRevokeRejectsATraversingID(t *testing.T) {
	up := newKeysUpstream(t)
	a, sess := keysApp(t, up)

	for _, bad := range []string{"..", "%2e%2e%2fadmin"} {
		up.gotMethod = ""
		rec := httptest.NewRecorder()
		a.ServeHTTP(rec, revokeReq(t, "/api/keys/"+bad, sess))
		if rec.Code == http.StatusOK {
			t.Errorf("id %q was accepted", bad)
		}
		if up.gotMethod == http.MethodDelete {
			t.Errorf("id %q reached the upstream", bad)
		}
	}
}
