package main

import (
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// A COMMENT THAT NAMES A TEST IS A CLAIM ABOUT ENFORCEMENT, AND SIX OF THEM NAMED NOTHING.
//
// This package documents its guarantees by naming the test that holds them — "Guarded by …",
// "a new write route added without a line here fails …", "… pins the value against the number
// Lens actually enforces". That is a good habit, and it works because a reader can go and read
// the named test. Measured at `0f25561`: 124 distinct test names are cited in comments across
// this package and TEN were declared nowhere. Two were line-wrapped or abbreviated spellings of
// a real test, three were deliberate references to a DELETED test (the deletion being the
// point), and the remaining five were claims of enforcement with nothing behind them:
//
//	convert.go      a `…_MinimumMatchesLens` test was named as pinning the mirrored conversion
//	                minimum "against the number Lens actually enforces". It had never existed.
//	                MEASURED: the constant is pinned only INCIDENTALLY, by the literal amounts
//	                other tests post — moving it by one micro-unit reds three of them — and
//	                nothing in this repo compares it to Lens at all. The comment now says that.
//	sameorigin_test a `…_IsGuardedOrExplicitlyExempt` test was named as what makes the swept
//	                write-route list unable to "silently go stale". No such test, so it could.
//	                MEASURED at 0f25561, by driving every unsafe method on every mounted pattern
//	                through a.ServeHTTP: the list was complete — nothing was unguarded — and
//	                nothing kept it that way. That test is written now, below the list.
//	tenant.go       a `…ClosesOverAStartupWorkspaceID` test was named as the guard on the one
//	                sanctioned builder of the Lens workspace prefix. The guard is REAL and was
//	                renamed; the citation was not moved with it.
//	tenant_callsite a `…_RemainsPinnedByDesign` test was named for the claim that Docs "stays
//	                pinned by design". Stale twice: no such test, and Docs is not pinned —
//	                DOCS_WORKSPACE_ID is gone (main.go) and docsWorkspaceFor resolves the
//	                workspace from the SESSION.
//	products_test   a doc heading still naming its test's pre-rename spelling.
//
// ⚠ WHY A CENSUS AND NOT SIX EDITS. Every one was written by someone who meant it, and each
// decayed on a different day for a different reason — a rename, a deletion, a line wrap, a test
// described before it was written. That is not a mistake anyone stops making; it is what an
// unchecked cross-reference does. So the cross-reference is checked.
//
// ⚠ IT IS DELIBERATELY NOT A "DOES THE COMMENT DESCRIBE THE TEST CORRECTLY" CHECK. No scan can
// read intent. It asserts the one thing that is mechanical and that all six failed: the test a
// comment names must be a test that exists.
//
// ⚠ AND THIS FILE OBEYS ITS OWN RULE — which is why the cases above are described rather than
// quoted. Spelling the five dead names here would have made this header the single largest
// source of dangling citations in the package. That is not a limitation worked around; it is
// the guard working on the first file it was pointed at.
//
// ⚠ TWO OF THE THREE GUARDS ADDED WITH THIS FILE PASSED ON THEIR FIRST RUN, so all ten defects
// they are meant to see are driven at them by scripts/w11-cited-guard-controls.py — including a
// new write route mounted with no line in the swept list, an exemption for a test that exists,
// and each scan reading nothing. Run it after touching any of them; it must end
// `caught 10  survived 0`, and it names the test each control expects, because a control scored
// on "the suite went red" records a hole as covered whenever some other test happens to notice.

// citedButGone names tests that comments reference precisely BECAUSE they are gone — the
// deletion is the documented fact. Each needs a reason, and the reverse direction is checked
// below: an entry here that IS declared fails, so a name cannot sit in this map after someone
// re-adds the test.
var citedButGone = map[string]string{
	// ⚠ THIS REASON USED TO END "so the disclosure cannot outlive the pin it described", and the
	// disclosure outlived it FOUR TIMES. Measured at 8ba994f: this file's own package still carried
	// five comment lines about the removed key (truncated mid-sentence by the deleting commit and
	// re-attached to signup_open), and the web package carried three more. The field cannot outlive
	// the pin because it stops compiling; the PROSE about the field has no compiler and outlived it
	// everywhere. Corrected rather than deleted: the entry is still true about the TEST.
	"TestAuthMeDocsSharedIsDerivedNotHardcoded": "track_tenant_test.go records its deletion as the point: " +
		"/auth/me no longer serves docs_shared, so a test asserting how it is derived would assert " +
		"nothing. The prose describing the field is NOT covered by that and had to be swept " +
		"separately — see apps/web/src/danglingClaimAudit.test.ts.",
	"TestBundleVersionPathFallsBackToHTMLOnAnOldBundle": "version_test.go and spa_fallback_test.go both " +
		"record that it pinned a RUNBOOK instruction whose premise is gone; it was replaced deliberately.",
	"TestMembersProxiesPinnedTrackWorkspace": "keys_test.go records it as replaced when Track went " +
		"per-session — it asserted a pin that was correct then and would be the defect now.",
}

var (
	testDeclRe = regexp.MustCompile(`(?m)^func (Test[A-Za-z0-9_]+)`)
	testNameRe = regexp.MustCompile(`\bTest[A-Z][A-Za-z0-9_]*`)
	// The identifier characters a wrapped name continues with on the following comment line.
	contRe = regexp.MustCompile(`^([A-Za-z0-9_]+)`)
)

// packageGoFiles is every .go file in this package, tests included: a citation in a test file
// decays exactly the same way one in production source does, and five of the ten did.
func packageGoFiles(t *testing.T) map[string]string {
	t.Helper()
	ents, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]string{}
	for _, e := range ents {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".go") {
			continue
		}
		by, err := os.ReadFile(e.Name())
		if err != nil {
			t.Fatal(err)
		}
		out[e.Name()] = string(by)
	}
	return out
}

