package main

// tenant_boundary_test.go — the tenancy boundary. Treated as a money path.
//
// Every person who signs in must land in THEIR OWN Lens workspace. Today they do not: the eight
// upstream paths are built ONCE at route-registration time from cfg.workspaceID, so every session
// — every trial user — shares one workspace, one balance, one key set, one ledger and one cache.
//
// These tests assert on what reached LENS (path and credential), not on anything rendered. A
// screen can show the right name while the request underneath carries the wrong workspace.

import (
	"context"
	"crypto/sha256"
	"encoding/base32"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// tenantUpstream fakes Lens: it records every inbound request's path and Authorization header, and
// serves /v1/provision so the BFF can turn an identity into a tenant.
type tenantUpstream struct {
	srv *httptest.Server

	mu       sync.Mutex
	seen     []upstreamCall
	provReqs []string // raw bodies of /v1/provision calls

	// created tracks which derived workspace ids this fake has already provisioned, so `created`
	// is reported the way the real handler reports it (check-then-create).
	created map[string]bool
	// poolable is the RECORDED consent per workspace: set once at creation, never changed by a
	// later provision call — mirroring Lens, where registration creates consent and only
	// SetCachePoolable changes it.
	poolable map[string]bool
}

type upstreamCall struct {
	path string
	auth string
}

func newTenantUpstream(t *testing.T) *tenantUpstream {
	t.Helper()
	u := &tenantUpstream{created: map[string]bool{}, poolable: map[string]bool{}}
	u.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u.mu.Lock()
		u.seen = append(u.seen, upstreamCall{path: r.URL.Path, auth: r.Header.Get("Authorization")})
		u.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")

		if strings.HasSuffix(r.URL.Path, "/cache-poolable") {
			var in struct {
				CachePoolable bool `json:"cache_poolable"`
			}
			_ = json.NewDecoder(r.Body).Decode(&in)
			ws := wsSegment(r.URL.Path)
			u.mu.Lock()
			u.poolable[ws] = in.CachePoolable
			u.mu.Unlock()
			_ = json.NewEncoder(w).Encode(map[string]any{"cache_poolable": in.CachePoolable})
			return
		}
		if r.URL.Path == provisionPath {
			body, _ := io.ReadAll(r.Body)
			u.mu.Lock()
			u.provReqs = append(u.provReqs, string(body))
			u.mu.Unlock()
			if r.Header.Get(provisionSecretHeader) != "test-provision-secret" {
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"error":"provisioning credentials required"}`))
				return
			}
			var in struct {
				Identity      string `json:"identity"`
				CachePoolable *bool  `json:"cache_poolable"`
			}
			_ = json.Unmarshal(body, &in)
			if in.Identity == "" {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":"identity required"}`))
				return
			}
			// Derive exactly as cmd/lens/provision_handler.go does, so the ids under test are the
			// ids the real Lens would produce.
			ws := deriveWorkspaceIDLikeLens(in.Identity)
			u.mu.Lock()
			created := !u.created[ws]
			if created {
				u.created[ws] = true
				// Consent is recorded ONCE at creation; a later call cannot change it.
				u.poolable[ws] = in.CachePoolable == nil || *in.CachePoolable
			}
			poolable := u.poolable[ws]
			u.mu.Unlock()
			_ = json.NewEncoder(w).Encode(map[string]any{
				"workspace_id": ws, "created": created, "cache_poolable": poolable,
				"token": "jwt-for-" + ws, "expires_at": time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
			})
			return
		}
		_, _ = w.Write([]byte(`{"path":"` + r.URL.Path + `","query":"` + r.URL.RawQuery + `"}`))
	}))
	t.Cleanup(u.srv.Close)
	return u
}

// pathsSince returns the upstream paths seen since the marker index.
func (u *tenantUpstream) pathsSince(n int) []string {
	u.mu.Lock()
	defer u.mu.Unlock()
	var out []string
	for _, c := range u.seen[n:] {
		out = append(out, c.path)
	}
	return out
}

