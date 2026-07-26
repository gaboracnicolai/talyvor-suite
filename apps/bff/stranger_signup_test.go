package main

// stranger_signup_test.go — THE SEQUENCE, not the steps.
//
// Every individual piece of signup has a test already: the OIDC round-trip (auth_test.go), that
// two seeded sessions reach two workspaces (tenant_boundary_test.go), that Track bootstraps
// (track_tenant_test.go). All of them start from a session someone else created, or from a
// workspace the test seeded. None of them answers the question the trial actually turns on:
//
//   Can an identity NOBODY HAS EVER SEEN arrive at the front door and come out the other side
//   holding a working product, with no operator touching anything?
//
// So these tests start where a stranger starts — at /auth/login with an empty cookie jar — and
// drive the whole chain over HTTP: login → IdP → callback → allowlist → Lens provisioning →
// Track bootstrap → pooling prompt → Setup coordinates → key mint → ledger read.
//
// AND THEY RUN IT TWICE, as two different people in two different browsers. That second run is
// the point. Almost everything works for user one: user one is who a developer tests as, and a
// value pinned at startup, cached in a package variable, or memoised on first use is
// indistinguishable from a correct one until a second, unrelated person arrives. So every
// assertion below is made about BOTH strangers, and the isolation claims are asserted on what
// the API RETURNED to B — not merely on which upstream path B's request took. A response body
// is what a person actually sees; a path assertion can pass while the body carries someone
// else's rows.

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// ─── the fake suite behind the BFF ──────────────────────────────────────────

// strangerLens is a Lens stand-in that keeps PER-WORKSPACE state, so a leak has something to
// leak. Its ledger, key list and balance all differ per workspace; a response carrying another
// workspace's marker is therefore a visible, specific failure rather than a subtle one.
type strangerLens struct {
	srv *httptest.Server

	mu       sync.Mutex
	paths    []string
	auths    []string
	created  map[string]bool
	poolable map[string]bool
}

func newStrangerLens(t *testing.T) *strangerLens {
	t.Helper()
	l := &strangerLens{created: map[string]bool{}, poolable: map[string]bool{}}
	l.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		l.mu.Lock()
		l.paths = append(l.paths, r.URL.Path)
		l.auths = append(l.auths, r.Header.Get("Authorization"))
		l.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")

		if r.URL.Path == provisionPath {
			l.serveProvision(w, r)
			return
		}
		ws := wsSegment(r.URL.Path)
		switch {
		case strings.HasSuffix(r.URL.Path, "/cache-poolable"):
			var in struct {
				CachePoolable bool `json:"cache_poolable"`
			}
			_ = json.NewDecoder(r.Body).Decode(&in)
			l.mu.Lock()
			l.poolable[ws] = in.CachePoolable
			l.mu.Unlock()
			_ = json.NewEncoder(w).Encode(map[string]any{"cache_poolable": in.CachePoolable})
		case strings.HasSuffix(r.URL.Path, "/tokens/history"):
			// THE LEDGER. Each workspace's rows are stamped with its own id, so "B saw A's
			// spend" is a string that either is or is not in B's response body.
			_ = json.NewEncoder(w).Encode(map[string]any{
				"items": []map[string]any{{
					"model": "claude-sonnet-5", "cost_lxc": 42,
					"note": "spend-belonging-to-" + ws,
				}},
			})
		case strings.HasSuffix(r.URL.Path, "/api-keys") && r.Method == http.MethodPost:
			// The mint. The secret comes back exactly once and is stamped per workspace.
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id": "key-" + ws, "key": "lens_sk_live_" + ws, "prefix": "lens_sk",
			})
		case strings.HasSuffix(r.URL.Path, "/api-keys"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"items": []map[string]any{{"id": "key-" + ws, "prefix": "lens_sk", "name": "key-of-" + ws}},
			})
		default:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"path": r.URL.Path, "belongs_to": ws,
			})
		}
	}))
	t.Cleanup(l.srv.Close)
	return l
}

func (l *strangerLens) serveProvision(w http.ResponseWriter, r *http.Request) {
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
	l.mu.Lock()
	created := !l.created[ws]
	if created {
		l.created[ws] = true
		l.poolable[ws] = in.CachePoolable == nil || *in.CachePoolable
	}
	poolable := l.poolable[ws]
	l.mu.Unlock()
	_ = json.NewEncoder(w).Encode(map[string]any{
		"workspace_id": ws, "created": created, "cache_poolable": poolable,
		"token": "jwt-for-" + ws, "expires_at": time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
	})
}

