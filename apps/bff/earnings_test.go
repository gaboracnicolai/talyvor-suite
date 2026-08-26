package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// earnings_test.go — /api/earnings, the BFF half of W4.6.1 step 7.
//
// ⚠ EVERY ASSERTION HERE IS ABOUT WHAT THE ROUTE DELIVERS, NEVER MERELY WHAT IT REFUSES. That is
// workspaces_test.go's lesson in this package, measured there rather than argued: an UNMOUNTED
// route answers 404 with an empty body, which satisfies every "no secret leaked" sweep MORE easily
// than a working route does — so a refusal-shaped test is happiest when the feature is gone.

func TestEarnings_ForwardsToLensWorkspaceEarnings(t *testing.T) {
	var gotAuth string
	a := newTestApp(t, &gotAuth)

	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/earnings", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("[B1] status = %d, want 200 — the route must be MOUNTED and reach Lens. A screen "+
			"cannot be built on a route that is not there: %s", rec.Code, rec.Body.String())
	}
	// newTestApp's fake Lens echoes {"path":…,"query":…}.
	body := rec.Body.String()
	if !strings.Contains(body, `/earnings"`) {
		t.Errorf("[B2] upstream path = %s, want a path ending /earnings", body)
	}
	if !strings.Contains(body, `"path":"/v1/workspaces/`) {
		t.Errorf("[B3] upstream path = %s, want the WORKSPACE-SCOPED Lens path. An unscoped "+
			"/v1/earnings would be a different endpoint and would not exist.", body)
	}
	if !strings.HasPrefix(gotAuth, "Bearer ") || gotAuth == "Bearer " {
		t.Errorf("[B4] upstream Authorization = %q, want the session's workspace-scoped bearer", gotAuth)
	}
}

// TestEarnings_IsReadOnly — wsProxyFixed refuses everything but GET, and this route reads a money
// figure. A POST that fell through would be a write path nobody designed.
func TestEarnings_IsReadOnly(t *testing.T) {
	a := newTestApp(t, nil)
	for _, m := range []string{http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodPatch} {
		rec := httptest.NewRecorder()
		a.ServeHTTP(rec, httptest.NewRequest(m, "/api/earnings", strings.NewReader("{}")))
		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("[B5-%s] status = %d, want 405", m, rec.Code)
		}
	}
	// The control, so the four above are not passing because the route refuses EVERYTHING.
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/earnings", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("[B5-CONTROL] GET returns %d — the 405s above prove nothing if nothing works", rec.Code)
	}
}

// TestEarnings_IgnoresACallerSuppliedWorkspace — the workspace comes from the session. A query
// parameter naming somebody else's workspace must not reach Lens, or this read is a cross-tenant
// read of a money figure.
func TestEarnings_IgnoresACallerSuppliedWorkspace(t *testing.T) {
	var gotAuth string
	a := newTestApp(t, &gotAuth)

	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet,
		"/api/earnings?workspace_id=someone-elses-workspace&workspace=someone-elses-workspace", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("[B6-PREMISE] status = %d; this test needs the request to SUCCEED so it can check "+
			"where it went: %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "someone-elses-workspace") {
		t.Fatalf("[B6] a caller-supplied workspace reached Lens: %s", rec.Body.String())
	}
}
