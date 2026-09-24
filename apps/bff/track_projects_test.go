package main

import (
	"encoding/json"
	"net/http"
	"testing"
)

// B4.2 — the suite's project routes (track_projects.go), against the products_test.go harness.

// A create reaches the SESSION's workspace carrying the four chosen fields and nothing else.
func TestTrackProjects_CreateSendsOnlyTheChosenFields(t *testing.T) {
	track := newStatusUpstream(t, http.StatusCreated, `{"id":"pr-1"}`)
	a, sess := productApp(t, track, nil)
	rec := cycleReq(t, a, sess, http.MethodPost, "/api/track/projects",
		`{"team_id":"team-1","name":" Billing v2 ","identifier":"BIL","description":"","status":"completed","priority":1,"workspace_id":"other"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	if track.method != http.MethodPost || track.path != "/v1/workspaces/track-ws-7/projects" {
		t.Fatalf("upstream got %s %s", track.method, track.path)
	}
	var sent map[string]any
	if err := json.Unmarshal(track.reqBody, &sent); err != nil {
		t.Fatalf("body is not JSON: %v", err)
	}
	if len(sent) != 4 || sent["team_id"] != "team-1" || sent["name"] != "Billing v2" || sent["identifier"] != "BIL" || sent["description"] != "" {
		t.Errorf("upstream body = %v, want exactly team_id, name, identifier, description", sent)
	}
}

// Track requires a team, a name and an identifier; a create missing one is refused here.
func TestTrackProjects_CreateRefusesAnIncompleteProject(t *testing.T) {
	for _, body := range []string{
		`{"name":"n","identifier":"N"}`,
		`{"team_id":"t","identifier":"N"}`,
		`{"team_id":"t","name":"n","identifier":"  "}`,
	} {
		track := newCaptureUpstream(t, `{}`)
		a, sess := productApp(t, track, nil)
		if rec := cycleReq(t, a, sess, http.MethodPost, "/api/track/projects", body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400", body, rec.Code)
		}
		if track.path != "" {
			t.Errorf("%s: reached upstream at %s", body, track.path)
		}
	}
}
