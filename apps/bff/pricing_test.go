package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// lensPlans is talyvor-lens B28.439's GET /v1/billing/plans at h = 0.
const lensPlans = `{"plans":[{"id":"plus","usd_cents":2000,"included_ulxc":191200000},` +
	`{"id":"pro","usd_cents":10000,"included_ulxc":968000000},{"id":"max","usd_cents":20000,"included_ulxc":1939000000}]}`

// lensPlanGates and lensFees are talyvor-lens B32.12's GET /v1/public/plan-gates and B32.8's GET /v1/public/fees.
const lensPlanGates = `{"order":["free","team","business","enterprise"],"plans":{` +
	`"free":{"agents":3,"seats":1,"own_provider_keys":"none","live_money":false,"slack_teams_approvals":false,"sso":false,"audit_export":false,"edge":false},` +
	`"team":{"agents":25,"seats":5,"own_provider_keys":"add_on","live_money":true,"slack_teams_approvals":true,"sso":false,"audit_export":false,"edge":false},` +
	`"business":{"agents":-1,"seats":25,"own_provider_keys":"included","live_money":true,"slack_teams_approvals":true,"sso":true,"audit_export":true,"edge":false},` +
	`"enterprise":{"agents":-1,"seats":-1,"own_provider_keys":"included","live_money":true,"slack_teams_approvals":true,"sso":true,"audit_export":true,"edge":true}}}`

const lensFees = `{"market_take_bps":1500,"services_take_bps":500,"compute_take_bps":500,"lending_fee_bps":100,` +
	`"platform_fee_bps":{"free":550,"team":300,"business":100,"enterprise":100},` +
	`"fx_margin_bps":{"free":0,"team":50,"business":25,"enterprise":15},` +
	`"intl_payment_fee_minor":{"GBP":500,"EUR":600,"USD":700},"merchant_fee_bps":75,"merchant_a2a_fee_bps":100}`

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
		case "/v1/public/plan-gates":
			body = lensPlanGates
		case "/v1/public/fees":
			body = lensFees
		default:
			t.Errorf("/api/pricing dialled %s — it may read the public peg, plans, plan gates and fees and nothing else", r.URL.Path)
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

// B32.14 — whatever Lens states, /api/pricing serves: changed company prices, gates and fees reach the
// page as Lens wrote them, never a figure from this repo.
func TestPricing_ServesThePriceCardLensStates(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/economy/conversion-rate":
			_, _ = io.WriteString(w, `{"usd_per_lxc":0.10}`)
		case "/v1/billing/plans":
			_, _ = io.WriteString(w, `{"plans":[{"id":"plus","usd_cents":2100,"included_ulxc":180000000}],`+
				`"company_plans":[{"id":"team","usd_cents":5900},{"id":"business","usd_cents":34900}],`+
				`"byok_add_on_usd_cents":20900,"enterprise_from_usd_cents":300000}`)
		case "/v1/public/plan-gates":
			_, _ = io.WriteString(w, strings.Replace(lensPlanGates, `"agents":25`, `"agents":40`, 1))
		case "/v1/public/fees":
			_, _ = io.WriteString(w, strings.Replace(lensFees, `"market_take_bps":1500`, `"market_take_bps":1200`, 1))
		}
	}))
	t.Cleanup(up.Close)
	a, _, _ := pricingApp(t, http.StatusOK)
	a.cfg.lensBaseURL = up.URL
	out := getPricing(t, a)

	company, _ := json.Marshal(out["company_plans"])
	if string(company) != `[{"id":"team","usd_cents":5900},{"id":"business","usd_cents":34900}]` {
		t.Errorf("company_plans = %s, want Team 5900 and Business 34900 as Lens stated them", company)
	}
	if out["byok_add_on_usd_cents"] != float64(20900) || out["enterprise_from_usd_cents"] != float64(300000) {
		t.Errorf("byok_add_on = %v, enterprise_from = %v; want 20900 and 300000", out["byok_add_on_usd_cents"], out["enterprise_from_usd_cents"])
	}
	gates, _ := out["plan_gates"].(map[string]any)
	team, _ := gates["plans"].(map[string]any)["team"].(map[string]any)
	if team["agents"] != float64(40) || team["own_provider_keys"] != "add_on" {
		t.Errorf("plan_gates.team = %v, want 40 agents and own keys as an add-on", team)
	}
	fees, _ := out["fees"].(map[string]any)
	if fees["market_take_bps"] != float64(1200) || fees["platform_fee_bps"].(map[string]any)["team"] != float64(300) {
		t.Errorf("fees = %v, want the marketplace take 1200 and Team's platform fee 300", fees)
	}
}

// A Lens that does not state the gates or the fees leaves them out — the page then prints no row it cannot back.
func TestPricing_OmitsGatesAndFeesLensWillNotState(t *testing.T) {
	a, _, _ := pricingApp(t, http.StatusServiceUnavailable)
	out := getPricing(t, a)
	for _, k := range []string{"plan_gates", "fees", "company_plans", "byok_add_on_usd_cents", "enterprise_from_usd_cents"} {
		if _, ok := out[k]; ok {
			t.Errorf("%s = %v from a Lens that answered 503 — want it omitted", k, out[k])
		}
	}
}
