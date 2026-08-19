package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// ── TRACK'S DUPLICATE FINDER, THE SECOND BROWSER CONTROL FOR A TRACK AI FEATURE ──────────────
//
// W1.7 lists five Track AI features (triage, find-duplicates, thread summary, sprint suggestion,
// semantic search). The summary (#225) and search (#230) reached a browser; this is the third,
// and it is the first Track AI feature that is a POST.
//
// ⚠⚠ THE UPSTREAM'S ANSWERS ARE MEASURED, NOT READ. tab-9f27 ran talyvor-track's OWN
// `ai.Handler.FindDuplicates` at `6b31a75` — the real handler, the real `issue.Store`, over a REAL
// Postgres (a throwaway `pgvector/pgvector:pg16`, track's own 27 migrations) and a recording fake
// Lens, in a /tmp `git archive` export (talyvor-track is held by another tab and was never
// written to). Eight rows, every one reproduced from a clean database:
//
//	AI off (no mint credential)          → 200 {"ai_available":false,"reason":"…TRACK_LENS_MINT_KEY…"}   0 Lens calls
//	AI on, issue alone in its team       → 200 []                                                        1 Lens call
//	AI on, model answers []              → 200 []                                                        1 Lens call
//	AI on, model answers 0.69            → 200 []                                                        1 Lens call
//	AI on, model answers 0.93            → 200 [{"issue_id":…,"identifier":"R5X-1","title":…,"similarity":0.93}]
//	AI on, model names THE SUBJECT       → 200 [{"issue_id":<the subject>,"identifier":"R6X-2",…,"similarity":1}]
//	AI on, twin in ANOTHER team          → 200 []                                                        1 Lens call
//	a foreign workspace's issue id       → 404 {"error":"issue not found","code":"NOT_FOUND"}             0 Lens calls
//
// FOUR of those matter to this route and each is written down where it is acted on:
//
//  1. THE SUCCESS SHAPE IS A BARE ARRAY AND THE REFUSAL IS AN OBJECT, both 200. A client that
//     decoded either shape into the other gets nothing — which is why the body travels verbatim
//     and the discrimination is the screen's (apps/web/src/areas/track/duplicates.ts).
//  2. `200 []` IS AT LEAST FOUR FACTS: the model named none; it named one below the 0.7 threshold
//     talyvor-track applies; it named an issue that was not in the candidate window (silently
//     dropped by the id lookup); or the window was empty. Nothing in the response distinguishes
//     them, so no screen may render `[]` as "this issue has no duplicate".
//  3. THE CANDIDATE WINDOW IS ONE TEAM. `FindDuplicates` lists by `WorkspaceID` AND `iss.TeamID`,
//     20 most recent — measured: a byte-identical twin in another team of the SAME workspace was
//     not in the prompt and the answer was `[]`.
//  4. THE SUBJECT IS IN ITS OWN CANDIDATE LIST. The prompt sent upstream carried
//     `- R6X-2 (828fcba3…): the login page hangs` — the very issue being asked about — under the
//     heading "Existing issues", and when the model echoed that id back the route answered with
//     the issue as its own duplicate at similarity 1. That is a defect in talyvor-track (a repo
//     this session does not hold) and it is reported in the queue; this app must not draw it.
//
// These tests pin the ENVELOPE (path, method, workspace source, verbatim body, no parameters).
// What the screen says about each body is pinned in apps/web/src/areas/track/.

// TestTrackFindDuplicates_ForwardsToTheWorkspaceScopedUpstream is the route itself: the id from
// the URL, the workspace from the SESSION, and the path talyvor-track actually mounts
// (internal/ai/handler.go Mount → POST /v1/workspaces/{wsID}/issues/{id}/find-duplicates).
func TestTrackFindDuplicates_ForwardsToTheWorkspaceScopedUpstream(t *testing.T) {
	track := newCaptureUpstream(t, `[{"issue_id":"iss-2","identifier":"T-2","title":"same bug","similarity":0.9}]`)
	a, sess := productApp(t, track, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/track/issues/iss-9/find-duplicates", nil)
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("got %d (%s), want 200", rec.Code, rec.Body.String())
	}
	if want := "/v1/workspaces/track-ws-7/issues/iss-9/find-duplicates"; track.path != want {
		t.Fatalf("upstream path = %q, want %q", track.path, want)
	}
	if track.method != http.MethodPost {
		t.Fatalf("upstream method = %q, want POST — Track mounts this as a POST", track.method)
	}
	if got := track.headers.Get("X-Gateway-Auth"); got != testTrackSecret {
		t.Fatalf("X-Gateway-Auth = %q — the transit proof must be attached server-side", got)
	}
}

