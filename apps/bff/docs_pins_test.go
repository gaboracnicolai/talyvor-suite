package main

import (
	"net/http"
	"testing"
)

// B18.27 — the pin routes (docs_pins.go) reach talyvor-docs' internal/pin for the SESSION's
// workspace and identity, with no body, and Docs' answer comes back as it was.
func TestDocsPins_ListAndPinReachDocs(t *testing.T) {
	docs := newStatusUpstream(t, http.StatusOK, `[{"page_id":"p1","space_id":"s1","title":"Runbook","at":"2026-09-27T00:00:00Z"}]`)
	a, sess := productApp(t, nil, docs)

	rec := cycleReq(t, a, sess, http.MethodGet, "/api/docs/pins", "")
	if rec.Code != http.StatusOK || docs.method != http.MethodGet || docs.path != "/v1/workspaces/track-ws-7/pins" {
		t.Fatalf("list: %d, upstream got %s %s", rec.Code, docs.method, docs.path)
	}
	if docs.headers.Get("X-User-Email") == "" {
		t.Fatal("list: the session identity was not attached, so Docs could not tell whose pins")
	}
	for _, m := range []string{http.MethodPut, http.MethodDelete} {
		rec = cycleReq(t, a, sess, m, "/api/docs/spaces/s1/pages/p1/pin", "")
		if rec.Code != http.StatusOK || docs.method != m || docs.path != "/v1/spaces/s1/pages/p1/pin" {
			t.Fatalf("%s pin: %d, upstream got %s %s", m, rec.Code, docs.method, docs.path)
		}
	}
}
