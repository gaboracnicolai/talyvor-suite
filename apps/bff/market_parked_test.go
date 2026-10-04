package main

import (
	"net/http"
	"strings"
	"testing"
)

// B27.19 — parked uses are read on the operator read key; a retry goes on the moderator key, naming the
// operator; neither reaches Lens for a non-operator.
func TestParkedUses_ReadOnTheOperatorKeyRetryOnTheModeratorKey(t *testing.T) {
	parked := `{"parked_uses":[{"id":"u1","buyer_workspace_id":"ws-b","refusals":5,"reason":"resource_missing: No such customer"}]}`
	a, op, user, seen := reviewApp(t, "tlv_mod_abc", http.StatusOK, parked)
	a.cfg.operatorReadKey = "tlv_opread_abc"
	rec := reviewCall(a, op, http.MethodGet, "/api/admin/marketplace/parked-uses", "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"reason":"resource_missing: No such customer"`) {
		t.Fatalf("read: %d %s", rec.Code, rec.Body.String())
	}
	if got := (*seen)[0]; got.path != "/v1/admin/marketplace/parked-uses" || got.auth != "Bearer tlv_opread_abc" {
		t.Fatalf("Lens was asked %+v", got)
	}
	if rec := reviewCall(a, op, http.MethodPost, "/api/admin/marketplace/parked-uses/u1/retry", ""); rec.Code != http.StatusOK {
		t.Fatalf("retry: %d %s", rec.Code, rec.Body.String())
	}
	if got := (*seen)[1]; got.method != http.MethodPost || got.path != "/v1/admin/marketplace/parked-uses/u1/retry" ||
		got.auth != "Bearer tlv_mod_abc" || got.operator != "op@example.com sub=sub-operator" {
		t.Fatalf("Lens was asked %+v", got)
	}
	before := len(*seen) // the retry and its operator-trail record (B27.29)
	if rec := reviewCall(a, user, http.MethodPost, "/api/admin/marketplace/parked-uses/u1/retry", ""); rec.Code != http.StatusForbidden || len(*seen) != before {
		t.Fatalf("a non-operator's retry: %d (lens calls %d, was %d)", rec.Code, len(*seen), before)
	}
}
