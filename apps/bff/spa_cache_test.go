package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// spa_cache_test.go — THE TWO UNHASHED FILES IN THE BUNDLE WERE SERVED WITH NO FRESHNESS
// INFORMATION AT ALL, so a browser was free to keep serving the previous deploy's copy without
// asking. Everything else in dist/assets is content-hashed by Vite and cannot go stale: a new
// build gives it a new name. index.html and version.json keep their names across every deploy,
// and they are the two files whose CONTENT is what changed.
//
// ── WHAT WAS MEASURED, IN REAL CHROME, AGAINST A MATCHED CONTROL ─────────────────────
//
// The real BFF (`go build .`, WEB_DIST=apps/web/dist) answers the whole bundle with only
// Last-Modified — measured with curl at 088d711:
//
//	GET /                              200  Content-Type: text/html   Last-Modified: …   (no Cache-Control)
//	GET /ledger  (client route)        200  Content-Type: text/html   Last-Modified: …   (no Cache-Control)
//	GET /assets/index-BapraAEy.js      200  Content-Type: text/javascript                (no Cache-Control)
//	GET /version.json                  200  Content-Type: application/json               (no Cache-Control)
//
// Two servers were then stood up that reproduce that EXACT header set, differing in ONE header,
// with a Last-Modified 120 days old — what a bundle that was built once and left running looks
// like to a cache. Chrome loaded the page, navigated away, the served body was changed (the
// deploy), and Chrome navigated BACK to it — a normal navigation, not a reload, which is defined
// to revalidate:
//
//	no Cache-Control (what this handler sends)   GET /page requests after the deploy: 1  rendered: THE OLD COPY
//	Cache-Control: no-cache (the control)        GET /page requests after the deploy: 2  rendered: the new copy
//
// The control is what makes the first row evidence: with one header added and nothing else
// changed, the browser asked again (with If-Modified-Since) and rendered the new page. Without
// it the browser never issued a request at all — RFC 9111 §4.2.2 heuristic freshness, which a
// browser computes from Last-Modified precisely because nothing told it otherwise.
//
// ⚠ WHY A STALE index.html IS A BLANK PAGE AND NOT A COSMETIC LAG. `pnpm build` empties dist, so
// the previous deploy's `assets/index-<hash>.js` is GONE. A stale index.html asks for it, and
// the SPA fallback answers a missing file with index.html — measured against the real BFF:
//
//	GET /assets/index-OLDHASH1.js  ->  200  Content-Type: text/html; charset=utf-8  (1685 bytes of index.html)
//
// so the browser is handed HTML where it asked for a module, the script never executes, and the
// reader gets an empty #root with a 200 on every wire. THAT SECOND HALF IS REPORTED AND NOT
// FIXED HERE: which paths a fallback may answer is its own change with its own controls.
//
// ── THE RULE IS THIS SERVICE'S OWN, APPLIED EVERYWHERE EXCEPT HERE ───────────────────
//
// The BFF already decides freshness explicitly wherever staleness would mislead: keys.go and
// billing.go set `no-store` on a minted credential and a checkout session, auth.go on the
// session response, and version.go sets it on /api/version — THE SAME FACT this file's
// version.json carries, served by the other half of the same binary. The static half was never
// given one.
//
// `no-cache`, not `no-store`: neither file is a secret, and a stored copy is fine as long as the
// browser asks before using it. That keeps the 304 and costs a conditional request.

// unhashedBundleFiles is what the deploy replaces in place. Everything else Vite emits carries a
// content hash in its name, so a new build cannot collide with a cached copy of an old one.
var unhashedBundleFiles = []string{"index.html", "version.json"}

