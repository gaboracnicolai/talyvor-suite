package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// govulncheck_gate_test.go — the supply-chain gate exists, it is a JOB rather than a word, and it
// grades the stdlib this repo SHIPS rather than one it does not.
//
// ⚠ THE NUMBERS THIS FILE EXISTS TO HOLD DOWN, MEASURED IN CI RATHER THAN ON A LAPTOP (W6.36).
// Before the gate, ci.yml contained the word govulncheck zero times and apps/bff/go.mod had no
// `toolchain` directive, so `go-version-file` resolved the `go 1.25.0` line and setup-go installed
// EXACTLY go1.25.0. The first run of the vuln job reported, in its own output:
//
//	GOTOOLCHAIN='local'   GOVERSION='go1.25.0'
//	Your code is affected by 32 vulnerabilities from the Go standard library.
//
// ⚠⚠ AND THE SAME COMMAND ON THE DEVELOPER MACHINE THAT FILED W6.36 SAID **NINE**. Not a smaller
// estimate of the same quantity — a measurement of a DIFFERENT RUNTIME, because with no directive
// here and GOTOOLCHAIN=auto a laptop grades whatever Go it happens to have (go1.26.3 there). The
// local number was wrong by 3.5× in the reassuring direction and nothing said so. That is the
// whole reason the two assertions below are about WHERE the version comes from and not just about
// whether a scan happens.
type gateFacts struct {
	job         string // the ci.yml job whose steps invoke govulncheck over the module
	jobsSeen    int
	fromGoMod   bool // that job takes its Go version from go.mod
	literalPins int  // ...and how many literal `go-version:` pins it carries instead
}

var (
	govulncheckInvokeRe = regexp.MustCompile(`govulncheck["']?\s+\./\.\.\.`)
	jobHeaderRe         = regexp.MustCompile(`^  ([A-Za-z_][A-Za-z0-9_-]*):\s*$`)
	goVersionFileRe     = regexp.MustCompile(`go-version-file:\s*\S`)
	goVersionLiteralRe  = regexp.MustCompile(`go-version:\s*["']?\d`)
	toolchainRe         = regexp.MustCompile(`(?m)^toolchain go(\d+)\.(\d+)\.(\d+)$`)
)

// ⚠ COMMENTS ARE STRIPPED BEFORE ANYTHING IS MATCHED, AND THAT IS NOT FUSSINESS. The word
// "govulncheck" already appears in this repo's PROSE — in go.mod's floor rationale, in this
// comment, and in ci.yml's own job header. A guard that grepped the raw file would stay GREEN over
// a ci.yml whose vuln job had been DELETED and whose comment survived, which is the
// "documented but not wired" shape this queue keeps catching. ⚠ THE DIRECTION OF THIS FUNCTION'S
// ERRORS IS DELIBERATE: a literal " # " inside a genuine command is truncated here and the gate
// reported MISSING — a false RED. A guard that fails loudly on an odd line is recoverable; one
// that passes on a comment is the defect being prevented.
func stripComment(line string) string {
	if strings.HasPrefix(strings.TrimLeft(line, " \t"), "#") {
		return ""
	}
	if i := strings.Index(line, " # "); i >= 0 {
		return line[:i]
	}
	return line
}

func readGate(src string) gateFacts {
	var f gateFacts
	byJob := map[string][]string{}
	var current string
	// ⚠ ONLY COUNT KEYS UNDER `jobs:`. A two-space key is not a job by itself — `on:` has
	// `push:` and `pull_request:` at exactly that indent, and an earlier draft of this parse
	// counted them, so it reported "4 jobs" for a file with three and would have reported a
	// non-zero count for a file with NO jobs block at all. That is the non-vacuity check
	// lying in the reassuring direction, which is the one failure this file may not have.
	inJobs := false
	for _, raw := range strings.Split(src, "\n") {
		line := stripComment(raw)
		if strings.HasPrefix(line, "jobs:") {
			inJobs = true
			continue
		}
		if line != "" && !strings.HasPrefix(line, " ") && !strings.HasPrefix(line, "#") {
			inJobs = false // a new top-level key ends the jobs block
		}
		if !inJobs {
			continue
		}
		if m := jobHeaderRe.FindStringSubmatch(line); m != nil {
			current = m[1]
			f.jobsSeen++
			continue
		}
		if current != "" {
			byJob[current] = append(byJob[current], line)
		}
	}
	for job, lines := range byJob {
		for _, line := range lines {
			if govulncheckInvokeRe.MatchString(line) {
				f.job = job
				break
			}
		}
		if f.job != "" {
			for _, line := range lines {
				if goVersionFileRe.MatchString(line) {
					f.fromGoMod = true
				}
				if goVersionLiteralRe.MatchString(line) {
					f.literalPins++
				}
			}
			break
		}
		_ = job
	}
	return f
}