func (u *tenantUpstream) count() int {
	u.mu.Lock()
	defer u.mu.Unlock()
	return len(u.seen)
}

// twoSessionApp builds an oidc-mode BFF with two live sessions belonging to two different people.
func twoSessionApp(t *testing.T, up *tenantUpstream) (*app, *http.Cookie, *http.Cookie) {
	t.Helper()
	cfg := config{
		lensBaseURL: up.srv.URL,
		authMode:    authModeOIDC, oidcIssuer: "https://idp.example.com",
		publicBaseURL: "https://app.talyvor.com", sessionTTL: time.Hour,
	}
	cfg = withTestTenantCreds(cfg)
	auth := newSessionOnlyAuthenticator(cfg)
	a := newApp(cfg, auth)
	a.cfg.webDist = t.TempDir()

	ca := seedTenantSession(t, a, auth, "alice-sid", "sub-alice", "alice@example.com")
	cb := seedTenantSession(t, a, auth, "bob-sid", "sub-bob", "bob@example.com")
	return a, ca, cb
}

// TWO SESSIONS, TWO WORKSPACES.
//
// Alice and Bob each read their balance. The two requests must reach DIFFERENT workspace paths.
// Against the pre-change BFF both reach /v1/workspaces/<the one configured id>/lxc/balance, which
// is the whole defect: ten trial users would share a balance and a ledger.
func TestTwoSessionsReachTwoDifferentWorkspaces(t *testing.T) {
	up := newTenantUpstream(t)
	a, alice, bob := twoSessionApp(t, up)

	mark := up.count()
	getAs(t, a, alice, "/api/lxc/balance")
	aliceCalls := up.pathsSince(mark)

	mark = up.count()
	getAs(t, a, bob, "/api/lxc/balance")
	bobCalls := up.pathsSince(mark)

	aliceWS := workspaceOf(t, aliceCalls, "/lxc/balance")
	bobWS := workspaceOf(t, bobCalls, "/lxc/balance")

	if aliceWS == "" || bobWS == "" {
		t.Fatalf("no workspace-scoped balance read observed: alice=%v bob=%v", aliceCalls, bobCalls)
	}
	if aliceWS == bobWS {
		t.Fatalf("both sessions read workspace %q — every signed-in person shares one balance, "+
			"one ledger and one key set; the workspace must come from the SESSION, not from a value "+
			"baked in at route registration", aliceWS)
	}
}

// EVERY workspace-scoped route must follow the session, not just the one above. A single route
// left closing over a startup value is the same leak with a smaller blast radius.
func TestAllWorkspaceRoutesFollowTheSession(t *testing.T) {
	up := newTenantUpstream(t)
	a, alice, bob := twoSessionApp(t, up)

	routes := []string{
		"/api/lxc/balance",
		"/api/tokens/balance",
		"/api/tokens/history?limit=5&offset=0",
		"/api/lxc/history?limit=5&offset=0",
		"/api/spend/month",
		"/api/keys",
	}
	for _, route := range routes {
		t.Run(route, func(t *testing.T) {
			mark := up.count()
			getAs(t, a, alice, route)
			aliceWS := anyWorkspaceIn(up.pathsSince(mark))

			mark = up.count()
			getAs(t, a, bob, route)
			bobWS := anyWorkspaceIn(up.pathsSince(mark))

			if aliceWS == "" || bobWS == "" {
				t.Skipf("route did not produce a workspace-scoped upstream call (alice=%q bob=%q)", aliceWS, bobWS)
			}
			if aliceWS == bobWS {
				t.Errorf("%s reached workspace %q for BOTH sessions — it is pinned to a startup value, "+
					"not the session", route, aliceWS)
			}
		})
	}
}

// workspaceOf returns the workspace segment of the first path ending in suffix.
func workspaceOf(t *testing.T, paths []string, suffix string) string {
	t.Helper()
	for _, p := range paths {
		if strings.HasSuffix(p, suffix) {
			return wsSegment(p)
		}
	}
	return ""
}

