package main

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// app is the whole HTTP surface: a session-gated read-only Lens proxy under /api,
// the auth endpoints under /auth, plus the built web bundle for everything else —
// one origin, no CORS.
type app struct {
	cfg    config
	auth   *authenticator // nil ⇔ authMode=disabled (loopback-only, inc2 posture)
	mux    *http.ServeMux
	client *http.Client
}

func newApp(cfg config, auth *authenticator) *app {
	a := &app{
		cfg:    cfg,
		auth:   auth,
		mux:    http.NewServeMux(),
		client: &http.Client{Timeout: 10 * time.Second},
	}

	// The auth surface. Registered in every mode: in disabled mode the login
	// machinery answers an explicit 404 (not a silent SPA fallback) and /auth/me
	// reports the mode so the UI can tell the difference.
	a.mux.HandleFunc("/auth/login", a.handleLogin)
	a.mux.HandleFunc("/auth/callback", a.handleCallback)
	a.mux.HandleFunc("/auth/logout", a.handleLogout)
	a.mux.HandleFunc("/auth/me", a.handleMe)

	// /api/context is the only endpoint that never calls upstream and never touches the
	// key: it tells the UI which workspace it is looking at, and nothing more.
	a.mux.HandleFunc("/api/context", a.requireSession(a.handleContext))

	// The read-only Lens proxies, ALL behind requireSession. Each is pinned to a fixed
	// upstream path built from the CONFIGURED workspace id — never from client input — so
	// this can never be turned into an open proxy. Only limit/offset pass through, sanitised.
	a.mux.HandleFunc("/api/lxc/balance", a.requireSession(a.proxyFixed("/v1/workspaces/"+cfg.workspaceID+"/lxc/balance")))
	a.mux.HandleFunc("/api/tokens/balance", a.requireSession(a.proxyFixed("/v1/workspaces/"+cfg.workspaceID+"/tokens/balance")))
	a.mux.HandleFunc("/api/tokens/history", a.requireSession(a.proxyPaged("/v1/workspaces/"+cfg.workspaceID+"/tokens/history")))
	a.mux.HandleFunc("/api/lxc/history", a.requireSession(a.proxyPaged("/v1/workspaces/"+cfg.workspaceID+"/lxc/history")))
	a.mux.HandleFunc("/api/workspaces", a.requireSession(a.proxyFixed("/v1/workspaces")))

	// CAPABILITY-GATED endpoints. Lens registers these routes only when their flag is on;
	// when off the route is absent and Lens returns a generic 404 that is wire-identical to
	// a real not-found. The BFF is the only component that knows which of its endpoints map
	// to a gated Lens feature, so it carries that knowledge and translates the 404 into an
	// explicit "disabled" signal (see proxyGated). Others (economy, attestation, pattern
	// mining) are added here the same way when a screen needs them.
	a.mux.HandleFunc("/api/bonds", a.requireSession(a.proxyGated("/v1/bonds", "bonds")))

	// PRODUCT UPSTREAMS (inc6). Track and Docs gate /v1 behind their gatewayauth
	// boundary: a request must carry X-Gateway-Auth equal to their GATEWAY_AUTH_SECRET
	// (verified constant-time) BEFORE any identity header is trusted; only then is
	// X-User-Email — the workspace-membership join key — believed. The BFF plays the
	// gateway's role for its session-authenticated user: transit proof + the SESSION's
	// identity attached server-side, invisible to the browser. Membership and tier
	// enforcement stay upstream — a Track/Docs 403 passes through honestly. Upstream
	// paths are fixed at registration (Docs pinned to the CONFIGURED workspace id),
	// so this cannot be turned into an open proxy — same rule as the Lens routes.
	a.mux.HandleFunc("/api/track/workspaces", a.requireSession(a.proxyProduct(
		"track", cfg.trackBaseURL, cfg.trackGatewaySecret, "/v1/workspaces")))
	a.mux.HandleFunc("/api/docs/spaces", a.requireSession(a.proxyProduct(
		"docs", cfg.docsBaseURL, cfg.docsGatewaySecret, "/v1/workspaces/"+cfg.docsWorkspaceID+"/spaces")))

	// Docs Tier-1 id-routes: space detail, page list, page detail. These take ids
	// (client input), so the upstream path is BUILT from a validated segment, not
	// pinned to a literal — and they use the PLAIN proxy path so a genuine 404
	// stays a 404 (proxyGated would launder it into "capability off"; its doc
	// comment flags exactly this case). Upstream scopes each id to the workspace by
	// the session user's membership + View tier; a 403/404 passes through honestly.
	// The page LIST projects away the heavy `content`/`content_text` fields (see
	// docsPageList) — a tree view has no business transferring whole documents.
	a.mux.HandleFunc("/api/docs/spaces/{spaceID}", a.requireSession(a.docsSpaceDetail()))
	a.mux.HandleFunc("/api/docs/spaces/{spaceID}/pages", a.requireSession(a.docsPageList()))
	a.mux.HandleFunc("/api/docs/spaces/{spaceID}/pages/{pageID}", a.requireSession(a.docsPageDetail()))

	// Key management (shared-unblock PR). GET lists by prefix — Lens's list shape
	// carries no secret (KeyHash is json:"-" upstream). POST is THE BFF'S FIRST
	// WRITE PATH: it mints a credential and deliberately returns it exactly once.
	// See keys.go for the CSRF posture (Lax + strict same-Origin) and the
	// no-store / never-logged discipline around that one response.
	a.mux.HandleFunc("/api/keys", a.requireSession(a.handleKeys))

	// The Track roster and Lens month-spend, both pinned at registration from
	// config — client input never shapes an upstream path.
	a.mux.HandleFunc("/api/members", a.requireSession(a.proxyProduct(
		"track", cfg.trackBaseURL, cfg.trackGatewaySecret, "/v1/workspaces/"+cfg.trackWorkspaceID+"/members")))
	a.mux.HandleFunc("/api/spend/month", a.requireSession(a.proxyFixed("/v1/workspaces/"+cfg.workspaceID+"/spend/current-month")))

	// Unknown /api/* → 401 without a session, JSON 404 with one (never fall through to
	// the SPA and hand back index.html).
	a.mux.HandleFunc("/api/", a.requireSession(a.handleAPINotFound))

	// Everything else is the SPA (client-side routes resolve to index.html).
	a.mux.Handle("/", a.spaHandler())
	return a
}