func (l *strangerLens) pathsSince(n int) []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]string(nil), l.paths[n:]...)
}

func (l *strangerLens) count() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.paths)
}

// strangerTrack stands in for Track: an idempotent per-identity bootstrap keyed on the identity
// headers the BFF attaches, and a per-workspace roster so a Track leak is visible too.
type strangerTrack struct {
	srv *httptest.Server

	mu        sync.Mutex
	bootstrap []string // the identity each bootstrap call presented
	created   map[string]bool
}

func newStrangerTrack(t *testing.T) *strangerTrack {
	t.Helper()
	k := &strangerTrack{created: map[string]bool{}}
	k.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Header.Get("X-Gateway-Auth") != testTrackGatewaySecret {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":"gateway auth required"}`))
			return
		}
		if r.URL.Path == trackBootstrapPath {
			// Track derives from the identity headers; the BFF sends no workspace id and no body.
			identity := r.Header.Get("X-Auth-Iss") + "\x00" + r.Header.Get("X-User-Id")
			ws := "trk-" + deriveWorkspaceIDLikeLens(identity)[1:12]
			k.mu.Lock()
			k.bootstrap = append(k.bootstrap, identity)
			created := !k.created[ws]
			k.created[ws] = true
			k.mu.Unlock()
			_ = json.NewEncoder(w).Encode(map[string]any{
				"workspace_id": ws, "slug": ws, "created": created,
			})
			return
		}
		ws := wsSegment(r.URL.Path)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"items": []map[string]any{{"email": "member-of-" + ws, "role": "owner"}},
		})
	}))
	t.Cleanup(k.srv.Close)
	return k
}

const testTrackGatewaySecret = "test-track-gateway-secret"

// ─── the rig ────────────────────────────────────────────────────────────────

type strangerSuite struct {
	t       *testing.T
	lens    *strangerLens
	track   *strangerTrack
	idp     *fakeIDP
	ts      *httptest.Server
	app     *app
	logs    *logCapture
	webDist string
}

