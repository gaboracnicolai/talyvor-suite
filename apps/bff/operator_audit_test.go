package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// B27.29 — every operator action leaves one row in Lens's operator trail, naming who did what to which
// target; the Operator screen reads the trail back, filtered, and downloads it as CSV.

type trailRow struct {
	Actor  string `json:"actor"`
	Action string `json:"action"`
	Target string `json:"target"`
	Detail string `json:"detail"`
}

// trailLens is Lens with B27.28's trail: a record appends a row whose actor is the operator the header
// names; the read answers the rows the action filter selects. Every listing and parked use exists except
// "gone", which Lens refuses.
func trailLens(t *testing.T) (*app, *http.Cookie, *http.Cookie, func() []trailRow, *[]string) {
	t.Helper()
	var mu sync.Mutex
	rows := []trailRow{}
	asked := &[]string{}
	lens := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		*asked = append(*asked, r.Method+" "+r.URL.RequestURI()+" "+r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.Contains(r.URL.Path, "/gone/"):
			w.WriteHeader(http.StatusNotFound)
			_, _ = io.WriteString(w, `{"error":"no such listing"}`)
		case r.URL.Path == "/v1/admin/operator-audit/record":
			var in trailRow
			_ = json.NewDecoder(r.Body).Decode(&in)
			in.Actor = r.Header.Get("X-Talyvor-Operator")
			rows = append(rows, in)
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(in)
		case r.URL.Path == "/v1/admin/operator-audit":
			out := []trailRow{}
			for _, x := range rows {
				if a := r.URL.Query().Get("action"); a == "" || a == x.Action {
					out = append(out, x)
				}
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"entries": out})
		case r.URL.Path == "/v1/admin/operator-audit/export":
			w.Header().Set("Content-Type", "text/csv; charset=utf-8")
			_, _ = io.WriteString(w, "id,occurred_at,actor,action,target,detail,recorded_at\n")
		default:
			_, _ = io.WriteString(w, `{"ok":true}`)
		}
	}))
	t.Cleanup(lens.Close)
	a, op, user := operatorApp(t, []string{"sub-operator"})
	a.cfg.lensBaseURL = lens.URL
	a.cfg.moderatorKey = "tlv_mod_abc"
	a.cfg.operatorReadKey = "tlv_opread_abc"
	return a, op, user, func() []trailRow {
		mu.Lock()
		defer mu.Unlock()
		return append([]trailRow(nil), rows...)
	}, asked
}

func TestOperatorAudit_EachActionLeavesOneRowOnTheOperatorTrail(t *testing.T) {
	a, op, _, _, asked := trailLens(t)
	for _, c := range []struct{ path, body string }{
		{"/api/admin/marketplace/listings/l1/approve", ""},
		{"/api/admin/marketplace/listings/l2/takedown", `{"reason":"exposes a key"}`},
		{"/api/admin/marketplace/parked-uses/u9/retry", ""},
		// Lens refused it, so nothing was done and nothing is recorded.
		{"/api/admin/marketplace/listings/gone/approve", ""},
	} {
		reviewCall(a, op, http.MethodPost, c.path, c.body)
	}
	for _, q := range *asked {
		if strings.HasPrefix(q, "POST /v1/admin/operator-audit/record ") && !strings.HasSuffix(q, " Bearer tlv_mod_abc") {
			t.Fatalf("a record went on another key than the moderator key: %s", q)
		}
	}

	rec := reviewCall(a, op, http.MethodGet, "/api/admin/operator-audit", "")
	var got struct{ Entries []trailRow }
	if err := json.Unmarshal(rec.Body.Bytes(), &got); rec.Code != http.StatusOK || err != nil {
		t.Fatalf("trail: %d %s", rec.Code, rec.Body.String())
	}
	who := "op@example.com sub=sub-operator"
	want := []trailRow{
		{who, auditApprove, "listing:l1", ""},
		{who, auditTakedown, "listing:l2", "exposes a key"},
		{who, auditParkedRetry, "parked_use:u9", ""},
	}
	if len(got.Entries) != len(want) {
		t.Fatalf("trail has %d rows, want one per action: %+v", len(got.Entries), got.Entries)
	}
	for i := range want {
		if got.Entries[i] != want[i] {
			t.Fatalf("row %d = %+v, want %+v", i, got.Entries[i], want[i])
		}
	}
}

func TestOperatorAudit_ReadAndExportGoOnTheReadKeyWithTheirFilters(t *testing.T) {
	a, op, user, _, asked := trailLens(t)
	rec := reviewCall(a, op, http.MethodGet, "/api/admin/operator-audit?action="+auditTakedown+"&since=2026-10-01&until=2026-10-04&sneaky=1", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("filtered read: %d %s", rec.Code, rec.Body.String())
	}
	if q := (*asked)[0]; q != "GET /v1/admin/operator-audit?action=marketplace.listing.takedown&since=2026-10-01&until=2026-10-04 Bearer tlv_opread_abc" {
		t.Fatalf("Lens was asked %q", q)
	}
	rec = reviewCall(a, op, http.MethodGet, "/api/admin/operator-audit/export?actor=x", "")
	if rec.Code != http.StatusOK || !strings.HasPrefix(rec.Body.String(), "id,occurred_at,actor,") ||
		rec.Header().Get("Content-Disposition") != `attachment; filename="operator-audit.csv"` {
		t.Fatalf("export: %d %q %s", rec.Code, rec.Header().Get("Content-Disposition"), rec.Body.String())
	}
	if q := (*asked)[1]; q != "GET /v1/admin/operator-audit/export?actor=x Bearer tlv_opread_abc" {
		t.Fatalf("Lens was asked %q", q)
	}
	if rec := reviewCall(a, user, http.MethodGet, "/api/admin/operator-audit/export", ""); rec.Code != http.StatusForbidden || len(*asked) != 2 {
		t.Fatalf("a non-operator's export: %d (lens calls %d)", rec.Code, len(*asked))
	}
}