func (a *app) ServeHTTP(w http.ResponseWriter, r *http.Request) { a.mux.ServeHTTP(w, r) }

// writeJSON emits a small JSON object. Used only for BFF-originated responses (context,
// errors); upstream bodies are streamed verbatim by copyUpstream.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (a *app) handleContext(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	// Deliberately NOT the key — only the non-secret coordinates the UI needs.
	writeJSON(w, http.StatusOK, map[string]string{
		"workspace_id":  a.cfg.workspaceID,
		"lens_base_url": a.cfg.lensBaseURL,
	})
}

func (a *app) handleAPINotFound(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such endpoint"})
}

func methodNotAllowed(w http.ResponseWriter, allow string) {
	w.Header().Set("Allow", allow)
	writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed: only " + allow})
}

// proxyFixed forwards GET → a fixed upstream path with no query parameters.
func (a *app) proxyFixed(upstreamPath string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		a.forward(w, r, upstreamPath, "")
	}
}

// proxyPaged forwards GET → a fixed upstream path, passing through ONLY limit and
// offset, each sanitised. No other client query parameter reaches Lens.
func (a *app) proxyPaged(upstreamPath string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		limit := clampInt(r.URL.Query().Get("limit"), 20, 1, 200)
		offset := clampInt(r.URL.Query().Get("offset"), 0, 0, 1<<31-1)
		raw := "limit=" + strconv.Itoa(limit) + "&offset=" + strconv.Itoa(offset)
		a.forward(w, r, upstreamPath, raw)
	}
}

