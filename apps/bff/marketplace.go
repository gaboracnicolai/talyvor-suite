package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"time"
)

// marketplace.go — B20.3: the marketplace screens. Lens's catalog of agents, prompts, skills,
// evaluations and pipelines (B20.1) and using one, paid per use, with the seller's earnings (B20.2):
//
//	GET  /api/marketplace/listings?kind=           the public catalog, optionally one kind
//	POST /api/marketplace/listings                 {kind, title, description, price_per_use_ulxc, visibility, artifact, changelog}
//	GET  /api/marketplace/listings/{id}            a listing and its versions (artifacts for its owner only)
//	POST /api/marketplace/listings/{id}/use        {version, model, input, variables}
//	GET  /api/marketplace/mine                     this workspace's own listings, whatever their visibility
//	GET  /api/marketplace/earnings                 the seller's pending, payable, in holdback and available
//	GET  /api/marketplace/bill?month=YYYY-MM       the buyer's billed uses in a month (B20.10), this month by default
//	POST /api/marketplace/listings/{id}/reports    {reason, details}: report a listing to Talyvor's review (B20.11)
//	GET  /api/marketplace/payouts                  B20.6: the seller's Stripe account, balance, next payout and payouts
//	POST /api/marketplace/payouts/connect          B20.6: {country} a link to Stripe's onboarding
//	POST /api/marketplace/payouts/credits          B20.6: take the available balance as Talyvor credits
//
// Reads and publishing go on the session's workspace token, as the Agent Bank's do. A USE does not:
// Lens runs the listing by calling its own proxy with the caller's credential, and every /v1/proxy/*
// route requires the {proxy} scope the session token does not carry — so a use goes on the same
// narrow, short-lived session key the chat streams on (stream.go). Lens decides who may publish (the
// workspace's owner or an admin), refuses a listing carrying a secret, personal data or an injection
// with a sentence saying so, and bills a paid use to the buyer's monthly marketplace bill; a 4xx
// sentence is relayed because it is the screen's answer to "why not?".

// marketKinds are the kinds Lens lists; "" is every kind.
var marketKinds = map[string]bool{"": true, "agent": true, "prompt": true, "skill": true, "evaluation": true, "pipeline": true}

// marketUseTimeout bounds one use: an evaluation runs up to fifty model calls before Lens answers.
const marketUseTimeout = 5 * time.Minute

// marketUseClient carries a use. No Timeout field: marketUseTimeout on the request's context bounds
// the whole exchange, and a whole-exchange client timeout would cut a long evaluation short.
var marketUseClient = &http.Client{}

// marketRelay sends body (nil for none) to lensPath with bearer and answers what Lens answered: its
// JSON on success, its status and sentence on a 4xx, a 502 otherwise — except that a 503, where Lens
// says only that it is unavailable, is answered with unavailable when the caller names one.
func (a *app) marketRelay(w http.ResponseWriter, r *http.Request, client *http.Client, bearer, method, lensPath string, body []byte, unavailable string) {
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(r.Context(), method, a.cfg.lensBaseURL+lensPath, rd)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream request"})
		return
	}
	req.Header.Set("Authorization", "Bearer "+bearer) // server-side only
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("bff: marketplace %s %s: %v", method, lensPath, err)
		writeUpstreamFailure(w, "lens", err)
		return
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	switch {
	case resp.StatusCode >= 200 && resp.StatusCode < 300 && json.Valid(raw):
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(resp.StatusCode)
		_, _ = w.Write(raw)
	case resp.StatusCode >= 400 && resp.StatusCode < 500:
		var refusal struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(raw, &refusal) != nil || refusal.Error == "" {
			refusal.Error = "Lens refused this"
		}
		writeJSON(w, resp.StatusCode, map[string]string{"error": refusal.Error})
	case resp.StatusCode == http.StatusServiceUnavailable && unavailable != "":
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": unavailable})
	default:
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens could not answer just now"})
	}
}

