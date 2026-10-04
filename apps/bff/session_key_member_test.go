package main

// session_key_member_test.go — B27.1: TWO MEMBERS OF ONE WORKSPACE NEVER CHAT ON EACH OTHER'S
// CREDENTIAL.
//
// ⚠ EVERY OTHER FIXTURE IN THIS PACKAGE GIVES EACH SESSION ITS OWN WORKSPACE AND A TOKEN SPELLED
// "jwt-for-<ws>", so the 24-character prefix the cache used to key on differed between sessions and
// the shared-key bug could never show. Here both members share a workspace and both tokens are
// shaped like Lens's: the same base64 JWT header, differing only after the first dot.

import (
	"encoding/base64"
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

// lensLikeJWT is a token whose first 24 characters are identical for every member — the real
// HS256 header — and whose payload names the member, as Lens's workspace session token does.
func lensLikeJWT(ws, userID string) string {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	payload := base64.RawURLEncoding.EncodeToString(
		[]byte(fmt.Sprintf(`{"workspace_id":%q,"user_id":%q}`, ws, userID)))
	return header + "." + payload + ".sig"
}

// memberLens fakes the two Lens routes the bug crosses: the mint, which stamps the key with the
// user_id of the token that asked for it, and the proxy, which writes a ledger row naming the
// user_id of the key that paid.
type memberLens struct {
	srv *httptest.Server

	mu        sync.Mutex
	keyUser   map[string]string // minted session key → user_id it carries
	ledger    []string          // one user_id per answered question, as the ledger row names it
	mintCalls int
}

func newMemberLens(t *testing.T) *memberLens {
	t.Helper()
	m := &memberLens{keyUser: map[string]string{}}
	m.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		bearer := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		switch {
		case r.URL.Path == lensSessionKeyPath && r.Method == http.MethodPost:
			parts := strings.Split(bearer, ".")
			if len(parts) != 3 {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			raw, _ := base64.RawURLEncoding.DecodeString(parts[1])
			var claims struct {
				UserID string `json:"user_id"`
			}
			_ = json.Unmarshal(raw, &claims)
			m.mu.Lock()
			m.mintCalls++
			key := fmt.Sprintf("%s%s-%d", sessionKeyPrefix, claims.UserID, m.mintCalls)
			m.keyUser[key] = claims.UserID
			m.mu.Unlock()
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_, _ = fmt.Fprintf(w, `{"key":%q,"expires_at":%q}`,
				key, time.Now().Add(time.Hour).UTC().Format(time.RFC3339))

		case strings.HasPrefix(r.URL.Path, "/v1/proxy/"):
			m.mu.Lock()
			user, ok := m.keyUser[bearer]
			if ok {
				m.ledger = append(m.ledger, user)
			}
			m.mu.Unlock()
			if !ok {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = io.WriteString(w, "data: answered\n\n")

		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(m.srv.Close)
	return m
}

func TestSessionKey_TwoMembersOfOneWorkspaceEachChatOnTheirOwnKey(t *testing.T) {
	lens := newMemberLens(t)
	cfg := config{
		lensBaseURL: lens.srv.URL, provisionSecret: testProvisionSecret,
		authMode: authModeOIDC, oidcIssuer: "https://idp.example.com",
		publicBaseURL: "https://app.talyvor.com", sessionTTL: time.Hour,
	}
	auth := newSessionOnlyAuthenticator(cfg)
	const ws = "ws-shared-team"
	for _, member := range []string{"alice", "bob"} {
		auth.sessions.put("sid-"+member, session{
			sub: member, email: member + "@example.com", expires: time.Now().Add(time.Hour),
			workspaceID: ws, lensToken: lensLikeJWT(ws, member),
		})
	}
	if a, b := lensLikeJWT(ws, "alice"), lensLikeJWT(ws, "bob"); a[:24] != b[:24] {
		t.Fatalf("fixture no longer reproduces Lens: the two tokens' first 24 characters differ")
	}
	a := newApp(cfg, auth)
	a.cfg.webDist = t.TempDir()
	ts := httptest.NewServer(a)
	t.Cleanup(ts.Close)

	ask := func(member string) error {
		req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/ai/stream/anthropic/v1/messages",
			strings.NewReader(`{"stream":true}`))
		req.Header.Set("Origin", "https://app.talyvor.com")
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "sid-" + member})
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return err
		}
		defer resp.Body.Close()
		_, _ = io.ReadAll(resp.Body)
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("%s: status %d", member, resp.StatusCode)
		}
		return nil
	}

	// Alice's key is minted and cached first — the state in which Bob used to be handed it.
	if err := ask("alice"); err != nil {
		t.Fatal(err)
	}
	// Then both ask at the same time.
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for _, member := range []string{"alice", "bob"} {
		wg.Add(1)
		go func(m string) {
			defer wg.Done()
			errs <- ask(m)
		}(member)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}

	lens.mu.Lock()
	defer lens.mu.Unlock()
	rows := map[string]int{}
	for _, user := range lens.ledger {
		rows[user]++
	}
	if rows["alice"] != 2 || rows["bob"] != 1 || len(lens.ledger) != 3 {
		t.Fatalf("ledger rows by member = %v (rows %v), want alice:2 bob:1 — each answer's row must "+
			"name the member who asked, not whichever member's session key was minted first",
			rows, lens.ledger)
	}
	if lens.mintCalls != 2 {
		t.Fatalf("mint calls = %d, want 2 — one per member, reused across that member's questions",
			lens.mintCalls)
	}
}