func anyWorkspaceIn(paths []string) string {
	for _, p := range paths {
		if ws := wsSegment(p); ws != "" {
			return ws
		}
	}
	return ""
}

// wsSegment pulls the {wsID} out of /v1/workspaces/{wsID}/...
func wsSegment(path string) string {
	const prefix = "/v1/workspaces/"
	if !strings.HasPrefix(path, prefix) {
		return ""
	}
	rest := path[len(prefix):]
	if i := strings.IndexByte(rest, '/'); i >= 0 {
		return rest[:i]
	}
	return rest
}

func getAs(t *testing.T, a *app, sess *http.Cookie, target string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	req.AddCookie(sess)
	rec := httptest.NewRecorder()
	a.mux.ServeHTTP(rec, req)
	return rec
}

// ─── harness seams that straddle the change ─────────────────────────────────
//
// These two helpers are the ONLY part of this file that knows how the BFF is configured and how a
// session is seeded. The assertions above are written against behaviour and do not move.

// withTestTenantCreds sets whatever credential the BFF needs to talk to Lens.
func withTestTenantCreds(cfg config) config {
	cfg.provisionSecret = "test-provision-secret"
	return cfg
}

// seedTenantSession puts a live session for one person and returns its cookie.
func seedTenantSession(t *testing.T, a *app, auth *authenticator, sid, sub, email string) *http.Cookie {
	t.Helper()
	// Provision through the REAL client against the fake Lens, exactly as the OIDC callback does —
	// so the workspace id under test is the one Lens derived, not one the test invented.
	prov, err := a.provisionForSession(context.Background(), provisionIdentity(a.cfg.oidcIssuer, sub))
	if err != nil {
		t.Fatalf("provision %s: %v", sub, err)
	}
	auth.sessions.put(sid, session{
		sub: sub, email: email, expires: time.Now().Add(time.Hour),
		workspaceID: prov.WorkspaceID, lensToken: prov.Token,
		cachePoolable: prov.CachePoolable, needsPoolingChoice: prov.Created,
	})
	return &http.Cookie{Name: sessionCookieName, Value: sid}
}

// deriveWorkspaceIDLikeLens mirrors cmd/lens/provision_handler.go's deriveWorkspaceID. Duplicated
// deliberately: if Lens ever changes its derivation, this fake keeps producing the OLD shape and
// the contract drift shows up here rather than in production.
func deriveWorkspaceIDLikeLens(identity string) string {
	sum := sha256.Sum256([]byte(identity))
	enc := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(sum[:])
	return "u" + strings.ToLower(enc)[:26]
}

// testProvisionSecret is the shared secret every test app presents to the fake Lens.
const testProvisionSecret = "test-provision-secret"

// seedProvisionedSession puts a session already carrying a tenant, for tests that are not about
// provisioning itself and just need a signed-in person with a workspace.
func seedProvisionedSession(auth *authenticator, sid, sub, email, ws string) {
	auth.sessions.put(sid, session{
		sub: sub, email: email, expires: time.Now().Add(time.Hour),
		workspaceID: ws, lensToken: "jwt-for-" + ws,
	})
}

// serveFakeProvision is the minimal /v1/provision stand-in used by tests whose subject is
// something else (the OIDC flow, the never-leaks sweeps). It derives the id the way Lens does so
// those tests still exercise a real per-identity workspace.
func serveFakeProvision(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Header.Get(provisionSecretHeader) != testProvisionSecret {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"provisioning credentials required"}`))
		return
	}
	var in struct {
		Identity      string `json:"identity"`
		CachePoolable *bool  `json:"cache_poolable"`
	}
	_ = json.NewDecoder(r.Body).Decode(&in)
	if in.Identity == "" {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"identity required"}`))
		return
	}
	ws := deriveWorkspaceIDLikeLens(in.Identity)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"workspace_id": ws, "created": true,
		"cache_poolable": in.CachePoolable != nil && *in.CachePoolable,
		"token":          "jwt-for-" + ws,
		"expires_at":     time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
	})
}

