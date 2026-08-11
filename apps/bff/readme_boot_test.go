package main

import (
	"os"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// THE README'S RUN BLOCK IS EXECUTED, NOT READ.
//
// apps/bff/README.md prints a copy-pasteable command. A developer's first contact with this
// binary is pasting it. MEASURED at a5487cd, with every variable the binary reads cleared first
// and exactly that block applied:
//
//	bff: LENS_PROVISION_SECRET is required (each signed-in person is provisioned their own Lens
//	workspace); refusing to start                                                      # exit 1
//
// and with that one added, the next refusal:
//
//	bff: BFF_AUTH_MODE="": must be "oidc" … or "disabled" … There is no default       # exit 1
//
// Two variables the block never names stand between it and a running process — while two it DOES
// name, LENS_WORKSPACE_KEY and LENS_WORKSPACE_ID, are read by nobody (per-user provisioning, #30,
// replaced the one pinned workspace). The document was describing the binary from before that
// change, and nothing could tell: a README is not on any execution path.
//
// It is on one now. These two tests take the document as the fixture — the command's own text is
// the input, so the assertion cannot drift from what a reader would paste.
//
// WHY loadConfig IS THE RIGHT GATE, measured rather than assumed: every refusal the BFF makes at
// startup is made in loadConfig. Booting the shipped deploy/bff.env.example with a WEB_DIST that
// does not exist prints "WARNING web bundle not found … API works" and keeps running — so a
// missing bundle is not a startup failure and asserting through loadConfig is not weaker than
// asserting through the process. What is NOT proven here: that the app then SERVES anything.
//
// WHAT THIS DOES NOT COVER, so the next reader does not over-trust it:
//   - deploy/README.md and deploy/bff.env.example are OUT of scope. bff.env.example deliberately
//     keeps LENS_WORKSPACE_KEY / LENS_WORKSPACE_ID as live lines — its own header says why (an
//     older binary refuses to start without them, so one file boots either one and the documented
//     rollback stays a binary swap). Both files were measured at a5487cd: the example file's 13
//     active assignments boot this binary. A rule that flagged its two inert lines would be
//     wrong about the only file where they are deliberate.
//   - Prose is not checked. "GET only (else 405)" was false in this file for six increments and
//     no env-shaped rule can see a sentence.
//
// The forward direction — every variable the binary READS is named where an operator looks — is
// TestEveryEnvVarTheBinaryReadsIsDocumented in env_documented_test.go, which states in its own
// comment that it cannot see this inverse class. This is that class.

// readmeRunBlock returns the assignments of the fenced block that ends in `go run .`, in file
// order. Finding no block, or a block with nothing in it, is a FAILURE: a parser that returns
// nothing would boot a cleared environment and call the emptiness a passing README.
func readmeRunBlock(t *testing.T) ([]string, map[string]string) {
	t.Helper()
	body := readBFFReadme(t)

	fence := regexp.MustCompile("(?s)```(?:bash|sh)?\n(.*?)```")
	assign := regexp.MustCompile(`^([A-Z][A-Z0-9_]*)=(.*)$`)
	for _, m := range fence.FindAllStringSubmatch(body, -1) {
		block := m[1]
		if !strings.Contains(block, "go run .") {
			continue // not the Run block; the README fences other things
		}
		var names []string
		env := map[string]string{}
		for _, line := range strings.Split(block, "\n") {
			line = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(line), `\`))
			sm := assign.FindStringSubmatch(line)
			if sm == nil {
				continue
			}
			names = append(names, sm[1])
			env[sm[1]] = strings.TrimSpace(sm[2])
		}
		if len(names) < 3 {
			t.Fatalf("the Run block parsed to %d assignments (%v) — the parser is broken, not the "+
				"README; a block that parses to nothing boots a cleared environment and reads green", len(names), names)
		}
		return names, env
	}
	t.Fatalf("no fenced block containing `go run .` in %s — this test exists to execute that block "+
		"and would otherwise assert nothing at all", bffReadmePath)
	return nil, nil
}

const bffReadmePath = "README.md"

func readBFFReadme(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile(bffReadmePath)
	if err != nil {
		t.Fatalf("read %s: %v", bffReadmePath, err)
	}
	return string(b)
}

// envVarsReadByBinaryChecked is envVarsReadByBinary plus the floor its own caller applies. The
// extractor is shared on purpose — one predicate spelled once — but the floor is NOT inherited by
// import: it lives in TestEveryEnvVarTheBinaryReadsIsDocumented's body, so a test that reused the
// extractor alone would accept an empty read set and pass for every possible repository.
func envVarsReadByBinaryChecked(t *testing.T) map[string]bool {
	t.Helper()
	read := envVarsReadByBinary(t)
	if len(read) < 15 {
		t.Fatalf("only %d env vars extracted (%v) — the extractor is broken, not the config surface",
			len(read), read)
	}
	set := map[string]bool{}
	for _, n := range read {
		set[n] = true
	}
	return set
}

// TestReadmeRunBlockStartsTheBinary pastes the README's command into loadConfig.
func TestReadmeRunBlockStartsTheBinary(t *testing.T) {
	names, env := readmeRunBlock(t)

	// Clear from the SOURCE-DERIVED set, not from a list written here: a variable added to the
	// binary tomorrow must be cleared tomorrow, or an ambient value in a developer's shell would
	// decide whether the documented command boots.
	for name := range envVarsReadByBinaryChecked(t) {
		t.Setenv(name, "")
	}
	for _, name := range names {
		t.Setenv(name, env[name])
	}

	if _, err := loadConfig(); err != nil {
		t.Fatalf("the Run block in %s does not start this binary:\n\n  %v\n\n"+
			"The block sets %v. A developer's first contact with the BFF is pasting that command; "+
			"a refusal naming a variable the document never mentions is the document being wrong "+
			"about the binary, not the reader being careless.", bffReadmePath, err, names)
	}
}

// TestReadmeNamesNoVariableTheBinaryIgnores is the inverse of env_documented_test.go: not "is
// every read variable documented" but "is every documented variable read". A name presented as
// configuration that nothing reads is worse than a missing one — it is followed.
func TestReadmeNamesNoVariableTheBinaryIgnores(t *testing.T) {
	read := envVarsReadByBinaryChecked(t)
	body := readBFFReadme(t)

	presented := map[string]string{} // name -> where it was presented
	names, _ := readmeRunBlock(t)
	for _, n := range names {
		presented[n] = "the Run block"
	}
	// Table rows: `| `NAME` | default | note |` — the leading cell only, so a variable merely
	// mentioned in a note is not treated as a row of the table.
	row := regexp.MustCompile("(?m)^\\|\\s*`([A-Z][A-Z0-9_]*)`\\s*\\|")
	for _, m := range row.FindAllStringSubmatch(body, -1) {
		// Accumulate rather than first-wins: a variable in BOTH places must be reported in both,
		// or fixing one and re-running would surface the other as if it were a new defect.
		if where, ok := presented[m[1]]; ok {
			presented[m[1]] = where + " and the Env table"
		} else {
			presented[m[1]] = "the Env table"
		}
	}
	if len(presented) < 3 {
		t.Fatalf("only %d variables extracted from %s (%v) — the extractor is broken, not the "+
			"README; nothing presented means nothing checked", len(presented), bffReadmePath, presented)
	}

	var ignored []string
	for name, where := range presented {
		if !read[name] {
			ignored = append(ignored, name+" ("+where+")")
		}
	}
	sort.Strings(ignored)
	if len(ignored) > 0 {
		t.Errorf("%s presents %d variable(s) this binary never reads: %s\n"+
			"No os.Getenv/envOr call in any non-test file takes those names, so setting them does "+
			"nothing and a reader who goes looking for a value is looking for something that cannot "+
			"exist. Read set (%d): %v", bffReadmePath, len(ignored), strings.Join(ignored, ", "),
			len(read), sortedKeys(read))
	}
}

func sortedKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
