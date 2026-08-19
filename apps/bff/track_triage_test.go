package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// ── TRACK'S TRIAGE SUGGESTION, THE FOURTH BROWSER CONTROL FOR A TRACK AI FEATURE ─────────────
//
// W1.7 lists five Track AI features (triage, find-duplicates, thread summary, sprint suggestion,
// semantic search). The summary (#225), the search (#230) and the duplicate finder (#231) reached
// a browser. This is triage — and it reaches one WITHOUT its write half.
//
// ⚠⚠ WHY THE QUEUE CALLED TRIAGE "NOT A FREE PICK", AND WHAT THIS ROUTE DOES ABOUT IT.
// talyvor-track's `ai.Handler.Triage` takes `?apply=true` and then OVERWRITES the issue's priority
// AND labels with the model's suggestion, discarding the write error (`_, _ = h.issues.Update(…)`).
// A button that silently rewrites two fields on someone's ticket is a product decision and not a
// session's. It is also not a reason to leave the READ unreachable: the suggestion itself changes
// nothing. So this route forwards the request with NO QUERY AT ALL — `apply` is not passed through,
// not defaulted, not accepted. The write is not "off by default" here; from a browser it is
// unreachable, and TestTrackTriage_TheApplyParameterNeverTravels is what says so.
//
// ⚠⚠ THE UPSTREAM'S ANSWERS ARE MEASURED, NOT READ. tab-7f6b drove talyvor-track's OWN
// `ai.Engine.TriageIssue` and `ai.Handler.Triage` at `655a0a0` over a recording fake Lens, in a
// /tmp `git archive` export (talyvor-track is held by another tab and was never written to). The
// engine needs no database, so these rows are the WIRE BYTES a caller receives, per model reply:
//
//	model reply                                   → the bytes Track answers with
//	{"suggested_priority":2,…,"confidence":0.8}   → {"suggested_priority":2,"suggested_labels":["bug"],"suggested_assignee":"","summary":"x","is_duplicate":false,"confidence":0.8}
//	the same reply WITHOUT suggested_priority     → {"suggested_priority":0,…}                    ⚠ identical to a suggested 0
//	{"suggested_priority":0,…}                    → {"suggested_priority":0,…}                    ⚠ identical to the row above
//	the same reply WITHOUT confidence             → {…,"confidence":0}                            ⚠ identical to a stated 0
//	{"suggested_priority":9,…}                    → {"suggested_priority":9,…}                    ⚠ outside Track's 0..4
//	{"suggested_priority":-1,…}                   → {"suggested_priority":-1,…}
//	{}                                            → {"suggested_priority":0,"suggested_labels":null,"suggested_assignee":"","summary":"","is_duplicate":false,"confidence":0}
//	`I cannot triage this.`                       → the engine errors; the handler answers 502 AI_ERROR
//	AI off (no mint credential)                   → 200 {"ai_available":false,"reason":"…TRACK_LENS_MINT_KEY…"}, 0 Lens calls
//
// FOUR of those shape this route and the screen it feeds:
//
//  1. THE REFUSAL IS AN OBJECT WITH A 200, exactly as find-duplicates and the summary are — so the
//     body travels VERBATIM and the discrimination is the screen's (areas/track/triage.ts).
//  2. `suggested_priority: 0` IS TWO DIFFERENT FACTS. Track's vocabulary calls 0 "None"; Go's zero
//     value fills the field when the model omits it; both marshal identically. Nothing downstream
//     can tell "the model suggested no priority" from "the model said nothing about priority", so
//     no screen may draw 0 as a suggestion. Same argument for `confidence`.
//  3. `suggested_assignee` AND `is_duplicate` RIDE ON EVERY RESPONSE AND THE PROMPT NEVER ASKS FOR
//     THEM. `triageSystemPrompt` requests exactly suggested_priority, suggested_labels, summary and
//     confidence; the other two are struct fields with no omitempty, so `"is_duplicate":false` is
//     present whether or not any model ever considered the question.
//  4. THE METER IS THE ISSUE. The request reaching Lens carries `X-Talyvor-Feature: <the issue's
//     identifier>` (measured: `ENG-42`) and `claude-haiku-4-6`, so the charge lands on that issue's
//     `ai_cost_usd` — the number the Details card renders.
//
// ⚠ AND ONE MEASUREMENT ABOUT THE UPSTREAM ITSELF, RECORDED WHERE IT WAS TAKEN RATHER THAN ACTED
// ON HERE: `Triage` checks `engine.IsAvailable()` BEFORE the workspace authorization, unlike
// `FindDuplicates` which checks the workspace first. Driven with no workspace in the context and a
// nil issue store, it still answered `200 {"ai_available":false,…}` — the availability of a
// deployment's AI, told to a caller whose workspace was never resolved. It is upstream's to fix and
// it is not reachable through this BFF, which refuses a session-less caller before dialling.
//
// These tests pin the ENVELOPE (path, method, workspace source, verbatim body, no parameters, and
// above all NO `apply`). What the screen may say about each body is pinned in areas/track/.