// declaredTests is every `func Test…` declaration in the package.
func declaredTests(t *testing.T) map[string]bool {
	t.Helper()
	got := map[string]bool{}
	for _, src := range packageGoFiles(t) {
		for _, m := range testDeclRe.FindAllStringSubmatch(src, -1) {
			got[m[1]] = true
		}
	}
	return got
}

type citation struct {
	file string
	line int
	name string
}

// commentLine reports the comment text of a line, or "" when the line is not a comment.
// Only `//` and the body of a `/* */` block — a Test name inside a string literal or an
// identifier is code, and code that names a missing test does not compile.
func commentLine(s string) string {
	s = strings.TrimSpace(s)
	switch {
	case strings.HasPrefix(s, "//"):
		return strings.TrimSpace(strings.TrimPrefix(s, "//"))
	case strings.HasPrefix(s, "*") && !strings.HasPrefix(s, "*/"):
		return strings.TrimSpace(strings.TrimPrefix(s, "*"))
	case strings.HasPrefix(s, "/*"):
		return strings.TrimSpace(strings.TrimPrefix(s, "/*"))
	default:
		return ""
	}
}

// citedTests finds every test name a comment names, resolving the one shape that is NOT a stale
// citation: a long name WRAPPED across two comment lines. spa_fallback_test.go had one — a name
// broken after `…StillFall`, continuing with `Back` on the next line — and a check that read it
// as two would report a defect that is not there. A candidate is glued to the next comment
// line's leading identifier characters, and the glued form wins ONLY WHEN IT IS DECLARED, so
// gluing can rescue a real name and can never invent a pass.
func citedTests(t *testing.T, declared map[string]bool) []citation {
	t.Helper()
	var out []citation
	for name, src := range packageGoFiles(t) {
		lines := strings.Split(src, "\n")
		for i, raw := range lines {
			text := commentLine(raw)
			if text == "" {
				continue
			}
			var next string
			if i+1 < len(lines) {
				next = commentLine(lines[i+1])
			}
			for _, cand := range testNameRe.FindAllString(text, -1) {
				if !declared[cand] && strings.HasSuffix(text, cand) && next != "" {
					if m := contRe.FindStringSubmatch(next); m != nil && declared[cand+m[1]] {
						cand += m[1] // a wrapped name, not a dangling one
					}
				}
				out = append(out, citation{file: name, line: i + 1, name: cand})
			}
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].file != out[j].file {
			return out[i].file < out[j].file
		}
		return out[i].line < out[j].line
	})
	return out
}

// ════════════════════════════════════════════════════════════════════════════════════════

// The census must find a population. A cross-reference check that resolves nothing passes for
// every possible state of the package, which is the failure mode this whole file exists about.
func TestCitedTestCensusFindsAPopulation(t *testing.T) {
	declared := declaredTests(t)
	cited := citedTests(t, declared)

	// Literals, never a count compared against itself: a floor measured from the thing it is
	// protecting is satisfied at zero.
	if len(declared) < 150 {
		t.Fatalf("declared tests = %d, want at least 150 — the declaration scan found almost nothing", len(declared))
	}
	if len(cited) < 100 {
		t.Fatalf("citations found = %d, want at least 100 — the comment scan found almost nothing", len(cited))
	}
	distinct := map[string]bool{}
	for _, c := range cited {
		distinct[c.name] = true
	}
	if len(distinct) < 50 {
		t.Fatalf("distinct cited names = %d, want at least 50", len(distinct))
	}
	// And resolution genuinely works in the positive direction — most citations must land on a
	// real test, or the "declared" side is what is broken.
	resolved := 0
	for _, c := range cited {
		if declared[c.name] {
			resolved++
		}
	}
	if resolved*2 < len(cited) {
		t.Fatalf("only %d of %d citations resolve to a declared test — the resolver, not the comments, is what is wrong", resolved, len(cited))
	}
}

// THE GUARD. Every test a comment names must exist, or be named in citedButGone with a reason.
func TestEveryCitedTestExists(t *testing.T) {
	declared := declaredTests(t)
	var dangling []string
	for _, c := range citedTests(t, declared) {
		if declared[c.name] {
			continue
		}
		if _, ok := citedButGone[c.name]; ok {
			continue
		}
		dangling = append(dangling, "apps/bff/"+c.file+":"+strconv.Itoa(c.line)+" names "+c.name+", which is declared nowhere")
	}
	if len(dangling) > 0 {
		t.Fatalf("comment(s) name a test that does not exist — a cited guard must be readable:\n  %s",
			strings.Join(dangling, "\n  "))
	}
}

// The reverse direction: an exemption that is no longer true is itself a stale citation. If
// someone re-adds one of these tests, the map must stop claiming it is gone.
func TestCitedButGoneEntriesAreActuallyGone(t *testing.T) {
	declared := declaredTests(t)
	for name, why := range citedButGone {
		if why == "" {
			t.Errorf("citedButGone[%s] has no reason — an exemption without one is a silent hole", name)
		}
		if declared[name] {
			t.Errorf("citedButGone names %s, but that test IS declared — delete the entry", name)
		}
	}
	// And the map must not quietly become the answer for everything: it is three entries about
	// three documented deletions, not a suppression list.
	if len(citedButGone) > 8 {
		t.Fatalf("citedButGone has %d entries — an exemption list this long is a suppression list; "+
			"write the test or fix the comment instead", len(citedButGone))
	}
}
