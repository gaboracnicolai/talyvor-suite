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
// ⚠⚠ AND "SWEPT BY THE ORIGIN FAMILY" WAS THE NEXT HOLE, BECAUSE IT ANSWERS A DIFFERENT
// QUESTION. sameorigin_test.go asks whether a write REFUSES a foreign Origin. It never looks
// at what a write ANSWERS. So every sentence above that excused a route for being write-only
// was excusing it from a sweep it was never in — see TestLeakSweep_CoversEveryMountedWriteRoute
// below, which is the other half and was measured to be missing at a1bf848.
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
	// coverage shrinks. SIX are write-only today (/api/keys/{id}, /api/lens/convert,
	// /api/lxc/checkout, /api/pooling, /api/docs/ai/ask, /api/docs/pages/{pageID}/summarize). A
	// seventh is a change in what this guard can see, and it has to be looked at. Their WRITE responses are searched by the write sweep
	// below — for the year this bound existed the excuse was "the Origin sweep covers them", and
	// it did not.
	//
	// ⚠ THE FIFTH, /api/docs/ai/ask, WAS LOOKED AT RATHER THAN WAVED THROUGH. It is POST-only
	// because an ask has a body and no idempotent reading — GET would have to carry the question
	// in a query string, where it would land in every access log. It is NOT outside the sweep:
	// the write half below derives its population from mountedPatterns(), so it drives POST at
	// this route in all three fixtures and searches what comes back, including the Docs upstream
	// bytes the productApp fixture streams.
	//
	// ⚠ THE SIXTH, /api/docs/pages/{pageID}/summarize, WAS LOOKED AT ON THE SAME TERMS AND FOR A
	// STRONGER REASON THAN ASK'S. It is POST-only because the thing it sends is a whole page of
	// text: as a GET that body would have to be a query string, which means a customer's document
	// in every access log and proxy buffer along the way — the leak this file exists to hunt,
	// created by the shape of the route rather than by anything in a response. It is METERED, so
	// it is also not idempotent in the way a GET promises: each call is a Lens completion the
	// workspace pays for and Docs attributes to that page. Like ask, it is inside the write half
	// below, which drives POST at every mounted pattern in all three fixtures.
	// ⚠ THE SEVENTH, /api/docs/pages/{pageID}/translate, WAS LOOKED AT ON THE SAME TERMS AS
	// SUMMARISE'S AND FOR THE SAME REASON. It sends a whole page of text, so as a GET that body
	// would be a query string — a customer's document in every access log and proxy buffer on the
	// way, which is the leak this file hunts, created by the shape of the route rather than by
	// anything in a response. It is METERED too: each call is a Lens completion the workspace pays
	// for and Docs attributes to the named page, so it is not idempotent in the way a GET promises.
	// Its POST response is searched by the write half below.
	//
	// ⚠ THE EIGHTH, /api/docs/spaces/{spaceID}/pages/{pageID}/changelog/generate, WAS LOOKED AT
	// AND ITS REASON IS THE ONE THE SEVEN ABOVE DO NOT HAVE. The other seven are POST-only
	// because of what they CARRY (a question, a document) or what they SPEND. This one is
	// POST-only because of what it LEAVES BEHIND: measured against talyvor-docs' own route on
	// real Postgres, every call INSERTs a changelog_entries row, and a later `…/publish` puts
	// that row into the workspace's public RSS feed. A GET that writes a durable, publishable row
	// is the one thing a GET may never be — it would be retried by any proxy, prefetched by any
	// browser, and re-run by any crawler, each time leaving another release note behind. It also
	// carries a list of issue ids, which as a query string would put a workspace's unreleased
	// issue keys in every access log. Its POST response is searched by the write half below.
	//
	// ⚠ THE NINTH, /api/track/issues/{id}/find-duplicates, IS POST-ONLY BECAUSE UPSTREAM MOUNTS
	// IT THAT WAY AND BECAUSE IT SPENDS. talyvor-track mounts `POST
	// /v1/workspaces/{wsID}/issues/{id}/find-duplicates` (internal/ai/handler.go Mount), so a GET
	// here would have nowhere honest to go. It carries NOTHING — no body, no query, measured: the
	// upstream handler decodes neither — so unlike ask/summarise/translate there is no payload
	// that a query string would leak. What makes a GET wrong is the METER: each press is a Lens
	// completion the workspace pays for and Track attributes to this issue (measured: the request
	// reaching Lens carries `X-Talyvor-Feature: <the issue's identifier>`), and a GET that spends
	// is retried by proxies, prefetched by browsers and re-run by crawlers, each time billing
	// someone. Its POST response is searched by the write half below, in all three fixtures.
	if len(methodOnly) > 9 {
		sort.Strings(methodOnly)
		t.Fatalf("routes answering 405 to GET = %d, want at most 9 — a route left the leak sweep's "+
			"reach; confirm it is genuinely write-only and raise this bound with the reason:\n  %s",
			len(methodOnly), strings.Join(methodOnly, "\n  "))
	}
}

