package main

// The BFF's SECOND write path: POST /api/lxc/checkout, which starts a Stripe
// Checkout Session so a customer can buy LXC. It carries the same two
// disciplines as the mint (keys.go) — session-gated, strict same-Origin — and
// one of its own: the amount is an ALLOW-LIST, refused here before any dial.
//
// Every assertion below is on BEHAVIOUR, not on a status code alone: a refused
// request must not reach Lens at all, a forwarded one must carry the workspace
// key and the pinned workspace path, and each distinct failure must arrive at
// the browser as a DISTINGUISHABLE reason — because the screen has to tell a
// paying customer which of them happened.

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const testCheckoutURL = "https://checkout.stripe.com/c/pay/cs_test_a1b2c3#fidkdWxOYHw"

// checkoutUpstream fakes Lens's billing surface. Records what it saw so a
// "refused" test can prove the upstream was never dialled.
type checkoutUpstream struct {
	srv        *httptest.Server
	gotAuth    string
	gotMethod  string
	gotPath    string
	gotBody    string
	nextStatus int    // 0 ⇒ 200
	nextBody   string // "" ⇒ the session-url body
}

func newCheckoutUpstream(t *testing.T) *checkoutUpstream {
	t.Helper()
	u := &checkoutUpstream{}
	u.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u.gotAuth = r.Header.Get("Authorization")
		u.gotMethod = r.Method
		u.gotPath = r.URL.Path
		b, _ := io.ReadAll(r.Body)
		u.gotBody = string(b)
		w.Header().Set("Content-Type", "application/json")
		status := u.nextStatus
		if status == 0 {
			status = http.StatusOK
		}
		body := u.nextBody
		if body == "" {
			body = `{"url":"` + testCheckoutURL + `"}`
		}
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(u.srv.Close)
	return u
}

// checkoutApp: oidc-mode app pointed at the billing fake, with a seeded session
// and a public origin to enforce — the same fixture shape as keysApp.
func checkoutApp(t *testing.T, up *checkoutUpstream) (*app, *http.Cookie) {
	t.Helper()
	cfg := config{
		lensBaseURL: up.srv.URL, workspaceKey: testKey, workspaceID: "trial-ws-1",
		authMode: authModeOIDC, oidcIssuer: "https://idp.example.com",
		publicBaseURL: "https://app.talyvor.com", sessionTTL: time.Hour,
	}
	auth := newSessionOnlyAuthenticator(cfg)
	auth.sessions.put("bill-sid", session{sub: "u1", email: "ng@example.com", expires: time.Now().Add(time.Hour)})
	a := newApp(cfg, auth)
	a.cfg.webDist = t.TempDir()
	return a, &http.Cookie{Name: sessionCookieName, Value: "bill-sid"}
}

func postCheckout(a *app, sess *http.Cookie, origin, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/lxc/checkout", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	if sess != nil {
		req.AddCookie(sess)
	}
	a.ServeHTTP(rec, req)
	return rec
}

// decodeBody reads the BFF's JSON answer as a free map so tests assert on the
// FIELDS the screen reads, not on a status code alone.
func decodeBody(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("response is not a JSON object: %s", rec.Body.String())
	}
	return m
}

/* ── The gate: no session, no write ──────────────────────────────────────── */

func TestCheckoutRequiresSession(t *testing.T) {
	up := newCheckoutUpstream(t)
	a, _ := checkoutApp(t, up)

	rec := postCheckout(a, nil, "https://app.talyvor.com", `{"usd_cents":1000}`)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("checkout without a session: got %d (%s), want 401", rec.Code, rec.Body.String())
	}
	// The behaviour that matters: an unauthenticated purchase never becomes a
	// Stripe session. A 401 with the upstream already dialled would still have
	// created a payable session for a workspace nobody proved they own.
	if up.gotMethod != "" {
		t.Fatalf("an unauthenticated checkout reached the upstream (%s %s)", up.gotMethod, up.gotPath)
	}
}

/* ── CSRF: a session cookie alone must not be able to start a purchase ───── */

