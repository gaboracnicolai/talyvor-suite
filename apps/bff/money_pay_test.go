package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// B30.96 — a payee and a payment reach Lens under the session's token with only the fields the screen names; a payout
// batch goes up as the CSV it came as, under the browser's Idempotency-Key.
func TestPayScreenWritesReachLensAsNamed(t *testing.T) {
	var mu sync.Mutex
	got := []string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		mu.Lock()
		got = append(got, r.Method+" "+r.URL.Path+" ct="+r.Header.Get("Content-Type")+" key="+r.Header.Get("Idempotency-Key")+" auth="+r.Header.Get("Authorization")+" "+string(raw))
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":"x_1","status":"ok"}`))
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	if rec := doJSON(a, http.MethodPost, "/api/money/payees", `{"name":"Acme","country":"GB","sort_code":"040004","account_number":"12345678","check":"exact_match","workspace_id":"other"}`); rec.Code != http.StatusCreated {
		t.Fatalf("payee = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodPost, "/api/money/payments", `{"account_id":"macc_1","payee_id":"payee_1","amount_minor":2000,"currency":"GBP","reference":"Rent","idempotency_key":"k1","funding":"live","status":"completed"}`); rec.Code != http.StatusCreated {
		t.Fatalf("payment = %d %s", rec.Code, rec.Body.String())
	}
	csv := "payee_id,amount,currency,reference\npayee_1,5.00,GBP,May\n"
	up := httptest.NewRequest(http.MethodPost, "/api/money/payouts", strings.NewReader(csv))
	up.Header.Set("Content-Type", "text/csv")
	up.Header.Set("Idempotency-Key", "batch-1")
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, up)
	if rec.Code != http.StatusCreated {
		t.Fatalf("csv upload = %d %s", rec.Code, rec.Body.String())
	}

	mu.Lock()
	defer mu.Unlock()
	if len(got) != 3 {
		t.Fatalf("Lens saw %d calls, want 3:\n  %s", len(got), strings.Join(got, "\n  "))
	}
	for i, call := range got {
		if !strings.Contains(call, " auth=Bearer ") || strings.Contains(call, "auth=Bearer  ") {
			t.Errorf("call %d did not go up under the session's token: %s", i, call)
		}
	}
	payee := got[0][strings.Index(got[0], " {"):]
	for _, key := range []string{`"name":"Acme"`, `"country":"GB"`, `"sort_code":"040004"`, `"account_number":"12345678"`} {
		if !strings.Contains(payee, key) {
			t.Errorf("the payee sent to Lens lacks %s: %s", key, payee)
		}
	}
	for _, key := range []string{`"check"`, `"workspace_id"`} {
		if strings.Contains(payee, key) {
			t.Errorf("the payee sent to Lens carries %s, which the handler does not name: %s", key, payee)
		}
	}
	payment := got[1][strings.Index(got[1], " {"):]
	for _, key := range []string{`"account_id":"macc_1"`, `"payee_id":"payee_1"`, `"amount_minor":2000`, `"currency":"GBP"`, `"reference":"Rent"`, `"idempotency_key":"k1"`} {
		if !strings.Contains(payment, key) {
			t.Errorf("the payment sent to Lens lacks %s: %s", key, payment)
		}
	}
	for _, key := range []string{`"funding"`, `"status"`} {
		if strings.Contains(payment, key) {
			t.Errorf("the payment sent to Lens carries %s, which the handler does not name: %s", key, payment)
		}
	}
	if want := "POST /v1/money/payouts ct=text/csv key=batch-1 auth=Bearer "; !strings.HasPrefix(got[2], want) || !strings.HasSuffix(got[2], " "+csv) {
		t.Errorf("the payout batch did not go up as the CSV it came as, under its key: %q", got[2])
	}
}
