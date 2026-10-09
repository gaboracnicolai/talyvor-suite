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
//	POST /api/marketplace/listings                 {kind, title, description, price_per_use_ulxc, visibility, artifact, changelog,
//	                                               remix_policy, remix_share_bps, parents: [{listing_id, version}]} (B32.58: remix terms and parents)
//	GET  /api/marketplace/listings/{id}?currency=  a listing and its versions (artifacts for its owner only); B32.57: its offers priced in currency
//	GET  /api/marketplace/listings/{id}/trust      B32.57: its trust panel — verified publisher, reviews, eval score, claims and its originals
//	POST /api/marketplace/listings/{id}/remix      B32.58: {version} accept its remix licence and open its artifact to build on
//	POST /api/marketplace/listings/{id}/use        {version, model, input, variables}
//	GET  /api/marketplace/mine                     this workspace's own listings, whatever their visibility
//	GET  /api/marketplace/earnings                 the seller's pending, payable, in holdback and available
//	GET  /api/marketplace/bill?month=YYYY-MM       the buyer's billed uses in a month (B20.10), this month by default
//	GET  /api/marketplace/bill?invoice=ID          B28.385: the uses one Stripe invoice carried; "upcoming" the period in progress
//	GET  /api/marketplace/invoices                 B28.385: the bill's Stripe invoices, newest first, each with its period and PDF
//	POST /api/marketplace/listings/{id}/reports    {reason, details}: report a listing to Talyvor's review (B20.11)
//	GET  /api/marketplace/payouts                  B20.6: the seller's Stripe account, balance, next payout and payouts
//	POST /api/marketplace/payouts/connect          B20.6: {country} a link to Stripe's onboarding (B35.10: Lens is sent the session's email too)
//	POST /api/marketplace/payouts/credits          B20.6: take the available balance as Talyvor credits
//	GET  /api/marketplace/licences                 B32.59: the licences this workspace holds or held
//	POST /api/marketplace/licences/{id}/cancel     B32.59: stop a licence renewing; it runs to its end
//	POST /api/marketplace/listings/{id}/licences   B32.59: {offer_id, version} + Idempotency-Key: license an offer again (renew)
//	GET  /api/marketplace/receipts                 B32.59: Talyvor's receipts for this workspace's paid bills
//	GET  /api/marketplace/receipts/{id}            B32.59: one receipt as its page; ?format=pdf the document
//	GET  /api/marketplace/seller-tax               B32.60: the seller's tax details, masked, what is missing and any payout hold
//	PUT  /api/marketplace/seller-tax               B32.60: save them; tins, date_of_birth and account_identifier null keep what is stored
//	GET  /api/marketplace/statements?period=       B32.60: the weeks the seller was paid in; with a period (2026-W41) that week's statement
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
			RemixPolicy     string          `json:"remix_policy"`
			RemixShareBPS   int             `json:"remix_share_bps"`
			Parents         []marketParent  `json:"parents"`
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
		// Offers beyond the price per use are set on the listing once it exists, and capabilities are chosen there too.
		// UPSTREAM-BINDS-ONLY lensMarketPublishBody: capabilities, offers
		body, _ := json.Marshal(in)
		a.marketRelay(w, r, a.client, t.token, http.MethodPost, lensWorkspacePath(t, "/marketplace/listings"), body, "")
	default:
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
	}
}

// marketParent is Lens's market.ParentRef (B32.24): a listing version a new listing builds on. Lens refuses a parent
// the publisher may not see, one that allows no remixes, someone else's whose remix licence it has not accepted, and a
// cycle — each with its sentence.
type marketParent struct {
	ListingID string `json:"listing_id"`
	Version   int    `json:"version"`
}

