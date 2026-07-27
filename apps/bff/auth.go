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
	"errors"
	"fmt"
	"html/template"
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

	// The tenant this person is, resolved ONCE at login by Lens's POST /v1/provision and cached
	// here SERVER-SIDE. The token never reaches the browser: the cookie carries only an opaque
	// session id, and these fields live in the BFF's own session map.
	workspaceID  string
	lensToken    string
	lensTokenExp time.Time

	// cachePoolable is the consent Lens RECORDED for this workspace (not what was requested).
	// needsPoolingChoice is true only for a workspace this login just created — the one moment
	// the pooling question is put to the person.
	cachePoolable      bool
	needsPoolingChoice bool

	// trackWorkspaceID is this person's Track workspace, resolved at login by Track's
	// idempotent POST /v1/bootstrap. EMPTY IS A VALID STATE, not an error: a Track failure
	// must not fail login, and the emptiness must not be trusted for the session's lifetime —
	// trackWorkspaceFor re-asks. See track_tenant.go for both rules.
	trackWorkspaceID string
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

// sessionAndIDFrom is sessionFrom plus the session id, for callers that must write the session
// back (the pooling choice).
func (auth *authenticator) sessionAndIDFrom(r *http.Request) (string, session, bool) {
	ck, err := r.Cookie(sessionCookieName)
	if err != nil || ck.Value == "" {
		return "", session{}, false
	}
	s, ok := auth.sessions.get(ck.Value)
	return ck.Value, s, ok
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
	opts := []oauth2.AuthCodeOption{oauth2.S256ChallengeOption(verifier), oidc.Nonce(nonce)}
	// The denied page's "sign in with a different account" restart. Gated to this
	// ONE literal — arbitrary client input never reaches the IdP URL. Standard
	// OIDC prompt value; providers that don't support it ignore it harmlessly.
	if r.URL.Query().Get("prompt") == "select_account" {
		opts = append(opts, oauth2.SetAuthURLParam("prompt", "select_account"))
	}
	http.Redirect(w, r, a.auth.oauth.AuthCodeURL(state, opts...), http.StatusFound)
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
		// The precise cause goes to the LOG ONLY. The human gets the uniform
		// denied page: their identity echoed (authentication worked), the
		// refusal, the way forward — and nothing that distinguishes WHY.
		//
		// THE LOG LINE IS AN OPERATOR SURFACE and its job is to make admitting the
		// person a copy-paste. So it leads with the ADDRESS: OIDC_ALLOWED_EMAILS is
		// keyed on email, and an operator holding only `sub=1180024…` has nothing
		// they can act on — they would have to decode an id_token they never see to
		// find the one string the variable actually takes. It was the subject alone
		// before, for every refusal cause; the address only ever appeared as an
		// accident of one reason string's wording, and the two causes that name no
		// address (unverified email, absent claim) named nothing at all.
		//
		// ABSENT IS ITS OWN WORD. An identity with no email claim must not render as
		// `email=` — a blank field reads as a display bug, and "no address was sent"
		// and "the address is not on the list" are different problems with different
		// fixes. emailForLog says which one it is.
		//
		// THE REMEDY TRAVELS WITH IT, because the fix is not only "edit the variable":
		// config is read once at boot, so an operator who adds the address and waits
		// watches nothing happen. A line that names the variable but not the restart
		// sends someone to do half a fix and conclude the product is broken.
		log.Printf("bff: login DENIED — email=%s sub=%s reason=%s | to admit them, add that "+
			"address to OIDC_ALLOWED_EMAILS and RESTART the BFF (config is read at boot); "+
			"or set OIDC_ALLOWED_EMAILS=* to admit every identity this issuer authenticates",
			emailForLog(claims.Email), idt.Subject, reason)
		writeDeniedPage(w, claims.Email)
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
	// PROVISION: turn this identity into a tenant before the session exists. The workspace id is
	// derived by LENS from the identity we present — the BFF never names a workspace, so no bug
	// here can aim at another tenant. A provisioning failure is a hard stop: falling back to a
	// shared workspace is the exact state this replaced, so there is no fallback path at all.
	prov, perr := a.provisionForSession(ctx, provisionIdentity(a.cfg.oidcIssuer, idt.Subject))
	if perr != nil {
		log.Printf("bff: provisioning FAILED for sub=%s: %s", idt.Subject, redactSecret(perr.Error()))
		writeJSON(w, http.StatusBadGateway, map[string]string{
			"error": "could not provision your workspace — try again shortly"})
		return
	}
	// TRACK: bootstrap this identity's Track workspace too. Deliberately NOT a hard stop,
	// unlike the Lens provisioning above — Lens is the tenancy root, Track is one product of
	// several, and a Track blip taking out Lens access is worse than no Track workspace. An
	// empty result is stored as empty and re-asked on first use, never treated as settled.
	trackWS, terr := a.bootstrapTrackWorkspace(ctx, strings.ToLower(claims.Email), idt.Subject, a.cfg.oidcIssuer)
	if terr != nil && !errors.Is(terr, errTrackNotConfigured) {
		log.Printf("bff: track bootstrap FAILED for sub=%s (login continues): %s",
			idt.Subject, redactSecret(terr.Error()))
	}
	// DOCS: ask Docs to read this workspace's roster from Track NOW, rather than on its next
	// periodic sweep. Without this, a person who signs up and goes straight to Docs finds their
	// own workspace refusing writes for as long as the sweep interval — the workspace exists and
	// Docs can see it, but Docs has not read the membership yet.
	//
	// BEST-EFFORT, and even less negotiable than the Track bootstrap above: Docs' own sweep is
	// the backstop, so a failure here costs minutes of latency on ONE product, and failing the
	// login over that would take out Lens, billing, keys and Track as well. Nothing is recorded
	// in the session — see docs_membersync.go, rule 2.
	if trackWS != "" {
		if derr := a.nudgeDocsMemberSync(ctx, trackWS); derr != nil && !errors.Is(derr, errDocsNotConfigured) {
			log.Printf("bff: docs member-sync nudge failed for sub=%s (login continues; Docs' own "+
				"sweep will reconcile within its interval): %s", idt.Subject, redactSecret(derr.Error()))
		}
	}

	a.auth.sessions.put(sid, session{
		sub:     idt.Subject,
		email:   strings.ToLower(claims.Email),
		expires: time.Now().Add(a.cfg.sessionTTL),

		workspaceID:  prov.WorkspaceID,
		lensToken:    prov.Token,
		lensTokenExp: parseExpiry(prov.ExpiresAt),

		trackWorkspaceID: trackWS,

		cachePoolable: prov.CachePoolable,
		// Ask the pooling question exactly once: on the login that CREATED the workspace.
		needsPoolingChoice: prov.Created,
	})
	setCookie(w, sessionCookieName, sid, int(a.cfg.sessionTTL.Seconds()))
	log.Printf("bff: session created for sub=%s", idt.Subject)
	http.Redirect(w, r, p.returnTo, http.StatusFound)
}

