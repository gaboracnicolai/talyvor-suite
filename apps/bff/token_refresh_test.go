package main

// token_refresh_test.go — THE SESSION OUTLIVES ITS OWN CREDENTIAL.
//
// The workspace token the BFF holds for a session is minted for 8 hours (sessionTokenTTLHours).
// The session itself lasts 12 (BFF_SESSION_TTL, default). Nothing reconciled those two numbers,
// and `session.lensTokenExp` — the field that records when the token dies — appeared in exactly
// two places in the whole package: its declaration, and its assignment. NOTHING READ IT.
//
// So hours 8 → 12 of every session are spent holding a dead credential. /auth/me answers
// authenticated:true (the SESSION is fine), the auth gate correctly renders the app, every
// workspace-scoped read is refused 401, and eight panels say "Couldn't load". That is the same
// screen the Lens restart produced, arriving on a timer, for everyone, every day — the restart
// merely did it to everyone at once instead of spreading it over four hours.
//
// A field written and never read is not a small thing here: it is the difference between a bug
// that is fixed and a bug that is merely knowable.
//
// THE FIX is to read it. Before building a tenant from the session, if the token is at or past
// its expiry, re-provision — Lens's POST /v1/provision is idempotent on identity, so this
// returns the SAME workspace with a fresh token — and write the new tuple back to the session.
//
// WHAT THIS DOES NOT FIX, deliberately: a token that is still within its lifetime but has been
// invalidated some other way (Lens restarting with a new ephemeral signing key — the incident).
// Expiry is knowable in advance; a key change is not, so no proactive check can see it. That
// case is what the UI's session bar is for, and what the Lens-side key fix addresses.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// refreshUpstream is a Lens stand-in that mints a DISTINGUISHABLE token per provision call, so
// "did the BFF get a fresh one?" is a string comparison rather than an inference.
type refreshUpstream struct {
	srv *httptest.Server

	mu       sync.Mutex
	mints    int
	authSeen []string
}

func newRefreshUpstream(t *testing.T) *refreshUpstream {
	t.Helper()
	u := &refreshUpstream{}
	u.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == provisionPath {
			if r.Header.Get(provisionSecretHeader) != testProvisionSecret {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			var in struct {
				Identity string `json:"identity"`
			}
			_ = json.NewDecoder(r.Body).Decode(&in)
			u.mu.Lock()
			u.mints++
			n := u.mints
			u.mu.Unlock()
			ws := deriveWorkspaceIDLikeLens(in.Identity)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"workspace_id": ws, "created": n == 1, "cache_poolable": true,
				"token":      mintedToken(n, ws),
				"expires_at": time.Now().Add(8 * time.Hour).UTC().Format(time.RFC3339),
			})
			return
		}
		u.mu.Lock()
		u.authSeen = append(u.authSeen, r.Header.Get("Authorization"))
		u.mu.Unlock()
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	t.Cleanup(u.srv.Close)
	return u
}

func mintedToken(n int, ws string) string {
	return "jwt-mint" + strings.Repeat("!", n) + "-for-" + ws
}

func (u *refreshUpstream) lastAuth() string {
	u.mu.Lock()
	defer u.mu.Unlock()
	if len(u.authSeen) == 0 {
		return ""
	}
	return u.authSeen[len(u.authSeen)-1]
}

func (u *refreshUpstream) mintCount() int {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.mints
}

// refreshApp builds an oidc-mode BFF against the refresh upstream, with ONE seeded session whose
// token expiry the caller chooses. Returns the app, the session cookie and the identity's
// workspace id.
func refreshApp(t *testing.T, exp time.Time) (*app, *refreshUpstream, *http.Cookie, string) {
	t.Helper()
	up := newRefreshUpstream(t)
	cfg := config{
		lensBaseURL: up.srv.URL, provisionSecret: testProvisionSecret,
		authMode: authModeOIDC, oidcIssuer: "https://idp.example.com",
		publicBaseURL: "https://app.talyvor.com", sessionTTL: 12 * time.Hour,
	}
	auth := newSessionOnlyAuthenticator(cfg)
	a := newApp(cfg, auth)
	a.cfg.webDist = t.TempDir()

	ws := deriveWorkspaceIDLikeLens(provisionIdentity(cfg.oidcIssuer, "sub-long-session"))
	auth.sessions.put("sid-1", session{
		sub: "sub-long-session", email: "long@example.com",
		expires:      time.Now().Add(4 * time.Hour), // the SESSION is still fine…
		workspaceID:  ws,
		lensToken:    "jwt-stale-for-" + ws, // …but this is the 8-hour-old one
		lensTokenExp: exp,
	})
	return a, up, &http.Cookie{Name: sessionCookieName, Value: "sid-1"}, ws
}

