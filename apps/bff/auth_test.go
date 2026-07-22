package main

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// Config matrix: BFF_AUTH_MODE is the new fail-closed switch. There is no
// default — the operator must SAY whether this process authenticates, because
// inc2's only protection (loopback bind) stops being the whole story here.
// ---------------------------------------------------------------------------

// clearBFFEnv blanks every env var loadConfig reads, then applies overrides.
// t.Setenv restores automatically.
func clearBFFEnv(t *testing.T, overrides map[string]string) {
	t.Helper()
	keys := []string{
		"BFF_ADDR", "LENS_BASE_URL", "LENS_WORKSPACE_KEY", "LENS_WORKSPACE_ID", "WEB_DIST",
		"BFF_AUTH_MODE", "BFF_PUBLIC_BASE_URL", "BFF_SESSION_TTL",
		"OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_ALLOWED_EMAILS",
	}
	for _, k := range keys {
		t.Setenv(k, "")
	}
	for k, v := range overrides {
		t.Setenv(k, v)
	}
}

// validOIDCEnv is a fully-specified, valid oidc-mode environment on a loopback
// bind: https issuer, https public base URL with an empty path, allowlist set.
func validOIDCEnv() map[string]string {
	return map[string]string{
		"LENS_WORKSPACE_KEY":  testKey,
		"LENS_WORKSPACE_ID":   "trial-ws-1",
		"BFF_AUTH_MODE":       "oidc",
		"OIDC_ISSUER":         "https://idp.example.com",
		"OIDC_CLIENT_ID":      "talyvor-suite",
		"OIDC_CLIENT_SECRET":  "s3cret",
		"BFF_PUBLIC_BASE_URL": "https://app.talyvor.com",
		"OIDC_ALLOWED_EMAILS": "ng@example.com",
	}
}

