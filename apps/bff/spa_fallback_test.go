package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// spa_fallback_test.go — THE SPA FALLBACK ANSWERED A REQUEST FOR A FILE THE BUILD OWNS WITH
// `200 text/html`, SO A MISSING BUNDLE FILE WAS INDISTINGUISHABLE FROM A PRESENT ONE ON THE WIRE.
//
// ── WHAT WAS MEASURED, AGAINST THE REAL BINARY AND IN REAL CHROME ────────────────────
//
// `go build .` at b17a6ac, WEB_DIST=apps/web/dist (the real bundle), curl:
//
//	GET /assets/index-CU-oTi4U.js              200  text/javascript   456004 bytes  (the real one)
//	GET /assets/index-OLDHASH1.js              200  text/html           1695 bytes  ← index.html
//	GET /assets/nope.css                       200  text/html           1695 bytes  ← index.html
//	GET /assets/space-grotesk-latin-GONE.woff2 200  text/html           1695 bytes  ← index.html
//	GET /assets/                               200  text/html           1695 bytes  ← index.html
//	GET /api/nope                              404  application/json      29 bytes  (scoped away already)
//
// Then the failure itself, in Chrome, against the SAME BINARY serving a copy of the real dist
// whose index.html names asset hashes that are not on disk — which is precisely what a browser
// holding the previous deploy's index.html asks for, and what a half-finished rsync leaves:
//
//	                       requests  all 200?  #root  stylesheet rules  document.title
//	stale index.html          4        yes       0           0          "Talyvor Suite" (index.html's static string)
//	the bundle as built       4        yes     11216       328          "Overview | Talyvor Suite"
//
// One console error and nothing else: `Failed to load module script: Expected a
// JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html"`.
// The stylesheet is refused the same way and reports 0 rules, so `body` computes a transparent
// background — a white screen on a product whose canvas is #F3F6FA light / #060A12 dark. Every
// response on the wire was a 200.
//
// ── THE RULE THIS FILE HOLDS ─────────────────────────────────────────────────────────
//
// A PATH THE BUILD OWNS IS ANSWERED BY THE BUILD OR BY 404 — NEVER BY THE SPA.
//
// Build-owned means: anything under /assets/ (Vite's assetsDir — every file there is emitted by
// the build with a content hash in its name, so the set of valid names IS what is on disk), plus
// /version.json, the one file the build emits at a stable path outside it. `/index.html` is
// deliberately NOT in the set — the fallback IS index.html, so a missing one already 404s through
// http.ServeFile, and a second guard on the same path is an invariant held twice that no control
// could ever breach.
//
// Everything else keeps the fallback, and that is not an oversight — it is the whole point of the
// fallback. `/track/issues/42.5` is a PAGE. That is why this is a PREFIX rule and not an
// extension rule: an extension rule reads the `.5` and 404s a client route. C7 in
// scripts/w11-spa-fallback-controls.py is exactly that wrong fix, and TestClientRoutesStillFall
// Back is what refuses it.
//
// ── THE PRODUCT WROTE THIS HAZARD DOWN THREE TIMES AND WORKED AROUND IT INSTEAD ──────
//
//	deploy/FULL-STACK-DEPLOY.md §"The BFF serves the SPA"  — a measured table of seven paths whose
//	  status codes say nothing, and "⚠ A MISSING JS ASSET ALSO ANSWERS 200 WITH HTML … every curl
//	  check in this document passes, and the app is a white screen."
//	deploy/README.md §6                                    — "a status code cannot verify any other
//	  path on this origin either … Prove content, not status."
//	apps/web/vite.config.ts §stampBuild                    — "a check must require the response to
//	  PARSE AS JSON. A bare `curl -f` … passes against a bundle carrying no version at all."
//
// Three descriptions of one line's behaviour, and a fourth file built to route around it. The
// rule is this service's own everywhere else: /api/* is already scoped away from the fallback and
// 404s honestly (lens.go, "never fall through to the SPA and hand back index.html").

