package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// B17.40 — a deploy of the app no longer signs everyone out. Each test signs in on one BFF and
// then talks to a NEW one built from the same configuration: that is a restart, in-memory map gone.

// signedIn asks /auth/me whether sess is a signed-in session, and in which workspace.
func signedIn(t *testing.T, ts *httptest.Server, sess *http.Cookie) (bool, string) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/auth/me", nil)
	req.AddCookie(sess)
	resp, err := ts.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var me struct {
		Authenticated bool   `json:"authenticated"`
		WorkspaceID   string `json:"workspace_id"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&me)
	return me.Authenticated, me.WorkspaceID
}

// signOut ends sess the way POST /auth/logout does; the provider-less test authenticator answers
// the login machinery's routes 503.
func signOut(a *app, sess *http.Cookie) { a.auth.endSession(sess.Value) }

func TestASignedInBrowserStaysSignedInAcrossARestartAndChats(t *testing.T) {
	lens := newSyntheticLens(t)
	before := httptest.NewServer(syntheticApp(t, lens, testSyntheticKey))
	defer before.Close()
	resp, sess := syntheticSignIn(t, before, testSyntheticKey, testSyntheticWS, "jwt-synthetic", "")
	if resp.StatusCode != http.StatusOK || sess == nil {
		t.Fatalf("sign-in: status %d, session cookie %v", resp.StatusCode, sess)
	}

	a := syntheticApp(t, lens, testSyntheticKey) // the restart
	after := httptest.NewServer(a)
	defer after.Close()
	if ok, ws := signedIn(t, after, sess); !ok || ws != testSyntheticWS {
		t.Fatalf("after a restart /auth/me says authenticated=%t workspace=%q; want signed in to %s", ok, ws, testSyntheticWS)
	}
	stream, br, done := openStream(t, a, sess, "/api/ai/stream/anthropic/v1/messages", `{"stream":true}`)
	answer, _ := io.ReadAll(br)
	done()
	if stream.StatusCode != http.StatusOK || !strings.Contains(string(answer), "2+2 is 4") {
		t.Fatalf("chat after a restart: status %d, body %q", stream.StatusCode, answer)
	}
	if lens.gotMintAuth != "Bearer jwt-synthetic" {
		t.Fatalf("the chat credential was minted with %q; want the session's own workspace token", lens.gotMintAuth)
	}
}

func TestASignedOutSessionStaysSignedOut(t *testing.T) {
	lens := newSyntheticLens(t)

	// Signed out, then the same cookie again, in the same process.
	first := syntheticApp(t, lens, testSyntheticKey)
	ts := httptest.NewServer(first)
	defer ts.Close()
	_, sess := syntheticSignIn(t, ts, testSyntheticKey, testSyntheticWS, "jwt-synthetic", "")
	signOut(first, sess)
	if ok, _ := signedIn(t, ts, sess); ok {
		t.Fatal("a session signed out in this process came back from its cookie")
	}

	// Restored after a restart, signed out there, then the same cookie again.
	_, sess = syntheticSignIn(t, ts, testSyntheticKey, testSyntheticWS, "jwt-synthetic", "")
	restarted := syntheticApp(t, lens, testSyntheticKey)
	after := httptest.NewServer(restarted)
	defer after.Close()
	if ok, _ := signedIn(t, after, sess); !ok {
		t.Fatal("not restored after the restart")
	}
	signOut(restarted, sess)
	if ok, _ := signedIn(t, after, sess); ok {
		t.Fatal("a restored session signed out after the restart came back from its cookie")
	}

	// A BFF with another secret cannot open the seal at all.
	_, sess = syntheticSignIn(t, ts, testSyntheticKey, testSyntheticWS, "jwt-synthetic", "")
	other := syntheticApp(t, lens, testSyntheticKey)
	other.auth.sealer = newSessionSealer("another-secret", 0)
	ots := httptest.NewServer(other)
	defer ots.Close()
	if ok, _ := signedIn(t, ots, sess); ok {
		t.Fatal("a BFF with a different LENS_PROVISION_SECRET restored the session")
	}
}
