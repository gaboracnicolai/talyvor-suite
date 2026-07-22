package main

// OIDC authentication for the BFF: authorization code + PKCE against ANY
// standards-compliant provider (Keycloak, Authentik, Dex, Clerk acting as an
// OIDC IdP, …), configured entirely by environment. The product is
// self-hostable, so no hosted-SaaS dependency is baked into the code — a
// self-hoster points OIDC_ISSUER at their own IdP and nothing else changes.
//
// The browser ends up holding exactly one thing: an opaque __Host- session
// cookie. ID tokens, access tokens, the client secret and the Lens workspace
// key all live and die server-side.
//
// Identity → workspace mapping, this increment: every identity the allowlist
// admits uses THE one configured workspace credential (LENS_WORKSPACE_KEY /
// LENS_WORKSPACE_ID) — one user, one workspace. Multi-workspace is a mapping
// (OIDC sub → workspace credential) that belongs in a store the BFF consults
// per-request, with per-workspace JWTs minted via Lens's admin token endpoint;
// the session already carries the stable `sub` that mapping will key on.

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

const (
	// __Host- prefix: the browser only accepts these over a secure origin, with
	// Secure + Path=/ and WITHOUT Domain — so the cookie is host-locked and a
	// sibling subdomain (anything.talyvor.com) cannot plant one that
	// app.talyvor.com would trust. setCookie encodes those attributes once.
	sessionCookieName = "__Host-talyvor_session"
	pendingCookieName = "__Host-talyvor_authstate"

	// pendingTTL bounds one login round-trip, not a session: login page → IdP →
	// callback. Generous for a human typing a password; useless to an attacker.
	pendingTTL = 10 * time.Minute
)

// session is a server-side login: the browser holds only the opaque id.
type session struct {
	sub     string
	email   string
	expires time.Time
}

func (s session) expiresAt() time.Time { return s.expires }

// pendingLogin is the state of one in-flight OIDC flow, bound to one browser via
// the pending cookie. Single-use: consumed on the first callback that presents it.
type pendingLogin struct {
	state    string // CSRF token, round-trips via the IdP
	verifier string // PKCE code verifier; its S256 hash went to the IdP
	nonce    string // binds the id_token to this flow
	returnTo string // sanitised same-app path to land on
	expires  time.Time
}

func (p pendingLogin) expiresAt() time.Time { return p.expires }

type expirable interface{ expiresAt() time.Time }

// ttlMap is a mutex-guarded in-memory store with per-entry expiry. In-memory is
// a deliberate inc5 choice: one BFF process, sessions die on restart (users
// re-login). A multi-instance deployment swaps this for a shared store; nothing
// else changes.
type ttlMap[T expirable] struct {
	mu sync.Mutex
	m  map[string]T
}

func newTTLMap[T expirable]() *ttlMap[T] { return &ttlMap[T]{m: map[string]T{}} }

func (s *ttlMap[T]) put(id string, v T) {
	s.mu.Lock()
	defer s.mu.Unlock()
	// Opportunistic sweep: these maps are small (≤ active logins), so O(n) on
	// write is cheaper than a janitor goroutine.
	now := time.Now()
	for k, e := range s.m {
		if now.After(e.expiresAt()) {
			delete(s.m, k)
		}
	}
	s.m[id] = v
}

func (s *ttlMap[T]) get(id string) (T, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.m[id]
	if !ok || time.Now().After(v.expiresAt()) {
		delete(s.m, id)
		var zero T
		return zero, false
	}
	return v, true
}

// take is get-and-delete in one critical section: the caller gets the value at
// most once, which is what makes pending logins replay-proof.
func (s *ttlMap[T]) take(id string) (T, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.m[id]
	delete(s.m, id)
	if !ok || time.Now().After(v.expiresAt()) {
		var zero T
		return zero, false
	}
	return v, true
}

func (s *ttlMap[T]) delete(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.m, id)
}

