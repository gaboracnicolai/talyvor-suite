package main

// THE FIRST-VISIT WINDOW ON DOCS, asserted at the BFF.
//
// Docs no longer deadlocks — it enumerates workspaces from Track rather than from the workspaces
// it already holds content for (talyvor-track bf60842, talyvor-docs c970329), so a brand-new
// identity's workspace is visible to Docs the moment Track mints it. What was left is a TIMING
// window, not a deadlock: Docs learns the ROSTER on a periodic sweep, so between signing up and
// the next sweep a person has a workspace Docs can see and a membership Docs has not read yet,
// and every write 403s. Shortening the sweep narrows the window; it does not close it, because
// "narrower" is still "sometimes".
//
// So the BFF NUDGES: at login, right after Track mints the workspace, it asks Docs to reconcile
// that one workspace now. The sweep stays as the backstop — the nudge is an optimisation of WHEN,
// never the only path, which is what keeps a missed nudge a delay rather than a permanent 403.
//
// ⚠ THE TWO RULES ARE TRACK'S, FOR TRACK'S REASON, and they bind harder here: this is a
// convenience on a product that already works eventually.
//
//  1. A DOCS FAILURE MUST NOT FAIL LOGIN. Losing Lens, billing, keys and Track because Docs was
//     briefly unreachable, in exchange for a window the sweep closes by itself within minutes,
//     is a plainly bad trade.
//  2. IT MUST NOT BE CACHED IN THE SESSION. There is deliberately nothing session-shaped to
//     cache: the nudge returns no value the BFF keeps. A session that recorded "nudged" would
//     freeze one failed attempt for twelve hours; a session that recorded "not nudged" would be
//     a retry the sweep already performs. The absence of a field is the mechanism.

import (
	"context"
	"go/ast"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

// docsSyncUpstream fakes Docs' service route, recording METHOD + PATH + the transit proof. The
// proof is recorded because an unauthenticated nudge is not a weaker nudge — Docs 401s it, and
// the window stays open while the logs say the BFF called.
type docsSyncUpstream struct {
	srv  *httptest.Server
	mu   sync.Mutex
	hits []struct{ method, path, auth string }
	code int // 0 ⇒ 200
}

func newDocsSyncUpstream(t *testing.T) *docsSyncUpstream {
	t.Helper()
	u := &docsSyncUpstream{}
	u.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u.mu.Lock()
		u.hits = append(u.hits, struct{ method, path, auth string }{
			r.Method, r.URL.Path, r.Header.Get("X-Gateway-Auth")})
		code := u.code
		u.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if code != 0 {
			w.WriteHeader(code)
			_, _ = io.WriteString(w, `{"error":"docs is having a moment"}`)
			return
		}
		_, _ = io.WriteString(w, `{"workspace_id":"ws-alice","synced":true}`)
	}))
	t.Cleanup(u.srv.Close)
	return u
}

func (u *docsSyncUpstream) seen() []struct{ method, path, auth string } {
	u.mu.Lock()
	defer u.mu.Unlock()
	return append([]struct{ method, path, auth string }(nil), u.hits...)
}

// ⚠ THE CLAIM: the nudge reaches Docs' service route for THAT workspace, as a POST, carrying the
// transit proof. Asserted on what the BFF sends, never on what a screen renders — a nudge aimed
// at the wrong workspace, or sent without the proof, looks identical from the outside.
func TestDocsNudge_ReachesDocsServiceRouteForThatWorkspace(t *testing.T) {
	up := newDocsSyncUpstream(t)
	a := &app{cfg: config{docsBaseURL: up.srv.URL, docsGatewaySecret: "gwsecret_docs"}, client: http.DefaultClient}

	if err := a.nudgeDocsMemberSync(context.Background(), "ws-alice"); err != nil {
		t.Fatalf("nudge returned %v", err)
	}
	hits := up.seen()
	if len(hits) != 1 {
		t.Fatalf("expected exactly one nudge, got %d: %v", len(hits), hits)
	}
	if hits[0].method != http.MethodPost {
		t.Errorf("method = %s, want POST — Docs' route is a POST and a GET is a silent no-op", hits[0].method)
	}
	if want := "/v1/service/workspaces/ws-alice/member-sync"; hits[0].path != want {
		t.Errorf("path = %s, want %s", hits[0].path, want)
	}
	if hits[0].auth != "gwsecret_docs" {
		t.Errorf("X-Gateway-Auth = %q — without the transit proof Docs 401s and the window stays "+
			"open while the logs say we called", hits[0].auth)
	}
}

// The nudge NAMES a workspace, unlike Track's bootstrap which derives one from identity headers.
// It must therefore never be reachable with an empty one: "" would address
// /v1/service/workspaces//member-sync, which is a different route shape entirely.
func TestDocsNudge_DoesNothingWithoutAWorkspace(t *testing.T) {
	up := newDocsSyncUpstream(t)
	a := &app{cfg: config{docsBaseURL: up.srv.URL, docsGatewaySecret: "gwsecret_docs"}, client: http.DefaultClient}

	if err := a.nudgeDocsMemberSync(context.Background(), ""); err == nil {
		t.Error("an empty workspace was accepted; it must not be sent upstream at all")
	}
	if hits := up.seen(); len(hits) != 0 {
		t.Errorf("an empty workspace still reached Docs: %v", hits)
	}
}

