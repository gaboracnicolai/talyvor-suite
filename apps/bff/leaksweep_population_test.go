package main

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// leaksweep_population_test.go — THE POPULATION A LEAK SWEEP RUNS OVER MUST COME FROM THE
// ROUTER, NOT FROM A LIST WRITTEN BESIDE IT.
//
// ── THE DEFECT THIS FILE EXISTS FOR ──────────────────────────────────────────
//
// secretleak_test.go fixed the NEEDLES — what a sweep searches for. It did not touch the
// POPULATION — which responses it searches. Three sweeps in three files each carry their
// own hand-written endpoint list:
//
//	bff_test.go#TestKeyNeverReachesResponse         14 entries, and its comment claims the
//	                                                guarantee holds "on any /api endpoint"
//	products_test.go#TestGatewaySecretsNeverReachResponse   20 entries + /auth/me
//	auth_test.go#TestKeyNeverReachesResponseOIDC     8 entries, a subset + /auth/me
//
// MEASURED at 5943e92 by driving GET against every pattern mountedPatterns() finds, rather
// than by reading the three lists: 40 mounted patterns, 30 of them /api/* that answer GET
// with something other than 405. The three lists cover 21 of those 30. NINE ARE SWEPT BY
// NOTHING: the six /api/admin/* routes, /api/distill, /api/lens/convert-quote and
// /api/version.
//
// ⚠ AND THE BLINDNESS IS LIVE, NOT LATENT — POSITIVE-CONTROLLED, VERDICTS READ FROM
// `--- FAIL:` LINES OVER THE WHOLE PACKAGE (~/talyvor-queue/w11-leaksweep-controls-8d51.py):
//
//	S1  the provisioning secret echoed into GET /api/lxc/topup-options' BODY (a SWEPT route)
//	    → CAUGHT, by TestKeyNeverReachesResponse. The sweep is armed and works.
//	U1  THE SAME SECRET concatenated into GET /api/lens/convert-quote's BODY — a 200 on a
//	    requireTenant MONEY route → NOT CAUGHT. 350 tests ran; none failed.
//	U2  the same secret written into a GET /api/version response HEADER → NOT CAUGHT.
//
// ⚠ THE QUEUE'S NOTE ON THIS WAS RIGHT IN KIND AND WRONG IN DETAIL, so the correction is
// recorded rather than quietly dropped: it named `/api/distill` AND `/api/pooling` as the
// two absentees. /api/pooling ANSWERS 405 TO GET — it is a POST-only write route, swept by
// the Origin family in sameorigin_test.go, and a GET sweep has no response of its own to
// search. The absentee count was 2 read off two lists; driven against the router it is 9.
//
// ── WHY THIS IS NOT "ADD NINE LINES TO THE LIST" ─────────────────────────────
//
// Adding them fixes today's nine and leaves the shape: the tenth route mounted tomorrow is
// unswept in exactly the same silent way, and all three lists still read as coverage. So
// this test takes its population FROM mountedPatterns() and sweeps whatever the router
// actually serves. There is no list here to go stale — a new GET route is swept the moment
// it is mounted, and that is asserted below rather than asserted in this comment.
//
// The three existing sweeps are left where they are: each asserts something extra about its
// own fixture (that the upstream RECEIVED the credential, that the gateway proofs went out)
// which this population check does not, and deleting them would trade a real assertion for
// tidiness.

