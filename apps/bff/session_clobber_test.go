package main

// THE SESSION WRITE THAT REVERTS ANOTHER REQUEST'S WRITE.
//
// `ttlMap.update` (auth.go) exists for exactly one reason, and its own doc comment names the two
// call sites it was written for:
//
//	"The read-modify-write it replaces is the reason it exists: get → change one field → put is
//	 three separate critical sections, so a concurrent handler that changed a DIFFERENT field in
//	 between (the pooling choice clearing needsPoolingChoice, a Track bootstrap writing back its
//	 workspace) has its change silently overwritten by the stale copy."
//
// Both of the handlers it names still did get → change → put, and BOTH ARE FIXED HERE — but they
// are not the same size of hole, and the difference was MEASURED rather than assumed:
//
//	track_tenant.go  trackWorkspaceFor    read → POST /v1/bootstrap → put   ⚠ A ROUND TRIP WIDE
//	tenant.go        handlePoolingChoice  PUT /cache-poolable → read → put    a few instructions
//
// ⚠ THE PREDICTION THAT BOTH READ BEFORE THEIR UPSTREAM CALL WAS WRONG, AND IS KEPT HERE RATHER
// THAN QUIETLY CORRECTED. handlePoolingChoice reads the session AFTER setCachePoolable returns,
// so its window holds no I/O and no black-box test can force a loss through it (test 2 was
// written to fail and passed). Everything below that reds is the Track bootstrap's window. The
// pooling site is fixed anyway — a three-critical-section read-modify-write is one either way —
// and it is the census in test 5, not a behavioural test, that holds it.
//
// The tests below do not sleep and do not race a timer: the fake upstream BLOCKS inside the
// request the BFF is making, the second request is issued while the first is parked there, and
// only then is the first released. The interleaving is chosen, not hoped for, so a red here is
// a red every run.
//
// WHAT THE WIDE ONE COSTS THE PERSON USING THE PRODUCT, WORST FIRST:
//
//	 1. SIGNING OUT DOES NOT SIGN THEM OUT. `ttlMap.put` stores unconditionally, so a bootstrap
//	    that read the session before POST /auth/logout deleted it puts the row back. The session
//	    is live again for the rest of its TTL. (test 3)
//	 2. A RE-MINTED LENS TOKEN IS REPLACED BY THE EXPIRED ONE. refreshWorkspaceToken exists
//	    because hours 8→12 of every session were spent holding a dead credential; a stale put
//	    hands that credential back and every workspace-scoped read 401s. (test 4)
//	 3. The pooling answer comes back. `needsPoolingChoice` gates the whole app behind the
//	    sharing disclosure, so an answered screen is put in front of the person again — "I
//	    answered that question and it asked again", the symptom `update`'s comment predicted.
//	    And `cachePoolable` reverts with it, so the settings screen would show sharing ON for a
//	    workspace Lens has recorded as OFF. (test 1)
//
// These are BEHAVIOURAL tests against the mux, not assertions about which helper is called: they
// stay true for any fix that makes the write atomic, and they fail for any that does not.

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
)

// gate parks a fake upstream's handler inside the request, so a test can place a SECOND request
// in the middle of the first one. `entered` is buffered so the handler never blocks announcing
// itself; `release` is closed by the test.
// ⚠ THE RELEASE IS REGISTERED AS A CLEANUP, NOT LEFT TO THE HAPPY PATH. A t.Fatalf between
// arming and releasing runs cleanups while a handler is still parked, and httptest.Server.Close
// waits on it — so the first real failure would surface as a package-level timeout with no
// message rather than as the assertion that failed. Measured: it did, before this was here.
type gate struct {
	armed    atomic.Bool
	entered  chan struct{}
	release  chan struct{}
	released sync.Once
}

func newGate() *gate {
	return &gate{entered: make(chan struct{}, 1), release: make(chan struct{})}
}

func (g *gate) let() { g.released.Do(func() { close(g.release) }) }

func (g *gate) hold() {
	if !g.armed.Load() {
		return
	}
	select {
	case g.entered <- struct{}{}:
	default:
	}
	<-g.release
}

// awaitEntry fails the test rather than hanging forever if the handler is never reached — a
// deadlocked test that times out at the package level reports nothing about which step stalled.
func (g *gate) awaitEntry(t *testing.T, what string) {
	t.Helper()
	select {
	case <-g.entered:
	case <-time.After(5 * time.Second):
		t.Fatalf("%s: the upstream handler was never reached, so nothing was interleaved", what)
	}
}

