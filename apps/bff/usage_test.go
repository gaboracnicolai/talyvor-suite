package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The usage route is the cache panel's data source. Lens has served it all along
// (internal/api/server.go: GET /v1/api/usage — "per-model usage + serve_source cache hit
// rate (trial core), one call"); nothing in the suite ever called it, so two screens drew
// an invented 87% hit rate instead. These tests pin the proxy contract BEFORE the screens
// are wired to it.
//
// The upstream path carries NO workspace segment: /v1/api/usage scopes itself from the
// AUTHENTICATED KEY (effectiveWorkspaceID), and the key is exactly what this BFF attaches
// server-side. So the pinning that every other route does with a config-built path is here
// done by the credential — there is no client input in the upstream path at all.

func TestUsageForwardsToLensUsage(t *testing.T) {
	var gotAuth string
	a := newTestApp(t, &gotAuth)

	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/usage", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	// newTestApp's fake Lens echoes {"path":…,"query":…}.
	if !strings.Contains(rec.Body.String(), `"path":"/v1/api/usage"`) {
		t.Errorf("upstream path = %s, want /v1/api/usage", rec.Body.String())
	}
	if !strings.HasPrefix(gotAuth, "Bearer ") || gotAuth == "Bearer " {
		t.Errorf("upstream Authorization = %q, want the session's workspace-scoped bearer token", gotAuth)
	}
}

// days is the ONLY parameter that passes, and it is clamped — the Overview asks for 30 and
// the Spend screen's window toggle asks for 7 or 30, so the window must reach Lens or the
// caption ("last 30 days") would describe a different number than the one shown.
func TestUsageDaysSanitised(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{"", "days=30"},       // default matches the Overview caption
		{"?days=7", "days=7"}, // the Spend screen's 7d window
		{"?days=0", "days=1"}, // a zero window is not a window
		{"?days=9999", "days=365"},
		{"?days=abc", "days=30"}, // unparseable → the default, never a raw passthrough
		{"?days=-5", "days=1"},
	} {
		a := newTestApp(t, nil)
		rec := httptest.NewRecorder()
		a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/usage"+tc.in, nil))
		if !strings.Contains(rec.Body.String(), tc.want) {
			t.Errorf("days %q → query %s, want %s", tc.in, rec.Body.String(), tc.want)
		}
	}
}

// No parameter other than days reaches Lens: the route is a fixed read, not a query surface.
func TestUsageDropsUnknownParams(t *testing.T) {
	a := newTestApp(t, nil)
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet,
		"/api/usage?days=7&workspace_id=someone-else&model=gpt-4o", nil))

	body := rec.Body.String()
	if strings.Contains(body, "workspace_id") || strings.Contains(body, "gpt-4o") {
		t.Errorf("unknown parameters reached Lens: %s", body)
	}
	if !strings.Contains(body, "days=7") {
		t.Errorf("days was dropped along with them: %s", body)
	}
}

// ?workspace_id= is how an ADMIN key targets another workspace upstream. This BFF holds a
// WORKSPACE key, but dropping the parameter (above) is the load-bearing half: it means the
// route cannot be aimed at another tenant even if the deployment's key were ever upgraded.
//
// ⚠⚠ THE MOUNT IS ASSERTED IN THIS SAME TEST, AND WITHOUT IT THIS TEST COULD NOT FAIL.
// `handleAPINotFound` (lens.go) is mounted at `/api/` and answers **405 to any non-GET on any
// unmounted `/api/*` path**, so "this route refuses writes" and "this route does not exist" are
// the SAME response and a loop reading only the status code cannot tell them apart. MEASURED
// rather than argued: with the `/api/usage` mount statement removed from lens.go entirely, this
// test passed verbatim — four tests in this package went red and this one, the one whose NAME
// makes the claim, stayed green. Asserting the GET first makes the 405s below evidence about a
// route instead of evidence about the fallback.
func TestUsageIsReadOnly(t *testing.T) {
	a := newTestApp(t, nil)

	// The route EXISTS: a GET reaches Lens. Without this the loop below is a test of
	// handleAPINotFound.
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/usage", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"path":"/v1/api/usage"`) {
		t.Fatalf("GET = %d %s, want 200 forwarded to /v1/api/usage — the 405s below "+
			"prove nothing about an unmounted route", rec.Code, rec.Body.String())
	}

	for _, m := range []string{http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodPatch} {
		rec := httptest.NewRecorder()
		a.ServeHTTP(rec, httptest.NewRequest(m, "/api/usage", nil))
		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s /api/usage = %d, want 405", m, rec.Code)
		}
	}
}
