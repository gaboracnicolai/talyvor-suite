package main

// Track per-session tenancy: each signed-in person reaches THEIR Track workspace.
//
// Track's POST /v1/bootstrap is merged and idempotent, but nothing called it — the BFF still
// pinned TRACK_WORKSPACE_ID from config, so after Lens went per-user every trial user would
// still have shared one Track and seen each other's issues. A route that exists and is never
// invoked is the same shape as a guard that never runs: built, tested, unreachable.
//
// THE TWO PARTIAL-FAILURE RULES ARE TESTED HERE, NOT COMMENTED. They were argued when the
// design was agreed and they are the whole reason Track's failure mode differs from Lens's:
//
//   1. A Track failure must NOT fail login. Lens is the tenancy root — no Lens workspace means
//      no tenant at all, so its failure is a hard stop. Track is one product of several; a
//      Track blip taking out Lens access is strictly worse than no Track workspace.
//   2. A Track failure must NOT be cached in the session. Sessions live 12 hours. Storing
//      "this person has no Track workspace" would freeze a two-second blip into a half-day
//      outage, so the bootstrap is retried on demand instead.

import (
	"encoding/json"
	"go/ast"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// trackUpstream fakes Track: a bootstrap endpoint whose behaviour the test controls, plus the
// read routes, recording the workspace-scoped paths it was asked for.
type trackUpstream struct {
	srv           *httptest.Server
	bootstrapCode atomic.Int32 // 0 ⇒ 200
	bootstrapHits atomic.Int32
	paths         chan string // every /v1/workspaces/... path served
}

func newTrackUpstream(t *testing.T, workspaceFor func(email string) string) *trackUpstream {
	t.Helper()
	u := &trackUpstream{paths: make(chan string, 64)}
	u.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/bootstrap" {
			u.bootstrapHits.Add(1)
			if c := u.bootstrapCode.Load(); c != 0 {
				w.WriteHeader(int(c))
				_, _ = io.WriteString(w, `{"error":"track is having a moment"}`)
				return
			}
			ws := workspaceFor(r.Header.Get("X-User-Email"))
			_, _ = io.WriteString(w, `{"workspace_id":"`+ws+`","slug":"s-`+ws+`","created":true}`)
			return
		}
		select {
		case u.paths <- r.URL.Path:
		default:
		}
		// Echo the workspace segment so a test can see WHICH tenant was addressed.
		_, _ = io.WriteString(w, `[{"path":"`+r.URL.Path+`"}]`)
	}))
	t.Cleanup(u.srv.Close)
	return u
}

// trackApp wires an oidc-mode BFF at the fake Track. Lens is unreachable on purpose: these
// tests are about Track, and a dead Lens must not stop Track from working.
func trackApp(t *testing.T, up *trackUpstream) *app {
	t.Helper()
	cfg := config{
		lensBaseURL: "http://127.0.0.1:1", provisionSecret: "provision-secret",
		authMode: authModeOIDC, oidcIssuer: "https://idp.example.com",
		publicBaseURL: "https://app.talyvor.com", sessionTTL: time.Hour,
		trackBaseURL: up.srv.URL, trackGatewaySecret: testTrackSecret,
		docsBaseURL: "http://127.0.0.1:1", docsGatewaySecret: "gwsecret_docs", docsWorkspaceID: "docs-pinned",
	}
	a := newApp(cfg, newSessionOnlyAuthenticator(cfg))
	a.cfg.webDist = t.TempDir()
	return a
}

// signIn seeds a session the way a completed login leaves one, with a Track workspace already
// resolved (the happy path) or empty (bootstrap failed at login).
func signIn(t *testing.T, a *app, sid, email, trackWS string) *http.Cookie {
	t.Helper()
	a.auth.sessions.put(sid, session{
		sub: "sub-" + email, email: email, expires: time.Now().Add(time.Hour),
		workspaceID: "u-lens-" + email, lensToken: "tok",
		trackWorkspaceID: trackWS,
	})
	return &http.Cookie{Name: sessionCookieName, Value: sid}
}

/* ── Isolation: two sessions, two workspaces ─────────────────────────────── */

