package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// testPublicOrigin is the app origin these tests enforce against.
const testPublicOrigin = "https://app.talyvor.com"

// originUpstream records what actually crossed to upstream, so "the write was not refused" can be
// checked as an ARRIVAL rather than inferred from a status code the BFF chose for itself.
//
// ⚠ THE BOOTSTRAP AND THE PROVISION CALL ARE EXCLUDED ON PURPOSE, and this is the distinction the
// whole assertion turns on. A Track write whose session has no workspace answers 503 having sent
// exactly one thing upstream: POST /v1/bootstrap. Counting that as "reached upstream" is how six
// of the twelve rows below looked covered while none of their own writes ever left the process.
type originUpstream struct {
	mu   sync.Mutex
	reqs []string
}

func (u *originUpstream) record(method, path string) {
	if path == provisionPath || path == "/v1/bootstrap" {
		return
	}
	u.mu.Lock()
	defer u.mu.Unlock()
	u.reqs = append(u.reqs, method+" "+path)
}

func (u *originUpstream) reset() {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.reqs = nil
}

// writes returns the unsafe-method requests this upstream received since the last reset.
func (u *originUpstream) writes() []string {
	u.mu.Lock()
	defer u.mu.Unlock()
	var out []string
	for _, r := range u.reqs {
		if m, _, ok := strings.Cut(r, " "); ok && m != http.MethodGet && m != http.MethodHead {
			out = append(out, r)
		}
	}
	return out
}

// sameOriginApp is an oidc-mode app with a seeded session and a public origin, pointed at a
// fake upstream that accepts anything — so a route that reaches upstream is observably NOT
// refused, and the only 403 a test can see is the Origin guard's own.
func sameOriginApp(t *testing.T) (*app, string) {
	t.Helper()
	a, sid, _ := sameOriginAppRecording(t)
	return a, sid
}

