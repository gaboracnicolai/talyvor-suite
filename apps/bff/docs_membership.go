package main

import (
	"errors"
	"io"
	"log"
	"net/http"
)

// docs_membership.go — B27.15: whether the SESSION's person can read Docs yet, answered as 200
// {"member": bool} so the browser can ask without a request that fails.
//
//	GET /api/docs/membership → GET /v1/workspaces/{ws}/pins, read for its status only
//
// Docs learns a workspace's members from Track (the member-sync nudge at login, then Docs' own
// sweep), so a person who has just signed up is refused — 403 "not a member of this workspace" —
// until the roster arrives. The sidebar is on every screen and used to ask for pins straight away,
// so every page load inside that window logged a failed request. It now asks this first and reads
// pins only on {"member": true}.
//
// Docs' own pin list is the probe because it is the cheapest read gated on exactly the membership
// in question: Docs authorizes {ws} against the verified memberships before it reads anything.
// A refusal also nudges the roster sync again — idempotent upstream — so the wait is as short as
// Docs can make it rather than one sweep interval.
//
// A deployment with no Docs upstream answers {"member": false}: nobody can read Docs there, and
// that is not a fault. Anything other than 200 or 403 from Docs is still an error, as it was.
func (a *app) docsMembership() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		if a.cfg.docsBaseURL == "" {
			writeJSON(w, http.StatusOK, map[string]bool{"member": false})
			return
		}
		ws, ok := a.docsWorkspaceFor(w, r)
		if !ok {
			return
		}
		sess, ok := a.auth.sessionFrom(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{
				"error": "authentication required — sign in at /auth/login"})
			return
		}
		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet,
			a.cfg.docsBaseURL+docsWorkspacePath(ws, "/pins"), nil)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "docs upstream request"})
			return
		}
		req.Header.Set("Accept", "application/json")
		req.Header.Set("X-Gateway-Auth", a.cfg.docsGatewaySecret) // transit proof, server-side only
		req.Header.Set("X-User-Email", sess.email)                // the workspace-membership join key
		req.Header.Set("X-User-Id", sess.sub)
		req.Header.Set("X-Auth-Iss", a.cfg.oidcIssuer)
		resp, err := a.client.Do(req)
		if err != nil {
			log.Printf("bff: docs membership probe: %v", err)
			writeUpstreamFailure(w, "docs", err)
			return
		}
		defer resp.Body.Close()
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))

		switch resp.StatusCode {
		case http.StatusOK:
			writeJSON(w, http.StatusOK, map[string]bool{"member": true})
		case http.StatusForbidden:
			if derr := a.nudgeDocsMemberSync(r.Context(), ws); derr != nil && !errors.Is(derr, errDocsNotConfigured) {
				log.Printf("bff: docs member-sync nudge on refusal failed for sub=%s: %s",
					sess.sub, redactSecret(derr.Error()))
			}
			writeJSON(w, http.StatusOK, map[string]bool{"member": false})
		default:
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "docs upstream answered with an error"})
		}
	})
}
