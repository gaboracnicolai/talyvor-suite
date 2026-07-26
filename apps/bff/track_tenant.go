package main

// Per-session Track tenancy: each signed-in person gets their own Track workspace.
//
// Track's POST /v1/bootstrap has been merged and idempotent since talyvor-track #63, and
// nothing invoked it — the BFF pinned TRACK_WORKSPACE_ID from config, so once Lens went
// per-user every trial user would still have shared ONE Track and read each other's issues.
// A route that exists and is never called is the same shape as a guard that never runs.
//
// ── WHY TRACK'S FAILURE MODE DIFFERS FROM LENS'S ────────────────────────────
//
// The Lens provisioning in tenant.go is a HARD STOP: a failure fails the login, because Lens
// is the tenancy root and the only alternative — falling back to a shared workspace — is the
// exact defect that change removed. Track is not the root. It is one product of several, and
// the two rules below follow from that. They are enforced by tests, not by this comment
// (track_tenant_test.go).
//
//  1. A TRACK FAILURE MUST NOT FAIL LOGIN. Losing Lens, billing, keys and every other screen
//     because Track was briefly unreachable is strictly worse than signing in without a Track
//     workspace, where only /api/track/* is affected and says so.
//
//  2. THE FAILURE MUST NOT BE CACHED IN THE SESSION. Sessions live 12 hours. Recording "this
//     person has no Track workspace" and trusting it for the rest of the session would freeze
//     a two-second blip into a half-day outage. So a session without one RETRIES on demand —
//     which is only safe because Track's bootstrap is idempotent: the retry finds the existing
//     workspace rather than creating a second.
//
// ── WHY IT IS NOT A SECOND PINNED ID ────────────────────────────────────────
//
// The Track workspace is read from the SESSION, exactly as the Lens one is, and
// trackWorkspacePath is the only place a Track workspace path is assembled — the same shape
// tenant.go established for Lens, so there is one pattern here rather than two.
// TestConfigCarriesNoStartupWorkspaceIdentity now covers trackWorkspaceID as well, so a
// reintroduced pin fails the build.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
)

// trackBootstrapPath is Track's idempotent per-identity workspace route (talyvor-track #63).
//
// It is NOT under /v1/workspaces/: Track's authz middleware reads the third segment of
// /v1/workspaces/... as a {wsID} and checks it against the caller's memberships, so a caller
// who has no workspace yet — every caller this route exists for — would be 403'd before the
// handler ran.
const trackBootstrapPath = "/v1/bootstrap"

// trackBootstrapResult is Track's POST /v1/bootstrap response.
type trackBootstrapResult struct {
	WorkspaceID string `json:"workspace_id"`
	Slug        string `json:"slug"`
	Created     bool   `json:"created"`
}

// errTrackNotConfigured means this deployment has no Track upstream. Distinct from a failure:
// nothing is wrong, the product simply is not wired here.
var errTrackNotConfigured = errors.New("track upstream not configured on this BFF")

// bootstrapTrackWorkspace asks Track for this identity's workspace, creating it on first sight.
//
// It sends NO BODY and NO WORKSPACE ID. Track derives the workspace from the identity headers
// the gateway attaches, so there is no parameter through which this BFF — or anything that
// reaches it — could name a workspace. The transit proof goes with it, or Track 401s before
// reading any identity at all.
func (a *app) bootstrapTrackWorkspace(ctx context.Context, email, subject, issuer string) (string, error) {
	if a.cfg.trackBaseURL == "" {
		return "", errTrackNotConfigured
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.cfg.trackBaseURL+trackBootstrapPath, bytes.NewReader(nil))
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Gateway-Auth", a.cfg.trackGatewaySecret) // transit proof, server-side only
	req.Header.Set("X-User-Email", email)                      // the membership join key
	req.Header.Set("X-User-Id", subject)
	req.Header.Set("X-Auth-Iss", issuer)

	resp, err := a.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("track bootstrap: returned %d", resp.StatusCode)
	}
	var out trackBootstrapResult
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("track bootstrap: unreadable response: %w", err)
	}
	if out.WorkspaceID == "" {
		return "", errors.New("track bootstrap: no workspace returned")
	}
	return out.WorkspaceID, nil
}

// trackWorkspacePath is the ONLY place a Track workspace-scoped path is assembled. The
// workspace comes from the session; suffix is a fixed literal from the route table. A caller
// cannot pass a workspace id, because there is no parameter for one — the same property
// lensWorkspacePath gives the Lens side.
func trackWorkspacePath(trackWorkspaceID, suffix string) string {
	return "/v1/workspaces/" + trackWorkspaceID + suffix
}

// trackWorkspaceFor resolves the caller's Track workspace from the SESSION, retrying the
// bootstrap when the session has none.
//
// THE RETRY IS RULE 2. A session whose login-time bootstrap failed must not be stuck for the
// session's whole lifetime; it re-asks, and on success writes the answer back so later requests
// in the same session take the cheap path. Idempotence upstream is what makes re-asking safe.
//
// Returns ("", false) when Track is unreachable or unconfigured — the caller turns that into an
// honest 503 rather than addressing some other workspace.
func (a *app) trackWorkspaceFor(w http.ResponseWriter, r *http.Request) (string, bool) {
	if a.auth == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "track upstream requires oidc auth"})
		return "", false
	}
	sid, s, ok := a.auth.sessionAndIDFrom(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{
			"error": "authentication required — sign in at /auth/login"})
		return "", false
	}
	if s.trackWorkspaceID != "" {
		return s.trackWorkspaceID, true
	}

	ws, err := a.bootstrapTrackWorkspace(r.Context(), s.email, s.sub, a.cfg.oidcIssuer)
	if err != nil {
		if errors.Is(err, errTrackNotConfigured) {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{
				"error": "track upstream not configured on this BFF"})
			return "", false
		}
		// NOT written to the session: recording the failure is precisely what rule 2 forbids.
		log.Printf("bff: track bootstrap retry failed for sub=%s: %v", s.sub, err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "your Track workspace isn’t ready yet — Track could not be reached. " +
				"Nothing else is affected; try again shortly."})
		return "", false
	}
	s.trackWorkspaceID = ws
	a.auth.sessions.put(sid, s)
	return ws, true
}

// trackWorkspaceProxy is the Track equivalent of wsProxyFixed: a GET forwarded to a
// workspace-scoped Track path whose workspace comes from the session per request. Registration
// cannot bake an id, because registration never sees one.
func (a *app) trackWorkspaceProxy(suffix string, rawQuery func(*http.Request) string,
	transform func([]byte) ([]byte, error)) http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		ws, ok := a.trackWorkspaceFor(w, r)
		if !ok {
			return
		}
		q := ""
		if rawQuery != nil {
			q = rawQuery(r)
		}
		a.forwardProduct(w, r, "track", a.cfg.trackBaseURL, a.cfg.trackGatewaySecret,
			trackWorkspacePath(ws, suffix), q, http.MethodGet, nil, transform)
	})
}