// sameOriginAppRecording is sameOriginApp plus the upstream recorder.
//
// ⚠ THE SESSION CARRIES A TRACK WORKSPACE, and it did not before. Without one, Track's idempotent
// bootstrap runs on every Track/Docs request, this fixture's blanket `{"ok":true}` contains no
// workspace, and all six Track/Docs writes answer 503 before their own upstream call — measured,
// not supposed. Every test on this fixture asserts about 403-ness and was satisfied either way,
// which is exactly why nobody noticed that half the swept table could not reach the thing it is
// asserted to reach.
func sameOriginAppRecording(t *testing.T) (*app, string, *originUpstream) {
	t.Helper()
	rec := &originUpstream{}
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		rec.record(r.Method, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	t.Cleanup(up.Close)
	cfg := config{
		lensBaseURL: up.URL, provisionSecret: testProvisionSecret,
		trackBaseURL: up.URL, trackGatewaySecret: "s3cret-gateway-value-long",
		docsBaseURL: up.URL, docsGatewaySecret: "s3cret-gateway-value-long",
		authMode: authModeOIDC, oidcIssuer: "https://idp.example.com",
		publicBaseURL: testPublicOrigin, sessionTTL: time.Hour,
	}
	auth := newSessionOnlyAuthenticator(cfg)
	seedProvisionedSession(auth, "so-sid", "u1", "ng@example.com", "u-test-workspace")
	s, _ := auth.sessions.get("so-sid")
	s.trackWorkspaceID = "track-ws-7"
	auth.sessions.put("so-sid", s)
	a := newApp(cfg, auth)
	a.cfg.webDist = t.TempDir()
	return a, "so-sid", rec
}

// readBFFSource concatenates the package's non-test .go files. The structural assertion is
// about the SOURCE — where the duplication lived — so it reads the source.
func readBFFSource(t *testing.T) string {
	t.Helper()
	var b strings.Builder
	ents, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range ents {
		n := e.Name()
		if !strings.HasSuffix(n, ".go") || strings.HasSuffix(n, "_test.go") {
			continue
		}
		by, err := os.ReadFile(filepath.Clean(n))
		if err != nil {
			t.Fatal(err)
		}
		b.Write(by)
	}
	return b.String()
}

// sameorigin_test.go — the write-path Origin check, made uniform and made a property of the
// ROUTER rather than of each handler's memory.
//
// ⚠ THIS IS NOT A VULNERABILITY BEING PATCHED. The session cookie is SameSite=Lax, so a
// cross-site POST does not carry it and the request is unauthenticated before Origin is ever
// consulted (see auth.go). The Origin check is a SECOND layer for the cases Lax does not
// cover — a same-site subdomain, a future cookie-policy change, a browser that treats Lax
// differently — and, mostly, it is CONSISTENCY: two of the eight write paths were missing it,
// and "which writes are guarded" should not be a fact you have to grep for.
//
// TWO HELPERS EXISTED, WITH DIFFERENT BEHAVIOUR, AND THAT IS THE REAL DEFECT:
//
//	requireSameOrigin (keys.go)  writes its own 403 AND short-circuits in disabled mode
//	originAllowed     (tenant.go) is a bare predicate with NO disabled-mode exemption
//
// publicBaseURL is assigned only inside the oidc branch of loadConfig, so in disabled mode it
// is "". A browser always sends Origin on a POST, so `Origin == ""` is false and every route
// using the SECOND helper answered 403 in disabled mode — pooling, distill, and the Track
// comment POST were unusable for a self-hoster running without OIDC. That is a live functional
// bug, not a hardening nicety, and it is exactly what a second implementation of one rule
// produces.

// mutatingRoute is one write path the app exposes to a browser.
type mutatingRoute struct {
	method, path, body string
	// exempt marks a route that MUST NOT get the Origin check — see the exemption test.
	exempt bool
	why    string
}

// everyMutatingRoute is the swept list. A new write route added without a line here fails
// TestEveryMutatingRoute_IsGuardedOrExplicitlyExempt, so the sweep cannot silently go stale.
//
// ⚠ THAT SENTENCE WAS TRUE OF NOTHING UNTIL `cited_guard_test.go` WENT LOOKING. The test it names
// did not exist: three tests iterate this list, and not one of them compared it against the
// router, so a write route added without a line here would simply not have been swept — by the
// three tests whose whole subject is which writes are guarded. The list happened to be COMPLETE
// when this was found (measured at 0f25561 by driving every unsafe method on every mounted
// pattern through a.ServeHTTP: twelve accepted product writes, all twelve listed), so nothing was
// unguarded. Nothing kept it that way either. The test is written below.
func everyMutatingRoute() []mutatingRoute {
	return []mutatingRoute{
		{method: http.MethodPost, path: "/api/pooling", body: `{"cache_poolable":true}`},
		{method: http.MethodPost, path: "/api/distill", body: `{"distill_policy":"disabled"}`},
		{method: http.MethodPost, path: "/api/keys", body: `{"name":"k","scopes":["proxy"]}`},
		{method: http.MethodDelete, path: "/api/keys/abc", body: ``},
		// ⚠ `usd_cents` AND `lxc_amount_ulxc`, NOT `amount_usd` AND `lxc`. Both rows named a field
		// their handler does not read, so both decoded to zero and answered 400 BEFORE dialling —
		// the two MONEY routes in this table were the two that never reached upstream at all. The
		// wrong names survived because no assertion here has ever looked past the status code.
		{method: http.MethodPost, path: "/api/lxc/checkout", body: `{"usd_cents":5000}`},
		{method: http.MethodPost, path: "/api/lens/convert", body: `{"lxc_amount_ulxc":100000}`},
		{method: http.MethodPost, path: "/api/track/issues", body: `{"title":"t"}`},
		{method: http.MethodPatch, path: "/api/track/issues/i1", body: `{"status":"todo"}`},
		{method: http.MethodPost, path: "/api/track/issues/i1/comments", body: `{"body":"c"}`},
		{method: http.MethodPost, path: "/api/docs/spaces", body: `{"name":"s"}`},
		{method: http.MethodPost, path: "/api/docs/spaces/s1/pages", body: `{"title":"p"}`},
		{method: http.MethodPatch, path: "/api/docs/spaces/s1/pages/p1", body: `{"title":"p2"}`},
		// The first AI control. It writes nothing in Docs, but it SPENDS: every ask is a metered
		// Lens completion billed to the caller's workspace, so a cross-origin one is a stranger
		// spending someone else's balance. That is the reason it is a write path here.
		{method: http.MethodPost, path: "/api/docs/ai/ask", body: `{"question":"q"}`},
		// Summarise — a write path here for the same reason ask is: it writes nothing in Docs and
		// it SPENDS, and this one's charge lands on a named document.
		//
		// ⚠ THE BODY CANNOT BE `{}`, AND THAT IS THE TRAP THIS TABLE ALREADY FELL INTO ONCE. The
		// two money rows above named fields their handlers do not read, decoded to zero and
		// answered 400 BEFORE dialling — so they were swept for a refusal they would have produced
		// with the Origin rule deleted. This route refuses an empty or whitespace-only `text` for
		// its own measured reason (docs_ai.go: upstream bills for it), so an empty body here would
		// reproduce that defect exactly: the same-origin half asserts the row's own write ARRIVES
		// upstream, and it cannot arrive if this handler refuses it first.
		{method: http.MethodPost, path: "/api/docs/pages/p1/summarize", body: `{"text":"real page text"}`},

		// EXEMPT — a machine caller has no Origin to send, so requiring one would break it.
		// None exists in this BFF today; the row documents the rule and the test asserts the
		// list is honest rather than assuming emptiness.
		// (No webhook or service-to-service write path is mounted here — every /api/* route is
		// session-gated and browser-driven. If one is added, mark it exempt HERE and say why.)
	}
}

// notSweptWrite names a mounted pattern whose unsafe methods are deliberately outside the swept
// list, with the reason. An entry is a decision someone has to write down; the absence of one is
// what makes a new write route fail the completeness check below.
//
// ⚠ THE OPERATOR ENTRIES ARE SELF-EXPIRING, WHICH IS THE ONLY REASON A PREFIX-SHAPED EXEMPTION IS
// ACCEPTABLE HERE. Every /api/admin/* pattern answers 403 to a session that is not an operator —
// requireOperator refuses BEFORE any method dispatch, so all four unsafe verbs look "accepted" to
// a status-based probe while no handler behind them writes anything: they are all adminNotWired.
// The exemption is conditioned on that still being true (asserted below), so the day one of them
// is wired to a real handler, the exemption stops applying and the route must be swept or
// re-justified. A bare "/api/admin/ is exempt" would have hidden exactly that day.
var notSweptWrite = map[string]string{
	"/auth/logout": "a browser POST the app issues at itself; it is swept by TestLogout_RefusesCrossOrigin, " +
		"which drives it directly rather than through this table because it has no JSON body and no upstream.",
	"/api/admin/workspaces":          "operator read surface, adminNotWired — see the note above",
	"/api/admin/billing/purchases":   "operator read surface, adminNotWired — see the note above",
	"/api/admin/economy/flags":       "operator read surface, adminNotWired — see the note above",
	"/api/admin/keel/findings":       "operator read surface, adminNotWired — see the note above",
	"/api/admin/held-mints":          "operator read surface, adminNotWired — see the note above",
	"/api/admin/distill/attribution": "operator read surface, adminNotWired — see the note above",
}

// mountedPatterns reads every pattern the router actually mounts out of lens.go, so the population
// this is checked against is the ROUTER'S and not a second hand-kept list. A list here would be
// the defect this test exists to catch, one level up.
func mountedPatterns(t *testing.T) []string {
	t.Helper()
	src, err := os.ReadFile("lens.go")
	if err != nil {
		t.Fatal(err)
	}
	re := regexp.MustCompile(`a\.mux\.Handle(?:Func)?\("([^"]+)"`)
	var out []string
	seen := map[string]bool{}
	for _, m := range re.FindAllStringSubmatch(string(src), -1) {
		if !seen[m[1]] {
			seen[m[1]] = true
			out = append(out, m[1])
		}
	}
	sort.Strings(out)
	return out
}

// routeShape normalises a concrete path to its pattern shape, so `/api/keys/abc` (this table's
// id) and `/api/keys/x1` (the probe's) are the same route.
func routeShape(method, path string) string {
	return method + " " + regexp.MustCompile(`/(x1|s1|p1|i1|abc)(/|$)`).ReplaceAllString(path, "/{id}$2")
}

// (0) THE COMPLETENESS CHECK — the one this file's list has always claimed and never had.
//
// It drives every unsafe method against every mounted pattern through a.ServeHTTP and asks which
// ones a handler ACCEPTS (anything that is not 405 Method Not Allowed and not a 404). Each accepted
// write must be in everyMutatingRoute() or in notSweptWrite with a reason. A new write route
// therefore cannot be added without either being swept or being explicitly, reasonedly, excused.
func TestEveryMutatingRoute_IsGuardedOrExplicitlyExempt(t *testing.T) {
	a, sid := sameOriginApp(t)

	swept := map[string]bool{}
	for _, rt := range everyMutatingRoute() {
		swept[routeShape(rt.method, rt.path)] = true
	}

	patterns := mountedPatterns(t)
	// A floor on the POPULATION, as a literal: if the pattern scan ever reads nothing — a rename of
	// the mux variable, a move of the route table out of lens.go — every assertion below is
	// vacuously satisfied and this test would pass while checking no route at all.
	if len(patterns) < 20 {
		t.Fatalf("mounted patterns found = %d, want at least 20 — the route-table scan read almost nothing", len(patterns))
	}

	accepted := 0
	var unswept []string
	for _, pat := range patterns {
		path := regexp.MustCompile(`\{[^}]*\}`).ReplaceAllString(pat, "x1")
		if strings.HasSuffix(path, "/") {
			continue // the /api/ catch-all and the SPA root are not routes with verbs of their own
		}
		for _, m := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
			req := httptest.NewRequest(m, path, strings.NewReader(`{}`))
			req.Header.Set("Origin", testPublicOrigin)
			req.Header.Set("Content-Type", "application/json")
			req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: sid})
			rec := httptest.NewRecorder()
			a.ServeHTTP(rec, req)
			if rec.Code == http.StatusMethodNotAllowed || rec.Code == http.StatusNotFound {
				continue // the route refuses this verb, or nothing is mounted there
			}
			accepted++
			if swept[routeShape(m, path)] {
				continue
			}
			if _, excused := notSweptWrite[pat]; excused {
				continue
			}
			unswept = append(unswept, m+" "+pat+" (answered "+strconv.Itoa(rec.Code)+")")
		}
	}

	// The probe must find writes to check. Compared against a literal, never against
	// len(everyMutatingRoute()) — a floor measured from the thing it protects passes at zero.
	if accepted < 12 {
		t.Fatalf("accepted unsafe-method routes = %d, want at least 12 — the probe found almost no writes, "+
			"so the sweep below checked almost nothing", accepted)
	}
	if len(unswept) > 0 {
		sort.Strings(unswept)
		t.Fatalf("write route(s) the Origin sweep does not cover — add a line to everyMutatingRoute(), "+
			"or an entry to notSweptWrite with the reason:\n  %s", strings.Join(unswept, "\n  "))
	}
}