// clampInt parses s and clamps it to [lo, hi]; a missing or unparseable value yields def.
func clampInt(s string, def, lo, hi int) int {
	if s == "" {
		return def
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	if n < lo {
		return lo
	}
	if n > hi {
		return hi
	}
	return n
}

// doGet issues the upstream GET with the workspace key attached server-side. The key is
// set on the OUTBOUND request only; it is never written to any response.
func (a *app) doGet(ctx context.Context, upstreamPath, rawQuery string) (*http.Response, error) {
	u := a.cfg.lensBaseURL + upstreamPath
	if rawQuery != "" {
		u += "?" + rawQuery
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+a.cfg.workspaceKey) // ← the key, server-side only
	req.Header.Set("Accept", "application/json")
	return a.client.Do(req)
}

// forward streams the upstream status, content-type and body back verbatim. Upstream
// status is preserved so a real not-found or error surfaces honestly rather than masked.
// (Capability-gated endpoints use proxyGated instead — a 404 there is "disabled", not a
// fault.)
func (a *app) forward(w http.ResponseWriter, r *http.Request, upstreamPath, rawQuery string) {
	resp, err := a.doGet(r.Context(), upstreamPath, rawQuery)
	if err != nil {
		log.Printf("bff: upstream %s: %v", upstreamPath, err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream unreachable"})
		return
	}
	defer resp.Body.Close()

	if ct := resp.Header.Get("Content-Type"); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

// proxyGated forwards GET → a fixed upstream path for a CAPABILITY-GATED Lens feature.
// Because a flag-off route and a real not-found are indistinguishable on the wire (both a
// generic 404 — verified against the running binary), the BFF resolves the ambiguity with
// the knowledge only it has (this endpoint proxies a gated feature):
//
//	upstream 404 → 200 {capability, enabled:false}                 // off — information, not a fault
//	upstream 200 → 200 {capability, enabled:true, data:<upstream>} // on — the real payload, wrapped
//	anything else → the upstream status as an error                // a genuine failure
//
// The client never special-cases a status code; it reads `enabled`.
//
// CAVEAT: this translation reads ANY upstream 404 as "capability off". That is safe
// only while every gated endpoint proxies a PARAMETERLESS collection path (as all
// current users do): a fixed path either exists (flag on) or is unregistered (flag
// off), so 404 is unambiguous. The moment a gated endpoint takes a path parameter
// (/v1/bonds/{id}), a genuine not-found — real feature, missing id — would be
// laundered into "disabled". Such an endpoint must NOT use proxyGated; it needs a
// discriminator (e.g. probe the collection root, or a Lens capability header).
func (a *app) proxyGated(upstreamPath, capability string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		resp, err := a.doGet(r.Context(), upstreamPath, "")
		if err != nil {
			log.Printf("bff: upstream %s: %v", upstreamPath, err)
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream unreachable"})
			return
		}
		defer resp.Body.Close()

		switch resp.StatusCode {
		case http.StatusNotFound:
			writeJSON(w, http.StatusOK, map[string]any{"capability": capability, "enabled": false})
		case http.StatusOK:
			body, err := io.ReadAll(resp.Body)
			if err != nil {
				writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream read"})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"capability": capability, "enabled": true, "data": json.RawMessage(body)})
		default:
			writeJSON(w, resp.StatusCode, map[string]string{"error": "lens upstream error", "capability": capability})
		}
	}
}

// proxyProduct forwards GET → a fixed path on a gatewayauth-gated product upstream
// (Track/Docs), attaching the transit proof and the SESSION's identity server-side.
// An unconfigured upstream answers an explicit 503 — the route exists in every
// deployment so the contract is visible; the environment decides which products are
// wired. Config guarantees these upstreams exist only in oidc mode, so there is
// always a real authenticated identity to forward.
func (a *app) proxyProduct(product, baseURL, secret, upstreamPath string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		a.forwardProduct(w, r, product, baseURL, secret, upstreamPath, "", nil)
	}
}

// forwardProduct is the SINGLE credential-attaching path for every gatewayauth-gated
// product route (Track/Docs). Keeping it one function means the transit-proof + identity
// attachment — and the guarantee that neither reaches the browser — lives in exactly one
// place. It attaches the proof + the SESSION's identity server-side, forwards
// GET → baseURL+upstreamPath(+?rawQuery), and preserves the upstream status HONESTLY: a
// 404 stays a 404, a 403 stays a 403 (NOT laundered — that is why these routes use this
// and not proxyGated). When transform is non-nil and the upstream is 200, the body is
// passed through it before being written (used only to project heavy fields off a list
// row); otherwise the body is streamed verbatim.
func (a *app) forwardProduct(w http.ResponseWriter, r *http.Request, product, baseURL, secret, upstreamPath, rawQuery string, transform func([]byte) ([]byte, error)) {
	if baseURL == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": product + " upstream not configured on this BFF"})
		return
	}
	if a.auth == nil {
		// Unreachable by construction (loadConfig forbids products outside oidc
		// mode); fail closed anyway rather than forward an invented identity.
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": product + " upstream requires oidc auth"})
		return
	}
	sess, ok := a.auth.sessionFrom(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{
			"error": "authentication required — sign in at /auth/login"})
		return
	}
	u := baseURL + upstreamPath
	if rawQuery != "" {
		u += "?" + rawQuery
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, u, nil)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": product + " upstream request"})
		return
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Gateway-Auth", secret)   // ← transit proof, server-side only
	req.Header.Set("X-User-Email", sess.email) // the workspace-membership join key
	req.Header.Set("X-User-Id", sess.sub)
	req.Header.Set("X-Auth-Iss", a.cfg.oidcIssuer)
	resp, err := a.client.Do(req)
	if err != nil {
		log.Printf("bff: %s upstream %s: %v", product, upstreamPath, err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": product + " upstream unreachable"})
		return
	}
	defer resp.Body.Close()

	if transform != nil && resp.StatusCode == http.StatusOK {
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": product + " upstream read"})
			return
		}
		out, err := transform(body)
		if err != nil {
			// An unexpected upstream shape — answer a gateway error rather than
			// forward something we could not project as intended.
			log.Printf("bff: %s transform %s: %v", product, upstreamPath, err)
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": product + " upstream shape"})
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(out)
		return
	}

	if ct := resp.Header.Get("Content-Type"); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

// docsPathID reads a Docs id path parameter and refuses shapes that could rewrite the
// pinned upstream path — an empty segment, a traversal, or an embedded slash (the
// segments are client input). ServeMux already splits on '/', but %2F / %2e%2e can decode
// into one, so this is defence-in-depth; a valid opaque id then goes through
// url.PathEscape at the call site. On rejection it answers 400 and reports false.
func docsPathID(w http.ResponseWriter, name, v string) (string, bool) {
	bad := v == "" || v == "." || v == ".." || strings.Contains(v, "..") || strings.ContainsAny(v, "/\\")
	if !bad {
		for _, c := range v {
			if c < 0x20 || c == 0x7f {
				bad = true
				break
			}
		}
	}
	if bad {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid " + name})
		return "", false
	}
	return v, true
}

// docsSpaceDetail — GET /api/docs/spaces/{spaceID} → GET /v1/spaces/{spaceID}. Space
// detail is View-gated upstream and scoped to the pinned workspace by the session user's
// membership; a 404 outside it stays a 404 (plain proxy, not proxyGated). Streamed verbatim.
func (a *app) docsSpaceDetail() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		spaceID, ok := docsPathID(w, "spaceID", r.PathValue("spaceID"))
		if !ok {
			return
		}
		a.forwardProduct(w, r, "docs", a.cfg.docsBaseURL, a.cfg.docsGatewaySecret,
			"/v1/spaces/"+url.PathEscape(spaceID), "", nil)
	}
}