// TestTrackTriage_ForwardsToTheWorkspaceScopedUpstream is the route itself: the id from the URL,
// the workspace from the SESSION, and the path talyvor-track actually mounts (internal/ai/handler.go
// Mount → POST /v1/workspaces/{wsID}/issues/{id}/triage).
func TestTrackTriage_ForwardsToTheWorkspaceScopedUpstream(t *testing.T) {
	track := newCaptureUpstream(t, `{"suggested_priority":2,"suggested_labels":["bug"],"summary":"x","confidence":0.8}`)
	a, sess := productApp(t, track, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/track/issues/iss-9/triage", nil)
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("got %d (%s), want 200", rec.Code, rec.Body.String())
	}
	if want := "/v1/workspaces/track-ws-7/issues/iss-9/triage"; track.path != want {
		t.Fatalf("upstream path = %q, want %q", track.path, want)
	}
	if track.method != http.MethodPost {
		t.Fatalf("upstream method = %q, want POST — Track mounts this as a POST", track.method)
	}
	if got := track.headers.Get("X-Gateway-Auth"); got != testTrackSecret {
		t.Fatalf("X-Gateway-Auth = %q — the transit proof must be attached server-side", got)
	}
}

// ⚠⚠ THE ONE THAT MATTERS. `?apply=true` is what turns this read into a write of two fields on the
// caller's ticket, with the upstream's write error discarded. This route forwards NO query, so the
// browser cannot ask for it — not by sending it, not by any spelling of it, and not by a header.
//
// It is asserted as "the upstream query is EMPTY" rather than "apply is not true", because a route
// that forwarded `apply=false` would still be a route that forwards the parameter: the day upstream
// reads it differently (`apply=1`, or "present means yes"), a filtered-value rule silently starts
// applying and a filtered-parameter rule does not.
func TestTrackTriage_TheApplyParameterNeverTravels(t *testing.T) {
	for _, q := range []string{
		"?apply=true",
		"?apply=TRUE",
		"?apply=1",
		"?apply",
		"?apply=true&apply=false",
		"?workspace_id=someone-else&apply=true",
	} {
		track := newCaptureUpstream(t, `{"suggested_priority":2,"summary":"x"}`)
		a, sess := productApp(t, track, nil)

		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/track/issues/iss-9/triage"+q, nil)
		req.Header.Set("X-Apply", "true")
		req.AddCookie(sess)
		a.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("%s → %d (%s), want 200", q, rec.Code, rec.Body.String())
		}
		if track.rawQuery != "" {
			t.Fatalf("%s reached the upstream as query %q — this route must forward NO query at all; "+
				"`apply=true` makes talyvor-track overwrite the issue's priority AND labels with the "+
				"model's suggestion and discard the write error", q, track.rawQuery)
		}
		if want := "/v1/workspaces/track-ws-7/issues/iss-9/triage"; track.path != want {
			t.Fatalf("%s → upstream path %q, want %q", q, track.path, want)
		}
	}
}

