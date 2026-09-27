package main

import (
	"net/http"
	"testing"
)

// B18.53 — deleting, listing and restoring a Track workspace (track_workspaces.go), against the
// products_test.go harness: each reaches the workspace the caller named, with the confirmation body
// untouched, and Track's refusal comes back as Track said it.
func TestTrackWorkspaces_DeleteListRestoreReachTheNamedWorkspace(t *testing.T) {
	track := newStatusUpstream(t, http.StatusOK, `{"id":"ws-2"}`)
	a, sess := productApp(t, track, nil)

	rec := cycleReq(t, a, sess, http.MethodDelete, "/api/track/workspaces/ws-2", `{"confirm":"acme"}`)
	if rec.Code != http.StatusOK || track.method != http.MethodDelete || track.path != "/v1/workspaces/ws-2" ||
		string(track.reqBody) != `{"confirm":"acme"}` {
		t.Fatalf("delete: %d, upstream got %s %s %s", rec.Code, track.method, track.path, track.reqBody)
	}
	if track.headers.Get("X-User-Email") == "" {
		t.Fatal("delete: the session identity was not attached, so Track could not check the owner")
	}

	rec = cycleReq(t, a, sess, http.MethodGet, "/api/track/workspaces/deleted", "")
	if rec.Code != http.StatusOK || track.path != "/v1/workspaces" || track.rawQuery != "deleted=true" {
		t.Fatalf("deleted list: %d, upstream got %s ?%s", rec.Code, track.path, track.rawQuery)
	}

	rec = cycleReq(t, a, sess, http.MethodPost, "/api/track/workspaces/ws-2/restore", "")
	if rec.Code != http.StatusOK || track.method != http.MethodPost || track.path != "/v1/workspaces/ws-2/restore" {
		t.Fatalf("restore: %d, upstream got %s %s", rec.Code, track.method, track.path)
	}

	refused := newStatusUpstream(t, http.StatusBadRequest, `{"error":"to confirm, send the slug","code":"CONFIRMATION_REQUIRED"}`)
	a, sess = productApp(t, refused, nil)
	rec = cycleReq(t, a, sess, http.MethodDelete, "/api/track/workspaces/ws-2", `{"confirm":"wrong"}`)
	if rec.Code != http.StatusBadRequest || rec.Body.String() == "" {
		t.Fatalf("an unconfirmed delete = %d %s, want Track's 400 passed through", rec.Code, rec.Body.String())
	}
}
