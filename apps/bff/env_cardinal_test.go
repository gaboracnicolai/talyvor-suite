package main

// W1.1.14 — A CARDINAL IS A FALSIFIABLE CLAIM ABOUT A SET, AND THIS BFF SHIPPED ONE THAT WAS FALSE.
//
// `loadProductConfig`'s Track arm told a half-configured operator to "set all three
// (TRACK_BASE_URL, TRACK_GATEWAY_SECRET)" — a cardinal of three above a list of two. The wording
// is left over from when the trio included TRACK_WORKSPACE_ID, and the damage is not cosmetic:
// TRACK_WORKSPACE_ID is the ONE variable `main.go`'s boot refusal stops the process for. So the
// message on the way to a working Track deployment sent its reader hunting for a third variable
// that guarantees the next boot fails with a different error. Twenty lines below, the Docs arm
// says "set both (DOCS_BASE_URL, DOCS_GATEWAY_SECRET), or neither" — same shape, right cardinal.
//
// WHY THE EXISTING TEST DID NOT SEE IT: TestLoadConfigProductMatrix asserts `wantErr` as a
// SUBSTRING ("TRACK_GATEWAY_SECRET"). A substring assertion is satisfied by a message that also
// contains a false sentence, so it stayed green across the whole life of the defect. The check
// that catches this class has to read the cardinal and the list TOGETHER and compare them —
// which is what this file does, in two populations that are allowed to disagree with each other:
//
//	POPULATION A (behavioural): drive `loadProductConfig` for real and parse the string an
//	operator actually receives. Proves the shipped message is consistent, not just the source.
//	POPULATION B (source): every `set <cardinal> (<LIST>)` clause in this package's non-test
//	sources, including any that no test drives. Proves the behavioural census is not a subset
//	that quietly leaves a site uncovered.
//
// Both must be consistent, and B must also COVER A's sites — a source clause nobody drives is
// reported, and a behavioural arm that vanished from source is reported.

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// A clause reads "set both (DOCS_BASE_URL, DOCS_GATEWAY_SECRET)": a CARDINAL, and the LIST the
// cardinal is a cardinal OF. The defect is the two disagreeing.
var setClauseRE = regexp.MustCompile(`set ((?:all )?[a-z]+) \(([A-Z0-9_]+(?:, ?[A-Z0-9_]+)*)\)`)

// The cardinals a config message may plausibly use. An UNRECOGNISED word is a failure, never a
// skip: "set several (A, B)" must not pass by falling off the end of this map. That is the
// difference between a guard and a filter.
var cardinalWords = map[string]int{
	"one": 1, "a": 1, "single": 1,
	"both": 2, "two": 2, "all two": 2,
	"three": 3, "all three": 3,
	"four": 4, "all four": 4,
	"five": 5, "all five": 5,
}

type setClause struct {
	whole    string // the matched text, for the failure message
	cardinal string // "both", "all three"
	stated   int    // what the cardinal claims
	names    []string
}

// parseSetClauses finds every set-clause in s. The bool result of the CALLER's check matters more
// than this function: a message with no clause at all returns nothing, and every caller below
// treats "nothing" as a red rather than as a pass.
func parseSetClauses(s string) []setClause {
	var out []setClause
	for _, m := range setClauseRE.FindAllStringSubmatch(s, -1) {
		names := strings.Split(m[2], ",")
		for i := range names {
			names[i] = strings.TrimSpace(names[i])
		}
		out = append(out, setClause{whole: m[0], cardinal: m[1], names: names, stated: cardinalWords[m[1]]})
	}
	return out
}

func (c setClause) key() string { return strings.Join(c.names, "+") }

// ── POPULATION A: the message an operator actually receives ─────────────────────────────────

// productArms is the behavioural census: one entry per half-configured upstream that
// `loadProductConfig` can refuse for. It is deliberately hand-written, and deliberately
// CROSS-CHECKED against source below — a hand-written census that nothing compares to the
// population it claims to cover is the failure mode this queue keeps finding.
var productArms = []struct {
	name string
	// setOnly is the ONE variable of the pair that is configured; the refusal must then name the
	// other and state a cardinal of two.
	setOnly, setTo string
	clear          []string
}{
	{
		name:    "Track upstream, base URL set and secret missing",
		setOnly: "TRACK_BASE_URL", setTo: "http://127.0.0.1:8081",
		clear: []string{"TRACK_GATEWAY_SECRET", "DOCS_BASE_URL", "DOCS_GATEWAY_SECRET"},
	},
	{
		name:    "Docs upstream, base URL set and secret missing",
		setOnly: "DOCS_BASE_URL", setTo: "http://127.0.0.1:8082",
		clear: []string{"DOCS_GATEWAY_SECRET", "TRACK_BASE_URL", "TRACK_GATEWAY_SECRET"},
	},
}

