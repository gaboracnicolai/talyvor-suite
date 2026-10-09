package main

// docs_collab.go — B28.447: a Docs page's live-edit socket, from the app.
//
//	GET /api/docs/collab/{pageID}/ws?client_id=&member_name= → GET /v1/collab/{pageID}/ws (WebSocket upgrade)
//
// A browser cannot put X-Gateway-Auth on a WebSocket, so the BFF attaches the transit proof and the SESSION's
// identity to the upgrade server-side, exactly as forwardProduct does, and then copies the socket both ways. Docs
// decides everything else: the page must be in the person's workspaces to open, and each change needs Edit. When the
// last socket on a page closes, Docs saves the page (B28.249).
//
// The upgrade is a GET, and ServeHTTP's write gate (sameOriginWriteAllowed) treats it as a write, so a page on another
// site cannot open a socket on the person's session. The browser's Origin, cookies and every other header stay on this
// side; Docs is sent the handshake and the four server-side headers only.

import (
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"time"
)

// docsCollabHandshake are the browser headers a WebSocket handshake needs; nothing else of the request goes upstream.
var docsCollabHandshake = []string{"Connection", "Upgrade", "Sec-Websocket-Key", "Sec-Websocket-Version", "Sec-Websocket-Extensions", "Sec-Websocket-Protocol"}

func (a *app) docsCollab() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		pageID, ok := pathID(w, "pageID", r.PathValue("pageID"))
		if !ok {
			return
		}
		if a.cfg.docsBaseURL == "" || a.auth == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "docs upstream not configured on this BFF"})
			return
		}
		sess, ok := a.auth.sessionFrom(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required — sign in at /auth/login"})
			return
		}
		if _, ok := a.docsWorkspaceFor(w, r); !ok {
			return
		}
		target, err := url.Parse(a.cfg.docsBaseURL + "/v1/collab/" + url.PathEscape(pageID) + "/ws")
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "docs upstream request"})
			return
		}
		q := url.Values{}
		q.Set("client_id", r.URL.Query().Get("client_id"))
		q.Set("member_name", r.URL.Query().Get("member_name"))
		target.RawQuery = q.Encode()

		proxy := &httputil.ReverseProxy{
			Rewrite: func(pr *httputil.ProxyRequest) {
				pr.Out.URL = target
				pr.Out.Host = target.Host
				h := http.Header{}
				for _, k := range docsCollabHandshake {
					if v := pr.Out.Header.Values(k); len(v) > 0 {
						h[k] = v
					}
				}
				h.Set("X-Gateway-Auth", a.cfg.docsGatewaySecret) // ← transit proof, server-side only
				h.Set("X-User-Email", sess.email)
				h.Set("X-User-Id", sess.sub)
				h.Set("X-Auth-Iss", a.cfg.oidcIssuer)
				pr.Out.Header = h
			},
			ErrorHandler: func(w http.ResponseWriter, _ *http.Request, err error) {
				log.Printf("bff: docs collab upstream: %v", err)
				writeUpstreamFailure(w, "docs", err)
			},
		}
		// The server's read and write timeouts would cut a socket that lives for as long as the page is open.
		rc := http.NewResponseController(w)
		_ = rc.SetReadDeadline(time.Time{})
		_ = rc.SetWriteDeadline(time.Time{})
		proxy.ServeHTTP(w, r)
	})
}
