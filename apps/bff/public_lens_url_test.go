package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The setup page prints a base URL a customer pastes into their own tooling. cfg.lensBaseURL is
// the address the BFF uses to REACH Lens — it defaults to http://127.0.0.1:8080 and in a real
// deployment is a loopback or compose-internal address. Printing it would hand every trial user
// a URL that cannot resolve from their machine, which is the "one character wrong" failure in
// its largest form.
//
// So the public URL is a SEPARATE, explicitly-configured value, and /api/context carries both:
// lens_base_url (unchanged, internal) and lens_public_base_url (new, customer-facing).
//
// It has NO default on purpose. An unset value must surface as empty so the page can say "ask
// your operator", never silently fall back to the internal address — the same reasoning that
// removed the compose secret default in talyvor-docs.
func contextBody(t *testing.T, a *app) map[string]string {
	t.Helper()
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/context", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("/api/context: got %d, want 200", rec.Code)
	}
	var out map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode /api/context: %v (body %s)", err, rec.Body.String())
	}
	return out
}

func TestContext_CarriesPublicLensURL(t *testing.T) {
	const pub = "https://lens.talyvor.com"
	a := newTestAppWithPublicLens(t, pub)

	body := contextBody(t, a)
	got, ok := body["lens_public_base_url"]
	if !ok {
		t.Fatal("/api/context must carry lens_public_base_url — the setup page has no other " +
			"trustworthy source for the URL it tells customers to paste")
	}
	if got != pub {
		t.Errorf("lens_public_base_url = %q, want %q", got, pub)
	}
	// The internal address must NOT be what a customer is shown.
	if got == body["lens_base_url"] {
		t.Errorf("public and internal Lens URLs are identical (%q) — the internal one is a "+
			"loopback/compose address a customer cannot reach", got)
	}
}

func TestContext_PublicLensURLIsEmptyWhenUnset(t *testing.T) {
	a := newTestApp(t, nil) // no public URL configured

	body := contextBody(t, a)
	got, ok := body["lens_public_base_url"]
	if !ok {
		t.Fatal("the field must always be present so the UI can branch on empty, " +
			"rather than on a missing key")
	}
	if got != "" {
		t.Errorf("unset LENS_PUBLIC_BASE_URL must surface as empty, got %q — a silent fallback "+
			"to the internal address is exactly the failure this separation prevents", got)
	}
	if strings.Contains(got, "127.0.0.1") || strings.Contains(got, "localhost") {
		t.Errorf("never expose a loopback address as the customer-facing URL: %q", got)
	}
}

// Still no credential, on either path. The original context test asserts this; re-assert it
// here because we just added a field to the same response.
func TestContext_StillCarriesNoCredential(t *testing.T) {
	a := newTestAppWithPublicLens(t, "https://lens.talyvor.com")
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/context", nil))
	body := rec.Body.String()
	for _, marker := range []string{"tlv_", "provisionSecret", testProvisionSecret} {
		if marker != "" && strings.Contains(body, marker) {
			t.Errorf("/api/context leaked %q: %s", marker, body)
		}
	}
}

// newTestAppWithPublicLens mirrors newTestApp but configures the customer-facing URL.
func newTestAppWithPublicLens(t *testing.T, publicLens string) *app {
	t.Helper()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(upstream.Close)
	return newApp(config{
		addr:              "127.0.0.1:0",
		lensBaseURL:       upstream.URL,
		lensPublicBaseURL: publicLens,
		provisionSecret:   testProvisionSecret,
		webDist:           t.TempDir(),
		authMode:          authModeDisabled,
	}, nil)
}
