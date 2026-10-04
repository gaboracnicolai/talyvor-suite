package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// B27.30 — public issue boards (track_boards.go), against the products_test.go harness.

// A stranger with a board link reads the board: the BFF relays Track's answer with no session,
// and calls Track carrying nothing of its own — no gateway secret, no identity.
func TestPublicBoard_SignedOutReadReachesTrackUncredentialed(t *testing.T) {
	const board = `{"workspace":"Acme","issues":[{"identifier":"ENG-1","title":"Ship it","status":"todo","priority":2}]}`
	track := newCaptureUpstream(t, board)
	a, _ := productApp(t, track, nil)

	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/public/boards/abcdefghijklmnop_-12", nil))
	if rec.Code != http.StatusOK || rec.Body.String() != board {
		t.Fatalf("signed-out board read = %d %s", rec.Code, rec.Body.String())
	}
	if track.method != http.MethodGet || track.path != "/v1/public/issue-boards/abcdefghijklmnop_-12" {
		t.Fatalf("upstream got %s %s", track.method, track.path)
	}
	for _, h := range []string{"X-Gateway-Auth", "X-User-Email", "X-User-Id", "Cookie"} {
		if v := track.headers.Get(h); v != "" {
			t.Errorf("a stranger's board read reached Track carrying %s=%q", h, v)
		}
	}

	// A malformed token is answered here, without a dial.
	fresh := newCaptureUpstream(t, `{}`)
	a2, _ := productApp(t, fresh, nil)
	rec = httptest.NewRecorder()
	a2.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/public/boards/short", nil))
	if rec.Code != http.StatusNotFound || fresh.path != "" {
		t.Fatalf("malformed token = %d, upstream reached at %q", rec.Code, fresh.path)
	}
}

// Turning a link on goes to the SESSION's workspace with the one chosen field.
func TestTrackBoards_CreateGoesToTheSessionWorkspace(t *testing.T) {
	track := newStatusUpstream(t, http.StatusCreated, `{"id":"sh-1","token":"t"}`)
	a, sess := productApp(t, track, nil)
	rec := cycleReq(t, a, sess, http.MethodPost, "/api/track/boards", `{"project_id":" pr-1 ","workspace_id":"other"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	if track.method != http.MethodPost || track.path != "/v1/workspaces/track-ws-7/issue-boards" {
		t.Fatalf("upstream got %s %s", track.method, track.path)
	}
	if got := string(track.reqBody); got != `{"project_id":"pr-1"}` {
		t.Errorf("upstream body = %s, want exactly the project id", got)
	}
}