// handleMarketRemix — POST /api/marketplace/listings/{id}/remix {version} (B32.58, Lens B32.25): this workspace
// accepts the remix licence of a version of someone else's free or royalty listing (0: its latest) — one grant per
// workspace and version, the share locked — and gets its artifact to build on. Lens refuses a listing whose remix
// policy is none, and anyone but the workspace's owner or an admin, with its sentence.
func (a *app) handleMarketRemix(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	id, ok := pathID(w, "listing id", r.PathValue("id"))
	if !ok {
		return
	}
	var in struct {
		Version int `json:"version"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&in); err != nil || in.Version < 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name the version to remix, or 0 for its latest"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensMarketRemixBody: none
	body, _ := json.Marshal(in)
	a.marketRelay(w, r, a.client, t.token, http.MethodPost,
		lensWorkspacePath(t, "/marketplace/listings/"+url.PathEscape(id)+"/remix"), body, "")
}

// displayCurrency is the one shape Lens reads ?currency= in: a three-letter ISO 4217 code.
var displayCurrency = regexp.MustCompile(`^[A-Za-z]{3}$`)

// handleMarketListing — GET /api/marketplace/listings/{id}?currency=: B32.57, the listing page asks for its offers in
// the currency the buyer picked; without one Lens prices them in the currency of the buyer's tax-profile country (B32.51).
func (a *app) handleMarketListing(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	id, ok := pathID(w, "listing id", r.PathValue("id"))
	if !ok {
		return
	}
	path := "/v1/marketplace/listings/" + url.PathEscape(id)
	if c := r.URL.Query().Get("currency"); c != "" {
		if !displayCurrency.MatchString(c) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "currency must be a three-letter code, such as GBP"})
			return
		}
		path += "?currency=" + c
	}
	a.marketRelay(w, r, a.client, t.token, http.MethodGet, path, nil, "")
}

// handleMarketTrust — GET /api/marketplace/listings/{id}/trust (B32.57, Lens B32.49): the listing page's trust panel
// and family tree, in one read — whether the publisher is verified, the reviews of paying buyers, the eval score, the
// IP claims against it, the originals it builds on with their shares, and how many remixes build on it.
func (a *app) handleMarketTrust(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	id, ok := pathID(w, "listing id", r.PathValue("id"))
	if !ok {
		return
	}
	a.marketRelay(w, r, a.client, t.token, http.MethodGet, "/v1/marketplace/listings/"+url.PathEscape(id)+"/trust", nil, "")
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

// billInvoice is a Stripe invoice id (in_…), or "upcoming": the invoice the period in progress will be (B28.385).
var billInvoice = regexp.MustCompile(`^(upcoming|in_[A-Za-z0-9_]{1,250})$`)

// handleMarketBill — GET /api/marketplace/bill?month=YYYY-MM: the paid listings this workspace used in
// a month, billed on its card — never on its credits. No month is this month, in Lens's clock.
// B28.385: ?invoice= instead reads the uses one Stripe invoice carried (Lens B28.140); a bill is read by one or the other.
func (a *app) handleMarketBill(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	path := lensWorkspacePath(t, "/marketplace/bill")
	month, invoice := r.URL.Query().Get("month"), r.URL.Query().Get("invoice")
	switch {
	case month != "" && invoice != "":
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "read the bill by month or by invoice, not both"})
		return
	case invoice != "":
		if !billInvoice.MatchString(invoice) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invoice must be a Stripe invoice id (in_…) or upcoming"})
			return
		}
		path += "?invoice=" + invoice
	case month != "":
		if !billMonth.MatchString(month) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "month must be YYYY-MM"})
			return
		}
		path += "?month=" + month
	}
	a.marketRelay(w, r, a.client, t.token, http.MethodGet, path, nil, "")
}

// handleMarketInvoices — GET /api/marketplace/invoices (B28.385, Lens B28.140): the Stripe invoices of this workspace's
// marketplace bill, newest first — each billing period, its status, what it charged and refunded, and Stripe's PDF.
// A Lens that does not list them yet answers 404, and the screen reads the bill by month.
func (a *app) handleMarketInvoices(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.marketRelay(w, r, a.client, t.token, http.MethodGet, lensWorkspacePath(t, "/marketplace/invoices"), nil, "")
}

// handleMarketLicences — GET /api/marketplace/licences (B32.59, Lens B32.19–B32.20): every licence this workspace
// holds or held — its end, whether it renews, the version it pins and what its rents have paid towards owning it.
func (a *app) handleMarketLicences(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.marketRelay(w, r, a.client, t.token, http.MethodGet, lensWorkspacePath(t, "/marketplace/licences"), nil, "")
}

// handleMarketLicenceCancel — POST /api/marketplace/licences/{id}/cancel: the licence stops renewing and stays
// active to its end (Lens B32.20); nothing is charged for a period after it.
func (a *app) handleMarketLicenceCancel(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	id, ok := pathID(w, "licence id", r.PathValue("id"))
	if !ok {
		return
	}
	a.marketRelay(w, r, a.client, t.token, http.MethodPost, lensWorkspacePath(t, "/marketplace/licences/"+url.PathEscape(id)+"/cancel"), nil, "")
}

// handleMarketLicense — POST /api/marketplace/listings/{id}/licences {offer_id, version}: this workspace licenses one of
// a listing's offers again — the Licences page's Renew of a rental or subscription that ended (Lens B32.19). Its price
// goes on this month's marketplace bill. agentBankRelay forwards the screen's Idempotency-Key, which Lens requires, so
// a retried click never rents twice; without one Lens refuses with its sentence.
func (a *app) handleMarketLicense(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	id, ok := pathID(w, "listing id", r.PathValue("id"))
	if !ok {
		return
	}
	var in struct {
		OfferID string `json:"offer_id"`
		Version int    `json:"version"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 16<<10)).Decode(&in); err != nil || in.OfferID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name the offer to license"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensMarketLicenceBody: auto_renew
	body, _ := json.Marshal(in)
	a.agentBankRelay(w, r, t, http.MethodPost, "/marketplace/listings/"+url.PathEscape(id)+"/licences", body)
}

