package main

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
)

// operator_reconciliation.go — B30.104: the operator's Compliance page reads Lens's daily reconciliation (B30.11),
// behind requireOperator.
//
//	GET /api/admin/reconciliation   each day's run in each currency, newest first, with every break
//	GET /api/admin/safeguarding     the latest run in each currency: what customers hold against what the partner
//	                                reports holding for them, and any shortfall
//
// Both go to Lens on LENS_OPERATOR_READ_KEY and answer Lens's JSON as it is. Unset, they answer 501 saying which
// variable to set. The page's capability classes and clearances are GET /api/wallets/capabilities, which every
// signed-in session already reads.

func (a *app) handleReconciliation(w http.ResponseWriter, r *http.Request, _ session) {
	a.operatorRelay(w, r, "/v1/admin/reconciliation")
}

func (a *app) handleSafeguarding(w http.ResponseWriter, r *http.Request, _ session) {
	a.operatorRelay(w, r, "/v1/admin/safeguarding")
}

// operatorRelay answers one of Lens's cross-tenant reads, on the operator read key, as Lens wrote it.
func (a *app) operatorRelay(w http.ResponseWriter, r *http.Request, lensPath string) {
	if a.cfg.operatorReadKey == "" {
		writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "The Compliance page is not connected: " +
			"set LENS_OPERATOR_READ_KEY in the web app's environment to the value Lens holds under the same name, and restart it."})
		return
	}
	raw, err := a.operatorRead(r.Context(), lensPath)
	if err == nil && !json.Valid(raw) {
		err = undecodable(errors.New("not JSON"))
	}
	switch {
	case err == nil:
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(raw)
	case errors.Is(err, errLensRefusedKey):
		log.Printf("bff: operator read %s: %v", lensPath, err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens refused the web app's operator read key: " +
			"LENS_OPERATOR_READ_KEY here does not match the one Lens holds. Set both to the same value and restart them."})
	case errors.Is(err, errLensAnswered):
		log.Printf("bff: operator read %s: %v", lensPath, err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens could not answer just now. Try again."})
	default:
		log.Printf("bff: operator read %s: %v", lensPath, err)
		writeUpstreamFailure(w, "lens", err)
	}
}
