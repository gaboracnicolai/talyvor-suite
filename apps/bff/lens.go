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
	"sync"
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

	// devMu/devCached hold the loopback-dev tenant (authMode=disabled only). In oidc mode every
	// tenant comes from a session and these are never touched.
	devMu     sync.Mutex
	devCached tenant
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

	// /api/version is the ONLY /api/ route with no session gate. It reports which commit this
	// binary was built from and which bundle it is serving, and it is deliberately readable
	// without logging in — see handleVersion and TestVersionEndpointIsNotBehindTheSession. Go's
	// ServeMux prefers the more specific pattern, so this wins over the /api/ catch-all below.
	a.mux.HandleFunc("/api/version", a.handleVersion)

	// /api/context is the only endpoint that never calls upstream and never touches the
	// key: it tells the UI which workspace it is looking at, and nothing more.
	a.mux.HandleFunc("/api/context", a.requireSession(a.handleContext))

	// The read-only Lens proxies, ALL behind requireSession. Each is pinned to a fixed
	// upstream path built from the CONFIGURED workspace id — never from client input — so
	// this can never be turned into an open proxy. Only limit/offset pass through, sanitised.
	a.mux.HandleFunc("/api/lxc/balance", a.wsProxyFixed("/lxc/balance"))
	a.mux.HandleFunc("/api/tokens/balance", a.wsProxyFixed("/tokens/balance"))
	a.mux.HandleFunc("/api/tokens/history", a.wsProxyPaged("/tokens/history"))
	a.mux.HandleFunc("/api/lxc/history", a.wsProxyPaged("/lxc/history"))
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
	a.mux.HandleFunc("/api/docs/spaces", a.requireSession(a.docsSpaces()))

	// Docs Tier-1 id-routes: space detail, page list, page detail. These take ids
	// (client input), so the upstream path is BUILT from a validated segment, not
	// pinned to a literal — and they use the PLAIN proxy path so a genuine 404
	// stays a 404 (proxyGated would launder it into "capability off"; its doc
	// comment flags exactly this case). Upstream scopes each id to the workspace by
	// the session user's membership + View tier; a 403/404 passes through honestly.
	// The page LIST projects away the heavy `content`/`content_text` fields (see
	// docsPageList) — a tree view has no business transferring whole documents.
	// ASK-AI. The first browser-reachable AI control in this product — see docs_ai.go, and
	// docs_ai_test.go for why this route's 503 must stay distinguishable from the BFF's own.
	// Registered ABOVE the id-routes only for reading order; ServeMux prefers the more specific
	// literal regardless, so `/api/docs/ai/ask` can never be taken for a `{spaceID}` of "ai".
	a.mux.HandleFunc("/api/docs/ai/ask", a.docsAskAI())
	// SEARCH. Registered next to ask-AI because it is the other half of the same W1.7 scope — the
	// two AI features that need no editor — and above the id-routes for the same reading-order
	// reason. It is NOT an /ai/ path: Docs mounts search in its own package and its semantic half
	// is one of two sources inside it. See docs_search.go for the two parameters this route
	// refuses rather than forwards, and for what the response cannot say about that half.
	a.mux.HandleFunc("/api/docs/search", a.docsSearch())

	a.mux.HandleFunc("/api/docs/spaces/{spaceID}", a.requireSession(a.docsSpaceDetail()))
	a.mux.HandleFunc("/api/docs/spaces/{spaceID}/pages", a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			a.docsCreatePage()(w, r)
			return
		}
		a.docsPageList()(w, r)
	}))
	a.mux.HandleFunc("/api/docs/spaces/{spaceID}/pages/{pageID}", a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPatch {
			a.docsUpdatePage()(w, r)
			return
		}
		a.docsPageDetail()(w, r)
	}))

	// Key management (shared-unblock PR). GET lists by prefix — Lens's list shape
	// carries no secret (KeyHash is json:"-" upstream). POST is THE BFF'S FIRST
	// WRITE PATH: it mints a credential and deliberately returns it exactly once.
	// See keys.go for the CSRF posture (Lax + strict same-Origin) and the
	// no-store / never-logged discipline around that one response.
	// ── THE OPERATOR SURFACE ──────────────────────────────────────────────────────────────────
	// Cross-tenant reads, behind requireOperator (NOT requireTenant — see operator.go for why the
	// workspace resolver is never asked here rather than given a bypass).
	//
	// ⚠ ONE PREFIX, ONE GATE. Every operator route hangs off /api/admin/ and every one of them goes
	// through requireOperator. Adding edge-infra's health endpoints later is a new pattern under
	// this prefix with the same wrapper — no restructuring, and no route can be added to the
	// operator surface without passing the boundary, because the prefix and the gate are applied
	// together here.
	a.mux.HandleFunc("/api/admin/workspaces", a.requireOperator(a.adminNotWired))
	a.mux.HandleFunc("/api/admin/billing/purchases", a.requireOperator(a.adminNotWired))
	a.mux.HandleFunc("/api/admin/economy/flags", a.requireOperator(a.adminNotWired))
	a.mux.HandleFunc("/api/admin/keel/findings", a.requireOperator(a.adminNotWired))
	a.mux.HandleFunc("/api/admin/held-mints", a.requireOperator(a.adminNotWired))
	a.mux.HandleFunc("/api/admin/distill/attribution", a.requireOperator(a.adminNotWired))

	a.mux.HandleFunc("/api/keys", a.requireTenant(a.handleKeys))
	// Revoke. A separate id-route rather than a DELETE on the collection: the collection has no
	// meaning to delete, and ServeMux prefers the more specific pattern, so /api/keys keeps its
	// GET, POST surface unchanged.
	a.mux.HandleFunc("/api/keys/{id}", a.requireTenant(a.handleKeyByID))

	// The cross-tenant sharing choice — ONE route for both the signup prompt and the settings
	// control, so the two screens cannot drift into disagreeing about what is stored. A workspace
	// is created DECLINED and the person is asked whether to turn sharing on, so nobody's answers
	// can be served to another company before they have been told. See tenant.go.
	a.mux.HandleFunc("/api/pooling", a.requireTenant(a.handlePoolingChoice))

	// DOCUMENT CONVERSION (distill) — the disclosure's control and evidence. Lens defaults every
	// workspace to distill_policy='always', so this is already happening to every customer; the
	// route to stop it has been live and uncalled. Same posture as /api/pooling: session-gated,
	// same-Origin on the write, key attached server-side, and the response states what Lens
	// RECORDED. See distill.go — distill_poolable is deliberately NOT exposed here.
	a.mux.HandleFunc("/api/distill", a.requireTenant(a.handleDistill))

	// LXC top-up (this PR) — the BFF's SECOND write path, and the front door for
	// the only way a customer can buy LXC. GET serves the allowed amounts (so the
	// screen hardcodes no price); POST starts a Stripe Checkout Session against
	// the CONFIGURED workspace and hands back the session URL. Same posture as the
	// mint above — session-gated, strict same-Origin, key attached server-side,
	// no-store on the response. See billing.go for the allow-list mirroring and
	// for why a 404 from Lens means "billing is off" on this route specifically.
	a.mux.HandleFunc("/api/lxc/topup-options", a.requireTenant(a.handleTopUpOptions))
	a.mux.HandleFunc("/api/lxc/checkout", a.requireTenant(a.handleLXCCheckout))

	// LENS → LXC conversion: the exit earned LENS did not have. Both behind requireTenant, so
	// the workspace is the SESSION's; the write additionally requires a same-origin post. See
	// convert.go for the rate, the minimum and why the screen must say it is ONE-WAY.
	a.mux.HandleFunc("/api/lens/convert-quote", a.requireTenant(a.handleConvertQuote))
	a.mux.HandleFunc("/api/lens/convert", a.requireTenant(a.handleConvert))

	// USAGE — the cache panel's real numbers, and per-model usage in the same call.
	// Lens has served this all along (internal/api/server.go: "per-model usage +
	// serve_source cache hit rate (trial core), one call"); nothing here called it, so two
	// screens drew an invented hit rate from a fixture instead. Wiring it deletes the only
	// fabricated numbers left on the Lens screens.
	//
	// NOTE the upstream path carries NO workspace segment, unlike every other Lens route
	// above. /v1/api/usage scopes itself from the AUTHENTICATED KEY (its effectiveWorkspaceID),
	// and the key is precisely what this BFF attaches server-side — so the tenant pinning is
	// done by the credential rather than by a config-built path. Client input never reaches
	// the upstream path OR its query: only `days` passes, clamped (proxyWindowed). In
	// particular ?workspace_id= — the parameter an ADMIN key would use upstream to target
	// another tenant — is DROPPED, so this route cannot be aimed elsewhere even if the
	// deployment's key were ever upgraded to an admin one.
	a.mux.HandleFunc("/api/usage", a.requireSession(a.proxyWindowed("/v1/api/usage")))

	// Track Tier-1 (this PR): issues list + issue detail + comments + teams,
	// completing the track area's gap list (its item 4, the roster, is
	// /api/members below). All pinned to the CONFIGURED track workspace; the
	// issues LIST forwards a DECIDED query allowlist (see track.go — unknown
	// keys, duplicates and the upstream's documented-but-unparsed `labels`
	// are refused, not silently dropped); id-routes guard the segment before
	// any dial and use the PLAIN proxy so a genuine 404 stays a 404.
	// GET lists, POST creates — one path, method-dispatched inside each handler so an
	// unsupported verb answers 405 rather than falling through to the other product's route.
	a.mux.HandleFunc("/api/track/issues", a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			a.trackCreateIssue()(w, r)
			return
		}
		a.trackIssues()(w, r)
	}))
	a.mux.HandleFunc("/api/track/issues/{id}", a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPatch {
			a.trackUpdateIssue()(w, r)
			return
		}
		a.trackIssueDetail()(w, r)
	}))
	a.mux.HandleFunc("/api/track/issues/{id}/comments", a.requireSession(a.trackIssueComments()))
	// Track's AI thread summary — a GET, and the first browser control for any Track AI feature.
	// See track_ai.go for the three shapes it can answer with and why the body is not re-encoded.
	//
	// ⚠ NO OUTER requireSession HERE, AND THAT IS DELIBERATE — `/api/docs/ai/ask` above is
	// registered the same way. trackIssueSummary() wraps ITSELF, so a second wrapper is a no-op.
	// MEASURED, not assumed: control C1 of w17-tracksummary-controls-9e42.py deleted the outer
	// wrapper from this line and NOTHING in the package went red, because the inner one was still
	// doing the work. Two lines above, `/comments` and `/teams` ARE double-wrapped — so for those
	// two the `requireSession` written in this table is decoration, and a reader who takes this
	// column as the authority on which routes are gated is reading a claim nothing enforces. Not
	// changed here: that is a separate finding about six existing routes, not this one's to ride.
	a.mux.HandleFunc("/api/track/issues/{id}/summary", a.trackIssueSummary())
	a.mux.HandleFunc("/api/track/teams", a.requireSession(a.trackTeams()))

	// The Track roster and Lens month-spend, both pinned at registration from
	// config — client input never shapes an upstream path.
	// The roster of the SESSION's Track workspace — no longer a workspace pinned at startup.
	a.mux.HandleFunc("/api/members", a.trackWorkspaceProxy("/members", nil, nil))
	a.mux.HandleFunc("/api/spend/month", a.wsProxyFixed("/spend/current-month"))

	// Unknown /api/* → 401 without a session, JSON 404 with one (never fall through to
	// the SPA and hand back index.html).
	a.mux.HandleFunc("/api/", a.requireSession(a.handleAPINotFound))

	// Everything else is the SPA (client-side routes resolve to index.html).
	a.mux.Handle("/", a.spaHandler())
	return a
}

