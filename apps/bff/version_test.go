package main

import (
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"
)

// WHAT THESE GUARD, AND WHAT THEY STRUCTURALLY CANNOT.
//
// The defect this whole surface exists to prevent is a version that LOOKS like information and
// carries none. apps/web/package.json has carried "0.1.0" since the first commit; it was never
// wrong, it was never right, and nobody could tell — which is the same shape as a guard that
// never runs.
//
// There are exactly two failure modes and they need different kinds of check:
//
//	1. THE DEFAULT IS VERSION-SHAPED. An unstamped build claims a version it does not have.
//	   A unit test can see this, because the default is a literal in the source. That is
//	   TestVersionDefaultIsAnHonestPlaceholder, below.
//
//	2. THE BUILD STEP DID NOT RUN. A release binary ships carrying the placeholder.
//	   ⚠ NO UNIT TEST HERE CAN SEE THIS. Nothing in this package can observe whether the link
//	   step applied -X, because the test binary is not the release binary. That check must be
//	   made against the BUILT ARTIFACT, and it lives in .github/workflows/ci.yml (the bff job's
//	   "build with the stamp" step) and in scripts/build-release.sh, which is the one command
//	   that both CI and the deploy runbook use. Drop the -X flag and CI fails there, not here.
//
// Test 1 without test 2 is the trap: it proves the placeholder is honest while saying nothing
// about whether it was ever replaced.

// versionLiteral matches a quoted dotted-numeric version, e.g. "0.1.0" — the shape that reads as
// information. Deliberately the same regex Lens uses (cmd/lens/version_test.go), because this is
// the same defect class and the two services are compared side by side during a deploy.
var versionLiteral = regexp.MustCompile(`"\d+\.\d+\.\d+"`)

func TestVersionDefaultIsAnHonestPlaceholder(t *testing.T) {
	// GUARD 1. The default must announce that it is not a version.
	if versionLiteral.MatchString(`"` + bffVersion + `"`) {
		t.Errorf("bffVersion defaults to %q, which is version-SHAPED — an unstamped build would "+
			"claim a version it does not have. Use an obviously-unset placeholder.", bffVersion)
	}
	for _, ok := range []string{"dev", "unknown", "none"} {
		if bffVersion == ok {
			return
		}
	}
	t.Errorf("bffVersion defaults to %q; expected an explicit placeholder such as %q", bffVersion, "dev")
}

func TestVersionIsAVarNotAConst(t *testing.T) {
	// THE ACTUAL BUG IN LENS #364 WAS A CONST. -X cannot set one, so the version could never be
	// anything but its literal — and it failed SILENTLY: the build succeeded, the flag was
	// accepted, and the value did not change. Nothing at runtime can distinguish "const" from
	// "var that was never stamped", so this is an AST check on the declaration itself.
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, "version.go", nil, 0)
	if err != nil {
		t.Fatalf("parse version.go: %v", err)
	}
	var found bool
	for _, d := range f.Decls {
		gd, ok := d.(*ast.GenDecl)
		if !ok {
			continue
		}
		for _, spec := range gd.Specs {
			vs, ok := spec.(*ast.ValueSpec)
			if !ok {
				continue
			}
			for _, name := range vs.Names {
				if name.Name != "bffVersion" {
					continue
				}
				found = true
				if gd.Tok == token.CONST {
					t.Errorf("bffVersion is declared CONST. -X cannot set a const: the build " +
						"would accept the flag and silently keep the literal. Declare it var.")
				}
			}
		}
	}
	if !found {
		t.Fatal("no declaration of bffVersion found in version.go — this guard is not watching anything")
	}
}

func TestUnstampedBinaryReportsNoCommitAtAll(t *testing.T) {
	// The honesty requirement: an unstamped build must NOT report a commit called "dev". It has
	// no commit, and saying so is different from naming one. Same contract as Lens's
	// econflags.Binary, field for field, so an operator comparing the two services during a
	// deploy reads one shape rather than two.
	for _, unstamped := range []string{"dev", "", "  ", "\n"} {
		got := describeBinary(unstamped)
		if got.Stamped {
			t.Errorf("describeBinary(%q).Stamped = true; an unstamped build must say so", unstamped)
		}
		if got.Commit != "" {
			t.Errorf("describeBinary(%q).Commit = %q; want empty — a placeholder is not a commit",
				unstamped, got.Commit)
		}
		if got.Note == "" {
			t.Errorf("describeBinary(%q).Note is empty; an unstamped readout must explain itself, "+
				"because the reader is mid-deploy and stamped:false alone does not say what to do",
				unstamped)
		}
	}
}

