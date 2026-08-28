package main

import (
	"net/http"
	"os"
	"regexp"
	"testing"
	"time"
)

// THE FOUR http.Server BOUNDS ARE NOW PINNED. Nothing reached them before.
//
// MEASURED 2026-08-28 (tab-k2w8, W4.35) by mutation, not by reading
// (~/talyvor-queue/w435-cookie-census-k2w8.py). Population 10, stated: every
// security-relevant attribute of the session cookie written by setCookie, plus
// pendingTTL, plus the BFF_ADDR default, plus these four server bounds.
//
// Result: 6 CAUGHT, 4 UNPINNED, 0 INVALID — and the split is worth reading,
// because most of this file's neighbourhood came back CLEAN:
//
//	CAUGHT   Secure: true -> false          (cookie over plaintext HTTP)
//	CAUGHT   HttpOnly: true -> false        (document.cookie -> session theft)
//	CAUGHT   SameSite Lax -> None           (the CSRF property auth.go relies on)
//	CAUGHT   Path "/" -> "/auth"            (breaks __Host- compatibility)
//	CAUGHT   pendingTTL 10m -> 10h
//	CAUGHT   BFF_ADDR 127.0.0.1 -> 0.0.0.0  (this repo defends its bind default;
//	                                         talyvor-code's MCP server did NOT — W4.32)
//	UNPINNED ReadHeaderTimeout · ReadTimeout · WriteTimeout · IdleTimeout,
//	         each multiplied by 100 with `go test -race ./...` staying green.
//
// ⚠ THIS FILE CHANGES NO VALUE. Every duration is the one already shipping.
// Whether 5s/15s/30s/60s are the RIGHT bounds is a tuning decision and is
// deliberately not taken here; what changes is that altering one becomes an
// edit to a named test rather than a silent one-token diff in main().

func TestHTTPServerBounds(t *testing.T) {
	srv := newHTTPServer("127.0.0.1:0", http.NewServeMux())
	for _, c := range []struct {
		name string
		got  time.Duration
		want time.Duration
		why  string
	}{
		{"ReadHeaderTimeout", srv.ReadHeaderTimeout, 5 * time.Second, "the slowloris bound"},
		{"ReadTimeout", srv.ReadTimeout, 15 * time.Second, "caps the request read phase"},
		{"WriteTimeout", srv.WriteTimeout, 30 * time.Second, "caps the response write phase"},
		{"IdleTimeout", srv.IdleTimeout, 60 * time.Second, "caps keep-alive idling"},
	} {
		if c.got != c.want {
			t.Errorf("%s = %v, recorded bound is %v (%s).\n"+
				"If this change is deliberate, change it here in the SAME commit and say why.",
				c.name, c.got, c.want, c.why)
		}
	}
	if srv.Handler == nil {
		t.Error("newHTTPServer returned a server with no Handler — it would serve http.DefaultServeMux")
	}
	if srv.Addr != "127.0.0.1:0" {
		t.Errorf("newHTTPServer ignored the addr it was given (got %q) — main's cfg.addr, "+
			"and with it the loopback default, would not reach the listener", srv.Addr)
	}
}

// TestOnlyOneHTTPServerIsConstructed is the completeness floor. Pinning the
// bounds on newHTTPServer proves nothing if main() later builds its own
// http.Server inline again — the guard would stay green while the process
// served unbounded. So: exactly one composite literal in this package, and it
// is the one this test can reach.
func TestOnlyOneHTTPServerIsConstructed(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("reading package dir: %v", err)
	}
	lit := regexp.MustCompile(`&http\.Server\{`)
	total := 0
	perFile := map[string]int{}
	for _, e := range entries {
		n := e.Name()
		if e.IsDir() || !regexp.MustCompile(`\.go$`).MatchString(n) || regexp.MustCompile(`_test\.go$`).MatchString(n) {
			continue
		}
		b, rerr := os.ReadFile(n)
		if rerr != nil {
			t.Fatalf("reading %s: %v", n, rerr)
		}
		if c := len(lit.FindAllString(string(b), -1)); c > 0 {
			perFile[n] = c
			total += c
		}
	}
	if total == 0 {
		t.Fatal("found ZERO &http.Server{ literals in this package — the parser is broken, " +
			"and a floor that finds nothing to count cannot fail for the right reason")
	}
	if total != 1 {
		t.Errorf("expected exactly ONE &http.Server{ literal (inside newHTTPServer), found %d: %v\n"+
			"A second construction site is a server whose bounds TestHTTPServerBounds cannot see.",
			total, perFile)
	}
	if perFile["main.go"] != 1 {
		t.Errorf("the one &http.Server{ literal is not in main.go (found %v) — "+
			"newHTTPServer is where the recorded bounds live", perFile)
	}
}