// ServeHTTP runs the ONE write-path Origin gate, then the mux.
//
// ⚠ THIS IS NOT PATCHING A LIVE HOLE. The session cookie is SameSite=Lax, so a cross-site POST
// never carries it and the request is already unauthenticated before Origin is consulted. This
// is defence in depth (a same-site subdomain, a future cookie-policy change) and, mostly,
// CONSISTENCY.
//
// WHY IT IS HERE RATHER THAN IN EACH HANDLER. It used to be per-route, and two of twelve write
// paths did not have it — POST /api/track/issues and PATCH /api/track/issues/{id} — which is
// what a per-route guard does eventually. Worse, there were TWO implementations of the one
// rule with DIFFERENT behaviour: keys.go's exempted disabled mode, tenant.go's did not, and
// publicBaseURL is assigned only in the oidc branch of loadConfig. So in disabled mode the
// second one compared every browser's Origin against "" and refused it — pooling, distill and
// the Track comment POST were unusable on a loopback self-host. One rule, one place, so that
// divergence is unrepresentable.
//
// It runs BEFORE the mux deliberately: the guard must not depend on a handler being reached,
// and a cross-origin write to an unknown path should be refused rather than routed.
func (a *app) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !a.sameOriginWriteAllowed(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{
			"error": "cross-origin write refused: the Origin header must be the app origin"})
		return
	}
	a.mux.ServeHTTP(w, r)
}

