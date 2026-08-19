package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// ── TRACK'S AI, THE FIRST BROWSER CONTROL ────────────────────────────────────
//
// W1.7 asked for "Track's AI ENTIRELY" — measured twice by earlier sessions as: the frontend
// never calls these endpoints and does not consume ai_available at all. This route is the first
// one that does.
//
// ⚠ THE UPSTREAM SHAPE IS MEASURED, NOT READ. tab-9e42 ran talyvor-track's own engine at
// `eb0b39b` in a scratch copy (`SummarizeThread` + the handler's branch table, no DB needed) and
// observed the three bodies this route can return, all 200:
//
//	comments= 0 → {"min_comments":10,"summary_available":false}
//	comments= 1 → {"min_comments":10,"summary_available":false}
//	comments= 9 → {"min_comments":10,"summary_available":false}
//	comments=10 → {"ai_available":false,"reason":"AI is not configured: set TRACK_LENS_MINT_KEY …"}
//
// — with AI UNCONFIGURED in all four. That asymmetry is the finding: `SummarizeThread` checks the
// comment count BEFORE it checks availability, so on a deployment where AI has never run, every
// issue under the threshold answers "come back with ten comments" and the ai_available state is
// UNREACHABLE. The suite must not turn that answer into a promise.
//
// These tests pin the ENVELOPE (path, method, workspace source, verbatim body). What the screen
// says about each body is pinned in apps/web/src/areas/track/IssueDetail.test.tsx.

// TestTrackIssueSummary_ForwardsToTheWorkspaceScopedUpstream is the route itself: the id from the
// URL, the workspace from the SESSION, and the upstream path Track actually mounts
// (internal/ai/handler.go Mount → GET /v1/workspaces/{wsID}/issues/{id}/summary).
func TestTrackIssueSummary_ForwardsToTheWorkspaceScopedUpstream(t *testing.T) {
	track := newCaptureUpstream(t, `{"summary":"s","key_points":[],"next_action":"n","sentiment":"neutral"}`)
	a, sess := productApp(t, track, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/track/issues/iss-9/summary", nil)
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("got %d (%s), want 200", rec.Code, rec.Body.String())
	}
	if want := "/v1/workspaces/track-ws-7/issues/iss-9/summary"; track.path != want {
		t.Fatalf("upstream path = %q, want %q", track.path, want)
	}
	if got := track.headers.Get("X-Gateway-Auth"); got != testTrackSecret {
		t.Fatalf("X-Gateway-Auth = %q — the transit proof must be attached server-side", got)
	}
}

// ⚠ THE WORKSPACE IS NOT NAMEABLE BY THE BROWSER. Same property trackWorkspacePath exists for: a
// workspace the caller could name is a workspace the caller could choose. Nothing in the query,
// and nothing in a header, may move the upstream path off the session's workspace.
func TestTrackIssueSummary_TheRequestCannotChooseAWorkspace(t *testing.T) {
	track := newCaptureUpstream(t, `{"summary":"s"}`)
	a, sess := productApp(t, track, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet,
		"/api/track/issues/iss-9/summary?workspace_id=someone-else&wsID=someone-else", nil)
	req.Header.Set("X-Workspace-Id", "someone-else")
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if want := "/v1/workspaces/track-ws-7/issues/iss-9/summary"; track.path != want {
		t.Fatalf("upstream path = %q, want %q — the request steered the tenant", track.path, want)
	}
	if track.rawQuery != "" {
		t.Fatalf("upstream query = %q, want empty — this read takes no parameters", track.rawQuery)
	}
}

// A stranger gets no summary and no upstream call. The route is a read, so this is the rule
// TestEveryMountedRoute_RefusesAnonymousRead enforces over the whole router; asserted here too
// because that sweep's 405 branch cannot tell a refusal from a route with no GET surface.
//
// ⚠⚠ WHAT THIS TEST'S GREEN DOES *NOT* MEAN, MEASURED RATHER THAN REASONED ABOUT. This route is
// THREE refusals deep and each answers a byte-identical 401, so no black-box assertion can name
// which one produced it. Controls C1, C1b and C1c of w17-tracksummary-controls-9e42.py measured
// exactly that: removing `requireSession` from trackIssueSummary alone → still 401, still no dial;
// ignoring trackWorkspaceFor's refusal and inventing a workspace alone → still 401, still no dial;
// BOTH stacked → STILL 401 and still no dial, because forwardProduct runs its own `sessionFrom`
// (lens.go). So do not read this green as "the wrapper is checked" — it is not. What it does prove
// is the OUTCOME a stranger gets, which is the thing a user can observe.
//
// ⚠ THE SAME PROPERTY IS ALREADY RECORDED ONE ROUTE OVER, at TestDocsAsk_RequiresASession, in the
// same words and for the same three layers. This route inherits it by using the same helpers; it
// is written down here too because the next person to touch THIS file will read THIS comment.
func TestTrackIssueSummary_RefusesAnonymously(t *testing.T) {
	track := newCaptureUpstream(t, `{"summary":"s"}`)
	a, _ := productApp(t, track, nil)

	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/track/issues/iss-9/summary", nil))

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("got %d (%s), want 401", rec.Code, rec.Body.String())
	}
	if track.path != "" {
		t.Fatalf("upstream was called for a stranger: %q", track.path)
	}
}

