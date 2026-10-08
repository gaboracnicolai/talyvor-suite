package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// operator_tax.go — B32.63: the operator's Tax page, behind requireOperator.
//
//	GET  /api/admin/tax/status          whether Lens's Stripe key is live, and which tax partner Lens has
//	GET  /api/admin/tax/rates           every tax rate loaded, with when it is valid
//	POST /api/admin/tax/rates/import    {csv}: load a rates file; Lens refuses the whole file at its first bad line
//	GET  /api/admin/tax/registrations   Talyvor's tax registrations
//	POST /api/admin/tax/registrations   {jurisdiction, scheme, number, effective_from}: record one
//	GET  /api/admin/tax/return          ?jurisdiction=&quarter=&funding=: a quarter's tax by jurisdiction and treatment
//	GET  /api/admin/platform-reports    ?year=: the platform reports run, newest first, each with its sha256
//	POST /api/admin/platform-reports    {year, funding, format}: run the year's report and answer the file itself
//
// Reads go on LENS_OPERATOR_READ_KEY and writes on LENS_MODERATOR_KEY naming the operator in X-Talyvor-Operator,
// like the rest of the Operator screen. The rates import and a registration are recorded in the operator trail
// once Lens has done them; Lens records the platform report itself. A Lens that does not have these routes yet
// answers 404, and the page says so rather than "refused".

const (
	auditTaxRatesImport     = "tax.rates.import"
	auditTaxRegistrationAdd = "tax.registration.add"
	// maxTaxRatesCSV bounds a rates file: one line per jurisdiction, tax code and start is a few hundred lines.
	maxTaxRatesCSV = 2 << 20
	// platformReportTimeout keeps the year's export inside the server's 30s write timeout.
	platformReportTimeout = 25 * time.Second
)

// taxNotInLens is Lens answering 404 to a route the Tax page needs.
const taxNotInLens = "This deployment's Lens does not answer the Tax page yet. Update Lens, then reload this page."

// taxReadQuery is what the page's two filtered reads may pass to Lens; nothing else is sent.
var taxReadQuery = map[string][]string{
	"/v1/admin/tax/return":       {"jurisdiction", "quarter", "funding"},
	"/v1/admin/platform-reports": {"year"},
}

// platformReportHeaders are the headers of Lens's answer the browser is given with the file.
var platformReportHeaders = []string{"Content-Type", "Content-Disposition", "X-Platform-Report-Id", "X-Platform-Report-Sha256", "X-Platform-Report-Rows"}

func (a *app) handleTaxStatus(w http.ResponseWriter, r *http.Request, s session) {
	a.taxRelay(w, r, s, http.MethodGet, "/v1/admin/tax/status", nil, nil, a.client)
}

func (a *app) handleTaxRates(w http.ResponseWriter, r *http.Request, s session) {
	a.taxRelay(w, r, s, http.MethodGet, "/v1/admin/tax/rates", nil, nil, a.client)
}

// onlyGetOrPost is onlyMethod for a route that is read and written: every other verb is answered 405 before the
// operator gate is asked, so a wrong verb gets the same answer from every caller.
func onlyGetOrPost(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
			return
		}
		next(w, r)
	}
}

// handleTaxRegistrations — GET and POST /api/admin/tax/registrations.
func (a *app) handleTaxRegistrations(w http.ResponseWriter, r *http.Request, s session) {
	switch r.Method {
	case http.MethodGet:
		a.taxRelay(w, r, s, http.MethodGet, "/v1/admin/tax/registrations", nil, nil, a.client)
	case http.MethodPost:
		a.handleTaxRegistrationAdd(w, r, s)
	default:
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
	}
}

// handlePlatformReports — GET and POST /api/admin/platform-reports.
func (a *app) handlePlatformReports(w http.ResponseWriter, r *http.Request, s session) {
	switch r.Method {
	case http.MethodGet:
		a.taxRelay(w, r, s, http.MethodGet, "/v1/admin/platform-reports", nil, nil, a.client)
	case http.MethodPost:
		a.handlePlatformReportRun(w, r, s)
	default:
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
	}
}

