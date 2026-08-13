package main

// EVERY CROSS-REPO LINE CITATION IN THIS GO TREE WAS ALREADY FALSE, AND THE ONE GUARD THIS
// REPOSITORY HAS FOR THAT DECAY CANNOT SEE THIS TREE.
//
// `apps/web/src/upstreamCitations.test.ts` was written for exactly this failure: a comment that
// cites another repository by LINE becomes false with no commit here touching it, so there is no
// review that catches it and no local test that can fail for it. That guard walks two roots —
// `apps/web/src` and `packages/ui/src`. `apps/bff` is in NEITHER, so the Go tree has carried the
// same claims with no instrument at all. Its header does discuss Go citations, but only the ones
// naming a file IN THIS REPOSITORY (verifiable from here, deliberately out of its rule); the ones
// naming ANOTHER repository were never in its population, because its walk cannot reach them.
//
// ── WHAT WAS MEASURED (read-only, before a line was written) ─────────────────────────────
//
// A whole-tree census of this directory returns THREE file:line citations. All three name another
// repository. All three are false TODAY:
//
//	track_tenant_test.go   → talyvor-track internal/issue/handler.go, line 302.
//	                         `Handler.Update` (the map[string]any decode the comment rests on) is
//	                         at 333/335 at track 2e60259. Line 302 is `offset` query parsing
//	                         inside List — a DIFFERENT function, doing something unrelated.
//	docs_pagelist_offset_test.go → talyvor-docs internal/page/store.go, lines 112 and 363.
//	                         `PageFilter.Offset` is at 129 and the LIMIT/OFFSET bind in
//	                         `Store.List` is at 457 at docs b3a7d52. Line 112 today sits inside a
//	                         comment about ParentID; 363 inside `maxVersionAttempts`.
//
// ⚠ AND IN ALL THREE THE UNDERLYING FACT IS STILL TRUE — WHICH IS WHAT MAKES THIS A TRAP RATHER
// THAN A VISIBLE BREAK. Re-measured upstream: track's Update still decodes map[string]any, and
// docs' `PageFilter.Offset` still has no writer (the whole-repo census the offset comment
// describes still returns its three hits — the declaration, the bind, and one unrelated search
// test). A reader who follows the citation to CHECK the premise lands on unrelated code and has
// every reason to conclude the premise is dead. On the docs route that reader's next move is to
// "restore" the offset forwarding this BFF deliberately refuses, which puts back a second page
// that silently answers with the first.
//
// ── WHAT THIS GUARD CLAIMS, PRECISELY ────────────────────────────────────────────────────
//
// For every file:line citation of a .go file in this directory: the cited file must EXIST in this
// repository, and the cited line must be within it. It follows that a citation whose file lives
// in another repository fails — not because the number is wrong (nothing here can know that) but
// because the FORM is unverifiable from here. A symbol survives an upstream edit and can be
// grepped; a line cannot. That is the same conclusion upstreamCitations.test.ts reached for the
// TypeScript tree, enforced now for the tree it does not walk.
//
// It does NOT claim the symbol names in those comments are right. That premise still lives in
// another repository and this file cannot check it.
//
// ⚠ THERE IS NO SELF-EXEMPTION, WHICH IS WHY THIS BLOCK NAMES POSITIONS IN WORDS. Excluding the
// guard's own file would leave exactly one file in the tree unswept — and it would be the file
// whose author is most likely to write an example citation. So the rule runs over this file too,
// and the prose above says "line 302" rather than writing the form out.
//
// ⚠ THE SAME-REPO BRANCH IS EMPTY IN THE LIVE TREE AND THAT IS STATED SO A PASS IS NOT READ AS
// COVERAGE: today every citation here is cross-repo, so only the refusing branch fires on real
// input. TestGoLineCitation_ResolverSeesBothOutcomes drives the resolver directly with synthetic
// inputs so neither branch is vacuous, and so a resolver that answered "unresolvable" to
// EVERYTHING — which would make the sweep above pass for the wrong reason — reds.

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// goLineCitation matches a citation of a Go file by line: a path ending in .go, a colon, digits.
// `//go:build` cannot match — that has no dot before `go`.
var goLineCitation = regexp.MustCompile(`([A-Za-z0-9_./-]+\.go):(\d+)`)

// citationVerdict is what this repository can say about one citation.
type citationVerdict int

const (
	// citationOK — the cited file is in this repository and the cited line is within it.
	citationOK citationVerdict = iota
	// citationOutOfRange — the file is here, so the claim IS checkable, and it is wrong.
	citationOutOfRange
	// citationUnresolvable — the file is not in this repository, so no line can be checked and
	// the citation decays silently. Refused as a form.
	citationUnresolvable
)

// classifyGoCitation resolves a cited path against this repository and judges the line.
//
// lineCount returns the number of lines in a repo file and whether it exists — injected so the
// resolver can be driven with synthetic inputs that do not depend on today's tree.
func classifyGoCitation(path string, line int, lineCount func(string) (int, bool)) citationVerdict {
	n, ok := lineCount(path)
	if !ok {
		// Try the basename: a comment may cite `keys.go` for a file that sits beside it.
		if base := filepath.Base(path); base != path {
			n, ok = lineCount(base)
		}
	}
	if !ok {
		return citationUnresolvable
	}
	if line < 1 || line > n {
		return citationOutOfRange
	}
	return citationOK
}

