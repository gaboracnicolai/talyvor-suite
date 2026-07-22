// Command bff is the Talyvor suite's backend-for-frontend.
//
// Its jobs, in order of importance:
//
//  1. Hold the Lens workspace key (tlv_ws_…) server-side and attach it to every
//     upstream read. THE KEY NEVER REACHES THE BROWSER — the whole point of the
//     proxy. TestKeyNeverReachesResponse asserts it.
//  2. Authenticate the browser. BFF_AUTH_MODE=oidc runs an OIDC authorization-code
//     + PKCE flow against ANY standards-compliant provider (Keycloak, Authentik,
//     Dex, Clerk-as-OIDC-IdP, …) configured by environment — the product is
//     self-hostable, so no hosted-SaaS dependency is baked in. The browser gets an
//     opaque __Host- session cookie; tokens and the Lens key stay server-side.
//  3. Proxy Track and Docs (inc6): both gate /v1 behind gatewayauth — a
//     transit-proof header (X-Gateway-Auth, a shared secret a browser cannot
//     produce) that makes the identity headers trustworthy. The BFF holds a
//     copy of each secret and forwards the SESSION's identity with it.
//  4. Serve the built web app AND its read-only API from ONE origin, so CORS
//     never enters the picture.
//
// The bind guard from inc2 remains: BFF_AUTH_MODE=disabled (explicitly chosen — there
// is no default mode) has no authentication, so it REFUSES TO START on a non-loopback
// bind, exactly as before. Only oidc mode with an https public origin may bind beyond
// loopback — that is the deliberate relaxation, made in loadConfig, not as a side
// effect.
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

const (
	authModeOIDC     = "oidc"
	authModeDisabled = "disabled"
)

// config is the whole runtime surface, read from the environment. The key and the
// workspace id are required: without the key the proxy is pointless, and without a
// workspace the read paths cannot be built. Fail-closed on either.
type config struct {
	addr         string // BFF bind address; loopback unless oidc+https (see loadConfig)
	lensBaseURL  string // e.g. http://127.0.0.1:8080
	workspaceKey string // tlv_ws_… — held here, never emitted
	workspaceID  string // the workspace whose reads we serve, e.g. trial-ws-1
	webDist      string // path to the built apps/web bundle to serve

	authMode         string        // "oidc" | "disabled" — REQUIRED; silence is not a mode
	publicBaseURL    string        // oidc: browser-facing origin (https://app.talyvor.com); no path
	oidcIssuer       string        // oidc: discovery base, e.g. https://idp.example.com
	oidcClientID     string        // oidc: this BFF's client id at the IdP
	oidcClientSecret string        // oidc: confidential-client secret (PKCE is added on top)
	allowedEmails    []string      // oidc: lower-cased allowlist; ["*"] = any issuer identity
	sessionTTL       time.Duration // oidc: absolute session lifetime

	// Track/Docs upstreams (inc6). Both gate /v1 behind gatewayauth: the request
	// must carry X-Gateway-Auth == their GATEWAY_AUTH_SECRET before the identity
	// headers (X-User-Email et al.) are trusted. The BFF holds a COPY of each
	// secret and plays the gateway's role for its session-authenticated user.
	// Optional per product, but all-or-nothing within one, and oidc-mode only —
	// the BFF forwards identities it authenticated, never ones it invented.
	trackBaseURL       string // e.g. http://127.0.0.1:8081
	trackGatewaySecret string // Track's GATEWAY_AUTH_SECRET — held here, never emitted
	trackWorkspaceID   string // the Track workspace whose roster we serve (pinned, like Docs)
	docsBaseURL        string // e.g. http://127.0.0.1:8082
	docsGatewaySecret  string // Docs' GATEWAY_AUTH_SECRET — held here, never emitted
	docsWorkspaceID    string // the Docs workspace whose reads we serve (pinned, like Lens)
}

