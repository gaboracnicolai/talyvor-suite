package main

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// app is the whole HTTP surface: a read-only Lens proxy under /api, plus the built
// web bundle for everything else — one origin, no CORS.
type app struct {
	cfg    config
	mux    *http.ServeMux
	client *http.Client
}

func newApp(cfg config) *app {
	a := &app{
		cfg:    cfg,
		mux:    http.NewServeMux(),
		client: &http.Client{Timeout: 10 * time.Second},
	}

	// /api/context is the only endpoint that never calls upstream and never touches the
	// key: it tells the UI which workspace it is looking at, and nothing more.
	a.mux.HandleFunc("/api/context", a.handleContext)

	// The read-only Lens proxies. Each is pinned to a fixed upstream path built from the
	// CONFIGURED workspace id — never from client input — so this can never be turned
	// into an open proxy. Only limit/offset pass through, sanitised.
	a.mux.HandleFunc("/api/lxc/balance", a.proxyFixed("/v1/workspaces/"+cfg.workspaceID+"/lxc/balance"))
	a.mux.HandleFunc("/api/tokens/balance", a.proxyFixed("/v1/workspaces/"+cfg.workspaceID+"/tokens/balance"))
	a.mux.HandleFunc("/api/tokens/history", a.proxyPaged("/v1/workspaces/"+cfg.workspaceID+"/tokens/history"))
	a.mux.HandleFunc("/api/lxc/history", a.proxyPaged("/v1/workspaces/"+cfg.workspaceID+"/lxc/history"))
	a.mux.HandleFunc("/api/workspaces", a.proxyFixed("/v1/workspaces"))

	// Unknown /api/* → JSON 404 (never fall through to the SPA and hand back index.html).
	a.mux.HandleFunc("/api/", a.handleAPINotFound)

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
		methodNotAllowed(w)
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
		methodNotAllowed(w)
		return
	}
	writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such endpoint"})
}

func methodNotAllowed(w http.ResponseWriter) {
	w.Header().Set("Allow", "GET")
	writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "read-only: only GET is allowed"})
}

// proxyFixed forwards GET → a fixed upstream path with no query parameters.
func (a *app) proxyFixed(upstreamPath string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w)
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
			methodNotAllowed(w)
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

// forward issues the upstream GET with the workspace key attached server-side, then
// streams the upstream status, content-type and body back verbatim. The key is set on
// the OUTBOUND request only; it is never written to w. Upstream status is preserved so
// a stale-Lens 404/405 surfaces honestly rather than being masked.
func (a *app) forward(w http.ResponseWriter, r *http.Request, upstreamPath, rawQuery string) {
	u := a.cfg.lensBaseURL + upstreamPath
	if rawQuery != "" {
		u += "?" + rawQuery
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, u, nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not build upstream request"})
		return
	}
	req.Header.Set("Authorization", "Bearer "+a.cfg.workspaceKey) // ← the key, server-side only
	req.Header.Set("Accept", "application/json")

	resp, err := a.client.Do(req)
	if err != nil {
		// Never echo err verbatim into a header; a dial error can't contain the key, but
		// keep the contract simple: fixed message, no upstream detail.
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