// A deployment without Docs is not a broken deployment. Nothing is sent and nothing is logged as
// a fault — the same distinction errTrackNotConfigured draws for Track.
func TestDocsNudge_UnconfiguredIsNotAFailure(t *testing.T) {
	a := &app{cfg: config{}, client: http.DefaultClient}
	if err := a.nudgeDocsMemberSync(context.Background(), "ws-alice"); err != errDocsNotConfigured {
		t.Errorf("got %v, want errDocsNotConfigured — an absent product is not a fault", err)
	}
}

// A Docs failure is reported to the CALLER as an error and left there. What must not happen is
// upstairs, and TestDocsNudge_FailureDoesNotAbortLogin asserts that.
func TestDocsNudge_ReportsUpstreamFailure(t *testing.T) {
	up := newDocsSyncUpstream(t)
	up.code = http.StatusInternalServerError
	a := &app{cfg: config{docsBaseURL: up.srv.URL, docsGatewaySecret: "gwsecret_docs"}, client: http.DefaultClient}

	if err := a.nudgeDocsMemberSync(context.Background(), "ws-alice"); err == nil {
		t.Error("a 500 from Docs was reported as success")
	}
}

/* ── Rule 1: a Docs failure must not fail login ──────────────────────────── */

// RULE 1, asserted on handleCallback's SHAPE for the same reason the Track version is: the claim
// is "this code path cannot return here", and a behavioural test can only sample the failures it
// thought to fake. Structural for the structural claim, behavioural for the behavioural one.
func TestDocsNudge_FailureDoesNotAbortLogin(t *testing.T) {
	checked := false
	for name, file := range bffSourceFiles(t) {
		ast.Inspect(file, func(n ast.Node) bool {
			fn, ok := n.(*ast.FuncDecl)
			if !ok || fn.Body == nil || fn.Name.Name != "handleCallback" ||
				!callsFunc(fn, "nudgeDocsMemberSync") {
				return true
			}
			checked = true
			ast.Inspect(fn.Body, func(m ast.Node) bool {
				ifs, ok := m.(*ast.IfStmt)
				if !ok || !mentions(ifs.Cond, "derr") {
					return true
				}
				ast.Inspect(ifs.Body, func(k ast.Node) bool {
					if _, isRet := k.(*ast.ReturnStmt); isRet {
						t.Errorf("%s: handleCallback RETURNS when the Docs nudge fails — a Docs blip "+
							"would take out the whole login, in exchange for a window Docs' own sweep "+
							"closes within minutes. Log it and continue.", name)
					}
					if call, isCall := k.(*ast.CallExpr); isCall {
						if id, ok := call.Fun.(*ast.Ident); ok && id.Name == "writeJSON" {
							t.Errorf("%s: handleCallback writes an error response when the Docs nudge "+
								"fails — login must complete regardless", name)
						}
					}
					return true
				})
				return true
			})
			return true
		})
	}
	if !checked {
		t.Fatal("handleCallback no longer calls nudgeDocsMemberSync — either the nudge was removed " +
			"(first-visit Docs writes 403 until the next sweep) or this guard has drifted")
	}
}

/* ── Rule 2: nothing about it is cached in the session ───────────────────── */

// RULE 2 is enforced by ABSENCE, so it is asserted as absence: no session field records whether
// the nudge happened. A "nudged" flag would freeze one failed attempt for the session's twelve
// hours; the sweep is the backstop and it does not consult sessions.
func TestDocsNudge_IsNotRecordedInTheSession(t *testing.T) {
	for _, field := range []string{"docsNudged", "docsSynced", "docsMemberSynced", "docsWorkspaceID"} {
		if sessionHasField(t, field) {
			t.Errorf("session.%s exists: caching the nudge freezes one attempt for twelve hours, "+
				"and the periodic sweep — the actual backstop — never reads sessions", field)
		}
	}
}

// sessionHasField reads the SOURCE for the session struct's fields, the same way configHasField
// does for config: the claim is about the shape that makes caching representable.
func sessionHasField(t *testing.T, field string) bool {
	t.Helper()
	found := false
	for _, file := range bffSourceFiles(t) {
		ast.Inspect(file, func(n ast.Node) bool {
			ts, ok := n.(*ast.TypeSpec)
			if !ok || ts.Name.Name != "session" {
				return true
			}
			st, ok := ts.Type.(*ast.StructType)
			if !ok {
				return true
			}
			for _, f := range st.Fields.List {
				for _, id := range f.Names {
					if id.Name == field {
						found = true
					}
				}
			}
			return true
		})
	}
	return found
}
