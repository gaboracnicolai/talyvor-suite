package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestMemberAddForwardsToTheSessionsWorkspaceAndRelaysLensRefusal — B32.72. An add from the Members
// screen reaches Track's POST /v1/workspaces/{ws}/members on the SESSION's Track workspace, with the
// body as sent, the session's identity and the session's Lens workspace in X-Lens-Workspace (never
// the browser's). Track's 402 — Lens's refusal — comes back with the same status and the same bytes.
func TestMemberAddForwardsToTheSessionsWorkspaceAndRelaysLensRefusal(t *testing.T) {
	const refusal = `{"error":"LENS_PLAN_GATES: the free plan allows 1 member; team allows 5","code":"PLAN_SEATS","plan":"free","limit":1,"allows":"team"}`
	track := newStatusUpstream(t, http.StatusPaymentRequired, refusal)
	a, sess := productApp(t, track, nil)
	a.cfg.publicBaseURL = "https://app.talyvor.com"

	const body = `{"email":"bo@corp.example","role":"member"}`
	req := httptest.NewRequest(http.MethodPost, "/api/members?workspace_id=SOMEBODY-ELSE", strings.NewReader(body))
	req.Header.Set("Origin", "https://app.talyvor.com")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Lens-Workspace", "ws-the-browser-chose")
	req.AddCookie(sess)
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)

	if track.method != http.MethodPost || track.path != "/v1/workspaces/track-ws-7/members" {
		t.Fatalf("upstream got %s %s — must be POST on the session's Track workspace", track.method, track.path)
	}
	if string(track.reqBody) != body {
		t.Fatalf("upstream body = %q, want %q", track.reqBody, body)
	}
	if got := track.headers.Get("X-Lens-Workspace"); got != "u-test-workspace" {
		t.Fatalf("X-Lens-Workspace = %q, want the session's Lens workspace", got)
	}
	if track.headers.Get("X-Gateway-Auth") != testTrackSecret || track.headers.Get("X-User-Email") != "ng@example.com" {
		t.Fatal("transit proof or session identity missing")
	}
	if rec.Code != http.StatusPaymentRequired {
		t.Fatalf("status = %d, want Track's 402", rec.Code)
	}
	if rec.Body.String() != refusal {
		t.Fatalf("body = %q, want Track's bytes unchanged", rec.Body.String())
	}
}

// TestMemberAddRelaysTheNewMember: a 201 from Track is the browser's 201, with the member it made.
func TestMemberAddRelaysTheNewMember(t *testing.T) {
	const member = `{"id":"mem-2","workspace_id":"track-ws-7","email":"bo@corp.example","name":"","role":"member"}`
	track := newStatusUpstream(t, http.StatusCreated, member)
	a, sess := productApp(t, track, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/members", strings.NewReader(`{"email":"bo@corp.example","role":"member"}`))
	req.AddCookie(sess)
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated || rec.Body.String() != member {
		t.Fatalf("got %d %q, want Track's 201 and member", rec.Code, rec.Body.String())
	}
}