// authenticator owns the OIDC round-trip and both stores.
type authenticator struct {
	cfg        config
	verifier   *oidc.IDTokenVerifier
	oauth      oauth2.Config
	httpClient *http.Client
	pending    *ttlMap[pendingLogin]
	sessions   *ttlMap[session]
}

// newAuthenticator discovers the issuer and builds the OIDC client. It is called
// at boot in oidc mode, so an unreachable/misconfigured IdP refuses to start.
// ctx should be long-lived (main passes Background): go-oidc retains it for
// later JWKS refreshes, and per-request timeouts come from httpClient instead.
func newAuthenticator(ctx context.Context, cfg config) (*authenticator, error) {
	a := newSessionOnlyAuthenticator(cfg)
	a.httpClient = &http.Client{Timeout: 10 * time.Second}
	provider, err := oidc.NewProvider(oidc.ClientContext(ctx, a.httpClient), cfg.oidcIssuer)
	if err != nil {
		return nil, fmt.Errorf("OIDC discovery against %s: %w", cfg.oidcIssuer, err)
	}
	a.verifier = provider.Verifier(&oidc.Config{ClientID: cfg.oidcClientID})
	a.oauth = oauth2.Config{
		ClientID:     cfg.oidcClientID,
		ClientSecret: cfg.oidcClientSecret,
		Endpoint:     provider.Endpoint(),
		RedirectURL:  cfg.publicBaseURL + "/auth/callback",
		Scopes:       []string{oidc.ScopeOpenID, "email", "profile"},
	}
	return a, nil
}

// newSessionOnlyAuthenticator builds an authenticator with live stores but no
// provider — session middleware works, the login machinery answers 503. Used
// directly by tests; production always goes through newAuthenticator.
func newSessionOnlyAuthenticator(cfg config) *authenticator {
	return &authenticator{cfg: cfg, pending: newTTLMap[pendingLogin](), sessions: newTTLMap[session]()}
}

func (auth *authenticator) sessionFrom(r *http.Request) (session, bool) {
	ck, err := r.Cookie(sessionCookieName)
	if err != nil || ck.Value == "" {
		return session{}, false
	}
	return auth.sessions.get(ck.Value)
}

// randomToken returns 256 bits of crypto/rand, URL-safe. Used for session ids,
// state, nonce and the pending-login id.
func randomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// sanitizeReturnTo confines return_to to a same-app path: it must be absolute
// within the app ("/…") and must not be scheme-relative ("//host") or contain a
// backslash (browsers normalise "\" to "/" in URLs, which would reopen the
// scheme-relative hole). Anything else lands on "/". The login endpoint must
// never be usable as an open redirector.
func sanitizeReturnTo(raw string) string {
	if raw == "" || !strings.HasPrefix(raw, "/") ||
		strings.HasPrefix(raw, "//") || strings.Contains(raw, "\\") {
		return "/"
	}
	return raw
}

// setCookie writes a __Host--compatible cookie: Secure, HttpOnly, SameSite=Lax,
// Path=/, no Domain. Lax (not Strict) because the OIDC callback arrives as a
// top-level cross-site navigation from the IdP — Strict would strip the state
// cookie exactly when it is needed; Lax still withholds cookies from cross-site
// subresources and POSTs, which is what CSRF needs.
func setCookie(w http.ResponseWriter, name, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     "/",
		Secure:   true,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   maxAge,
	})
}

func clearCookie(w http.ResponseWriter, name string) { setCookie(w, name, "", -1) }

// handleAuthUnavailable answers for the login machinery when there is no live
// provider: an explicit 404 in disabled mode (so the SPA fallback never
// swallows /auth/*), and a fail-closed 503 if oidc mode is somehow wired
// without a provider. Returns true if it wrote a response.
func (a *app) handleAuthUnavailable(w http.ResponseWriter) bool {
	if a.cfg.authMode == authModeDisabled {
		writeJSON(w, http.StatusNotFound, map[string]string{
			"error": "authentication is disabled on this BFF (BFF_AUTH_MODE=disabled)",
		})
		return true
	}
	if a.auth == nil || a.auth.verifier == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "authentication misconfigured"})
		return true
	}
	return false
}