// TestTrack_TwoSessionsReachTwoWorkspaces is the defect this closes. Under the pinned id both
// sessions addressed the SAME upstream workspace, so every trial user read every other user's
// issues.
func TestTrack_TwoSessionsReachTwoWorkspaces(t *testing.T) {
	up := newTrackUpstream(t, func(email string) string {
		if strings.HasPrefix(email, "alice") {
			return "ws-alice"
		}
		return "ws-bob"
	})
	a := trackApp(t, up)
	alice := signIn(t, a, "sid-a", "alice@example.com", "ws-alice")
	bob := signIn(t, a, "sid-b", "bob@example.com", "ws-bob")

	if rec := getAs(t, a, alice, "/api/track/issues"); rec.Code != http.StatusOK {
		t.Fatalf("alice: got %d (%s)", rec.Code, rec.Body.String())
	}
	if rec := getAs(t, a, bob, "/api/track/issues"); rec.Code != http.StatusOK {
		t.Fatalf("bob: got %d (%s)", rec.Code, rec.Body.String())
	}

	seen := map[string]bool{}
	for len(seen) < 2 {
		select {
		case p := <-up.paths:
			seen[p] = true
		default:
			t.Fatalf("expected two DIFFERENT upstream paths, saw %v", keysOf(seen))
		}
	}
	if !seen["/v1/workspaces/ws-alice/issues"] || !seen["/v1/workspaces/ws-bob/issues"] {
		t.Errorf("sessions did not reach their own workspaces: %v", keysOf(seen))
	}
}

// TestTrack_NeitherSessionCanReadTheOthersIssues: the isolation is enforced UPSTREAM by Track's
// membership check, and the BFF's job is to never give a session another workspace's path. This
// asserts the BFF half — the only half the BFF can be responsible for.
func TestTrack_NeitherSessionCanReadTheOthersIssues(t *testing.T) {
	up := newTrackUpstream(t, func(string) string { return "ws-x" })
	a := trackApp(t, up)
	alice := signIn(t, a, "sid-a", "alice@example.com", "ws-alice")

	// The issues route REFUSES unknown query keys outright (a decided allowlist), which is
	// stronger than ignoring them — an attempt to name a workspace never reaches the upstream
	// at all. Discovered by writing this test expecting "ignored" and getting 400.
	for _, attempt := range []string{
		"/api/track/issues?workspace_id=ws-bob",
		"/api/track/issues?workspace=ws-bob",
		"/api/track/issues?ws=ws-bob",
	} {
		rec := getAs(t, a, alice, attempt)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: got %d, want 400 — an unknown query key must be refused", attempt, rec.Code)
		}
		select {
		case p := <-up.paths:
			t.Errorf("%s reached the upstream at %q — a refused request must not be forwarded", attempt, p)
		default:
		}
	}

	// And the legitimate request still addresses ALICE's workspace, never a named one.
	if rec := getAs(t, a, alice, "/api/track/issues"); rec.Code != http.StatusOK {
		t.Fatalf("plain issues: got %d (%s)", rec.Code, rec.Body.String())
	}
	select {
	case p := <-up.paths:
		if p != "/v1/workspaces/ws-alice/issues" {
			t.Errorf("addressed %q, want alice's workspace", p)
		}
	default:
		t.Fatal("upstream never called")
	}
}

/* ── Rule 1: a Track failure must not fail login ─────────────────────────── */