// handleMarketReceipts — GET /api/marketplace/receipts (B32.59, Lens B32.40): Talyvor's receipt for each of this
// workspace's paid marketplace bills, newest first. Lens answers its owner or an admin only, and says so otherwise.
func (a *app) handleMarketReceipts(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.marketRelay(w, r, a.client, t.token, http.MethodGet, lensWorkspacePath(t, "/marketplace/receipts"), nil, "")
}

// receiptTypes are what a receipt may be fetched as, and the one Content-Type each answers in.
var receiptTypes = map[string]string{"html": "text/html; charset=utf-8", "pdf": "application/pdf"}

// handleMarketReceipt — GET /api/marketplace/receipts/{id}: one receipt as Lens renders it — its page, or with
// ?format=pdf its A4 document — for the bill's Receipt link. Lens's bytes are relayed under this route's own
// Content-Type and a sandboxing CSP, so nothing in them can run on the app's origin.
func (a *app) handleMarketReceipt(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	id, ok := pathID(w, "receipt id", r.PathValue("id"))
	if !ok {
		return
	}
	format := r.URL.Query().Get("format")
	if format == "" {
		format = "html"
	}
	contentType, ok := receiptTypes[format]
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "format must be html or pdf"})
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet,
		a.cfg.lensBaseURL+lensWorkspacePath(t, "/marketplace/receipts/"+url.PathEscape(id))+"?format="+format, nil)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream request"})
		return
	}
	req.Header.Set("Authorization", "Bearer "+t.token) // server-side only
	resp, err := a.client.Do(req)
	if err != nil {
		log.Printf("bff: marketplace receipt: %v", err)
		writeUpstreamFailure(w, "lens", err)
		return
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	switch {
	case resp.StatusCode == http.StatusOK:
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if format == "pdf" {
			w.Header().Set("Content-Disposition", `inline; filename="talyvor-receipt.pdf"`)
		}
		_, _ = w.Write(raw)
	case resp.StatusCode >= 400 && resp.StatusCode < 500:
		var refusal struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(raw, &refusal) != nil || refusal.Error == "" {
			refusal.Error = "Lens refused this"
		}
		writeJSON(w, resp.StatusCode, map[string]string{"error": refusal.Error})
	default:
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens could not answer just now"})
	}
}

