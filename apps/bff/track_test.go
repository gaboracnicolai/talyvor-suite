package main

// Track Tier-1 route tests. Same harness as products_test.go (captureUpstream +
// productApp); same non-negotiables (requireSession, credentials server-side,
// honest status passthrough, never-leaks) plus the two decided surfaces this PR
// argues: the issues-list query contract and the refusal of the upstream's
// documented-but-unparsed `labels` parameter.

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func trackGET(t *testing.T, a *app, sess *http.Cookie, target string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	if sess != nil {
		req.AddCookie(sess)
	}
	a.ServeHTTP(rec, req)
	return rec
}

// TestTrackIssues_PinsWorkspaceAndForwardsAllowlist: every allowlisted filter
// forwards (escaped), the workspace comes from CONFIG, credentials attach
// server-side, and the upstream's bare array streams back verbatim.
func TestTrackIssues_PinsWorkspaceAndForwardsAllowlist(t *testing.T) {
	track := newCaptureUpstream(t, `[{"id":"isu-1","identifier":"ENG-1"}]`)
	a, sess := productApp(t, track, nil)

	rec := trackGET(t, a, sess,
		"/api/track/issues?status=In+Progress&team_id=team-9&project_id=prj-2&cycle_id=cyc-3&assignee_id=mem-4&priority=2&order_by=updated_at&order_dir=ASC&limit=25&offset=50")
	if rec.Code != http.StatusOK {
		t.Fatalf("got %d (%s), want 200", rec.Code, rec.Body.String())
	}
	if track.path != "/v1/workspaces/track-ws-7/issues" {
		t.Fatalf("upstream path = %q — must be pinned to the CONFIGURED track workspace", track.path)
	}
	want := "status=In+Progress&team_id=team-9&project_id=prj-2&cycle_id=cyc-3&assignee_id=mem-4&priority=2&order_by=updated_at&order_dir=asc&limit=25&offset=50"
	if track.rawQuery != want {
		t.Fatalf("upstream query =\n  %q\nwant\n  %q", track.rawQuery, want)
	}
	if got := track.headers.Get("X-Gateway-Auth"); got != testTrackSecret {
		t.Fatalf("X-Gateway-Auth = %q — transit proof must be attached server-side", got)
	}
	if got := track.headers.Get("X-User-Email"); got != "ng@example.com" {
		t.Fatalf("X-User-Email = %q, want the session's email", got)
	}
	if !strings.Contains(rec.Body.String(), "ENG-1") {
		t.Fatalf("upstream body not streamed: %s", rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "gwsecret_") {
		t.Fatalf("gateway secret leaked: %s", rec.Body.String())
	}
}

// TestTrackIssues_DefaultsMirrorUpstreamBounds: no client params ⇒ the
// upstream's own default page (limit=50, offset=0) is stated explicitly; a
// limit beyond the upstream cap clamps to it (250).
func TestTrackIssues_DefaultsMirrorUpstreamBounds(t *testing.T) {
	track := newCaptureUpstream(t, `[]`)
	a, sess := productApp(t, track, nil)

	if rec := trackGET(t, a, sess, "/api/track/issues"); rec.Code != http.StatusOK {
		t.Fatalf("bare list: got %d (%s)", rec.Code, rec.Body.String())
	}
	if track.rawQuery != "limit=50&offset=0" {
		t.Fatalf("default query = %q, want limit=50&offset=0", track.rawQuery)
	}

	if rec := trackGET(t, a, sess, "/api/track/issues?limit=99999&offset=-3"); rec.Code != http.StatusOK {
		t.Fatalf("clamped list: got %d (%s)", rec.Code, rec.Body.String())
	}
	if track.rawQuery != "limit=250&offset=0" {
		t.Fatalf("clamped query = %q, want limit=250&offset=0", track.rawQuery)
	}
}

// TestTrackIssues_EmptyValuesAreAbsentFilters: `?status=&assignee_id=` is the
// upstream's own "no filter" semantics — dropped from the forward, not an error.
func TestTrackIssues_EmptyValuesAreAbsentFilters(t *testing.T) {
	track := newCaptureUpstream(t, `[]`)
	a, sess := productApp(t, track, nil)
	if rec := trackGET(t, a, sess, "/api/track/issues?status=&assignee_id="); rec.Code != http.StatusOK {
		t.Fatalf("got %d (%s)", rec.Code, rec.Body.String())
	}
	if track.rawQuery != "limit=50&offset=0" {
		t.Fatalf("query = %q — empty values must vanish, not forward", track.rawQuery)
	}
}

// TestTrackIssues_RefusalContract: the decided 400s, each named. The upstream
// must never be dialed on a refused request.
func TestTrackIssues_RefusalContract(t *testing.T) {
	cases := []struct {
		name, target, wantInBody string
	}{
		// labels: Track's doc-comment advertises it; the handler never parses
		// it. Forwarding would render unfiltered results as filtered.
		{"labels refused as unimplemented", "/api/track/issues?labels=bug", "not implemented"},
		{"unknown key refused, allowlist named", "/api/track/issues?workspace_id=other-tenant", "unknown query parameter"},
		{"duplicate key refused", "/api/track/issues?status=a&status=b", "more than once"},
		{"order_by outside upstream allowlist", "/api/track/issues?order_by=id", "order_by must be one of"},
		{"order_dir not asc/desc", "/api/track/issues?order_dir=sideways", "order_dir must be"},
		{"priority non-integer", "/api/track/issues?priority=urgent", "positive integer"},
		{"priority zero (upstream no-op)", "/api/track/issues?priority=0", "positive integer"},
		{"control character in a filter value", "/api/track/issues?status=a%00b", "invalid value"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			track := newCaptureUpstream(t, `[]`)
			a, sess := productApp(t, track, nil)
			rec := trackGET(t, a, sess, tc.target)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("got %d (%s), want 400", rec.Code, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), tc.wantInBody) {
				t.Fatalf("400 body %q must contain %q", rec.Body.String(), tc.wantInBody)
			}
			if track.headers != nil {
				t.Fatal("a refused request must never reach the upstream")
			}
		})
	}
}