// The operator exemption is only honest while those routes write nothing. This is what expires it.
func TestOperatorExemptionHoldsOnlyWhileAdminIsNotWired(t *testing.T) {
	src, err := os.ReadFile("lens.go")
	if err != nil {
		t.Fatal(err)
	}
	admin := regexp.MustCompile(`a\.mux\.HandleFunc\("(/api/admin/[^"]+)",\s*a\.requireOperator\(([^)]*)\)\)`)
	found := 0
	for _, m := range admin.FindAllStringSubmatch(string(src), -1) {
		found++
		if _, excused := notSweptWrite[m[1]]; !excused {
			continue // not claiming the exemption, so nothing to expire
		}
		if strings.TrimSpace(m[2]) != "a.adminNotWired" {
			t.Errorf("%s is exempted from the write sweep as an unwired operator read, but it is now "+
				"wired to %s — sweep it in everyMutatingRoute() or restate the exemption", m[1], m[2])
		}
	}
	if found < 6 {
		t.Fatalf("operator routes matched = %d, want at least 6 — this scan stopped seeing the operator "+
			"surface, so the expiry it enforces is inert", found)
	}
}

// (1) THE SWEEP. Every mutating route must REFUSE a cross-origin write. Before this change
// /api/track/issues (POST) and /api/track/issues/{id} (PATCH) did not, so a Track issue could
// be created or retitled by a cross-origin form while every other write refused.
func TestEveryMutatingRoute_RefusesCrossOrigin(t *testing.T) {
	for _, rt := range everyMutatingRoute() {
		if rt.exempt {
			continue
		}
		t.Run(rt.method+" "+rt.path, func(t *testing.T) {
			a, sid := sameOriginApp(t)
			req := httptest.NewRequest(rt.method, rt.path, strings.NewReader(rt.body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Origin", "https://evil.example.com")
			req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: sid})
			rr := httptest.NewRecorder()
			a.ServeHTTP(rr, req)

			if rr.Code != http.StatusForbidden {
				t.Errorf("cross-origin %s %s = %d, want 403 — every browser write must refuse "+
					"an Origin that is not the app origin: %s", rt.method, rt.path, rr.Code, rr.Body.String())
			}
		})
	}
}

