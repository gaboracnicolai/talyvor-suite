package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The workspace-list read. `/api/workspaces` is `requireSession(proxyFixed("/v1/workspaces"))`,
// and it is the ONLY user of proxyFixed in this BFF — every other Lens read goes through
// wsProxyFixed/wsProxyPaged (a workspace SEGMENT built per request) or proxyWindowed. So the
// properties proxyFixed has on its own are the properties this one route has, and nothing else
// in this package exercised them.
//
// ⚠⚠ WHY THIS FILE EXISTS: MEASURED, NOT ARGUED — WITH THE `/api/workspaces` MOUNT STATEMENT
// DELETED FROM lens.go ENTIRELY, THE WHOLE BFF SUITE STAYED GREEN. It was the only mounted
// route in this package with that property: every other route removed one at a time was caught
// by at least one test (the six the hand-off named as uncovered were re-measured, and the five
// `/api/admin/*` ones are in fact caught, by the `found < 6` floor in
// TestOperatorExemptionHoldsOnlyWhileAdminIsNotWired).
//
// ⚠ AND IT WAS NOT UNSWEPT — IT WAS SWEPT BY ARMS THE DEFECT SATISFIES MORE EASILY THAN THE
// CONTRACT, which is the same shape #249 found in docs_search and track_ai:
//
//   - `TestKeyNeverReachesResponse` NAMES "/api/workspaces" in its fourteen-line list, and its
//     per-endpoint arm is assertNoSecretLeak — an unmounted route answers 404
//     {"error":"no such endpoint"}, which leaks nothing, so the sweep is HAPPIER when the route
//     is gone than when it is there.
//   - The three population sweeps take their population FROM mountedPatterns(), which reads the
//     mount statements out of lens.go — so a route that leaves the router leaves the population
//     with it, and a sweep over a shrinking population cannot notice a row go.
//
// Every assertion below therefore asserts what the route DELIVERS, never merely what it refuses.
func TestWorkspacesForwardsToLensWorkspaces(t *testing.T) {
	var gotAuth string
	a := newTestApp(t, &gotAuth)

	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/workspaces", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 — the route must be MOUNTED and reach Lens: %s",
			rec.Code, rec.Body.String())
	}
	// newTestApp's fake Lens echoes {"path":…,"query":…}.
	if !strings.Contains(rec.Body.String(), `"path":"/v1/workspaces"`) {
		t.Errorf("upstream path = %s, want /v1/workspaces", rec.Body.String())
	}
	// The flip side, asserted HERE for THIS route. TestKeyNeverReachesResponse also checks a
	// bearer reached the upstream, but it does so ONCE, AFTER a loop over fourteen endpoints,
	// against a variable every one of them overwrites — so it is satisfied by whichever endpoint
	// ran last and says nothing about this one.
	if !strings.HasPrefix(gotAuth, "Bearer ") || gotAuth == "Bearer " {
		t.Errorf("upstream Authorization = %q, want the session's workspace-scoped bearer token", gotAuth)
	}
}

// proxyFixed forwards a fixed upstream path with an EMPTY query — its docstring says "with no
// query parameters" and this is the only route that can hold it to that.
//
// ⚠ `?workspace_id=` is how an ADMIN key aims at another tenant upstream. This BFF attaches a
// WORKSPACE-scoped key, so that is not today's exposure; dropping the parameter is what keeps it
// from becoming one if a deployment's credential is ever upgraded. The same reasoning is already
// written down for /api/usage and /api/spend/by-feature, both of which pass a `days` window —
// this route passes NOTHING, so the assertion is that the forwarded query is exactly empty
// rather than that one known-bad key is absent.
func TestWorkspacesDropsEveryQueryParam(t *testing.T) {
	a := newTestApp(t, nil)
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet,
		"/api/workspaces?workspace_id=someone-else&limit=99&offset=5&foo=bar", nil))

	if !strings.Contains(rec.Body.String(), `"query":""`) {
		t.Errorf("forwarded query = %s, want an empty query — proxyFixed passes no client "+
			"parameter to Lens at all", rec.Body.String())
	}
}

// ⚠⚠ THE MOUNT IS ASSERTED IN THIS SAME TEST, AND WITHOUT IT THIS TEST COULD NOT FAIL.
// `handleAPINotFound` is mounted at `/api/` and answers 405 to any non-GET on any UNMOUNTED
// `/api/*` path, so "this route refuses writes" and "this route does not exist" are the same
// response. That trap was measured and repaired for three other routes in #249; this route had
// no method test at all, so it is written the repaired way from the start.
func TestWorkspacesIsReadOnly(t *testing.T) {
	a := newTestApp(t, nil)

	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/workspaces", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"path":"/v1/workspaces"`) {
		t.Fatalf("GET = %d %s, want 200 forwarded to /v1/workspaces — the 405s below "+
			"prove nothing about an unmounted route", rec.Code, rec.Body.String())
	}

	for _, m := range []string{http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodPatch} {
		rec := httptest.NewRecorder()
		a.ServeHTTP(rec, httptest.NewRequest(m, "/api/workspaces", nil))
		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s /api/workspaces = %d, want 405", m, rec.Code)
		}
	}
}