func TestCheckoutRequiresSameOrigin(t *testing.T) {
	cases := []struct {
		name   string
		origin string // "" = header absent
		want   int
	}{
		{"matching origin allowed", "https://app.talyvor.com", http.StatusOK},
		{"sibling subdomain refused", "https://evil.talyvor.com", http.StatusForbidden},
		{"foreign origin refused", "https://attacker.example", http.StatusForbidden},
		{"absent origin refused", "", http.StatusForbidden},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			up := newCheckoutUpstream(t)
			a, sess := checkoutApp(t, up)

			rec := postCheckout(a, sess, c.origin, `{"usd_cents":1000}`)

			if rec.Code != c.want {
				t.Fatalf("got %d (%s), want %d", rec.Code, rec.Body.String(), c.want)
			}
			if c.want == http.StatusForbidden && up.gotMethod != "" {
				t.Fatal("a cross-origin checkout reached the upstream — it must be refused before any dial")
			}
		})
	}
}

/* ── The forward: pinned path, key server-side, sanitised body ───────────── */

func TestCheckoutForwardsToPinnedWorkspaceWithKeyAndReturnsTheURL(t *testing.T) {
	up := newCheckoutUpstream(t)
	a, sess := checkoutApp(t, up)

	// A client that tries to redirect the purchase at another workspace, name a
	// price, or smuggle extra fields: none of it may survive.
	rec := postCheckout(a, sess, "https://app.talyvor.com",
		`{"usd_cents":5000,"workspace_id":"SOMEBODY-ELSE","lxc_amount":999999999,"junk":"x"}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("got %d (%s), want 200", rec.Code, rec.Body.String())
	}
	if up.gotMethod != http.MethodPost {
		t.Fatalf("upstream method = %q, want POST", up.gotMethod)
	}
	if up.gotPath != "/v1/workspaces/trial-ws-1/billing/checkout" {
		t.Fatalf("upstream path = %q — must be pinned to the CONFIGURED workspace", up.gotPath)
	}
	if up.gotAuth != "Bearer "+testKey {
		t.Fatalf("workspace key not attached server-side: %q", up.gotAuth)
	}
	// Sanitise by reconstruction: ONLY usd_cents crosses to Lens.
	var sent map[string]any
	if err := json.Unmarshal([]byte(up.gotBody), &sent); err != nil {
		t.Fatalf("upstream body is not JSON: %s", up.gotBody)
	}
	if len(sent) != 1 {
		t.Fatalf("upstream body must carry ONLY usd_cents, got %v", sent)
	}
	if sent["usd_cents"] != float64(5000) {
		t.Fatalf("usd_cents = %v, want 5000", sent["usd_cents"])
	}
	// And the browser gets the session URL it needs to be sent to.
	if got := decodeBody(t, rec)["url"]; got != testCheckoutURL {
		t.Fatalf("url = %v, want the Stripe session URL", got)
	}
	// A payment session bound to this workspace must not sit in a cache.
	if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", cc)
	}
	// The workspace key never rides back out.
	if strings.Contains(rec.Body.String(), testKey) || strings.Contains(rec.Body.String(), "tlv_ws_") {
		t.Fatalf("a secret reached the checkout response: %s", rec.Body.String())
	}
}

/* ── The allow-list: refused HERE, before a Stripe customer is ever made ─── */

func TestCheckoutRefusesOffAllowListAmountsBeforeDialling(t *testing.T) {
	for _, cents := range []int64{0, -1000, 1, 2000, 999999} {
		up := newCheckoutUpstream(t)
		a, sess := checkoutApp(t, up)

		rec := postCheckout(a, sess, "https://app.talyvor.com",
			`{"usd_cents":`+itoa(cents)+`}`)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("usd_cents=%d: got %d (%s), want 400", cents, rec.Code, rec.Body.String())
		}
		if up.gotMethod != "" {
			t.Fatalf("usd_cents=%d reached the upstream — an off-list amount must be refused before "+
				"Lens creates a Stripe customer for it", cents)
		}
		// The refusal must name the amounts, so the screen can say what IS allowed.
		if body := decodeBody(t, rec); body["allowed_usd_cents"] == nil {
			t.Fatalf("usd_cents=%d: the refusal must carry the allowed amounts, got %s", cents, rec.Body.String())
		}
	}
}

func TestCheckoutAcceptsEveryAdvertisedAmount(t *testing.T) {
	// The list the UI is served and the list the write path accepts are the SAME
	// list — otherwise the screen offers a button that always fails.
	for _, cents := range allowedTopUpCents {
		up := newCheckoutUpstream(t)
		a, sess := checkoutApp(t, up)

		rec := postCheckout(a, sess, "https://app.talyvor.com", `{"usd_cents":`+itoa(cents)+`}`)

		if rec.Code != http.StatusOK {
			t.Fatalf("advertised amount %d was refused: %d (%s)", cents, rec.Code, rec.Body.String())
		}
	}
}

// TestAllowedTopUpsMirrorLens pins the values against the Lens source they
// mirror (internal/billing/billing.go `allowedTopUps` = $10/$50/$100). Lens
// exposes this list on NO endpoint, so the BFF cannot read it at runtime; this
// test is the thing that makes a divergence deliberate instead of silent.
func TestAllowedTopUpsMirrorLens(t *testing.T) {
	want := []int64{1000, 5000, 10000}
	if len(allowedTopUpCents) != len(want) {
		t.Fatalf("allowedTopUpCents = %v, want %v (mirrors Lens allowedTopUps)", allowedTopUpCents, want)
	}
	for i, c := range want {
		if allowedTopUpCents[i] != c {
			t.Fatalf("allowedTopUpCents = %v, want %v (mirrors Lens allowedTopUps)", allowedTopUpCents, want)
		}
	}
}

/* ── The options read: the UI must not hardcode the amounts ─────────────── */

func TestTopUpOptionsServesTheAllowList(t *testing.T) {
	up := newCheckoutUpstream(t)
	a, sess := checkoutApp(t, up)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/lxc/topup-options", nil)
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("got %d (%s), want 200", rec.Code, rec.Body.String())
	}
	var body struct {
		Amounts []int64 `json:"allowed_usd_cents"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad body: %s", rec.Body.String())
	}
	if len(body.Amounts) != len(allowedTopUpCents) {
		t.Fatalf("allowed_usd_cents = %v, want %v", body.Amounts, allowedTopUpCents)
	}
	for i := range body.Amounts {
		if body.Amounts[i] != allowedTopUpCents[i] {
			t.Fatalf("allowed_usd_cents = %v, want %v", body.Amounts, allowedTopUpCents)
		}
	}
}

