package main

import (
	"net/http"
	"net/url"
)

// docs_pins.go — B18.27: the Docs pages a person pinned, kept by talyvor-docs (B18.41) so they follow
// the person to another browser. Two routes of talyvor-docs internal/pin, for the SESSION's identity:
//
//	GET          /api/docs/pins                              → GET /v1/workspaces/{ws}/pins
//	PUT, DELETE  /api/docs/spaces/{spaceID}/pages/{pageID}/pin → the same on /v1/spaces/{s}/pages/{p}/pin
//
// Docs decides everything: the member is resolved from the verified identity (nothing is sent in a
// body), pinning needs View on the page, and the list is re-checked page by page, so a page the
// person can no longer open is not listed. Every answer passes through as Docs gave it.

func (a *app) docsPins() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		ws, ok := a.docsWorkspaceFor(w, r)
		if !ok {
			return
		}
		a.forwardProduct(w, r, "docs", a.cfg.docsBaseURL, a.cfg.docsGatewaySecret,
			docsWorkspacePath(ws, "/pins"), "", http.MethodGet, nil, nil)
	})
}

func (a *app) docsPagePin() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut && r.Method != http.MethodDelete {
			methodNotAllowed(w, "PUT, DELETE")
			return
		}
		spaceID, ok := pathID(w, "spaceID", r.PathValue("spaceID"))
		if !ok {
			return
		}
		pageID, ok := pathID(w, "pageID", r.PathValue("pageID"))
		if !ok {
			return
		}
		if _, ok := a.docsWorkspaceFor(w, r); !ok {
			return
		}
		a.forwardProduct(w, r, "docs", a.cfg.docsBaseURL, a.cfg.docsGatewaySecret,
			"/v1/spaces/"+url.PathEscape(spaceID)+"/pages/"+url.PathEscape(pageID)+"/pin", "", r.Method, nil, nil)
	})
}