// ⚠ THE ANSWER TRAVELS VERBATIM, AND THAT IS LOAD-BEARING. Track discriminates by SHAPE, not by
// status: the duplicate list is a bare ARRAY and "AI is off" is an OBJECT, both 200. Re-encoding
// here — or mapping the refusal onto an error status — would destroy the only information the
// screen has to tell a working-but-empty answer from a deployment where AI has never run.
func TestTrackFindDuplicates_TheAIOffBodyArrivesUnchanged(t *testing.T) {
	const upstream = `{"ai_available":false,"reason":"AI is not configured: set TRACK_LENS_MINT_KEY to the value of Lens's LENS_MINT_KEY."}`
	track := newCaptureUpstream(t, upstream)
	a, sess := productApp(t, track, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/track/issues/iss-9/find-duplicates", nil)
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("got %d, want 200 — Track answers 'AI is off' with a 200 and a flag", rec.Code)
	}
	if got := strings.TrimSpace(rec.Body.String()); got != upstream {
		t.Fatalf("body = %q, want it byte-identical to the upstream's:\n  %q", got, upstream)
	}
}

// ⚠ THE WORKSPACE IS NOT NAMEABLE BY THE BROWSER — trackWorkspacePath's whole reason. A workspace
// the caller could name is a workspace the caller could choose. And no query travels: Track's
// FindDuplicates reads NO query parameter and NO request body, so anything forwarded would be sent
// upstream to be ignored and would make this path look parameterised.
func TestTrackFindDuplicates_TheRequestCannotChooseAWorkspaceOrSendAnything(t *testing.T) {
	track := newCaptureUpstream(t, `[]`)
	a, sess := productApp(t, track, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost,
		"/api/track/issues/iss-9/find-duplicates?workspace_id=someone-else&team_id=theirs",
		strings.NewReader(`{"workspace_id":"someone-else","limit":9999}`))
	req.Header.Set("X-Workspace-Id", "someone-else")
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if want := "/v1/workspaces/track-ws-7/issues/iss-9/find-duplicates"; track.path != want {
		t.Fatalf("upstream path = %q, want %q — the request steered the tenant", track.path, want)
	}
	if track.rawQuery != "" {
		t.Fatalf("upstream query = %q, want empty — this route takes no parameters", track.rawQuery)
	}
	if len(track.reqBody) != 0 {
		t.Fatalf("upstream body = %q, want empty — Track's FindDuplicates decodes no body, so "+
			"forwarding one sends a field that will be ignored and read back as honoured",
			string(track.reqBody))
	}
}

// A stranger gets no duplicate list and no upstream call — and no SPEND: on a deployment with AI
// configured, every one of these is a metered Lens completion billed to the workspace.
//
// ⚠⚠ WHAT THIS TEST'S GREEN DOES *NOT* MEAN. Like /api/track/issues/{id}/summary and
// /api/docs/ai/ask, this route is THREE refusals deep — the wrapper, trackWorkspaceFor, and
// forwardProduct's own sessionFrom — and each answers a byte-identical 401, so no black-box
// assertion can name which one produced it. Controls C1/C1b/C1c of
// w17-tracksummary-controls-9e42.py measured exactly that one route over. What this green proves
// is the OUTCOME a stranger gets, which is the thing a user can observe.
func TestTrackFindDuplicates_RefusesAnonymously(t *testing.T) {
	track := newCaptureUpstream(t, `[]`)
	a, _ := productApp(t, track, nil)

	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/track/issues/iss-9/find-duplicates", nil))

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("got %d (%s), want 401", rec.Code, rec.Body.String())
	}
	if track.path != "" {
		t.Fatalf("upstream was called for a stranger: %q", track.path)
	}
}

// ⚠ THE VERB MATTERS BECAUSE THE CALL COSTS. POST is what Track mounts; anything else answers 405
// here rather than dialling upstream or falling through to another route's handler.
func TestTrackFindDuplicates_RefusesOtherMethods(t *testing.T) {
	for _, m := range []string{http.MethodGet, http.MethodPatch, http.MethodDelete, http.MethodPut} {
		track := newCaptureUpstream(t, `[]`)
		a, sess := productApp(t, track, nil)

		rec := httptest.NewRecorder()
		req := httptest.NewRequest(m, "/api/track/issues/iss-9/find-duplicates", nil)
		req.AddCookie(sess)
		a.ServeHTTP(rec, req)

		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s → %d (%s), want 405", m, rec.Code, rec.Body.String())
		}
		if track.path != "" {
			t.Errorf("%s dialled upstream at %q — a refused verb must cost nothing", m, track.path)
		}
	}
}

// ⚠ AN EMPTY ID IS REFUSED HERE, NOT UPSTREAM. `/api/track/issues//find-duplicates` would
// otherwise assemble a path with an empty segment and ask Track about the issue named "".
func TestTrackFindDuplicates_RefusesAnEmptyIssueID(t *testing.T) {
	track := newCaptureUpstream(t, `[]`)
	a, sess := productApp(t, track, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/track/issues//find-duplicates", nil)
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if rec.Code == http.StatusOK {
		t.Fatalf("an empty issue id answered 200 (%s)", rec.Body.String())
	}
	if track.path != "" {
		t.Fatalf("upstream was dialled with an empty id: %q", track.path)
	}
}
