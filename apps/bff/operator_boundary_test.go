package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// THE OPERATOR BOUNDARY.
//
// Lens already exposes the cross-tenant admin reads (/v1/admin/workspaces, /v1/admin/billing/…,
// /v1/admin/economy/flags, …). The blocker was never the backend — it is that this BFF boots with
// `allowlist=OPEN` and `signup_open=true`, so EVERY Google account that signs up gets a full
// session. Adding an admin read without a second boundary would show every tenant's spend,
// purchases and royalties to anyone who ever signed up.
//
// ⚠ OPERATOR IS NOT THE SIGNUP ALLOWLIST. OIDC_ALLOWED_EMAILS governs who may sign IN; the operator
// list governs who may see EVERYTHING. Conflating them is the bug, so a signed-in non-operator is
// asserted to be refused.
//
// ⚠ IDENTITY IS (issuer, sub), NOT EMAIL — argued in operator.go. The tests use `sub` accordingly.

const opOrigin = "https://app.talyvor.com"

// operatorApp builds an oidc-mode app whose OPERATOR list is exactly `subs`, with two seeded
// sessions: an operator and an ordinary signed-in user.
func operatorApp(t *testing.T, subs []string) (*app, *http.Cookie, *http.Cookie) {
	t.Helper()
	cfg := config{
		lensBaseURL: "http://127.0.0.1:1", provisionSecret: testProvisionSecret,
		authMode: authModeOIDC, oidcIssuer: "https://idp.example.com",
		publicBaseURL: opOrigin, sessionTTL: time.Hour,
		operatorSubs: subs,
	}
	auth := newSessionOnlyAuthenticator(cfg)
	seedProvisionedSession(auth, "sid-op", "sub-operator", "op@example.com", "ws-op")
	seedProvisionedSession(auth, "sid-user", "sub-ordinary", "user@example.com", "ws-user")
	a := newApp(cfg, auth)
	a.cfg.webDist = t.TempDir()
	return a,
		&http.Cookie{Name: sessionCookieName, Value: "sid-op"},
		&http.Cookie{Name: sessionCookieName, Value: "sid-user"}
}

func getAdmin(t *testing.T, a *app, sess *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/admin/workspaces", nil)
	req.Header.Set("Origin", opOrigin)
	if sess != nil {
		req.AddCookie(sess)
	}
	a.ServeHTTP(rec, req)
	return rec
}

// ⚠ THE SINGLE MOST IMPORTANT TEST IN THIS WORK. An empty operator list refuses EVERY identity,
// including the deployment owner's. Unset means NOBODY — not "everyone", not "the first user", not
// "the deployment owner by inference". A boundary whose default is open is not a boundary.
func TestOperator_EmptyListRefusesEveryone(t *testing.T) {
	a, opSess, userSess := operatorApp(t, nil)
	for name, sess := range map[string]*http.Cookie{"would-be operator": opSess, "ordinary user": userSess} {
		if code := getAdmin(t, a, sess).Code; code != http.StatusForbidden {
			t.Errorf("%s got %d with an EMPTY operator list, want 403 — an unset list must admit "+
				"nobody, or the boundary defaults to open on every fresh deployment", name, code)
		}
	}
}

// The operator reads. Without this the three refusal tests pass on a boundary that refuses
// everything, which is useless.
func TestOperator_OperatorIsAdmitted(t *testing.T) {
	a, opSess, _ := operatorApp(t, []string{"sub-operator"})
	if code := getAdmin(t, a, opSess).Code; code == http.StatusForbidden || code == http.StatusUnauthorized {
		t.Fatalf("the configured operator was refused (%d) — the boundary admits nobody", code)
	}
}

// ⚠ THE CONFLATION TEST. A signed-in identity that is NOT on the operator list is refused, even
// though the signup allowlist admitted them. allowlist=OPEN governs sign-in; operator governs
// seeing everything.
func TestOperator_SignedInNonOperatorRefused(t *testing.T) {
	a, _, userSess := operatorApp(t, []string{"sub-operator"})
	rec := getAdmin(t, a, userSess)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("an ordinary signed-in user got %d, want 403 — every account that signs up would "+
			"otherwise read every tenant's spend, purchases and royalties", rec.Code)
	}
}

func TestOperator_UnauthenticatedRefused(t *testing.T) {
	a, _, _ := operatorApp(t, []string{"sub-operator"})
	if code := getAdmin(t, a, nil).Code; code != http.StatusUnauthorized && code != http.StatusForbidden {
		t.Fatalf("an unauthenticated caller got %d, want 401/403", code)
	}
}

// ⚠ THE ROUTES ARE NOT PATH-EXEMT FROM THE ServeHTTP GATE (#84) — asserted, and the result is more
// nuanced than "they inherit it", so it is written down rather than assumed.
//
// sameOriginWriteAllowed gates WRITE methods only: its default arm returns true because "reads and
// preflights are not write paths". So an admin GET is NOT origin-checked, and asserting a 403 for a
// cross-origin GET would have been asserting a behaviour this design deliberately does not have.
//
// What actually protects a cross-origin READ is the cookie: __Host-talyvor_session is Secure,
// HttpOnly and SameSite=Lax, so a fetch from another origin never carries it and the request
// arrives unauthenticated. That is asserted below as the real property.
//
// What IS asserted about the gate is that these paths are not exempt from it — originExemptPath
// returns false unconditionally today, and a future exemption added for a webhook must not
// accidentally cover /api/admin/. A write method to an admin path from a foreign origin is refused
// before routing.
func TestOperator_AdminPathsAreNotOriginExempt(t *testing.T) {
	a, opSess, _ := operatorApp(t, []string{"sub-operator"})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/admin/workspaces", nil)
	req.Header.Set("Origin", "https://evil.example.com")
	req.AddCookie(opSess)
	a.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("cross-origin WRITE to an admin path got %d, want 403 — the path is exempt from "+
			"the ServeHTTP origin gate", rec.Code)
	}
}

// The real cross-origin read defence: no cookie, no session, no data.
func TestOperator_CrossOriginReadArrivesWithoutTheCookie(t *testing.T) {
	a, _, _ := operatorApp(t, []string{"sub-operator"})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/admin/workspaces", nil)
	req.Header.Set("Origin", "https://evil.example.com")
	// deliberately NO cookie — SameSite=Lax means the browser would not send one
	a.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized && rec.Code != http.StatusForbidden {
		t.Fatalf("cross-origin read without a session got %d, want 401/403", rec.Code)
	}
}

// ⚠ POSITIVE CONTROL ON THE WHOLE SUITE. A boundary that refuses everything passes three of the
// four required tests. This proves the admitted path and the refused path are DIFFERENT — same
// route, same origin, same method, only the identity changes.
func TestOperator_AdmittedAndRefusedAreDistinguishable(t *testing.T) {
	a, opSess, userSess := operatorApp(t, []string{"sub-operator"})
	op := getAdmin(t, a, opSess).Code
	user := getAdmin(t, a, userSess).Code
	if op == user {
		t.Fatalf("operator and ordinary user both got %d — the boundary does not distinguish them, "+
			"so the refusal tests prove nothing", op)
	}
	if user != http.StatusForbidden {
		t.Fatalf("ordinary user got %d, want 403", user)
	}
}