func loadConfig() (config, error) {
	cfg := config{
		addr:         envOr("BFF_ADDR", "127.0.0.1:8787"),
		lensBaseURL:  strings.TrimRight(envOr("LENS_BASE_URL", "http://127.0.0.1:8080"), "/"),
		workspaceKey: os.Getenv("LENS_WORKSPACE_KEY"),
		workspaceID:  os.Getenv("LENS_WORKSPACE_ID"),
		webDist:      envOr("WEB_DIST", "../web/dist"),
		authMode:     os.Getenv("BFF_AUTH_MODE"),
	}
	if cfg.workspaceKey == "" {
		return cfg, errors.New("LENS_WORKSPACE_KEY is required (the BFF's job is to hold it); refusing to start")
	}
	if cfg.workspaceID == "" {
		return cfg, errors.New("LENS_WORKSPACE_ID is required (the workspace whose reads are served); refusing to start")
	}

	var perr error
	cfg, perr = loadProductConfig(cfg)
	if perr != nil {
		return cfg, perr
	}

	switch cfg.authMode {
	case authModeDisabled:
		// inc2 posture, explicitly chosen: no auth ⇒ loopback is the only guard,
		// so a non-loopback bind stays a hard startup failure. Unchanged.
		if err := requireLoopback(cfg.addr); err != nil {
			return cfg, err
		}
		if cfg.productConfigured() {
			return cfg, errors.New(
				"Track/Docs upstreams require BFF_AUTH_MODE=oidc: the BFF forwards the identity it " +
					"AUTHENTICATED (X-User-Email / X-User-Id) alongside the transit proof, and in disabled " +
					"mode there is no authenticated identity to forward — only one it would have to invent")
		}
		return cfg, nil

	case authModeOIDC:
		return loadOIDCConfig(cfg)

	default:
		return cfg, fmt.Errorf(
			"BFF_AUTH_MODE=%q: must be %q (OIDC login, sessions, /api requires auth) or %q "+
				"(no auth, loopback bind only — dev). There is no default: say which one you mean",
			cfg.authMode, authModeOIDC, authModeDisabled)
	}
}

// loadOIDCConfig validates everything oidc mode needs. All of it is fail-closed:
// a partially-configured IdP must never boot into an unauthenticated proxy.
func loadOIDCConfig(cfg config) (config, error) {
	cfg.oidcIssuer = os.Getenv("OIDC_ISSUER")
	cfg.oidcClientID = os.Getenv("OIDC_CLIENT_ID")
	cfg.oidcClientSecret = os.Getenv("OIDC_CLIENT_SECRET")

	if cfg.oidcIssuer == "" {
		return cfg, errors.New("BFF_AUTH_MODE=oidc: OIDC_ISSUER is required (the provider's discovery base URL)")
	}
	if _, err := parseHTTPSOrLoopback("OIDC_ISSUER", cfg.oidcIssuer); err != nil {
		return cfg, err
	}
	if cfg.oidcClientID == "" {
		return cfg, errors.New("BFF_AUTH_MODE=oidc: OIDC_CLIENT_ID is required")
	}
	if cfg.oidcClientSecret == "" {
		return cfg, errors.New("BFF_AUTH_MODE=oidc: OIDC_CLIENT_SECRET is required — the BFF is a " +
			"confidential client (server-side code exchange); PKCE supplements the secret, it does not replace it")
	}

	rawPublic := os.Getenv("BFF_PUBLIC_BASE_URL")
	if rawPublic == "" {
		return cfg, errors.New("BFF_AUTH_MODE=oidc: BFF_PUBLIC_BASE_URL is required (the browser-facing " +
			"origin, e.g. https://app.talyvor.com — it derives the OIDC redirect URI and scopes the session cookie)")
	}
	pub, err := parseHTTPSOrLoopback("BFF_PUBLIC_BASE_URL", rawPublic)
	if err != nil {
		return cfg, err
	}
	if (pub.Path != "" && pub.Path != "/") || pub.RawQuery != "" || pub.Fragment != "" {
		return cfg, fmt.Errorf("BFF_PUBLIC_BASE_URL %q must be a bare origin with no path: the __Host- "+
			"session cookie is scoped Path=/, so a base path would silently mis-scope it", rawPublic)
	}
	cfg.publicBaseURL = strings.TrimRight(rawPublic, "/")

	cfg.allowedEmails, err = parseAllowedEmails(os.Getenv("OIDC_ALLOWED_EMAILS"))
	if err != nil {
		return cfg, err
	}

	cfg.sessionTTL, err = parseSessionTTL(os.Getenv("BFF_SESSION_TTL"))
	if err != nil {
		return cfg, err
	}

	// THE DELIBERATE RELAXATION. Loopback binds are always fine. Binding beyond
	// loopback is allowed only now that auth is proven on (this branch) AND the
	// public origin is https — the posture where the __Host- Secure cookie and the
	// IdP redirect actually work. An http public URL is a loopback dev posture and
	// must not be reachable from the network.
	if !bindsLoopback(cfg.addr) {
		if pub.Scheme != "https" {
			return cfg, fmt.Errorf(
				"refusing to bind %q beyond loopback: BFF_PUBLIC_BASE_URL %q is not https. "+
					"A public bind requires the https origin the Secure __Host- session cookie needs; "+
					"http public URLs are for loopback dev only", cfg.addr, rawPublic)
		}
		log.Printf("bff: non-loopback bind %s permitted: BFF_AUTH_MODE=oidc with https public origin %s",
			cfg.addr, cfg.publicBaseURL)
	}
	return cfg, nil
}

