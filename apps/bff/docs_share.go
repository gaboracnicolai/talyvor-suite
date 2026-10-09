package main

// docs_share.go — B28.447: a Docs page shared as a link, read by anyone who has it, signed out.
//
//	POST /api/docs/spaces/{spaceID}/pages/{pageID}/share → POST /v1/spaces/{s}/pages/{p}/share   {"access":"view"}
//	GET  /api/public/docs/{token}                        → GET  /v1/public/s/{token}             NO SESSION
//	GET  /docs/s/{token}                                 the page a stranger opens: the app, answered 404 for a link Docs refuses
//
// Docs decides everything: making a link needs Admin on the page, and the token is the whole credential — a nonce
// and its HMAC (talyvor-docs internal/sharing, B28.249), so a link with any character changed is refused exactly as
// an unknown one is. The app makes view-only links; the client never chooses the access.

import (
	"context"
	"errors"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
)

// docsShareToken is the shape of a token Docs mints (s1_<hex>.<base64url>, or an older bare one), checked before any
// dial so a path segment can never rewrite the upstream path.
func docsShareToken(t string) bool {
	if len(t) < 16 || len(t) > 128 || strings.Contains(t, "..") {
		return false
	}
	for _, c := range t {
		if !tokenRune(c) && c != '.' {
			return false
		}
	}
	return true
}

func (a *app) docsSharePageLink() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodPost)
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
			"/v1/spaces/"+url.PathEscape(spaceID)+"/pages/"+url.PathEscape(pageID)+"/share",
			"", http.MethodPost, strings.NewReader(`{"access":"view"}`), nil)
	})
}

// publicDocsShare — GET /api/public/docs/{token}, for a stranger. It carries nothing of the BFF's to Docs: no
// transit proof, no identity (Docs exempts /v1/public/* from both).
func (a *app) publicDocsShare() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		token := r.PathValue("token")
		if !docsShareToken(token) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "link not found"})
			return
		}
		resp, err := a.readDocsShare(r.Context(), token)
		if err != nil {
			writeUpstreamFailure(w, "docs", err)
			return
		}
		defer func() { _ = resp.Body.Close() }()
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, io.LimitReader(resp.Body, maxDocsBody))
	}
}

// readDocsShare asks Docs for a shared page with no credential. A failure is logged by its cause only: the URL holds
// the token.
func (a *app) readDocsShare(ctx context.Context, token string) (*http.Response, error) {
	if a.cfg.docsBaseURL == "" {
		return nil, errors.New("docs upstream not configured on this BFF")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.cfg.docsBaseURL+"/v1/public/s/"+url.PathEscape(token), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := a.client.Do(req)
	if err != nil {
		cause := err
		var ue *url.Error
		if errors.As(err, &ue) {
			cause = ue.Err
		}
		log.Printf("bff: public docs share: %v", cause)
		return nil, cause
	}
	return resp, nil
}

// docsSharePage — GET /docs/s/{token}: the app, whose page reads the shared page. A link Docs refuses — changed,
// unknown, expired — is answered 404 with the same page, which says so. When Docs cannot be asked, the page is served
// as any other and says it could not read the page.
func (a *app) docsSharePage() http.Handler {
	spa := a.spaHandler()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			methodNotAllowed(w, http.MethodGet+", "+http.MethodHead)
			return
		}
		gone := !docsShareToken(r.PathValue("token"))
		if !gone {
			if resp, err := a.readDocsShare(r.Context(), r.PathValue("token")); err == nil {
				gone = resp.StatusCode >= 400 && resp.StatusCode < 500
				_ = resp.Body.Close()
			}
		}
		if !gone {
			spa.ServeHTTP(w, r)
			return
		}
		a.serveAppNotFound(w, r)
	})
}
