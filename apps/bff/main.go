// Command bff is the Talyvor suite's backend-for-frontend.
//
// It has exactly two jobs in this increment, and no authentication of its own:
//
//  1. Hold the Lens workspace key (tlv_ws_…) server-side and attach it to every
//     upstream read. THE KEY NEVER REACHES THE BROWSER — the whole point of the
//     proxy. TestKeyNeverReachesResponse asserts it.
//  2. Serve the built web app AND its read-only API from ONE origin, so CORS
//     never enters the picture.
//
// Because it has no auth yet, anything that can reach it is fully authorised. That
// must be impossible to get wrong, so the process REFUSES TO START on a non-loopback
// bind — the same shape as Lens's own loopback guard (agent/internal/mcp
// IsLoopbackHost), but hard-failing instead of merely warning.
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

// config is the whole runtime surface, read from the environment. The key and the
// workspace id are required: without the key the proxy is pointless, and without a
// workspace the read paths cannot be built. Fail-closed on either.
type config struct {
	addr         string // BFF bind address; MUST be loopback (guarded)
	lensBaseURL  string // e.g. http://127.0.0.1:8080
	workspaceKey string // tlv_ws_… — held here, never emitted
	workspaceID  string // the workspace whose reads we serve, e.g. trial-ws-1
	webDist      string // path to the built apps/web bundle to serve
}

func loadConfig() (config, error) {
	cfg := config{
		addr:         envOr("BFF_ADDR", "127.0.0.1:8787"),
		lensBaseURL:  strings.TrimRight(envOr("LENS_BASE_URL", "http://127.0.0.1:8080"), "/"),
		workspaceKey: os.Getenv("LENS_WORKSPACE_KEY"),
		workspaceID:  os.Getenv("LENS_WORKSPACE_ID"),
		webDist:      envOr("WEB_DIST", "../web/dist"),
	}
	if cfg.workspaceKey == "" {
		return cfg, errors.New("LENS_WORKSPACE_KEY is required (the BFF's job is to hold it); refusing to start")
	}
	if cfg.workspaceID == "" {
		return cfg, errors.New("LENS_WORKSPACE_ID is required (the workspace whose reads are served); refusing to start")
	}
	if err := requireLoopback(cfg.addr); err != nil {
		return cfg, err
	}
	return cfg, nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// isLoopbackHost reports whether host is a loopback interface. Mirrors the shape of
// agent/internal/mcp.IsLoopbackHost in talyvor-code: "localhost" counts, and a parsed
// IP counts iff it is in a loopback range (127.0.0.0/8, ::1). Everything else — a
// bare hostname, an empty host ("" meaning all interfaces), 0.0.0.0, :: — is NOT
// loopback and must be refused.
func isLoopbackHost(host string) bool {
	if host == "localhost" {
		return true
	}
	if ip := net.ParseIP(host); ip != nil {
		return ip.IsLoopback()
	}
	return false
}

// requireLoopback fails unless addr binds a loopback host. Unlike talyvor-code's serve
// (which warns and continues, because it is still token-gated), the BFF has no auth, so
// a non-loopback bind would hand fully-authorised access to the network. Hard-fail.
func requireLoopback(addr string) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("invalid bind address %q: %w", addr, err)
	}
	if !isLoopbackHost(host) {
		return fmt.Errorf(
			"refusing to bind %q: only loopback (127.0.0.1 / localhost / ::1) is allowed. "+
				"This process has no authentication yet, so a non-loopback bind would expose "+
				"fully-authorised access to every machine that can reach it",
			addr,
		)
	}
	return nil
}

func main() {
	log.SetFlags(0)
	cfg, err := loadConfig()
	if err != nil {
		log.Fatalf("bff: %v", err)
	}

	app := newApp(cfg)

	srv := &http.Server{
		Addr:              cfg.addr,
		Handler:           app,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	// Bind explicitly (not ListenAndServe) so we control the listener and can log the
	// real, resolved address — a second belt-and-braces confirmation of loopback.
	ln, err := net.Listen("tcp", cfg.addr)
	if err != nil {
		log.Fatalf("bff: listen %s: %v", cfg.addr, err)
	}
	log.Printf("bff: serving %s → Lens %s (workspace %s); web bundle from %s",
		ln.Addr(), cfg.lensBaseURL, cfg.workspaceID, cfg.webDist)
	log.Printf("bff: the Lens key is held server-side and never sent to the browser")

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("bff: serve: %v", err)
		}
	}()

	<-ctx.Done()
	log.Printf("bff: shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
}
