package main

import (
	"net/http"
	"net/url"
)

// docs_export.go — B29.30: a person downloads a Docs page as HTML from the app.
//
//	GET /api/docs/spaces/{spaceID}/pages/{pageID}/export?format=html
//	  → GET /v1/spaces/{spaceID}/pages/{pageID}/export?format=html on talyvor-docs (internal/export)
//
// Docs does the work: it checks View on the page for the SESSION's identity, renders the page in
// the brand palette and names the file after the page's title (Content-Disposition, passed through
// by forwardProduct). Only HTML is offered here; any other format is refused before the dial.

// docsExportFormats are the formats this route asks Docs for.
var docsExportFormats = map[string]bool{"html": true}

func (a *app) docsExportPage() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
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
		format := r.URL.Query().Get("format")
		if !docsExportFormats[format] {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "format must be html"})
			return
		}
		if _, ok := a.docsWorkspaceFor(w, r); !ok {
			return
		}
		// The page is the person's own writing, served from the app's origin: it must never run
		// there, even if a browser is sent to this address directly rather than downloading it.
		w.Header().Set("Content-Security-Policy", "sandbox")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		a.forwardProduct(w, r, "docs", a.cfg.docsBaseURL, a.cfg.docsGatewaySecret,
			"/v1/spaces/"+url.PathEscape(spaceID)+"/pages/"+url.PathEscape(pageID)+"/export",
			"format="+url.QueryEscape(format), http.MethodGet, nil, nil)
	})
}
