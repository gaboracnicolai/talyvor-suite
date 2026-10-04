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
	if plans, ok := a.public.plans.get(func() ([]pricedPlan, bool) { return a.readPlans(r) }); ok {
		out["plans"] = plans
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

// readPlans reads Lens's public GET /v1/billing/plans with no credential. ok=false — and the field
// omitted — for anything but a 200 carrying at least one plan, every one with an id, a price and a
// positive included usage: a plan card printing a figure Lens did not state is worse than none.
func (a *app) readPlans(r *http.Request) ([]pricedPlan, bool) {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, a.cfg.lensBaseURL+"/v1/billing/plans", nil)
	if err != nil {
		return nil, false
	}
	req.Header.Set("Accept", "application/json")
	resp, err := a.client.Do(req)
	if err != nil {
		return nil, false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, resp.Body) // drain so the connection is reusable
		return nil, false
	}
	var body struct {
		Plans []pricedPlan `json:"plans"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&body); err != nil || len(body.Plans) == 0 {
		return nil, false
	}
	for _, p := range body.Plans {
		if p.ID == "" || p.USDCents <= 0 || p.IncludedULXC <= 0 {
			return nil, false
		}
	}
	return body.Plans, true
}

// publicPegTTL — how long a CONFIRMED peg (or plan list) is reused. The peg is a constant upstream; the
// cache exists because an anonymous route that dialled Lens on every hit would let anyone spend Lens's
// public rate limit from this BFF's address, and the signed-in /billing read shares that address.
const publicPegTTL = 5 * time.Minute

// pricingReads are /api/pricing's two Lens reads, each cached on its own.
type pricingReads struct {
	peg   publicCache[float64]
	plans publicCache[[]pricedPlan]
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
