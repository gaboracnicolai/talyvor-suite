package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// pricingApp: an oidc-mode app with NO session seeded, pointed at a fake Lens whose public
// conversion-rate route answers `status` and records whether a credential was sent.
func pricingApp(t *testing.T, status int) (*app, *string, *int) {
	t.Helper()
	gotAuth, hits := "", 0
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/economy/conversion-rate" {
			t.Errorf("/api/pricing dialled %s — it may read the public peg and nothing else", r.URL.Path)
		}
		hits++
		gotAuth = r.Header.Get("Authorization")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, `{"rate":1.5,"usd_per_lxc":0.10,"lens_per_lxc":1.5}`)
	}))
	t.Cleanup(up.Close)
	cfg := config{
		lensBaseURL: up.URL, provisionSecret: testProvisionSecret,
		authMode: authModeOIDC, oidcIssuer: "https://idp.example.com",
		publicBaseURL: "https://app.talyvor.com", sessionTTL: time.Hour,
	}
	a := newApp(cfg, newSessionOnlyAuthenticator(cfg))
	a.cfg.webDist = t.TempDir()
	return a, &gotAuth, &hits
}

func getPricing(t *testing.T, a *app) map[string]any {
	t.Helper()
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/pricing", nil)) // no cookie
	if rec.Code != http.StatusOK {
		t.Fatalf("anonymous GET /api/pricing: got %d, want 200 (body %s)", rec.Code, rec.Body.String())
	}
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (body %s)", err, rec.Body.String())
	}
	return out
}

// A buyer with no account reads the peg Lens serves and the top-up range checkout enforces.
func TestPricing_AnswersAStrangerWithThePegAndTheRange(t *testing.T) {
	a, gotAuth, hits := pricingApp(t, http.StatusOK)
	out := getPricing(t, a)

	if out["usd_per_lxc"] != 0.1 {
		t.Errorf("usd_per_lxc = %v, want 0.1 as Lens served it", out["usd_per_lxc"])
	}
	if out["min_usd_cents"] != float64(minTopUpCents) || out["max_usd_cents"] != float64(maxTopUpCents) {
		t.Errorf("range = %v..%v, want the bounds checkout enforces (%d..%d)",
			out["min_usd_cents"], out["max_usd_cents"], minTopUpCents, maxTopUpCents)
	}
	if *gotAuth != "" {
		t.Errorf("the public peg read sent Authorization %q — an anonymous route has no credential to send", *gotAuth)
	}

	// A second reader is served the confirmed peg without Lens being dialled again.
	getPricing(t, a)
	if *hits != 1 {
		t.Errorf("Lens was dialled %d times for two anonymous reads, want 1", *hits)
	}
}

// When Lens will not confirm the peg (economy off ⇒ 404), the field is ABSENT — never 0.
func TestPricing_OmitsThePegLensWillNotConfirm(t *testing.T) {
	a, _, _ := pricingApp(t, http.StatusNotFound)
	out := getPricing(t, a)
	if v, present := out["usd_per_lxc"]; present {
		t.Errorf("usd_per_lxc = %v on a Lens that 404s the rate — it must be omitted", v)
	}
	if out["min_usd_cents"] != float64(minTopUpCents) {
		t.Errorf("the range must still be served without a peg; got %v", out)
	}
}