// clobberEnv is a BFF with a fake Lens and a fake Track, each gateable.
type clobberEnv struct {
	app        *app
	lensGate   *gate // parks PUT /v1/workspaces/{ws}/cache-poolable
	trackGate  *gate // parks POST /v1/bootstrap
	provisions atomic.Int32
	// lensExpiry is what /v1/provision reports as expires_at. Overridable so a test can hand
	// back a token that is ALREADY within refresh range and watch the next request re-mint.
	lensExpiry atomic.Value // string
}

func newClobberEnv(t *testing.T) *clobberEnv {
	t.Helper()
	env := &clobberEnv{lensGate: newGate(), trackGate: newGate()}
	env.lensExpiry.Store(time.Now().Add(8 * time.Hour).UTC().Format(time.RFC3339))

	lens := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == provisionPath:
			// A DIFFERENT TOKEN EVERY TIME, so "was this re-minted?" is answerable from the
			// stored value rather than from a call count.
			n := env.provisions.Add(1)
			_, _ = io.WriteString(w, fmt.Sprintf(
				`{"workspace_id":"u-alice","created":false,"cache_poolable":true,"token":"tok-%d","expires_at":%q}`,
				n, env.lensExpiry.Load().(string)))
		case strings.HasSuffix(r.URL.Path, "/cache-poolable"):
			env.lensGate.hold()
			_, _ = io.WriteString(w, `{"cache_poolable":false}`)
		default:
			w.WriteHeader(http.StatusNotFound)
			_, _ = io.WriteString(w, `{"error":"no such lens route"}`)
		}
	}))
	t.Cleanup(lens.Close)

	track := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == trackBootstrapPath {
			env.trackGate.hold()
			_, _ = io.WriteString(w, `{"workspace_id":"ws-alice","slug":"s-alice","created":true}`)
			return
		}
		_, _ = io.WriteString(w, `[{"path":"`+r.URL.Path+`"}]`)
	}))
	t.Cleanup(track.Close)
	// ⚠ REGISTERED AFTER BOTH SERVERS, BECAUSE t.Cleanup IS LIFO. httptest.Server.Close waits for
	// in-flight handlers, so a cleanup that closes the server before the gate is released deadlocks
	// on any t.Fatalf taken while a handler is parked — the failure then arrives as a package-level
	// timeout with no message. Measured: it did, at the first red run.
	t.Cleanup(func() { env.lensGate.let(); env.trackGate.let() })

	cfg := config{
		lensBaseURL: lens.URL, provisionSecret: "provision-secret",
		authMode: authModeOIDC, oidcIssuer: "https://idp.example.com",
		publicBaseURL: "https://app.talyvor.com", sessionTTL: time.Hour,
		trackBaseURL: track.URL, trackGatewaySecret: testTrackSecret,
		docsBaseURL: "http://127.0.0.1:1", docsGatewaySecret: "gwsecret_docs",
	}
	auth := newSessionOnlyAuthenticator(cfg)
	// handleAuthUnavailable 503s when `verifier` is nil, so POST /auth/logout would never reach the
	// store. Nothing here verifies an id_token — the verifier is never called — but the handler must
	// be reachable for the logout test to be about the seam it is about rather than about a 503.
	auth.verifier = oidc.NewVerifier(cfg.oidcIssuer, nil, &oidc.Config{ClientID: "test-client"})
	env.app = newApp(cfg, auth)
	env.app.cfg.webDist = t.TempDir()
	return env
}

// seed stores one session and returns its cookie.
func (e *clobberEnv) seed(sid string, s session) *http.Cookie {
	s.sub, s.email = "sub-alice", "alice@example.com"
	s.expires = time.Now().Add(time.Hour)
	if s.workspaceID == "" {
		s.workspaceID = "u-alice"
	}
	// A tenant needs BOTH a workspace and a token (tenant.ok), or requireTenant answers 409 and
	// the interleaving under test never happens.
	if s.lensToken == "" {
		s.lensToken = "tok-seed"
	}
	e.app.auth.sessions.put(sid, s)
	return &http.Cookie{Name: sessionCookieName, Value: sid}
}

func (e *clobberEnv) stored(t *testing.T, sid string) session {
	t.Helper()
	s, ok := e.app.auth.sessions.get(sid)
	if !ok {
		t.Fatalf("session %s is gone", sid)
	}
	return s
}