// docsPageList — GET /api/docs/spaces/{spaceID}/pages → GET /v1/spaces/{spaceID}/pages.
// The upstream returns []model.Page carrying the FULL ProseMirror `content` (and the
// `content_text` extraction) on EVERY row — listing a space would ship every page's whole
// document to draw a sidebar tree. The BFF projects BOTH fields away here (stripPageContentList);
// the full document is served by the page-DETAIL route. limit mirrors the upstream store's
// own semantics (default 100, cap 500). NOTE: the upstream List HANDLER reads only `limit`
// (offset is in its store filter but not wired to the query), so offset is forwarded for
// contract-completeness but is a no-op upstream today — see the report.
func (a *app) docsPageList() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		spaceID, ok := docsPathID(w, "spaceID", r.PathValue("spaceID"))
		if !ok {
			return
		}
		limit := clampInt(r.URL.Query().Get("limit"), 100, 1, 500)
		offset := clampInt(r.URL.Query().Get("offset"), 0, 0, 1<<31-1)
		raw := "limit=" + strconv.Itoa(limit) + "&offset=" + strconv.Itoa(offset)
		a.forwardProduct(w, r, "docs", a.cfg.docsBaseURL, a.cfg.docsGatewaySecret,
			"/v1/spaces/"+url.PathEscape(spaceID)+"/pages", raw, stripPageContentList)
	}
}