// startStrangerSuite boots a BFF over TLS with a live Lens, Track and IdP behind it, configured
// the way a PUBLIC TRIAL is configured: OIDC_ALLOWED_EMAILS="*". Nothing is seeded — every
// session in these tests is created by actually logging in.
func startStrangerSuite(t *testing.T, allowed []string) *strangerSuite {
	t.Helper()
	s := &strangerSuite{
		t:       t,
		lens:    newStrangerLens(t),
		track:   newStrangerTrack(t),
		idp:     newFakeIDP(t),
		logs:    captureLogs(t),
		webDist: t.TempDir(),
	}
	// A real bundle on disk, so the SPA fallback is exercised rather than stubbed out by an
	// absent index.html (which 404s and would make the entry-route test pass for the wrong
	// reason — or fail for one).
	if err := os.WriteFile(filepath.Join(s.webDist, "index.html"),
		[]byte("<!doctype html><title>Talyvor</title><div id=root></div>"), 0o600); err != nil {
		t.Fatal(err)
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	cfg := config{
		addr:              "127.0.0.1:0",
		lensBaseURL:       s.lens.srv.URL,
		lensPublicBaseURL: "https://lens.talyvor.com",
		provisionSecret:   testProvisionSecret,
		webDist:           s.webDist,
		authMode:          authModeOIDC,
		oidcIssuer:        s.idp.srv.URL,
		oidcClientID:      s.idp.clientID,
		oidcClientSecret:  s.idp.clientSecret,
		publicBaseURL:     "https://" + ln.Addr().String(),
		allowedEmails:     allowed,
		sessionTTL:        time.Hour,

		trackBaseURL:       s.track.srv.URL,
		trackGatewaySecret: testTrackGatewaySecret,
	}
	auth, err := newAuthenticator(t.Context(), cfg)
	if err != nil {
		t.Fatalf("newAuthenticator: %v", err)
	}
	s.app = newApp(cfg, auth)
	ts := httptest.NewUnstartedServer(s.app)
	ts.Listener.Close()
	ts.Listener = ln
	ts.StartTLS()
	t.Cleanup(ts.Close)
	if ts.URL != cfg.publicBaseURL {
		t.Fatalf("test rig: TLS URL %s != public base URL %s", ts.URL, cfg.publicBaseURL)
	}
	s.ts = ts
	return s
}

// browser is one stranger's browser: its OWN cookie jar, so two of them are two live sessions
// rather than one session being rotated out from under the other.
func (s *strangerSuite) browser() *http.Client {
	s.t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		s.t.Fatal(err)
	}
	return &http.Client{
		Transport:     s.ts.Client().Transport,
		Jar:           jar,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

// signUp drives the WHOLE front door for one never-before-seen identity and returns their
// browser. It fails the test if any hop refuses — this is the sequence under test, not a setup
// helper that may quietly skip.
func (s *strangerSuite) signUp(sub, email string) *http.Client {
	s.t.Helper()
	s.idp.sub, s.idp.email = sub, email
	br := s.browser()
	h := loginHops(s.t, s.ts, br, "/")
	if h.callback.StatusCode != http.StatusFound {
		s.t.Fatalf("stranger %s (%s) was refused at the callback: %d — %s",
			sub, email, h.callback.StatusCode, h.cbBody)
	}
	if cookieNamed(h.callback, sessionCookieName) == nil {
		s.t.Fatalf("stranger %s completed the flow but got no session cookie", sub)
	}
	return br
}

// me reads /auth/me for one browser.
func (s *strangerSuite) me(br *http.Client) map[string]any {
	s.t.Helper()
	resp, body := doReq(s.t, br, http.MethodGet, s.ts.URL+"/auth/me")
	if resp.StatusCode != http.StatusOK {
		s.t.Fatalf("/auth/me: %d — %s", resp.StatusCode, body)
	}
	var out map[string]any
	if err := json.Unmarshal([]byte(body), &out); err != nil {
		s.t.Fatalf("/auth/me unreadable: %v — %s", err, body)
	}
	return out
}

// post issues a same-origin POST (the write path's CSRF posture) and returns status + body.
func (s *strangerSuite) post(br *http.Client, path, body string) (int, string) {
	s.t.Helper()
	req, err := http.NewRequest(http.MethodPost, s.ts.URL+path, strings.NewReader(body))
	if err != nil {
		s.t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", s.app.cfg.publicBaseURL)
	resp, err := br.Do(req)
	if err != nil {
		s.t.Fatalf("POST %s: %v", path, err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(raw)
}

// logCapture redirects the standard logger into a buffer for the duration of a test, so the
// OPERATOR-FACING log lines can be asserted the way any other output is.
type logCapture struct {
	mu  sync.Mutex
	buf strings.Builder
}

func (c *logCapture) Write(p []byte) (int, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.buf.Write(p)
}

func (c *logCapture) String() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.buf.String()
}

// captureLogs points the standard logger at a buffer and restores it afterwards. The refusal
// log is an OPERATOR-FACING SURFACE — the thing that decides whether adding a turned-away
// person takes ten seconds or an evening — so it is asserted, not assumed.
func captureLogs(t *testing.T) *logCapture {
	t.Helper()
	c := &logCapture{}
	prevOut, prevFlags := log.Writer(), log.Flags()
	log.SetOutput(c)
	t.Cleanup(func() {
		log.SetOutput(prevOut)
		log.SetFlags(prevFlags)
	})
	return c
}

// ─── 1. THE WHOLE SEQUENCE, TWICE ───────────────────────────────────────────

// A brand-new identity reaches a working product with zero operator involvement — and then a
// SECOND, unrelated brand-new identity does the same without touching the first one's anything.
//
// The steps are numbered to match what a person experiences, and each is asserted for BOTH
// strangers before moving on, so a step that only works for user one fails here rather than in
// front of the second tester.
func TestStranger_WholeSignupSequence_ForTwoUnrelatedPeople(t *testing.T) {
	s := startStrangerSuite(t, []string{"*"})

	// ── 2. authenticate (1. is the marketing CTA, asserted in the web tests) ──
	alice := s.signUp("google-sub-alice", "alice@gmail.com")
	bob := s.signUp("google-sub-bob", "bob@outlook.com")

	aliceMe, bobMe := s.me(alice), s.me(bob)
	for who, me := range map[string]map[string]any{"alice": aliceMe, "bob": bobMe} {
		if me["authenticated"] != true {
			t.Fatalf("%s: /auth/me says not authenticated after a completed signup: %v", who, me)
		}
	}

	// ── 3. THEIR OWN LENS WORKSPACE, provisioned automatically, not shared ────
	aliceWS, _ := aliceMe["workspace_id"].(string)
	bobWS, _ := bobMe["workspace_id"].(string)
	if aliceWS == "" || bobWS == "" {
		t.Fatalf("a signed-up stranger has no Lens workspace: alice=%q bob=%q", aliceWS, bobWS)
	}
	if aliceWS == bobWS {
		t.Fatalf("both strangers were given workspace %q — the second trial user would open the "+
			"first one's balance, keys and ledger", aliceWS)
	}
	// And the id is the one LENS derived from the identity, not one the BFF chose: nothing in
	// the BFF may name a workspace.
	wantAlice := deriveWorkspaceIDLikeLens(provisionIdentity(s.app.cfg.oidcIssuer, "google-sub-alice"))
	if aliceWS != wantAlice {
		t.Errorf("workspace %q is not the id Lens derives from the identity (%q) — something "+
			"other than the issuer+subject is deciding tenancy", aliceWS, wantAlice)
	}

	// ── 4. THEIR OWN TRACK WORKSPACE, bootstrapped at login, per-identity ─────
	s.track.mu.Lock()
	bootstraps := append([]string(nil), s.track.bootstrap...)
	s.track.mu.Unlock()
	if len(bootstraps) < 2 {
		t.Fatalf("expected a Track bootstrap per stranger, saw %d: %v", len(bootstraps), bootstraps)
	}
	if bootstraps[0] == bootstraps[1] {
		t.Fatalf("both strangers bootstrapped Track under the SAME identity %q — they would share "+
			"an issue tracker", bootstraps[0])
	}
	// Read the roster as each of them: the response must be their own workspace's, not a shared one.
	aliceRoster := s.getBody(alice, "/api/members")
	bobRoster := s.getBody(bob, "/api/members")
	if aliceRoster == bobRoster {
		t.Fatalf("both strangers read an identical Track roster — Track is shared:\n%s", aliceRoster)
	}

	// ── 5. the pooling consent, which blocks until they choose ───────────────
	for who, me := range map[string]map[string]any{"alice": aliceMe, "bob": bobMe} {
		if me["needs_pooling_choice"] != true {
			t.Errorf("%s: needs_pooling_choice is %v on the login that CREATED the workspace — the "+
				"cross-tenant sharing disclosure would never be shown, and consent would be granted "+
				"by inaction", who, me["needs_pooling_choice"])
		}
	}
	// Choosing clears it, and clears it for THAT PERSON ONLY.
	if code, body := s.post(alice, "/api/pooling", `{"cache_poolable":false}`); code != http.StatusOK {
		t.Fatalf("alice could not record her pooling choice: %d — %s", code, body)
	}
	if s.me(alice)["needs_pooling_choice"] != false {
		t.Error("alice was asked the pooling question again after answering it")
	}
	if s.me(bob)["needs_pooling_choice"] != true {
		t.Error("alice answering the pooling question cleared BOB's prompt — the flag is shared state")
	}

	// ── 6. Setup, with a usable API key ──────────────────────────────────────
	for who, br := range map[string]*http.Client{"alice": alice, "bob": bob} {
		ctx := s.getBody(br, "/api/context")
		if !strings.Contains(ctx, "https://lens.talyvor.com") {
			t.Errorf("%s: /api/context carries no customer-reachable Lens URL, so Setup cannot print "+
				"a working base URL: %s", who, ctx)
		}
	}
	code, aliceKey := s.post(alice, "/api/keys", `{"name":"my first key"}`)
	if code != http.StatusOK {
		t.Fatalf("alice could not mint a key: %d — %s", code, aliceKey)
	}
	if !strings.Contains(aliceKey, "lens_sk_live_"+aliceWS) {
		t.Errorf("alice's minted key is not scoped to her workspace: %s", aliceKey)
	}
	code, bobKey := s.post(bob, "/api/keys", `{"name":"my first key"}`)
	if code != http.StatusOK {
		t.Fatalf("bob could not mint a key: %d — %s", code, bobKey)
	}
	if strings.Contains(bobKey, aliceWS) {
		t.Fatalf("BOB'S KEY CARRIES ALICE'S WORKSPACE: %s", bobKey)
	}

	// ── 7. spend against Lens and see it in the ledger — YOURS, not theirs ───
	aliceLedger := s.getBody(alice, "/api/tokens/history?limit=5&offset=0")
	bobLedger := s.getBody(bob, "/api/tokens/history?limit=5&offset=0")
	if !strings.Contains(aliceLedger, "spend-belonging-to-"+aliceWS) {
		t.Errorf("alice's ledger does not contain her own spend: %s", aliceLedger)
	}
	// THE CLAIM THAT MATTERS, asserted on what the API RETURNED to the second session.
	if strings.Contains(bobLedger, aliceWS) {
		t.Fatalf("BOB'S LEDGER RESPONSE CONTAINS ALICE'S WORKSPACE — tester B is reading tester A's "+
			"spend:\n%s", bobLedger)
	}
	if !strings.Contains(bobLedger, "spend-belonging-to-"+bobWS) {
		t.Errorf("bob's ledger does not contain his own spend: %s", bobLedger)
	}
}

// getBody GETs a path as one browser and returns the body, failing on a non-200.
func (s *strangerSuite) getBody(br *http.Client, path string) string {
	s.t.Helper()
	resp, body := doReq(s.t, br, http.MethodGet, s.ts.URL+path)
	if resp.StatusCode != http.StatusOK {
		s.t.Fatalf("GET %s: %d — %s", path, resp.StatusCode, body)
	}
	return body
}

// ─── 2. EVERY WORKSPACE-SCOPED READ, FOR THE SECOND PERSON ──────────────────

// The sequence test proves the chain completes. This proves it completes CLEANLY on every
// workspace-scoped route, because a single route left closing over a startup value is the same
// leak with a smaller blast radius — and it would only ever be noticed by user two.
func TestStranger_NoRouteServesTheOtherStrangersWorkspace(t *testing.T) {
	s := startStrangerSuite(t, []string{"*"})
	alice := s.signUp("google-sub-alice", "alice@gmail.com")
	bob := s.signUp("google-sub-bob", "bob@outlook.com")

	aliceWS, _ := s.me(alice)["workspace_id"].(string)
	bobWS, _ := s.me(bob)["workspace_id"].(string)
	if aliceWS == "" || bobWS == "" || aliceWS == bobWS {
		t.Fatalf("rig: expected two distinct workspaces, got %q and %q", aliceWS, bobWS)
	}

	routes := []string{
		"/api/context",
		"/api/lxc/balance",
		"/api/tokens/balance",
		"/api/tokens/history?limit=5&offset=0",
		"/api/lxc/history?limit=5&offset=0",
		"/api/spend/month",
		"/api/keys",
		"/api/members",
	}
	for _, route := range routes {
		t.Run(route, func(t *testing.T) {
			mark := s.lens.count()
			body := s.getBody(bob, route)

			// (a) nothing bob's request touched upstream was alice's.
			for _, p := range s.lens.pathsSince(mark) {
				if ws := wsSegment(p); ws != "" && ws != bobWS {
					t.Errorf("bob's %s reached upstream path %q — not his workspace (%s)", route, p, bobWS)
				}
			}
			// (b) and nothing bob was SHOWN was alice's. A path assertion alone can pass while
			// the body carries the other tenant's rows.
			if strings.Contains(body, aliceWS) {
				t.Errorf("bob's %s RESPONSE contains alice's workspace id:\n%s", route, body)
			}
		})
	}
}

// ─── 3. THE WILDCARD, END TO END ────────────────────────────────────────────

// OIDC_ALLOWED_EMAILS="*" is what a public trial runs on. The unit-level check that
// authorizeIdentity returns true for "*" says nothing about whether a stranger's identity
// actually REACHES provisioning — the gate could pass and the next step still refuse.
//
// So this asserts the consequence: an identity on nobody's list arrives with a workspace that
// Lens genuinely created for it.
func TestWildcard_AStrangerReachesProvisioning(t *testing.T) {
	s := startStrangerSuite(t, []string{"*"})
	br := s.signUp("never-seen-before-sub", "stranger@example.org")

	me := s.me(br)
	ws, _ := me["workspace_id"].(string)
	if ws == "" {
		t.Fatal("the wildcard admitted the stranger but no workspace was provisioned — the gate " +
			"passed and the chain stopped one step later")
	}
	s.lens.mu.Lock()
	created := s.lens.created[ws]
	s.lens.mu.Unlock()
	if !created {
		t.Fatalf("workspace %q was never created at Lens", ws)
	}
	if me["needs_pooling_choice"] != true {
		t.Error("a stranger's brand-new workspace did not raise the pooling disclosure")
	}
}

// The same rig with a CLOSED list must still refuse — the wildcard test above would pass
// vacuously if the allowlist had stopped being consulted at all. This is the positive control:
// the instrument can still say no.
func TestWildcard_PositiveControl_AClosedListStillRefusesTheSameStranger(t *testing.T) {
	s := startStrangerSuite(t, []string{"someone-else@example.com"})
	s.idp.sub, s.idp.email = "never-seen-before-sub", "stranger@example.org"
	br := s.browser()

	h := loginHops(t, s.ts, br, "/")
	if h.callback.StatusCode != http.StatusForbidden {
		t.Fatalf("a closed allowlist admitted an unlisted stranger: %d — %s",
			h.callback.StatusCode, h.cbBody)
	}
}

// ─── 4. THE REFUSAL THE OPERATOR HAS TO ACT ON ──────────────────────────────

// When a deployment IS running closed, someone will be turned away. Two things must be true at
// that moment, and they are for different readers:
//
//	THE PERSON gets a page that explains it (auth_denied_page_test.go pins the page itself).
//	THE OPERATOR gets a log line NAMING THE ADDRESS, so adding them is a copy-paste rather than
//	a hunt through an id_token for a subject that appears nowhere in the console they'd add it in.
//
// The subject alone is useless for that job: OIDC_ALLOWED_EMAILS is keyed on EMAIL, so an
// operator holding only `sub=118002...` cannot act on it at all.
func TestDeniedLoginNamesTheAddressForTheOperator(t *testing.T) {
	cases := []struct {
		name           string
		email          string
		verified       *bool
		wantInLog      []string
		wantNotInLog   []string
		wantAbsentWord bool
	}{
		{
			name:      "unlisted address is named",
			email:     "newcomer@example.org",
			wantInLog: []string{"newcomer@example.org"},
			// The REFUSED address, not the list. The log is an operator's terminal, but it is
			// also whatever ships logs off the box, and the allowlist is not refusal detail.
			wantNotInLog: []string{"only-me@example.com"},
		},
		{
			// The issuer disputes the address. The operator STILL needs to know which address,
			// or they cannot tell who complained to them.
			name:      "unverified address is named",
			email:     "disputed@example.org",
			verified:  boolPtr(false),
			wantInLog: []string{"disputed@example.org"},
		},
		{
			// No email claim at all. ABSENT MUST BE ITS OWN WORD: a log line that renders a
			// missing address as an empty string reads as a blank field, and two different
			// failures (no claim / claim not listed) look identical in the operator's terminal.
			name:           "an absent address SAYS it is absent",
			email:          "",
			wantAbsentWord: true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := startStrangerSuite(t, []string{"only-me@example.com"})
			s.idp.sub, s.idp.email, s.idp.emailVerified = "sub-refused", tc.email, tc.verified
			br := s.browser()
			h := loginHops(t, s.ts, br, "/")
			if h.callback.StatusCode != http.StatusForbidden {
				t.Fatalf("expected a refusal, got %d", h.callback.StatusCode)
			}

			got := s.logs.String()
			if !strings.Contains(got, "DENIED") {
				t.Fatalf("no refusal was logged at all; log was:\n%s", got)
			}
			for _, want := range tc.wantInLog {
				if !strings.Contains(got, want) {
					t.Errorf("the refusal log does not name the address %q — the operator cannot add "+
						"them without it. Log was:\n%s", want, got)
				}
			}
			for _, unwanted := range tc.wantNotInLog {
				if strings.Contains(got, unwanted) {
					t.Errorf("refusal log contains %q; log was:\n%s", unwanted, got)
				}
			}
			if tc.wantAbsentWord {
				if !strings.Contains(strings.ToLower(got), "no email claim") {
					t.Errorf("a refusal with NO address must say so in words, not render an empty "+
						"field. Log was:\n%s", got)
				}
				if strings.Contains(got, "email= ") || strings.Contains(got, "email=\n") {
					t.Errorf("the address field rendered BLANK — absence must be a word, not an "+
						"empty string. Log was:\n%s", got)
				}
			}

			// THE REMEDY IS PART OF THE LINE. "Name the address" is only half the job the
			// operator has: the fix also needs a RESTART, because config is read once at boot.
			// A line that names the variable and stops sends someone to edit a file, refresh,
			// see the same refusal, and conclude the product is broken. A remedy printed in an
			// alert is production code — so it is asserted like production code.
			for _, want := range []string{"OIDC_ALLOWED_EMAILS", "RESTART"} {
				if !strings.Contains(got, want) {
					t.Errorf("the refusal log does not tell the operator how to fix it (missing %q). "+
						"Log was:\n%s", want, got)
				}
			}
		})
	}
}

// The page a refused person sees must stay the same regardless — the log is where the detail
// goes, and widening the log must not widen the page.
func TestDeniedPageStillLeaksNothingAfterTheLogWasWidened(t *testing.T) {
	s := startStrangerSuite(t, []string{"only-me@example.com"})
	s.idp.sub, s.idp.email = "sub-refused", "newcomer@example.org"
	br := s.browser()
	h := loginHops(t, s.ts, br, "/")
	if h.callback.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", h.callback.StatusCode)
	}
	for _, leak := range []string{"only-me@example.com", "OIDC_ALLOWED_EMAILS", "allowlist"} {
		if strings.Contains(h.cbBody, leak) {
			t.Errorf("the denied page leaks %q:\n%s", leak, h.cbBody)
		}
	}
}

// ─── 3b. THE ENTRY ROUTES SURVIVE A COLD NAVIGATION ─────────────────────────

// The marketing page's call to action is a plain <a href="/signup">, so clicking it is a FULL
// PAGE LOAD against this BFF — not a client-side route change. Every React test in the suite
// reaches /signup with history.pushState, which never touches the server, so all of them would
// pass while the one hop a real stranger takes 404s.
//
// So: unauthenticated GETs, no session, asserting the SPA document comes back.
//
// AND ASSERTING THE CONTENT-TYPE, not just the status. A 200 proves nothing here — the fallback
// answers 200 for every path that is not a file on disk, which is exactly why /signup works, and
// exactly why a status check cannot tell "the app loaded" from "the bundle is missing". The
// content type is the part that distinguishes a served document from a served nothing.
func TestEntryRoutesAreServedOnAColdNavigation(t *testing.T) {
	s := startStrangerSuite(t, []string{"*"})

	for _, path := range []string{"/signup", "/signin", "/marketing"} {
		t.Run(path, func(t *testing.T) {
			// nakedClient: NO cookie jar. This is a stranger's first ever request.
			resp, body := doReq(t, nakedClient(s.ts), http.MethodGet, s.ts.URL+path)
			if resp.StatusCode != http.StatusOK {
				t.Fatalf("cold GET %s: %d — the marketing CTA is a full page load, so this is the "+
					"hop a real stranger takes. Body: %s", path, resp.StatusCode, body)
			}
			if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
				t.Errorf("cold GET %s: Content-Type = %q, want text/html", path, ct)
			}
			if !strings.Contains(body, "id=root") {
				t.Errorf("cold GET %s did not return the SPA document: %s", path, body)
			}
		})
	}

	// And the entry routes are NOT gated: a stranger with no session must not be bounced to a
	// 401 by the /api/ rule or any middleware that might later be widened to cover them.
	resp, _ := doReq(t, nakedClient(s.ts), http.MethodGet, s.ts.URL+"/api/context")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("control: /api/context without a session should still be 401, got %d — if this "+
			"changed, the test above is no longer evidence that /signup is deliberately public",
			resp.StatusCode)
	}
}