// TestLeakSweep_CoversEveryMountedGETRoute drives GET at every mounted /api pattern, in three
// fixtures, and asserts no secret the app holds reaches the body or any header of any of them.
//
// ⚠ THREE FIXTURES BECAUSE ONE CANNOT SERVE THE POPULATION. newTestApp holds only the
// provisioning secret and answers 503 on every product route (Track/Docs unconfigured);
// productApp configures both, so those routes return a real upstream payload AND the app holds
// two more needles; operatorApp is the only one whose session passes requireOperator.
//
// ⚠ AND THE OPERATOR FIXTURE IS HERE BECAUSE THIS TEST WAS VACUOUS ON SIX ROUTES WITHOUT IT —
// FOUND BY A CONTROL, NOT BY READING. With two fixtures the six /api/admin/* routes were
// "swept": the sweep drove them and searched the bytes that came back. But requireOperator
// refuses at 401/403 BEFORE any handler runs, so those bytes were the refusal, and a control
// that leaked the provisioning secret out of `adminNotWired`'s own body came back NOT CAUGHT
// while this test stayed green. Driving a route is not reaching it.
func TestLeakSweep_CoversEveryMountedGETRoute(t *testing.T) {
	base := newTestApp(t, nil)
	track := newCaptureUpstream(t, `[{"id":"ws-t1"}]`)
	docs := newCaptureUpstream(t, `[{"id":"sp-1"}]`)
	prod, sess := productApp(t, track, docs)
	op, opSess, _ := operatorApp(t, []string{"sub-operator"})

	fixtures := []struct {
		name   string
		a      *app
		cookie *http.Cookie
	}{
		{"lens-only", base, nil},
		{"product", prod, sess},
		{"operator", op, opSess},
	}

	patterns := mountedPatterns(t)
	// A floor on the POPULATION as a literal. If the pattern scan ever reads nothing — the mux
	// variable renamed, the route table moved out of lens.go — every assertion below is
	// vacuously satisfied and this test would pass having swept no route at all.
	if len(patterns) < 20 {
		t.Fatalf("mounted patterns found = %d, want at least 20 — the route-table scan read almost nothing", len(patterns))
	}

	swept := 0
	var methodOnly, refusedEverywhere []string
	for _, pat := range patterns {
		if !strings.HasPrefix(pat, "/api/") || strings.HasSuffix(pat, "/") {
			continue // the /api/ catch-all is not a route with a response of its own
		}
		path := regexp.MustCompile(`\{[^}]*\}`).ReplaceAllString(pat, "x1")

		answered, reached := false, false
		for _, f := range fixtures {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			if f.cookie != nil {
				req.AddCookie(f.cookie)
			}
			rec := httptest.NewRecorder()
			f.a.ServeHTTP(rec, req)

			// ⚠ ONLY 405 IS A SKIP, and deliberately not 404. A 405 means this verb is not served,
			// so there is no GET response to search. A 404 IS a response the browser receives —
			// skipping it would let a route drop out of the sweep by answering not-found for the
			// probe's id, which is the silent-shrink this file exists to prevent.
			if rec.Code == http.StatusMethodNotAllowed {
				continue
			}
			answered = true
			// REACHED means the request got past the auth gates to the route's own handler. A 401
			// or a 403 is a response worth searching — it is still swept below — but it is the
			// GATE's body, not the route's, so it cannot vouch for the route.
			if rec.Code != http.StatusUnauthorized && rec.Code != http.StatusForbidden {
				reached = true
			}
			assertNoSecretLeak(t, f.name+" GET "+pat, f.a.cfg, rec.Body.String(), rec.Header())
		}
		switch {
		case !answered:
			methodOnly = append(methodOnly, pat)
		case !reached:
			refusedEverywhere = append(refusedEverywhere, pat)
		default:
			swept++
		}
	}

	// ⚠ THE ASSERTION THAT MAKES "SWEPT" MEAN SOMETHING. Without it a route whose gate refuses
	// every fixture counts as covered while its handler has never produced a byte this test has
	// seen — measured, not supposed: that was true of all six /api/admin/* routes here until the
	// operator fixture was added, and a leak planted in their shared handler went uncaught.
	if len(refusedEverywhere) > 0 {
		sort.Strings(refusedEverywhere)
		t.Fatalf("route(s) whose handler no fixture can reach — every response searched was an "+
			"auth refusal, so the sweep vouches for the gate and not for the route. Give this test "+
			"a fixture whose session passes that gate:\n  %s", strings.Join(refusedEverywhere, "\n  "))
	}

	// The sweep must find responses to search. Compared against a literal, never against the
	// length of anything this test builds — a floor measured from the thing it protects passes
	// at zero.
	if swept < 25 {
		t.Fatalf("GET-answering /api routes swept = %d, want at least 25 — the probe found almost "+
			"no responses, so the assertions above checked almost nothing", swept)
	}

	// ⚠ THE UPPER BOUND IS THE OTHER HALF, and without it the floor is escapable. A route that
	// stops answering GET leaves the swept population SILENTLY: the floor still passes while
	// coverage shrinks. Four are POST-only today (/api/keys/{id}, /api/lens/convert,
	// /api/lxc/checkout, /api/pooling — all write routes the Origin sweep covers). A fifth is a
	// change in what this guard can see, and it has to be looked at.
	if len(methodOnly) > 4 {
		sort.Strings(methodOnly)
		t.Fatalf("routes answering 405 to GET = %d, want at most 4 — a route left the leak sweep's "+
			"reach; confirm it is genuinely write-only and raise this bound with the reason:\n  %s",
			len(methodOnly), strings.Join(methodOnly, "\n  "))
	}
}