// (2) THE OTHER DIRECTION, which is what makes (1) meaningful. A same-origin write must still
// reach upstream. A guard that refuses everything would pass (1) and be useless.
//
// ⚠⚠ THAT SENTENCE WAS THE CLAIM AND IT WAS ENFORCED BY NOTHING. The assertion was
// `rr.Code == 403 && strings.Contains(body, "origin")` — a refusal recognised by the guard's own
// ERROR TEXT, and nothing anywhere pins that text. MEASURED at 5888b31 rather than argued, with
// verdicts read from `--- FAIL:` lines over the whole package
// (~/talyvor-queue/w11-samewrite-controls-b3d7.py):
//
//	D1  the rule made to refuse EVERY write AND its message reworded → this test PASSED, and so
//	    did every other test in this file whose subject is that rule. 42 tests went red and all
//	    42 are route tests that happened to notice their own route break.
//	D2  the same refuse-everything rule, message UNCHANGED → CAUGHT here. So the assertion is
//	    armed only while the wording matches.
//	D3  the message reworded ALONE, rule correct → ZERO tests fail. The wording is a free edit,
//	    which is what makes D1 a realistic accident rather than a contrived one.
//
// ⚠ AND THE POSITIVE HALF WAS ABSENT TOO. "Must still reach upstream" was never checked, and
// SIX OF THESE TWELVE ROWS DID NOT: the two money rows named a field their handler does not read
// and answered 400 before dialling, and the four Track/Docs rows — six method×route shapes —
// stopped at Track's bootstrap because this fixture's session had no workspace. Both are fixed
// above, and the claim is now an assertion: the row's OWN write must arrive upstream.
//
// The refusal check is now on the STATUS, not on the words. A 403 on a same-origin write is a
// failure whatever it says.
func TestEveryMutatingRoute_AllowsSameOrigin(t *testing.T) {
	for _, rt := range everyMutatingRoute() {
		if rt.exempt {
			continue
		}
		t.Run(rt.method+" "+rt.path, func(t *testing.T) {
			a, sid, up := sameOriginAppRecording(t)
			up.reset()
			req := httptest.NewRequest(rt.method, rt.path, strings.NewReader(rt.body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Origin", testPublicOrigin)
			req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: sid})
			rr := httptest.NewRecorder()
			a.ServeHTTP(rr, req)

			if rr.Code == http.StatusForbidden {
				t.Errorf("same-origin %s %s was refused (%d): %s — the guard must not refuse the "+
					"app's own writes, and this check is deliberately not keyed on the refusal's "+
					"wording: a guard that refuses everything in different words is the exact "+
					"failure this test exists to catch", rt.method, rt.path, rr.Code, rr.Body.String())
			}

			// ⚠ THE ARRIVAL ASSERTION — the half the comment above has always claimed. A status
			// code is the BFF's own account of itself; this is the upstream's. Without it a change
			// that stops every write reaching Lens leaves this test green, which is one layer
			// subtler than the refuse-everything guard it was written to catch.
			if w := up.writes(); len(w) == 0 {
				t.Errorf("same-origin %s %s answered %d but sent NO write upstream: %s — a write "+
					"the app's own origin is allowed to make must actually cross to Lens/Track/Docs, "+
					"or this row is asserting nothing about the route it names",
					rt.method, rt.path, rr.Code, rr.Body.String())
			}
		})
	}
}

