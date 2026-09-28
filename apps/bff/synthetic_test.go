package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// B17.2 — a synthetic user signs in with the operator key and chats through the real app; a real
// account, a request without the key, and a BFF without the key are all refused.

const (
	testSyntheticKey = "synthetic-operator-key-for-tests"
	testSyntheticWS  = "sabcdefghijklmnopqrstuvwxyz"
	testRealWS       = "u7realworkspaceabcdefghijkl"
)

// syntheticLens fakes the four Lens routes a synthetic user's session touches, and counts
// provisioning, which a synthetic session must never reach.
type syntheticLens struct {
	srv *httptest.Server

	mu             sync.Mutex
	provisionCalls int
	gotMintAuth    string
	gotProxyAuth   string
	gotReadAuth    string
}

func newSyntheticLens(t *testing.T) *syntheticLens {
	t.Helper()
	byToken := map[string]lensWorkspaceRecord{
		"jwt-synthetic": {ID: testSyntheticWS, Active: true, CachePoolable: true, Synthetic: true},
		"jwt-real":      {ID: testRealWS, Active: true, CachePoolable: true, Synthetic: false},
	}
	l := &syntheticLens{}
	l.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		l.mu.Lock()
		defer l.mu.Unlock()
		auth := r.Header.Get("Authorization")
		switch {
		case r.URL.Path == provisionPath:
			l.provisionCalls++
			serveFakeProvision(w, r)
		case r.URL.Path == lensSessionKeyPath:
			l.gotMintAuth = auth
			w.WriteHeader(http.StatusCreated)
			_, _ = fmt.Fprintf(w, `{"key":%q,"expires_at":%q}`, testSessionKey,
				time.Now().Add(time.Hour).UTC().Format(time.RFC3339))
		case strings.HasPrefix(r.URL.Path, "/v1/proxy/"):
			l.gotProxyAuth = auth
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = io.WriteString(w, "data: 2+2 is 4\n\n")
		case strings.HasPrefix(r.URL.Path, "/v1/workspaces/"):
			// Lens's isolation middleware: a token reads its own workspace and nothing else.
			rec, ok := byToken[strings.TrimPrefix(auth, "Bearer ")]
			rest := strings.TrimPrefix(r.URL.Path, "/v1/workspaces/")
			id, suffix, _ := strings.Cut(rest, "/")
			switch {
			case !ok:
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			case rec.ID != id:
				http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
			case suffix == "":
				_ = json.NewEncoder(w).Encode(rec)
			default:
				l.gotReadAuth = auth
				_, _ = io.WriteString(w, `{"balance":1000}`)
			}
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(l.srv.Close)
	return l
}

func syntheticApp(t *testing.T, lens *syntheticLens, key string) *app {
	t.Helper()
	cfg := config{
		lensBaseURL: lens.srv.URL, provisionSecret: testProvisionSecret,
		authMode: authModeOIDC, oidcIssuer: "https://idp.example.com",
		publicBaseURL: "https://app.talyvor.com", sessionTTL: time.Hour,
		syntheticKey: key,
	}
	a := newApp(cfg, newSessionOnlyAuthenticator(cfg))
	a.cfg.webDist = t.TempDir()
	return a
}

// syntheticSignIn POSTs to /auth/synthetic the way the harness's headless browser does: same
// Origin, the operator key in its header, one workspace from Lens's create call in the body.
func syntheticSignIn(t *testing.T, ts *httptest.Server, key, wsID, token, expiresAt string) (*http.Response, *http.Cookie) {
	t.Helper()
	body := fmt.Sprintf(`{"workspace_id":%q,"token":%q,"expires_at":%q}`, wsID, token, expiresAt)
	req, _ := http.NewRequest(http.MethodPost, ts.URL+"/auth/synthetic", strings.NewReader(body))
	req.Header.Set("Origin", "https://app.talyvor.com")
	req.Header.Set("Content-Type", "application/json")
	if key != "" {
		req.Header.Set(syntheticKeyHeader, key)
	}
	resp, err := ts.Client().Do(req)
	if err != nil {
		t.Fatalf("sign in: %v", err)
	}
	defer resp.Body.Close()
	for _, c := range resp.Cookies() {
		if c.Name == sessionCookieName && c.Value != "" {
			return resp, c
		}
	}
	return resp, nil
}

func TestSyntheticUserSignsInAndChatsThroughTheApp(t *testing.T) {
	lens := newSyntheticLens(t)
	a := syntheticApp(t, lens, testSyntheticKey)
	ts := httptest.NewServer(a)
	defer ts.Close()

	resp, sess := syntheticSignIn(t, ts, testSyntheticKey, testSyntheticWS, "jwt-synthetic", "")
	if resp.StatusCode != http.StatusOK || sess == nil {
		t.Fatalf("synthetic sign-in: status %d, session cookie %v", resp.StatusCode, sess)
	}

	// The app's own probe sees a signed-in user in the synthetic workspace, with no pooling question.
	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/auth/me", nil)
	req.AddCookie(sess)
	me, err := ts.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var got struct {
		Authenticated      bool              `json:"authenticated"`
		User               map[string]string `json:"user"`
		WorkspaceID        string            `json:"workspace_id"`
		NeedsPoolingChoice bool              `json:"needs_pooling_choice"`
	}
	_ = json.NewDecoder(me.Body).Decode(&got)
	me.Body.Close()
	if !got.Authenticated || got.WorkspaceID != testSyntheticWS || got.NeedsPoolingChoice ||
		got.User["email"] != testSyntheticWS+syntheticEmailDomain {
		t.Fatalf("/auth/me after synthetic sign-in = %+v", got)
	}

	// A chat message goes through the same stream route the Chat screen uses.
	resp, br, done := openStream(t, a, sess, "/api/ai/stream/anthropic/v1/messages", `{"stream":true}`)
	answer, _ := io.ReadAll(br)
	done()
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(answer), "2+2 is 4") {
		t.Fatalf("chat as a synthetic user: status %d, body %q", resp.StatusCode, answer)
	}
	if lens.gotMintAuth != "Bearer jwt-synthetic" || lens.gotProxyAuth != "Bearer "+testSessionKey {
		t.Fatalf("mint carried %q, proxy carried %q — the chat must run on the synthetic workspace's own credential",
			lens.gotMintAuth, lens.gotProxyAuth)
	}
}

