package main

import (
	"strings"
	"testing"
)

// TestAppPageCarriesSecurityHeaders — B28.247: an app page (a client route, answered with index.html) cannot be
// framed and names its CSP and referrer policy.
func TestAppPageCarriesSecurityHeaders(t *testing.T) {
	rec := getPath(t, newFallbackApp(t, fallbackFixture{}), "/ledger")
	if !servedTheApp(rec) {
		t.Fatalf("GET /ledger: %d %q is not the app's page", rec.Code, rec.Body.String())
	}
	for name, want := range map[string]string{
		"Content-Security-Policy": "frame-ancestors 'none'",
		"X-Frame-Options":         "DENY",
		"Referrer-Policy":         "same-origin",
	} {
		if got := rec.Header().Get(name); !strings.Contains(got, want) {
			t.Errorf("%s: %q, want it to carry %q", name, got, want)
		}
	}
}
