package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// B30.97 — an invoice reaches Lens under the session's token with only the fields the screen names; the pay page and
// its card button reach Lens's public routes with NO credential at all; a token of the wrong shape never dials.
func TestInvoicesReachLensAndThePayPageCarriesNoCredential(t *testing.T) {
	var mu sync.Mutex
	got := []string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		mu.Lock()
		got = append(got, r.Method+" "+r.URL.Path+" auth="+r.Header.Get("Authorization")+" "+string(raw))
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/v1/money/invoices" && r.Method == http.MethodPost:
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"id":"inv_1","number":"INV-000001","status":"sent","pay_url":"https://app/pay/abcdefghijklmnopqrstuvwx"}`))
		case strings.HasSuffix(r.URL.Path, "/card"):
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"url":"https://checkout.stripe.com/c/pay/cs_test_1"}`))
		case strings.HasPrefix(r.URL.Path, "/v1/pay/"):
			_, _ = w.Write([]byte(`{"notice":"Preview — test money only. Nothing paid here moves real money.","card":true,"invoice":{"number":"INV-000001","status":"sent"}}`))
		default:
			_, _ = w.Write([]byte(`{"invoices":[]}`))
		}
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	rec := doJSON(a, http.MethodPost, "/api/money/invoices",
		`{"account_id":"macc_1","customer_name":"Acme","lines":[{"description":"Work","quantity":2,"unit_amount_minor":5000,"vat_rate_bps":2000,"net_minor":9}],"due_date":"2026-12-31","send":true,"currency":"GBP","workspace_id":"other"}`)
	if rec.Code != http.StatusCreated || !strings.Contains(rec.Body.String(), `"INV-000001"`) {
		t.Fatalf("create = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodGet, "/api/money/invoices", ""); rec.Code != http.StatusOK {
		t.Fatalf("invoices = %d %s", rec.Code, rec.Body.String())
	}

	// The pay page and the card button: the shell's own fetch, no session cookie, and Lens is called with no bearer.
	page := httptest.NewRecorder()
	a.ServeHTTP(page, httptest.NewRequest(http.MethodGet, "/api/public/pay/abcdefghijklmnopqrstuvwx", nil))
	if page.Code != http.StatusOK || !strings.Contains(page.Body.String(), "Preview — test money only") {
		t.Fatalf("pay page = %d %s", page.Code, page.Body.String())
	}
	card := httptest.NewRecorder()
	a.ServeHTTP(card, httptest.NewRequest(http.MethodPost, "/api/public/pay/abcdefghijklmnopqrstuvwx/card", nil))
	if card.Code != http.StatusCreated || !strings.Contains(card.Body.String(), "checkout.stripe.com") {
		t.Fatalf("pay by card = %d %s", card.Code, card.Body.String())
	}
	bad := httptest.NewRecorder()
	a.ServeHTTP(bad, httptest.NewRequest(http.MethodGet, "/api/public/pay/not%20a%20token", nil))
	if bad.Code != http.StatusNotFound {
		t.Fatalf("a malformed token = %d, want 404 before any dial", bad.Code)
	}

	mu.Lock()
	defer mu.Unlock()
	want := []string{
		`POST /v1/money/invoices auth=Bearer ` + " ", // filled below: the token is the fake provision's
		`GET /v1/money/invoices`,
		`GET /v1/pay/abcdefghijklmnopqrstuvwx auth= `,
		`POST /v1/pay/abcdefghijklmnopqrstuvwx/card auth= `,
	}
	if len(got) != len(want) {
		t.Fatalf("Lens saw %d calls, want %d:\n  %s", len(got), len(want), strings.Join(got, "\n  "))
	}
	create := got[0]
	if !strings.HasPrefix(create, "POST /v1/money/invoices auth=Bearer ") || strings.Contains(create, "auth=Bearer  ") {
		t.Fatalf("the invoice did not go up under the session's token: %s", create)
	}
	body := create[strings.Index(create, " {"):]
	for _, key := range []string{`"account_id":"macc_1"`, `"customer_name":"Acme"`, `"unit_amount_minor":5000`, `"vat_rate_bps":2000`, `"due_date":"2026-12-31"`, `"send":true`} {
		if !strings.Contains(body, key) {
			t.Errorf("the invoice sent to Lens lacks %s: %s", key, body)
		}
	}
	for _, key := range []string{`"currency"`, `"workspace_id"`, `"net_minor"`} {
		if strings.Contains(body, key) {
			t.Errorf("the invoice sent to Lens carries %s, which the handler does not name: %s", key, body)
		}
	}
	if !strings.HasPrefix(got[1], want[1]+" auth=Bearer ") {
		t.Errorf("the list did not go up under the session's token: %s", got[1])
	}
	for i := 2; i < 4; i++ {
		if got[i] != want[i] {
			t.Errorf("public call %d = %q, want %q (no credential)", i, got[i], want[i])
		}
	}
}
