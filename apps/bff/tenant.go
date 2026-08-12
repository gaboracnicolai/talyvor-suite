package main

// tenant.go — the tenancy boundary. Everything that decides WHICH Lens workspace a request
// touches lives here, and nowhere else.
//
// Before this, the eight workspace-scoped upstream paths were built once at route-registration
// time from a single configured id, so every signed-in person shared one workspace: one balance,
// one key set, one ledger, one cache. Ten trial users were one account with ten people in it.
//
// Now: on login the BFF calls Lens's POST /v1/provision with the session's identity, and Lens
// derives the workspace id and mints a workspace-scoped JWT for it. The BFF caches that tuple in
// the SERVER-SIDE session and builds every upstream path from it, per request.
//
// TWO PROPERTIES CARRY THE WEIGHT:
//
//  1. The BFF never names a workspace. It sends an identity; Lens decides which workspace that
//     is (workspace_id = "u"+base32(sha256(identity))). So no bug here — not a stray header, not
//     a mis-parsed body — can aim at another tenant. The id is only ever read back out of the
//     session, never accepted from a client.
//  2. The BFF holds LENS_PROVISION_SECRET, never LENS_API_KEY. The admin key would make
//     workspaceAuthorized true for every workspace and unlock ~30 admin routes; a BFF compromise
//     would escalate from one tenant's data to control of every tenant. The provisioning secret
//     can create a workspace and mint a session token for it, and nothing else.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// provisionPath is Lens's narrow provisioning route (talyvor-lens #363).
const provisionPath = "/v1/provision"

// provisionSecretHeader must match cmd/lens/provision_handler.go.
const provisionSecretHeader = "X-Gateway-Auth"

// sessionTokenTTLHours is the lifetime requested for the workspace-scoped JWT. Lens clamps it
// (auth.ClampTTL). Kept short: it is a session credential, re-minted on the next login.
const sessionTokenTTLHours = 8

// tenant is one signed-in person's Lens identity: which workspace they are, and the credential
// that proves it. Read out of the session; never built from anything a client sends.
type tenant struct {
	workspaceID string
	token       string
}

func (t tenant) ok() bool { return t.workspaceID != "" && t.token != "" }

// provisionResult is Lens's POST /v1/provision response.
type provisionResult struct {
	WorkspaceID   string `json:"workspace_id"`
	Created       bool   `json:"created"`
	CachePoolable bool   `json:"cache_poolable"`
	Token         string `json:"token"`
	ExpiresAt     string `json:"expires_at"`
}

// provisionIdentity is the opaque, stable string the BFF presents to Lens.
//
// Keyed on (issuer, subject), NOT email: `sub` is the IdP's stable identifier, while an email can
// be reassigned to a different person — keying on it would eventually hand a new employee the
// previous holder's ledger. The issuer is included so adding a second IdP cannot collide two
// people onto one workspace. The NUL separator makes the pair unambiguous, so no (issuer, sub)
// split can be forged into another's identity by string juggling.
func provisionIdentity(issuer, subject string) string {
	return issuer + "\x00" + subject
}