// docsPageDetail — GET /api/docs/spaces/{spaceID}/pages/{pageID} →
// GET /v1/spaces/{spaceID}/pages/{pageID}. Page detail requires BOTH ids: there is no
// top-level /v1/pages/{pageID} detail route upstream (only /v1/pages/{pageID}/links). This
// is where the full page content legitimately belongs, so it streams verbatim. View-gated;
// 404-not-403 outside the workspace stays a 404.
func (a *app) docsPageDetail() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		spaceID, ok := docsPathID(w, "spaceID", r.PathValue("spaceID"))
		if !ok {
			return
		}
		pageID, ok := docsPathID(w, "pageID", r.PathValue("pageID"))
		if !ok {
			return
		}
		a.forwardProduct(w, r, "docs", a.cfg.docsBaseURL, a.cfg.docsGatewaySecret,
			"/v1/spaces/"+url.PathEscape(spaceID)+"/pages/"+url.PathEscape(pageID), "", nil)
	}
}

// stripPageContentList projects the heavy `content` (full ProseMirror JSON) and
// `content_text` (its plaintext extraction) off every row of a []model.Page list body,
// preserving every other field byte-for-byte (json.RawMessage values are untouched). A
// tree view needs title/depth/position/parent, never the document. Returns an error if the
// body is not a JSON array — an unexpected upstream shape the caller turns into a 502
// rather than forward. An empty list round-trips to `[]`.
func stripPageContentList(body []byte) ([]byte, error) {
	var rows []map[string]json.RawMessage
	if err := json.Unmarshal(body, &rows); err != nil {
		return nil, err
	}
	for _, row := range rows {
		delete(row, "content")
		delete(row, "content_text")
	}
	if rows == nil {
		rows = []map[string]json.RawMessage{}
	}
	return json.Marshal(rows)
}

// spaHandler serves the built web bundle, falling back to index.html for any path that
// is not an existing file (so client-side routes like /ledger survive a hard refresh).
func (a *app) spaHandler() http.Handler {
	dist := filepath.Clean(a.cfg.webDist)
	index := filepath.Join(dist, "index.html")
	fs := http.FileServer(http.Dir(dist))
	if _, err := os.Stat(index); err != nil {
		log.Printf("bff: WARNING web bundle not found at %s — API works, app will 404 until you `pnpm build`", index)
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		clean := filepath.Clean(r.URL.Path)
		full := filepath.Join(dist, clean)
		// Contain within dist (defence in depth; http.FileServer already cleans).
		if full != dist && !strings.HasPrefix(full, dist+string(os.PathSeparator)) {
			http.NotFound(w, r)
			return
		}
		if st, err := os.Stat(full); err == nil && !st.IsDir() {
			fs.ServeHTTP(w, r)
			return
		}
		http.ServeFile(w, r, index) // client route (or missing bundle → 404 from ServeFile)
	})
}