// TestPartialUpstreamRefusalStatesTheRightCardinal is the red this item was written for. It fails
// on the Track arm at the parent commit and passes on the Docs arm at the same commit — the Docs
// arm IS the positive control, and it is in the same table for exactly that reason: an assertion
// that no message can satisfy would be indistinguishable from this one if only the broken arm ran.
func TestPartialUpstreamRefusalStatesTheRightCardinal(t *testing.T) {
	for _, arm := range productArms {
		t.Run(arm.name, func(t *testing.T) {
			for _, k := range arm.clear {
				t.Setenv(k, "")
			}
			t.Setenv(arm.setOnly, arm.setTo)

			_, err := loadProductConfig(config{})
			if err == nil {
				t.Fatalf("%s alone must refuse to boot (fail-closed half-pair), got nil error", arm.setOnly)
			}
			msg := err.Error()

			clauses := parseSetClauses(msg)
			if len(clauses) == 0 {
				// NOT a skip. A reworded message that no longer states its cardinal and list in a
				// readable form is precisely how this guard would go quietly inert.
				t.Fatalf("refusal states no parseable `set <cardinal> (<VARS>)` clause, so nothing "+
					"pins its cardinal any more — reword it back or teach setClauseRE the new shape.\n  got: %s", msg)
			}
			for _, c := range clauses {
				if c.stated == 0 {
					t.Errorf("cardinal %q is not a word this guard knows, so it cannot be compared "+
						"to the %d variables listed. Add it to cardinalWords or use a plain one.\n  clause: %s",
						c.cardinal, len(c.names), c.whole)
					continue
				}
				if c.stated != len(c.names) {
					t.Errorf("THE CARDINAL AND THE LIST DISAGREE: %q claims %d, the list names %d (%s).\n"+
						"  clause: %s\n  full message: %s",
						c.cardinal, c.stated, len(c.names), strings.Join(c.names, ", "), c.whole, msg)
				}
				// Every name offered must be one this binary READS. The original defect's real
				// harm was pointing at a variable the BFF refuses to boot with, so "the list is
				// the right length" is not on its own enough.
				for _, n := range c.names {
					if !bffReadsEnv(t, n) {
						t.Errorf("refusal offers %q, which this binary never reads — an operator who "+
							"sets it gets no closer to a working deployment.\n  full message: %s", n, msg)
					}
				}
			}
			// And the variable actually missing must be among the ones offered.
			missing := arm.clear[0]
			if !strings.Contains(msg, missing) {
				t.Errorf("refusal never names the missing variable %q\n  got: %s", missing, msg)
			}
		})
	}
}

// TestPartialUpstreamRefusalNamesNoRefusedVariable is the second half of the original finding:
// not "the count is wrong" but "the third one it sends you to is a boot refusal". It is stated
// separately because it would survive a repair that fixed the arithmetic and kept the name.
func TestPartialUpstreamRefusalNamesNoRefusedVariable(t *testing.T) {
	// The variables main.go refuses to START with. Read from the refusal messages themselves
	// below, not typed twice.
	refused := envNamesRefusedAtBoot(t)
	if len(refused) < 2 {
		t.Fatalf("expected at least the two known boot refusals (LENS_API_KEY, TRACK_WORKSPACE_ID), "+
			"scanner found %d %v — the scanner has gone blind, not the code clean", len(refused), refused)
	}
	for _, arm := range productArms {
		t.Run(arm.name, func(t *testing.T) {
			for _, k := range arm.clear {
				t.Setenv(k, "")
			}
			t.Setenv(arm.setOnly, arm.setTo)
			_, err := loadProductConfig(config{})
			if err == nil {
				t.Fatalf("%s alone must refuse to boot, got nil", arm.setOnly)
			}
			for _, r := range refused {
				if strings.Contains(err.Error(), r) {
					t.Errorf("the refusal an operator reads on the way to a working deployment names %q, "+
						"which main.go REFUSES TO BOOT WITH — following this message guarantees the next "+
						"boot fails with a different error.\n  got: %s", r, err.Error())
				}
			}
		})
	}
}

