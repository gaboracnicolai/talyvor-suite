package main

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func providerKeyRequest(a *app, sess *http.Cookie, method, path, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://app.talyvor.com")
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)
	return rec
}

// B27.27: a key reaches Lens once, as {"key":…}, on the SESSION's workspace and the provider named in the
// path; the screen gets back only what Lens answers (the last four), and the key is never logged here.
func TestProviderKeyPutSendsTheKeyToLensAndNothingElse(t *testing.T) {
	up := newCheckoutUpstream(t)
	a, sess := checkoutApp(t, up)
	var logs bytes.Buffer
	prev := log.Writer()
	log.SetOutput(&logs)
	t.Cleanup(func() { log.SetOutput(prev) })

	const key = "sk-test-0123456789wxyz"
	up.nextBody = `{"provider":"openai","last4":"wxyz","updated_at":"2026-10-04T10:00:00Z"}`
	rec := providerKeyRequest(a, sess, http.MethodPut, "/api/provider-keys/openai", `{"key":"`+key+`","workspace_id":"SOMEBODY-ELSE"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("got %d (%s), want 200", rec.Code, rec.Body.String())
	}
	if up.gotMethod != http.MethodPut || up.gotPath != "/v1/workspaces/u-test-workspace/provider-keys/openai" {
		t.Fatalf("upstream %s %s — want PUT on the SESSION's workspace", up.gotMethod, up.gotPath)
	}
	var sent map[string]any
	if err := json.Unmarshal([]byte(up.gotBody), &sent); err != nil || len(sent) != 1 || sent["key"] != key {
		t.Fatalf("upstream body = %s, want exactly {\"key\":…}", up.gotBody)
	}
	if got := decodeBody(t, rec); got["last4"] != "wxyz" || strings.Contains(rec.Body.String(), key) {
		t.Fatalf("answer = %s, want Lens's last four and never the key", rec.Body.String())
	}
	if strings.Contains(logs.String(), key) {
		t.Fatalf("the key was logged: %s", logs.String())
	}
}

// A provider outside Lens's list is refused before Lens is dialled; a removal is Lens's 204; Lens's 402
// (not on the BYOK plan) reaches the screen with its sentence; a deployment without custody reads as
// enabled:false; and BYOK is a plan a subscribe may name.
func TestProviderKeyRefusalsRemovalAndPlan(t *testing.T) {
	up := newCheckoutUpstream(t)
	a, sess := checkoutApp(t, up)

	if rec := providerKeyRequest(a, sess, http.MethodPut, "/api/provider-keys/bedrock", `{"key":"AKIA12345678"}`); rec.Code != http.StatusBadRequest || up.gotPath != "" {
		t.Fatalf("unknown provider: got %d, upstream %q — want 400 and no dial", rec.Code, up.gotPath)
	}
	up.nextStatus = http.StatusNoContent
	if rec := providerKeyRequest(a, sess, http.MethodDelete, "/api/provider-keys/anthropic", ""); rec.Code != http.StatusNoContent ||
		up.gotMethod != http.MethodDelete || up.gotPath != "/v1/workspaces/u-test-workspace/provider-keys/anthropic" {
		t.Fatalf("remove: got %d, upstream %s %s — want 204 relayed from DELETE", rec.Code, up.gotMethod, up.gotPath)
	}
	up.nextStatus, up.nextBody = http.StatusPaymentRequired, `{"error":"byok: subscribe to the BYOK plan to use your own provider keys"}`
	rec := providerKeyRequest(a, sess, http.MethodPut, "/api/provider-keys/openai", `{"key":"sk-test-abcdefgh"}`)
	if rec.Code != http.StatusPaymentRequired || !strings.Contains(decodeBody(t, rec)["error"].(string), "BYOK plan") {
		t.Fatalf("not subscribed: got %d %s, want 402 with Lens's sentence", rec.Code, rec.Body.String())
	}
	up.nextStatus, up.nextBody = http.StatusNotFound, `{"error":"not found"}`
	rec = providerKeyRequest(a, sess, http.MethodGet, "/api/provider-keys", "")
	if rec.Code != http.StatusOK || decodeBody(t, rec)["enabled"] != false {
		t.Fatalf("no custody: got %d %s, want 200 enabled:false", rec.Code, rec.Body.String())
	}
	up.nextStatus, up.nextBody = 0, ""
	if rec := postSubscribe(a, sess, `{"plan":"byok"}`); rec.Code != http.StatusOK || up.gotBody != `{"plan":"byok"}` {
		t.Fatalf("subscribe byok: got %d, upstream body %s — want 200 and {\"plan\":\"byok\"}", rec.Code, up.gotBody)
	}
}