func TestStampedBinaryReportsTheCommit(t *testing.T) {
	got := describeBinary("b41ea4d")
	if !got.Stamped {
		t.Error("describeBinary(\"b41ea4d\").Stamped = false; want true")
	}
	if got.Commit != "b41ea4d" {
		t.Errorf("Commit = %q; want %q", got.Commit, "b41ea4d")
	}
	if got.Note != "" {
		t.Errorf("Note = %q; want empty for a stamped build — a note here would be noise", got.Note)
	}
	// Surrounding whitespace is a build-script artefact, not part of the commit.
	if c := describeBinary(" b41ea4d\n").Commit; c != "b41ea4d" {
		t.Errorf("whitespace not trimmed: Commit = %q", c)
	}
}

func TestVersionJSONOmitsCommitWhenUnstamped(t *testing.T) {
	// The wire shape matters as much as the struct: a reader doing `jq .commit` must get null,
	// not the string "dev". `omitempty` is what makes that true, and it is easy to drop.
	b, err := json.Marshal(describeBinary("dev"))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(b), `"commit"`) {
		t.Errorf("unstamped JSON carries a commit key: %s — drop it so `jq .commit` is null", b)
	}
	if !strings.Contains(string(b), `"stamped":false`) {
		t.Errorf("unstamped JSON does not report stamped:false: %s", b)
	}
}

// ── the endpoint ────────────────────────────────────────────────────────────

func TestVersionEndpointIsNotBehindTheSession(t *testing.T) {
	// ⚠ THE DELIBERATE ASYMMETRY WITH EVERY OTHER /api/ ROUTE, and the one most likely to be
	// "fixed" by someone tidying up. It is unauthenticated on purpose:
	//
	//   · The reader is an operator mid-deploy, from a shell, and the BFF's OWN failure modes
	//     include an unreachable IdP that log.Fatalf's at boot and a misconfigured redirect that
	//     makes login impossible. A version gated on the session is unreadable exactly when
	//     "which commit is deployed?" is the question being asked.
	//   · It discloses a short commit SHA. Build identity is ALREADY public on this origin:
	//     index.html is served unauthenticated and names /assets/index-<contenthash>.js, so
	//     anyone can already fingerprint the build. The gate would change the label, not the
	//     disclosure.
	//   · Contrast Lens's /v1/admin/economy/flags, which IS admin-gated: it enumerates which
	//     mints are armed and whether shadow mode is on. That is money-path configuration with
	//     real leverage. A commit SHA is an identifier, not a configuration.
	//
	// If you are about to add requireSession here, the endpoint stops answering the question it
	// exists for. Add a new gated endpoint instead.
	a := newApp(config{}, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/version", nil) // NO cookie, NO session
	rec := httptest.NewRecorder()
	a.mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/version without a session = %d, want 200. A version behind the "+
			"session is unreadable when the session is what is broken.", rec.Code)
	}
	var got versionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("body is not the documented JSON: %v (%s)", err, rec.Body.String())
	}
	if got.Service != "bff" {
		t.Errorf("service = %q; want %q — the payload must name which of the two it describes",
			got.Service, "bff")
	}
}

func TestVersionEndpointReportsTheBundleItServes(t *testing.T) {
	// WHY THE BFF REPORTS THE BUNDLE TOO. The BFF serves WEB_DIST, so it is the authority on
	// which bundle is actually being served — better than an operator guessing the path. This
	// makes "do the two agree?" one request instead of two-plus-a-comparison.
	//
	// It reads apps/web/dist/version.json from disk, which is the WEB's build artifact, not a
	// value the BFF knows about itself. The two numbers therefore still come from two
	// independent builds; the BFF only relays one of them.
	dist := t.TempDir()
	writeFile(t, dist+"/version.json", `{"service":"web","commit":"aaaaaaa","stamped":true}`)

	a := newApp(config{webDist: dist}, nil)
	rec := httptest.NewRecorder()
	a.mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/version", nil))

	var got versionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v (%s)", err, rec.Body.String())
	}
	if got.Bundle == nil {
		t.Fatal("bundle is absent; the BFF serves the bundle and must report what it is serving")
	}
	if !got.Bundle.Readable {
		t.Errorf("bundle.readable = false with a valid version.json present: note=%q", got.Bundle.Note)
	}
	if got.Bundle.Commit != "aaaaaaa" {
		t.Errorf("bundle.commit = %q; want %q", got.Bundle.Commit, "aaaaaaa")
	}
}