// originExemptPath names paths that MUST NOT require an Origin header. A machine caller — a
// webhook, a service-to-service POST — has no Origin to send, so requiring one would break it
// rather than protect it.
//
// ⚠ THE LIST IS EMPTY, and that is a finding rather than an oversight: every /api/* route in
// this BFF is session-gated and browser-driven, and /auth/logout is a browser POST that the
// app itself issues. If a webhook is ever mounted here it goes in this function WITH a reason,
// and it must carry its own authentication (an HMAC signature) — an Origin exemption is not a
// pass on authenticating the caller.
func originExemptPath(path string) bool {
	return false
}

// sameOriginWriteAllowed is the SINGLE decider. Reads are never gated: applying this to GET
// would break every navigation and every link into the app.
//
// A MISSING Origin is refused, not waved through. Browsers always send it on a write; a request
// without one is a script or a form that suppressed it, and neither is the audience for a
// session-cookie API.
//
// In disabled mode there is no public origin to compare against (publicBaseURL is ""), so the
// check is INERT and the loopback bind is the boundary — that mode hard-fails on any
// non-loopback bind. ⚠ A deployment running BFF_AUTH_MODE=disabled therefore has NO Origin
// layer; see deploy/README.md.
func (a *app) sameOriginWriteAllowed(r *http.Request) bool {
	switch r.Method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
	default:
		return true // reads and preflights are not write paths
	}
	if a.cfg.authMode == authModeDisabled {
		return true
	}
	if originExemptPath(r.URL.Path) {
		return true
	}
	return r.Header.Get("Origin") == a.cfg.publicBaseURL
}

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
		"workspace_id":  sessionWorkspaceID(a, r),
		"lens_base_url": a.cfg.lensBaseURL,
		// The customer-facing origin, for the setup page's copy-paste blocks. Empty when
		// LENS_PUBLIC_BASE_URL is unset — the UI must branch on that rather than print
		// lens_base_url, which is a loopback/compose address no customer can reach.
		"lens_public_base_url": a.cfg.lensPublicBaseURL,
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
	return a.requireTenant(func(w http.ResponseWriter, r *http.Request, t tenant) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		a.forward(w, r, t, upstreamPath, "")
	})
}

