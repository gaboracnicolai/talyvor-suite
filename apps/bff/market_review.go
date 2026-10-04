package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// market_review.go — B20.12: the operator's marketplace review queue, behind requireOperator.
//
//	GET  /api/admin/marketplace/review                  held and reported listings, most reported first
//	POST /api/admin/marketplace/listings/{id}/approve   keep it up: release a hold, resolve its reports as kept
//	POST /api/admin/marketplace/listings/{id}/takedown  {reason}: take it down; answers the refunds Lens wrote
//
// Each goes to Lens on LENS_MODERATOR_KEY (Lens B20.13, docs/moderator-keys.md) — a key that can do
// these three things and nothing else, never a Lens admin key — and names the signed-in operator in
// X-Talyvor-Operator: Lens writes every use against that name to moderator_key_uses before it acts,
// and answers 400 without it. Unset, the three answer 501 saying which variable to set.

const lensModeratorOperatorHeader = "X-Talyvor-Operator"

// marketTakedownTimeout bounds a takedown: Lens credits every refunded buyer through Stripe before it answers.
const marketTakedownTimeout = 2 * time.Minute

// onlyMethod answers 405 to every other method before the operator gate is asked, so a wrong verb
// gets the same answer from every caller — the method is a fact about the route, not about who asks.
func onlyMethod(method string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != method {
			methodNotAllowed(w, method)
			return
		}
		next(w, r)
	}
}

// handleMarketReviewQueue — GET /api/admin/marketplace/review.
func (a *app) handleMarketReviewQueue(w http.ResponseWriter, r *http.Request, s session) {
	a.moderate(w, r, s, a.client, http.MethodGet, "/v1/admin/marketplace/review", nil, nil)
}

// handleMarketApprove — POST /api/admin/marketplace/listings/{id}/approve. Lens reads no body.
func (a *app) handleMarketApprove(w http.ResponseWriter, r *http.Request, s session) {
	id, ok := pathID(w, "listing id", r.PathValue("id"))
	if !ok {
		return
	}
	a.moderate(w, r, s, a.client, http.MethodPost, "/v1/admin/marketplace/listings/"+url.PathEscape(id)+"/approve", nil,
		&operatorAction{action: auditApprove, target: "listing:" + id})
}

// handleMarketTakedown — POST /api/admin/marketplace/listings/{id}/takedown {reason}. Lens refuses an
// empty reason or one over 500 characters with a sentence, and answers the listing and its refunds.
func (a *app) handleMarketTakedown(w http.ResponseWriter, r *http.Request, s session) {
	id, ok := pathID(w, "listing id", r.PathValue("id"))
	if !ok {
		return
	}
	var in struct {
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 16<<10)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensMarketTakedownBody: none
	body, _ := json.Marshal(in)
	ctx, cancel := context.WithTimeout(r.Context(), marketTakedownTimeout)
	defer cancel()
	a.moderate(w, r.WithContext(ctx), s, marketUseClient, http.MethodPost,
		"/v1/admin/marketplace/listings/"+url.PathEscape(id)+"/takedown", body,
		&operatorAction{action: auditTakedown, target: "listing:" + id, detail: in.Reason})
}

// moderatorName is who Lens records as having acted: the address a person reads, and the sub the
// operator boundary actually checked.
func moderatorName(s session) string {
	if s.email == "" {
		return "sub=" + s.sub
	}
	return s.email + " sub=" + s.sub
}

// moderate sends one review request to Lens on the moderator key and answers what Lens answered. An
// operator action (act, nil for a read) Lens did is recorded in the operator trail first (operator_audit.go).
//
// ⚠ LENS'S 401 AND 403 ARE NOT RELAYED AS THEY ARE. They are about the web app's key (wrong,
// revoked, or not a moderator key), and a 401 reaching the browser reads as "your session ended —
// sign in again", which would send the operator round a loop that cannot fix it. They are answered
// 502 with the sentence that can.
func (a *app) moderate(w http.ResponseWriter, r *http.Request, s session, client *http.Client, method, lensPath string, body []byte, act *operatorAction) {
	if a.cfg.moderatorKey == "" {
		writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "The review queue is not connected: " +
			"set LENS_MODERATOR_KEY in the web app's environment and restart it (talyvor-lens docs/moderator-keys.md)."})
		return
	}
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(r.Context(), method, a.cfg.lensBaseURL+lensPath, rd)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream request"})
		return
	}
	req.Header.Set("Authorization", "Bearer "+a.cfg.moderatorKey) // server-side only
	req.Header.Set(lensModeratorOperatorHeader, moderatorName(s))
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("bff: marketplace review %s %s: %v", method, lensPath, err)
		writeUpstreamFailure(w, "lens", err)
		return
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	var refusal struct {
		Error string `json:"error"`
	}
	_ = json.Unmarshal(raw, &refusal)
	switch {
	case resp.StatusCode >= 200 && resp.StatusCode < 300 && json.Valid(raw):
		if act != nil {
			a.recordOperatorAction(r.Context(), s, *act)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(resp.StatusCode)
		_, _ = w.Write(raw)
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
		log.Printf("bff: marketplace review %s %s: Lens refused the moderator key (%d)", method, lensPath, resp.StatusCode)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens refused the web app's moderator key: " +
			"LENS_MODERATOR_KEY is wrong or was revoked. Create a new one (talyvor-lens docs/moderator-keys.md)."})
	case resp.StatusCode >= 400 && resp.StatusCode < 500:
		if strings.TrimSpace(refusal.Error) == "" {
			refusal.Error = "Lens refused this"
		}
		writeJSON(w, resp.StatusCode, map[string]string{"error": refusal.Error})
	default:
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens could not answer just now"})
	}
}