// ── POPULATION B: the same claim, counted in source, including sites nothing drives ─────────

// TestEverySetClauseInSourceIsConsistentAndCovered walks the package's non-test sources so a
// third upstream added later — with the same copied sentence and the same stale cardinal — is
// caught even before anyone writes a behavioural arm for it.
func TestEverySetClauseInSourceIsConsistentAndCovered(t *testing.T) {
	src := packageSourceJoined(t)

	clauses := parseSetClauses(src)
	// THE FLOOR. Two set-clauses exist in this package today (Track and Docs). If this scanner
	// ever finds fewer, the honest conclusion is that the scanner stopped working, not that the
	// code got cleaner — that inversion is the whole reason this line is here.
	//
	// Errorf, NOT Fatalf, and deliberately: a blind scanner and a drifted message are DIFFERENT
	// failures, and stopping here would hide the coverage comparison below behind the floor. The
	// control harness needs to see both at once to tell them apart.
	if len(clauses) < 2 {
		t.Errorf("found %d `set <cardinal> (<VARS>)` clauses in this package's sources; at least 2 "+
			"exist (Track and Docs). The scanner is blind, or the messages were reworded past it", len(clauses))
	}

	for _, c := range clauses {
		if c.stated == 0 {
			t.Errorf("source clause uses cardinal %q, unknown to this guard, above %d variables: %s",
				c.cardinal, len(c.names), c.whole)
			continue
		}
		if c.stated != len(c.names) {
			t.Errorf("SOURCE CLAUSE DISAGREES WITH ITSELF: %q claims %d, lists %d (%s)\n  clause: %s",
				c.cardinal, c.stated, len(c.names), strings.Join(c.names, ", "), c.whole)
		}
	}

	// Population comparison, both directions. A source clause with no behavioural arm is a site
	// whose runtime text nothing reads; a behavioural arm with no source clause means the census
	// above is describing a message that no longer exists.
	inSource := map[string]bool{}
	for _, c := range clauses {
		inSource[c.key()] = true
	}
	inBehaviour := map[string]bool{}
	for _, arm := range productArms {
		for _, k := range arm.clear {
			t.Setenv(k, "")
		}
		t.Setenv(arm.setOnly, arm.setTo)
		_, err := loadProductConfig(config{})
		if err == nil {
			t.Fatalf("%s alone must refuse to boot, got nil", arm.setOnly)
		}
		for _, c := range parseSetClauses(err.Error()) {
			inBehaviour[c.key()] = true
		}
	}
	for k := range inSource {
		if !inBehaviour[k] {
			t.Errorf("source states a set-clause for (%s) that NO arm in productArms drives — add one, "+
				"or this file's behavioural half silently covers less than it looks like it does", k)
		}
	}
	for k := range inBehaviour {
		if !inSource[k] {
			t.Errorf("productArms drives a clause for (%s) that the source scanner cannot see — the "+
				"scanner's regex and the real message have drifted apart", k)
		}
	}
}

// ── THE POSITIVE CONTROLS FOR THE PARSER ITSELF ─────────────────────────────────────────────