// proxyPaged forwards GET → a fixed upstream path, passing through ONLY limit and
// offset, each sanitised. No other client query parameter reaches Lens.
func (a *app) proxyPaged(upstreamPath string) http.HandlerFunc {
	return a.requireTenant(func(w http.ResponseWriter, r *http.Request, t tenant) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		limit := clampInt(r.URL.Query().Get("limit"), 20, 1, 200)
		offset := clampInt(r.URL.Query().Get("offset"), 0, 0, 1<<31-1)
		raw := "limit=" + strconv.Itoa(limit) + "&offset=" + strconv.Itoa(offset)
		a.forward(w, r, t, upstreamPath, raw)
	})
}

// proxyWindowed forwards GET → a fixed upstream path, passing through ONLY `days`,
// clamped. A windowed read needs its window to reach the upstream or the caption above the
// number ("last 30 days") describes a different window than the one measured — so the
// parameter is forwarded rather than fixed, and clamped rather than trusted. Everything
// else the client sends is dropped, exactly as proxyPaged drops all but limit/offset.
func (a *app) proxyWindowed(upstreamPath string) http.HandlerFunc {
	return a.requireTenant(func(w http.ResponseWriter, r *http.Request, t tenant) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		// Lens's own default is 30 days (queryInt(r, "days", 30)); mirroring it here means
		// the BFF contract states the upstream's truth rather than a second opinion. The
		// 365 cap is this BFF's: a year is the longest window any screen offers.
		days := clampInt(r.URL.Query().Get("days"), 30, 1, 365)
		a.forward(w, r, t, upstreamPath, "days="+strconv.Itoa(days))
	})
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
func (a *app) doGet(ctx context.Context, t tenant, upstreamPath, rawQuery string) (*http.Response, error) {
	u := a.cfg.lensBaseURL + upstreamPath
	if rawQuery != "" {
		u += "?" + rawQuery
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	// The SESSION's workspace-scoped JWT — minted by Lens for this person's workspace only, held
	// server-side, never emitted. Lens resolves the workspace from the signed claim, so this
	// credential cannot read another tenant even if a path were built wrongly.
	req.Header.Set("Authorization", "Bearer "+t.token)
	req.Header.Set("Accept", "application/json")
	return a.client.Do(req)
}

// forward streams the upstream status, content-type and body back verbatim. Upstream
// status is preserved so a real not-found or error surfaces honestly rather than masked.
// (Capability-gated endpoints use proxyGated instead — a 404 there is "disabled", not a
// fault.)
func (a *app) forward(w http.ResponseWriter, r *http.Request, t tenant, upstreamPath, rawQuery string) {
	resp, err := a.doGet(r.Context(), t, upstreamPath, rawQuery)
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
	return a.requireTenant(func(w http.ResponseWriter, r *http.Request, t tenant) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		resp, err := a.doGet(r.Context(), t, upstreamPath, "")
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
	})
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
		a.forwardProduct(w, r, product, baseURL, secret, upstreamPath, "", http.MethodGet, nil, nil)
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
// forwardProduct is the ONE place a product credential is attached. It now carries the METHOD and
// an optional BODY so a write goes through the same path as a read: a sibling helper would have
// meant two places that attach X-Gateway-Auth and the session identity, and the whole argument for
// this function is that there is exactly one.
//
// method is the verb sent upstream. body is nil for reads; for writes it is the caller's request
// body, forwarded VERBATIM — the upstream owns its own validation, and re-encoding here would
// invent a second schema to drift from.
func (a *app) forwardProduct(w http.ResponseWriter, r *http.Request, product, baseURL, secret, upstreamPath, rawQuery, method string, body io.Reader, transform func([]byte) ([]byte, error)) {
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
	req, err := http.NewRequestWithContext(r.Context(), method, u, body)
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

// pathID reads a product (Track/Docs) id path parameter and refuses shapes that could rewrite the
// pinned upstream path — an empty segment, a traversal, or an embedded slash (the
// segments are client input). ServeMux already splits on '/', but %2F / %2e%2e can decode
// into one, so this is defence-in-depth; a valid opaque id then goes through
// url.PathEscape at the call site. On rejection it answers 400 and reports false.
func pathID(w http.ResponseWriter, name, v string) (string, bool) {
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
		spaceID, ok := pathID(w, "spaceID", r.PathValue("spaceID"))
		if !ok {
			return
		}
		if _, ok := a.docsWorkspaceFor(w, r); !ok {
			return
		}
		a.forwardProduct(w, r, "docs", a.cfg.docsBaseURL, a.cfg.docsGatewaySecret,
			"/v1/spaces/"+url.PathEscape(spaceID), "", http.MethodGet, nil, nil)
	}
}

// docsPageListOffsetRefusal is the 400 for an `offset` on the page list. It names the upstream
// fact rather than the policy, because the policy expires the day the fact does: talyvor-docs
// internal/page/handler.go#List parses `limit` alone, and internal/page/store.go's PageFilter.Offset
// — bound into the statement's OFFSET — is written by NOTHING in that repository, so the value is 0
// on every call. Wire that handler and this refusal should be lifted, not kept.
const docsPageListOffsetRefusal = "offset is not implemented upstream — talyvor-docs' page-list " +
	"handler reads only limit, so an offset would return the FIRST page with a 200 and no way to " +
	"tell; omit it (this route does not page)"

// docsPageList — GET /api/docs/spaces/{spaceID}/pages → GET /v1/spaces/{spaceID}/pages.
// The upstream returns []model.Page carrying the FULL ProseMirror `content` (and the
// `content_text` extraction) on EVERY row — listing a space would ship every page's whole
// document to draw a sidebar tree. The BFF projects BOTH fields away here (stripPageContentList);
// the full document is served by the page-DETAIL route. limit mirrors the upstream store's
// own semantics (default 100, cap 500).
//
// ⚠ `offset` IS REFUSED, NOT FORWARDED — AND IT USED TO BE FORWARDED KNOWINGLY. This comment
// said "the upstream List HANDLER reads only `limit` … so offset is forwarded for
// contract-completeness but is a no-op upstream today", and the wire carried
// `limit=100&offset=50` to an upstream that has never read the second half. track.go states this
// repo's rule for exactly that shape and enacts it for `labels`: "A parameter the upstream
// ignores is worse than one it rejects: the reply RENDERS AS FILTERED while being unfiltered …
// not a silent no-op (and not a forward that pretends to work)." Two routes in one BFF answered
// the same question in opposite directions; this one now gives the answer the repo already gave.
// See docs_pagelist_offset_test.go for the upstream census and for the other three forwarding
// routes, whose parameters ARE read.
//
// ⚠ CONSEQUENCE, STATED SO IT IS NOT MISTAKEN FOR PAGING: a space's page list is ONE page of at
// most 500 rows (100 by default) and there is no second page to ask for. A space with more pages
// than that cannot be listed in full through this route, by anyone, until the upstream handler
// reads an offset.
func (a *app) docsPageList() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		spaceID, ok := pathID(w, "spaceID", r.PathValue("spaceID"))
		if !ok {
			return
		}
		// The KEY's presence is the claim, whatever its value: `offset=0` asks for the page this
		// route does serve, but a caller that sends it believes the route pages. Refused before
		// any dial — an upstream asked at all would answer with a first page the caller reads as
		// a later one.
		if _, sent := r.URL.Query()["offset"]; sent {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": docsPageListOffsetRefusal})
			return
		}
		limit := clampInt(r.URL.Query().Get("limit"), 100, 1, 500)
		raw := "limit=" + strconv.Itoa(limit)
		if _, ok := a.docsWorkspaceFor(w, r); !ok {
			return
		}
		a.forwardProduct(w, r, "docs", a.cfg.docsBaseURL, a.cfg.docsGatewaySecret,
			"/v1/spaces/"+url.PathEscape(spaceID)+"/pages", raw, http.MethodGet, nil, stripPageContentList)
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
			"/v1/spaces/"+url.PathEscape(spaceID)+"/pages/"+url.PathEscape(pageID), "", http.MethodGet, nil, nil)
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

