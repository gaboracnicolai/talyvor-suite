package main

import (
	"os"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"
)

// THE DEFAULT COLUMN IS A CLAIM ABOUT THE BINARY, AND NOTHING WAS CHECKING IT.
//
// README.md's Env table states four defaults. MEASURED at 028402b, each changed in main.go and the
// whole package re-run (~/talyvor-queue/w11-defaults-census.py; verdicts from `--- FAIL:` lines,
// never an exit code):
//
//	BFF_ADDR         127.0.0.1:8787     -> 127.0.0.1:9999   UNPINNED, nothing failed
//	LENS_BASE_URL    http://…:8080      -> …:8081           UNPINNED, nothing failed
//	WEB_DIST         ../web/dist        -> ../web/build     UNPINNED, nothing failed
//	BFF_SESSION_TTL  12h                -> 6h               UNPINNED, nothing failed
//
// Four for four. The absolute session lifetime — how long a stolen cookie stays useful — could be
// halved and 330 tests stayed green while two documents went on saying 12h.
//
// This test does not restate the numbers. It reads them out of the table and asks the binary what
// it actually does with each variable UNSET, so a value can be wrong in only one way: someone
// changes the code and the document, together, deliberately.
//
// WHAT IT DOES NOT COVER: rows with no default (—) are counted but not probed, and the note column
// is prose. A default stated in deploy/bff.env.example ("Optional; default 12h") is a THIRD copy of
// the same number and is not read here — it is a comment in a file the binary never parses, and
// fixing that is a different instrument, not a wider regex.

// defaultProbe answers "what does the binary do when this variable is unset?" — one per stated
// default. A stated default with no probe is a FAILURE, not a skip: an unprobed row is exactly the
// row that goes unchecked.
type defaultProbe struct {
	observe func(t *testing.T) string
	// canon normalises both sides before comparison. Identity for plain strings; for a duration,
	// parsing means `12h` and `720m` compare equal and an unparseable table cell fails loudly
	// instead of comparing unequal for the wrong reason.
	canon func(t *testing.T, raw string) string
}

func identityCanon(_ *testing.T, s string) string { return s }

func durationCanon(t *testing.T, s string) string {
	t.Helper()
	d, err := time.ParseDuration(strings.TrimSpace(s))
	if err != nil {
		t.Fatalf("%q is not a duration: %v — the table states a duration default and this test "+
			"cannot compare what it cannot parse", s, err)
	}
	return d.String()
}

// bootWithUnset clears every variable the binary reads, applies the smallest environment that
// still boots, and returns the config. It refuses to run if the variable under test is set — a
// probe that set its own subject would compare the environment to itself.
func bootWithUnset(t *testing.T, underTest string, env map[string]string) config {
	t.Helper()
	for name := range envVarsReadByBinaryChecked(t) {
		t.Setenv(name, "")
	}
	for k, v := range env {
		t.Setenv(k, v)
	}
	if got := os.Getenv(underTest); got != "" {
		t.Fatalf("the probe for %s set it to %q — a default is what happens when a variable is "+
			"UNSET, so this probe would be comparing the environment to itself", underTest, got)
	}
	cfg, err := loadConfig()
	if err != nil {
		t.Fatalf("probing the default of %s: loadConfig refused the minimal environment: %v", underTest, err)
	}
	return cfg
}

func minimalDisabled() map[string]string {
	return map[string]string{"BFF_AUTH_MODE": "disabled", "LENS_PROVISION_SECRET": "probe-secret"}
}

func minimalOIDC() map[string]string {
	return map[string]string{
		"BFF_AUTH_MODE":         "oidc",
		"LENS_PROVISION_SECRET": "probe-secret",
		"OIDC_ISSUER":           "https://idp.example.com",
		"OIDC_CLIENT_ID":        "talyvor-suite",
		"OIDC_CLIENT_SECRET":    "s3cret",
		"BFF_PUBLIC_BASE_URL":   "https://app.talyvor.com",
		"OIDC_ALLOWED_EMAILS":   "ng@example.com",
	}
}

var defaultProbes = map[string]defaultProbe{
	"BFF_ADDR": {canon: identityCanon, observe: func(t *testing.T) string {
		return bootWithUnset(t, "BFF_ADDR", minimalDisabled()).addr
	}},
	"LENS_BASE_URL": {canon: identityCanon, observe: func(t *testing.T) string {
		return bootWithUnset(t, "LENS_BASE_URL", minimalDisabled()).lensBaseURL
	}},
	"WEB_DIST": {canon: identityCanon, observe: func(t *testing.T) string {
		return bootWithUnset(t, "WEB_DIST", minimalDisabled()).webDist
	}},
	// The session TTL is parsed in oidc mode only, so this probe boots the mode that reads it.
	"BFF_SESSION_TTL": {canon: durationCanon, observe: func(t *testing.T) string {
		return bootWithUnset(t, "BFF_SESSION_TTL", minimalOIDC()).sessionTTL.String()
	}},
}

// TestReadmeDefaultsAreWhatTheBinaryDoes compares the table's Default column against the binary.
func TestReadmeDefaultsAreWhatTheBinaryDoes(t *testing.T) {
	body := readBFFReadme(t)

	// `| `NAME` | `VALUE` |` — a backticked default. A row whose default cell is — states no
	// default; it is counted (to prove the row parser sees the whole table) and not probed.
	row := regexp.MustCompile("(?m)^\\|\\s*`([A-Z][A-Z0-9_]*)`\\s*\\|\\s*(?:`([^`]+)`|(—))\\s*\\|")
	stated := map[string]string{}
	noDefault := 0
	for _, m := range row.FindAllStringSubmatch(body, -1) {
		if m[2] == "" {
			noDefault++
			continue
		}
		stated[m[1]] = m[2]
	}
	if len(stated) < 3 || noDefault < 3 {
		t.Fatalf("parsed %d stated defaults and %d no-default rows from the Env table — the row "+
			"parser is broken, not the table; a parser that finds nothing agrees with every "+
			"possible README", len(stated), noDefault)
	}

	// COVERAGE, asserted rather than assumed: a stated default nobody probes is an unchecked
	// claim wearing a checked table's clothes.
	var unprobed []string
	for name := range stated {
		if _, ok := defaultProbes[name]; !ok {
			unprobed = append(unprobed, name)
		}
	}
	sort.Strings(unprobed)
	if len(unprobed) > 0 {
		t.Fatalf("the Env table states a default for %v and this test has no probe for them. Add "+
			"one — the point of this file is that every stated default is compared to the binary, "+
			"and a silently skipped row is how the column stopped meaning anything the first time.",
			unprobed)
	}
	// And the inverse: a probe for a row that is gone would sit here passing forever.
	for name := range defaultProbes {
		if _, ok := stated[name]; !ok {
			t.Errorf("this test probes %s but the Env table no longer states a default for it — "+
				"the probe is measuring something no document claims", name)
		}
	}

	for name, want := range stated {
		p := defaultProbes[name]
		t.Run(name, func(t *testing.T) {
			got := p.canon(t, p.observe(t))
			if w := p.canon(t, want); got != w {
				t.Errorf("README.md says %s defaults to %q; with it unset the binary uses %q.\n"+
					"One of the two is wrong, and until this test existed neither could tell: all "+
					"four stated defaults were measured unpinned at 028402b.", name, w, got)
			}
		})
	}
}