func TestLoadConfigAuthMatrix(t *testing.T) {
	cases := []struct {
		name    string
		env     map[string]string // applied over a cleared env
		wantErr string            // "" = must succeed; else substring of the error
	}{
		{
			// The new requirement itself: a config that was complete in inc2
			// (key + id + loopback) must now REFUSE to start until the operator
			// declares an auth mode. Silence is not a mode.
			name:    "no auth mode refuses",
			env:     map[string]string{"LENS_WORKSPACE_KEY": testKey, "LENS_WORKSPACE_ID": "trial-ws-1"},
			wantErr: "BFF_AUTH_MODE",
		},
		{
			name: "unknown auth mode refuses",
			env: map[string]string{
				"LENS_WORKSPACE_KEY": testKey, "LENS_WORKSPACE_ID": "trial-ws-1",
				"BFF_AUTH_MODE": "clerk",
			},
			wantErr: "BFF_AUTH_MODE",
		},
		{
			// disabled == inc2 behaviour, explicitly chosen: loopback only.
			name: "disabled on loopback boots",
			env: map[string]string{
				"LENS_WORKSPACE_KEY": testKey, "LENS_WORKSPACE_ID": "trial-ws-1",
				"BFF_AUTH_MODE": "disabled",
			},
		},
		{
			// THE NON-REGRESSION: disabled (no auth) + non-loopback must still
			// hard-fail exactly as inc2 did. Auth arriving in the codebase must
			// not relax this as a side effect.
			name: "disabled on non-loopback still refuses",
			env: map[string]string{
				"LENS_WORKSPACE_KEY": testKey, "LENS_WORKSPACE_ID": "trial-ws-1",
				"BFF_AUTH_MODE": "disabled", "BFF_ADDR": "0.0.0.0:8787",
			},
			wantErr: "loopback",
		},
		{
			name: "oidc fully specified on loopback boots",
			env:  validOIDCEnv(),
		},
		{
			name:    "oidc missing client secret refuses",
			env:     without(validOIDCEnv(), "OIDC_CLIENT_SECRET"),
			wantErr: "OIDC_CLIENT_SECRET",
		},
		{
			name:    "oidc missing issuer refuses",
			env:     without(validOIDCEnv(), "OIDC_ISSUER"),
			wantErr: "OIDC_ISSUER",
		},
		{
			name:    "oidc missing allowlist refuses",
			env:     without(validOIDCEnv(), "OIDC_ALLOWED_EMAILS"),
			wantErr: "OIDC_ALLOWED_EMAILS",
		},
		{
			name:    "oidc missing public base URL refuses",
			env:     without(validOIDCEnv(), "BFF_PUBLIC_BASE_URL"),
			wantErr: "BFF_PUBLIC_BASE_URL",
		},
		{
			// The __Host- session cookie requires Secure, so the public origin
			// must be https. Plain http is allowed only on loopback (dev).
			name:    "oidc public base URL http non-loopback refuses",
			env:     with(validOIDCEnv(), "BFF_PUBLIC_BASE_URL", "http://app.talyvor.com"),
			wantErr: "https",
		},
		{
			name: "oidc public base URL http loopback boots (dev)",
			env:  with(validOIDCEnv(), "BFF_PUBLIC_BASE_URL", "http://127.0.0.1:8787"),
		},
		{
			// __Host- forces Path=/ — a base URL with a path would silently
			// mis-scope the cookie, so refuse it outright.
			name:    "oidc public base URL with path refuses",
			env:     with(validOIDCEnv(), "BFF_PUBLIC_BASE_URL", "https://app.talyvor.com/app"),
			wantErr: "path",
		},
		{
			// THE DELIBERATE RELAXATION: with auth proven on (oidc mode) and an
			// https public origin, a non-loopback bind is allowed — this is the
			// container/remote-proxy deployment. Everything else still refuses.
			name: "oidc https public origin may bind non-loopback",
			env:  with(with(validOIDCEnv(), "BFF_ADDR", "0.0.0.0:8787"), "BFF_PUBLIC_BASE_URL", "https://app.talyvor.com"),
		},
		{
			// A dev cookie posture (http loopback public URL) must NOT be
			// combined with a public bind.
			name:    "oidc dev public URL cannot bind non-loopback",
			env:     with(with(validOIDCEnv(), "BFF_ADDR", "0.0.0.0:8787"), "BFF_PUBLIC_BASE_URL", "http://127.0.0.1:8787"),
			wantErr: "loopback",
		},
		{
			name:    "oidc issuer http non-loopback refuses",
			env:     with(validOIDCEnv(), "OIDC_ISSUER", "http://192.168.1.5:5556"),
			wantErr: "https",
		},
		{
			name: "oidc issuer http loopback boots (dev IdP)",
			env:  with(validOIDCEnv(), "OIDC_ISSUER", "http://127.0.0.1:5556/dex"),
		},
		{
			name:    "oidc zero session TTL refuses",
			env:     with(validOIDCEnv(), "BFF_SESSION_TTL", "0s"),
			wantErr: "BFF_SESSION_TTL",
		},
		{
			name:    "oidc junk session TTL refuses",
			env:     with(validOIDCEnv(), "BFF_SESSION_TTL", "tomorrow"),
			wantErr: "BFF_SESSION_TTL",
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			clearBFFEnv(t, c.env)
			_, err := loadConfig()
			if c.wantErr == "" {
				if err != nil {
					t.Fatalf("want success, got: %v", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("want error containing %q, got success", c.wantErr)
			}
			if !strings.Contains(err.Error(), c.wantErr) {
				t.Fatalf("want error containing %q, got: %v", c.wantErr, err)
			}
		})
	}
}

func with(m map[string]string, k, v string) map[string]string {
	out := make(map[string]string, len(m)+1)
	for kk, vv := range m {
		out[kk] = vv
	}
	out[k] = v
	return out
}

func without(m map[string]string, k string) map[string]string {
	out := make(map[string]string, len(m))
	for kk, vv := range m {
		if kk != k {
			out[kk] = vv
		}
	}
	return out
}

// ---------------------------------------------------------------------------
// Fake OIDC provider: discovery + JWKS + authorize + token, RS256-signed
// id_tokens, and REAL server-side PKCE verification (S256(verifier) must match
// the challenge from /authorize) — so the tests prove PKCE end to end, not
// just that parameters were sent.
// ---------------------------------------------------------------------------

type fakeIDP struct {
	t            *testing.T
	srv          *httptest.Server
	key          *rsa.PrivateKey
	clientID     string
	clientSecret string

	mu            sync.Mutex
	lastAuthorize url.Values
	codes         map[string]idpCode

	// knobs
	sub           string
	email         string
	emailVerified *bool // nil = omit the claim entirely
	wrongNonce    bool  // mint the id_token with a corrupted nonce
}

type idpCode struct{ challenge, nonce, redirectURI string }

func newFakeIDP(t *testing.T) *fakeIDP {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	f := &fakeIDP{
		t: t, key: key,
		clientID: "talyvor-suite", clientSecret: "test-client-secret",
		codes: map[string]idpCode{},
		sub:   "user-123", email: "ng@example.com",
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", f.discovery)
	mux.HandleFunc("/keys", f.jwks)
	mux.HandleFunc("/authorize", f.authorize)
	mux.HandleFunc("/token", f.token)
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeIDP) discovery(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"issuer":                                f.srv.URL,
		"authorization_endpoint":                f.srv.URL + "/authorize",
		"token_endpoint":                        f.srv.URL + "/token",
		"jwks_uri":                              f.srv.URL + "/keys",
		"response_types_supported":              []string{"code"},
		"subject_types_supported":               []string{"public"},
		"id_token_signing_alg_values_supported": []string{"RS256"},
	})
}