// ⚠ THE TWO FILES IN THE BUNDLE A DEPLOY REPLACES IN PLACE.
//
// Everything Vite emits into assets/ carries a content hash in its NAME, so a new build cannot
// collide with a cached copy of an old one — that is what the hash is for. These two keep their
// names across every deploy and it is their CONTENT that changes, which makes them the only
// files a browser can serve stale.
//
// They were served with no freshness information at all — measured against the real binary,
// only Last-Modified. A browser then computes freshness heuristically FROM that Last-Modified
// (RFC 9111 §4.2.2), so the older a running deploy's bundle is, the longer the window in which
// a returning reader keeps the previous one. MEASURED IN CHROME against a matched control that
// differed in this one header: with it absent the browser issued NO request on a normal
// navigation and rendered the previous copy; with `no-cache` it asked and rendered the new one.
//
// The consequence is a blank page, not a lag: `pnpm build` empties dist, so a stale index.html
// asks for an assets/index-<oldhash>.js that no longer exists — and the fallback below answers
// a missing file with index.html, so the browser is handed HTML where it asked for a module.
//
// `no-cache`, not `no-store`: neither is a secret, and a stored copy is fine as long as the
// browser asks before using it. This is the same decision keys.go, billing.go, auth.go and
// version.go already make explicitly on every response that must not be stale — including
// /api/version, which carries the SAME FACT as version.json from the other half of this binary.
// See spa_cache_test.go for the measured rows.
var unhashedBundleNames = map[string]bool{"index.html": true, "version.json": true}

