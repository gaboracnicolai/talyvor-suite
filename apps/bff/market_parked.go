package main

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/url"
)

// market_parked.go — B27.19: the operator screen's parked marketplace uses, behind requireOperator.
//
//	GET  /api/admin/marketplace/parked-uses             every billed use Stripe refused too often, with its reason
//	POST /api/admin/marketplace/parked-uses/{id}/retry  put one back on the next metering run
//
// The read goes to Lens on LENS_OPERATOR_READ_KEY like the rest of the operator screen; the retry is a
// write, so it goes on LENS_MODERATOR_KEY with the operator's name, like the review queue (market_review.go).

// handleParkedUses — GET /api/admin/marketplace/parked-uses.
func (a *app) handleParkedUses(w http.ResponseWriter, r *http.Request, _ session) {
	if a.cfg.operatorReadKey == "" {
		writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "Parked uses are not connected: " +
			"set LENS_OPERATOR_READ_KEY in the web app's environment to the value Lens holds under the same name, and restart it."})
		return
	}
	raw, err := a.operatorRead(r.Context(), "/v1/admin/marketplace/parked-uses")
	var parked struct {
		ParkedUses []json.RawMessage `json:"parked_uses"`
	}
	if err == nil {
		err = undecodable(json.Unmarshal(raw, &parked))
	}
	if err != nil {
		log.Printf("bff: parked uses: %v", err)
		switch {
		case errors.Is(err, errLensRefusedKey):
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens refused the web app's operator read key: " +
				"LENS_OPERATOR_READ_KEY here does not match the one Lens holds. Set both to the same value and restart them."})
		case errors.Is(err, errLensAnswered):
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens could not read the parked uses just now. Try again."})
		default:
			writeUpstreamFailure(w, "lens", err)
		}
		return
	}
	if parked.ParkedUses == nil {
		parked.ParkedUses = []json.RawMessage{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"parked_uses": parked.ParkedUses})
}

// handleParkedUseRetry — POST /api/admin/marketplace/parked-uses/{id}/retry. Lens reads no body.
func (a *app) handleParkedUseRetry(w http.ResponseWriter, r *http.Request, s session) {
	id, ok := pathID(w, "use id", r.PathValue("id"))
	if !ok {
		return
	}
	a.moderate(w, r, s, a.client, http.MethodPost, "/v1/admin/marketplace/parked-uses/"+url.PathEscape(id)+"/retry", nil)
}