// handleLogin starts one flow: mint state+nonce+PKCE verifier, park them
// server-side keyed by a random pending id, hand the browser that id in a
// short-lived __Host- cookie, and send it to the provider.
func (a *app) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	if a.handleAuthUnavailable(w) {
		return
	}
	state, err1 := randomToken()
	nonce, err2 := randomToken()
	pendingID, err3 := randomToken()
	if err1 != nil || err2 != nil || err3 != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "entropy unavailable"})
		return
	}
	verifier := oauth2.GenerateVerifier()
	a.auth.pending.put(pendingID, pendingLogin{
		state:    state,
		verifier: verifier,
		nonce:    nonce,
		returnTo: sanitizeReturnTo(r.URL.Query().Get("return_to")),
		expires:  time.Now().Add(pendingTTL),
	})
	setCookie(w, pendingCookieName, pendingID, int(pendingTTL.Seconds()))
	http.Redirect(w, r,
		a.auth.oauth.AuthCodeURL(state, oauth2.S256ChallengeOption(verifier), oidc.Nonce(nonce)),
		http.StatusFound)
}

// handleCallback finishes the flow: consume the pending login (single use),
// check state, exchange the code (with the PKCE verifier), verify the id_token
// (signature, issuer, audience, expiry — then nonce), authorise the identity
// against the allowlist, and only then create a session.
func (a *app) handleCallback(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	if a.handleAuthUnavailable(w) {
		return
	}

	ck, err := r.Cookie(pendingCookieName)
	if err != nil || ck.Value == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "no login in progress in this browser — start at /auth/login"})
		return
	}
	// Whatever happens from here, this flow is spent: the pending record is
	// consumed and the browser's state cookie cleared. A replayed callback dies
	// on the next line no matter how it went the first time.
	p, ok := a.auth.pending.take(ck.Value)
	clearCookie(w, pendingCookieName)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "login flow expired or already used — start again at /auth/login"})
		return
	}

	q := r.URL.Query()
	if e := q.Get("error"); e != "" {
		// The provider itself refused (user cancelled, policy, …). Surface it.
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "identity provider refused: " + e, "description": q.Get("error_description")})
		return
	}
	if q.Get("state") == "" || q.Get("state") != p.state {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "state mismatch — possible cross-site forgery; start again at /auth/login"})
		return
	}
	code := q.Get("code")
	if code == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "identity provider sent no code"})
		return
	}

	ctx := context.WithValue(r.Context(), oauth2.HTTPClient, a.auth.httpClient)
	tok, err := a.auth.oauth.Exchange(ctx, code, oauth2.VerifierOption(p.verifier))
	if err != nil {
		log.Printf("bff: oidc code exchange failed: %v", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{
			"error": "code exchange with the identity provider failed"})
		return
	}
	rawID, ok := tok.Extra("id_token").(string)
	if !ok || rawID == "" {
		writeJSON(w, http.StatusBadGateway, map[string]string{
			"error": "identity provider returned no id_token"})
		return
	}
	idt, err := a.auth.verifier.Verify(ctx, rawID)
	if err != nil {
		log.Printf("bff: id_token rejected: %v", err)
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "id_token failed verification"})
		return
	}
	if idt.Nonce != p.nonce {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "id_token nonce mismatch"})
		return
	}

	var claims struct {
		Email         string `json:"email"`
		EmailVerified *bool  `json:"email_verified"`
	}
	if err := idt.Claims(&claims); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "id_token claims unreadable"})
		return
	}
	if reason, allowed := authorizeIdentity(a.cfg.allowedEmails, idt.Subject, claims.Email, claims.EmailVerified); !allowed {
		log.Printf("bff: login DENIED for sub=%s: %s", idt.Subject, reason)
		writeJSON(w, http.StatusForbidden, map[string]string{
			"error": "authenticated, but not authorised: " + reason})
		return
	}

	// Rotate: any previous session this browser presented dies with the new
	// login — one live session per browser, and no fixation via a stale id.
	if old, err := r.Cookie(sessionCookieName); err == nil {
		a.auth.sessions.delete(old.Value)
	}
	sid, err := randomToken()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "entropy unavailable"})
		return
	}
	a.auth.sessions.put(sid, session{
		sub:     idt.Subject,
		email:   strings.ToLower(claims.Email),
		expires: time.Now().Add(a.cfg.sessionTTL),
	})
	setCookie(w, sessionCookieName, sid, int(a.cfg.sessionTTL.Seconds()))
	log.Printf("bff: session created for sub=%s", idt.Subject)
	http.Redirect(w, r, p.returnTo, http.StatusFound)
}