// (3) A MISSING Origin header is refused too. Non-browser clients (curl, a script) send none;
// they are not the audience for a session-cookie API, and accepting a missing Origin would let
// any HTML form that suppresses the header through.
func TestMutatingRoute_MissingOriginIsRefused(t *testing.T) {
	a, sid := sameOriginApp(t)
	req := httptest.NewRequest(http.MethodPost, "/api/track/issues", strings.NewReader(`{"title":"t"}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: sid})
	rr := httptest.NewRecorder()
	a.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("write with NO Origin header = %d, want 403", rr.Code)
	}
}

// (4) READS ARE UNTOUCHED. The guard is a WRITE-path layer; applying it to GET would break
// every normal navigation and every link into the app.
func TestGetIsNotOriginGuarded(t *testing.T) {
	a, sid := sameOriginApp(t)
	for _, p := range []string{"/api/context", "/api/track/issues", "/api/keys"} {
		req := httptest.NewRequest(http.MethodGet, p, nil)
		req.Header.Set("Origin", "https://evil.example.com")
		req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: sid})
		rr := httptest.NewRecorder()
		a.ServeHTTP(rr, req)
		if rr.Code == http.StatusForbidden && strings.Contains(rr.Body.String(), "cross-origin") {
			t.Errorf("GET %s was origin-refused — reads must not be guarded", p)
		}
	}
}

// (5) DISABLED MODE. publicBaseURL is assigned only in the oidc branch, so it is "" here.
// The check must be INERT — not "compare against empty", which refuses every browser write.
//
// RED before this change: /api/pooling, /api/distill and the Track comment POST used the
// helper WITHOUT the disabled-mode exemption, so they answered 403 to a real browser on a
// loopback self-host.
//
// ⚠ AND THE CONSEQUENCE MUST BE STATED, NOT JUST TESTED: with the check inert, a deployment
// running BFF_AUTH_MODE=disabled has NO Origin layer at all. That is deliberate — the mode
// hard-fails on any non-loopback bind, so the loopback bind is the boundary — but it means a
// self-hoster who reaches that port from elsewhere (an SSH tunnel, a reverse proxy they added)
// has no CSRF layer beyond the cookie's SameSite. deploy/README.md says so as of this change.
func TestDisabledMode_OriginCheckIsInert_NotEmptyStringComparison(t *testing.T) {
	a := newApp(config{
		lensBaseURL:     "http://127.0.0.1:1",
		provisionSecret: testProvisionSecret,
		webDist:         t.TempDir(),
		authMode:        authModeDisabled,
	}, nil)

	for _, rt := range everyMutatingRoute() {
		if rt.exempt {
			continue
		}
		req := httptest.NewRequest(rt.method, rt.path, strings.NewReader(rt.body))
		req.Header.Set("Content-Type", "application/json")
		// A browser ALWAYS sends Origin on a write. In disabled mode it is the loopback host.
		req.Header.Set("Origin", "http://127.0.0.1:8787")
		rr := httptest.NewRecorder()
		a.ServeHTTP(rr, req)

		if rr.Code == http.StatusForbidden && strings.Contains(strings.ToLower(rr.Body.String()), "origin") {
			t.Errorf("disabled mode: %s %s refused as cross-origin (%d) — publicBaseURL is \"\" in "+
				"this mode, so comparing against it rejects every real browser write: %s",
				rt.method, rt.path, rr.Code, rr.Body.String())
		}
	}
}

// (6) ONE IMPLEMENTATION, NOT TWO. The structural half of the fix: after this change there is
// exactly one function that decides the rule, so the two cannot drift into different
// disabled-mode behaviour again. Asserted on the source, because that is where the drift was.
func TestOnlyOneOriginRuleExists(t *testing.T) {
	src := readBFFSource(t)
	// tenant.go's bare predicate is gone; requireSameOrigin is the single decider.
	if strings.Contains(src, "func (a *app) originAllowed(") {
		t.Errorf("originAllowed still exists alongside requireSameOrigin — two implementations of " +
			"one rule is what produced the disabled-mode divergence; there must be exactly one")
	}
	if n := strings.Count(src, `r.Header.Get("Origin")`); n != 1 {
		t.Errorf("Origin is read in %d places, want exactly 1 (inside the single guard) — a second "+
			"reader is a second rule", n)
	}
}

// (7) LOGOUT IS A WRITE TOO. handleLogout's own comment reasons about SameSite protecting it
// from a foreign page; the Origin gate makes that a second, explicit layer. Before the gate
// moved to ServeHTTP, /auth/logout had no Origin check of any kind.
func TestLogout_RefusesCrossOrigin(t *testing.T) {
	a, sid := sameOriginApp(t)
	req := httptest.NewRequest(http.MethodPost, "/auth/logout", nil)
	req.Header.Set("Origin", "https://evil.example.com")
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: sid})
	rr := httptest.NewRecorder()
	a.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("cross-origin logout = %d, want 403 — a foreign page must not be able to log "+
			"someone out", rr.Code)
	}
	// …and the session must survive a refused logout.
	if _, ok := a.auth.sessions.get(sid); !ok {
		t.Errorf("the session was destroyed by a REFUSED cross-origin logout")
	}
}