// handleMarketListings — GET /api/marketplace/listings reads the catalog; POST publishes a listing.
func (a *app) handleMarketListings(w http.ResponseWriter, r *http.Request, t tenant) {
	switch r.Method {
	case http.MethodGet:
		kind := r.URL.Query().Get("kind")
		if !marketKinds[kind] {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "kind must be agent, prompt, skill, evaluation or pipeline"})
			return
		}
		path := "/v1/marketplace/listings"
		if kind != "" {
			path += "?kind=" + url.QueryEscape(kind)
		}
		a.marketRelay(w, r, a.client, t.token, http.MethodGet, path, nil, "")
	case http.MethodPost:
		// Lens's market.Draft. The artifact is the listing itself — a system prompt, a template,
		// instructions, cases or steps, as its kind needs — and travels as the object it is.
		var in struct {
			Kind            string          `json:"kind"`
			Title           string          `json:"title"`
			Description     string          `json:"description"`
			PricePerUseULXC int64           `json:"price_per_use_ulxc"`
			Visibility      string          `json:"visibility"`
			Artifact        json.RawMessage `json:"artifact"`
			Changelog       string          `json:"changelog"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 320<<10)).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		var artifact map[string]any
		if json.Unmarshal(in.Artifact, &artifact) != nil || artifact == nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a listing needs its artifact"})
			return
		}
		// UPSTREAM-BINDS-ONLY lensMarketPublishBody: none
		body, _ := json.Marshal(in)
		a.marketRelay(w, r, a.client, t.token, http.MethodPost, lensWorkspacePath(t, "/marketplace/listings"), body, "")
	default:
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
	}
}

// handleMarketListing — GET /api/marketplace/listings/{id}.
func (a *app) handleMarketListing(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	id, ok := pathID(w, "listing id", r.PathValue("id"))
	if !ok {
		return
	}
	a.marketRelay(w, r, a.client, t.token, http.MethodGet, "/v1/marketplace/listings/"+url.PathEscape(id), nil, "")
}

// handleMarketUse — POST /api/marketplace/listings/{id}/use runs the listing for this workspace.
func (a *app) handleMarketUse(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	id, ok := pathID(w, "listing id", r.PathValue("id"))
	if !ok {
		return
	}
	var in struct {
		Version   int               `json:"version"`
		Model     string            `json:"model"`
		Input     string            `json:"input"`
		Variables map[string]string `json:"variables"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 256<<10)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	key, err := a.sessionKeyFor(r.Context(), t)
	if err != nil {
		log.Printf("bff: marketplace use credential: %v", err)
		var refused mintRefused
		if errors.As(err, &refused) {
			writeJSON(w, http.StatusBadGateway, map[string]string{
				"error": "lens refused the credential a listing runs on",
				"code":  chatCredentialRefusedCode,
			})
			return
		}
		writeUpstreamFailure(w, "lens", err)
		return
	}
	// The server's 30-second write deadline would drop the answer to a long evaluation on the floor
	// after Lens had run — and billed — it.
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(marketUseTimeout + 10*time.Second))
	ctx, cancel := context.WithTimeout(r.Context(), marketUseTimeout)
	defer cancel()
	// UPSTREAM-BINDS-ONLY lensMarketUseBody: none
	body, _ := json.Marshal(in)
	a.marketRelay(w, r.WithContext(ctx), marketUseClient, key, http.MethodPost,
		lensWorkspacePath(t, "/marketplace/listings/"+url.PathEscape(id)+"/use"), body,
		"Paid listings cannot be used on this deployment yet: it has no marketplace bill to put them on.")
}

// handleMarketMine — GET /api/marketplace/mine: this workspace's own listings.
func (a *app) handleMarketMine(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.marketRelay(w, r, a.client, t.token, http.MethodGet, lensWorkspacePath(t, "/marketplace/listings"), nil, "")
}

