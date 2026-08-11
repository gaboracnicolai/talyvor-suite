package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// distill_test.go — the status contract of /api/distill, and the one rule it broke.
//
// ⚠ WHY THIS FILE EXISTS AT ALL. distill.go was the only route file in this BFF with no test
// of its own; `distill` appeared in the test tree exactly four times, all of them inside
// sameorigin_test.go's Origin sweep. Its Origin discipline was pinned and NOTHING ELSE was.
//
// ⚠ THE DEFECT THESE PIN. Every workspace-scoped read in this BFF goes through `forward`,
// whose own comment states the rule: "Upstream status is preserved so a real not-found or
// error surfaces honestly rather than masked." /api/distill does not use forward — it
// composes two upstream reads — and it answered 502 for EVERY upstream refusal, 401
// included. MEASURED on this handler before the fix, with the session's workspace token
// refused upstream:
//
//	GET /api/distill      -> 502   GET /api/spend/month   -> 401
//	POST /api/distill     -> 502   GET /api/lxc/balance   -> 401
//	                               GET /api/keys          -> 401
//	                               GET /api/usage?days=7  -> 401
//
// A dead LENS token with a LIVE BFF session is not an exotic state: productState.ts records
// that the workspace token is minted for 8 hours and the BFF session lasts 12, so hours
// 8→12 of every session sit in it, and a Lens restart puts every live session there at once.
// In that state the app's three dead-credential mechanisms all key on the status 401 —
// isSessionExpired() raises the one bar, App.tsx's "a 401 is a verdict, not a flake" rule
// suppresses the retry, and QueryCache.onError re-probes the gate. A 502 answers none of
// them, so the document-conversion panel was the ONE surface that could not report the
// cause, and the sentence it renders instead says "The buttons below still work" — which
// the write path's own 502 made false at the same moment.

// upstreamRefusing builds an app whose Lens answers `status` to everything except
// provisioning. `seen` collects the upstream paths, so a test can say which read failed.
func upstreamRefusing(t *testing.T, status int, seen *[]string) *app {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		if seen != nil {
			*seen = append(*seen, r.Method+" "+r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, `{"error":"token is not valid"}`)
	}))
	t.Cleanup(srv.Close)
	return newApp(config{
		addr:            "127.0.0.1:0",
		lensBaseURL:     srv.URL,
		provisionSecret: testProvisionSecret,
		webDist:         t.TempDir(),
		authMode:        authModeDisabled,
	}, nil)
}

func doJSON(a *app, method, path, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	var r io.Reader
	if body != "" {
		r = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, r)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	a.ServeHTTP(rec, req)
	return rec
}

// A1 — the read. A refused credential must reach the browser as a refused credential.
func TestDistillReadForwardsUpstreamRefusal(t *testing.T) {
	for _, up := range []int{http.StatusUnauthorized, http.StatusForbidden} {
		a := upstreamRefusing(t, up, nil)
		rec := doJSON(a, http.MethodGet, "/api/distill", "")
		if rec.Code != up {
			t.Errorf("upstream %d → GET /api/distill = %d, want %d — a laundered status is a state "+
				"the app's dead-credential mechanisms cannot see (body %s)", up, rec.Code, up, rec.Body.String())
		}
	}
}

// A2 — the write. The screen's failure copy branches on isSessionExpired too, so a laundered
// status there puts "You can try again" under a bar that already said signing in again is the fix.
func TestDistillWriteForwardsUpstreamRefusal(t *testing.T) {
	for _, up := range []int{http.StatusUnauthorized, http.StatusForbidden} {
		a := upstreamRefusing(t, up, nil)
		rec := doJSON(a, http.MethodPost, "/api/distill", `{"distill_policy":"disabled"}`)
		if rec.Code != up {
			t.Errorf("upstream %d → POST /api/distill = %d, want %d (body %s)",
				up, rec.Code, up, rec.Body.String())
		}
	}
}

// A3 — the must-stay-green companion, and the boundary of the new rule. An UNREACHABLE Lens is
// not an upstream status at all and must stay a 502: this is the case that separates "Lens said
// no" from "Lens said nothing".
func TestDistillUnreachableLensStays502(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		serveFakeProvision(w, r)
	}))
	base := srv.URL
	a := newApp(config{
		addr:            "127.0.0.1:0",
		lensBaseURL:     base,
		provisionSecret: testProvisionSecret,
		webDist:         t.TempDir(),
		authMode:        authModeDisabled,
	}, nil)
	srv.Close() // provisioning already happened at first request; now nothing answers

	if rec := doJSON(a, http.MethodGet, "/api/distill", ""); rec.Code != http.StatusBadGateway {
		t.Errorf("unreachable Lens → GET /api/distill = %d, want 502 (body %s)", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodPost, "/api/distill", `{"distill_policy":"disabled"}`); rec.Code != http.StatusBadGateway {
		t.Errorf("unreachable Lens → POST /api/distill = %d, want 502 (body %s)", rec.Code, rec.Body.String())
	}
}