// ⚠ A SUMMARY IS A METERED AI CALL, SO THE VERB MATTERS. GET is what Track mounts, and anything
// else answers 405 here rather than falling through to /api/track/issues/{id}'s PATCH.
// ⚠⚠ THE MOUNT IS ASSERTED IN THIS SAME TEST, AND WITHOUT IT THIS TEST COULD NOT FAIL.
// `handleAPINotFound` (lens.go) is mounted at `/api/` and answers **405 to any non-GET on any
// unmounted `/api/*` path**, so "only GET is served here" and "nothing is served here" are the
// same response to a loop that reads the status code. MEASURED: with the
// `/api/track/issues/{id}/summary` mount removed from lens.go, four tests in this package went red
// and this one stayed GREEN — and the `track.path != ""` arm went with it, because an unmounted
// route reaches no upstream either. The GET first is what anchors both.
func TestTrackIssueSummary_OnlyGET(t *testing.T) {
	track := newCaptureUpstream(t, `{"summary":"s"}`)
	a, sess := productApp(t, track, nil)

	// The route EXISTS: a GET reaches Track at its workspace-scoped path.
	rec := httptest.NewRecorder()
	get := httptest.NewRequest(http.MethodGet, "/api/track/issues/iss-9/summary", nil)
	get.AddCookie(sess)
	a.ServeHTTP(rec, get)
	if want := "/v1/workspaces/track-ws-7/issues/iss-9/summary"; rec.Code != http.StatusOK || track.path != want {
		t.Fatalf("GET = %d upstream=%q, want 200 forwarded to %q — the 405s below prove nothing "+
			"about an unmounted route", rec.Code, track.path, want)
	}
	// The baseline is the path that GET forwarded, not the empty string: a refused verb must
	// leave it untouched, and comparing against "" would be satisfied by an unmounted route.
	forwarded := track.path

	for _, m := range []string{http.MethodPost, http.MethodPatch, http.MethodDelete} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(m, "/api/track/issues/iss-9/summary", nil)
		req.AddCookie(sess)
		a.ServeHTTP(rec, req)
		if rec.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s got %d (%s), want 405", m, rec.Code, rec.Body.String())
		}
		if track.path != forwarded {
			t.Fatalf("%s reached the upstream at %q", m, track.path)
		}
	}
}

// ⚠ ALL THREE BODIES TRAVEL VERBATIM, INCLUDING THE ONE THAT IS NOT A SUMMARY. Track owns this
// schema and discriminates by FIELD, not by status — every one of these is a 200. A BFF that
// re-encoded, or that turned `ai_available:false` into an error, would destroy the only
// information the screen has to tell "AI is off" from "this thread is too short".
func TestTrackIssueSummary_EveryUpstreamShapeArrivesUnchanged(t *testing.T) {
	for _, body := range []string{
		`{"summary":"Two people disagree about scope.","key_points":["a","b"],"next_action":"decide","sentiment":"blocked"}`,
		`{"ai_available":false,"reason":"AI is not configured: set TRACK_LENS_MINT_KEY to the value of Lens's LENS_MINT_KEY."}`,
		`{"summary_available":false,"min_comments":10}`,
	} {
		track := newCaptureUpstream(t, body)
		a, sess := productApp(t, track, nil)

		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/track/issues/iss-9/summary", nil)
		req.AddCookie(sess)
		a.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("got %d for %s, want the upstream's 200", rec.Code, body)
		}
		var got, want map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("response is not JSON: %s", rec.Body.String())
		}
		_ = json.Unmarshal([]byte(body), &want)
		if len(got) != len(want) {
			t.Fatalf("field count %d != %d — the body did not arrive whole:\n got %s\nwant %s",
				len(got), len(want), rec.Body.String(), body)
		}
		for k, v := range want {
			if _, ok := got[k]; !ok {
				t.Fatalf("field %q dropped on the way through: %s", k, rec.Body.String())
			}
			if k == "ai_available" || k == "summary_available" {
				if got[k] != v {
					t.Fatalf("field %q = %v, want %v — the discriminator changed value", k, got[k], v)
				}
			}
		}
	}
}

// A 404 upstream stays a 404. The id is the browser's, so "no such issue" is an ordinary answer
// and must not be reported as "Track is off" — the same rule trackIssueDetail is written to.
func TestTrackIssueSummary_UpstreamNotFoundStaysNotFound(t *testing.T) {
	track := newStatusUpstream(t, http.StatusNotFound, `{"error":"issue not found","code":"NOT_FOUND"}`)
	a, sess := productApp(t, track, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/track/issues/nope/summary", nil)
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("got %d (%s), want 404", rec.Code, rec.Body.String())
	}
}

// With no Track upstream configured this deployment answers 503 with the sentence the product
// already uses, and never dials. Measured today: this deployment runs no Track at all.
func TestTrackIssueSummary_NoTrackUpstreamIs503(t *testing.T) {
	a, sess := productApp(t, nil, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/track/issues/iss-9/summary", nil)
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("got %d (%s), want 503", rec.Code, rec.Body.String())
	}
}