func newBundleApp(t *testing.T) *app {
	t.Helper()
	dist := t.TempDir()
	if err := os.WriteFile(filepath.Join(dist, "index.html"), []byte("<!doctype html><title>app</title>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dist, "version.json"), []byte(`{"commit":"abc1234"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dist, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dist, "assets", "index-HASH1.js"), []byte("console.log(1)"), 0o644); err != nil {
		t.Fatal(err)
	}
	return newApp(config{lensBaseURL: "http://127.0.0.1:1", provisionSecret: testProvisionSecret, webDist: dist, authMode: authModeDisabled}, nil)
}

func get(t *testing.T, a *app, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

// TestBundleInstrument is the floor. Every assertion below is about a header on a response, so a
// handler that stopped serving the bundle at all would satisfy "no stale header" perfectly.
func TestBundleInstrument(t *testing.T) {
	a := newBundleApp(t)
	// ⚠ `/index.html` IS NOT IN THIS LIST, AND THE FLOOR IS WHY IT IS NOT. The first version of
	// this file asserted it and the floor refused: Go's http.FileServer answers /index.html with
	// a 301 to `/`, so there is no document there to carry a header. `/` is the canonical URL and
	// the only one a browser ever holds for this app — the entry point is reached by name from
	// nothing, because every asset reference in it is an absolute path.
	for _, tc := range []struct{ path, wantBody string }{
		{"/", "<title>app</title>"},
		{"/ledger", "<title>app</title>"}, // a client route, via the fallback
		{"/version.json", `"commit":"abc1234"`},
		{"/assets/index-HASH1.js", "console.log(1)"},
	} {
		rec := get(t, a, tc.path)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status %d, want 200 — the cases below would be facts about an empty response", tc.path, rec.Code)
		}
		if body := rec.Body.String(); !contains(body, tc.wantBody) {
			t.Fatalf("%s: body %q does not contain %q — this is not the file it claims to serve", tc.path, body, tc.wantBody)
		}
	}
}

// ⚠ THE TWO UNHASHED FILES ARE ASSERTED SEPARATELY BECAUSE THEY LEAVE spaHandler BY DIFFERENT
// RETURNS. `/` resolves to the dist DIRECTORY, so os.Stat reports a dir and it goes out through
// the FALLBACK; `/version.json` is an existing file and goes out through the FileServer branch.
// One test over both would red for either and name neither, and a fix applied to one branch
// would look complete. C2 and C3 in scripts/w11-spa-cache-controls.py mutate one branch each.

// TestEntryPointMustRevalidate — `/`, out through the fallback. The document every reader holds.
func TestEntryPointMustRevalidate(t *testing.T) {
	a := newBundleApp(t)
	rec := get(t, a, "/")
	if !contains(rec.Body.String(), "<title>app</title>") {
		t.Fatalf("GET / did not serve the app — the assertion below would be about something else")
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-cache" {
		t.Errorf("GET /: Cache-Control = %q, want %q — index.html keeps its name across every "+
			"deploy, so a browser told nothing about freshness may serve the previous one from "+
			"cache without asking (measured in Chrome: it does), and the assets that copy names "+
			"no longer exist", cc, "no-cache")
	}
}

// TestVersionJSONMustRevalidate — `/version.json`, out through the FileServer branch. This is the
// file deploy/README.md tells an operator to curl to confirm which commit is live.
func TestVersionJSONMustRevalidate(t *testing.T) {
	a := newBundleApp(t)
	rec := get(t, a, "/version.json")
	if !contains(rec.Body.String(), `"commit":"abc1234"`) {
		t.Fatalf("GET /version.json did not serve the bundle's identity file")
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-cache" {
		t.Errorf("GET /version.json: Cache-Control = %q, want %q — this file answers 'which "+
			"commit is live', and a stale copy answers it with the previous one. /api/version "+
			"carries the same fact from the other half of this binary and sets no-store; this "+
			"half was given nothing", cc, "no-cache")
	}
}

// TestClientRoutesMustRevalidate — the same document, reached the way every address behind the
// gate is reached. The fallback is a SEPARATE return in spaHandler from the direct file hit; a
// fix applied to one of them leaves every deep link serving a stale app.
func TestClientRoutesMustRevalidate(t *testing.T) {
	a := newBundleApp(t)
	// Every shape of client route: the console root's children, a nested one, and one with an
	// extension-looking segment that is still a page.
	for _, path := range []string{"/ledger", "/billing/success", "/track/issues/42", "/docs/spaces/1"} {
		rec := get(t, a, path)
		if body := rec.Body.String(); !contains(body, "<title>app</title>") {
			t.Fatalf("GET %s did not fall back to index.html (body %q) — the header assertion "+
				"below would be about a response that is not the app", path, body)
		}
		if cc := rec.Header().Get("Cache-Control"); cc != "no-cache" {
			t.Errorf("GET %s (client route → index.html): Cache-Control = %q, want %q — the "+
				"fallback is a different return from the direct file hit and needs its own header",
				path, cc, "no-cache")
		}
	}
}

// TestHashedAssetsAreNotGivenAFreshnessRuleHere — the inverse, and the reason the fix is scoped.
// A content-hashed file cannot go stale: a new build gives it a new name. Giving it an explicit
// max-age is a separate decision with a NUMBER in it and is deliberately not made here, so this
// case pins that nothing was quietly chosen — if a future change starts caching assets, this
// says so out loud rather than letting a year-long max-age arrive unannounced.
func TestHashedAssetsAreNotGivenAFreshnessRuleHere(t *testing.T) {
	a := newBundleApp(t)
	rec := get(t, a, "/assets/index-HASH1.js")
	if !contains(rec.Body.String(), "console.log(1)") {
		t.Fatalf("the asset did not serve — the assertion below would be about the fallback")
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "" {
		t.Errorf("GET /assets/index-HASH1.js: Cache-Control = %q, want it unset — a freshness "+
			"rule for content-hashed assets is a separate change and carries a number nobody "+
			"has chosen; state it in a commit, not as a side effect of this one", cc)
	}
}

// contains is strings.Contains, spelled locally so this file states its own floor without
// reaching for an import that would make the failure message less specific.
func contains(haystack, needle string) bool {
	return len(needle) == 0 || len(haystack) >= len(needle) && indexOf(haystack, needle) >= 0
}

func indexOf(h, n string) int {
	for i := 0; i+len(n) <= len(h); i++ {
		if h[i:i+len(n)] == n {
			return i
		}
	}
	return -1
}
