package main

import (
	"encoding/json"
	"io"
	"net/http"
	"sync"
	"time"
)

// handlePricing — GET /api/pricing (B5.2). What anything costs, answered to someone who has not
// signed up, so the /pricing page can print a price and a buyer can check it against the server.
//
//	{"usd_per_lxc":0.1, "min_usd_cents":1000, "max_usd_cents":1000000, "preset_usd_cents":[1000,5000,10000],
//	 "plans":[{"id":"plus","usd_cents":2000,"included_ulxc":191200000}, …]}
//
// PUBLIC ON PURPOSE, like /api/version: the audience is by definition not signed in. It can afford
// to be — every field is a constant a signed-in customer already sees on /billing, and nothing here
// is read from a workspace:
//
//   - usd_per_lxc is Lens's public GET /v1/economy/conversion-rate, read with NO credential (there
//     is no session to take one from). OMITTED — never zero, never a literal from this repo — when
//     Lens will not confirm it, for the reason fetchUSDPerLXC gives: a wrong price is worse than
//     none. An economy-off deployment 404s that route, so it prints no rate, which is true.
//   - the bounds and presets are the SAME declarations the checkout write path enforces
//     (billing.go), so the range this route advertises is the range /api/lxc/checkout accepts.
//   - plans (B28.5) is Lens's public GET /v1/billing/plans, as Lens states it: each plan's price and
//     the usage it includes this month — what a new subscriber to it is granted (talyvor-lens
//     B28.439). OMITTED, like the peg, when Lens will not state it; a deployment that sells no
//     plans 404s that route.
//   - company_plans, byok_add_on_usd_cents and enterprise_from_usd_cents (B32.14) come from the same
//     read: Team's and Business's Stripe prices, BYOK's as Team's add-on, and the figure Enterprise
//     starts from (talyvor-lens B32.77). Each OMITTED on its own when Lens does not state it.
//   - plan_gates (B32.14) is Lens's public GET /v1/public/plan-gates: what each company plan unlocks
//     (talyvor-lens B32.12), -1 meaning unlimited. fees is its GET /v1/public/fees: every fee Talyvor
//     charges, as lens.env sets it (B32.8). Each OMITTED when Lens will not state it.
func (a *app) handlePricing(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	out := map[string]any{
		"min_usd_cents":    minTopUpCents,
		"max_usd_cents":    maxTopUpCents,
		"preset_usd_cents": allowedTopUpCents,
	}
	if peg, ok := a.public.peg.get(func() (float64, bool) { return a.readUSDPerLXC(r, "") }); ok {
		out["usd_per_lxc"] = peg
	}
	if card, ok := a.public.plans.get(func() (planCard, bool) { return a.readPlans(r) }); ok {
		if len(card.Plans) > 0 {
			out["plans"] = card.Plans
		}
		if len(card.CompanyPlans) > 0 {
			out["company_plans"] = card.CompanyPlans
		}
		if card.BYOKAddOnUSDCents > 0 {
			out["byok_add_on_usd_cents"] = card.BYOKAddOnUSDCents
		}
		if card.EnterpriseFromUSDCents > 0 {
			out["enterprise_from_usd_cents"] = card.EnterpriseFromUSDCents
		}
	}
	if gates, ok := a.public.gates.get(func() (planGates, bool) { return a.readPlanGates(r) }); ok {
		out["plan_gates"] = gates
	}
	if fees, ok := a.public.fees.get(func() (publicFees, bool) { return a.readFees(r) }); ok {
		out["fees"] = fees
	}
	w.Header().Set("Cache-Control", "public, max-age=300")
	writeJSON(w, http.StatusOK, out)
}

// pricedPlan is one plan as Lens's public plans read states it: its price, and the µLXC of usage it
// includes this month.
type pricedPlan struct {
	ID           string `json:"id"`
	USDCents     int64  `json:"usd_cents"`
	IncludedULXC int64  `json:"included_ulxc"`
}

// companyPlan is a company plan's monthly Stripe price as Lens states it (B32.10's Team and Business).
type companyPlan struct {
	ID       string `json:"id"`
	USDCents int64  `json:"usd_cents"`
}

// planCard is everything Lens's public plans read states: the chat plans with their included usage, and
// (talyvor-lens B32.77) the company plans' prices, BYOK's as Team's add-on, and where Enterprise starts.
type planCard struct {
	Plans                  []pricedPlan  `json:"plans"`
	CompanyPlans           []companyPlan `json:"company_plans"`
	BYOKAddOnUSDCents      int64         `json:"byok_add_on_usd_cents"`
	EnterpriseFromUSDCents int64         `json:"enterprise_from_usd_cents"`
}

