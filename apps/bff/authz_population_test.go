package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// authz_population_test.go — EVERY MOUNTED ROUTE REFUSES AN ANONYMOUS READ, OR IS CLASSIFIED
// PUBLIC WITH A REASON. The third leg of the completeness family, and the one that was missing.
//
// ── THE DEFECT THIS FILE EXISTS FOR, MEASURED RATHER THAN REASONED ───────────
//
// Two of this package's three sweeps already take their population from the ROUTER:
//
//	sameorigin_test.go#TestEveryMutatingRoute_IsGuardedOrExplicitlyExempt   every mounted pattern,
//	                                                                       every unsafe method
//	leaksweep_population_test.go#TestLeakSweep_CoversEveryMountedGETRoute   every mounted pattern,
//	                                                                       GET, searched for secrets
//
// The claim "these routes sit behind requireSession" had no such instrument. It rested on
// HAND-WRITTEN per-route lists — products_test.go#TestProductRoutesRequireSession names TWO
// endpoints, TestDocsIdRoutesRequireSession four, track_test.go#TestTrackIdRoutesRequireSession
// four — which is exactly the shape mountedPatterns() was introduced to replace, one leg later.
//
// MEASURED at 300fd5b on the real tree, not read
// (`~/talyvor-queue/w11-authzpopulation-controls-9d2b.py`; every mutation anchor-count-asserted
// before the edit, restored in a `finally` and verified back by sha256, `git status` asserted,
// verdicts read from `--- FAIL:` lines over the whole package):
//
//	M1  a NEW route mounted with no require* wrapper, ANY method, answering tenant-shaped JSON
//	    → CAUGHT, by the Origin sweep. Not because it is unauthenticated — because it ACCEPTS a
//	    write. The catch is a side effect of a different question.
//	M1b THE HOLE: the same route made GET-ONLY (405 on anything else) → rc=0, NOTHING FAILED.
//	    An anonymous GET got 200 and a body. The write half is covered, the read half is not.
//	M0  and the trap that made the first control worthless, recorded rather than quietly fixed:
//	    mounting the probe as `a.wsProxyFixed(...)` also passed — because wsProxyFixed requires
//	    the session ITSELF. A control that mutates through a helper carrying the property under
//	    test proves nothing. The mutation has to be a RAW handler, which is what the realistic
//	    rot looks like: a route added straight onto the mux with the wrapper forgotten.
//
// ⚠ IT PASSED ON ITS FIRST RUN, WHICH IS ALSO WHAT A GUARD THAT CANNOT FAIL LOOKS LIKE. So every
// branch of it has its own control, and every verdict is read from the FAILING TEST NAME rather
// than from the package's exit code (same script, 8/8):
//
//	P1  M1b restored → this test REDS naming /api/probe9d2b, and it is the ONLY newly-failing
//	    test in the package, so the catch is this file's and not a neighbour's.
//	P2  /api/members regressed to a hand-rolled proxy with no session check → REDS naming the
//	    route AND naming the TRACK upstream it reached, so the credentialed-call assertion at the
//	    bottom is armed rather than decorative. (Seven other tests red too — a real route losing
//	    its tenancy breaks a lot. That is why P1 exists: the NEW-route case is the one only this
//	    file sees.)
//	P3  the route SCAN blinded — `a.mux.` split from `HandleFunc(` across a line, so the regex
//	    matches none of the 40 mount sites while the router still mounts every one → the
//	    POPULATION FLOOR reds. The Origin sweep's and both leak sweeps' floors red on the same
//	    mutation, which is what a shared premise going dark should look like.
//	P4  /api/context listed in publicReadRoutes while it still refuses → the STALE branch reds.
//	P5  ordinary growth — a new route WITH requireSession → GREEN. It is a rule, not a snapshot.
//	P6  BLINDING — this file deleted, M1b's defect present → rc=0, NOT CAUGHT. Nothing else in
//	    this package was watching.
//	P7  a route mounted in version.go → TestRouteMountsLiveInLensGoAlone reds naming the file.
//
// ── WHAT THIS ASKS, AND WHAT IT DOES NOT ─────────────────────────────────────
//
// It drives GET with NO session cookie at every pattern the router mounts and requires 401 or
// 403 — or an entry in publicReadRoutes with the reason it is public. A 405 is neither: the
// route has no read surface to leak, so it is counted and skipped rather than excused.
//
// The second direction keeps the table honest: a pattern listed public that now REFUSES fails
// as stale, so a reason cannot outlive the thing it described. That is `awaiting.ts`'s rule and
// check-audit-reach.mjs's, in Go.
//
// ⚠ LIMITS, STATED HERE RATHER THAN LEFT TO BE DISCOVERED:
//   - It asks whether a route ANSWERS an anonymous reader, not whether an authenticated reader
//     is scoped to their own tenant. That is tenant_boundary_test.go's question and this is not
//     a substitute for it.
//   - It drives GET only. HEAD/OPTIONS are Go's mux defaults on the same handler; the unsafe
//     methods are the Origin sweep's population.
//   - The refusal is asserted as a STATUS. A route that 401s and streams a body anyway would
//     pass here — assertNoSecretLeak is the sweep that reads bodies.