func TestSyntheticSignInRefusesRealAccountsAndRequestsWithoutTheKey(t *testing.T) {
	cases := []struct {
		name, bffKey, sentKey, wsID, token string
		want                               int
	}{
		{"key unset on the BFF", "", testSyntheticKey, testSyntheticWS, "jwt-synthetic", http.StatusNotFound},
		{"no key", testSyntheticKey, "", testSyntheticWS, "jwt-synthetic", http.StatusUnauthorized},
		{"wrong key", testSyntheticKey, "not-the-key", testSyntheticWS, "jwt-synthetic", http.StatusUnauthorized},
		{"a real account with its own valid token", testSyntheticKey, testSyntheticKey, testRealWS, "jwt-real", http.StatusForbidden},
		{"a real account's id with a synthetic token", testSyntheticKey, testSyntheticKey, testRealWS, "jwt-synthetic", http.StatusForbidden},
		{"a synthetic id with a real account's token", testSyntheticKey, testSyntheticKey, testSyntheticWS, "jwt-real", http.StatusForbidden},
		{"a token Lens does not know", testSyntheticKey, testSyntheticKey, testSyntheticWS, "jwt-forged", http.StatusForbidden},
		{"a path in the workspace id", testSyntheticKey, testSyntheticKey, testSyntheticWS + "/../" + testRealWS, "jwt-real", http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			lens := newSyntheticLens(t)
			a := syntheticApp(t, lens, tc.bffKey)
			ts := httptest.NewServer(a)
			defer ts.Close()
			resp, sess := syntheticSignIn(t, ts, tc.sentKey, tc.wsID, tc.token, "")
			if resp.StatusCode != tc.want {
				t.Errorf("status = %d, want %d", resp.StatusCode, tc.want)
			}
			if sess != nil {
				t.Errorf("a session cookie was set: %v", sess)
			}
			a.auth.sessions.mu.Lock()
			n := len(a.auth.sessions.m)
			a.auth.sessions.mu.Unlock()
			if n != 0 {
				t.Errorf("%d session(s) stored — a refused sign-in must store none", n)
			}
		})
	}
}

// A synthetic session whose token is about to expire must not be re-provisioned: provisioning its
// sub would create a REAL workspace and move the session into it.
func TestSyntheticSessionIsNeverReprovisioned(t *testing.T) {
	lens := newSyntheticLens(t)
	a := syntheticApp(t, lens, testSyntheticKey)
	ts := httptest.NewServer(a)
	defer ts.Close()

	soon := time.Now().Add(30 * time.Second).UTC().Format(time.RFC3339) // inside the re-mint skew
	resp, sess := syntheticSignIn(t, ts, testSyntheticKey, testSyntheticWS, "jwt-synthetic", soon)
	if resp.StatusCode != http.StatusOK || sess == nil {
		t.Fatalf("synthetic sign-in: status %d", resp.StatusCode)
	}
	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/lxc/balance", nil)
	req.AddCookie(sess)
	bal, err := ts.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	bal.Body.Close()
	if bal.StatusCode != http.StatusOK || lens.gotReadAuth != "Bearer jwt-synthetic" {
		t.Fatalf("balance read: status %d with %q, want 200 with the synthetic token", bal.StatusCode, lens.gotReadAuth)
	}
	if lens.provisionCalls != 0 {
		t.Fatalf("a synthetic session called /v1/provision %d time(s) — that creates a real workspace", lens.provisionCalls)
	}
}