// ⚠ THE ANSWER TRAVELS VERBATIM, AND THAT IS LOAD-BEARING. Track discriminates by SHAPE, not by
// status: the suggestion is an OBJECT and "AI is off" is a DIFFERENT object, both 200. Re-encoding
// here — or mapping the refusal onto an error status — would destroy the only information the
// screen has to tell a suggestion from a deployment where AI has never run.
func TestTrackTriage_TheAIOffBodyArrivesUnchanged(t *testing.T) {
	const upstream = `{"ai_available":false,"reason":"AI is not configured: set TRACK_LENS_MINT_KEY to the value of Lens's LENS_MINT_KEY."}`
	track := newCaptureUpstream(t, upstream)
	a, sess := productApp(t, track, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/track/issues/iss-9/triage", nil)
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("got %d, want 200 — Track answers 'AI is off' with a 200 and a flag", rec.Code)
	}
	if got := strings.TrimSpace(rec.Body.String()); got != upstream {
		t.Fatalf("body = %q, want it byte-identical to the upstream's:\n  %q", got, upstream)
	}
}

// ⚠ THE WORKSPACE IS NOT NAMEABLE BY THE BROWSER — trackWorkspacePath's whole reason — and no body
// travels either: `Triage` decodes none, so a forwarded body would be sent upstream to be ignored
// and would read back as honoured.
func TestTrackTriage_TheRequestCannotChooseAWorkspaceOrSendAnything(t *testing.T) {
	track := newCaptureUpstream(t, `{"suggested_priority":2,"summary":"x"}`)
	a, sess := productApp(t, track, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost,
		"/api/track/issues/iss-9/triage?workspace_id=someone-else",
		strings.NewReader(`{"workspace_id":"someone-else","apply":true}`))
	req.Header.Set("X-Workspace-Id", "someone-else")
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if want := "/v1/workspaces/track-ws-7/issues/iss-9/triage"; track.path != want {
		t.Fatalf("upstream path = %q, want %q — the request steered the tenant", track.path, want)
	}
	if track.rawQuery != "" {
		t.Fatalf("upstream query = %q, want empty — this route takes no parameters", track.rawQuery)
	}
	if len(track.reqBody) != 0 {
		t.Fatalf("upstream body = %q, want empty — Track's Triage decodes no body, and a body that "+
			"names `apply` must not reach a handler that might one day read one",
			string(track.reqBody))
	}
}

// A stranger gets no suggestion and no upstream call — and no SPEND: on a deployment with AI
// configured, every press is a metered Lens completion billed to the workspace and attributed to
// this issue.
//
// ⚠ WHAT THIS GREEN DOES *NOT* MEAN, the same caveat the sibling routes carry: this path is three
// refusals deep (the wrapper, trackWorkspaceFor, forwardProduct's own sessionFrom) and each answers
// a byte-identical 401, so no black-box assertion can name which one produced it. What it proves is
// the OUTCOME a stranger gets.
func TestTrackTriage_RefusesAnonymously(t *testing.T) {
	track := newCaptureUpstream(t, `{"suggested_priority":2}`)
	a, _ := productApp(t, track, nil)

	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/track/issues/iss-9/triage?apply=true", nil))

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("got %d (%s), want 401", rec.Code, rec.Body.String())
	}
	if track.path != "" {
		t.Fatalf("upstream was called for a stranger: %q", track.path)
	}
}