// authorizeIdentity is OUR authorization on top of the IdP's authentication.
// "*" delegates wholly to the issuer (any authenticated subject). Otherwise the
// identity must carry an email on the allowlist, and an email the issuer itself
// marks unverified never clears an email-keyed list. An absent email_verified
// claim is accepted: the issuer asserted the email and did not dispute it, and
// the issuer is the party the operator chose to trust.
func authorizeIdentity(allowed []string, sub, email string, verified *bool) (reason string, ok bool) {
	if len(allowed) == 1 && allowed[0] == "*" {
		if sub == "" {
			return "issuer returned an empty subject", false
		}
		return "", true
	}
	if email == "" {
		return "the id_token carries no email claim to match against OIDC_ALLOWED_EMAILS", false
	}
	if verified != nil && !*verified {
		return "the issuer marks this email as unverified", false
	}
	e := strings.ToLower(email)
	for _, a := range allowed {
		if a == e {
			return "", true
		}
	}
	return e + " is not in OIDC_ALLOWED_EMAILS", false
}

// handleLogout kills the session server-side and expires the cookie. POST only:
// SameSite=Lax withholds the session cookie from cross-site POSTs, so a foreign
// page cannot log the user out.
func (a *app) handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	if a.handleAuthUnavailable(w) {
		return
	}
	if ck, err := r.Cookie(sessionCookieName); err == nil {
		a.auth.sessions.delete(ck.Value)
	}
	clearCookie(w, sessionCookieName)
	w.WriteHeader(http.StatusNoContent)
}

// handleMe is the UI's one probe: always 200, reports the auth mode and — when
// authenticated — the identity. Never an error path, so the SPA can decide
// "show sign-in?" without special-casing statuses.
func (a *app) handleMe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	if a.cfg.authMode == authModeDisabled || a.auth == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"mode": authModeDisabled, "authenticated": false, "user": nil})
		return
	}
	if s, ok := a.auth.sessionFrom(r); ok {
		writeJSON(w, http.StatusOK, map[string]any{
			"mode": authModeOIDC, "authenticated": true,
			"user": map[string]string{"sub": s.sub, "email": s.email}})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"mode": authModeOIDC, "authenticated": false, "user": nil})
}

// requireSession gates every /api route. Disabled mode passes through — the
// loopback bind enforced at startup is the guard, as in inc2. Any other mode
// demands a valid session and answers 401 otherwise: an explicit refusal, never
// a silent empty result.
func (a *app) requireSession(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if a.cfg.authMode == authModeDisabled {
			next(w, r)
			return
		}
		if a.auth == nil {
			// Fail closed: a half-wired auth surface never serves data.
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication is not configured"})
			return
		}
		if _, ok := a.auth.sessionFrom(r); !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{
				"error": "authentication required — sign in at /auth/login"})
			return
		}
		next(w, r)
	}
}