// TestTrack_BootstrapFailureDoesNotAbortLogin — rule 1, asserted at the LOGIN PATH.
//
// The first version of this test called bootstrapTrackWorkspace directly and then checked that a
// session with no Track workspace still authenticates. It passed while handleCallback returned
// 502 on a Track error — i.e. while login WAS being failed by a Track blip. It was testing
// "an empty-workspace session authenticates", which is true and is not the rule. Found by
// positive-controlling it; the control is the only thing that could have found it, because the
// name read correctly.
//
// So this reads the login path itself: the error branch guarding the Track bootstrap must not
// abort. A `return` or a response written there is exactly the regression — Lens's provisioning,
// twenty lines above, does return, and copying that shape is the easy mistake.
func TestTrack_BootstrapFailureDoesNotAbortLogin(t *testing.T) {
	files := bffSourceFiles(t)
	checked := false
	for name, file := range files {
		ast.Inspect(file, func(n ast.Node) bool {
			fn, ok := n.(*ast.FuncDecl)
			if !ok || fn.Body == nil || !callsFunc(fn, "bootstrapTrackWorkspace") {
				return true
			}
			// Only the login path — trackWorkspaceFor legitimately returns on failure.
			if fn.Name.Name != "handleCallback" {
				return true
			}
			checked = true
			ast.Inspect(fn.Body, func(m ast.Node) bool {
				ifs, ok := m.(*ast.IfStmt)
				if !ok || !mentions(ifs.Cond, "terr") {
					return true
				}
				ast.Inspect(ifs.Body, func(k ast.Node) bool {
					if _, isRet := k.(*ast.ReturnStmt); isRet {
						t.Errorf("%s: handleCallback RETURNS when the Track bootstrap fails — a Track "+
							"blip would take out the whole login, including Lens, billing and keys. "+
							"Log it and continue; the empty workspace is retried on first use.", name)
					}
					if call, isCall := k.(*ast.CallExpr); isCall {
						if id, ok := call.Fun.(*ast.Ident); ok && id.Name == "writeJSON" {
							t.Errorf("%s: handleCallback writes an error response on a Track bootstrap "+
								"failure — login must complete regardless", name)
						}
					}
					return true
				})
				return true
			})
			return true
		})
	}
	if !checked {
		t.Fatal("handleCallback no longer calls bootstrapTrackWorkspace — either the wiring was " +
			"removed (Track is back to a shared workspace) or this guard has drifted")
	}
}

// callsFunc reports whether fn's body calls the named function.
func callsFunc(fn *ast.FuncDecl, name string) bool {
	hit := false
	ast.Inspect(fn.Body, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		switch f := call.Fun.(type) {
		case *ast.Ident:
			if f.Name == name {
				hit = true
			}
		case *ast.SelectorExpr:
			if f.Sel.Name == name {
				hit = true
			}
		}
		return true
	})
	return hit
}

// mentions reports whether the expression references the named identifier.
func mentions(e ast.Expr, name string) bool {
	hit := false
	ast.Inspect(e, func(n ast.Node) bool {
		if id, ok := n.(*ast.Ident); ok && id.Name == name {
			hit = true
		}
		return true
	})
	return hit
}

/* ── Rule 2: the failure must not be cached in the session ───────────────── */

// TestTrack_FailureIsNotCachedForTheSession. A session lives 12 hours. If login stored "no Track
// workspace" and every later request trusted it, a two-second blip would become a half-day
// outage. So a session without a Track workspace RETRIES the bootstrap on demand.
func TestTrack_FailureIsNotCachedForTheSession(t *testing.T) {
	up := newTrackUpstream(t, func(string) string { return "ws-recovered" })
	up.bootstrapCode.Store(http.StatusInternalServerError) // Track is down at login
	a := trackApp(t, up)
	c := signIn(t, a, "sid-a", "alice@example.com", "") // login left it empty

	// Still down: the request fails honestly rather than pretending.
	if rec := getAs(t, a, c, "/api/track/issues"); rec.Code == http.StatusOK {
		t.Fatal("issues succeeded while Track was down")
	}
	before := up.bootstrapHits.Load()
	if before == 0 {
		t.Fatal("no retry was attempted — the failure was cached for the session")
	}

	// Track recovers. The SAME session must work, with no new login.
	up.bootstrapCode.Store(0)
	rec := getAs(t, a, c, "/api/track/issues")
	if rec.Code != http.StatusOK {
		t.Fatalf("after Track recovered: got %d (%s) — the session cached the failure",
			rec.Code, rec.Body.String())
	}
	select {
	case p := <-up.paths:
		if p != "/v1/workspaces/ws-recovered/issues" {
			t.Errorf("recovered request addressed %q", p)
		}
	default:
		t.Fatal("upstream read never happened after recovery")
	}
}

// TestTrack_SecondLoginReusesTheWorkspace: Track's bootstrap is idempotent, and the BFF must not
// defeat that by asking for something different the second time. The same identity must land in
// the same workspace.
func TestTrack_SecondLoginReusesTheWorkspace(t *testing.T) {
	up := newTrackUpstream(t, func(email string) string { return "ws-" + strings.Split(email, "@")[0] })
	a := trackApp(t, up)

	first, err := a.bootstrapTrackWorkspace(t.Context(), "alice@example.com", "sub-a", "https://idp.example.com")
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	second, err := a.bootstrapTrackWorkspace(t.Context(), "alice@example.com", "sub-a", "https://idp.example.com")
	if err != nil {
		t.Fatalf("second: %v", err)
	}
	if first != second || first == "" {
		t.Errorf("second login got %q, first got %q — a second login must reuse the workspace", second, first)
	}
}