func TestMissingBundleVersionIsReportedNotHidden(t *testing.T) {
	// ⚠ THE FAIL-CLOSED-TO-SILENCE TRAP. An older bundle has no version.json. If that produced
	// an absent or zero-valued bundle field, a reader would see "no disagreement" and conclude
	// the versions match — the worst possible reading, because it is indistinguishable from
	// agreement.
	//
	// It must say "I could not read it" and why. Unreadable is not equal.
	a := newApp(config{webDist: t.TempDir()}, nil) // empty dir: no version.json
	rec := httptest.NewRecorder()
	a.mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/version", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d; want 200 — an unreadable bundle is a reportable fact, not an error", rec.Code)
	}
	var got versionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Bundle == nil {
		t.Fatal("bundle is nil for a bundle with no version.json — silence reads as agreement")
	}
	if got.Bundle.Readable {
		t.Error("bundle.readable = true with no version.json on disk")
	}
	if got.Bundle.Commit != "" || got.Bundle.Stamped {
		t.Errorf("unreadable bundle reports commit=%q stamped=%v; both must be empty so no "+
			"reader can mistake absence for a match", got.Bundle.Commit, got.Bundle.Stamped)
	}
	if got.Bundle.Note == "" {
		t.Error("bundle.note is empty; an unreadable bundle must say what could not be read")
	}
}

func TestBundleAgreementIsNotClaimedWhenEitherSideIsUnknown(t *testing.T) {
	// The comparison is only meaningful when BOTH sides are known. Unstamped-vs-unstamped is
	// not agreement, it is two unknowns — and reporting agree:true there would tell an operator
	// the deploy is consistent when nothing has been established.
	cases := []struct {
		name, bffV, bundleJSON string
		wantAgree              *bool
	}{
		{"both stamped and equal", "aaaaaaa", `{"commit":"aaaaaaa","stamped":true}`, ptr(true)},
		{"both stamped, different", "aaaaaaa", `{"commit":"bbbbbbb","stamped":true}`, ptr(false)},
		{"bundle unstamped", "aaaaaaa", `{"stamped":false}`, nil},
		{"bff unstamped", "dev", `{"commit":"aaaaaaa","stamped":true}`, nil},
		{"neither stamped", "dev", `{"stamped":false}`, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dist := t.TempDir()
			writeFile(t, dist+"/version.json", tc.bundleJSON)
			got := buildVersionResponse(tc.bffV, dist)

			switch {
			case tc.wantAgree == nil && got.Agree != nil:
				t.Errorf("agree = %v; want null (absent) — one side is unknown, so agreement is "+
					"not established either way", *got.Agree)
			case tc.wantAgree != nil && got.Agree == nil:
				t.Errorf("agree = null; want %v", *tc.wantAgree)
			case tc.wantAgree != nil && *got.Agree != *tc.wantAgree:
				t.Errorf("agree = %v; want %v", *got.Agree, *tc.wantAgree)
			}
		})
	}
}

func ptr[T any](v T) *T { return &v }

func writeFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func TestBundleVersionPathFallsBackToHTMLOnAnOldBundle(t *testing.T) {
	// ⚠ THIS PINS A RUNBOOK INSTRUCTION, NOT A FEATURE.
	//
	// deploy/README.md tells an operator to check the bundle's version with
	// `curl -s $APP/version.json | jq .` and warns against testing the STATUS CODE. This test is
	// why: spaHandler falls back to index.html for any path that is not a real file, so on a
	// bundle built before the version surface existed, /version.json answers 200 with HTML.
	//
	// A check written as `curl -f $APP/version.json` therefore PASSES against a bundle that
	// carries no version at all — a green check next to the exact condition it was meant to
	// detect. If the fallback behaviour ever changes to a 404, this test fails and the runbook
	// warning can be simplified.
	dist := t.TempDir()
	writeFile(t, dist+"/index.html", "<!doctype html><html>a bundle with no version.json</html>")

	a := newApp(config{webDist: dist}, nil)
	rec := httptest.NewRecorder()
	a.mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/version.json", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; expected 200 (the SPA fallback). If this is now a 404, the runbook "+
			"no longer needs its parse-the-JSON warning — update deploy/README.md step 6.", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "text/html") {
		t.Fatalf("content-type = %q; expected HTML from the fallback", ct)
	}
	var probe map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &probe); err == nil {
		t.Error("the fallback body parsed as JSON; the runbook check relies on it NOT parsing")
	}
}