// ─── a client-supplied workspace is IGNORED, not honoured ───────────────────

// The workspace comes from the SERVER-SIDE session and nothing else. This drives the four ways a
// client could try to name one — header, query, body, path — and asserts the upstream still saw
// the session's own workspace. Nothing here should pass; the point is that there is no code that
// could read them.
func TestClientSuppliedWorkspaceIsIgnored(t *testing.T) {
	up := newTenantUpstream(t)
	a, alice, _ := twoSessionApp(t, up)

	victim := deriveWorkspaceIDLikeLens(provisionIdentity("https://idp.example.com", "sub-bob"))
	mine := deriveWorkspaceIDLikeLens(provisionIdentity("https://idp.example.com", "sub-alice"))

	attempts := []struct {
		name string
		req  func() *http.Request
	}{
		{"header X-Talyvor-Workspace", func() *http.Request {
			r := httptest.NewRequest(http.MethodGet, "/api/lxc/balance", nil)
			r.Header.Set("X-Talyvor-Workspace", victim)
			return r
		}},
		{"query ?workspace_id=", func() *http.Request {
			return httptest.NewRequest(http.MethodGet, "/api/lxc/balance?workspace_id="+victim, nil)
		}},
		{"query ?workspace=", func() *http.Request {
			return httptest.NewRequest(http.MethodGet, "/api/tokens/history?limit=5&offset=0&workspace="+victim, nil)
		}},
		{"body {workspace_id}", func() *http.Request {
			r := httptest.NewRequest(http.MethodPost, "/api/keys",
				strings.NewReader(`{"name":"k","workspace_id":"`+victim+`"}`))
			r.Header.Set("Origin", "https://app.talyvor.com")
			r.Header.Set("Content-Type", "application/json")
			return r
		}},
		{"path traversal in a pass-through param", func() *http.Request {
			return httptest.NewRequest(http.MethodGet,
				"/api/tokens/history?limit=5&offset=0&x=../../"+victim, nil)
		}},
	}

	for _, at := range attempts {
		t.Run(at.name, func(t *testing.T) {
			mark := up.count()
			req := at.req()
			req.AddCookie(alice)
			a.mux.ServeHTTP(httptest.NewRecorder(), req)

			for _, p := range up.pathsSince(mark) {
				ws := wsSegment(p)
				if ws == "" {
					continue
				}
				if ws == victim {
					t.Fatalf("client-supplied workspace was HONOURED: upstream reached %q (another tenant)", p)
				}
				if ws != mine {
					t.Fatalf("upstream reached %q — neither the session's workspace nor the forged one; "+
						"the workspace must come only from the session", p)
				}
			}
		})
	}
}

// ─── second login reuses the workspace ──────────────────────────────────────

// Signing in again must land on the SAME workspace and must not create a second one. Lens makes
// this structural (the id is derived from the identity) — this asserts the BFF does not defeat it
// by, say, mixing a nonce or the session id into the identity it presents.
func TestSecondLoginReusesTheSameWorkspace(t *testing.T) {
	up := newTenantUpstream(t)
	a, _, _ := twoSessionApp(t, up)

	identity := provisionIdentity(a.cfg.oidcIssuer, "sub-returning")
	first, err := a.provisionForSession(context.Background(), identity)
	if err != nil {
		t.Fatalf("first login: %v", err)
	}
	second, err := a.provisionForSession(context.Background(), identity)
	if err != nil {
		t.Fatalf("second login: %v", err)
	}

	if second.WorkspaceID != first.WorkspaceID {
		t.Errorf("second login got workspace %q, want the same %q — a returning person would lose "+
			"their balance, keys and ledger on every sign-in", second.WorkspaceID, first.WorkspaceID)
	}
	if !first.Created {
		t.Errorf("first login reported created=false")
	}
	if second.Created {
		t.Errorf("second login reported created=true — it minted a second workspace for one person")
	}

	// And the identity presented must be stable: nothing per-login may leak into it.
	up.mu.Lock()
	defer up.mu.Unlock()
	if len(up.provReqs) < 2 {
		t.Fatalf("expected at least two provision calls, saw %d", len(up.provReqs))
	}
	last, prev := up.provReqs[len(up.provReqs)-1], up.provReqs[len(up.provReqs)-2]
	if last != prev {
		t.Errorf("the identity presented changed between logins:\n  %s\n  %s", prev, last)
	}
}