// handleMarketEarnings — GET /api/marketplace/earnings: what this workspace's listings earned.
func (a *app) handleMarketEarnings(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.marketRelay(w, r, a.client, t.token, http.MethodGet, lensWorkspacePath(t, "/marketplace/earnings"), nil, "")
}

// billMonth is the one shape Lens reads ?month= in.
var billMonth = regexp.MustCompile(`^\d{4}-(0[1-9]|1[0-2])$`)

// handleMarketBill — GET /api/marketplace/bill?month=YYYY-MM: the paid listings this workspace used in
// a month, billed on its card — never on its credits. No month is this month, in Lens's clock.
func (a *app) handleMarketBill(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	path := lensWorkspacePath(t, "/marketplace/bill")
	if month := r.URL.Query().Get("month"); month != "" {
		if !billMonth.MatchString(month) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "month must be YYYY-MM"})
			return
		}
		path += "?month=" + month
	}
	a.marketRelay(w, r, a.client, t.token, http.MethodGet, path, nil, "")
}

// handleMarketReport — POST /api/marketplace/listings/{id}/reports {reason, details}: this workspace
// reports a listing to Talyvor's review (Lens B20.4). Lens answers 201 for a new report and 200 with
// already_reported for a repeat while the first is open, and refuses an unknown reason with a sentence.
func (a *app) handleMarketReport(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	id, ok := pathID(w, "listing id", r.PathValue("id"))
	if !ok {
		return
	}
	var in struct {
		Reason  string `json:"reason"`
		Details string `json:"details"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 16<<10)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensMarketReportBody: none
	body, _ := json.Marshal(in)
	a.marketRelay(w, r, a.client, t.token, http.MethodPost, "/v1/marketplace/listings/"+url.PathEscape(id)+"/reports", body, "")
}

// payoutsOff is what the seller reads when Lens has no Stripe to pay through (it answers 503).
const payoutsOff = "Payouts are not switched on here yet: Stripe billing is off."

// handleMarketPayouts — GET /api/marketplace/payouts (B20.6, Lens B20.5): the seller's connected Stripe
// account and whether Stripe can pay it, the balance (in the holdback, available, owed, paid out), what
// paying the available balance now would come to with Stripe's fees, and every payout.
func (a *app) handleMarketPayouts(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.marketRelay(w, r, a.client, t.token, http.MethodGet, lensWorkspacePath(t, "/marketplace/payouts"), nil, payoutsOff)
}

// payoutCountry is the one shape Lens reads a seller's country in: two letters, or none for Lens's default.
var payoutCountry = regexp.MustCompile(`^([A-Z]{2})?$`)

// handleMarketPayoutsConnect — POST /api/marketplace/payouts/connect {country}: Lens creates the seller's
// Stripe account the first time and answers a link to Stripe's onboarding, which returns to
// /marketplace/selling. The workspace's owner or an admin only; Lens says so otherwise.
func (a *app) handleMarketPayoutsConnect(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	var in struct {
		Country string `json:"country"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	if !payoutCountry.MatchString(in.Country) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "country must be two capital letters, such as GB"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensMarketPayoutConnectBody: none
	body, _ := json.Marshal(in)
	a.marketRelay(w, r, a.client, t.token, http.MethodPost, lensWorkspacePath(t, "/marketplace/payouts/connect"), body, payoutsOff)
}

// handleMarketPayoutsCredits — POST /api/marketplace/payouts/credits: the seller takes the whole available
// balance as Talyvor credits, 1:1, instead of waiting for the monthly money payout. Lens writes the payout
// and the credit together, and refuses with a sentence when nothing is available yet.
func (a *app) handleMarketPayoutsCredits(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	a.marketRelay(w, r, a.client, t.token, http.MethodPost, lensWorkspacePath(t, "/marketplace/payouts/credits"), nil, "")
}