// bffFileLines counts the lines of a file in THIS directory, reporting whether it exists here.
func bffFileLines(path string) (int, bool) {
	if strings.Contains(path, "..") {
		return 0, false
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return 0, false
	}
	return strings.Count(string(b), "\n") + 1, true
}

// goSourcesHere is every .go file in this directory, sorted. The guard's population.
func goSourcesHere(t *testing.T) []string {
	t.Helper()
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("read package dir: %v", err)
	}
	var out []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".go") {
			out = append(out, e.Name())
		}
	}
	sort.Strings(out)
	return out
}

// TestNoUncheckableGoLineCitation — the sweep.
func TestNoUncheckableGoLineCitation(t *testing.T) {
	files := goSourcesHere(t)

	// A FLOOR ON THE POPULATION, as a literal. This is an ABSENCE sweep: it passes by finding
	// nothing, so a walk that read nothing would pass loudest of all. 40 is under today's count
	// with room to delete, and it fails BEFORE the rule so a broken walk blames itself rather
	// than reporting a clean tree.
	if len(files) < 40 {
		t.Fatalf("scanned %d .go files in this package, want at least 40 — the walk is reading the "+
			"wrong directory, and an absence sweep over an empty population passes for free", len(files))
	}
	// AND AN ANCHOR: a rename cannot empty the population one file at a time without this
	// noticing that the file the money path lives in stopped being read.
	anchors := 0
	for _, f := range files {
		switch f {
		case "billing.go", "lens.go", "track_tenant_test.go", "docs_pagelist_offset_test.go",
			"cited_lines_test.go":
			anchors++
		}
	}
	if anchors != 5 {
		t.Fatalf("anchor files present = %d, want 5 (billing.go, lens.go, track_tenant_test.go, "+
			"docs_pagelist_offset_test.go, cited_lines_test.go) — the population is not what this "+
			"rule was measured over, INCLUDING this file: there is no self-exemption", anchors)
	}

	var bad []string
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatalf("read %s: %v", f, err)
		}
		text := string(b)
		for _, m := range goLineCitation.FindAllStringSubmatchIndex(text, -1) {
			cited := text[m[2]:m[3]]
			lineStr := text[m[4]:m[5]]
			n, err := strconv.Atoi(lineStr)
			if err != nil {
				continue
			}
			at := 1 + strings.Count(text[:m[0]], "\n")
			switch classifyGoCitation(cited, n, bffFileLines) {
			case citationUnresolvable:
				bad = append(bad, fmt.Sprintf(
					"%s:%d cites %s line %d — that file is not in this repository, so no review "+
						"and no test here can tell whether the number is still true. Cite the SYMBOL "+
						"(%s#Name): it survives an upstream edit and can be grepped.",
					f, at, cited, n, cited))
			case citationOutOfRange:
				have, _ := bffFileLines(cited)
				bad = append(bad, fmt.Sprintf(
					"%s:%d cites %s line %d, but that file has %d lines",
					f, at, cited, n, have))
			}
		}
	}
	if len(bad) > 0 {
		t.Fatalf("%d unverifiable or wrong Go line citation(s):\n  %s",
			len(bad), strings.Join(bad, "\n  "))
	}
}

// TestGoLineCitation_ResolverSeesBothOutcomes drives the resolver directly, because the live tree
// exercises only its refusing branch. A resolver that answered "unresolvable" to everything would
// make the sweep above pass for the wrong reason and this reds for it.
func TestGoLineCitation_ResolverSeesBothOutcomes(t *testing.T) {
	// A file that IS here, with a line that is really in it, must be accepted.
	if got := classifyGoCitation("billing.go", 1, bffFileLines); got != citationOK {
		t.Fatalf("a real line of a real file in this repo classified %v, want citationOK — the "+
			"resolver cannot see this tree, so the sweep's silence means nothing", got)
	}
	// The same file, past its end, is a claim this repository CAN falsify.
	n, ok := bffFileLines("billing.go")
	if !ok {
		t.Fatal("billing.go unreadable from the package dir")
	}
	if got := classifyGoCitation("billing.go", n+1000, bffFileLines); got != citationOutOfRange {
		t.Fatalf("a line past the end of billing.go classified %v, want citationOutOfRange", got)
	}
	// A path in another repository has no checkable line.
	if got := classifyGoCitation("internal/issue/handler.go", 302, bffFileLines); got != citationUnresolvable {
		t.Fatalf("an upstream path classified %v, want citationUnresolvable", got)
	}
	// A basename that exists here resolves even when cited with a directory that does not.
	if got := classifyGoCitation("apps/bff/billing.go", 1, bffFileLines); got != citationOK {
		t.Fatalf("a repo-rooted path to a file beside this one classified %v, want citationOK", got)
	}
}