// ⚠ THE VERB MATTERS BECAUSE THE CALL COSTS. POST is what Track mounts; anything else answers 405
// here rather than dialling upstream or falling through to another route's handler.
func TestTrackTriage_RefusesOtherMethods(t *testing.T) {
	for _, m := range []string{http.MethodGet, http.MethodPatch, http.MethodDelete, http.MethodPut} {
		track := newCaptureUpstream(t, `{"suggested_priority":2}`)
		a, sess := productApp(t, track, nil)

		rec := httptest.NewRecorder()
		req := httptest.NewRequest(m, "/api/track/issues/iss-9/triage", nil)
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

// ⚠⚠ A HOSTILE ID IS REFUSED HERE, NOT UPSTREAM — AND THE OBVIOUS WAY TO ASSERT THAT IS VACUOUS,
// WHICH WAS MEASURED RATHER THAN REASONED ABOUT. The first draft of this test drove
// `/api/track/issues//triage` and asserted "not 200, upstream not dialled". Control C14 of
// `~/talyvor-queue/w17-triage-controls-7f6b.py` deleted the `pathID` call from the handler
// ENTIRELY and the test STAYED GREEN: measured, that URL answers **307** — net/http's ServeMux
// cleans the empty path segment and redirects before any handler runs — so the assertion was
// satisfied by the router and would pass with every id check in the file removed.
//
// ⚠ THE SAME SHAPE WAS LIVE IN THE SIBLING — `/api/track/issues//find-duplicates` also redirects,
// measured in the same probe — and it is repaired in its own merge as
// `TestTrackFindDuplicates_RefusesAHostileIssueID`, controlled the same way. That is the reason this
// file asserts the redirect as a REDIRECT and puts the guard's real subject beside it.
//
// The ids below DO reach the handler (percent-encoding survives the mux's cleaning), so each one
// exercises `pathID` itself: `..` is path traversal, `a/b` would forge an extra path segment
// upstream, and a raw tab is a control character in a URL this BFF assembles.
func TestTrackTriage_RefusesAHostileIssueID(t *testing.T) {
	for _, id := range []string{"%2E%2E", "a%2Fb", "%09"} {
		track := newCaptureUpstream(t, `{"suggested_priority":2}`)
		a, sess := productApp(t, track, nil)

		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/track/issues/"+id+"/triage", nil)
		req.AddCookie(sess)
		a.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("id %q → %d (%s), want 400 from pathID", id, rec.Code, rec.Body.String())
		}
		if track.path != "" {
			t.Errorf("id %q reached the upstream as %q", id, track.path)
		}
	}
}

// The empty segment, asserted as what it actually is: the mux redirects, so this route never sees
// it. Stated rather than dressed up as an id refusal — a green whose cause is misattributed is how
// the vacuous version above survived.
//
// ⚠⚠ THE EXACT STATUS IS NOT PINNED, AND THE REASON IS A MEASUREMENT THAT COST A RED CI RUN. My
// first version asserted 307, which is what it answers under go1.26.3 — the toolchain on the
// machine this was written on. CI resolves `go 1.25.0` from go.mod and answered **301**. The
// property this test exists for is "the router disposes of the empty segment and no handler runs";
// WHICH redirect net/http chooses is a Go-version detail, and pinning it made a green here and a
// red there for a product that had not changed.
//
// ⚠ IT IS NOT A COSMETIC DIFFERENCE EITHER, WHICH IS WHY THE CODE IS REPORTED IN THE FAILURE
// MESSAGE RATHER THAN IGNORED: 301 lets a client rewrite a POST into a GET when it follows the
// redirect, 307/308 do not. A browser following the 1.25 answer would re-issue this as a GET — to a
// route that answers 405 — rather than as the POST it started as.
//
// ⚠ AND THE GENERAL FACT UNDER IT: this repo's local toolchain (go1.26.3) is a major release ahead
// of the one go.mod pins for CI (1.25.0), so a local `go test` green is not the run CI performs.
func TestTrackTriage_AnEmptyIDSegmentIsRedirectedBeforeThisRouteRuns(t *testing.T) {
	track := newCaptureUpstream(t, `{"suggested_priority":2}`)
	a, sess := productApp(t, track, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/track/issues//triage", nil)
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if rec.Code < 300 || rec.Code > 399 {
		t.Fatalf("got %d (%s), want a redirect — if this changed, the empty segment now REACHES a "+
			"handler and pathID is what must refuse it", rec.Code, rec.Body.String())
	}
	if loc := rec.Header().Get("Location"); loc == "" {
		t.Fatalf("a %d with no Location: this is not the router cleaning the path", rec.Code)
	}
	if track.path != "" {
		t.Fatalf("upstream was dialled for a path the router should have cleaned: %q", track.path)
	}
}