func ciYML(t *testing.T) string {
	t.Helper()
	root, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatalf("resolve root: %v", err)
	}
	b, err := os.ReadFile(filepath.Join(root, ".github", "workflows", "ci.yml"))
	if err != nil {
		t.Fatalf("read ci.yml: %v", err)
	}
	return string(b)
}

func TestCIGatesOnGovulncheck(t *testing.T) {
	f := readGate(ciYML(t))

	// ⚠ NON-VACUITY. A parse that finds no jobs satisfies "no job is missing a gate" and satisfies
	// nothing else. Report a broken instrument as broken rather than as a pass.
	if f.jobsSeen == 0 {
		t.Fatal("parsed ZERO top-level jobs out of ci.yml — the parse is broken, and a broken " +
			"parse cannot see a missing gate either")
	}
	if f.job == "" {
		t.Fatalf("NO job in ci.yml runs `govulncheck ./...` (%d job(s) parsed).\n"+
			"apps/bff carried 32 CALLED stdlib vulnerabilities precisely because no CI job would "+
			"ever say so (W6.36). If the gate is being removed on purpose, remove this test in the "+
			"same commit and say what replaces it.", f.jobsSeen)
	}
	t.Logf("MEASURED: %d job(s) in ci.yml; %q invokes govulncheck over the module.", f.jobsSeen, f.job)
}

// ⚠ THE ASSERTION THAT IS SPECIFIC TO THIS REPO, AND IT IS THE ONE THE 9-VERSUS-32 SPLIT ARGUES
// FOR. govulncheck grades the STDLIB against the toolchain it runs under, so a gate that installs
// Go from a literal pin is measuring whatever that literal says — which is a SECOND version number
// that can drift from go.mod, silently, in the direction of grading a runtime nobody ships.
// talyvor-lens needs a whole package (internal/toolchainguard) and talyvor-track a dedicated test
// to hold their literal pins in lockstep. Deriving the version from go.mod removes the failure
// mode instead of detecting it, and this test is what keeps it derived.
func TestTheGateGradesTheGoThisRepoShips(t *testing.T) {
	f := readGate(ciYML(t))
	if f.job == "" {
		t.Skip("no gate at all — TestCIGatesOnGovulncheck reports that")
	}
	if !f.fromGoMod {
		t.Errorf("ci.yml job %q runs govulncheck but does NOT take its Go version from go.mod "+
			"(`go-version-file:`). It is grading whatever a literal pin says, which is a second "+
			"number that can drift from what this module ships.", f.job)
	}
	if f.literalPins > 0 {
		t.Errorf("ci.yml job %q carries %d literal `go-version:` pin(s) as well as/instead of "+
			"go-version-file. Two sources of truth for the graded stdlib is exactly the drift this "+
			"avoids.", f.job, f.literalPins)
	}

	// And the floor itself: with no `toolchain` directive, `go-version-file` resolves the bare
	// `go` line and CI installs that exact patch — which is how go1.25.0 and its 32 called
	// vulnerabilities were shipped.
	root, _ := filepath.Abs(filepath.Join("..", ".."))
	b, err := os.ReadFile(filepath.Join(root, "apps", "bff", "go.mod"))
	if err != nil {
		t.Fatalf("read go.mod: %v", err)
	}
	if toolchainRe.FindStringSubmatch(string(b)) == nil {
		t.Error("apps/bff/go.mod has no `toolchain goX.Y.Z` directive. `go-version-file` then " +
			"resolves the bare `go` line, and CI installs that exact patch: measured in CI, that " +
			"meant GOVERSION=go1.25.0 and 32 CALLED stdlib vulnerabilities in the binary " +
			"scripts/build-release.sh ships.")
	}
}

