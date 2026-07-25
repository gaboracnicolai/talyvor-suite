package main

// The BFF's SECOND write path: starting a Stripe Checkout Session so a customer
// can actually buy LXC. The Lens half of this has been complete and correct for
// a while — checkout, a signature-verified webhook, exactly-once crediting on
// stripe_event_id with server-recomputed amounts. What was missing was the front
// door: no BFF route, no UI, no return pages. Lens's default redirect already
// points at app.talyvor.com/billing/success — the design assumed the suite owned
// those routes and nobody had built them. This file is the first of the three.
//
// IT FOLLOWS keys.go, DELIBERATELY. Same CSRF posture (Lax cookie + strict
// same-Origin, fail-closed when Origin is absent — see keys.go's argument, which
// applies here unchanged), same sanitise-by-reconstruction, same server-side-only
// key attachment, same no-store on the one response that must not be retained.
// A second write path is exactly the wrong place to invent a second shape.
//
// ── THE ALLOW-LIST, AND WHY IT IS MIRRORED HERE ─────────────────────────────
//
// Lens accepts only $10 / $50 / $100 (internal/billing/billing.go
// `allowedTopUps`). It also has `AllowedTopUpCents()` — which is called by
// NOTHING: the list is exposed on no HTTP endpoint, so the BFF genuinely cannot
// read it at runtime. Copying it here is therefore forced, and the copy is the
// weak point, so it is handled rather than hidden:
//
//   · one declaration (allowedTopUpCents), served to the UI by
//     /api/lxc/topup-options — the SCREEN never hardcodes an amount, so it can
//     never offer a button this BFF would refuse;
//   · a test pins the values against the Lens source, so changing them is
//     deliberate rather than accidental;
//   · and if the two repos ever DO drift, Lens answers 400 and this file
//     reports that as a version mismatch naming both lists — not as the
//     customer having typed something wrong.
//
// The one-line fix that would remove the copy entirely lives in the other repo:
// expose AllowedTopUpCents() on a public Lens route and read it here.
//
// ── WHY A 404 FROM LENS MEANS "BILLING IS OFF" ──────────────────────────────
//
// Lens registers the checkout route only under LENS_BILLING_ENABLED (its
// billReg gate); with billing off the route is never registered and the POST
// meets a chi-native 404. That reading is safe here for the same reason
// proxyGated's is, and a bit more strongly:
//
//   · the upstream path is PINNED at registration from config — no client input
//     shapes it, so there is no "real not-found" for a bad id to be confused with;
//   · Lens's checkout handler itself never answers 404 (400 for a bad body or a
//     disallowed amount, 500 otherwise, 200 on success — verified in source);
//   · its middlewares answer 401 (no credential) and 403 (foreign workspace),
//     not 404.
//
// So on THIS route, 404 ⟺ billing disabled. It is reported as 503 +
// billing_enabled:false — the same shape forwardProduct already uses for "this
// deployment does not have that wired" — and NOT as 200, because a POST that
// answered 200 without starting a purchase would be a lie. Every other non-200
// stays a fault (502): a 5xx or an unreachable Lens must never be laundered
// into "the feature is off".

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
)

// allowedTopUpCents MIRRORS talyvor-lens internal/billing/billing.go
// `allowedTopUps` — the server-side top-up sizes in USD cents ($10 / $50 / $100).
// Lens exposes this list on no endpoint (AllowedTopUpCents has zero callers), so
// this copy is unavoidable; TestAllowedTopUpsMirrorLens is what keeps it honest.
//
// ADDITIVE-ONLY, for the reason Lens states: async payment methods can settle
// days after a session is created and the webhook re-checks the list, so
// removing a size would mark a legitimately-paid purchase anomalous. Append only.
var allowedTopUpCents = []int64{1000, 5000, 10000}

// amountAllowed reports whether cents is an advertised top-up size.
func amountAllowed(cents int64) bool {
	for _, c := range allowedTopUpCents {
		if c == cents {
			return true
		}
	}
	return false
}

// formatUSDCents renders an integer cent amount the way the refusal messages
// need to state it: "$10", "$50", "$100" — and "$12.34" for anything not whole.
func formatUSDCents(cents int64) string {
	if cents%100 == 0 {
		return "$" + strconv.FormatInt(cents/100, 10)
	}
	whole, frac := cents/100, cents%100
	if frac < 0 {
		frac = -frac
	}
	return "$" + strconv.FormatInt(whole, 10) + "." + strconv.FormatInt(frac/10, 10) + strconv.FormatInt(frac%10, 10)
}

