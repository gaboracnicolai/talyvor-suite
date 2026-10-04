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

// operator_audit.go — B27.29: every operator action in the app is recorded in Lens's operator audit
// trail (Lens B27.28), and the Operator screen reads it back.
//
// The operator actions, each recorded once Lens has done it — who (the operator's address and the sub
// the boundary checked), what, on which target, and when (Lens's clock):
//
//	marketplace.listing.approve    POST /api/admin/marketplace/listings/{id}/approve
//	marketplace.listing.takedown   POST /api/admin/marketplace/listings/{id}/takedown   detail: the reason
//	marketplace.parked_use.retry   POST /api/admin/marketplace/parked-uses/{id}/retry
//
// A record goes on LENS_MODERATOR_KEY — the key the action itself went on — naming the operator in
// X-Talyvor-Operator, so Lens takes the actor from the same header it checked. The trail is read on
// LENS_OPERATOR_READ_KEY, like the rest of the Operator screen:
//
//	GET /api/admin/operator-audit          JSON, newest first. Filters: actor, action, target (exact),
//	                                       since, until (RFC 3339 or YYYY-MM-DD; until includes its day), limit
//	GET /api/admin/operator-audit/export   the same filters, as CSV

const (
	auditApprove       = "marketplace.listing.approve"
	auditTakedown      = "marketplace.listing.takedown"
	auditParkedRetry   = "marketplace.parked_use.retry"
	operatorAuditWrite = 10 * time.Second
)

// operatorAuditFilters are the query parameters the trail's two reads pass to Lens; nothing else is sent.
var operatorAuditFilters = []string{"actor", "action", "target", "since", "until", "limit"}

// operatorAction is one operator action, recorded once Lens has done it.
type operatorAction struct {
	action, target, detail string
}

// recordOperatorAction appends act to Lens's trail. It runs after Lens has done the action and before the
// operator is answered, so the trail the screen reads next already holds it. The action is done either
// way: a record that fails cannot undo it, so it is logged with everything needed to record it by hand.
func (a *app) recordOperatorAction(ctx context.Context, s session, act operatorAction) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), operatorAuditWrite)
	defer cancel()
	// UPSTREAM-BINDS-ONLY lensOperatorAuditRecordBody: actor, at
	body, _ := json.Marshal(map[string]string{"action": act.action, "target": act.target, "detail": act.detail})
	err := func() error {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.cfg.lensBaseURL+"/v1/admin/operator-audit/record", bytes.NewReader(body))
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", "Bearer "+a.cfg.moderatorKey) // server-side only
		req.Header.Set(lensModeratorOperatorHeader, moderatorName(s))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json")
		resp, err := a.client.Do(req)
		if err != nil {
			return err
		}
		defer func() { _ = resp.Body.Close() }()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
			return fmt.Errorf("lens answered %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
		}
		return nil
	}()
	if err != nil {
		log.Printf("bff: operator audit NOT RECORDED: %s %q by %q at %s (%q): %v",
			act.action, act.target, moderatorName(s), time.Now().UTC().Format(time.RFC3339), act.detail, err)
	}
}

// handleOperatorAudit — GET /api/admin/operator-audit.
func (a *app) handleOperatorAudit(w http.ResponseWriter, r *http.Request, _ session) {
	a.readOperatorAudit(w, r, "/v1/admin/operator-audit", false)
}

// handleOperatorAuditExport — GET /api/admin/operator-audit/export.
func (a *app) handleOperatorAuditExport(w http.ResponseWriter, r *http.Request, _ session) {
	a.readOperatorAudit(w, r, "/v1/admin/operator-audit/export", true)
}

// readOperatorAudit relays one of the trail's reads. Lens's 400 (a filter it cannot read) is relayed with
// its sentence; its 401 and 403 are about the web app's key, so they are answered 502 with the sentence
// that fixes them, as everywhere on the Operator screen.
func (a *app) readOperatorAudit(w http.ResponseWriter, r *http.Request, lensPath string, csv bool) {
	if a.cfg.operatorReadKey == "" {
		writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "The operator trail is not connected: " +
			"set LENS_OPERATOR_READ_KEY in the web app's environment to the value Lens holds under the same name, and restart it."})
		return
	}
	q := url.Values{}
	for _, k := range operatorAuditFilters {
		if v := strings.TrimSpace(r.URL.Query().Get(k)); v != "" {
			q.Set(k, v)
		}
	}
	target := a.cfg.lensBaseURL + lensPath
	if len(q) > 0 {
		target += "?" + q.Encode()
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target, nil)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream request"})
		return
	}
	req.Header.Set("Authorization", "Bearer "+a.cfg.operatorReadKey) // server-side only
	resp, err := a.client.Do(req)
	if err != nil {
		log.Printf("bff: operator audit %s: %v", lensPath, err)
		writeUpstreamFailure(w, "lens", err)
		return
	}
	defer func() { _ = resp.Body.Close() }()
	switch {
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
		log.Printf("bff: operator audit %s: Lens refused the operator read key (%d)", lensPath, resp.StatusCode)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens refused the web app's operator read key: " +
			"LENS_OPERATOR_READ_KEY here does not match the one Lens holds. Set both to the same value and restart them."})
		return
	case resp.StatusCode == http.StatusBadRequest:
		var refusal struct {
			Error string `json:"error"`
		}
		_ = json.NewDecoder(io.LimitReader(resp.Body, 4<<10)).Decode(&refusal)
		if strings.TrimSpace(refusal.Error) == "" {
			refusal.Error = "Lens could not read these filters"
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": refusal.Error})
		return
	case resp.StatusCode < 200 || resp.StatusCode >= 300:
		log.Printf("bff: operator audit %s: Lens answered %d", lensPath, resp.StatusCode)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens could not read the operator trail just now. Try again."})
		return
	}
	if csv {
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="operator-audit.csv"`)
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)
		if _, err := io.Copy(w, resp.Body); err != nil {
			log.Printf("bff: operator audit export: %v", err)
		}
		return
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	var trail struct {
		Entries []json.RawMessage `json:"entries"`
	}
	if err == nil {
		err = json.Unmarshal(raw, &trail)
	}
	if err != nil {
		log.Printf("bff: operator audit %s: %v", lensPath, err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens could not read the operator trail just now. Try again."})
		return
	}
	if trail.Entries == nil {
		trail.Entries = []json.RawMessage{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": trail.Entries})
}