// TestTrack_BootstrapForwardsTheVerifiedIdentity: Track keys its workspace on the identity the
// gateway hands it, so the BFF must send the same identity it authenticated — and the transit
// proof, or Track 401s before reading any of it.
func TestTrack_BootstrapForwardsTheVerifiedIdentity(t *testing.T) {
	var gotAuth, gotEmail, gotSub, gotIss, gotMethod string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotAuth = r.Method, r.Header.Get("X-Gateway-Auth")
		gotEmail, gotSub, gotIss = r.Header.Get("X-User-Email"), r.Header.Get("X-User-Id"), r.Header.Get("X-Auth-Iss")
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"workspace_id":"ws-1","slug":"s","created":true}`)
	}))
	defer srv.Close()

	cfg := config{
		lensBaseURL: "http://127.0.0.1:1", authMode: authModeOIDC, oidcIssuer: "https://idp.example.com",
		publicBaseURL: "https://app.talyvor.com", sessionTTL: time.Hour,
		trackBaseURL: srv.URL, trackGatewaySecret: testTrackSecret,
	}
	a := newApp(cfg, newSessionOnlyAuthenticator(cfg))
	a.cfg.webDist = t.TempDir()

	if _, err := a.bootstrapTrackWorkspace(t.Context(), "alice@example.com", "sub-a", "https://idp.example.com"); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	if gotMethod != http.MethodPost {
		t.Errorf("method = %q, want POST", gotMethod)
	}
	if gotAuth != testTrackSecret {
		t.Error("the transit proof was not attached — Track 401s before reading any identity")
	}
	if gotEmail != "alice@example.com" || gotSub != "sub-a" || gotIss != "https://idp.example.com" {
		t.Errorf("identity not forwarded: email=%q sub=%q iss=%q", gotEmail, gotSub, gotIss)
	}
}

/* ── Docs stays pinned, deliberately ─────────────────────────────────────── */

// TestDocs_RemainsPinnedByDesign. Docs has NO workspaces table: its tenancy is a mirror of
// Track's roster, full-pulled by its syncer, and giving it its own root is a parked decision
// with a stated reopening condition (talyvor-docs internal/membership/store.go). So Docs stays
// single-workspace here BY DESIGN, and this test exists so that reads as intentional rather
// than forgotten — and so that removing the pin is a deliberate act that fails a test first.
//
// THE CONSEQUENCE FOR A TESTER, stated plainly because people are about to be handed keys:
// every trial user shares ONE Docs workspace and can see each other's pages.
func TestDocs_RemainsPinnedByDesign(t *testing.T) {
	if !configHasField(t, "docsWorkspaceID") {
		t.Error("docsWorkspaceID was removed from the config. Docs has no workspaces table — it " +
			"mirrors Track's roster — so a per-session Docs workspace needs Docs to have a tenancy " +
			"root first. See the parked decision and its reopening condition.")
	}
	if configHasField(t, "trackWorkspaceID") {
		t.Error("trackWorkspaceID is back on the config: Track is per-session now, and a pinned " +
			"id would put every signed-in person back in one shared Track workspace")
	}
}

func keysOf(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// configHasField reports whether the config struct declares the named field. Reads the source so
// the assertion is about the SHAPE of the config, which is what makes a pinned id representable.
func configHasField(t *testing.T, field string) bool {
	t.Helper()
	found := false
	for _, file := range bffSourceFiles(t) {
		ast.Inspect(file, func(n ast.Node) bool {
			ts, ok := n.(*ast.TypeSpec)
			if !ok || ts.Name.Name != "config" {
				return true
			}
			st, ok := ts.Type.(*ast.StructType)
			if !ok {
				return true
			}
			for _, f := range st.Fields.List {
				for _, id := range f.Names {
					if id.Name == field {
						found = true
					}
				}
			}
			return true
		})
	}
	return found
}

// TestAuthMeDocsSharedIsDerivedNotHardcoded. The tester-facing notice renders from this field, so
// it must be computed from the pin rather than asserted. Hardcode it true and the notice outlives
// the arrangement it describes; hardcode it false and testers are never told they share a Docs.
func TestAuthMeDocsSharedIsDerivedNotHardcoded(t *testing.T) {
	for _, c := range []struct {
		name          string
		baseURL, wsID string
		want          bool
	}{
		{"docs pinned — the trial today", "http://127.0.0.1:4000", "default", true},
		{"docs configured but NOT pinned — per-user Docs", "http://127.0.0.1:4000", "", false},
		{"no docs upstream at all — nothing to warn about", "", "", false},
		{"pin without an upstream is not a shared Docs", "", "default", false},
	} {
		t.Run(c.name, func(t *testing.T) {
			cfg := config{
				lensBaseURL: "http://127.0.0.1:1", authMode: authModeOIDC,
				oidcIssuer: "https://idp.example.com", publicBaseURL: "https://app.talyvor.com",
				sessionTTL: time.Hour, docsBaseURL: c.baseURL, docsWorkspaceID: c.wsID,
			}
			a := newApp(cfg, newSessionOnlyAuthenticator(cfg))
			a.cfg.webDist = t.TempDir()
			signIn(t, a, "sid", "a@example.com", "ws")

			rec := getAs(t, a, &http.Cookie{Name: sessionCookieName, Value: "sid"}, "/auth/me")
			var me map[string]any
			if err := json.Unmarshal(rec.Body.Bytes(), &me); err != nil {
				t.Fatalf("bad /auth/me body: %s", rec.Body.String())
			}
			if got := me["docs_shared"]; got != c.want {
				t.Errorf("docs_shared = %v, want %v — it must be DERIVED from the config pin", got, c.want)
			}
		})
	}
}

/* ── Writes follow the session too ───────────────────────────────────────── */

// trackWriteUpstream records METHOD + PATH + BODY, which the read-only harness above does not:
// a write that reaches the right workspace with the wrong verb, or with the body dropped, is a
// silent no-op upstream rather than an error here.
type trackWriteUpstream struct {
	srv   *httptest.Server
	mu    sync.Mutex
	calls []writeCall
}

type writeCall struct {
	method string
	path   string
	body   string
}

func newTrackWriteUpstream(t *testing.T, workspaceFor func(email string) string) *trackWriteUpstream {
	t.Helper()
	u := &trackWriteUpstream{}
	u.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/bootstrap" {
			ws := workspaceFor(r.Header.Get("X-User-Email"))
			_, _ = io.WriteString(w, `{"workspace_id":"`+ws+`","slug":"s-`+ws+`","created":true}`)
			return
		}
		b, _ := io.ReadAll(r.Body)
		u.mu.Lock()
		u.calls = append(u.calls, writeCall{method: r.Method, path: r.URL.Path, body: string(b)})
		u.mu.Unlock()
		// Echo the addressed workspace so a read can prove WHICH tenant it saw.
		_, _ = io.WriteString(w, `{"id":"iss-1","path":"`+r.URL.Path+`"}`)
	}))
	t.Cleanup(u.srv.Close)
	return u
}

func (u *trackWriteUpstream) since(n int) []writeCall {
	u.mu.Lock()
	defer u.mu.Unlock()
	return append([]writeCall(nil), u.calls[n:]...)
}

func (u *trackWriteUpstream) count() int {
	u.mu.Lock()
	defer u.mu.Unlock()
	return len(u.calls)
}

func trackWriteApp(t *testing.T, up *trackWriteUpstream) *app {
	t.Helper()
	cfg := config{
		lensBaseURL: "http://127.0.0.1:1", provisionSecret: "provision-secret",
		authMode: authModeOIDC, oidcIssuer: "https://idp.example.com",
		publicBaseURL: "https://app.talyvor.com", sessionTTL: time.Hour,
		trackBaseURL: up.srv.URL, trackGatewaySecret: testTrackSecret,
		docsBaseURL: "http://127.0.0.1:1", docsGatewaySecret: "gwsecret_docs", docsWorkspaceID: "docs-pinned",
	}
	a := newApp(cfg, newSessionOnlyAuthenticator(cfg))
	a.cfg.webDist = t.TempDir()
	return a
}

func sendAs(t *testing.T, a *app, sess *http.Cookie, method, target, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(sess)
	rec := httptest.NewRecorder()
	a.mux.ServeHTTP(rec, req)
	return rec
}

// ⚠ THE CLAIM A TESTER CARES ABOUT: an issue I create lands in MY workspace, and the other
// tester's session cannot reach it. Asserted on what the BFF sends upstream and what the API
// returns — never on what a component renders, because a form that posts to the wrong tenant
// looks identical on screen.
func TestTrack_CreateLandsInTheSessionsOwnWorkspace(t *testing.T) {
	up := newTrackWriteUpstream(t, func(email string) string {
		if strings.HasPrefix(email, "alice") {
			return "ws-alice"
		}
		return "ws-bob"
	})
	a := trackWriteApp(t, up)
	alice := signIn(t, a, "sid-alice", "alice@example.com", "ws-alice")
	bob := signIn(t, a, "sid-bob", "bob@example.com", "ws-bob")

	mark := up.count()
	if rec := sendAs(t, a, alice, http.MethodPost, "/api/track/issues",
		`{"title":"Alice's issue","team_id":"team-1"}`); rec.Code >= 400 {
		t.Fatalf("alice create: status=%d body=%s", rec.Code, rec.Body.String())
	}
	aliceCalls := up.since(mark)
	if len(aliceCalls) != 1 {
		t.Fatalf("expected exactly one upstream call, got %d: %+v", len(aliceCalls), aliceCalls)
	}
	got := aliceCalls[0]
	if got.method != http.MethodPost {
		t.Errorf("upstream method = %q, want POST — a write forwarded as GET is a silent no-op", got.method)
	}
	if got.path != "/v1/workspaces/ws-alice/issues" {
		t.Errorf("upstream path = %q, want /v1/workspaces/ws-alice/issues (the SESSION's workspace)", got.path)
	}
	if !strings.Contains(got.body, "Alice's issue") {
		t.Errorf("upstream body = %q — the caller's JSON must be forwarded, not dropped", got.body)
	}

	// ⚠ The isolation half: bob's session must not address alice's workspace.
	mark = up.count()
	if rec := sendAs(t, a, bob, http.MethodPost, "/api/track/issues",
		`{"title":"Bob's issue","team_id":"team-1"}`); rec.Code >= 400 {
		t.Fatalf("bob create: status=%d body=%s", rec.Code, rec.Body.String())
	}
	for _, c := range up.since(mark) {
		if strings.Contains(c.path, "ws-alice") {
			t.Fatalf("bob's write addressed alice's workspace (%s) — the workspace must come from the "+
				"SESSION, so one tester can never write into another's tracker", c.path)
		}
	}
}

// A status change is the smallest useful edit. Track's Update decodes map[string]any, so a bare
// {"status":…} is a valid patch — verified against talyvor-track internal/issue/handler.go:302.
func TestTrack_StatusPatchFollowsTheSession(t *testing.T) {
	up := newTrackWriteUpstream(t, func(string) string { return "ws-alice" })
	a := trackWriteApp(t, up)
	alice := signIn(t, a, "sid-alice", "alice@example.com", "ws-alice")

	mark := up.count()
	if rec := sendAs(t, a, alice, http.MethodPatch, "/api/track/issues/iss-1",
		`{"status":"in_progress"}`); rec.Code >= 400 {
		t.Fatalf("patch: status=%d body=%s", rec.Code, rec.Body.String())
	}
	calls := up.since(mark)
	if len(calls) != 1 {
		t.Fatalf("expected one upstream call, got %+v", calls)
	}
	if calls[0].method != http.MethodPatch {
		t.Errorf("upstream method = %q, want PATCH", calls[0].method)
	}
	if calls[0].path != "/v1/workspaces/ws-alice/issues/iss-1" {
		t.Errorf("upstream path = %q, want the session's workspace", calls[0].path)
	}
	if !strings.Contains(calls[0].body, "in_progress") {
		t.Errorf("upstream body = %q — the status must reach Track", calls[0].body)
	}
}

// Writes are session-gated like every other product route.
func TestTrack_WritesRequireASession(t *testing.T) {
	up := newTrackWriteUpstream(t, func(string) string { return "ws-alice" })
	a := trackWriteApp(t, up)
	for _, tc := range []struct{ method, target string }{
		{http.MethodPost, "/api/track/issues"},
		{http.MethodPatch, "/api/track/issues/iss-1"},
	} {
		req := httptest.NewRequest(tc.method, tc.target, strings.NewReader(`{"title":"x"}`))
		rec := httptest.NewRecorder()
		a.mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s %s without a session = %d, want 401", tc.method, tc.target, rec.Code)
		}
	}
}