// TestTrackIssueDetail_BuildsPathAnd404StaysHonest: the id lands escaped in the
// pinned path; a SEC-5 not-found (foreign ≡ unknown) passes through as-is —
// status AND body — never laundered into "capability off".
func TestTrackIssueDetail_BuildsPathAnd404StaysHonest(t *testing.T) {
	notFound := `{"error":"issue not found","code":"NOT_FOUND"}`
	track := newStatusUpstream(t, http.StatusNotFound, notFound)
	a, sess := productApp(t, track, nil)

	rec := trackGET(t, a, sess, "/api/track/issues/isu-77?stray=param")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("got %d, want the upstream 404 untouched", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "NOT_FOUND") {
		t.Fatalf("upstream 404 body must pass through, got: %s", rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "enabled") {
		t.Fatalf("404 must NOT be laundered into a capability envelope: %s", rec.Body.String())
	}
	if track.path != "/v1/workspaces/track-ws-7/issues/isu-77" {
		t.Fatalf("upstream path = %q", track.path)
	}
	if track.rawQuery != "" {
		t.Fatalf("detail forwards no query, got %q", track.rawQuery)
	}
}

// TestTrackIssueComments_Path: nested id route → /issues/{id}/comments, body verbatim.
func TestTrackIssueComments_Path(t *testing.T) {
	track := newCaptureUpstream(t, `[{"id":"cmt-1","body":"first"}]`)
	a, sess := productApp(t, track, nil)

	rec := trackGET(t, a, sess, "/api/track/issues/isu-8/comments")
	if rec.Code != http.StatusOK {
		t.Fatalf("got %d (%s)", rec.Code, rec.Body.String())
	}
	if track.path != "/v1/workspaces/track-ws-7/issues/isu-8/comments" {
		t.Fatalf("upstream path = %q", track.path)
	}
	if !strings.Contains(rec.Body.String(), "cmt-1") {
		t.Fatalf("body not streamed: %s", rec.Body.String())
	}
}

// TestTrackTeams_Path: pinned team list, no parameters forwarded.
func TestTrackTeams_Path(t *testing.T) {
	track := newCaptureUpstream(t, `[{"id":"team-9","key":"ENG"}]`)
	a, sess := productApp(t, track, nil)

	rec := trackGET(t, a, sess, "/api/track/teams?anything=ignored")
	if rec.Code != http.StatusOK {
		t.Fatalf("got %d (%s)", rec.Code, rec.Body.String())
	}
	if track.path != "/v1/workspaces/track-ws-7/teams" {
		t.Fatalf("upstream path = %q", track.path)
	}
	if track.rawQuery != "" {
		t.Fatalf("teams forwards no query, got %q", track.rawQuery)
	}
}

// TestTrackPathParamRejectsTraversal: the id segment is client input — refuse
// anything path-shaped BEFORE any dial, exactly like the Docs id-routes.
func TestTrackPathParamRejectsTraversal(t *testing.T) {
	for _, bad := range []string{"..", "%2e%2e", "a%2Fb", "a%5Cb", "%00", "."} {
		for _, route := range []string{"/api/track/issues/" + bad, "/api/track/issues/" + bad + "/comments"} {
			track := newCaptureUpstream(t, `[]`)
			a, sess := productApp(t, track, nil)
			rec := trackGET(t, a, sess, route)
			// Literal "."/".." never survive ServeMux — it CLEANS the path with a
			// 301/307/308 redirect before any handler runs; the %-encoded forms
			// reach the handler and must be OUR explicit 400. Either way: never a
			// 200, and never an upstream dial.
			switch rec.Code {
			case http.StatusBadRequest, http.StatusMovedPermanently,
				http.StatusTemporaryRedirect, http.StatusPermanentRedirect:
			default:
				t.Errorf("%s: got %d (%s), want a refusal", route, rec.Code, rec.Body.String())
			}
			if track.headers != nil {
				t.Errorf("%s: refused id must never reach the upstream", route)
			}
		}
	}
}

// TestTrackIdRoutesRequireSession: all four new routes 401 without a session and
// never touch the upstream — the same gate as every other /api route.
func TestTrackIdRoutesRequireSession(t *testing.T) {
	track := newCaptureUpstream(t, `[]`)
	a, _ := productApp(t, track, nil)
	for _, ep := range []string{
		"/api/track/issues", "/api/track/issues/isu-1",
		"/api/track/issues/isu-1/comments", "/api/track/teams",
	} {
		rec := trackGET(t, a, nil, ep)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s without session: got %d, want 401", ep, rec.Code)
		}
	}
	if track.headers != nil {
		t.Fatal("an unauthenticated request must never reach the track upstream")
	}
}