/* ── The capability probe: can this deployment sell at all? ──────────────── */
//
// A deployment with LENS_BILLING_ENABLED unset cannot sell LXC, and the screen
// has to know that BEFORE it draws a row of buy buttons — a page offering a
// purchase that cannot happen is worse than a page that says so. Lens only
// reveals the state by 404-ing an unregistered route, so the options read
// probes it server-side and reports the answer alongside the amounts.

func TestTopUpOptionsReportsBillingOffWhenLensHasNoCheckoutRoute(t *testing.T) {
	up := newCheckoutUpstream(t)
	up.nextStatus = http.StatusNotFound // Lens with billing disabled: route never registered
	up.nextBody = `{"error":"404 page not found"}`
	a, sess := checkoutApp(t, up)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/lxc/topup-options", nil)
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("got %d (%s) — a disabled capability is information, answered 200", rec.Code, rec.Body.String())
	}
	if got := decodeBody(t, rec)["billing_enabled"]; got != false {
		t.Fatalf("billing_enabled = %v, want false — the screen must be able to hide the buttons", got)
	}
}

func TestTopUpOptionsReportsBillingOnWhenLensAnswersTheProbe(t *testing.T) {
	up := newCheckoutUpstream(t)
	up.nextStatus = http.StatusBadRequest // Lens with billing ON: route registered, body refused
	up.nextBody = `{"error":"invalid JSON: EOF"}`
	a, sess := checkoutApp(t, up)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/lxc/topup-options", nil)
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if got := decodeBody(t, rec)["billing_enabled"]; got != true {
		t.Fatalf("billing_enabled = %v, want true", got)
	}
}

