package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func postSubscribe(a *app, sess *http.Cookie, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/billing/subscribe", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://app.talyvor.com")
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)
	return rec
}

// B13.3: a plan pick reaches Lens as {"plan":…} on the SESSION's workspace and the browser gets
// the Stripe URL back; anything else the client sends stays here.
func TestSubscribeForwardsThePlanToThePinnedWorkspace(t *testing.T) {
	up := newCheckoutUpstream(t)
	a, sess := checkoutApp(t, up)

	rec := postSubscribe(a, sess, `{"plan":"pro","workspace_id":"SOMEBODY-ELSE","price":"price_x"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("got %d (%s), want 200", rec.Code, rec.Body.String())
	}
	if up.gotPath != "/v1/workspaces/u-test-workspace/billing/subscribe" {
		t.Fatalf("upstream path = %q — must be the SESSION's workspace", up.gotPath)
	}
	var sent map[string]any
	if err := json.Unmarshal([]byte(up.gotBody), &sent); err != nil || len(sent) != 1 || sent["plan"] != "pro" {
		t.Fatalf("upstream body = %s, want exactly {\"plan\":\"pro\"}", up.gotBody)
	}
	if got := decodeBody(t, rec)["url"]; got != testCheckoutURL {
		t.Fatalf("url = %v, want the Stripe session URL", got)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", cc)
	}
}

// An unknown plan is refused before Lens is dialled; a plan this deployment does not sell comes
// back as for_sale:false; a second subscription is a 409, never a checkout.
func TestSubscribeRefusals(t *testing.T) {
	up := newCheckoutUpstream(t)
	a, sess := checkoutApp(t, up)

	if rec := postSubscribe(a, sess, `{"plan":"enterprise"}`); rec.Code != http.StatusBadRequest || up.gotPath != "" {
		t.Fatalf("unknown plan: got %d, upstream %q — want 400 and no dial", rec.Code, up.gotPath)
	}
	up.nextStatus, up.nextBody = http.StatusNotImplemented, `{"error":"billing: no subscription price"}`
	rec := postSubscribe(a, sess, `{"plan":"max"}`)
	if rec.Code != http.StatusServiceUnavailable || decodeBody(t, rec)["for_sale"] != false {
		t.Fatalf("not sold: got %d %s, want 503 for_sale:false", rec.Code, rec.Body.String())
	}
	up.nextStatus, up.nextBody = http.StatusInternalServerError,
		`{"error":"billing: workspace u-test-workspace already has a live subscription (sub_1)"}`
	if rec := postSubscribe(a, sess, `{"plan":"plus"}`); rec.Code != http.StatusConflict {
		t.Fatalf("already subscribed: got %d, want 409", rec.Code)
	}
}