// poolingPost issues the same-Origin POST the settings control and the signup prompt both make.
func (e *clobberEnv) poolingPost(sess *http.Cookie) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/pooling", strings.NewReader(`{"cache_poolable":false}`))
	req.Header.Set("Origin", "https://app.talyvor.com")
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(sess)
	rec := httptest.NewRecorder()
	e.app.mux.ServeHTTP(rec, req)
	return rec
}

// membersGet is any Track read; it is the route that runs trackWorkspaceFor.
func (e *clobberEnv) membersGet(sess *http.Cookie) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/api/members", nil)
	req.AddCookie(sess)
	rec := httptest.NewRecorder()
	e.app.mux.ServeHTTP(rec, req)
	return rec
}

/* ── 1. The Track bootstrap reverts the pooling answer ────────────────────── */

// TestTrackBootstrapDoesNotRevertThePoolingAnswer parks the Track bootstrap, answers the sharing
// question while it is parked, and then lets the bootstrap finish.
//
// needsPoolingChoice is what gates the whole app behind the disclosure screen (BffContext
// carries it to the browser). Restoring it puts an answered question back in front of the person.
func TestTrackBootstrapDoesNotRevertThePoolingAnswer(t *testing.T) {
	env := newClobberEnv(t)
	sess := env.seed("sid-1", session{needsPoolingChoice: true, cachePoolable: true})

	env.trackGate.armed.Store(true)
	done := make(chan int, 1)
	go func() { done <- env.membersGet(sess).Code }()
	env.trackGate.awaitEntry(t, "track bootstrap")

	// The person answers the sharing question while the bootstrap is in flight.
	if rec := env.poolingPost(sess); rec.Code != http.StatusOK {
		t.Fatalf("POST /api/pooling: %d (%s)", rec.Code, rec.Body.String())
	}
	if got := env.stored(t, "sid-1"); got.needsPoolingChoice {
		t.Fatalf("the pooling POST itself did not clear needsPoolingChoice — this test's premise is broken")
	}

	env.trackGate.let()
	if code := <-done; code != http.StatusOK {
		t.Fatalf("GET /api/members: %d", code)
	}

	got := env.stored(t, "sid-1")
	if got.needsPoolingChoice {
		t.Errorf("needsPoolingChoice is true again: the Track bootstrap wrote back the whole session " +
			"it had read BEFORE the answer, so the disclosure screen reappears for someone who answered it")
	}
	if got.cachePoolable {
		t.Errorf("cachePoolable is true again: the recorded consent was reverted to the pre-answer value, " +
			"so the settings screen would show sharing ON for a workspace Lens has stored as OFF")
	}
}

/* ── 2. The other direction — AND THE PREDICTION THE MEASUREMENT REFUTED ──── */

// TestPoolingWriteDoesNotForgetTheTrackWorkspace was written to fail and DID NOT.
//
// ⚠ THE ORIGINAL PREDICTION, KEPT RATHER THAN QUIETLY REPLACED: "the pooling handler holds a
// copy read before its own upstream call, so a Track workspace resolved during that call is
// dropped." MEASURED at 15e2511, with this exact interleaving, it PASSED — because
// handlePoolingChoice reads the session AFTER setCachePoolable returns, not before. Its window
// is a handful of instructions with no I/O in it, so no black-box test can force the loss; only
// the Track bootstrap's window holds a round trip, which is why tests 1, 3 and 4 are the ones
// that red. tenant.go's read-modify-write is still a read-modify-write and is still fixed here —
// it is covered by the census in test 5, not by a behavioural test that cannot see it.
//
// ⚠ SO WHY KEEP A TEST THAT WAS GREEN FIRST? Because "the read happens after the call" is a
// one-line ordering nobody has written down anywhere else, and moving it back above the call
// would restore the wide window in silence. This test is the thing that would notice. It is NOT
// trusted on its green: control C6 moves that read above setCachePoolable and requires this test
// to red — a guard whose only evidence is that it passed is not a guard.
func TestPoolingWriteDoesNotForgetTheTrackWorkspace(t *testing.T) {
	env := newClobberEnv(t)
	sess := env.seed("sid-2", session{needsPoolingChoice: true, trackWorkspaceID: ""})

	env.lensGate.armed.Store(true)
	done := make(chan int, 1)
	go func() { done <- env.poolingPost(sess).Code }()
	env.lensGate.awaitEntry(t, "lens cache-poolable")

	if rec := env.membersGet(sess); rec.Code != http.StatusOK {
		t.Fatalf("GET /api/members: %d (%s)", rec.Code, rec.Body.String())
	}
	if got := env.stored(t, "sid-2"); got.trackWorkspaceID == "" {
		t.Fatalf("the Track read itself did not store a workspace — this test's premise is broken")
	}

	env.lensGate.let()
	if code := <-done; code != http.StatusOK {
		t.Fatalf("POST /api/pooling: %d", code)
	}

	if got := env.stored(t, "sid-2"); got.trackWorkspaceID == "" {
		t.Errorf("trackWorkspaceID is empty again: the pooling write put back a session it had read " +
			"BEFORE its upstream call, discarding the workspace the Track bootstrap stored during it. " +
			"That read must stay below setCachePoolable, and the write must merge rather than replace")
	}
}

