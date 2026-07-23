package main

// The denied page: an identity the IdP vouches for but the allowlist refuses used to get a RAW
// JSON 403 as its entire first impression — authenticated with a real identity, refused, shown a
// machine error. These tests pin the replacement: a styled HTML refusal served BY THE BFF (the
// browser is mid-redirect from the IdP; no session exists, so no SPA page could know who was
// refused without a leak channel), which
//   1. echoes the authenticated identity (the login WORKED; the refusal is authorisation),
//   2. says the workspace has not granted access,
//   3. points at the operator (there is no self-service path),
//   4. offers a sign-in-with-a-different-account restart (prompt=select_account),
// while MOVING NOTHING about the security property: 403 before any session, no session cookie,
// no allowlist information of any kind, indistinguishable across refusal causes.
//
// (New file on purpose: bff/track-tier1 is open and touches auth_test.go — disjoint files merge
// clean.)

import (
	"net/http"
	"strings"
	"testing"
)

// grab fetches the denied callback for one refused identity and returns (resp headers, body).
func deniedFlow(t *testing.T, email string, verified *bool, mut func(*config)) (*http.Response, string) {
	t.Helper()
	idp := newFakeIDP(t)
	idp.email = email
	idp.emailVerified = verified
	_, ts, client := startOIDCBFF(t, idp, nil, mut)
	h := loginHops(t, ts, client, "/")
	if h.callback.StatusCode != http.StatusForbidden {
		t.Fatalf("refused identity: got %d (%s), want 403", h.callback.StatusCode, h.cbBody)
	}
	return h.callback, h.cbBody
}

// (1) The page is HTML, in the required order: identity echo → not granted → contact the
// operator → try another account. The identity echo proves the LOGIN worked; the rest is the way
// forward.
func TestDeniedPage_StyledHTMLWithIdentityEchoInOrder(t *testing.T) {
	resp, body := deniedFlow(t, "mallory@example.com", nil, nil)

	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Fatalf("Content-Type = %q, want text/html — a human mid-redirect gets a page, not JSON", ct)
	}
	must := []string{
		"signed in as",
		"mallory@example.com",
		"has not granted you access",
		"contact the person who runs",
		"/auth/login?prompt=select_account",
	}
	pos := -1
	for _, m := range must {
		i := strings.Index(body, m)
		if i < 0 {
			t.Fatalf("denied page missing %q; body=%s", m, body)
		}
		if i < pos {
			t.Errorf("denied page element %q out of order", m)
		}
		pos = i
	}
}

// (2) The echoed identity is attacker-controlled (an IdP claim) — it must render escaped.
func TestDeniedPage_EscapesHostileEmail(t *testing.T) {
	_, body := deniedFlow(t, `<img src=x onerror=alert(1)>@evil.example`, nil, nil)
	if strings.Contains(body, "<img") {
		t.Fatal("hostile email rendered unescaped — XSS in the denied page")
	}
	if !strings.Contains(body, "&lt;img") {
		t.Fatalf("expected the escaped identity to still be echoed; body=%s", body)
	}
}

// (3) THE SECURITY PROPERTY DOES NOT MOVE: the refusal creates no session server-side and sets no
// session cookie. (The pending-flow cookie is CLEARED on the same response — that Set-Cookie is
// required teardown of the spent flow, not a session.)
func TestDeniedPage_NoSessionNoSessionCookie(t *testing.T) {
	idp := newFakeIDP(t)
	idp.email = "mallory@example.com"
	_, ts, client := startOIDCBFF(t, idp, nil, nil)
	h := loginHops(t, ts, client, "/")
	if h.callback.StatusCode != http.StatusForbidden {
		t.Fatalf("got %d, want 403", h.callback.StatusCode)
	}
	if cookieNamed(h.callback, sessionCookieName) != nil {
		t.Fatal("denied page set a session cookie")
	}
	for _, c := range h.callback.Cookies() {
		if c.Name != pendingCookieName {
			t.Fatalf("denied response touched unexpected cookie %q", c.Name)
		}
		if c.MaxAge >= 0 && c.Value != "" {
			t.Fatalf("pending cookie must only be CLEARED on refusal, got %+v", c)
		}
	}
	// Server-side: still anonymous, API still shut.
	resp, meBody := doReq(t, client, http.MethodGet, ts.URL+"/auth/me")
	if resp.StatusCode != http.StatusOK || !strings.Contains(meBody, `"authenticated":false`) {
		t.Fatalf("/auth/me after refusal: %d %s — a session leaked", resp.StatusCode, meBody)
	}
	apiResp, _ := doReq(t, client, http.MethodGet, ts.URL+"/api/context")
	if apiResp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("/api after refusal: got %d, want 401", apiResp.StatusCode)
	}
}