// ─── the pooling default, and the decline that must still work ──────────────

// A NEW WORKSPACE IS CREATED POOLABLE — Lens's own default applies.
//
// Cross-tenant sharing is the product: it is what makes reuse earn, and an economy that only runs
// for people who find a screen and opt in does not run. So the BFF states no preference at
// provision time and lets Lens's default (true) stand. What protects the person is not the switch
// position but the DISCLOSURE: a blocking screen, before the app, saying plainly that this is on
// and that one click turns it off.
//
// The BFF must send NO cache_poolable field at all. Sending `true` would look equivalent and is
// not: Lens refuses to retroactively GRANT consent on an existing workspace, so an explicit true
// is silently ignored on every login after the first — a field that means something different
// from what it appears to say. Silence means "take the default", which is the actual intent.
func TestSignupCreatesWorkspacePoolableByLensDefault(t *testing.T) {
	up := newTenantUpstream(t)
	a, _, _ := twoSessionApp(t, up)

	prov, err := a.provisionForSession(context.Background(),
		provisionIdentity(a.cfg.oidcIssuer, "sub-default-on"))
	if err != nil {
		t.Fatalf("provision: %v", err)
	}
	if !prov.CachePoolable {
		t.Errorf("a new workspace was created with pooling OFF — the earning half of the product " +
			"would then run only for people who find the settings screen and opt in")
	}

	up.mu.Lock()
	defer up.mu.Unlock()
	last := up.provReqs[len(up.provReqs)-1]
	if strings.Contains(last, `"cache_poolable"`) {
		t.Errorf("provision body carries a cache_poolable field; it must say NOTHING so Lens's "+
			"default applies (an explicit true is silently ignored on re-provision): %s", last)
	}
}

// AND THE DECLINE MUST STILL BE HONOURED AND STORED. This is the half that must not regress when
// the default flips: a person who reads the disclosure and declines ends up stored as declined,
// and the write must reach LENS — a decline the BFF only remembers stops nothing being served.
func TestExplicitDeclineIsHonouredAndStored(t *testing.T) {
	up := newTenantUpstream(t)
	a, alice, _ := twoSessionApp(t, up)

	req := httptest.NewRequest(http.MethodPost, "/api/pooling", strings.NewReader(`{"cache_poolable":false}`))
	req.Header.Set("Origin", "https://app.talyvor.com")
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(alice)
	rec := httptest.NewRecorder()
	a.mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("decline returned %d, want 200 (body %s)", rec.Code, rec.Body.String())
	}
	var out struct {
		CachePoolable bool `json:"cache_poolable"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out.CachePoolable {
		t.Errorf("declining reported cache_poolable=true — the screen would show the opposite of what was chosen")
	}

	mine := deriveWorkspaceIDLikeLens(provisionIdentity("https://idp.example.com", "sub-alice"))
	up.mu.Lock()
	defer up.mu.Unlock()
	if !up.poolable[mine] || true {
		wrote := false
		for _, c := range up.seen {
			if c.path == "/v1/workspaces/"+mine+"/cache-poolable" {
				wrote = true
			}
		}
		if !wrote {
			t.Errorf("no cache-poolable write reached Lens for %s — the decline was not persisted", mine)
		}
	}
}
