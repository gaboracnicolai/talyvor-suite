package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// B32.63 — the Tax page reads on the operator read key and writes on the moderator key naming the operator;
// the platform report reaches the browser as Lens wrote it, with its sha256.

const taxReportCSV = "seller_id,country,quarter,consideration_usd_micros\r\nsel_1,GB,2026Q4,90000000\r\n"

func taxApp(t *testing.T, lensStatus int) (*app, *http.Cookie, *http.Cookie, *[]seenLens) {
	t.Helper()
	var mu sync.Mutex
	seen := &[]seenLens{}
	lens := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		mu.Lock()
		*seen = append(*seen, seenLens{r.Method, r.URL.RequestURI(), r.Header.Get("Authorization"), r.Header.Get("X-Talyvor-Operator"), string(b)})
		mu.Unlock()
		if r.Method == http.MethodPost && r.URL.Path == "/v1/admin/platform-reports" && lensStatus == http.StatusOK {
			w.Header().Set("Content-Type", "text/csv; charset=utf-8")
			w.Header().Set("Content-Disposition", `attachment; filename="platform-report-2026.csv"`)
			w.Header().Set("X-Platform-Report-Sha256", "abc123")
			w.Header().Set("X-Platform-Report-Rows", "1")
			_, _ = io.WriteString(w, taxReportCSV)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(lensStatus)
		if lensStatus == http.StatusNotFound {
			_, _ = io.WriteString(w, "404 page not found")
			return
		}
		_, _ = io.WriteString(w, `{"rates":3,"jurisdictions":2}`)
	}))
	t.Cleanup(lens.Close)
	a, op, user := operatorApp(t, []string{"sub-operator"})
	a.cfg.lensBaseURL = lens.URL
	a.cfg.operatorReadKey = "op-read-key"
	a.cfg.moderatorKey = "tlv_mod_abc"
	return a, op, user, seen
}

func TestTax_ReadsGoOnTheOperatorReadKeyWithOnlyThePagesFilters(t *testing.T) {
	a, op, _, seen := taxApp(t, http.StatusOK)
	if rec := reviewCall(a, op, http.MethodGet, "/api/admin/tax/return?jurisdiction=GB&quarter=2026Q4&funding=live&sneak=1", ""); rec.Code != http.StatusOK {
		t.Fatalf("return: %d %s", rec.Code, rec.Body.String())
	}
	got := (*seen)[0]
	if got.method != http.MethodGet || got.path != "/v1/admin/tax/return?funding=live&jurisdiction=GB&quarter=2026Q4" ||
		got.auth != "Bearer op-read-key" {
		t.Fatalf("Lens was asked %+v", got)
	}
}

func TestTax_RatesImportGoesOnTheModeratorKeyAndIsRecorded(t *testing.T) {
	a, op, _, seen := taxApp(t, http.StatusOK)
	rec := reviewCall(a, op, http.MethodPost, "/api/admin/tax/rates/import", `{"csv":"jurisdiction,rate_bps\nGB,2000\nDE,1900\n"}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"rates":3`) {
		t.Fatalf("import: %d %s", rec.Code, rec.Body.String())
	}
	imp, audit := (*seen)[0], (*seen)[1]
	if imp.path != "/v1/admin/tax/rates/import" || imp.auth != "Bearer tlv_mod_abc" || imp.operator != "op@example.com sub=sub-operator" ||
		imp.body != `{"csv":"jurisdiction,rate_bps\nGB,2000\nDE,1900\n"}` {
		t.Fatalf("Lens was asked %+v", imp)
	}
	if audit.path != "/v1/admin/operator-audit/record" || !strings.Contains(audit.body, `"action":"tax.rates.import"`) ||
		!strings.Contains(audit.body, `"detail":"2 lines"`) {
		t.Fatalf("the import was not recorded in the operator trail: %+v", audit)
	}
}

func TestTax_PlatformReportReachesTheBrowserWithItsSha256(t *testing.T) {
	a, op, _, seen := taxApp(t, http.StatusOK)
	rec := reviewCall(a, op, http.MethodPost, "/api/admin/platform-reports", `{"year":2026,"funding":"test","format":"csv","actor":"someone else"}`)
	if rec.Code != http.StatusOK || rec.Body.String() != taxReportCSV {
		t.Fatalf("report: %d %q", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("X-Platform-Report-Sha256") != "abc123" || rec.Header().Get("X-Platform-Report-Rows") != "1" ||
		!strings.Contains(rec.Header().Get("Content-Disposition"), "platform-report-2026.csv") || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("headers %v", rec.Header())
	}
	got := (*seen)[0]
	if got.auth != "Bearer tlv_mod_abc" || got.operator != "op@example.com sub=sub-operator" || got.body != `{"year":2026,"funding":"test","format":"csv"}` {
		t.Fatalf("Lens was asked %+v — the actor is the operator header, never the body", got)
	}
}

func TestTax_ALensWithoutTheRoutesSaysSo(t *testing.T) {
	a, op, _, _ := taxApp(t, http.StatusNotFound)
	rec := reviewCall(a, op, http.MethodGet, "/api/admin/tax/rates", "")
	if rec.Code != http.StatusNotImplemented || !strings.Contains(rec.Body.String(), "does not answer the Tax page yet") {
		t.Fatalf("404 from Lens: %d %s", rec.Code, rec.Body.String())
	}
}

func TestTax_OnlyAnOperatorReachesLens(t *testing.T) {
	a, _, user, seen := taxApp(t, http.StatusOK)
	for _, c := range []struct{ method, path, body string }{
		{http.MethodGet, "/api/admin/tax/rates", ""},
		{http.MethodPost, "/api/admin/tax/registrations", `{"jurisdiction":"GB","scheme":"GB VAT","number":"GB123456789","effective_from":"2026-01-01"}`},
		{http.MethodPost, "/api/admin/platform-reports", `{"year":2026}`},
	} {
		if rec := reviewCall(a, user, c.method, c.path, c.body); rec.Code != http.StatusForbidden {
			t.Errorf("%s %s by a non-operator: %d", c.method, c.path, rec.Code)
		}
	}
	if len(*seen) != 0 {
		t.Fatalf("Lens was asked %v for a non-operator", *seen)
	}
}
