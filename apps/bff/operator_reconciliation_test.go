package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// B30.104 — the Compliance page's reconciliation and safeguarding reads go to Lens on the operator read key.

func reconciliationApp(t *testing.T, key string) (*app, *http.Cookie, *http.Cookie, *[]string) {
	t.Helper()
	seen := &[]string{}
	lens := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*seen = append(*seen, r.Method+" "+r.URL.Path+" "+r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"runs":[{"day":"2026-10-08","currency":"GBP","break_count":1,"breaks":[{"kind":"missing","amount_minor":-700}]}]}`)
	}))
	t.Cleanup(lens.Close)
	a, op, user := operatorApp(t, []string{"sub-operator"})
	a.cfg.lensBaseURL = lens.URL
	a.cfg.operatorReadKey = key
	return a, op, user, seen
}

func TestReconciliation_OperatorReadsLensRunsOnTheOperatorReadKey(t *testing.T) {
	a, op, _, seen := reconciliationApp(t, "op-read-key")
	rec := reviewCall(a, op, http.MethodGet, "/api/admin/reconciliation", "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"kind":"missing"`) {
		t.Fatalf("reconciliation: %d %s", rec.Code, rec.Body.String())
	}
	if rec := reviewCall(a, op, http.MethodGet, "/api/admin/safeguarding", ""); rec.Code != http.StatusOK {
		t.Fatalf("safeguarding: %d %s", rec.Code, rec.Body.String())
	}
	want := "GET /v1/admin/reconciliation Bearer op-read-key,GET /v1/admin/safeguarding Bearer op-read-key"
	if got := strings.Join(*seen, ","); got != want {
		t.Fatalf("Lens was asked %q, want %q", got, want)
	}
}

func TestReconciliation_NonOperatorAndUnsetKeyReachNothing(t *testing.T) {
	a, _, user, seen := reconciliationApp(t, "op-read-key")
	if rec := reviewCall(a, user, http.MethodGet, "/api/admin/reconciliation", ""); rec.Code != http.StatusForbidden {
		t.Fatalf("non-operator: %d %s", rec.Code, rec.Body.String())
	}
	a, op, _, seen2 := reconciliationApp(t, "")
	if rec := reviewCall(a, op, http.MethodGet, "/api/admin/safeguarding", ""); rec.Code != http.StatusNotImplemented ||
		!strings.Contains(rec.Body.String(), "LENS_OPERATOR_READ_KEY") {
		t.Fatalf("unset key: %d %s", rec.Code, rec.Body.String())
	}
	if len(*seen)+len(*seen2) != 0 {
		t.Fatalf("Lens was asked %v %v", *seen, *seen2)
	}
}
