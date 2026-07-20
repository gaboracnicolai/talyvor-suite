package main

import (
	"context"
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

	// CAPABILITY-GATED endpoints. Lens registers these routes only when their flag is on;
	// when off the route is absent and Lens returns a generic 404 that is wire-identical to
	// a real not-found. The BFF is the only component that knows which of its endpoints map
	// to a gated Lens feature, so it carries that knowledge and translates the 404 into an
	// explicit "disabled" signal (see proxyGated). Others (economy, attestation, pattern
	// mining) are added here the same way when a screen needs them.
	a.mux.HandleFunc("/api/bonds", a.proxyGated("/v1/bonds", "bonds"))

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
func (a *app) proxyGated(upstreamPath, capability string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w)
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