// loadProductConfig reads the optional Track/Docs upstream settings. Fail-closed
// on partial configuration: a base URL without its transit-proof secret (or the
// reverse) must never boot — the secret is exactly what makes the identity
// headers trustworthy to the upstream. Mode enforcement (oidc only) lives in
// loadConfig's switch, where the mode is known.
func loadProductConfig(cfg config) (config, error) {
	cfg.trackBaseURL = strings.TrimRight(os.Getenv("TRACK_BASE_URL"), "/")
	cfg.trackGatewaySecret = os.Getenv("TRACK_GATEWAY_SECRET")
	cfg.docsBaseURL = strings.TrimRight(os.Getenv("DOCS_BASE_URL"), "/")
	cfg.docsGatewaySecret = os.Getenv("DOCS_GATEWAY_SECRET")
	cfg.docsWorkspaceID = os.Getenv("DOCS_WORKSPACE_ID")

	cfg.trackWorkspaceID = os.Getenv("TRACK_WORKSPACE_ID")
	trackAny := cfg.trackBaseURL != "" || cfg.trackGatewaySecret != "" || cfg.trackWorkspaceID != ""
	if trackAny {
		var missing []string
		if cfg.trackBaseURL == "" {
			missing = append(missing, "TRACK_BASE_URL")
		}
		if cfg.trackGatewaySecret == "" {
			missing = append(missing, "TRACK_GATEWAY_SECRET")
		}
		if cfg.trackWorkspaceID == "" {
			missing = append(missing, "TRACK_WORKSPACE_ID")
		}
		if len(missing) > 0 {
			return cfg, fmt.Errorf("Track upstream partially configured: missing %s — set all three "+
				"(TRACK_BASE_URL, TRACK_GATEWAY_SECRET, TRACK_WORKSPACE_ID), or none", strings.Join(missing, ", "))
		}
	}

	docsAny := cfg.docsBaseURL != "" || cfg.docsGatewaySecret != "" || cfg.docsWorkspaceID != ""
	if docsAny {
		var missing []string
		if cfg.docsBaseURL == "" {
			missing = append(missing, "DOCS_BASE_URL")
		}
		if cfg.docsGatewaySecret == "" {
			missing = append(missing, "DOCS_GATEWAY_SECRET")
		}
		if cfg.docsWorkspaceID == "" {
			missing = append(missing, "DOCS_WORKSPACE_ID")
		}
		if len(missing) > 0 {
			return cfg, fmt.Errorf("Docs upstream partially configured: missing %s — set all three "+
				"(DOCS_BASE_URL, DOCS_GATEWAY_SECRET, DOCS_WORKSPACE_ID), or none", strings.Join(missing, ", "))
		}
	}
	return cfg, nil
}

// productConfigured reports whether any gatewayauth-gated upstream is wired.
func (c config) productConfigured() bool { return c.trackBaseURL != "" || c.docsBaseURL != "" }