// TestTopUpOptionsProbeCannotStartAPurchase is the assertion that makes the
// probe acceptable at all: it must be impossible for it to charge anyone or
// leave anything behind. It sends an EMPTY body to the checkout route, which
// Lens decodes BEFORE any billing work happens (json decode → 400), so
// CreateCheckout — and therefore ensureCustomer and the Stripe session call —
// never runs. A second, independent guard backs it up: CreateCheckout rejects a
// non-allow-listed amount (0) on its first statement, before ensureCustomer.
func TestTopUpOptionsProbeCannotStartAPurchase(t *testing.T) {
	up := newCheckoutUpstream(t)
	up.nextStatus = http.StatusBadRequest
	a, sess := checkoutApp(t, up)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/lxc/topup-options", nil)
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if up.gotPath != "/v1/workspaces/trial-ws-1/billing/checkout" {
		t.Fatalf("probe path = %q — must probe the very route the button uses, pinned to the "+
			"configured workspace", up.gotPath)
	}
	// The body is what keeps this harmless: empty, so Lens's handler refuses at
	// the JSON decode. A body carrying a valid amount would create a real
	// Stripe Checkout Session on every page view.
	if up.gotBody != "" {
		t.Fatalf("probe body = %q — it MUST be empty; anything Lens can decode risks "+
			"starting a real purchase", up.gotBody)
	}
	if up.gotAuth != "Bearer "+testKey {
		t.Fatalf("probe did not carry the workspace key: %q", up.gotAuth)
	}
}

// TestTopUpOptionsAssumesOnWhenTheProbeIsInconclusive: only a definitive 404
// means "off". Anything else — a Lens 500, an unreachable Lens — must NOT be
// reported as billing being disabled: a false "off" hides a working paid feature
// from a customer who wants to pay, while a false "on" is caught by the
// click-time 503 that already exists. The bias is deliberate.
func TestTopUpOptionsAssumesOnWhenTheProbeIsInconclusive(t *testing.T) {
	t.Run("lens 500", func(t *testing.T) {
		up := newCheckoutUpstream(t)
		up.nextStatus = http.StatusInternalServerError
		a, sess := checkoutApp(t, up)

		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/lxc/topup-options", nil)
		req.AddCookie(sess)
		a.ServeHTTP(rec, req)

		if got := decodeBody(t, rec)["billing_enabled"]; got == false {
			t.Fatal("a Lens 500 must not be reported as billing disabled")
		}
	})

	t.Run("lens unreachable", func(t *testing.T) {
		cfg := config{
			lensBaseURL: "http://127.0.0.1:1", workspaceKey: testKey, workspaceID: "trial-ws-1",
			authMode: authModeOIDC, oidcIssuer: "https://idp.example.com",
			publicBaseURL: "https://app.talyvor.com", sessionTTL: time.Hour,
		}
		auth := newSessionOnlyAuthenticator(cfg)
		auth.sessions.put("bill-sid", session{sub: "u1", email: "ng@example.com", expires: time.Now().Add(time.Hour)})
		a := newApp(cfg, auth)
		a.cfg.webDist = t.TempDir()

		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/lxc/topup-options", nil)
		req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "bill-sid"})
		a.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("got %d — the amounts are BFF-held, so they survive an unreachable Lens", rec.Code)
		}
		body := decodeBody(t, rec)
		if body["billing_enabled"] == false {
			t.Fatal("an unreachable Lens must not be reported as billing disabled")
		}
		if body["allowed_usd_cents"] == nil {
			t.Fatal("the amounts must still be served — they do not come from Lens")
		}
	})
}

func TestTopUpOptionsRequiresSession(t *testing.T) {
	up := newCheckoutUpstream(t)
	a, _ := checkoutApp(t, up)
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/lxc/topup-options", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("options without a session: got %d, want 401", rec.Code)
	}
}

/* ── Failures the customer has to be able to tell apart ──────────────────── */

// TestCheckoutTranslatesBillingDisabled: with LENS_BILLING_ENABLED unset, Lens
// never REGISTERS the checkout route, so the POST meets a chi-native 404. That
// 404 is unambiguous here (see billing.go's argument) and must reach the screen
// as "this deployment cannot sell LXC" — never as a generic fault, and never as
// a broken button with no explanation.
func TestCheckoutTranslatesBillingDisabledInto503(t *testing.T) {
	up := newCheckoutUpstream(t)
	up.nextStatus = http.StatusNotFound
	up.nextBody = `{"error":"404 page not found"}`
	a, sess := checkoutApp(t, up)

	rec := postCheckout(a, sess, "https://app.talyvor.com", `{"usd_cents":1000}`)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("got %d (%s), want 503", rec.Code, rec.Body.String())
	}
	body := decodeBody(t, rec)
	if body["billing_enabled"] != false {
		t.Fatalf("the screen must be able to read billing_enabled=false, got %s", rec.Body.String())
	}
	if s, _ := body["error"].(string); !strings.Contains(strings.ToLower(s), "billing") {
		t.Fatalf("the reason must name billing, got %q", s)
	}
}