// TestTrackRoutesReadOnly: the new routes are GET-only — POST/PUT/DELETE answer
// 405 with Allow, and never dial upstream.
func TestTrackRoutesReadOnly(t *testing.T) {
	track := newCaptureUpstream(t, `[]`)
	a, sess := productApp(t, track, nil)
	for _, ep := range []string{
		"/api/track/issues", "/api/track/issues/isu-1",
		"/api/track/issues/isu-1/comments", "/api/track/teams",
	} {
		for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodDelete} {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(method, ep, strings.NewReader("{}"))
			req.AddCookie(sess)
			a.ServeHTTP(rec, req)
			if rec.Code != http.StatusMethodNotAllowed {
				t.Errorf("%s %s: got %d, want 405", method, ep, rec.Code)
			}
		}
	}
	if track.headers != nil {
		t.Fatal("a non-GET must never reach the track upstream")
	}
}

// TestTrackIssuesUnconfigured503: the route exists without TRACK_* config and
// says so — never a silent empty result.
func TestTrackIssuesUnconfigured503(t *testing.T) {
	a, sess := productApp(t, nil, nil)
	for _, ep := range []string{"/api/track/issues", "/api/track/teams"} {
		rec := trackGET(t, a, sess, ep)
		if rec.Code != http.StatusServiceUnavailable {
			t.Errorf("%s: got %d (%s), want 503", ep, rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "not configured") {
			t.Errorf("%s: 503 must say the upstream is unconfigured: %s", ep, rec.Body.String())
		}
	}
}