func (f *fakeIDP) jwks(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"keys": []map[string]any{{
			"kty": "RSA", "alg": "RS256", "use": "sig", "kid": "test",
			"n": base64.RawURLEncoding.EncodeToString(f.key.PublicKey.N.Bytes()),
			"e": "AQAB",
		}},
	})
}

func (f *fakeIDP) authorize(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f.mu.Lock()
	f.lastAuthorize = q
	code := "code-" + randHex()
	f.codes[code] = idpCode{
		challenge:   q.Get("code_challenge"),
		nonce:       q.Get("nonce"),
		redirectURI: q.Get("redirect_uri"),
	}
	f.mu.Unlock()
	u := q.Get("redirect_uri") + "?code=" + url.QueryEscape(code) + "&state=" + url.QueryEscape(q.Get("state"))
	http.Redirect(w, r, u, http.StatusFound)
}

func (f *fakeIDP) token(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	// Client authentication: accept basic or form; anything else is refused.
	id, secret, okBasic := r.BasicAuth()
	if !okBasic {
		id, secret = r.PostFormValue("client_id"), r.PostFormValue("client_secret")
	}
	if uid, _ := url.QueryUnescape(id); uid == f.clientID {
		id = f.clientID
	}
	if usec, _ := url.QueryUnescape(secret); usec == f.clientSecret {
		secret = f.clientSecret
	}
	if id != f.clientID || secret != f.clientSecret {
		w.WriteHeader(http.StatusUnauthorized)
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_client"})
		return
	}
	if r.PostFormValue("grant_type") != "authorization_code" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unsupported_grant_type"})
		return
	}
	f.mu.Lock()
	c, ok := f.codes[r.PostFormValue("code")]
	delete(f.codes, r.PostFormValue("code")) // single use
	f.mu.Unlock()
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_grant"})
		return
	}
	// REAL PKCE verification: S256(code_verifier) must equal the challenge that
	// arrived at /authorize. A BFF that dropped PKCE fails here.
	sum := sha256.Sum256([]byte(r.PostFormValue("code_verifier")))
	if base64.RawURLEncoding.EncodeToString(sum[:]) != c.challenge || c.challenge == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_grant", "error_description": "PKCE verification failed"})
		return
	}
	if r.PostFormValue("redirect_uri") != c.redirectURI {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_grant", "error_description": "redirect_uri mismatch"})
		return
	}
	nonce := c.nonce
	if f.wrongNonce {
		nonce = "corrupted-" + nonce
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"access_token": "at-" + randHex(),
		"token_type":   "Bearer",
		"expires_in":   300,
		"id_token":     f.mintIDToken(nonce),
	})
}

func (f *fakeIDP) mintIDToken(nonce string) string {
	now := time.Now()
	claims := map[string]any{
		"iss": f.srv.URL, "sub": f.sub, "aud": f.clientID,
		"exp": now.Add(5 * time.Minute).Unix(), "iat": now.Unix(), "nonce": nonce,
	}
	if f.email != "" {
		claims["email"] = f.email
	}
	if f.emailVerified != nil {
		claims["email_verified"] = *f.emailVerified
	}
	b64 := func(v any) string {
		b, err := json.Marshal(v)
		if err != nil {
			f.t.Fatal(err)
		}
		return base64.RawURLEncoding.EncodeToString(b)
	}
	signing := b64(map[string]string{"alg": "RS256", "kid": "test"}) + "." + b64(claims)
	h := sha256.Sum256([]byte(signing))
	sig, err := rsa.SignPKCS1v15(rand.Reader, f.key, crypto.SHA256, h[:])
	if err != nil {
		f.t.Fatal(err)
	}
	return signing + "." + base64.RawURLEncoding.EncodeToString(sig)
}

func randHex() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

func boolPtr(b bool) *bool { return &b }

// ---------------------------------------------------------------------------
// Stack helpers: the BFF runs under a TLS httptest server so the Secure
// __Host- cookies genuinely round-trip through a cookie jar — nothing about
// the cookie posture is simulated.
// ---------------------------------------------------------------------------

