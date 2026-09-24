package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// B4.1 — the suite's cycle routes (track_cycles.go), against the products_test.go harness.

func cycleReq(t *testing.T, a *app, sess *http.Cookie, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(sess)
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	return rec
}

// A create reaches the team's cycles in the SESSION's workspace carrying the three chosen fields
// and nothing else, whatever else the browser sent.
func TestTrackCycles_CreateSendsOnlyNameAndDates(t *testing.T) {
	track := newStatusUpstream(t, http.StatusCreated, `{"id":"cy-1","number":1}`)
	a, sess := productApp(t, track, nil)
	rec := cycleReq(t, a, sess, http.MethodPost, "/api/track/teams/team-1/cycles",
		`{"name":" Sprint 12 ","start_date":"2026-10-01T00:00:00Z","end_date":"2026-10-15T00:00:00Z","status":"completed","number":99,"workspace_id":"other"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	if track.method != http.MethodPost || track.path != "/v1/workspaces/track-ws-7/teams/team-1/cycles" {
		t.Fatalf("upstream got %s %s", track.method, track.path)
	}
	var sent map[string]any
	if err := json.Unmarshal(track.reqBody, &sent); err != nil {
		t.Fatalf("body is not JSON: %v", err)
	}
	want := map[string]any{"name": "Sprint 12", "start_date": "2026-10-01T00:00:00Z", "end_date": "2026-10-15T00:00:00Z"}
	if len(sent) != len(want) || sent["name"] != want["name"] || sent["start_date"] != want["start_date"] || sent["end_date"] != want["end_date"] {
		t.Errorf("upstream body = %v, want exactly %v", sent, want)
	}
}

// A cycle with no name, unparseable dates, or an end on or before its start is refused here.
func TestTrackCycles_CreateRefusesAnImpossibleCycle(t *testing.T) {
	for _, body := range []string{
		`{"name":"","start_date":"2026-10-01T00:00:00Z","end_date":"2026-10-15T00:00:00Z"}`,
		`{"name":"x","start_date":"2026-10-01","end_date":"2026-10-15"}`,
		`{"name":"x","start_date":"2026-10-15T00:00:00Z","end_date":"2026-10-01T00:00:00Z"}`,
	} {
		track := newCaptureUpstream(t, `{}`)
		a, sess := productApp(t, track, nil)
		if rec := cycleReq(t, a, sess, http.MethodPost, "/api/track/teams/team-1/cycles", body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400", body, rec.Code)
		}
		if track.path != "" {
			t.Errorf("%s: reached upstream at %s", body, track.path)
		}
	}
}

// The list and a cycle's progress are reads of the same team, in the session's workspace.
func TestTrackCycles_ListAndProgressReadTheTeam(t *testing.T) {
	track := newCaptureUpstream(t, `[]`)
	a, sess := productApp(t, track, nil)
	if rec := cycleReq(t, a, sess, http.MethodGet, "/api/track/teams/team-1/cycles", ""); rec.Code != http.StatusOK {
		t.Fatalf("list status = %d", rec.Code)
	}
	if track.method != http.MethodGet || track.path != "/v1/workspaces/track-ws-7/teams/team-1/cycles" {
		t.Errorf("list reached %s %s", track.method, track.path)
	}
	if rec := cycleReq(t, a, sess, http.MethodGet, "/api/track/teams/team-1/cycles/cy-1/progress", ""); rec.Code != http.StatusOK {
		t.Fatalf("progress status = %d", rec.Code)
	}
	if track.path != "/v1/workspaces/track-ws-7/teams/team-1/cycles/cy-1/progress" {
		t.Errorf("progress reached %s", track.path)
	}
}