func isUnhashedBundleFile(cleanPath string) bool {
	return unhashedBundleNames[filepath.Base(cleanPath)]
}

func setMustRevalidate(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-cache")
}

// ⚠ A PATH THE BUILD OWNS IS ANSWERED BY THE BUILD OR BY 404 — NEVER BY THE SPA.
//
// The fallback below exists so a client-side route survives a hard refresh. It used to answer
// EVERY path that is not a file, which meant a request for a bundle file that is not there came
// back `200 text/html` — index.html, where the browser asked for a module. Measured against this
// binary with the real dist: `GET /assets/index-OLDHASH1.js` → 200, text/html, 1695 bytes; the
// same for a missing .css, a missing .woff2, and `/assets/` itself.
//
// That is the shape of two ordinary deploys: a browser holding the PREVIOUS index.html (see the
// freshness note above — `pnpm build` empties dist, so the hashes it names are gone), and a
// half-finished rsync that lands index.html without assets/. Measured in Chrome against a bundle
// whose index.html names hashes that are not on disk: four requests, ALL 200, `#root` empty, zero
// stylesheet rules, one console line about a MIME type. A white screen with nothing on the wire
// to see it by — which is why deploy/FULL-STACK-DEPLOY.md had to write "every curl check in this
// document passes, and the app is a white screen" instead of a check that catches it.
//
// WHY A PREFIX AND NOT AN EXTENSION. `/track/issues/42.5` is a page. Anything that reads the tail
// of a path for a dot 404s a client route, so the rule is about WHERE the build writes, not what
// a name looks like: `assets/` is Vite's assetsDir, every file in it is named by a hash of its own
// content, and the set of valid names there IS what is on disk. deploy/decision-expiry.sh holds
// the premise that vite.config.ts still leaves assetsDir at its default.
//
// `/index.html` IS DELIBERATELY NOT IN THE SET. The fallback is index.html: if it is missing,
// http.ServeFile already 404s, and a second guard on the same path would be an invariant held
// twice that no control could breach. `/version.json` IS in it — that one has no such second
// door, and apps/web/vite.config.ts and deploy/README.md both work around its absence today
// ("must PARSE as JSON", because `curl -f` succeeds against a bundle carrying no version at all).
//
// This is the same decision /api/* already gets one screen up: scoped away from the fallback so
// an unknown path 404s honestly instead of handing back a document.
const bundleAssetsDir = "assets"

