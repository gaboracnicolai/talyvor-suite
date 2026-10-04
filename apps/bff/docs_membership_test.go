package main

import (
	"encoding/json"
	"net/http"
	"testing"
)

// B27.15 — /api/docs/membership answers 200 either way, so the sidebar can ask before it reads pins
// and a person Docs has not been told about yet logs no failed request.
func TestDocsMembership_AnswersMemberOrNotWithoutFailing(t *testing.T) {
	member := func(t *testing.T, code int, body []byte) bool {
		t.Helper()
		if code != http.StatusOK {
			t.Fatalf("status = %d, want 200 — the point of this route is that asking never fails", code)
		}
		var got struct {
			Member *bool `json:"member"`
		}
		if err := json.Unmarshal(body, &got); err != nil || got.Member == nil {
			t.Fatalf("body %s: want {\"member\": bool} (%v)", body, err)
		}
		return *got.Member
	}

	t.Run("Docs lists the pins: a member", func(t *testing.T) {
		docs := newStatusUpstream(t, http.StatusOK, `[]`)
		a, sess := productApp(t, nil, docs)
		rec := cycleReq(t, a, sess, http.MethodGet, "/api/docs/membership", "")
		if !member(t, rec.Code, rec.Body.Bytes()) {
			t.Fatal("member = false on a 200 from Docs")
		}
		if docs.path != "/v1/workspaces/track-ws-7/pins" || docs.headers.Get("X-User-Email") == "" {
			t.Fatalf("probe went to %s with email %q — want the session's workspace and identity",
				docs.path, docs.headers.Get("X-User-Email"))
		}
	})

	t.Run("Docs refuses: not a member yet, and the roster sync is nudged again", func(t *testing.T) {
		docs := newStatusUpstream(t, http.StatusForbidden, `{"error":"not a member of this workspace"}`)
		a, sess := productApp(t, nil, docs)
		rec := cycleReq(t, a, sess, http.MethodGet, "/api/docs/membership", "")
		if member(t, rec.Code, rec.Body.Bytes()) {
			t.Fatal("member = true on a 403 from Docs")
		}
		if docs.method != http.MethodPost || docs.path != docsMemberSyncPath("track-ws-7") {
			t.Fatalf("last upstream call = %s %s, want the member-sync nudge for track-ws-7", docs.method, docs.path)
		}
	})

	t.Run("no Docs upstream: nobody is a member, and that is not a fault", func(t *testing.T) {
		a, sess := productApp(t, nil, nil)
		rec := cycleReq(t, a, sess, http.MethodGet, "/api/docs/membership", "")
		if member(t, rec.Code, rec.Body.Bytes()) {
			t.Fatal("member = true with no Docs upstream")
		}
	})

	t.Run("Docs failing is still an error", func(t *testing.T) {
		docs := newStatusUpstream(t, http.StatusInternalServerError, `{}`)
		a, sess := productApp(t, nil, docs)
		if rec := cycleReq(t, a, sess, http.MethodGet, "/api/docs/membership", ""); rec.Code != http.StatusBadGateway {
			t.Fatalf("status = %d on a Docs 500, want 502 — an outage is not \"not a member\"", rec.Code)
		}
	})
}
