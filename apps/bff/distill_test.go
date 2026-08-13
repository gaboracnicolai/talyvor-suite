package main

import (
	"encoding/json"
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
//
// ⚠ THE FIRST VERSION OF THIS TEST PASSED FOR THE WRONG REASON AND ONLY A CONTROL SAID SO. It
// closed the whole stub after building the app, so PROVISIONING failed too — and in disabled mode
// requireTenant writes its own 502 ("lens upstream unreachable") without ever calling
// handleDistill. The 502 it asserted was a different 502, and the control that makes an
// unreachable Lens answer 401 inside lensGet was NOT CAUGHT: the assertion was earned by nothing.
// So provisioning must SUCCEED here, and only the reads after it may fail — which is why the stub
// hijacks and drops the connection instead of the server going away.
func TestDistillUnreachableLensStays502(t *testing.T) {
	var provisioned bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			provisioned = true
			serveFakeProvision(w, r)
			return
		}
		// Drop the connection with no response: the client sees a transport failure, which is
		// what "Lens is unreachable" is, rather than any status at all.
		if hj, ok := w.(http.Hijacker); ok {
			conn, _, err := hj.Hijack()
			if err == nil {
				_ = conn.Close()
				return
			}
		}
		t.Fatal("stub could not hijack — the transport-failure case would silently become a status")
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{
		addr:            "127.0.0.1:0",
		lensBaseURL:     srv.URL,
		provisionSecret: testProvisionSecret,
		webDist:         t.TempDir(),
		authMode:        authModeDisabled,
	}, nil)

	if rec := doJSON(a, http.MethodGet, "/api/distill", ""); rec.Code != http.StatusBadGateway {
		t.Errorf("unreachable Lens → GET /api/distill = %d, want 502 (body %s)", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodPost, "/api/distill", `{"distill_policy":"disabled"}`); rec.Code != http.StatusBadGateway {
		t.Errorf("unreachable Lens → POST /api/distill = %d, want 502 (body %s)", rec.Code, rec.Body.String())
	}
	// The premise, asserted rather than assumed: if provisioning had failed, requireTenant would
	// have written its own 502 and the assertions above would be about a handler never reached.
	if !provisioned {
		t.Fatal("the tenant was never provisioned, so handleDistill was never reached")
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

// ─── the vocabulary, and the direction it was never enforced in ─────────────────────────
//
// ⚠ MEASURED ON THE RENDERED PANEL, not read. DistillChoice computes `policy === 'always'` and
// renders "Document conversion is currently {on|off} for this workspace". Feeding it each value
// the BFF could hand it:
//
//	"always"    -> "…currently on…"
//	"disabled"  -> "…currently off…"     ← the only correct off
//	"opt_in"    -> "…currently off…"     ← a documented reading: not on BY DEFAULT
//	""          -> "…currently off…"
//	"weird"     -> "…currently off…"
//	null        -> "…currently off…"
//	(absent)    -> "…could not be read, so it is not shown…"
//
// The screen ALREADY HAS a third state, and the ONLY input that reaches it is the field being
// ABSENT. A present value the BFF cannot classify becomes a POSITIVE CLAIM about what is
// happening to a customer's documents.
//
// The route allow-listed the value going UP with a comment that says exactly why — "an unknown
// value forwarded from a browser is client input reaching a policy write — the shape this
// codebase refuses elsewhere" — and passed anything coming DOWN. That asymmetry is the defect;
// the vocabulary is one declaration now and both directions read it.
//
// ⚠ NOT A PRODUCT DECISION, and the boundary matters: 'opt_in' still renders "off" exactly as
// its comment argues, because it is a RECOGNISED value with a written reading. What changes is
// only the UNRECOGNISED case, which is routed into copy the screen already has. If Lens ever
// adds a fourth policy this route goes to "could not be read" rather than silently asserting
// "off" — the safe direction, and the whole point.

// B1 — the defect. An unclassifiable policy must not reach the screen as a claim.
func TestDistillReadRefusesAnUnrecognisedPolicy(t *testing.T) {
	for _, body := range []string{
		`{"distill_policy":"weird"}`,
		`{"distill_policy":""}`,
		`{"distill_policy":null}`,
		`{}`,
	} {
		a := servingWorkspace(t, body)
		rec := doJSON(a, http.MethodGet, "/api/distill", "")
		if rec.Code == http.StatusOK {
			t.Errorf("Lens said %s → GET /api/distill = 200 %s — the panel renders that as "+
				"\"currently off\", a positive claim the data does not support", body, rec.Body.String())
		}
	}
}

// B2 — the must-stay-green companion, and the one a careless allow-list breaks. All three real
// Lens states pass through VERBATIM, 'opt_in' included: it is not this route's business to
// collapse a state the screen has a documented reading for.
func TestDistillReadPassesEveryRecognisedPolicy(t *testing.T) {
	for _, p := range []string{"always", "opt_in", "disabled"} {
		a := servingWorkspace(t, `{"distill_policy":"`+p+`"}`)
		rec := doJSON(a, http.MethodGet, "/api/distill", "")
		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"distill_policy":"`+p+`"`) {
			t.Errorf("policy %q → %d %s, want 200 carrying %q", p, rec.Code, rec.Body.String(), p)
		}
	}
}

// B3 — the WRITE half of the same declaration. Measured before this diff: widening the inline
// allow-list to accept "banana" reddened NOTHING in apps/bff, so the guard the route's own
// comment argues for was enforced by whoever happened to be reading.
func TestDistillWriteAllowList(t *testing.T) {
	for _, p := range []string{"always", "opt_in", "disabled"} {
		a := servingWorkspace(t, `{"distill_policy":"`+p+`"}`)
		if rec := doJSON(a, http.MethodPost, "/api/distill", `{"distill_policy":"`+p+`"}`); rec.Code != http.StatusOK {
			t.Errorf("POST %q = %d, want 200 — it is a real Lens state (%s)", p, rec.Code, rec.Body.String())
		}
	}
	for _, p := range []string{"banana", "", "ALWAYS", "always "} {
		a := servingWorkspace(t, `{"distill_policy":"always"}`)
		rec := doJSON(a, http.MethodPost, "/api/distill", `{"distill_policy":"`+p+`"}`)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("POST %q = %d, want 400 — client input must not reach a policy write unchecked (%s)",
				p, rec.Code, rec.Body.String())
		}
	}
}

// servingWorkspace builds an app whose Lens answers `wsBody` for the workspace read, echoes the
// same policy back on the distill PUT, and 404s the best-effort usage route.
func servingWorkspace(t *testing.T, wsBody string) *app {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(r.URL.Path, "/distill/usage"):
			// Served, not refused. A 404 here would couple these cases to the BEST-EFFORT
			// property A4 owns — measured: it made a control aimed at A4 red here too, so the
			// verdict could no longer say which guard saw it.
			_, _ = io.WriteString(w, `{"converted":0,"vision_ocr":0,"days":30}`)
		case r.Method == http.MethodPut:
			raw, _ := io.ReadAll(io.LimitReader(r.Body, 1<<16))
			_, _ = w.Write(raw) // Lens records what it was asked and says so
		default:
			_, _ = io.WriteString(w, wsBody)
		}
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

// ── THE COUNTS LENS DID NOT GIVE US MUST NOT ARRIVE AS COUNTS ────────────────
//
// A4 above pins the half that was owed: a refused /distill/usage must still leave the SETTING
// readable. It says nothing about what the counts look like afterwards, and that is where the
// distinction Lens deliberately paid for was being discarded.
//
// ⚠ MEASURED AT THE UPSTREAM, IN LENS'S OWN WORDS (talyvor-lens a04310a,
// internal/api/distill_usage.go, on ErrNoDistillUsageStore):
//
//	"so the route can answer 503 ('not wired') rather than 200 with a zero — an absent reader
//	 and a workspace that converted nothing must not render identically."
//
// That requirement is written about RENDERING, and this repository holds the only renderer. Lens
// spends a distinct status code on it, this BFF read the 503 and then emitted converted:0,
// vision_ocr:0, days:0 — the exact 200-with-a-zero Lens refused to send. `days:0` is the tell:
// no window was read, and zero days is not a window.
//
// Nothing FALSE reached a reader (Documents.tsx gates both count lines on `> 0`), which is why
// this is a distinction restored rather than a bug fixed. The consequence was that the screen
// could never say "not wired" no matter what it wanted to say, because the fact had already been
// destroyed one layer below it.
//
// ⚠ WHY POINTERS AND NOT `omitempty` ON THE INTS. `omitempty` on an int drops ZERO, so a
// workspace that genuinely converted nothing would go absent too — the same collapse, arriving
// from the other side and harder to see. A *int distinguishes "not read" (nil, absent) from
// "read, and it was zero" (present, 0). The second test below is the control for that, and it is
// the one that fails if anyone simplifies these back to ints.
func TestDistillUsageUnwiredIsNotReportedAsCounts(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "/distill/usage") {
			// Exactly what Lens answers when the usage reader is unconfigured.
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = io.WriteString(w, `{"error":"distill usage: no store configured"}`)
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
		t.Fatalf("GET /api/distill = %d, want 200 — the setting is still owed (body %s)", rec.Code, rec.Body.String())
	}
	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unreadable body %s: %v", rec.Body.String(), err)
	}
	if got["distill_policy"] != "always" {
		t.Errorf("the setting did not survive an unwired usage read: %s", rec.Body.String())
	}
	for _, k := range []string{"converted", "vision_ocr", "days"} {
		if v, ok := got[k]; ok {
			t.Errorf("%q is present as %v after Lens answered 503. Lens spends a distinct status "+
				"on 'not wired' precisely so it does not render as 'converted nothing'; emitting a "+
				"count here is the 200-with-a-zero it refused to send. Leave the key absent.", k, v)
		}
	}
}

// The control for the line above, and the one that reds if the *int fields are ever simplified
// back to plain ints with omitempty: Lens ANSWERED, and the answer was zero. That is a real
// reading of a real window and every key must be present, zeroes included.
func TestDistillUsageGenuineZeroesAreReported(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "/distill/usage") {
			_, _ = io.WriteString(w, `{"converted":0,"vision_ocr":0,"days":30}`)
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
	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unreadable body %s: %v", rec.Body.String(), err)
	}
	for k, want := range map[string]float64{"converted": 0, "vision_ocr": 0, "days": 30} {
		v, ok := got[k]
		if !ok {
			t.Errorf("%q is ABSENT after Lens answered 200 with a real reading. Absent means "+
				"'not read' on this route; a workspace that converted nothing read a real window "+
				"and must say so. This is what `omitempty` on a plain int would do to it.", k)
			continue
		}
		if v != want {
			t.Errorf("%q = %v, want %v", k, v, want)
		}
	}
}