func (a *app) handleTaxReturn(w http.ResponseWriter, r *http.Request, s session) {
	a.taxRelay(w, r, s, http.MethodGet, "/v1/admin/tax/return", nil, nil, a.client)
}

// handleTaxRatesImport — POST /api/admin/tax/rates/import {csv}. Lens parses the file and refuses all of it at the
// first bad line with a sentence naming the line.
func (a *app) handleTaxRatesImport(w http.ResponseWriter, r *http.Request, s session) {
	var in struct {
		CSV string `json:"csv"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxTaxRatesCSV)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "The rates file could not be read: send {csv} of at most 2 MB."})
		return
	}
	if strings.TrimSpace(in.CSV) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "The rates file is empty."})
		return
	}
	// UPSTREAM-BINDS-ONLY lensTaxRatesImportBody: none
	body, _ := json.Marshal(in)
	lines := strings.Count(strings.TrimSpace(in.CSV), "\n") // the lines after the header
	a.taxRelay(w, r, s, http.MethodPost, "/v1/admin/tax/rates/import", body,
		&operatorAction{action: auditTaxRatesImport, target: "tax_rates", detail: fmt.Sprintf("%d lines", lines)}, a.client)
}

// handleTaxRegistrationAdd — POST /api/admin/tax/registrations {jurisdiction, scheme, number, effective_from}.
func (a *app) handleTaxRegistrationAdd(w http.ResponseWriter, r *http.Request, s session) {
	var in struct {
		Jurisdiction  string `json:"jurisdiction"`
		Scheme        string `json:"scheme"`
		Number        string `json:"number"`
		EffectiveFrom string `json:"effective_from"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	in.Jurisdiction = strings.ToUpper(strings.TrimSpace(in.Jurisdiction))
	// UPSTREAM-BINDS-ONLY lensTaxRegistrationBody: none
	body, _ := json.Marshal(in)
	a.taxRelay(w, r, s, http.MethodPost, "/v1/admin/tax/registrations", body,
		&operatorAction{action: auditTaxRegistrationAdd, target: "tax_registration:" + in.Jurisdiction,
			detail: strings.TrimSpace(in.Scheme + " " + in.Number + " from " + in.EffectiveFrom)}, a.client)
}

// handlePlatformReportRun — POST /api/admin/platform-reports {year, funding, format}. Lens answers the file itself
// with its sha256 in X-Platform-Report-Sha256; both go to the browser as they are, so the page can check the
// bytes it saves against the sha256 Lens recorded. The actor is the operator in X-Talyvor-Operator, never the body.
func (a *app) handlePlatformReportRun(w http.ResponseWriter, r *http.Request, s session) {
	var in struct {
		Year    int    `json:"year"`
		Funding string `json:"funding"`
		Format  string `json:"format"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	if !a.taxKeySet(w, http.MethodPost) {
		return
	}
	// UPSTREAM-BINDS-ONLY lensPlatformReportBody: actor
	body, _ := json.Marshal(in)
	ctx, cancel := context.WithTimeout(r.Context(), platformReportTimeout)
	defer cancel()
	resp, err := a.taxCall(r.WithContext(ctx), s, marketUseClient, http.MethodPost, "/v1/admin/platform-reports", body)
	if err != nil {
		log.Printf("bff: platform report: %v", err)
		writeUpstreamFailure(w, "lens", err)
		return
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
		taxRefused(w, http.MethodPost, "/v1/admin/platform-reports", resp.StatusCode, raw)
		return
	}
	for _, h := range platformReportHeaders {
		if v := resp.Header.Get(h); v != "" {
			w.Header().Set(h, v)
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	if _, err := io.Copy(w, resp.Body); err != nil {
		log.Printf("bff: platform report: relaying the file: %v", err)
	}
}

// taxKeySet answers 501 naming the variable to set when the key a read or a write goes on is not set.
func (a *app) taxKeySet(w http.ResponseWriter, method string) bool {
	if method == http.MethodGet && a.cfg.operatorReadKey == "" {
		writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "The Tax page is not connected: " +
			"set LENS_OPERATOR_READ_KEY in the web app's environment to the value Lens holds under the same name, and restart it."})
		return false
	}
	if method != http.MethodGet && a.cfg.moderatorKey == "" {
		writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "The Tax page cannot change anything yet: " +
			"set LENS_MODERATOR_KEY in the web app's environment and restart it (talyvor-lens docs/moderator-keys.md)."})
		return false
	}
	return true
}

// taxCall sends one request to Lens: a read on the operator read key with the page's filters, a write on the
// moderator key naming the operator.
func (a *app) taxCall(r *http.Request, s session, client *http.Client, method, lensPath string, body []byte) (*http.Response, error) {
	target := a.cfg.lensBaseURL + lensPath
	if method == http.MethodGet {
		q := url.Values{}
		for _, k := range taxReadQuery[lensPath] {
			if v := strings.TrimSpace(r.URL.Query().Get(k)); v != "" {
				q.Set(k, v)
			}
		}
		if len(q) > 0 {
			target += "?" + q.Encode()
		}
	}
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(r.Context(), method, target, rd)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	if method == http.MethodGet {
		req.Header.Set("Authorization", "Bearer "+a.cfg.operatorReadKey) // server-side only
	} else {
		req.Header.Set("Authorization", "Bearer "+a.cfg.moderatorKey) // server-side only
		req.Header.Set(lensModeratorOperatorHeader, moderatorName(s))
		req.Header.Set("Content-Type", "application/json")
	}
	return client.Do(req)
}

// taxRelay answers Lens's JSON for one of the page's requests, recording act (nil for a read) once Lens did it.
func (a *app) taxRelay(w http.ResponseWriter, r *http.Request, s session, method, lensPath string, body []byte, act *operatorAction, client *http.Client) {
	if !a.taxKeySet(w, method) {
		return
	}
	resp, err := a.taxCall(r, s, client, method, lensPath, body)
	if err != nil {
		log.Printf("bff: tax %s %s: %v", method, lensPath, err)
		writeUpstreamFailure(w, "lens", err)
		return
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || !json.Valid(raw) {
		taxRefused(w, method, lensPath, resp.StatusCode, raw)
		return
	}
	if act != nil {
		a.recordOperatorAction(r.Context(), s, *act)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(raw)
}

// taxRefused answers a Lens answer that is not what the page reads. Lens's 401 and 403 are about the web app's
// key, so they are answered 502 with the sentence that fixes them; a 404 is a Lens without the page's routes;
// another 4xx carries Lens's own sentence, such as the line of a rates file it refused.
func taxRefused(w http.ResponseWriter, method, lensPath string, status int, raw []byte) {
	var refusal struct {
		Error string `json:"error"`
	}
	_ = json.Unmarshal(raw, &refusal)
	switch {
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		log.Printf("bff: tax %s %s: Lens refused the web app's key (%d)", method, lensPath, status)
		if method == http.MethodGet {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens refused the web app's operator read key: " +
				"LENS_OPERATOR_READ_KEY here does not match the one Lens holds. Set both to the same value and restart them."})
			return
		}
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens refused the web app's moderator key: " +
			"LENS_MODERATOR_KEY is wrong or was revoked. Create a new one (talyvor-lens docs/moderator-keys.md)."})
	case status == http.StatusNotFound:
		writeJSON(w, http.StatusNotImplemented, map[string]string{"error": taxNotInLens})
	case status >= 400 && status < 500:
		if strings.TrimSpace(refusal.Error) == "" {
			refusal.Error = "Lens refused this"
		}
		writeJSON(w, status, map[string]string{"error": refusal.Error})
	default:
		log.Printf("bff: tax %s %s: Lens answered %d", method, lensPath, status)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens could not answer just now. Try again."})
	}
}
