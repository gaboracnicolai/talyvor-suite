package main

import (
	"net/http"
	"net/url"
)

// track_workspaces.go — B18.53: deleting and restoring a Track workspace from the suite. Three
// routes of talyvor-track's internal/workspace/handler.go (B18.30), for the signed-in identity:
//
//	GET    /api/track/workspaces/deleted       → GET    /v1/workspaces?deleted=true
//	DELETE /api/track/workspaces/{id}          → DELETE /v1/workspaces/{id}          {"confirm": "<slug>"}
//	POST   /api/track/workspaces/{id}/restore  → POST   /v1/workspaces/{id}/restore
//
// The workspace id is the caller's to name — it is the one they chose on the settings screen, not
// the session's own — so Track decides: it checks membership and the OWNER role for this identity,
// refuses a delete whose "confirm" is not the workspace's slug (400 CONFIRMATION_REQUIRED), and
// lists only the deleted workspaces this identity owns. Every refusal passes through as Track said it.
//
// The delete body is forwarded verbatim, like the issue PATCH: it is one field Track validates
// against the slug, and re-encoding it here would be a second schema to drift from.

const maxWorkspaceDeleteBody = 1 << 10

func (a *app) trackDeletedWorkspaces() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		a.forwardProduct(w, r, "track", a.cfg.trackBaseURL, a.cfg.trackGatewaySecret,
			"/v1/workspaces", "deleted=true", http.MethodGet, nil, nil)
	})
}

func (a *app) trackDeleteWorkspace() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			methodNotAllowed(w, http.MethodDelete)
			return
		}
		id, ok := pathID(w, "id", r.PathValue("id"))
		if !ok {
			return
		}
		a.forwardProduct(w, r, "track", a.cfg.trackBaseURL, a.cfg.trackGatewaySecret,
			trackWorkspacePath(url.PathEscape(id), ""), "", http.MethodDelete,
			http.MaxBytesReader(w, r.Body, maxWorkspaceDeleteBody), nil)
	})
}

func (a *app) trackRestoreWorkspace() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodPost)
			return
		}
		id, ok := pathID(w, "id", r.PathValue("id"))
		if !ok {
			return
		}
		a.forwardProduct(w, r, "track", a.cfg.trackBaseURL, a.cfg.trackGatewaySecret,
			trackWorkspacePath(url.PathEscape(id), "/restore"), "", http.MethodPost, nil, nil)
	})
}