// allowedList renders the advertised amounts for a human-readable message.
func allowedList() string {
	parts := make([]string, 0, len(allowedTopUpCents))
	for _, c := range allowedTopUpCents {
		parts = append(parts, formatUSDCents(c))
	}
	return strings.Join(parts, ", ")
}

// handleTopUpOptions — GET /api/lxc/topup-options. The amounts the UI may offer,
// served from the ONE declaration the write path also enforces. This exists so
// the screen has no reason to hardcode a price; a button it draws is a button
// this BFF accepts, by construction.
func (a *app) handleTopUpOptions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"allowed_usd_cents": allowedTopUpCents})
}

// handleLXCCheckout — POST /api/lxc/checkout. Starts a Stripe Checkout Session
// for the CONFIGURED workspace and returns the session URL for the browser to be
// sent to. Nothing is charged here and no credit is written here: payment
// happens at Stripe, and the LXC credit lands later via Lens's webhook.
func (a *app) handleLXCCheckout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	if !a.requireSameOrigin(w, r) {
		return
	}

	// Sanitise by reconstruction, as the mint does: decode the ONE field this
	// route has, re-encode, and send only that upstream. A client cannot name a
	// workspace, a price in LXC, or anything else — the workspace comes from
	// config and the peg is recomputed by Lens.
	var in struct {
		USDCents int64 `json:"usd_cents"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid JSON body"})
		return
	}

	// Refused HERE, before any dial: an off-list amount would make Lens create a
	// Stripe customer mapping on its way to rejecting it, and the customer would
	// wait on a round trip to learn something this side already knows. The reply
	// carries the allowed amounts so the screen can say what IS on offer.
	if !amountAllowed(in.USDCents) {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error":             "top-up amount not offered — choose one of " + allowedList(),
			"allowed_usd_cents": allowedTopUpCents,
		})
		return
	}

	body, err := json.Marshal(map[string]int64{"usd_cents": in.USDCents})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "encode"})
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost,
		a.cfg.lensBaseURL+"/v1/workspaces/"+a.cfg.workspaceID+"/billing/checkout", bytes.NewReader(body))
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "lens upstream request"})
		return
	}
	req.Header.Set("Authorization", "Bearer "+a.cfg.workspaceKey) // server-side only, as everywhere
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := a.client.Do(req)
	if err != nil {
		log.Printf("bff: lxc checkout upstream: %v", err)
		writeJSON(w, http.StatusBadGateway, map[string]any{
			"error": "couldn’t reach Lens to start the payment — nothing was charged"})
		return
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK:
		// A Stripe session URL is a payable, workspace-bound handle: no cache
		// layer may retain it, exactly as with the minted key.
		w.Header().Set("Cache-Control", "no-store")
		if ct := resp.Header.Get("Content-Type"); ct != "" {
			w.Header().Set("Content-Type", ct)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = io.Copy(w, resp.Body)

	case http.StatusNotFound:
		// Billing is off on this deployment (see the file header for why this
		// reading is unambiguous on this route). Information, not a fault — but
		// still a POST that did nothing, so never a 200.
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "billing is turned off on this deployment — Lens is running without " +
				"LENS_BILLING_ENABLED, so LXC cannot be bought here",
			"billing_enabled": false,
		})

	case http.StatusBadRequest:
		// The BFF already checked the amount against its mirrored list, so a 400
		// from Lens means the two lists have DRIFTED. That is an operator-facing
		// version mismatch between two repos, not a customer input error — say so,
		// and name what this app offers so the gap is diagnosable from the message.
		log.Printf("bff: lxc checkout: Lens refused an advertised amount (%d) — allow-list drift", in.USDCents)
		writeJSON(w, http.StatusBadGateway, map[string]any{
			"error": "this app offers " + allowedList() + ", but Lens refused that amount — " +
				"the two are running different top-up allow-lists. Nothing was charged.",
		})

	default:
		log.Printf("bff: lxc checkout: lens upstream status %d", resp.StatusCode)
		writeJSON(w, http.StatusBadGateway, map[string]any{
			"error": "Lens couldn’t start the payment — nothing was charged"})
	}
}