// publicReadRoutes — patterns that answer an anonymous GET on purpose, each with the reason.
//
// A reason is a claim about the product, checkable by reading the file named in it. The day it
// stops being true, the STALE direction below is what makes someone delete the line.
var publicReadRoutes = map[string]string{
	"/api/version": "the version surface is deliberately unauthenticated so an operator can " +
		"identify a deployment before signing in — version_test.go asserts the 200 and the reason",
	"/auth/me": "the session PROBE. It must answer without a session; that is the whole point — " +
		"`{authenticated:false}` is how the app learns to render the signed-out shell",
	"/auth/login": "the sign-in entry point. Requiring a session to reach it would be a door " +
		"locked from the inside (503 here only because this fixture configures no IdP)",
	"/auth/callback": "the IdP redirect target — the browser arrives here BEFORE any session " +
		"exists (503 here only because this fixture configures no IdP)",
	"/": "the SPA shell. It has to load before anyone can sign in; spa_fallback_test.go owns " +
		"what it serves and spa_cache_test.go how it is cached. 404 in tests — no bundle is built",
}

// TestEveryMountedRoute_RefusesAnonymousRead is the completeness check the "requires a session"
// claim never had: the population is the router's, so a route mounted tomorrow is asked the
// question the moment it exists.
func TestEveryMountedRoute_RefusesAnonymousRead(t *testing.T) {
	// Configured upstreams on purpose: with Track and Docs unconfigured, a product route answers
	// 503 whether or not it checks the session, and a 503 would read as a refusal it is not.
	track := newCaptureUpstream(t, `[{"id":"ws-t1"}]`)
	docs := newCaptureUpstream(t, `[{"id":"sp-1"}]`)
	a, _ := productApp(t, track, docs)

	patterns := mountedPatterns(t)
	// A floor on the POPULATION, as a literal — never len() of something this test also reads.
	// A scan that reads nothing satisfies every assertion below vacuously.
	if len(patterns) < 20 {
		t.Fatalf("mounted patterns found = %d, want at least 20 — the route-table scan read almost "+
			"nothing, so every 'refuses anonymous' answer below is unsafe", len(patterns))
	}

	refused, noReadSurface := 0, 0
	var open, stale []string
	for _, pat := range patterns {
		path := regexp.MustCompile(`\{[^}]*\}`).ReplaceAllString(pat, "x1")
		rec := httptest.NewRecorder()
		// No cookie jar, no Authorization header: this is a stranger with the address.
		a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))

		isRefusal := rec.Code == http.StatusUnauthorized || rec.Code == http.StatusForbidden
		why, classified := publicReadRoutes[pat]

		switch {
		case rec.Code == http.StatusMethodNotAllowed:
			// No read surface at all — nothing to leak, and not a public read either.
			noReadSurface++
			if classified {
				stale = append(stale, pat+" is listed public but answers 405 to GET — it has no read "+
					"surface; delete the entry ("+why+")")
			}
		case isRefusal:
			refused++
			if classified {
				stale = append(stale, pat+" is listed public but REFUSES an anonymous GET ("+
					strconv.Itoa(rec.Code)+"). The reason stopped being true: "+why)
			}
		case classified:
			// Answered a stranger, and says why in the table.
		default:
			body := strings.TrimSpace(rec.Body.String())
			if len(body) > 90 {
				body = body[:90] + "…"
			}
			open = append(open, "GET "+pat+" answered a request with NO session: "+
				strconv.Itoa(rec.Code)+" "+body)
		}
	}

	// The probe must find refusals to check. A literal, never len(patterns) minus the table —
	// a floor measured from the thing it protects passes at zero.
	if refused < 25 {
		t.Fatalf("routes that refused an anonymous GET = %d, want at least 25 — the sweep reached "+
			"almost nothing, so its silence below means nothing", refused)
	}
	if noReadSurface < 1 {
		t.Errorf("routes answering 405 to GET = %d, want at least 1 (/auth/logout is POST-only) — "+
			"the 405 branch is the one that excuses a route from this rule and nothing exercised it",
			noReadSurface)
	}

	if len(open) > 0 {
		sort.Strings(open)
		t.Errorf("route(s) that serve a stranger — wrap the handler in requireSession/requireTenant/"+
			"requireOperator, or add the pattern to publicReadRoutes with the reason it is public:\n  %s",
			strings.Join(open, "\n  "))
	}
	if len(stale) > 0 {
		sort.Strings(stale)
		t.Errorf("publicReadRoutes entr(ies) that stopped being true — delete them:\n  %s",
			strings.Join(stale, "\n  "))
	}

	// The flip side of the status rule, and the one that would survive a handler that refused
	// with the wrong code: no anonymous request may reach a product upstream, where the BFF
	// attaches the gateway secret server-side.
	if track.headers != nil {
		t.Errorf("an anonymous request reached the TRACK upstream at %q — the gateway secret is "+
			"attached server-side, so this is a credentialed call made for a stranger", track.path)
	}
	if docs.headers != nil {
		t.Errorf("an anonymous request reached the DOCS upstream at %q — same argument", docs.path)
	}
}