// TestCheckoutSurfacesLensAmountRefusalDistinctly: if the BFF's mirrored
// allow-list ever drifts from Lens's, Lens answers 400. That must NOT read as
// the same thing as billing being off — it is a version mismatch between two
// repos, and the message has to say so.
func TestCheckoutSurfacesLensAmountRefusalDistinctly(t *testing.T) {
	up := newCheckoutUpstream(t)
	up.nextStatus = http.StatusBadRequest
	up.nextBody = `{"error":"billing: usd_cents is not an allowed top-up size"}`
	a, sess := checkoutApp(t, up)

	rec := postCheckout(a, sess, "https://app.talyvor.com", `{"usd_cents":1000}`)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("got %d (%s), want 502 — Lens refusing an amount the BFF advertises is a DRIFT, "+
			"not the customer's input error", rec.Code, rec.Body.String())
	}
	body := decodeBody(t, rec)
	if body["billing_enabled"] == false {
		t.Fatal("an amount refusal must not be reported as billing being disabled")
	}
	if s, _ := body["error"].(string); !strings.Contains(s, "$10") {
		t.Fatalf("the drift message must state which amounts this app offers, got %q", s)
	}
}

func TestCheckoutSurfacesUnreachableLens(t *testing.T) {
	cfg := config{
		lensBaseURL: "http://127.0.0.1:1", workspaceKey: testKey, workspaceID: "trial-ws-1",
		authMode: authModeOIDC, oidcIssuer: "https://idp.example.com",
		publicBaseURL: "https://app.talyvor.com", sessionTTL: time.Hour,
	}
	auth := newSessionOnlyAuthenticator(cfg)
	auth.sessions.put("bill-sid", session{sub: "u1", email: "ng@example.com", expires: time.Now().Add(time.Hour)})
	a := newApp(cfg, auth)
	a.cfg.webDist = t.TempDir()

	rec := postCheckout(a, &http.Cookie{Name: sessionCookieName, Value: "bill-sid"},
		"https://app.talyvor.com", `{"usd_cents":1000}`)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("got %d (%s), want 502", rec.Code, rec.Body.String())
	}
	if decodeBody(t, rec)["billing_enabled"] == false {
		t.Fatal("an unreachable Lens must not be reported as billing being disabled — it is a fault")
	}
}

// A 5xx from Lens is a fault, not a capability signal, and must not be laundered
// into "billing disabled" the way a 404 legitimately is.
func TestCheckoutDoesNotLaunderUpstreamErrors(t *testing.T) {
	up := newCheckoutUpstream(t)
	up.nextStatus = http.StatusInternalServerError
	up.nextBody = `{"error":"internal server error"}`
	a, sess := checkoutApp(t, up)

	rec := postCheckout(a, sess, "https://app.talyvor.com", `{"usd_cents":1000}`)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("got %d (%s), want 502", rec.Code, rec.Body.String())
	}
	if decodeBody(t, rec)["billing_enabled"] == false {
		t.Fatal("a Lens 500 must not be reported as billing being disabled")
	}
}

func TestCheckoutRejectsGarbageBody(t *testing.T) {
	up := newCheckoutUpstream(t)
	a, sess := checkoutApp(t, up)

	rec := postCheckout(a, sess, "https://app.talyvor.com", `not json`)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("got %d (%s), want 400", rec.Code, rec.Body.String())
	}
	if up.gotMethod != "" {
		t.Fatal("an unparseable body reached the upstream")
	}
}

func TestCheckoutMethodSurface(t *testing.T) {
	up := newCheckoutUpstream(t)
	a, sess := checkoutApp(t, up)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/lxc/checkout", nil)
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET /api/lxc/checkout: got %d, want 405", rec.Code)
	}
	if got := rec.Header().Get("Allow"); got != http.MethodPost {
		t.Fatalf("Allow = %q, want POST", got)
	}
}

// itoa avoids importing strconv for one call site in a table.
func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	if neg {
		return "-" + string(b)
	}
	return string(b)
}