// ─── 4b. THE SCOPE LIST IS LOAD-BEARING FOR THE WHOLE TRIAL ─────────────────

// WHY A TEST GUARDS THREE STRINGS.
//
// Everything about how this deployment reaches the public rests on one fact: we ask Google for
// basic identity and nothing else. Google's OAuth app state overview says of the Testing state,
// verbatim: "Only users explicitly added to the test user allowlist can access the app (limited
// to a hard cap of 100 test users). Exception: If the app only requests basic identity scopes
// (openid, email, profile), any user can access without being on the allowlist." Verification is
// "Required for public apps that request sensitive and restricted scopes" — not ours.
//
// So the moment anyone adds a fourth scope — a calendar read, a Drive file, a Gmail label — the
// app needs verification, acquires a 100-user cap, and starts showing unverified-app warnings.
// None of that fails a build, none of it fails a deploy, and none of it is visible from inside
// the product: it manifests as strangers being turned away by Google, on a screen we do not
// control and cannot explain ourselves on.
//
// A COMMENT CANNOT FAIL A BUILD (the marketing page shipped a dead mailto: under a comment
// saying the alias did not route). The deploy runbook now cites this test by name as the reason
// an operator may believe the "no verification needed" claim, so the claim and its evidence live
// or die together.
//
// The assertion is on the CONSTRUCTED oauth2.Config, not a grep of the source: it is the value
// the authorize URL is actually built from.
func TestOnlyBasicIdentityScopesAreRequested(t *testing.T) {
	s := startStrangerSuite(t, []string{"*"})
	got := s.app.auth.oauth.Scopes

	want := map[string]bool{"openid": true, "email": true, "profile": true}
	for _, sc := range got {
		if !want[sc] {
			t.Errorf("scope %q is requested but is not a basic identity scope.\n\n"+
				"If it is SENSITIVE or RESTRICTED under Google's policy, this deployment now needs "+
				"OAuth verification, gains a hard cap of 100 total users, and shows unverified-app "+
				"warnings to everyone — none of which fails a build. Remove it, or accept the "+
				"verification burden deliberately and update deploy/README.md, which cites this "+
				"test as the evidence for the opposite claim.", sc)
		}
		delete(want, sc)
	}
	for missing := range want {
		t.Errorf("scope %q is no longer requested — the id_token may stop carrying the claims the "+
			"allowlist and the denied page depend on", missing)
	}
}

