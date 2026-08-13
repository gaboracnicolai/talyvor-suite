package main

// A DOC COMMENT THAT OPENS WITH A SYMBOL NAME IS A CLAIM ABOUT WHAT IT DOCUMENTS, AND ONE OF
// THEM NAMED A FUNCTION THIS PACKAGE HAS NEVER HAD.
//
// Go's own convention is that a declaration's doc comment starts with the name of the thing it
// documents, and this package follows it 395 times. That convention is what makes a rename
// dangerous: `git grep pathsFor` in this tree returned exactly one line — the COMMENT above
// `func (u *tenantUpstream) pathsSince`. The function was renamed and its first word was not.
// Nothing failed, because nothing in Go's toolchain reads that first word: `go vet` checks the
// doc-comment convention for nothing, and 237 tests passed with a comment documenting an absent
// symbol. A reader who greps the name they were handed finds a comment and no code.
//
// ── WHY THIS RULE AND NOT THE OBVIOUS WIDER ONE ──────────────────────────────────────────
//
// The wider rule — "a camelCase identifier named anywhere in a comment must be declared in this
// package" — was MEASURED by an earlier session and is dead: 297 such identifiers in this
// package's comments, 32 unresolved, and most of the 32 are honest (`allowedTopUps`,
// `ensureCustomer`, `workspaceAuthorized` are Lens symbols; `lensCostForLXC`, `tooExpensive`,
// `stampBuild` are web ones). A comment is allowed to name another repository's code.
//
// The narrowing that makes it a guard is POSITION: the FIRST word of a doc comment attached to a
// declaration is not a mention, it is a subject. Go's convention says it names the declaration
// below it. Measured over this package with the guard's own instrument (`go test -v` prints it):
// 49 files, 929 declared names, population 395, exactly ONE red, and NO allowlist.
//
// ── WHAT IT CLAIMS, PRECISELY ────────────────────────────────────────────────────────────
//
// For every doc comment attached to a func, type, const, var or struct field, whose first word
// is identifier-shaped: that word must name something DECLARED in this package.
//
// It is deliberately weaker than "must name the declaration it sits on". A doc comment may open
// with a sibling's name for a good reason ("app owns the mux; lensProxy hangs off it"), and
// demanding a self-name would need an allowlist of those — prose again. The one thing that is
// mechanical, and that the defect failed, is that the word must name SOMETHING here. A rename
// that leaves a doc comment behind fails it; a comment that opens with a real sibling passes.
//
// ⚠ WHAT IT DOES NOT CATCH, SAID PLAINLY SO A PASS IS NOT OVER-READ. It cannot see a doc comment
// whose subject was renamed to another name that also exists — the word still resolves. It does
// not read the SENTENCE, so "pathsSince returns the workspace id" would pass. And it is not the
// instrument for the defect class that opened this thread (#59 deleted a wire field and left its
// documentation behind): that block documented a MAP KEY, which is not a declaration, so it is
// out of this population by construction. `apps/web/src/danglingClaimAudit.test.ts` is the guard
// for the TypeScript half of that class; this file is not a Go port of it.
//
// ⚠ IT RUNS OVER ITS OWN FILE. Excluding the guard's own source would leave unswept exactly the
// file whose author is most likely to write an example — so the prose above names `pathsFor` and
// `pathsSince` in running text, never as the first word of a doc comment.
//
// ⚠ THIS GUARD WENT RED ON THE FIRST RUN, on the defect described above, which is the only
// reason it is not merely plausible. Both directions are still driven at it — by
// TestDocSubject_ClassifierSeesBothOutcomes here (the classifier, on synthetic input, so neither
// branch is vacuous once the live red is fixed) and by scripts/w11-doc-subject-controls.py
// (the whole guard, against the real tree). The floors below are literals taken from a count,
// never a count compared against itself: a walk that reads nothing must fail, not pass.

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"regexp"
	"sort"
	"strings"
	"testing"
)