// deniedPageTmpl is the ENTIRE first impression for an authenticated-but-unauthorised identity —
// the second trial user's whole experience when the operator forgot to extend the allowlist. It is
// served BY THE BFF, mid-redirect from the IdP, because no alternative works without weakening
// something: the SPA cannot know WHO was refused (no session exists — that is the security
// property), a query-string echo would put the identity in histories and logs, and a cookie is
// exactly what a refusal must not set. Self-contained (inline style, no assets): it must render
// even when the web bundle was never built.
//
// SAYS, in order: you are signed in as <identity> (the login WORKED; this is authorisation, not a
// broken password) → this workspace has not granted you access → contact whoever runs it (there is
// no self-service path; pretending otherwise would be worse) → sign in with a different account.
//
// LEAKS NOTHING: no allowlist name, size, membership, or refusal cause. Every refusal cause —
// not-on-list, empty list, issuer-unverified email — renders this same page, so a refused
// stranger learns only that they were refused. The precise cause stays in the server log.
var deniedPageTmpl = template.Must(template.New("denied").Parse(`<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Access not granted — Talyvor</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif;
         background: #fafaf9; color: #1c1917; }
  @media (prefers-color-scheme: dark) { body { background: #131110; color: #e7e5e4; } }
  main { max-width: 26rem; padding: 2.5rem 1.5rem; }
  h1 { font-size: 1.25rem; margin: 0 0 1rem; letter-spacing: -0.01em; }
  p { margin: 0 0 0.85rem; }
  .muted { opacity: 0.72; }
  strong { font-weight: 600; overflow-wrap: anywhere; }
  a.switch { display: inline-block; margin-top: 1rem; padding: 0.55rem 1rem;
             border: 1px solid currentColor; border-radius: 0.5rem;
             color: inherit; text-decoration: none; font-weight: 500; }
</style>
<main>
  <h1>Access not granted</h1>
  {{if .Email}}<p>You are signed in as <strong>{{.Email}}</strong> — the sign-in itself worked.</p>
  {{else}}<p>Your sign-in itself worked.</p>{{end}}
  <p>This workspace has not granted you access.</p>
  <p class="muted">If you believe you should have access, contact the person who runs this
  workspace and ask them to add you. There is no self-service signup.</p>
  <a class="switch" href="/auth/login?prompt=select_account">Sign in with a different account</a>
</main>
</html>
`))