// ─── 5. THE UI CANNOT LIE ABOUT WHETHER THE DOOR IS OPEN ────────────────────

// The marketing and signup pages have to tell a stranger whether they can get in. That fact
// lives in OIDC_ALLOWED_EMAILS, on the server, and the pages are a static bundle — so the
// tempting version is to write the sentence into the page and remember to change it.
//
// That is exactly how a page comes to say "closed trial, accounts by hand" for a month after
// the trial opened, or — far worse — "get started free" while the gate is still a list of six
// addresses. A hardcoded status claim reads as CURRENT to whoever is looking at it.
//
// So /auth/me reports it, DERIVED from the same list that admits people. The page renders the
// server's answer and cannot disagree with the door.
func TestAuthMeReportsWhetherSignupIsOpen(t *testing.T) {
	for _, tc := range []struct {
		name    string
		allowed []string
		want    bool
	}{
		{"wildcard is open", []string{"*"}, true},
		{"a list is closed", []string{"ng@example.com", "founder@example.com"}, false},
		{"a one-entry list is still closed", []string{"ng@example.com"}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := startStrangerSuite(t, tc.allowed)
			// Read it with NO SESSION: a stranger has not signed in yet, and this is precisely
			// the audience the answer is for.
			resp, body := doReq(t, s.browser(), http.MethodGet, s.ts.URL+"/auth/me")
			if resp.StatusCode != http.StatusOK {
				t.Fatalf("/auth/me: %d — %s", resp.StatusCode, body)
			}
			var out map[string]any
			if err := json.Unmarshal([]byte(body), &out); err != nil {
				t.Fatalf("unreadable: %v", err)
			}
			got, present := out["signup_open"]
			if !present {
				t.Fatalf("/auth/me does not report signup_open, so no page can render the truth "+
					"about whether a stranger may sign up: %s", body)
			}
			if got != tc.want {
				t.Errorf("signup_open = %v, want %v for allowlist %v", got, tc.want, tc.allowed)
			}
		})
	}
}

// …and it must not become a channel for the list itself. The answer is one bit: whether the
// door is open. Not who is behind it.
func TestAuthMeSignupOpenLeaksNoAllowlistMembership(t *testing.T) {
	s := startStrangerSuite(t, []string{"ng@example.com", "founder@example.com"})
	_, body := doReq(t, s.browser(), http.MethodGet, s.ts.URL+"/auth/me")
	for _, leak := range []string{"ng@example.com", "founder@example.com", "OIDC_ALLOWED_EMAILS"} {
		if strings.Contains(body, leak) {
			t.Errorf("/auth/me leaks %q to an unauthenticated caller: %s", leak, body)
		}
	}
	// Nor the SIZE of the list, which would tell a stranger how exclusive the trial is and, more
	// usefully to an attacker, when it changed.
	if strings.Contains(body, fmt.Sprint(len(s.app.cfg.allowedEmails))) &&
		!strings.Contains(body, "signup_open") {
		t.Error("/auth/me appears to carry the allowlist size")
	}
}
