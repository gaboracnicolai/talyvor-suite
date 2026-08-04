package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// testPublicOrigin is the app origin these tests enforce against.
const testPublicOrigin = "https://app.talyvor.com"

// sameOriginApp is an oidc-mode app with a seeded session and a public origin, pointed at a
// fake upstream that accepts anything — so a route that reaches upstream is observably NOT
// refused, and the only 403 a test can see is the Origin guard's own.
func sameOriginApp(t *testing.T) (*app, string) {
	t.Helper()
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
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
	a := newApp(cfg, auth)
	a.cfg.webDist = t.TempDir()
	return a, "so-sid"
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
func everyMutatingRoute() []mutatingRoute {
	return []mutatingRoute{
		{method: http.MethodPost, path: "/api/pooling", body: `{"cache_poolable":true}`},
		{method: http.MethodPost, path: "/api/distill", body: `{"distill_policy":"disabled"}`},
		{method: http.MethodPost, path: "/api/keys", body: `{"name":"k","scopes":["proxy"]}`},
		{method: http.MethodDelete, path: "/api/keys/abc", body: ``},
		{method: http.MethodPost, path: "/api/lxc/checkout", body: `{"amount_usd":10}`},
		{method: http.MethodPost, path: "/api/lens/convert", body: `{"lxc":100000}`},
		{method: http.MethodPost, path: "/api/track/issues", body: `{"title":"t"}`},
		{method: http.MethodPatch, path: "/api/track/issues/i1", body: `{"status":"todo"}`},
		{method: http.MethodPost, path: "/api/track/issues/i1/comments", body: `{"body":"c"}`},
		{method: http.MethodPost, path: "/api/docs/spaces", body: `{"name":"s"}`},
		{method: http.MethodPost, path: "/api/docs/spaces/s1/pages", body: `{"title":"p"}`},
		{method: http.MethodPatch, path: "/api/docs/spaces/s1/pages/p1", body: `{"title":"p2"}`},

		// EXEMPT — a machine caller has no Origin to send, so requiring one would break it.
		// None exists in this BFF today; the row documents the rule and the test asserts the
		// list is honest rather than assuming emptiness.
		// (No webhook or service-to-service write path is mounted here — every /api/* route is
		// session-gated and browser-driven. If one is added, mark it exempt HERE and say why.)
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
func TestEveryMutatingRoute_AllowsSameOrigin(t *testing.T) {
	for _, rt := range everyMutatingRoute() {
		if rt.exempt {
			continue
		}
		t.Run(rt.method+" "+rt.path, func(t *testing.T) {
			a, sid := sameOriginApp(t)
			req := httptest.NewRequest(rt.method, rt.path, strings.NewReader(rt.body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Origin", testPublicOrigin)
			req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: sid})
			rr := httptest.NewRecorder()
			a.ServeHTTP(rr, req)

			if rr.Code == http.StatusForbidden && strings.Contains(rr.Body.String(), "origin") {
				t.Errorf("same-origin %s %s was refused as cross-origin (%d): %s — the guard "+
					"must not refuse the app's own writes", rt.method, rt.path, rr.Code, rr.Body.String())
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