// buildOwnedFiles are bundle files the build emits at a stable path — not content-hashed, so
// they are not under assetsDir, and not client routes either. A request for one of these is a
// request for a FILE, and the honest answer when it is absent is that it is absent.
var buildOwnedFiles = map[string]bool{"/version.json": true}

func isBuildOwnedPath(cleanPath string) bool {
	if cleanPath == "/"+bundleAssetsDir || strings.HasPrefix(cleanPath, "/"+bundleAssetsDir+"/") {
		return true
	}
	return buildOwnedFiles[cleanPath]
}

// spaHandler serves the built web bundle, falling back to index.html for any path that
// is not an existing file (so client-side routes like /ledger survive a hard refresh) —
// except the paths the build owns, which 404. See isBuildOwnedPath above.
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
			if isUnhashedBundleFile(clean) {
				setMustRevalidate(w)
			}
			fs.ServeHTTP(w, r)
			return
		}
		if isBuildOwnedPath(clean) {
			http.NotFound(w, r) // a bundle file that is not on disk does not exist; do not hand back a document
			return
		}
		setMustRevalidate(w)        // the fallback is index.html, which every deploy replaces in place
		http.ServeFile(w, r, index) // client route (or missing bundle → 404 from ServeFile)
	})
}

// maxDocsBody caps a page body relayed upstream. Docs validates its own payload; this only stops
// an unbounded body being buffered on the way through.
const maxDocsBody = 512 << 10