// ─── the hole ───────────────────────────────────────────────────────────────

// A live session whose workspace token has expired must get a NEW one, not send the dead one
// upstream and hand the person eight "Couldn't load" cards.
func TestExpiredWorkspaceTokenIsReminted(t *testing.T) {
	a, up, cookie, ws := refreshApp(t, time.Now().Add(-time.Minute)) // expired one minute ago

	rec := getAs(t, a, cookie, "/api/lxc/balance")
	if rec.Code != http.StatusOK {
		t.Fatalf("read with an expired workspace token: %d — %s", rec.Code, rec.Body.String())
	}
	if up.mintCount() != 1 {
		t.Fatalf("expected exactly one re-mint, saw %d", up.mintCount())
	}
	got := up.lastAuth()
	if strings.Contains(got, "jwt-stale") {
		t.Fatalf("the DEAD token was sent upstream (%s) — the session outlives its credential and "+
			"nothing notices, which is the 8h→12h window every session spends refused", got)
	}
	if want := "Bearer " + mintedToken(1, ws); got != want {
		t.Fatalf("upstream saw %q, want the freshly minted %q", got, want)
	}
}

// The refreshed token must be WRITTEN BACK, or every single request re-provisions — turning one
// expiry into a permanent call to Lens on the hot path.
func TestRefreshedTokenIsCachedOnTheSession(t *testing.T) {
	a, up, cookie, _ := refreshApp(t, time.Now().Add(-time.Minute))

	for i := 0; i < 3; i++ {
		if rec := getAs(t, a, cookie, "/api/lxc/balance"); rec.Code != http.StatusOK {
			t.Fatalf("read %d: %d", i, rec.Code)
		}
	}
	if n := up.mintCount(); n != 1 {
		t.Fatalf("three reads caused %d mints — the refresh is not being written back to the "+
			"session, so every request now pays a provisioning round-trip", n)
	}
}

// The workspace must not move. Lens derives the id from the identity, so a re-mint returns the
// same workspace — but a BFF that re-provisioned under a DIFFERENT identity (a nonce, the
// session id) would silently hand the person an empty workspace and lose their balance, keys
// and ledger. That failure would look exactly like "the data is gone".
func TestReMintKeepsTheSameWorkspace(t *testing.T) {
	a, up, cookie, ws := refreshApp(t, time.Now().Add(-time.Minute))

	getAs(t, a, cookie, "/api/lxc/balance")
	if !strings.Contains(up.lastAuth(), ws) {
		t.Fatalf("after the re-mint the credential is for a different workspace: %s (want %s)",
			up.lastAuth(), ws)
	}
	if s, ok := a.auth.sessions.get("sid-1"); !ok || s.workspaceID != ws {
		t.Fatalf("the session's workspace changed on re-mint: %+v", s)
	}
}

// ─── THE POSITIVE CONTROL: a healthy token is left alone ────────────────────

// Without this, "always re-provision" would pass every test above while adding a Lens round-trip
// to every request in the product.
func TestValidWorkspaceTokenIsNotReminted(t *testing.T) {
	a, up, cookie, _ := refreshApp(t, time.Now().Add(6*time.Hour)) // plenty of life left

	if rec := getAs(t, a, cookie, "/api/lxc/balance"); rec.Code != http.StatusOK {
		t.Fatalf("read with a healthy token: %d", rec.Code)
	}
	if n := up.mintCount(); n != 0 {
		t.Fatalf("a valid token was re-minted %d time(s) — every request would now pay a "+
			"provisioning round-trip", n)
	}
	if got := up.lastAuth(); !strings.Contains(got, "jwt-stale") {
		t.Fatalf("upstream saw %q; the session's existing token should have been used unchanged", got)
	}
}

// An UNKNOWN expiry (Lens returned an unparseable or absent expires_at, so parseExpiry gave the
// zero time) must not be read as "expired long ago". Treating zero as expired turns an upstream
// formatting quirk into a provisioning call on EVERY request, forever — a self-inflicted load
// spike that looks like nothing from the outside.
func TestUnknownExpiryDoesNotStampede(t *testing.T) {
	a, up, cookie, _ := refreshApp(t, time.Time{}) // the zero time

	for i := 0; i < 3; i++ {
		getAs(t, a, cookie, "/api/lxc/balance")
	}
	if n := up.mintCount(); n != 0 {
		t.Fatalf("an unknown expiry caused %d mints across 3 reads — zero-time is being read as "+
			"a date in the past", n)
	}
}
