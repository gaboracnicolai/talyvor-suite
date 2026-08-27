package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// product_timeout_test.go — A HEALTHY MODEL THAT TAKES LONGER THAN THE SHARED CLIENT'S
// WHOLE-EXCHANGE TIMEOUT IS REPORTED TO THE BROWSER AS AN UNREACHABLE UPSTREAM.
//
// ── WHY THIS IS NOT A NEW OBSERVATION, WHICH IS WHAT MAKES IT WORTH A FILE ───
//
// stream.go's own header already measured the bound and named the consequence:
//
//	"⚠ A TEN-SECOND WHOLE-EXCHANGE TIMEOUT ON THE SHARED CLIENT, WHICH NOBODY HAD NAMED.
//	 `a.client` is `&http.Client{Timeout: 10 * time.Second}`, and http.Client.Timeout covers
//	 READING THE BODY — not just the handshake. A flushing relay on that client streams
//	 beautifully and is then guillotined at ten seconds, truncating every completion longer than
//	 that, WHICH IS MOST OF THEM."
//
// That fix moved the bound off ONE route — `/api/ai/stream/{provider}`, which uses
// newStreamClient() — and that is the one AI route in this BFF that moves NO LXC (Chat.tsx:37
// records the measurement). Every route that DOES bill the workspace still goes through
// `a.client`: all nine metered surfaces in apps/web reach Lens through `forwardProduct`, which is
// the single `a.client.Do` at lens.go. The bound was removed from the free route and left on the
// paid ones.
//
// ── THE PART THAT IS THIS FILE'S OWN FINDING ─────────────────────────────────
//
// docs_ai_test.go opens by recording that TWO DIFFERENT 503s reach the browser on that route and
// mean opposite things, and that only `code` separates them. The same is true one status over and
// nothing said so: `502 {"error":"docs upstream unreachable"}` is emitted BOTH when nothing is
// listening — where it is true — and when Docs is running perfectly and its model is still
// working, where it is false in the most expensive possible direction. MEASURED (below): a
// healthy upstream that answers 300ms after a 50ms client bound produces exactly the bytes a
// connection-refused produces.
//
// It matters because seven of the nine metered cards in apps/web read that 502 and tell the
// reader that nothing happened — "nothing was asked of the model" on the four Docs write
// surfaces, "nothing was read" on the two searches, "nothing was charged" on AISummary. Whether
// the charge landed is the upstream's to know; what this BFF can do is stop calling a timeout an
// unreachable upstream, so the two are separable on the wire. Changing what the CARDS say is a
// product decision and is deliberately not taken here.
//
// ⚠ THE DURATION IS SCALED IN THESE TESTS AND THE SHIPPED VALUE IS ASSERTED SEPARATELY. A unit
// test may not sit for ten seconds; what it can do is drive the same code path with a smaller
// bound and, in its own test, pin the number the product actually ships.

// TestSharedClient_BoundsTheWholeExchange pins the shipped bound and the contrast that makes it
// a finding rather than a setting.
func TestSharedClient_BoundsTheWholeExchange(t *testing.T) {
	a := newTestApp(t, nil)
	if a.client.Timeout != 10*time.Second {
		t.Fatalf("shared client Timeout = %v, want 10s — if this bound moved, the two tests below "+
			"and stream.go's header are both describing a product that no longer exists", a.client.Timeout)
	}
	// The one AI route that does NOT bill had this bound deliberately removed. If the stream
	// client ever gains a whole-exchange Timeout the argument in stream.go has been reversed.
	if a.streamClient.Timeout != 0 {
		t.Fatalf("stream client Timeout = %v, want 0 — stream.go's whole point is that a "+
			"whole-exchange bound truncates long completions", a.streamClient.Timeout)
	}
}

// slowProduct is a healthy Docs/Track upstream that answers correctly, just not quickly.
func slowProduct(t *testing.T, delay time.Duration) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		if r.URL.Path == trackBootstrapPath {
			_, _ = io.WriteString(w, `{"workspace_id":"track-ws-7"}`)
			return
		}
		time.Sleep(delay)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"answer":"the answer the reader never sees"}`)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func askOn(t *testing.T, srv *httptest.Server, clientTimeout time.Duration) *httptest.ResponseRecorder {
	t.Helper()
	a, sess := productApp(t, &captureUpstream{srv: srv}, &captureUpstream{srv: srv})
	a.client = &http.Client{Timeout: clientTimeout}
	req := httptest.NewRequest(http.MethodPost, "/api/docs/ai/ask", strings.NewReader(`{"question":"q"}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(sess)
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	return rec
}

func TestMeteredRoute_SlowUpstreamIsNotCalledUnreachable(t *testing.T) {
	rec := askOn(t, slowProduct(t, 300*time.Millisecond), 50*time.Millisecond)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", rec.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body is not JSON: %v (%s)", err, rec.Body.String())
	}
	if strings.Contains(body["error"], "unreachable") {
		t.Fatalf("a Docs upstream that answered — late — was reported as %q. It was reached, it "+
			"is healthy, and its model may already have been billed. Seven of the nine metered "+
			"cards read this 502 and tell the reader nothing was asked of the model", body["error"])
	}
	if body["code"] != "UPSTREAM_TIMEOUT" {
		t.Fatalf("code = %q, want UPSTREAM_TIMEOUT — a status alone cannot carry this, which is "+
			"the lesson docs_ai_test.go records for the two 503s one layer down", body["code"])
	}
}

func TestMeteredRoute_AbsentUpstreamIsStillCalledUnreachable(t *testing.T) {
	// The other direction, and it is the reason this is a discrimination rather than a rename:
	// nothing listening really is unreachable, and it must not acquire a timeout code.
	dead := slowProduct(t, 0)
	dead.Close() // nothing is listening on that port any more
	a, sess := productApp(t, &captureUpstream{srv: dead}, &captureUpstream{srv: dead})
	req := httptest.NewRequest(http.MethodPost, "/api/docs/ai/ask", strings.NewReader(`{"question":"q"}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(sess)
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", rec.Code)
	}
	var body map[string]string
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if !strings.Contains(body["error"], "unreachable") {
		t.Fatalf("error = %q, want it to still say unreachable", body["error"])
	}
	if _, ok := body["code"]; ok {
		t.Fatalf("a connection refused acquired code %q; the two causes must stay separable", body["code"])
	}
}