// docsSpaces — GET and POST /api/docs/spaces in the SESSION's workspace. This replaced a path built
// ONCE at registration from the pinned DOCS_WORKSPACE_ID, which meant every signed-in person read one
// shared wiki.
//
// ⚠ POST EXISTS BECAUSE THE PRODUCT WAS UNREACHABLE WITHOUT IT. Every create-page form lives inside a
// space, so a workspace with zero spaces had no way in — the empty list was a dead end on the live
// deploy. GET-only here is what made a create form on the space list impossible.
func (a *app) docsSpaces() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodPost {
			methodNotAllowed(w, "GET, POST")
			return
		}
		ws, ok := a.docsWorkspaceFor(w, r)
		if !ok {
			return
		}
		if r.Method == http.MethodGet {
			a.forwardProduct(w, r, "docs", a.cfg.docsBaseURL, a.cfg.docsGatewaySecret,
				docsWorkspacePath(ws, "/spaces"), "", http.MethodGet, nil, nil)
			return
		}
		body, ok := docsSpaceCreateBody(w, r, ws)
		if !ok {
			return
		}
		// ⚠ NOT docsWorkspacePath. Docs registers create as POST /v1/spaces — the workspace arrives in
		// the BODY, not the path (internal/space/handler.go; only List is under /workspaces/{wsID}).
		// Sending this to the list path would 404 or 405, not create anything.
		a.forwardProduct(w, r, "docs", a.cfg.docsBaseURL, a.cfg.docsGatewaySecret,
			"/v1/spaces", "", http.MethodPost, body, nil)
	})
}

// docsSpaceCreateBody rewrites a create-space body to carry the SESSION's workspace.
//
// ⚠ THIS IS THE ONE PLACE THE BFF DOES NOT FORWARD A DOCS BODY VERBATIM, and the divergence is
// deliberate. Elsewhere (docsCreatePage) the workspace is in the PATH, which the BFF builds, so the
// body can pass through untouched. On this route Docs reads workspace_id from the body and authorizes
// it against membership — so a body relayed verbatim would let the browser NAME the workspace it
// creates in. Membership means Docs would refuse a workspace the caller does not belong to, but a
// user in two workspaces could still create in the wrong one, and the field an attacker edits should
// not exist in the request at all. The session is the authority; the client never sends it.
//
// Everything ELSE passes through as sent. Decoding into a fixed struct would silently drop any field
// Docs supports and this file has not heard of — the same silently-ignored-default failure, moved one
// layer out. So the body stays a generic object and only workspace_id is overwritten.
func docsSpaceCreateBody(w http.ResponseWriter, r *http.Request, ws string) (io.Reader, bool) {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxDocsBody))
	if err != nil {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "request body too large"})
		return nil, false
	}
	fields := map[string]json.RawMessage{}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &fields); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "request body must be a JSON object"})
			return nil, false
		}
	}
	pinned, err := json.Marshal(ws)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not pin workspace"})
		return nil, false
	}
	fields["workspace_id"] = pinned
	out, err := json.Marshal(fields)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not encode request"})
		return nil, false
	}
	return strings.NewReader(string(out)), true
}

// docsCreatePage — POST /api/docs/spaces/{spaceID}/pages. Body forwarded VERBATIM: Docs owns its
// schema (Create requires AccessEdit on the space), and re-encoding here would invent a second
// schema to drift from.
func (a *app) docsCreatePage() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		spaceID, ok := pathID(w, "spaceID", r.PathValue("spaceID"))
		if !ok {
			return
		}
		if _, ok := a.docsWorkspaceFor(w, r); !ok {
			return
		}
		a.forwardProduct(w, r, "docs", a.cfg.docsBaseURL, a.cfg.docsGatewaySecret,
			"/v1/spaces/"+url.PathEscape(spaceID)+"/pages", "",
			http.MethodPost, http.MaxBytesReader(w, r.Body, maxDocsBody), nil)
	})
}

// docsUpdatePage — PATCH /api/docs/spaces/{spaceID}/pages/{pageID}. Requires AccessEdit upstream;
// a foreign id is a 404 there and passes through untouched.
func (a *app) docsUpdatePage() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
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
			"/v1/spaces/"+url.PathEscape(spaceID)+"/pages/"+url.PathEscape(pageID),
			"", http.MethodPatch, http.MaxBytesReader(w, r.Body, maxDocsBody), nil)
	})
}