// readPlans reads Lens's public GET /v1/billing/plans with no credential. ok=false for anything but a 200
// stating at least one price. Each part is then kept only when every figure in it is whole: the chat plans
// each with an id, a price and a positive included usage; the company plans each with an id and a price. A
// plan card printing a figure Lens did not state is worse than none.
func (a *app) readPlans(r *http.Request) (planCard, bool) {
	var body planCard
	if !a.readPublic(r, "/v1/billing/plans", &body) {
		return planCard{}, false
	}
	for _, p := range body.Plans {
		if p.ID == "" || p.USDCents <= 0 || p.IncludedULXC <= 0 {
			body.Plans = nil
			break
		}
	}
	for _, p := range body.CompanyPlans {
		if p.ID == "" || p.USDCents <= 0 {
			body.CompanyPlans = nil
			break
		}
	}
	if len(body.Plans) == 0 && len(body.CompanyPlans) == 0 && body.BYOKAddOnUSDCents <= 0 && body.EnterpriseFromUSDCents <= 0 {
		return planCard{}, false
	}
	return body, true
}

// planGates is Lens's GET /v1/public/plan-gates (talyvor-lens B32.12): the company plans from the smallest
// up, and what each unlocks. -1 is unlimited.
type planGates struct {
	Order []string            `json:"order"`
	Plans map[string]planGate `json:"plans"`
}

type planGate struct {
	Agents              int64  `json:"agents"`
	Seats               int64  `json:"seats"`
	OwnProviderKeys     string `json:"own_provider_keys"` // none, add_on or included
	LiveMoney           bool   `json:"live_money"`
	SlackTeamsApprovals bool   `json:"slack_teams_approvals"`
	SSO                 bool   `json:"sso"`
	AuditExport         bool   `json:"audit_export"`
	Edge                bool   `json:"edge"`
}

// readPlanGates reads the gates with no credential. ok=false unless every plan in the order has its gates.
func (a *app) readPlanGates(r *http.Request) (planGates, bool) {
	var g planGates
	if !a.readPublic(r, "/v1/public/plan-gates", &g) || len(g.Order) == 0 {
		return planGates{}, false
	}
	for _, name := range g.Order {
		if _, ok := g.Plans[name]; !ok {
			return planGates{}, false
		}
	}
	return g, true
}

// publicFees is Lens's GET /v1/public/fees (talyvor-lens B32.8), under its names: basis points, or minor
// units of the currency named.
type publicFees struct {
	MarketTakeBPS       int64            `json:"market_take_bps"`
	ServicesTakeBPS     int64            `json:"services_take_bps"`
	ComputeTakeBPS      int64            `json:"compute_take_bps"`
	LendingFeeBPS       int64            `json:"lending_fee_bps"`
	PlatformFeeBPS      map[string]int64 `json:"platform_fee_bps"`
	FXMarginBPS         map[string]int64 `json:"fx_margin_bps"`
	IntlPaymentFeeMinor map[string]int64 `json:"intl_payment_fee_minor"`
	MerchantFeeBPS      int64            `json:"merchant_fee_bps"`
	MerchantA2AFeeBPS   int64            `json:"merchant_a2a_fee_bps"`
}

// readFees reads the fees with no credential. ok=false unless the per-plan and per-currency fees are stated.
func (a *app) readFees(r *http.Request) (publicFees, bool) {
	var f publicFees
	if !a.readPublic(r, "/v1/public/fees", &f) || len(f.PlatformFeeBPS) == 0 || len(f.FXMarginBPS) == 0 ||
		len(f.IntlPaymentFeeMinor) == 0 {
		return publicFees{}, false
	}
	return f, true
}

// readPublic GETs one of Lens's public reads with no credential and decodes a 200 into `into`.
func (a *app) readPublic(r *http.Request, path string, into any) bool {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, a.cfg.lensBaseURL+path, nil)
	if err != nil {
		return false
	}
	req.Header.Set("Accept", "application/json")
	resp, err := a.client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, resp.Body) // drain so the connection is reusable
		return false
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(into) == nil
}

// publicPegTTL — how long a CONFIRMED peg (or plan list) is reused. The peg is a constant upstream; the
// cache exists because an anonymous route that dialled Lens on every hit would let anyone spend Lens's
// public rate limit from this BFF's address, and the signed-in /billing read shares that address.
const publicPegTTL = 5 * time.Minute

// pricingReads are /api/pricing's Lens reads, each cached on its own.
type pricingReads struct {
	peg   publicCache[float64]
	plans publicCache[planCard]
	gates publicCache[planGates]
	fees  publicCache[publicFees]
}

// publicCache holds the last CONFIRMED answer to one public read. A failure is never cached, so a
// Lens that comes back is asked again on the next request rather than five minutes later.
type publicCache[T any] struct {
	mu  sync.Mutex
	val T
	at  time.Time
}

func (c *publicCache[T]) get(read func() (T, bool)) (T, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.at.IsZero() && time.Since(c.at) < publicPegTTL {
		return c.val, true
	}
	v, ok := read()
	if ok {
		c.val, c.at = v, time.Now()
	}
	return v, ok
}