// handleMarketSellerTax — GET /api/marketplace/seller-tax reads the seller's tax details (Lens B32.41): the TINs and the
// payout account masked to their last four characters, the date of birth masked, what is still missing and any payout
// hold. PUT saves them; tins, date_of_birth and account_identifier sent as null keep what Lens stores, because they read
// back masked and the seller is not asked for them again to correct an address. Lens takes the workspace's owner or an
// admin, checks a VAT number with its tax partner, and says why it refuses.
func (a *app) handleMarketSellerTax(w http.ResponseWriter, r *http.Request, t tenant) {
	path := lensWorkspacePath(t, "/marketplace/seller-tax")
	switch r.Method {
	case http.MethodGet:
		a.marketRelay(w, r, a.client, t.token, http.MethodGet, path, nil, "")
	case http.MethodPut:
		var in struct {
			SellerType                string       `json:"seller_type"`
			FirstName                 string       `json:"first_name"`
			MiddleName                string       `json:"middle_name"`
			LastName                  string       `json:"last_name"`
			LegalName                 string       `json:"legal_name"`
			Address                   string       `json:"address"`
			Country                   string       `json:"country"`
			TINs                      *[]sellerTIN `json:"tins"`
			DateOfBirth               *string      `json:"date_of_birth"`
			CompanyRegistrationNumber string       `json:"company_registration_number"`
			VATNumber                 string       `json:"vat_number"`
			AccountIdentifier         *string      `json:"account_identifier"`
			AccountHolder             string       `json:"account_holder"`
			SelfBillingAgreedVersion  string       `json:"self_billing_agreed_version"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 16<<10)).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "send the tax details as JSON"})
			return
		}
		// UPSTREAM-BINDS-ONLY lensSellerTaxBody: none
		body, _ := json.Marshal(in)
		a.marketRelay(w, r, a.client, t.token, http.MethodPut, path, body, "Tax details cannot be saved here yet.")
	default:
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPut)
	}
}

// sellerTIN is one taxpayer identification number and the country that issued it, as Lens's sellertax.TIN reads it.
type sellerTIN struct {
	Jurisdiction string `json:"jurisdiction"`
	Number       string `json:"number"`
}

// statementPeriod is an ISO week, as Lens names a weekly statement: 2026-W41.
var statementPeriod = regexp.MustCompile(`^\d{4}-W\d{2}$`)

// handleMarketStatements — GET /api/marketplace/statements: the weeks the seller was paid in (Lens B32.42), newest
// first; ?period=2026-W41 that week's statement — its lines summing to the net paid, the VAT collected from buyers for
// information, and the self-billed invoice (B32.43) when the seller agreed to self-billing. The owner or an admin only.
func (a *app) handleMarketStatements(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	path := lensWorkspacePath(t, "/marketplace/statements")
	if period := r.URL.Query().Get("period"); period != "" {
		if !statementPeriod.MatchString(period) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "period must be an ISO week, such as 2026-W41"})
			return
		}
		path += "?period=" + period
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
//
// B35.10 — Stripe needs a contact email on the account, and Lens cannot read one (a provisioned token's
// subject is the workspace id), so the BFF sends the signed-in person's own. Never one the browser
// sends, and none for a synthetic session: Stripe would refuse its .invalid address, and Lens gives a
// test workspace its own.
func (a *app) handleMarketPayoutsConnect(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	var in struct {
		Country string `json:"country"`
		Email   string `json:"email,omitempty"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	if !payoutCountry.MatchString(in.Country) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "country must be two capital letters, such as GB"})
		return
	}
	in.Email = ""
	if a.auth != nil {
		if s, ok := a.auth.sessionFrom(r); ok && !s.synthetic {
			in.Email = s.email
		}
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
