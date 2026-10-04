package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// lensPlans is talyvor-lens B28.439's GET /v1/billing/plans at h = 0.
const lensPlans = `{"plans":[{"id":"plus","usd_cents":2000,"included_ulxc":191200000},` +
	`{"id":"pro","usd_cents":10000,"included_ulxc":968000000},{"id":"max","usd_cents":20000,"included_ulxc":1939000000}]}`

// pricingApp: an oidc-mode app with NO session seeded, pointed at a fake Lens whose public
// conversion-rate and plans routes answer `status` and record whether a credential was sent.
func pricingApp(t *testing.T, status int) (*app, *string, map[string]int) {
	t.Helper()
	gotAuth, hits := "", map[string]int{}
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := `{"rate":1.5,"usd_per_lxc":0.10,"lens_per_lxc":1.5}`
		switch r.URL.Path {
		case "/v1/economy/conversion-rate":
		case "/v1/billing/plans":
			body = lensPlans
		default:
			t.Errorf("/api/pricing dialled %s — it may read the public peg and plans and nothing else", r.URL.Path)
		}
		hits[r.URL.Path]++
		if auth := r.Header.Get("Authorization"); auth != "" {
			gotAuth = auth
		}
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(up.Close)
	cfg := config{
		lensBaseURL: up.URL, provisionSecret: testProvisionSecret,
		authMode: authModeOIDC, oidcIssuer: "https://idp.example.com",
		publicBaseURL: "https://app.talyvor.com", sessionTTL: time.Hour,
	}
	a := newApp(cfg, newSessionOnlyAuthenticator(cfg))
	a.cfg.webDist = t.TempDir()
	return a, &gotAuth, hits
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
	if n := hits["/v1/economy/conversion-rate"]; n != 1 {
		t.Errorf("Lens's peg was read %d times for two anonymous reads, want 1", n)
	}
}

// B28.5 — each plan's price and included usage, exactly as Lens's public plans read states them, so the
// Plans page prints Lens's figure and never one typed into this repo.
func TestPricing_ServesEachPlansIncludedUsageAsLensStatesIt(t *testing.T) {
	a, gotAuth, hits := pricingApp(t, http.StatusOK)
	out := getPricing(t, a)

	got, _ := json.Marshal(out["plans"])
	var want struct{ Plans any }
	_ = json.Unmarshal([]byte(lensPlans), &want)
	if wantJSON, _ := json.Marshal(want.Plans); string(got) != string(wantJSON) {
		t.Errorf("plans = %s, want Lens's %s", got, wantJSON)
	}
	if *gotAuth != "" {
		t.Errorf("the public plans read sent Authorization %q — an anonymous route has no credential to send", *gotAuth)
	}
	getPricing(t, a)
	if n := hits["/v1/billing/plans"]; n != 1 {
		t.Errorf("Lens's plans were read %d times for two anonymous reads, want 1", n)
	}
}

// When Lens will not confirm the peg (economy off ⇒ 404), the field is ABSENT — never 0.
func TestPricing_OmitsThePegLensWillNotConfirm(t *testing.T) {
	a, _, _ := pricingApp(t, http.StatusNotFound)
	out := getPricing(t, a)
	if v, present := out["usd_per_lxc"]; present {
		t.Errorf("usd_per_lxc = %v on a Lens that 404s the rate — it must be omitted", v)
	}
	if v, present := out["plans"]; present {
		t.Errorf("plans = %v on a Lens that sells no plans — it must be omitted", v)
	}
	if out["min_usd_cents"] != float64(minTopUpCents) {
		t.Errorf("the range must still be served without a peg; got %v", out)
	}
}