// startOIDCBFF builds an oidc-mode BFF whose public base URL IS its TLS URL,
// backed by fake Lens + fake IdP. Returns the app (for store seeding), the TLS
// server, and a jar-carrying client that does NOT follow redirects.
func startOIDCBFF(t *testing.T, idp *fakeIDP, gotAuth *string, mutate func(*config)) (*app, *httptest.Server, *http.Client) {
	t.Helper()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if gotAuth != nil {
			*gotAuth = r.Header.Get("Authorization")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"path":"`+r.URL.Path+`","query":"`+r.URL.RawQuery+`"}`)
	}))
	t.Cleanup(upstream.Close)

	// The public origin must be known before the app exists (redirect URI), and
	// must equal the TLS server's URL — so make the listener first.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	cfg := config{
		addr: "127.0.0.1:0", lensBaseURL: upstream.URL,
		workspaceKey: testKey, workspaceID: "trial-ws-1", webDist: t.TempDir(),
		authMode: authModeOIDC, oidcIssuer: idp.srv.URL,
		oidcClientID: idp.clientID, oidcClientSecret: idp.clientSecret,
		publicBaseURL: "https://" + ln.Addr().String(),
		allowedEmails: []string{"ng@example.com"},
		sessionTTL:    time.Hour,
	}
	if mutate != nil {
		mutate(&cfg)
	}
	auth, err := newAuthenticator(context.Background(), cfg)
	if err != nil {
		t.Fatalf("newAuthenticator: %v", err)
	}
	a := newApp(cfg, auth)
	ts := httptest.NewUnstartedServer(a)
	ts.Listener.Close()
	ts.Listener = ln
	ts.StartTLS()
	t.Cleanup(ts.Close)
	if ts.URL != cfg.publicBaseURL {
		t.Fatalf("test rig: TLS URL %s != public base URL %s", ts.URL, cfg.publicBaseURL)
	}

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{
		Transport:     ts.Client().Transport, // trusts the test server's cert
		Jar:           jar,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	return a, ts, client
}

// get issues a GET (or POST with empty body when post=true), returns the
// response and its fully-read body. The body is closed.
func doReq(t *testing.T, client *http.Client, method, u string) (*http.Response, string) {
	t.Helper()
	req, err := http.NewRequest(method, u, nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, u, err)
	}
	body, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	return resp, string(body)
}

// nakedClient is a jar-less client for the same TLS server: shares the
// transport (cert trust) but carries NO cookies — httptest's own Client() is a
// shared instance and must not be reused as "unauthenticated".
func nakedClient(ts *httptest.Server) *http.Client {
	return &http.Client{
		Transport:     ts.Client().Transport,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

func cookieNamed(resp *http.Response, name string) *http.Cookie {
	for _, c := range resp.Cookies() {
		if c.Name == name {
			return c
		}
	}
	return nil
}

// loginHops drives login → IdP → callback and returns the three responses
// (with bodies). It asserts nothing itself beyond transport success.
type hops struct {
	login, idp, callback       *http.Response
	loginBody, idpBody, cbBody string
	callbackURL                string
}

func loginHops(t *testing.T, ts *httptest.Server, client *http.Client, returnTo string) hops {
	t.Helper()
	var h hops
	h.login, h.loginBody = doReq(t, client, http.MethodGet, ts.URL+"/auth/login?return_to="+url.QueryEscape(returnTo))
	if h.login.StatusCode != http.StatusFound {
		t.Fatalf("login: got %d (%s)", h.login.StatusCode, h.loginBody)
	}
	h.idp, h.idpBody = doReq(t, client, http.MethodGet, h.login.Header.Get("Location"))
	if h.idp.StatusCode != http.StatusFound {
		t.Fatalf("idp authorize: got %d (%s)", h.idp.StatusCode, h.idpBody)
	}
	h.callbackURL = h.idp.Header.Get("Location")
	h.callback, h.cbBody = doReq(t, client, http.MethodGet, h.callbackURL)
	return h
}

// ---------------------------------------------------------------------------
// The behaviours.
// ---------------------------------------------------------------------------

// TestLoginRedirectsToProvider: /auth/login must send the browser to the
// configured provider's authorization endpoint with code+PKCE(S256)+state+nonce,
// and pin the flow to this browser with a __Host- state cookie.
func TestLoginRedirectsToProvider(t *testing.T) {
	idp := newFakeIDP(t)
	_, ts, client := startOIDCBFF(t, idp, nil, nil)

	resp, body := doReq(t, client, http.MethodGet, ts.URL+"/auth/login?return_to=/ledger")
	if resp.StatusCode != http.StatusFound {
		t.Fatalf("got %d (%s), want 302", resp.StatusCode, body)
	}
	loc, err := url.Parse(resp.Header.Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if got := loc.Scheme + "://" + loc.Host + loc.Path; got != idp.srv.URL+"/authorize" {
		t.Fatalf("redirects to %s, want the provider's authorize endpoint", got)
	}
	q := loc.Query()
	if q.Get("response_type") != "code" {
		t.Errorf("response_type = %q, want code", q.Get("response_type"))
	}
	if q.Get("client_id") != idp.clientID {
		t.Errorf("client_id = %q", q.Get("client_id"))
	}
	if q.Get("redirect_uri") != ts.URL+"/auth/callback" {
		t.Errorf("redirect_uri = %q, want %s/auth/callback (derived from BFF_PUBLIC_BASE_URL)", q.Get("redirect_uri"), ts.URL)
	}
	if q.Get("code_challenge_method") != "S256" || q.Get("code_challenge") == "" {
		t.Errorf("PKCE missing: method=%q challenge=%q", q.Get("code_challenge_method"), q.Get("code_challenge"))
	}
	if q.Get("state") == "" || q.Get("nonce") == "" {
		t.Errorf("state=%q nonce=%q: both must be set", q.Get("state"), q.Get("nonce"))
	}
	if !strings.Contains(q.Get("scope"), "openid") || !strings.Contains(q.Get("scope"), "email") {
		t.Errorf("scope = %q, want openid+email", q.Get("scope"))
	}

	ck := cookieNamed(resp, pendingCookieName)
	if ck == nil {
		t.Fatalf("no %s cookie set", pendingCookieName)
	}
	if !ck.Secure || !ck.HttpOnly || ck.Path != "/" || ck.SameSite != http.SameSiteLaxMode || ck.Domain != "" {
		t.Fatalf("state cookie attributes wrong (must satisfy __Host-: Secure, Path=/, no Domain; plus HttpOnly, Lax): %+v", ck)
	}
	if ck.MaxAge <= 0 || ck.MaxAge > 900 {
		t.Fatalf("state cookie MaxAge = %d, want a short positive lifetime", ck.MaxAge)
	}
}

// TestFullLoginFlowSetsSessionAndAuthorizesAPI is the arc of the increment:
// complete the code+PKCE flow against the fake IdP, receive a __Host- session
// cookie with the right attributes, land on return_to, and THEN reach /api —
// which without the session must 401, and with it must proxy to Lens with the
// key attached server-side.
func TestFullLoginFlowSetsSessionAndAuthorizesAPI(t *testing.T) {
	idp := newFakeIDP(t)
	var gotAuth string
	_, ts, client := startOIDCBFF(t, idp, &gotAuth, nil)

	h := loginHops(t, ts, client, "/ledger")
	if h.callback.StatusCode != http.StatusFound {
		t.Fatalf("callback: got %d (%s), want 302", h.callback.StatusCode, h.cbBody)
	}
	if got := h.callback.Header.Get("Location"); got != "/ledger" {
		t.Fatalf("callback redirects to %q, want /ledger", got)
	}

	sess := cookieNamed(h.callback, sessionCookieName)
	if sess == nil {
		t.Fatalf("callback set no %s cookie; cookies: %v", sessionCookieName, h.callback.Cookies())
	}
	if !sess.Secure || !sess.HttpOnly || sess.Path != "/" || sess.SameSite != http.SameSiteLaxMode || sess.Domain != "" {
		t.Fatalf("session cookie attributes wrong (must satisfy __Host-: Secure, Path=/, no Domain; plus HttpOnly, Lax): %+v", sess)
	}
	if sess.MaxAge != 3600 {
		t.Fatalf("session cookie MaxAge = %d, want 3600 (the configured 1h TTL)", sess.MaxAge)
	}
	// The transient state cookie must be consumed: cleared on the callback.
	if cleared := cookieNamed(h.callback, pendingCookieName); cleared == nil || cleared.MaxAge >= 0 {
		t.Fatalf("state cookie not cleared on callback: %+v", cleared)
	}

	// With the session: /api serves, and the key went upstream — not to us.
	resp, body := doReq(t, client, http.MethodGet, ts.URL+"/api/tokens/balance")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("/api with session: got %d (%s)", resp.StatusCode, body)
	}
	if gotAuth != "Bearer "+testKey {
		t.Fatalf("upstream did not receive the key: %q", gotAuth)
	}
	if strings.Contains(body, "tlv_ws_") {
		t.Fatalf("key leaked: %s", body)
	}

	// Without the session (fresh client, no jar): 401 — an explicit refusal,
	// never a silent empty result.
	naked := nakedClient(ts)
	nresp, nbody := doReq(t, naked, http.MethodGet, ts.URL+"/api/tokens/balance")
	if nresp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("/api without session: got %d (%s), want 401", nresp.StatusCode, nbody)
	}
	if !strings.Contains(nbody, "auth") {
		t.Fatalf("401 body should say what is missing: %s", nbody)
	}
}

// TestCallbackRejectsForgedState: the state echoed by the IdP must match the
// state bound to THIS browser's pending login. A forged/foreign state is a CSRF
// attempt and must produce 400 and no session.
func TestCallbackRejectsForgedState(t *testing.T) {
	idp := newFakeIDP(t)
	_, ts, client := startOIDCBFF(t, idp, nil, nil)

	h := hops{}
	h.login, _ = doReq(t, client, http.MethodGet, ts.URL+"/auth/login?return_to=/")
	h.idp, _ = doReq(t, client, http.MethodGet, h.login.Header.Get("Location"))
	cb, err := url.Parse(h.idp.Header.Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	q := cb.Query()
	q.Set("state", "forged-"+q.Get("state"))
	cb.RawQuery = q.Encode()

	resp, body := doReq(t, client, http.MethodGet, cb.String())
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("forged state: got %d (%s), want 400", resp.StatusCode, body)
	}
	if cookieNamed(resp, sessionCookieName) != nil {
		t.Fatal("forged state must not create a session")
	}
}

// TestCallbackWithoutPendingCookie: a callback with no pending-login cookie has
// nothing to bind to — refuse it.
func TestCallbackWithoutPendingCookie(t *testing.T) {
	idp := newFakeIDP(t)
	_, ts, _ := startOIDCBFF(t, idp, nil, nil)

	resp, body := doReq(t, nakedClient(ts), http.MethodGet, ts.URL+"/auth/callback?code=x&state=y")
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("got %d (%s), want 400", resp.StatusCode, body)
	}
}

// TestCallbackPendingSingleUse: replaying a completed callback (same cookie,
// same code) must fail — the pending record is consumed on first use.
func TestCallbackPendingSingleUse(t *testing.T) {
	idp := newFakeIDP(t)
	_, ts, client := startOIDCBFF(t, idp, nil, nil)

	h := loginHops(t, ts, client, "/")
	if h.callback.StatusCode != http.StatusFound {
		t.Fatalf("first callback: %d", h.callback.StatusCode)
	}
	// Replay with the original state cookie re-attached manually (the jar has
	// dropped it because the callback cleared it).
	stateCk := cookieNamed(h.login, pendingCookieName)
	req, _ := http.NewRequest(http.MethodGet, h.callbackURL, nil)
	req.AddCookie(&http.Cookie{Name: pendingCookieName, Value: stateCk.Value})
	resp, err := nakedClient(ts).Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("replayed callback: got %d, want 400", resp.StatusCode)
	}
	if cookieNamed(resp, sessionCookieName) != nil {
		t.Fatal("replayed callback must not create a session")
	}
}

// TestCallbackRejectsWrongNonce: the nonce inside the verified id_token must be
// the one this flow generated — a token minted for another flow is refused even
// though its signature is valid.
func TestCallbackRejectsWrongNonce(t *testing.T) {
	idp := newFakeIDP(t)
	idp.wrongNonce = true
	_, ts, client := startOIDCBFF(t, idp, nil, nil)

	h := loginHops(t, ts, client, "/")
	if h.callback.StatusCode != http.StatusBadRequest {
		t.Fatalf("wrong nonce: got %d (%s), want 400", h.callback.StatusCode, h.cbBody)
	}
	if cookieNamed(h.callback, sessionCookieName) != nil {
		t.Fatal("wrong nonce must not create a session")
	}
}

// TestAllowlistDeniesUnlistedEmail: authentication is the IdP's; authorization
// is OURS. An identity the issuer vouches for but the allowlist doesn't list
// gets 403 — authenticated, not authorised — and no session.
func TestAllowlistDeniesUnlistedEmail(t *testing.T) {
	idp := newFakeIDP(t)
	idp.email = "mallory@example.com"
	_, ts, client := startOIDCBFF(t, idp, nil, nil)

	h := loginHops(t, ts, client, "/")
	if h.callback.StatusCode != http.StatusForbidden {
		t.Fatalf("unlisted email: got %d (%s), want 403", h.callback.StatusCode, h.cbBody)
	}
	if cookieNamed(h.callback, sessionCookieName) != nil {
		t.Fatal("denied identity must not get a session")
	}
	// And the refusal did not open the API.
	resp, _ := doReq(t, client, http.MethodGet, ts.URL+"/api/context")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("/api after denied login: got %d, want 401", resp.StatusCode)
	}
}

// TestAllowlistRejectsExplicitlyUnverifiedEmail: an email the IdP itself marks
// unverified must not clear an email-keyed allowlist.
func TestAllowlistRejectsExplicitlyUnverifiedEmail(t *testing.T) {
	idp := newFakeIDP(t)
	idp.emailVerified = boolPtr(false)
	_, ts, client := startOIDCBFF(t, idp, nil, nil)

	h := loginHops(t, ts, client, "/")
	if h.callback.StatusCode != http.StatusForbidden {
		t.Fatalf("unverified email: got %d (%s), want 403", h.callback.StatusCode, h.cbBody)
	}
}

// TestAllowlistWildcard: "*" delegates authorization entirely to the issuer —
// any authenticated subject is allowed, even without an email claim.
func TestAllowlistWildcard(t *testing.T) {
	idp := newFakeIDP(t)
	idp.email = "" // no email claim at all
	_, ts, client := startOIDCBFF(t, idp, nil, func(c *config) {
		c.allowedEmails = []string{"*"}
	})

	h := loginHops(t, ts, client, "/")
	if h.callback.StatusCode != http.StatusFound {
		t.Fatalf("wildcard: got %d (%s), want 302", h.callback.StatusCode, h.cbBody)
	}
	resp, _ := doReq(t, client, http.MethodGet, ts.URL+"/api/context")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("/api with wildcard session: got %d", resp.StatusCode)
	}
}

// TestAPIRequiresSession: every /api route in oidc mode is 401 without a valid
// session — missing, garbage, and expired cookies all refuse explicitly.
func TestAPIRequiresSession(t *testing.T) {
	cfg := config{
		lensBaseURL: "http://127.0.0.1:1", workspaceKey: testKey, workspaceID: "trial-ws-1",
		authMode: authModeOIDC, sessionTTL: time.Hour,
	}
	auth := newSessionOnlyAuthenticator(cfg)
	a := newApp(cfg, auth)
	a.cfg.webDist = t.TempDir()

	endpoints := []string{
		"/api/context", "/api/lxc/balance", "/api/tokens/balance",
		"/api/tokens/history", "/api/lxc/history", "/api/workspaces", "/api/bonds",
		"/api/track/workspaces", "/api/docs/spaces", // inc6 product routes: same gate
		"/api/anything-unknown",
	}
	for _, ep := range endpoints {
		rec := httptest.NewRecorder()
		a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, ep, nil))
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s no cookie: got %d, want 401", ep, rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "auth") {
			t.Errorf("%s: 401 body must name the problem: %s", ep, rec.Body.String())
		}
	}

	// Garbage session id.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/context", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "no-such-session"})
	a.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("garbage session: got %d, want 401", rec.Code)
	}

	// Expired session.
	auth.sessions.put("expired-sid", session{sub: "u", email: "ng@example.com", expires: time.Now().Add(-time.Minute)})
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/context", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "expired-sid"})
	a.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expired session: got %d, want 401", rec.Code)
	}

	// Valid session: through.
	auth.sessions.put("valid-sid", session{sub: "u", email: "ng@example.com", expires: time.Now().Add(time.Hour)})
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/context", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "valid-sid"})
	a.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("valid session: got %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
}

// TestLogout: POST /auth/logout destroys the server-side session and expires
// the cookie; the old cookie value is dead afterwards. GET is refused.
func TestLogout(t *testing.T) {
	idp := newFakeIDP(t)
	_, ts, client := startOIDCBFF(t, idp, nil, nil)

	h := loginHops(t, ts, client, "/")
	sid := cookieNamed(h.callback, sessionCookieName).Value

	// GET refused.
	gresp, _ := doReq(t, client, http.MethodGet, ts.URL+"/auth/logout")
	if gresp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("GET logout: got %d, want 405", gresp.StatusCode)
	}
	if gresp.Header.Get("Allow") != "POST" {
		t.Fatalf("GET logout Allow = %q, want POST", gresp.Header.Get("Allow"))
	}

	resp, _ := doReq(t, client, http.MethodPost, ts.URL+"/auth/logout")
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("logout: got %d, want 204", resp.StatusCode)
	}
	if ck := cookieNamed(resp, sessionCookieName); ck == nil || ck.MaxAge >= 0 {
		t.Fatalf("logout must expire the session cookie: %+v", ck)
	}

	// The jar dropped the cookie; but even resending the OLD value must 401 —
	// the session died server-side, not just in the browser.
	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/context", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: sid})
	r2, err := nakedClient(ts).Do(req)
	if err != nil {
		t.Fatal(err)
	}
	r2.Body.Close()
	if r2.StatusCode != http.StatusUnauthorized {
		t.Fatalf("old session after logout: got %d, want 401", r2.StatusCode)
	}
}

// TestAuthMe: the UI's one probe. Always 200; reports mode and identity.
func TestAuthMe(t *testing.T) {
	idp := newFakeIDP(t)
	_, ts, client := startOIDCBFF(t, idp, nil, nil)

	resp, body := doReq(t, client, http.MethodGet, ts.URL+"/auth/me")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("me unauthenticated: got %d", resp.StatusCode)
	}
	var me struct {
		Mode          string `json:"mode"`
		Authenticated bool   `json:"authenticated"`
		User          *struct {
			Email string `json:"email"`
			Sub   string `json:"sub"`
		} `json:"user"`
	}
	if err := json.Unmarshal([]byte(body), &me); err != nil {
		t.Fatalf("me: %v (%s)", err, body)
	}
	if me.Mode != "oidc" || me.Authenticated || me.User != nil {
		t.Fatalf("me unauthenticated = %+v", me)
	}

	loginHops(t, ts, client, "/")
	_, body = doReq(t, client, http.MethodGet, ts.URL+"/auth/me")
	if err := json.Unmarshal([]byte(body), &me); err != nil {
		t.Fatal(err)
	}
	if !me.Authenticated || me.User == nil || me.User.Email != "ng@example.com" {
		t.Fatalf("me authenticated = %+v (%s)", me, body)
	}
	if strings.Contains(body, "tlv_ws_") {
		t.Fatalf("me leaked a key: %s", body)
	}
}

// TestSecondLoginInvalidatesFirstSession: logging in again rotates the session —
// the previous session id dies (fixation hygiene, and one live session per
// browser).
func TestSecondLoginInvalidatesFirstSession(t *testing.T) {
	idp := newFakeIDP(t)
	_, ts, client := startOIDCBFF(t, idp, nil, nil)

	h1 := loginHops(t, ts, client, "/")
	sid1 := cookieNamed(h1.callback, sessionCookieName).Value
	h2 := loginHops(t, ts, client, "/")
	if sid2 := cookieNamed(h2.callback, sessionCookieName).Value; sid2 == sid1 {
		t.Fatal("second login must issue a NEW session id")
	}

	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/context", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: sid1})
	resp, err := nakedClient(ts).Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("first session after re-login: got %d, want 401", resp.StatusCode)
	}
}

// TestReturnToSanitised: return_to is a same-app path, never an off-origin
// destination — the login endpoint must not be an open redirector.
func TestReturnToSanitised(t *testing.T) {
	cases := []struct{ in, want string }{
		{"", "/"},
		{"/", "/"},
		{"/ledger", "/ledger"},
		{"/ledger?tab=lxc", "/ledger?tab=lxc"},
		{"https://evil.example.com/", "/"},
		{"//evil.example.com", "/"},
		{"/\\evil.example.com", "/"},
		{"ledger", "/"},
		{"javascript:alert(1)", "/"},
	}
	for _, c := range cases {
		if got := sanitizeReturnTo(c.in); got != c.want {
			t.Errorf("sanitizeReturnTo(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// TestAuthEndpointsInDisabledMode: in disabled mode the login machinery is
// absent (explicit 404, not a silent SPA fallback), /auth/me reports the mode,
// and /api needs no session — the loopback bind is the guard, as in inc2.
func TestAuthEndpointsInDisabledMode(t *testing.T) {
	a := newApp(config{
		lensBaseURL: "http://127.0.0.1:1", workspaceKey: testKey, workspaceID: "trial-ws-1",
		webDist: t.TempDir(), authMode: authModeDisabled,
	}, nil)

	for _, ep := range []struct{ method, path string }{
		{http.MethodGet, "/auth/login"},
		{http.MethodGet, "/auth/callback"},
		{http.MethodPost, "/auth/logout"},
	} {
		rec := httptest.NewRecorder()
		a.ServeHTTP(rec, httptest.NewRequest(ep.method, ep.path, nil))
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s %s in disabled mode: got %d, want 404", ep.method, ep.path, rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "disabled") {
			t.Errorf("%s %s: body should say auth is disabled: %s", ep.method, ep.path, rec.Body.String())
		}
	}

	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/auth/me", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "disabled") {
		t.Fatalf("/auth/me in disabled mode: %d %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/context", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("/api/context in disabled mode should need no session: %d", rec.Code)
	}
}

// TestKeyNeverReachesResponseOIDC extends THE inc2 assertion across the auth
// surface: with a live session, no /api or /auth response — body or header —
// ever contains the workspace key.
func TestKeyNeverReachesResponseOIDC(t *testing.T) {
	idp := newFakeIDP(t)
	var gotAuth string
	_, ts, client := startOIDCBFF(t, idp, &gotAuth, nil)

	h := loginHops(t, ts, client, "/")
	sweep := func(name string, resp *http.Response, body string) {
		t.Helper()
		if strings.Contains(body, testKey) || strings.Contains(body, "tlv_ws_") {
			t.Fatalf("%s: key in body: %s", name, body)
		}
		for hn, vals := range resp.Header {
			for _, v := range vals {
				if strings.Contains(v, testKey) || strings.Contains(v, "tlv_ws_") {
					t.Fatalf("%s: key in header %s", name, hn)
				}
			}
		}
	}
	sweep("login", h.login, h.loginBody)
	sweep("callback", h.callback, h.cbBody)

	for _, ep := range []string{
		"/api/context", "/api/lxc/balance", "/api/tokens/balance",
		"/api/tokens/history?limit=5&offset=0", "/api/lxc/history?limit=5&offset=0",
		"/api/workspaces", "/api/bonds", "/auth/me",
	} {
		resp, body := doReq(t, client, http.MethodGet, ts.URL+ep)
		sweep(ep, resp, body)
	}
	if gotAuth != "Bearer "+testKey {
		t.Fatalf("upstream never received the key: %q", gotAuth)
	}
}