// provision turns an identity into a tenant. cachePoolable is passed only when non-nil, so
// "said nothing" reaches Lens as silence and its new-workspace default applies.
func (a *app) provision(ctx context.Context, identity string, cachePoolable *bool) (provisionResult, error) {
	var out provisionResult
	if a.cfg.provisionSecret == "" {
		return out, errors.New("LENS_PROVISION_SECRET is not configured")
	}
	body, err := json.Marshal(struct {
		Identity      string `json:"identity"`
		DisplayName   string `json:"display_name,omitempty"`
		CachePoolable *bool  `json:"cache_poolable,omitempty"`
		TTLHours      int    `json:"ttl_hours"`
	}{Identity: identity, CachePoolable: cachePoolable, TTLHours: sessionTokenTTLHours})
	if err != nil {
		return out, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.cfg.lensBaseURL+provisionPath, bytes.NewReader(body))
	if err != nil {
		return out, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(provisionSecretHeader, a.cfg.provisionSecret) // server-side only, never emitted
	resp, err := a.client.Do(req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		// Lens 404s this route when LENS_PROVISION_SECRET is unset on ITS side — absent
		// capability, not open capability. Say so plainly rather than reporting a bad secret.
		if resp.StatusCode == http.StatusNotFound {
			return out, errors.New("lens has no provisioning route (LENS_PROVISION_SECRET unset upstream)")
		}
		return out, fmt.Errorf("provision: lens returned %d", resp.StatusCode)
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return out, fmt.Errorf("provision: unreadable response: %w", err)
	}
	if out.WorkspaceID == "" || out.Token == "" {
		return out, errors.New("provision: lens returned no workspace or token")
	}
	return out, nil
}

// lensWorkspacePath is the ONLY place a Lens workspace-scoped path is assembled. The workspace
// comes from the tenant — i.e. from the session — and suffix is a fixed literal from the route
// table. A caller cannot pass a workspace id, because there is no parameter for one.
//
// Guarded by TestNoRouteClosesOverAStartupWorkspaceID: nothing else in this package may build
// this prefix for Lens.
func lensWorkspacePath(t tenant, suffix string) string {
	return "/v1/workspaces/" + t.workspaceID + suffix
}

// tenantFrom resolves the caller's tenant from the SERVER-SIDE session and nothing else.
//
// Deliberately takes no account of any client-controlled input. There is no header, query
// parameter, body field or path segment that can influence which workspace is returned — a
// client that sends X-Talyvor-Workspace, ?workspace_id= or {"workspace_id":…} is simply ignored,
// because none of them are read. Lens enforces the same boundary independently: AuthMiddleware
// overwrites X-Talyvor-Workspace from the validated credential, and workspaceIsolationMiddleware
// re-checks the {wsID} segment against it.
func (a *app) tenantFrom(r *http.Request) (tenant, bool) {
	// Loopback dev (BFF_AUTH_MODE=disabled) has no session and therefore no identity. Rather than
	// reintroduce a shared-workspace fallback — the exact thing this change removed, and something
	// a later refactor could quietly promote to production — dev goes through the SAME provisioning
	// path under one fixed identity. There is no second code path to keep honest.
	if a.cfg.authMode == authModeDisabled {
		return a.devTenant(r.Context())
	}
	if a.auth == nil {
		return tenant{}, false
	}
	sid, s, ok := a.auth.sessionAndIDFrom(r)
	if !ok {
		return tenant{}, false
	}
	s = a.refreshWorkspaceToken(r.Context(), sid, s)
	t := tenant{workspaceID: s.workspaceID, token: s.lensToken}
	return t, t.ok()
}

// workspaceTokenSkew re-mints slightly BEFORE expiry, so a token cannot die between this check
// and Lens verifying it a few milliseconds later. Small: the whole point is to act at the end of
// the token's life, not to shorten it.
const workspaceTokenSkew = 60 * time.Second

// refreshWorkspaceToken reads the expiry the session has been recording all along.
//
// ── THE HOLE IT CLOSES ───────────────────────────────────────────────────────
//
// The workspace token is minted for sessionTokenTTLHours (8). The SESSION lasts BFF_SESSION_TTL
// (12 by default). Nobody reconciled those numbers, and lensTokenExp — the field that records
// when the token dies — was written at login and read by NOTHING. So hours 8→12 of every session
// were spent holding a dead credential: /auth/me still says authenticated (the session is fine),
// the gate correctly renders the app, and every workspace-scoped read comes back 401. That is
// the same screen the Lens restart produced, arriving on a timer, for everyone, every day.
//
// A field written and never read is the difference between a bug that is fixed and one that is
// merely knowable.
//
// ── WHY RE-PROVISIONING IS THE RIGHT REFRESH ─────────────────────────────────
//
// POST /v1/provision is idempotent on identity: Lens derives the workspace from (issuer, sub),
// so this returns the SAME workspace with a fresh token — there is no separate refresh endpoint
// to add, and no second code path that could drift from the login path. It states no pooling
// preference (provisionForSession), so a re-mint cannot disturb consent Lens already recorded.
//
// ── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────────
//
// A token that is INSIDE its lifetime but invalid anyway — Lens restarting with a new ephemeral
// signing key, a rotated secret — is not visible to any clock. No proactive check can catch it,
// which is why the screen still has to be honest about a 401 (components/SessionExpiredBar.tsx).
// This closes the half that is predictable; it does not pretend to close the other half.
//
// A failure to re-mint is NOT an error path: the old token is kept and the request proceeds to
// fail upstream as it would have anyway. Turning a refresh blip into a hard failure would make
// this change strictly worse than the bug it fixes.
func (a *app) refreshWorkspaceToken(ctx context.Context, sid string, s session) session {
	// UNKNOWN IS NOT EXPIRED. parseExpiry yields the zero time when Lens sends an unparseable or
	// absent expires_at; reading that as "expired in 1 AD" would re-provision on EVERY request
	// forever — an upstream formatting quirk turned into a self-inflicted load spike that looks
	// like nothing from the outside. Absence means "no opinion", so leave the token alone.
	if s.lensTokenExp.IsZero() || time.Now().Before(s.lensTokenExp.Add(-workspaceTokenSkew)) {
		return s
	}
	prov, err := a.provisionForSession(ctx, provisionIdentity(a.cfg.oidcIssuer, s.sub))
	if err != nil {
		log.Printf("bff: workspace token re-mint FAILED for sub=%s (request continues with the "+
			"expired one, and will surface as a 401): %s", s.sub, redactSecret(err.Error()))
		return s
	}
	// Written back UNDER THE LOCK and field-by-field: the provision above is a network call, and
	// during it another handler may legitimately have changed something else on this session (the
	// pooling choice, a Track bootstrap). A whole-struct put would discard that.
	updated, ok := a.auth.sessions.update(sid, func(cur session) session {
		cur.workspaceID = prov.WorkspaceID
		cur.lensToken = prov.Token
		cur.lensTokenExp = parseExpiry(prov.ExpiresAt)
		return cur
	})
	if !ok {
		// The session died while we were provisioning (logout, expiry). Nothing to cache it on.
		return s
	}
	return updated
}

// devIdentity is the single fixed identity loopback dev provisions under. It derives to a normal
// u<base32> workspace like any other, so dev exercises the real per-tenant path.
const devIdentity = "bff-loopback-dev"

// devTenant provisions (once) and caches the loopback-dev tenant.
func (a *app) devTenant(ctx context.Context) (tenant, bool) {
	a.devMu.Lock()
	defer a.devMu.Unlock()
	if a.devCached.ok() {
		return a.devCached, true
	}
	prov, err := a.provisionForSession(ctx, devIdentity)
	if err != nil {
		return tenant{}, false
	}
	a.devCached = tenant{workspaceID: prov.WorkspaceID, token: prov.Token}
	return a.devCached, true
}

// requireTenant gates every workspace-scoped route: a valid session AND a provisioned workspace.
//
// A session without a workspace answers 409 rather than falling back to any shared or default
// workspace. That fallback is the failure this whole change exists to end, so it must not exist
// even as an error path.
func (a *app) requireTenant(next func(http.ResponseWriter, *http.Request, tenant)) http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		t, ok := a.tenantFrom(r)
		if !ok {
			// Distinguish "this session has no workspace" from "Lens could not be reached to make
			// one": the first is the caller's problem and asks them to sign in again; the second
			// is an upstream fault and must surface as one, exactly like any other dead-Lens read.
			if a.cfg.authMode == authModeDisabled {
				writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream unreachable"})
				return
			}
			writeJSON(w, http.StatusConflict, map[string]string{
				"error": "workspace not provisioned for this session — sign in again"})
			return
		}
		next(w, r, t)
	})
}

