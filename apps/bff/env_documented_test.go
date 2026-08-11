package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// EVERY VARIABLE THIS BINARY READS MUST BE NAMED WHERE AN OPERATOR LOOKS.
//
// The BFF's whole configuration surface is the environment, and an operator only ever learns a
// variable's name from deploy/README.md's table or deploy/bff.env.example. A variable the binary
// reads and neither document names is not "optional" — it is invisible, and the operator's
// deployment is missing it for a reason nobody can find.
//
// ⚠ MEASURED, and the first count was wrong because of how I counted. A grep for
// `os.Getenv("LITERAL")` said 17 of 18 variables were documented and LENS_PUBLIC_BASE_URL was the
// single hole. That grep could not see `os.Getenv(operatorSubsEnv)` — a read through a named
// constant — and OPERATOR_SUBS, the operator boundary itself, is the second hole. The number was a
// fact about the query shape, not about the repository, which is why this guard walks the AST and
// resolves constants instead of matching text.
//
// WHAT WAS SHIPPING:
//
//   - LENS_PUBLIC_BASE_URL — the customer-facing Lens origin. Unset is not a soft default: the
//     Setup page, the one screen that tells a trial user what to do with the product, renders
//     "Setup instructions unavailable … ask your operator to set LENS_PUBLIC_BASE_URL" and shows no
//     snippets at all. MEASURED: a BFF booted with exactly the variables deploy/README.md and
//     deploy/bff.env.example name starts clean and serves
//     `{"lens_public_base_url":""}` from /api/context. So an operator who follows the shipped
//     documentation exactly gets the dark version of the setup page, and the instruction it prints
//     names a variable that appears in none of their documents.
//   - OPERATOR_SUBS — the operator boundary. Unset means NOBODY, deliberately (operator.go), and
//     the only way in is to name your own OIDC `sub`. An operator who never learns the name can
//     never reach it: fail-closed, and permanently.
//
// WHAT THIS GUARD DOES NOT COVER, stated so the next reader does not over-trust it: it is
// SOURCE-DERIVED, so it can only see variables the binary still reads. Delete a `os.Getenv` call
// and this stays green while the documentation keeps describing a variable nobody reads — the
// inverse defect (TRACK_WORKSPACE_ID is the repo's example of catching that at boot instead).
// It also asserts only that the NAME APPEARS; it cannot judge whether what is written about it is
// true.
func TestEveryEnvVarTheBinaryReadsIsDocumented(t *testing.T) {
	read := envVarsReadByBinary(t)
	if len(read) < 15 {
		t.Fatalf("only %d env vars extracted (%v) — the extractor is broken, not the config surface; "+
			"a guard that reads nothing passes for every possible repository", len(read), read)
	}

	docs := map[string]string{
		"../../deploy/README.md":       "",
		"../../deploy/bff.env.example": "",
		// The BFF's OWN README joined this set when its table was measured against the binary: it
		// named 3 of the 19 variables read here and marked two more **required** that nothing
		// reads. A developer's first document is this one, and it was the only one of the three
		// with no rule holding it to the config surface. See readme_boot_test.go for the inverse
		// direction, which is the half this test states it cannot see.
		"README.md": "",
	}
	for path := range docs {
		b, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		docs[path] = string(b)
	}

	for _, name := range read {
		// WORD-BOUNDARED, not strings.Contains. `_` is a word character, so \bOPERATOR_SUBS\b does
		// NOT match inside OPERATOR_SUBS_LEGACY — which strings.Contains did, and control C3 is
		// exactly that mutation: a documented name that has since been renamed with a suffix would
		// have gone on satisfying the guard forever.
		re := regexp.MustCompile(`\b` + regexp.QuoteMeta(name) + `\b`)
		for path, body := range docs {
			if !re.MatchString(body) {
				t.Errorf("%s is read by the BFF (env) but is named nowhere in %s.\n"+
					"An operator learns a variable exists from that file and nowhere else, so an "+
					"undocumented one is not optional — it is invisible, and the deployment is "+
					"missing it for a reason nobody can find.", name, filepath.Base(path))
			}
		}
	}
}

// envVarsReadByBinary walks every non-test .go file in this package and returns the names passed to
// os.Getenv / envOr, resolving package-level string constants. An argument it cannot resolve is a
// FAILURE, not a skip: the whole point is that a read the extractor cannot see is exactly the read
// that goes undocumented.
func envVarsReadByBinary(t *testing.T) []string {
	t.Helper()
	fset := token.NewFileSet()
	pkgs, err := parser.ParseDir(fset, ".", func(fi os.FileInfo) bool {
		return !strings.HasSuffix(fi.Name(), "_test.go")
	}, 0)
	if err != nil {
		t.Fatalf("parse package: %v", err)
	}

	consts := map[string]string{} // package-level const ident -> string value
	var files []*ast.File
	for _, p := range pkgs {
		for _, f := range p.Files {
			files = append(files, f)
		}
	}
	for _, f := range files {
		for _, d := range f.Decls {
			gd, ok := d.(*ast.GenDecl)
			if !ok || gd.Tok != token.CONST {
				continue
			}
			for _, s := range gd.Specs {
				vs, ok := s.(*ast.ValueSpec)
				if !ok || len(vs.Names) != len(vs.Values) {
					continue
				}
				for i, n := range vs.Names {
					if lit, ok := vs.Values[i].(*ast.BasicLit); ok && lit.Kind == token.STRING {
						if v, err := strconv.Unquote(lit.Value); err == nil {
							consts[n.Name] = v
						}
					}
				}
			}
		}
	}

	seen := map[string]bool{}
	helperSkips := 0
	for _, f := range files {
		// enclosing tracks the func we are inside, so the one os.Getenv in envOr's OWN body —
		// whose argument is that function's parameter — is skipped by name rather than by
		// "unresolvable arguments are ignored", which would swallow a real miss.
		var enclosing string
		ast.Inspect(f, func(n ast.Node) bool {
			if fd, ok := n.(*ast.FuncDecl); ok {
				enclosing = fd.Name.Name
			}
			call, ok := n.(*ast.CallExpr)
			if !ok || len(call.Args) == 0 {
				return true
			}
			name := ""
			switch fn := call.Fun.(type) {
			case *ast.SelectorExpr:
				pkg, ok := fn.X.(*ast.Ident)
				if !ok || pkg.Name != "os" || fn.Sel.Name != "Getenv" {
					return true
				}
				name = "os.Getenv"
			case *ast.Ident:
				if fn.Name != "envOr" {
					return true
				}
				name = "envOr"
			default:
				return true
			}
			switch arg := call.Args[0].(type) {
			case *ast.BasicLit:
				if v, err := strconv.Unquote(arg.Value); err == nil {
					seen[v] = true
					return true
				}
			case *ast.Ident:
				if v, ok := consts[arg.Name]; ok {
					seen[v] = true
					return true
				}
				if enclosing == "envOr" {
					helperSkips++ // envOr's own body reads its `key` parameter
					return true
				}
			}
			t.Errorf("%s at %s takes an argument this extractor cannot resolve to a name — fix the "+
				"extractor, because an unreadable read is precisely the one that goes undocumented",
				name, fset.Position(call.Pos()))
			return true
		})
	}
	if helperSkips != 1 {
		t.Errorf("expected exactly 1 skipped read inside envOr's own body, got %d — a second "+
			"env-reading helper would be silently swallowed by that exemption", helperSkips)
	}

	out := make([]string, 0, len(seen))
	for k := range seen {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