var (
	// docFirstWord takes the first word of a doc comment, ignoring a leading backquote —
	// `pathsSince` and pathsSince are the same claim.
	docFirstWord = regexp.MustCompile("^`?([A-Za-z_][A-Za-z0-9_]*)")

	// identifierShaped is the population filter: a camelCase word — an interior capital AND at
	// least one lowercase letter. "returns" and "the" have no capital; "THE", "RULE" and "EVERY"
	// have no lowercase and are how this package opens a shouting section header, not a subject.
	// "pathsFor" and "lensWorkspacePath" are identifier-shaped.
	//
	// ⚠ AND THE EXAMPLES HERE ARE NOT TEST NAMES ON PURPOSE. The first draft illustrated the shape
	// with a `Test…`-shaped word, and cited_guard_test.go's TestEveryCitedTestExists went red on
	// it — correctly: a comment naming a test that is declared nowhere is exactly what that guard
	// is for, and an example is still a claim. The two guards compose; neither was loosened.
	//
	// ⚠ THE ALL-CAPS EXCLUSION IS NOT COSMETIC AND IT IS WHY THIS COMMENT EXISTS. The first draft
	// of this regex required only an interior capital; run against the tree it produced NINE reds
	// — "THE", "RULE", "EVERY", "NO", "WHY", "AND", "TWO" — beside the one real defect. Nine
	// false reds is how a guard gets an allowlist and stops being a guard.
	identifierShaped = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*$`)

	// hasLower is the second half of identifier-shaped, kept separate because a regexp cannot
	// express "contains a capital AND a lowercase" without repeating the alternation.
	hasLower = regexp.MustCompile(`[a-z]`)
)

// docSubject is one doc comment's opening claim.
type docSubject struct {
	file     string
	line     int
	word     string
	declKind string
	declares []string
}

// isIdentifierShaped answers whether a doc comment's opening word is a symbol name rather than
// prose: an interior capital, and at least one lowercase letter so an ALL-CAPS section header is
// not mistaken for one.
func isIdentifierShaped(word string) bool {
	return identifierShaped.MatchString(word) && hasLower.MatchString(word)
}

// packageDeclaredNames is every name this package declares: funcs, types, consts, vars and
// struct fields. Fields are included because a field's doc comment is in the population and its
// sibling fields are the names it may legitimately open with.
func packageDeclaredNames(files map[string]*ast.File) map[string]bool {
	out := map[string]bool{}
	for _, f := range files {
		ast.Inspect(f, func(n ast.Node) bool {
			switch d := n.(type) {
			case *ast.FuncDecl:
				out[d.Name.Name] = true
			case *ast.TypeSpec:
				out[d.Name.Name] = true
			case *ast.ValueSpec:
				for _, id := range d.Names {
					out[id.Name] = true
				}
			case *ast.Field:
				for _, id := range d.Names {
					out[id.Name] = true
				}
			}
			return true
		})
	}
	return out
}

// parsePackage parses every .go file in this directory with comments attached.
func parsePackage(t *testing.T) (*token.FileSet, map[string]*ast.File) {
	t.Helper()
	ents, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	fset := token.NewFileSet()
	files := map[string]*ast.File{}
	for _, e := range ents {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".go") {
			continue
		}
		f, err := parser.ParseFile(fset, e.Name(), nil, parser.ParseComments)
		if err != nil {
			t.Fatalf("parse %s: %v", e.Name(), err)
		}
		files[e.Name()] = f
	}
	return fset, files
}

// docSubjectPopulation walks every doc comment attached to a declaration and returns the ones
// whose first word is a subject claim. `declared` is the package's own name set: a first word
// that is not camelCase-shaped enters the population only if it is a declared name, so ordinary
// prose openings ("Package main …", "returns the paths …") are out by construction rather than
// by an allowlist.
func docSubjectPopulation(fset *token.FileSet, files map[string]*ast.File, declared map[string]bool) []docSubject {
	var out []docSubject
	consider := func(doc *ast.CommentGroup, names []string, kind string) {
		if doc == nil || len(names) == 0 {
			return
		}
		m := docFirstWord.FindStringSubmatch(strings.TrimSpace(doc.Text()))
		if m == nil {
			return
		}
		word := m[1]
		if !isIdentifierShaped(word) && !declared[word] {
			return
		}
		pos := fset.Position(doc.Pos())
		out = append(out, docSubject{
			file: pos.Filename, line: pos.Line, word: word, declKind: kind, declares: names,
		})
	}
	valueNames := func(s *ast.ValueSpec) []string {
		var ns []string
		for _, id := range s.Names {
			ns = append(ns, id.Name)
		}
		return ns
	}
	for _, f := range files {
		for _, d := range f.Decls {
			switch dd := d.(type) {
			case *ast.FuncDecl:
				consider(dd.Doc, []string{dd.Name.Name}, "func")
			case *ast.GenDecl:
				// A grouped declaration's own doc (`// foo is …\nvar ( … )`) documents the
				// first spec; each spec's own doc is considered separately below.
				if len(dd.Specs) > 0 {
					switch s := dd.Specs[0].(type) {
					case *ast.TypeSpec:
						consider(dd.Doc, []string{s.Name.Name}, "type")
					case *ast.ValueSpec:
						consider(dd.Doc, valueNames(s), "value")
					}
				}
				for _, sp := range dd.Specs {
					switch s := sp.(type) {
					case *ast.TypeSpec:
						consider(s.Doc, []string{s.Name.Name}, "type")
						if st, ok := s.Type.(*ast.StructType); ok && st.Fields != nil {
							for _, fl := range st.Fields.List {
								var ns []string
								for _, id := range fl.Names {
									ns = append(ns, id.Name)
								}
								consider(fl.Doc, ns, "field")
							}
						}
					case *ast.ValueSpec:
						consider(s.Doc, valueNames(s), "value")
					}
				}
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

// docSubjectResolves is the whole verdict, isolated so it can be driven with synthetic input:
// the opening word must name something this package declares.
func docSubjectResolves(word string, declared map[string]bool) bool { return declared[word] }

// TestDocCommentNamesItsSubject is the sweep. Every doc comment that opens with a symbol name
// must open with a symbol this package has.
func TestDocCommentNamesItsSubject(t *testing.T) {
	fset, files := parsePackage(t)
	declared := packageDeclaredNames(files)
	pop := docSubjectPopulation(fset, files, declared)

	// Floors: literals, never a count compared against itself. Measured at the commit that added
	// this file: 49 .go files, 929 declared names, 395 doc subjects. A walk that reads nothing — a parser that
	// silently returns no files, an AST shape that stops matching after a Go release — fails
	// here rather than reporting a clean sweep of an empty population.
	if len(files) < 30 {
		t.Fatalf("parsed %d .go files, want at least 30 — the package walk found almost nothing", len(files))
	}
	if len(declared) < 400 {
		t.Fatalf("declared names = %d, want at least 400 — the declaration scan found almost nothing", len(declared))
	}
	if len(pop) < 200 {
		t.Fatalf("doc subjects = %d, want at least 200 — the doc-comment scan found almost nothing", len(pop))
	}

	// The census is logged, not just asserted: `go test -v -run TestDocCommentNamesItsSubject`
	// prints the population this sweep actually walked, so the floors above can be re-derived
	// from a run rather than trusted from this comment.
	t.Logf("census: %d .go files, %d declared names, %d doc subjects", len(files), len(declared), len(pop))

	var bad []string
	for _, s := range pop {
		if docSubjectResolves(s.word, declared) {
			continue
		}
		bad = append(bad, fmt.Sprintf("%s:%d: doc comment opens %q but this package declares no such name (it declares %s %s)",
			s.file, s.line, s.word, s.declKind, strings.Join(s.declares, ", ")))
	}
	if len(bad) > 0 {
		t.Fatalf("doc comment(s) name a symbol that does not exist — a rename left the documentation behind:\n  %s",
			strings.Join(bad, "\n  "))
	}
}

// TestDocSubject_ClassifierSeesBothOutcomes drives the population filter and the verdict with
// synthetic source, so that a resolver which answered "resolves" to EVERYTHING — which would
// make the sweep above pass for the wrong reason once the live red is fixed — reds here.
func TestDocSubject_ClassifierSeesBothOutcomes(t *testing.T) {
	const src = `package main

// widgetName returns the name.
func widgetName() string { return "" }

// widgetGone returns the name. A rename left this behind.
func widgetKept() string { return "" }

// widgetName is named here on purpose: a sibling's name is not a defect.
func widgetOther() string { return "" }

// returns the name, opening with prose rather than a subject.
func widgetProse() string { return "" }
`
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, "synthetic.go", src, parser.ParseComments)
	if err != nil {
		t.Fatal(err)
	}
	files := map[string]*ast.File{"synthetic.go": f}
	declared := packageDeclaredNames(files)

	pop := docSubjectPopulation(fset, files, declared)
	got := map[string]string{}
	for _, s := range pop {
		got[strings.Join(s.declares, ",")] = s.word
	}

	// The prose opening is OUT of the population — not "in it and passing", which would hide a
	// filter that had stopped filtering.
	if w, ok := got["widgetProse"]; ok {
		t.Fatalf("a doc comment opening with prose entered the population as %q", w)
	}
	if len(got) != 3 {
		t.Fatalf("population = %d subjects, want 3 (widgetName, widgetKept, widgetOther): %v", len(got), got)
	}

	// Resolving branch: the self-name and the sibling name both pass.
	for _, decl := range []string{"widgetName", "widgetOther"} {
		if !docSubjectResolves(got[decl], declared) {
			t.Fatalf("%s: doc subject %q should resolve", decl, got[decl])
		}
	}
	// Refusing branch: the name a rename left behind resolves to nothing.
	if docSubjectResolves(got["widgetKept"], declared) {
		t.Fatalf("widgetKept: doc subject %q resolved, but nothing declares it", got["widgetKept"])
	}
}