// TestRouteMountsLiveInLensGoAlone — mountedPatterns() reads lens.go and nothing else, so every
// completeness claim in this package (this file's, the Origin sweep's, the leak sweep's) rests on
// the premise that lens.go is where routes are mounted. That premise is checked here rather than
// assumed: a route mounted from any other file is invisible to all three at once.
func TestRouteMountsLiveInLensGoAlone(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	mount := regexp.MustCompile(`\.mux\.Handle(?:Func)?\(`)
	scanned := 0
	var elsewhere []string
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		scanned++
		src, err := os.ReadFile(filepath.Join(".", name))
		if err != nil {
			t.Fatal(err)
		}
		if n := len(mount.FindAllIndex(src, -1)); n > 0 && name != "lens.go" {
			elsewhere = append(elsewhere, name+" mounts "+strconv.Itoa(n)+" route(s)")
		}
	}
	// A floor on the scan itself: an empty directory listing would agree with "only lens.go
	// mounts routes" for the wrong reason.
	if scanned < 8 {
		t.Fatalf("production .go files scanned = %d, want at least 8 — this scan stopped seeing the "+
			"package, so its verdict is about nothing", scanned)
	}
	if len(elsewhere) > 0 {
		sort.Strings(elsewhere)
		t.Errorf("route(s) mounted outside lens.go — mountedPatterns() reads lens.go alone, so these "+
			"are invisible to this file, the Origin sweep AND the leak sweep at the same time. Move "+
			"them, or widen mountedPatterns() and re-run all three:\n  %s", strings.Join(elsewhere, "\n  "))
	}
}