// fallbackFixture is this file's own bundle, spelled out rather than borrowed from
// spa_cache_test.go's newBundleApp. That fixture exists to carry Cache-Control assertions and its
// contents are chosen for those; every case below is about WHICH PATHS EXIST, so the fixture is
// the instrument and it states its own contents here.
type fallbackFixture struct {
	// withVersionJSON false reproduces a bundle built before the stamping plugin existed —
	// the case apps/web/vite.config.ts warns about by name.
	withVersionJSON bool
}

func newFallbackApp(t *testing.T, f fallbackFixture) *app {
	t.Helper()
	dist := t.TempDir()
	write := func(rel, body string) {
		t.Helper()
		full := filepath.Join(dist, rel)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("index.html", `<!doctype html><title>app</title><script type="module" src="/assets/index-HASH1.js"></script>`)
	write("assets/index-HASH1.js", "console.log('the bundle')")
	write("assets/index-HASH2.css", ":root{--x:1}")
	if f.withVersionJSON {
		write("version.json", `{"commit":"abc1234"}`)
	}
	return newApp(config{lensBaseURL: "http://127.0.0.1:1", provisionSecret: testProvisionSecret, webDist: dist, authMode: authModeDisabled}, nil)
}

func getPath(t *testing.T, a *app, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

// servedTheApp reports whether a response body is index.html. That is the thing being refused on
// a build-owned path, so it is asserted on the BODY and never on a header: a fallback that kept
// answering but stopped setting Content-Type would satisfy a header assertion perfectly.
func servedTheApp(rec *httptest.ResponseRecorder) bool {
	return strings.Contains(rec.Body.String(), "<title>app</title>")
}

// TestBundleStillServes is the floor. Every case below asserts that something is NOT served, and
// a handler that served nothing at all would pass all of them. This is the only test here that
// would notice.
func TestBundleStillServes(t *testing.T) {
	a := newFallbackApp(t, fallbackFixture{withVersionJSON: true})
	for _, tc := range []struct{ path, want string }{
		{"/", "<title>app</title>"},                             // the entry point, via the fallback (dist is a dir)
		{"/ledger", "<title>app</title>"},                       // a client route, via the fallback
		{"/assets/index-HASH1.js", "console.log('the bundle')"}, // a real asset, via the FileServer
		{"/assets/index-HASH2.css", ":root{--x:1}"},             // a real asset that is not the module
		{"/version.json", `"commit":"abc1234"`},                 // the build's identity file
	} {
		rec := getPath(t, a, tc.path)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET %s: status %d, want 200 — the refusals below would be facts about a handler that serves nothing", tc.path, rec.Code)
		}
		if !strings.Contains(rec.Body.String(), tc.want) {
			t.Fatalf("GET %s: body %q does not contain %q — this is not the file it claims to serve", tc.path, rec.Body.String(), tc.want)
		}
	}
}

// TestMissingAssetIsNotTheApp — the measured failure. A content-hashed name that is not on disk
// does not exist: no future build will ever emit it, because the hash IS the content.
func TestMissingAssetIsNotTheApp(t *testing.T) {
	a := newFallbackApp(t, fallbackFixture{withVersionJSON: true})
	// One per resource kind that index.html can reference, because the browser's failure differs
	// for each and a fix scoped to ".js" would look complete: the module raises a MIME error, the
	// stylesheet is refused silently and reports zero rules, the font just never arrives.
	for _, path := range []string{
		"/assets/index-OLDHASH1.js",
		"/assets/index-OLDHASH2.css",
		"/assets/space-grotesk-latin-GONE.woff2",
	} {
		rec := getPath(t, a, path)
		if servedTheApp(rec) {
			t.Errorf("GET %s: served index.html — a browser that asked for a module got a document. "+
				"Measured in Chrome against this exact shape: one MIME error, #root empty, zero "+
				"stylesheet rules, and a 200 on every request. Nothing on the server reports anything wrong", path)
		}
		if rec.Code != http.StatusNotFound {
			t.Errorf("GET %s: status %d, want 404 — a status code is the only thing a deploy check, "+
				"a proxy or a browser cache can read, and 200 tells all three that a file that does "+
				"not exist is fine", path, rec.Code)
		}
	}
}

// TestAssetDirectoryIsNotTheApp — /assets/ resolves to a DIRECTORY, which leaves spaHandler by
// the same return as a missing file (os.Stat succeeds, IsDir is true). A fix that tested only
// os.IsNotExist would leave this one answering 200 with the app.
func TestAssetDirectoryIsNotTheApp(t *testing.T) {
	a := newFallbackApp(t, fallbackFixture{withVersionJSON: true})
	rec := getPath(t, a, "/assets/")
	if servedTheApp(rec) {
		t.Errorf("GET /assets/: served index.html — the asset directory is not a page")
	}
	if rec.Code != http.StatusNotFound {
		t.Errorf("GET /assets/: status %d, want 404", rec.Code)
	}
}

// TestMissingVersionJSONIsNotTheApp — the case apps/web/vite.config.ts names in its own comment:
// on a bundle built before the stamping plugin existed, /version.json returned 200 with HTML, so
// `curl -f` and every status-code check succeeded against a bundle carrying no version at all.
// deploy/README.md tells the operator to pipe it to `jq` for exactly this reason.
//
// ⚠ THIS TEST REPLACES TestBundleVersionPathFallsBackToHTMLOnAnOldBundle in version_test.go,
// WHICH ASSERTED THE OPPOSITE ON PURPOSE. That test pinned a RUNBOOK INSTRUCTION rather than a
// feature, and it named its own expiry: "If this is now a 404, the runbook no longer needs its
// parse-the-JSON warning — update deploy/README.md step 6." It failed on this change, which is
// how the runbook edit got made. Its third assertion survives below: the runbook still pipes to
// `jq`, so the body of the refusal must still not parse as JSON.
func TestMissingVersionJSONIsNotTheApp(t *testing.T) {
	a := newFallbackApp(t, fallbackFixture{withVersionJSON: false})
	rec := getPath(t, a, "/version.json")
	if servedTheApp(rec) {
		t.Errorf("GET /version.json on a bundle that has none: served index.html. A deploy check " +
			"that reads the status code cannot tell an unstamped bundle from a stamped one")
	}
	if rec.Code != http.StatusNotFound {
		t.Errorf("GET /version.json on a bundle that has none: status %d, want 404", rec.Code)
	}
	// Inherited from the test this replaces: `curl -s $APP/version.json | jq -e '.commit'` is the
	// runbook's check, and it is only sound while a bundle with no version fails to parse.
	var probe map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &probe); err == nil {
		t.Errorf("the refusal body parsed as JSON (%q); deploy/README.md step 6 pipes this response "+
			"to jq and relies on it NOT parsing", rec.Body.String())
	}
	// And the same request against a bundle that HAS it must still be the file — otherwise this
	// case is satisfied by refusing /version.json outright, which is a different bug.
	rec = getPath(t, newFallbackApp(t, fallbackFixture{withVersionJSON: true}), "/version.json")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"commit":"abc1234"`) {
		t.Errorf("GET /version.json on a bundle that HAS one: status %d body %q, want the file", rec.Code, rec.Body.String())
	}
}

// TestClientRoutesStillFallBack — THE OVER-CORRECTION REFUSAL, and the reason the rule is a
// prefix and not an extension. Every one of these is a page the router draws; a fallback that
// stopped answering them would break every deep link and every hard refresh behind the gate.
func TestClientRoutesStillFallBack(t *testing.T) {
	a := newFallbackApp(t, fallbackFixture{withVersionJSON: true})
	for _, path := range []string{
		"/ledger",
		"/billing/success",    // the URL Lens redirects a purchase to
		"/track/issues/42",    // a deep link
		"/track/issues/42.5",  // ⚠ A PAGE WITH A DOT IN IT. An extension rule 404s this.
		"/docs/spaces/1",      //
		"/setup",              //
		"/signin",             // a public route, above the auth gate
		"/marketing/anything", // a wildcard route
	} {
		rec := getPath(t, a, path)
		if rec.Code != http.StatusOK || !servedTheApp(rec) {
			t.Errorf("GET %s: status %d, served-the-app %v — this is a client route and the "+
				"fallback is what makes a deep link and a hard refresh work", path, rec.Code, servedTheApp(rec))
		}
	}
}