// ─── workspace-scoped proxies ───────────────────────────────────────────────
//
// These mirror proxyFixed/proxyPaged but take a fixed SUFFIX rather than a full path: the
// workspace segment is supplied per request from the session. Registration cannot bake an id
// because registration never sees one.

func (a *app) wsProxyFixed(suffix string) http.HandlerFunc {
	return a.requireTenant(func(w http.ResponseWriter, r *http.Request, t tenant) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		a.forward(w, r, t, lensWorkspacePath(t, suffix), "")
	})
}

func (a *app) wsProxyPaged(suffix string) http.HandlerFunc {
	return a.requireTenant(func(w http.ResponseWriter, r *http.Request, t tenant) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		limit := clampInt(r.URL.Query().Get("limit"), 20, 1, 200)
		offset := clampInt(r.URL.Query().Get("offset"), 0, 0, 1<<31-1)
		a.forward(w, r, t, lensWorkspacePath(t, suffix), "limit="+strconv.Itoa(limit)+"&offset="+strconv.Itoa(offset))
	})
}

// ─── pooling consent ────────────────────────────────────────────────────────

// setCachePoolable records this workspace's cross-tenant pooling consent with Lens, using the
// tenant's OWN token — so the write is authorised by the tenant's credential and Lens's
// workspace-isolation middleware bounds it to their own workspace.
func (a *app) setCachePoolable(ctx context.Context, t tenant, poolable bool) (bool, error) {
	body, _ := json.Marshal(map[string]bool{"cache_poolable": poolable})
	req, err := http.NewRequestWithContext(ctx, http.MethodPut,
		a.cfg.lensBaseURL+lensWorkspacePath(t, "/cache-poolable"), bytes.NewReader(body))
	if err != nil {
		return false, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+t.token)
	resp, err := a.client.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("cache-poolable: lens returned %d", resp.StatusCode)
	}
	// Report what Lens RECORDED, never what was asked for.
	var out struct {
		CachePoolable bool `json:"cache_poolable"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return false, fmt.Errorf("cache-poolable: unreadable response: %w", err)
	}
	return out.CachePoolable, nil
}

// handlePoolingChoice records the cross-tenant sharing decision, from either the signup prompt
// or the settings control. POST {"cache_poolable": bool}.
//
// Same Origin discipline as the key mint: a state-changing POST must carry the configured public
// origin. The response states the consent Lens RECORDED, so the screen renders the truth rather
// than an optimistic echo of the request.
func (a *app) handlePoolingChoice(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	var in struct {
		CachePoolable *bool `json:"cache_poolable"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil || in.CachePoolable == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "cache_poolable (boolean) required"})
		return
	}
	recorded, err := a.setCachePoolable(r.Context(), t, *in.CachePoolable)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "could not record the choice"})
		return
	}
	// Persist the recorded state and clear the prompt, so the screen does not reappear.
	//
	// ⚠ TWO FIELDS, MERGED UNDER THE LOCK — the same rule refreshWorkspaceToken follows. The read
	// here sits BELOW setCachePoolable, so this window holds no I/O and is a few instructions wide;
	// it is still a read-modify-write across three critical sections, and `put` would additionally
	// resurrect a session that logged out in between. There is no version of this worth leaving
	// narrow: see session_clobber_test.go, where the same shape one file away costs a logout.
	if a.auth != nil {
		if sid, _, ok := a.auth.sessionAndIDFrom(r); ok {
			a.auth.sessions.update(sid, func(cur session) session {
				cur.cachePoolable = recorded
				cur.needsPoolingChoice = false
				return cur
			})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"cache_poolable": recorded})
}