// ⚠ THE POSITIVE CONTROL, IN THE FILE RATHER THAN IN A SESSION'S SCROLLBACK. Three sessions on
// this queue shipped guards that could not fail and every one was caught by a control like this.
// It runs the SAME parse the assertions above run, against mutated copies of the REAL ci.yml.
func TestTheGovulncheckGateGuardCanFail(t *testing.T) {
	real := ciYML(t)
	if readGate(real).job == "" {
		t.Fatal("the unmutated ci.yml already has no gate — this control cannot distinguish a " +
			"working guard from a broken one until that is fixed")
	}

	// (1) The invocation deleted outright.
	var kept []string
	for _, line := range strings.Split(real, "\n") {
		if govulncheckInvokeRe.MatchString(line) {
			continue
		}
		kept = append(kept, line)
	}
	deleted := strings.Join(kept, "\n")
	if job := readGate(deleted).job; job != "" {
		t.Errorf("MUTANT SURVIVED: the invocation was deleted and the guard still found job %q", job)
	}

	// (2) The gate gone, the PROSE left behind as a whole comment line — what a grep would pass.
	var mention []string
	for _, line := range strings.Split(real, "\n") {
		if govulncheckInvokeRe.MatchString(line) {
			mention = append(mention, "          # govulncheck ./... — removed, see PR")
			continue
		}
		mention = append(mention, line)
	}
	commented := strings.Join(mention, "\n")
	if !strings.Contains(commented, "govulncheck") {
		t.Fatal("the mention-only mutant does not mention govulncheck — the mutation is wrong, not the guard")
	}
	if job := readGate(commented).job; job != "" {
		t.Errorf("MUTANT SURVIVED: only a COMMENT names govulncheck and the guard reported job %q "+
			"— it is matching prose", job)
	}

	// (3) The same through the TRAILING-comment syntax, which is what pins stripComment's second rule.
	trailing := strings.Replace(deleted, "      - run: go vet ./...",
		"      - run: go vet ./... # govulncheck ./... used to run here", 1)
	if !strings.Contains(trailing, "govulncheck ./...") {
		t.Fatal("the trailing-comment mutant does not carry the mention — the mutation is wrong, not the guard")
	}
	if job := readGate(trailing).job; job != "" {
		t.Errorf("MUTANT SURVIVED: govulncheck is named only in a TRAILING comment and the guard "+
			"reported job %q", job)
	}

	// (4a) THE NON-VACUITY COUNTER ITSELF. `on:` carries `push:` at the same two-space indent a
	// job uses, so a parse that does not scope to the `jobs:` block counts them — an earlier draft
	// did, reporting four jobs for a three-job file. Strip the jobs block entirely: the count must
	// go to ZERO, not to "however many keys happen to be indented two spaces".
	var noJobs []string
	inJobs := false
	for _, line := range strings.Split(real, "\n") {
		if strings.HasPrefix(line, "jobs:") {
			inJobs = true
			continue
		}
		if inJobs && line != "" && !strings.HasPrefix(line, " ") && !strings.HasPrefix(line, "#") {
			inJobs = false
		}
		if !inJobs {
			noJobs = append(noJobs, line)
		}
	}
	if n := readGate(strings.Join(noJobs, "\n")).jobsSeen; n != 0 {
		t.Errorf("MUTANT SURVIVED: the whole `jobs:` block was removed and the parse still counted "+
			"%d job(s) — the non-vacuity check is reading something that is not a job", n)
	}

	// (4) The tool installed but never run over the module — `go install` is not a scan.
	if job := readGate(govulncheckInvokeRe.ReplaceAllString(real, "govulncheck --help")).job; job != "" {
		t.Errorf("MUTANT SURVIVED: nothing scans the module and the guard reported job %q", job)
	}

	// (5) The gate present but pinned to a LITERAL version — green scan, drifting source of truth.
	literal := strings.Replace(real,
		"          go-version-file: apps/bff/go.mod\n          cache-dependency-path: apps/bff/go.sum\n      - name: report the Go this job actually runs",
		"          go-version: \"1.26.6\"\n      - name: report the Go this job actually runs", 1)
	f := readGate(literal)
	if f.job == "" {
		t.Fatal("the literal-pin mutant lost the gate entirely — the mutation is wrong, not the guard")
	}
	if f.fromGoMod || f.literalPins == 0 {
		t.Errorf("MUTANT SURVIVED: the vuln job was repinned to a literal go-version and the guard "+
			"still read fromGoMod=%v literalPins=%d", f.fromGoMod, f.literalPins)
	}
}