// parseHTTPSOrLoopback accepts an https URL anywhere, or an http URL on a loopback
// host (dev). Anything else is refused with the reason.
func parseHTTPSOrLoopback(name, raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("%s %q: %w", name, raw, err)
	}
	switch u.Scheme {
	case "https":
		return u, nil
	case "http":
		if isLoopbackHost(u.Hostname()) {
			return u, nil
		}
		return nil, fmt.Errorf("%s %q: must be https (http is allowed only on loopback, for dev)", name, raw)
	default:
		return nil, fmt.Errorf("%s %q: must be an https URL (or http on loopback for dev)", name, raw)
	}
}

// parseAllowedEmails parses the comma-separated allowlist. "*" (alone) means any
// authenticated identity from the configured issuer — for IdPs whose whole user base
// is trusted. Empty is refused: authorization must be stated, not implied.
func parseAllowedEmails(raw string) ([]string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, errors.New("BFF_AUTH_MODE=oidc: OIDC_ALLOWED_EMAILS is required — a comma-separated " +
			"email allowlist, or \"*\" to allow every identity the issuer authenticates")
	}
	if raw == "*" {
		return []string{"*"}, nil
	}
	var out []string
	for _, part := range strings.Split(raw, ",") {
		e := strings.ToLower(strings.TrimSpace(part))
		if e == "" {
			continue
		}
		if e == "*" || !strings.Contains(e, "@") {
			return nil, fmt.Errorf("OIDC_ALLOWED_EMAILS entry %q does not look like an email "+
				"(\"*\" is only valid alone)", part)
		}
		out = append(out, e)
	}
	if len(out) == 0 {
		return nil, errors.New("OIDC_ALLOWED_EMAILS parsed to an empty list")
	}
	return out, nil
}

func parseSessionTTL(raw string) (time.Duration, error) {
	if raw == "" {
		return 12 * time.Hour, nil
	}
	d, err := time.ParseDuration(raw)
	if err != nil {
		return 0, fmt.Errorf("BFF_SESSION_TTL %q: %w", raw, err)
	}
	if d <= 0 {
		return 0, fmt.Errorf("BFF_SESSION_TTL %q: must be positive", raw)
	}
	return d, nil
}

func orUnset(v string) string {
	if v == "" {
		return "(unset)"
	}
	return v
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

// bindsLoopback reports whether addr binds a loopback host. A malformed addr counts
// as non-loopback: it will be refused by the caller (fail closed) and the listener
// would reject it anyway.
func bindsLoopback(addr string) bool {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return false
	}
	return isLoopbackHost(host)
}

// requireLoopback fails unless addr binds a loopback host. This is the whole guard for
// BFF_AUTH_MODE=disabled: with no auth, a non-loopback bind would hand fully-authorised
// access to the network, so — unlike talyvor-code's serve, which warns and continues
// because it is still token-gated — the BFF hard-fails. oidc mode does NOT call this;
// its bind rule (https public origin required) lives in loadOIDCConfig.
func requireLoopback(addr string) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("invalid bind address %q: %w", addr, err)
	}
	if !isLoopbackHost(host) {
		return fmt.Errorf(
			"refusing to bind %q: only loopback (127.0.0.1 / localhost / ::1) is allowed while "+
				"BFF_AUTH_MODE=disabled. This mode has no authentication, so a non-loopback bind "+
				"would expose fully-authorised access to every machine that can reach it. "+
				"To serve beyond loopback, configure BFF_AUTH_MODE=oidc with an https BFF_PUBLIC_BASE_URL",
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

	// oidc mode discovers the issuer at boot: an unreachable or misconfigured IdP
	// refuses to start rather than booting into a proxy nobody can log in to.
	var auth *authenticator
	if cfg.authMode == authModeOIDC {
		auth, err = newAuthenticator(context.Background(), cfg)
		if err != nil {
			log.Fatalf("bff: OIDC setup (issuer %s): %v", cfg.oidcIssuer, err)
		}
		log.Printf("bff: auth=oidc issuer=%s public=%s allowlist=%d entries",
			cfg.oidcIssuer, cfg.publicBaseURL, len(cfg.allowedEmails))
		log.Printf("bff: product upstreams: track=%s docs=%s (unset = routes answer 503)",
			orUnset(cfg.trackBaseURL), orUnset(cfg.docsBaseURL))
	} else {
		log.Printf("bff: auth=DISABLED (explicit) — loopback bind is the only guard")
	}

	app := newApp(cfg, auth)

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