// A3b — the OTHER end of the same boundary, and the reason `upstreamStatusOr` forwards only
// 4xx and 5xx. A 204 from Lens is a protocol surprise, not a refusal; re-emitting it would send
// the browser a status this handler cannot honour, because it answers with a JSON body and a 204
// may not carry one. It is a fault here, so it is a 502.
func TestDistillNonRefusalStatusIsNotForwarded(t *testing.T) {
	for _, up := range []int{http.StatusNoContent, http.StatusFound} {
		a := upstreamRefusing(t, up, nil)
		if rec := doJSON(a, http.MethodGet, "/api/distill", ""); rec.Code != http.StatusBadGateway {
			t.Errorf("upstream %d → GET /api/distill = %d, want 502 — only a refusal is forwarded", up, rec.Code)
		}
	}
}

// A4 — the other must-stay-green companion, and the one the fix could most easily break.
// readDistillState's counts are BEST-EFFORT by design: a Lens too old to serve /distill/usage,
// or one that refuses it, must still leave the SETTING readable. The new rule applies to the
// workspace read and must not be swept over the usage read.
func TestDistillUsageRefusalDoesNotHideTheSetting(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "/distill/usage") {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = io.WriteString(w, `{"error":"nope"}`)
			return
		}
		_, _ = io.WriteString(w, `{"distill_policy":"always"}`)
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{
		addr:            "127.0.0.1:0",
		lensBaseURL:     srv.URL,
		provisionSecret: testProvisionSecret,
		webDist:         t.TempDir(),
		authMode:        authModeDisabled,
	}, nil)

	rec := doJSON(a, http.MethodGet, "/api/distill", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("usage refused → GET /api/distill = %d, want 200 — the counts are best-effort, the setting is owed (body %s)",
			rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"distill_policy":"always"`) {
		t.Errorf("the setting did not survive a refused usage read: %s", rec.Body.String())
	}
}

// A5 — the rule, not the instance. Every route below reaches Lens with the SESSION's
// workspace token; when that token is refused, the browser must be told it was refused.
// A route that translates instead has to be listed here WITH its reason, so opting out is a
// visible edit rather than a silent one.
//
// ⚠ THE EXCEPTIONS ARE MEASURED, not assumed — each one's answer under a refused token is
// recorded beside it:
//   - /api/lxc/topup-options answers 200 {billing_enabled:true}. probeBillingEnabled is
//     documented as reading ONLY a 404 as "off" and being "deliberately optimistic" about
//     everything else, and the amounts it serves are BFF-held. Not a workspace read.
//   - /api/pooling answers 502. SAME LAUNDERING AS DISTILL'S and NOT fixed on this diff:
//     its screen (SharingChoice) reads the recorded value from /auth/me rather than from
//     this route, and its write's catch has no isSessionExpired branch at all — it says
//     "You can try again" for every failure — so the laundering has no consequence a test
//     can see today. Listed here so the next session finds it stated rather than hidden.
func TestWorkspaceRoutesForwardARefusedCredential(t *testing.T) {
	type route struct{ method, path, body string }
	mustForward := []route{
		{http.MethodGet, "/api/distill", ""},
		{http.MethodPost, "/api/distill", `{"distill_policy":"disabled"}`},
		{http.MethodGet, "/api/spend/month", ""},
		{http.MethodGet, "/api/lxc/balance", ""},
		{http.MethodGet, "/api/tokens/balance", ""},
		{http.MethodGet, "/api/keys", ""},
		{http.MethodGet, "/api/usage?days=7", ""},
		{http.MethodGet, "/api/lxc/history?limit=5&offset=0", ""},
		{http.MethodGet, "/api/tokens/history?limit=5&offset=0", ""},
	}
	translates := map[string]string{
		"GET /api/lxc/topup-options": "probeBillingEnabled reads only a 404 as off, deliberately optimistic",
		"POST /api/pooling":          "same laundering, no observable consequence on its screen — see the header",
	}

	const up = http.StatusUnauthorized
	for _, r := range mustForward {
		a := upstreamRefusing(t, up, nil)
		rec := doJSON(a, r.method, r.path, r.body)
		if rec.Code != up {
			t.Errorf("%s %s = %d under a refused workspace token, want %d — either forward the status "+
				"or list the route in `translates` with the reason (body %s)",
				r.method, r.path, rec.Code, up, rec.Body.String())
		}
	}
	// The listed exceptions are asserted to STILL translate: if one starts forwarding, the
	// entry is stale and saying so is the point of writing it down.
	for _, r := range []route{
		{http.MethodGet, "/api/lxc/topup-options", ""},
		{http.MethodPost, "/api/pooling", `{"cache_poolable":false}`},
	} {
		key := r.method + " " + r.path
		if _, ok := translates[key]; !ok {
			t.Fatalf("%s is asserted as an exception but is not listed", key)
		}
		a := upstreamRefusing(t, up, nil)
		if rec := doJSON(a, r.method, r.path, r.body); rec.Code == up {
			t.Errorf("%s now forwards %d — the exception entry (%s) is stale, delete it",
				key, up, translates[key])
		}
	}
}