// ── THE WRITE HALF ───────────────────────────────────────────────────────────
//
// TestLeakSweep_CoversEveryMountedWriteRoute is the same population argument for the verbs a
// GET sweep cannot see. Every leak sweep in this package searches a GET response; four of them
// skip a route the moment it answers 405 to GET, and the excuse written beside three of those
// skips was that the Origin family covers write routes. THE ORIGIN FAMILY ASKS A DIFFERENT
// QUESTION — whether a write refuses a foreign Origin — and never reads what a write answers.
//
// ⚠ MEASURED AT a1bf848, not read off the lists: every unsafe method driven at every mounted
// pattern through a.ServeHTTP in the three fixtures below reaches a handler in 37 method×route
// shapes. Exactly ONE of those 37 is searched by assertNoSecretLeak today (POST /api/lxc/checkout,
// from billing_test.go). The other 36 are searched by nothing.
//
// ⚠ AND IT IS LIVE, NOT LATENT — positive-controlled, verdicts read from `--- FAIL:` lines over
// the whole package, never from an exit code (~/talyvor-queue/w11-writeleak-controls-b3d7.py):
//
//	S1  the provisioning secret in POST /api/lxc/checkout's response HEADER (the ONE swept
//	    write) → CAUGHT, by TestCheckoutForwardsToPinnedWorkspaceWithKeyAndReturnsTheURL. The
//	    armed control: without it every verdict below is unreadable.
//	U1  THE SAME SECRET in POST /api/keys' response header — the mint, the one response in this
//	    BFF that legitimately carries a credential → NOT CAUGHT. 350 tests ran; none failed.
//	U2  the same secret in POST /api/pooling's BODY → NOT CAUGHT (so it is not header-blindness).
//	U3  a GATEWAY secret on DELETE /api/keys/{id} → NOT CAUGHT (not one needle, not one verb).
//	U4  the same secret in POST /api/distill's BODY → NOT CAUGHT, and GET on that same path IS
//	    swept by the test above. The blindness is the VERB, not the route.
//
// ⚠ NO LEAK EXISTS TODAY. All 37 shapes were measured clean before this was written; this
// closes a blindness, it does not patch a disclosure.
//
// ⚠ THREE FIXTURES, AND THE THIRD IS NOT DECORATION. productApp is the only one whose session
// carries a Track workspace, so it is the only one where the Track and Docs writes get PAST the
// bootstrap and stream real upstream bytes back — in sameOriginApp those five routes answer 503
// before any proxy copy happens. A sweep that only ever saw 503 envelopes would be searching the
// BFF's own error strings for a secret that could only arrive in a body it never produced, which
// is why the 2xx floor below is a separate assertion from the reached floor.
func TestLeakSweep_CoversEveryMountedWriteRoute(t *testing.T) {
	so, soSid := sameOriginApp(t)
	op, opSess, _ := operatorApp(t, []string{"sub-operator"})
	prod, prodSess := productApp(t, newCaptureUpstream(t, `[{"id":"ws-t1"}]`), newCaptureUpstream(t, `[{"id":"sp-1"}]`))

	fixtures := []struct {
		name   string
		a      *app
		cookie *http.Cookie
		// origin is the Origin header this fixture's writes must carry to get past the gate.
		// EMPTY IS NOT "unset by accident": productApp has no publicBaseURL, and the single
		// Origin rule compares Origin against it, so sending none is what that app accepts.
		origin string
	}{
		{"same-origin", so, &http.Cookie{Name: sessionCookieName, Value: soSid}, testPublicOrigin},
		{"product", prod, prodSess, ""},
		{"operator", op, opSess, opOrigin},
	}

	// One body naming every field the swept handlers read. A handler that decodes none of them
	// answers 400 and is still swept — the response is the point, not the happy path.
	//
	// ⚠ `lxc_amount_ulxc`, NOT `lxc`. everyMutatingRoute() sends {"lxc":100000} to
	// /api/lens/convert and handleConvert reads lxc_amount_ulxc, so that row has always decoded
	// to zero and answered "below the minimum conversion". Harmless there — that test only asks
	// whether the Origin gate refused — but with the wrong name this sweep never reaches the
	// route's upstream copy, which is the only place a proxy leak can be.
	const probeBody = `{"title":"t","name":"n","body":"b","lxc_amount_ulxc":100000,` +
		`"usd_cents":5000,"cache_poolable":true,"distill_policy":"disabled",` +
		`"scopes":["proxy"],"status":"todo"}`

	patterns := mountedPatterns(t)
	// The same literal population floor as the GET sweep, for the same reason: if the route-table
	// scan ever reads nothing, every assertion below is vacuously satisfied.
	if len(patterns) < 20 {
		t.Fatalf("mounted patterns found = %d, want at least 20 — the route-table scan read almost nothing", len(patterns))
	}

	reached, succeeded := map[string]bool{}, map[string]bool{}
	accepted := map[string]bool{}
	for _, pat := range patterns {
		if strings.HasSuffix(pat, "/") {
			continue // the /api/ catch-all and the SPA root are not routes with verbs of their own
		}
		path := regexp.MustCompile(`\{[^}]*\}`).ReplaceAllString(pat, "x1")
		for _, m := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
			for _, f := range fixtures {
				req := httptest.NewRequest(m, path, strings.NewReader(probeBody))
				req.Header.Set("Content-Type", "application/json")
				if f.origin != "" {
					req.Header.Set("Origin", f.origin)
				}
				req.AddCookie(f.cookie)
				rec := httptest.NewRecorder()
				f.a.ServeHTTP(rec, req)

				// 405 = this verb is not served here; 404 = nothing is mounted at this path for
				// this verb. Neither is a response this route produces, so there is nothing of its
				// own to search. EVERY OTHER CODE IS SWEPT, including 401/403 — a refusal is still
				// bytes the browser receives.
				if rec.Code == http.StatusMethodNotAllowed || rec.Code == http.StatusNotFound {
					continue
				}
				shape := m + " " + pat
				accepted[shape] = true
				if rec.Code != http.StatusUnauthorized && rec.Code != http.StatusForbidden {
					reached[shape] = true
				}
				if rec.Code/100 == 2 {
					succeeded[shape] = true
				}
				assertNoSecretLeak(t, f.name+" "+m+" "+pat, f.a.cfg, rec.Body.String(), rec.Header())
			}
		}
	}

	// ⚠ WHAT MAKES "SWEPT" MEAN SOMETHING, exactly as in the GET sweep above. A write whose gate
	// refuses every fixture has had its handler produce no byte this test has ever seen, and
	// counting that as coverage is how the six /api/admin/* routes were "swept" by the GET sweep
	// while a leak planted in their shared handler went uncaught.
	var refusedEverywhere []string
	for shape := range accepted {
		if !reached[shape] {
			refusedEverywhere = append(refusedEverywhere, shape)
		}
	}
	if len(refusedEverywhere) > 0 {
		sort.Strings(refusedEverywhere)
		t.Fatalf("write(s) whose handler no fixture can reach — every response searched was an auth "+
			"refusal, so this sweep vouches for the gate and not for the route. Give it a fixture "+
			"whose session passes that gate:\n  %s", strings.Join(refusedEverywhere, "\n  "))
	}

	// The reached floor, as a literal — never len() of anything this test builds, which passes at
	// zero. 37 shapes were reached when this was written.
	if len(reached) < 30 {
		t.Fatalf("write shapes reaching a handler = %d, want at least 30 — the probe found almost no "+
			"write responses, so the assertions above checked almost nothing", len(reached))
	}

	// ⚠ THE 2xx FLOOR IS A SEPARATE ASSERTION AND IT IS THE LOAD-BEARING ONE. Every route in this
	// BFF answers its errors from writeJSON with a literal string; the only responses that can
	// carry a credential are the ones that COPY UPSTREAM BYTES, and those exist only on success.
	// A fixture change that quietly turns the product routes into 503s would leave the reached
	// floor above untouched while this sweep degraded into searching the BFF's own error text —
	// green, and blind to the entire class it exists for. 12 shapes answered 2xx when this was
	// written; the bound is set below that so an upstream-shape change is not a false red, and a
	// collapse is.
	if len(succeeded) < 10 {
		var got []string
		for s := range succeeded {
			got = append(got, s)
		}
		sort.Strings(got)
		t.Fatalf("write shapes answering 2xx = %d, want at least 10 — this sweep is now searching "+
			"almost nothing but error envelopes, and an upstream credential can only arrive in a "+
			"body a handler actually copied:\n  %s", len(succeeded), strings.Join(got, "\n  "))
	}
}