/* ── 3. An in-flight request resurrects a session that logged out ─────────── */

// TestLogoutIsNotUndoneByAnInFlightBootstrap is the same read-modify-write with the worst
// consequence, and it is not about a field at all — it is about the ROW.
//
// `ttlMap.put` stores unconditionally: `s.m[id] = v`. `ttlMap.update` refuses an id that is no
// longer there. So a Track bootstrap that read the session, then had it deleted under it by
// POST /auth/logout, PUTS IT BACK — a signed-out session is alive again for the rest of its TTL,
// and the browser that pressed "sign out" is the only party that thinks it ended. The cookie was
// cleared, so THAT browser cannot use it; anything that already holds the session id can.
//
// Nothing else in this package can catch it: logout is correct, the store is correct, and the
// defect only exists in the seam between one handler's read and its write.
func TestLogoutIsNotUndoneByAnInFlightBootstrap(t *testing.T) {
	env := newClobberEnv(t)
	sess := env.seed("sid-4", session{})

	// ⚠ A SECOND SESSION THAT MUST SURVIVE, AND IT IS NOT DECORATION. Everything else here asserts
	// an ABSENCE, and absence has more than one cause: a store that DESTROYS the session on write
	// passes this test for a reason that is not the one it is named for. Control C5 measured
	// exactly that — `ttlMap.update` mutated to write a zero value made the assertion below pass
	// while every session in the map was being wiped. This one asserts a PRESENCE through the same
	// code path, so the two together can tell "not resurrected" from "annihilated".
	bystander := env.seed("sid-4b", session{})
	if rec := env.membersGet(bystander); rec.Code != http.StatusOK {
		t.Fatalf("bystander GET /api/members: %d (%s)", rec.Code, rec.Body.String())
	}
	if got := env.stored(t, "sid-4b"); got.trackWorkspaceID != "ws-alice" {
		t.Fatalf("the bystander did not store its workspace (%q) — this test's premise is broken",
			got.trackWorkspaceID)
	}

	env.trackGate.armed.Store(true)
	done := make(chan int, 1)
	go func() { done <- env.membersGet(sess).Code }()
	env.trackGate.awaitEntry(t, "track bootstrap")

	req := httptest.NewRequest(http.MethodPost, "/auth/logout", nil)
	req.Header.Set("Origin", "https://app.talyvor.com")
	req.AddCookie(sess)
	rec := httptest.NewRecorder()
	env.app.mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("POST /auth/logout: %d (%s)", rec.Code, rec.Body.String())
	}
	if _, alive := env.app.auth.sessions.get("sid-4"); alive {
		t.Fatalf("logout itself did not delete the session — this test's premise is broken")
	}

	env.trackGate.let()
	<-done

	if _, alive := env.app.auth.sessions.get("sid-4"); alive {
		t.Errorf("the session is alive again after a successful logout: the Track bootstrap stored " +
			"the whole session it had read before the logout, and ttlMap.put re-inserts a deleted id. " +
			"Signing out did not end the session — it ended it until the next in-flight request landed")
	}
	// The other half of the pair: the store must still be storing.
	if got, alive := env.app.auth.sessions.get("sid-4b"); !alive || got.trackWorkspaceID != "ws-alice" {
		t.Errorf("the untouched session is gone or empty (alive=%v ws=%q): the assertion above then "+
			"holds because sessions are being destroyed, not because a logout is being honoured",
			alive, got.trackWorkspaceID)
	}
}

/* ── 4. The Track bootstrap reverts a re-minted Lens token ────────────────── */

