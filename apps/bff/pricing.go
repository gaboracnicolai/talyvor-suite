package main

import (
	"net/http"
	"sync"
	"time"
)

// handlePricing — GET /api/pricing (B5.2). What anything costs, answered to someone who has not
// signed up, so the /pricing page can print a price and a buyer can check it against the server.
//
//	{"usd_per_lxc":0.1, "min_usd_cents":1000, "max_usd_cents":1000000, "preset_usd_cents":[1000,5000,10000]}
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
	if peg, ok := a.publicPeg.get(func() (float64, bool) { return a.readUSDPerLXC(r, "") }); ok {
		out["usd_per_lxc"] = peg
	}
	w.Header().Set("Cache-Control", "public, max-age=300")
	writeJSON(w, http.StatusOK, out)
}

// publicPegTTL — how long a CONFIRMED peg is reused. The peg is a constant upstream; the cache
// exists because an anonymous route that dialled Lens on every hit would let anyone spend Lens's
// public rate limit from this BFF's address, and the signed-in /billing read shares that address.
const publicPegTTL = 5 * time.Minute

// publicPegCache holds the last CONFIRMED peg. A failure is never cached, so a Lens that comes back
// is asked again on the next request rather than five minutes later.
type publicPegCache struct {
	mu  sync.Mutex
	val float64
	at  time.Time
}

func (c *publicPegCache) get(read func() (float64, bool)) (float64, bool) {
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