// TestSetClauseParserControls: the tests above are only as good as the parser, and a parser that
// matched nothing would make every one of them pass. So the parser is shown to ACCEPT the correct
// shape, REJECT the exact defect this item is about, and reject its inverse.
func TestSetClauseParserControls(t *testing.T) {
	cases := []struct {
		name        string
		msg         string
		wantClauses int
		wantStated  int
		wantListed  int
		wantConsist bool
	}{
		{
			name:        "CONTROL the shipped Docs wording, correct today",
			msg:         "Docs upstream partially configured: missing DOCS_BASE_URL — set both (DOCS_BASE_URL, DOCS_GATEWAY_SECRET), or neither",
			wantClauses: 1, wantStated: 2, wantListed: 2, wantConsist: true,
		},
		{
			name:        "CONTROL the defect verbatim — a cardinal of three above two names",
			msg:         "Track upstream partially configured: missing TRACK_GATEWAY_SECRET — set all three (TRACK_BASE_URL, TRACK_GATEWAY_SECRET), or none",
			wantClauses: 1, wantStated: 3, wantListed: 2, wantConsist: false,
		},
		{
			name:        "CONTROL the inverse — a cardinal of two above three names",
			msg:         "set both (A_ONE, B_TWO, C_THREE), or neither",
			wantClauses: 1, wantStated: 2, wantListed: 3, wantConsist: false,
		},
		{
			name:        "CONTROL the repaired wording, which is what must land",
			msg:         "Track upstream partially configured: missing TRACK_GATEWAY_SECRET — set both (TRACK_BASE_URL, TRACK_GATEWAY_SECRET), or none",
			wantClauses: 1, wantStated: 2, wantListed: 2, wantConsist: true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := parseSetClauses(tc.msg)
			if len(got) != tc.wantClauses {
				t.Fatalf("parsed %d clauses, want %d, from: %s", len(got), tc.wantClauses, tc.msg)
			}
			c := got[0]
			if c.stated != tc.wantStated {
				t.Errorf("cardinal %q read as %d, want %d", c.cardinal, c.stated, tc.wantStated)
			}
			if len(c.names) != tc.wantListed {
				t.Errorf("listed %d names %v, want %d", len(c.names), c.names, tc.wantListed)
			}
			if consistent := c.stated == len(c.names); consistent != tc.wantConsist {
				t.Errorf("consistency read as %v, want %v (%q vs %v)", consistent, tc.wantConsist, c.cardinal, c.names)
			}
		})
	}

	// And the shape that must NOT quietly parse: no clause at all. The behavioural test treats
	// this as a failure, so it has to be distinguishable here.
	if got := parseSetClauses("Track upstream partially configured: missing TRACK_GATEWAY_SECRET"); len(got) != 0 {
		t.Errorf("a message with no set-clause parsed as %d clauses, want 0 — the callers rely on "+
			"zero being reported, not smoothed over", len(got))
	}
}

// ── source helpers ──────────────────────────────────────────────────────────────────────────

// litJoinRE reassembles Go's adjacent-literal concatenation (`"a "+\n\t"b"`) so a message split
// across lines is scanned as the single string it becomes at runtime. Without this the source
// half would miss every multi-line message — which is all of them.
var litJoinRE = regexp.MustCompile(`"\s*\+\s*"`)

// packageSourceJoined is every non-test .go file in this package, concatenated, with adjacent
// string literals joined.
func packageSourceJoined(t *testing.T) string {
	t.Helper()
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatalf("glob: %v", err)
	}
	var kept []string
	var b strings.Builder
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		data, err := os.ReadFile(f)
		if err != nil {
			t.Fatalf("read %s: %v", f, err)
		}
		kept = append(kept, f)
		b.WriteString(litJoinRE.ReplaceAllString(string(data), ""))
		b.WriteString("\n")
	}
	sort.Strings(kept)
	// A glob that matched nothing would make every source assertion vacuous.
	if len(kept) < 10 {
		t.Fatalf("scanned only %d non-test sources %v — this package has far more; the scan is not "+
			"running where it thinks it is", len(kept), kept)
	}
	return b.String()
}

// bffReadsEnv answers whether this binary reads the named variable, from source rather than from
// a list somebody has to remember to update.
func bffReadsEnv(t *testing.T, name string) bool {
	t.Helper()
	src := packageSourceJoined(t)
	return strings.Contains(src, `os.Getenv("`+name+`")`) ||
		strings.Contains(src, `envOr("`+name+`"`) ||
		strings.Contains(src, `os.LookupEnv("`+name+`")`)
}

// bootRefusalRE finds the guards shaped `if os.Getenv("X") != "" { return cfg, errors.New(...)` —
// the variables whose mere presence stops the boot.
var bootRefusalRE = regexp.MustCompile(`os\.Getenv\("([A-Z0-9_]+)"\) != "" \{\s*\n\s*return cfg, errors\.New`)

func envNamesRefusedAtBoot(t *testing.T) []string {
	t.Helper()
	data, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatalf("read main.go: %v", err)
	}
	var out []string
	for _, m := range bootRefusalRE.FindAllStringSubmatch(string(data), -1) {
		out = append(out, m[1])
	}
	sort.Strings(out)
	return out
}