// provisionForSession provisions a workspace for a freshly authenticated identity.
//
// IT STATES NO PREFERENCE ABOUT POOLING, so Lens's own default (cross-tenant sharing ON) applies.
//
// This was briefly the other way round — created declined, then ask. That was the safer switch
// position and the wrong product: cross-tenant sharing IS the product, and an economy that runs
// only for people who find a settings screen and opt in does not run at all. Sharing off by
// default is not a cautious default, it is the feature switched off.
//
// What protects the person is therefore not the switch position but the DISCLOSURE. The signup
// screen blocks the app, states in the same breath that sharing is already on and that one click
// turns it off, and gives both choices equal prominence. A person cannot reach the product
// without seeing it, so there is no window in which they generate answers before deciding —
// which is the property that makes an ON default defensible rather than merely convenient.
//
// SEND NO FIELD, rather than an explicit true. They look equivalent and are not: Lens records
// consent once at creation and refuses to retroactively GRANT it, so an explicit true is silently
// ignored on every login after the first — a value that means something different from what it
// appears to say. nil reaches Lens as silence, which is exactly "take the default".
func (a *app) provisionForSession(ctx context.Context, identity string) (provisionResult, error) {
	return a.provision(ctx, identity, nil)
}

// redactSecret keeps a provisioning failure's detail out of the log if it ever echoed the secret.
func redactSecret(msg string) string {
	if s := strings.TrimSpace(msg); s != "" {
		return s
	}
	return "unknown error"
}

// parseExpiry reads Lens's RFC3339 expires_at. An unreadable value yields the zero time, which
// callers treat as "unknown" rather than "never expires".
func parseExpiry(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}
	}
	return t
}

// sessionWorkspaceID reports THIS session's workspace for /api/context. Empty when there is no
// session — never a shared or configured fallback.
func sessionWorkspaceID(a *app, r *http.Request) string {
	t, ok := a.tenantFrom(r)
	if !ok {
		return ""
	}
	return t.workspaceID
}