// writeDeniedPage renders the refusal. 403 stays 403 — the page is for the human, the status for
// the tooling. No session was created and none of this response's headers may set one (the only
// Set-Cookie a refusal carries is the pending-flow CLEAR the callback already wrote). no-store:
// a shared machine must not cache someone else's identity echo.
func writeDeniedPage(w http.ResponseWriter, email string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusForbidden)
	if err := deniedPageTmpl.Execute(w, struct{ Email string }{Email: email}); err != nil {
		log.Printf("bff: denied page render: %v", err)
	}
}

// signupIsOpen reports whether a person NOBODY HAS ADDED can complete signup on this
// deployment — i.e. whether the allowlist delegates wholly to the issuer.
//
// It is the same predicate authorizeIdentity gates on, and authorizeIdentity calls it
// rather than repeating it. That is deliberate: this one bit is now also rendered as
// PROSE on the marketing and signup pages ("anyone can start" vs "access is by
// invitation"), and a page whose sentence is computed from a second, parallel copy of
// the rule is a page that will eventually contradict the door it describes. One
// predicate, two readers.
func signupIsOpen(allowed []string) bool {
	return len(allowed) == 1 && allowed[0] == "*"
}

// emailForLog renders an address for the operator-facing refusal log, with an explicit
// WORD for absence. A missing claim must never print as an empty field: `email=` reads
// as a broken log line, and it collapses "the issuer sent no address" into the same
// visual as "the address is not listed" — two different faults with two different fixes.
func emailForLog(email string) string {
	if strings.TrimSpace(email) == "" {
		return "(none — the id_token carried no email claim)"
	}
	return email
}

// authorizeIdentity is OUR authorization on top of the IdP's authentication.
// "*" delegates wholly to the issuer (any authenticated subject). Otherwise the
// identity must carry an email on the allowlist, and an email the issuer itself
// marks unverified never clears an email-keyed list. An absent email_verified
// claim is accepted: the issuer asserted the email and did not dispute it, and
// the issuer is the party the operator chose to trust.
func authorizeIdentity(allowed []string, sub, email string, verified *bool) (reason string, ok bool) {
	if signupIsOpen(allowed) {
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
	// The address itself is NOT repeated here: handleCallback logs it as its own `email=`
	// field, and a line that prints it twice is a line an operator has to read twice to be
	// sure they are looking at one refusal and not two.
	return "the address is not on OIDC_ALLOWED_EMAILS", false
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
			"mode": authModeDisabled, "authenticated": false, "user": nil,
			// Loopback dev has no gate at all, so nothing is turned away.
			"signup_open": true})
		return
	}
	if s, ok := a.auth.sessionFrom(r); ok {
		// workspace_id is this person's OWN derived id — safe to show, and useful when two
		// people compare screens. The token is never included: it stays server-side.
		writeJSON(w, http.StatusOK, map[string]any{
			"mode": authModeOIDC, "authenticated": true,
			"user":                 map[string]string{"sub": s.sub, "email": s.email},
			"workspace_id":         s.workspaceID,
			"cache_poolable":       s.cachePoolable,
			"needs_pooling_choice": s.needsPoolingChoice,
			// Whether THIS deployment's Docs is one workspace shared by everyone. Derived from
			// the BFF's OWN config, never hardcoded: docsWorkspaceID is the pin, and when Docs
			// gains its own tenancy root that field goes the way trackWorkspaceID just did — the
			// field stops compiling, the notice stops rendering, and the copy cannot outlive the
			// fact it describes. docsBaseURL is required too: with no Docs upstream there is no
			"signup_open": signupIsOpen(a.cfg.allowedEmails),
		})
		return
	}
	// THE UNAUTHENTICATED ANSWER IS THE IMPORTANT ONE. Everyone who needs signup_open is by
	// definition not signed in: the marketing hero and the signup page have to tell a stranger,
	// before any login, whether they can actually get in.
	//
	// Hardcoding that sentence in the bundle is how a page comes to read "closed trial, accounts
	// set up by hand" for a month after the trial opened — or, far worse, "get started free"
	// while the gate is still six addresses, which sends every visitor into a refusal. A status
	// claim written in a static file reads as CURRENT to whoever is looking at it, and nothing
	// makes it false when the world moves.
	//
	// So the fact is served from the gate itself and the page renders the server's answer. It is
	// ONE BIT — whether the door is open — never who is behind it: no address, no count. A
	// stranger learns exactly what they would learn by trying the door, which is what they are
	// about to do anyway.
	writeJSON(w, http.StatusOK, map[string]any{
		"mode": authModeOIDC, "authenticated": false, "user": nil,
		"signup_open": signupIsOpen(a.cfg.allowedEmails)})
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