// TestTrackBootstrapDoesNotRevertAReMintedLensToken is the authz-carrying direction.
//
// refreshWorkspaceToken re-mints the workspace-scoped JWT just before it expires and stores it
// with `update` — deliberately, "field-by-field", because "a whole-struct put would discard"
// a concurrent change. The Track bootstrap IS that concurrent change, and it puts.
//
// The seeded session holds an expiring token, so the FIRST request through requireTenant
// re-mints. That request is the pooling POST here only because it is a cheap way to reach
// requireTenant; what is asserted is the stored token, not the pooling fields.
func TestTrackBootstrapDoesNotRevertAReMintedLensToken(t *testing.T) {
	env := newClobberEnv(t)
	// Inside the refresh skew ⇒ the next requireTenant re-mints.
	sess := env.seed("sid-3", session{
		lensToken:    "tok-expiring",
		lensTokenExp: time.Now().Add(5 * time.Second),
	})

	env.trackGate.armed.Store(true)
	done := make(chan int, 1)
	go func() { done <- env.membersGet(sess).Code }()
	env.trackGate.awaitEntry(t, "track bootstrap")

	// /api/members is session-gated, not tenant-gated, so the parked request has NOT touched the
	// Lens token. This POST goes through requireTenant and re-mints it.
	if rec := env.poolingPost(sess); rec.Code != http.StatusOK {
		t.Fatalf("POST /api/pooling: %d (%s)", rec.Code, rec.Body.String())
	}
	fresh := env.stored(t, "sid-3").lensToken
	if fresh == "tok-expiring" {
		t.Fatalf("no re-mint happened — this test's premise is broken (provisions=%d)", env.provisions.Load())
	}

	env.trackGate.let()
	if code := <-done; code != http.StatusOK {
		t.Fatalf("GET /api/members: %d", code)
	}

	if got := env.stored(t, "sid-3").lensToken; got != fresh {
		t.Errorf("the stored Lens token went from the re-minted %q back to %q: the Track bootstrap "+
			"wrote back a session read before the re-mint, so every workspace-scoped read now "+
			"carries an expired credential and 401s", fresh, got)
	}
}

/* ── 5. The census: no handler outside login may put a whole session ──────── */

// TestOnlyLoginStoresAWholeSession is the guard the three tests above cannot be: they prove the
// two known handlers are safe, and say nothing about the third one someone adds next week.
//
// ⚠ IT HAS A FLOOR. A census that finds nothing is indistinguishable from a census that cannot
// see, so the login site MUST be found — if the search stops matching, this fails on the floor
// rather than passing on an empty set.
//
// `sessions.put` is legitimate in exactly one place: auth.go's callback, which CREATES the
// session (there is nothing to merge with). Everywhere else the session already exists and a
// whole-struct write is a read-modify-write across three critical sections.
func TestOnlyLoginStoresAWholeSession(t *testing.T) {
	const marker = "sessions.put("
	files := goSourceFiles(t)
	if len(files) == 0 {
		t.Fatal("no non-test Go sources found — this census cannot see anything")
	}

	found := map[string][]int{}
	for _, f := range files {
		for i, line := range readLines(t, f) {
			if strings.Contains(line, marker) {
				found[f] = append(found[f], i+1)
			}
		}
	}

	// THE FLOOR: the one legitimate site must be visible to this search.
	if _, ok := found["auth.go"]; !ok {
		t.Fatalf("the login site (auth.go, %q) was not found: this search matches nothing, so its "+
			"silence about every other file means nothing either", marker)
	}
	if len(found["auth.go"]) != 1 {
		t.Errorf("auth.go holds %d %q calls; the session-creating callback is the only one that "+
			"may store a whole session", len(found["auth.go"]), marker)
	}

	for f, lines := range found {
		if f == "auth.go" {
			continue
		}
		t.Errorf("%s:%v calls %q. That handler already HAS a session: read-modify-write across "+
			"three critical sections reverts whatever another in-flight request stored in between "+
			"(see the tests above). Use sessions.update(sid, func(cur session) session{…}) and "+
			"change only the fields you own.", f, lines, marker)
	}
}

// goSourceFiles lists this package's non-test Go files.
func goSourceFiles(t *testing.T) []string {
	t.Helper()
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("read package dir: %v", err)
	}
	var out []string
	for _, e := range entries {
		n := e.Name()
		if e.IsDir() || !strings.HasSuffix(n, ".go") || strings.HasSuffix(n, "_test.go") {
			continue
		}
		out = append(out, n)
	}
	return out
}

func readLines(t *testing.T, path string) []string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return strings.Split(string(b), "\n")
}