// (4) NOT A PROBE: the page is byte-identical whatever the refusal cause — excluded from a
// populated list, an EMPTY list, or an issuer-unverified email that IS on the list. A refused
// stranger learns only that they were refused.
func TestDeniedPage_UniformAcrossRefusalCauses(t *testing.T) {
	_, populated := deniedFlow(t, "mallory@example.com", nil, nil)
	_, empty := deniedFlow(t, "mallory@example.com", nil, func(c *config) {
		c.allowedEmails = nil
	})
	unverifiedFalse := false
	_, unverified := deniedFlow(t, "mallory@example.com", &unverifiedFalse, func(c *config) {
		c.allowedEmails = []string{"mallory@example.com"} // listed, but the issuer disputes the email
	})

	if populated != empty {
		t.Error("denied page distinguishes empty allowlist from not-on-list — a probe channel")
	}
	if populated != unverified {
		t.Error("denied page distinguishes unverified-email from not-on-list — a probe channel")
	}
}

// (5) NO ALLOWLIST LEAKAGE of any kind: not the env var's name, not who is allowed, not the
// internal refusal reason.
func TestDeniedPage_LeaksNothing(t *testing.T) {
	_, body := deniedFlow(t, "mallory@example.com", nil, func(c *config) {
		c.allowedEmails = []string{"ng@example.com", "founder@example.com"}
	})
	for _, leak := range []string{
		"OIDC_ALLOWED_EMAILS", "allowlist", "allow-list",
		"ng@example.com", "founder@example.com",
		"unverified", "not in",
	} {
		if strings.Contains(body, leak) {
			t.Errorf("denied page leaks %q", leak)
		}
	}
}

// (6) An identity with NO email claim (non-wildcard list) is still refused with the same page —
// minus the identity echo there is nothing to echo — and still leaks no cause.
func TestDeniedPage_NoEmailClaimStillStyledAndSilent(t *testing.T) {
	resp, body := deniedFlow(t, "", nil, nil)
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Fatalf("Content-Type = %q, want text/html", ct)
	}
	if strings.Contains(body, "signed in as") {
		t.Error("no identity to echo — the page must not fabricate one")
	}
	for _, m := range []string{"has not granted you access", "contact the person who runs", "/auth/login?prompt=select_account"} {
		if !strings.Contains(body, m) {
			t.Errorf("no-email denied page missing %q", m)
		}
	}
	if strings.Contains(body, "email claim") || strings.Contains(body, "no email") {
		t.Error("page explains the internal refusal cause — it must not")
	}
}

// (7) The restart link works and is gated to the ONE literal the page emits: /auth/login forwards
// prompt=select_account to the IdP, forwards nothing for other values, and adds nothing by default.
func TestLogin_PromptSelectAccountGatedLiteral(t *testing.T) {
	idp := newFakeIDP(t)
	_, ts, client := startOIDCBFF(t, idp, nil, nil)

	for _, tc := range []struct {
		query      string
		wantPrompt bool
	}{
		{"", false},
		{"?prompt=select_account", true},
		{"?prompt=consent", false}, // arbitrary client input never reaches the IdP URL
		{"?prompt=evil%20thing", false},
	} {
		resp, _ := doReq(t, client, http.MethodGet, ts.URL+"/auth/login"+tc.query)
		if resp.StatusCode != http.StatusFound {
			t.Fatalf("login%s: got %d, want 302", tc.query, resp.StatusCode)
		}
		loc := resp.Header.Get("Location")
		hasPrompt := strings.Contains(loc, "prompt=select_account")
		if hasPrompt != tc.wantPrompt {
			t.Errorf("login%s: prompt forwarded=%v, want %v (Location=%s)", tc.query, hasPrompt, tc.wantPrompt, loc)
		}
		if strings.Contains(loc, "consent") || strings.Contains(loc, "evil") {
			t.Errorf("login%s: arbitrary prompt value reached the IdP URL: %s", tc.query, loc)
		}
	}
}
