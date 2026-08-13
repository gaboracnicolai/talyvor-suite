package main

// tenant_callsite_test.go — guards the CALL SITES, not just the property.
//
// The behavioural tests in tenant_boundary_test.go prove that two sessions reach two workspaces.
// But they build their own request against the routes that exist TODAY. If a later refactor
// reintroduces a startup-scoped workspace — a config field, a path assembled at registration, a
// handler closing over a captured id — those tests keep passing for every route they happen to
// name, and say nothing about a new one.
//
// That is exactly the failure mode found on the Lens side: a behavioural test that documented the
// hazard could not notice the production mount moving, because it never read the production file.
// So this reads the source.
//
// THREE THINGS ARE ASSERTED, all of them about shape rather than behaviour — deliberately,
// because the hazard IS a property of the call site:
//
//  1. The config carries no Lens workspace id or workspace key. If neither exists, no handler can
//     close over one.
//  2. The Lens workspace path prefix is assembled in exactly ONE place (lensWorkspacePath), which
//     takes the workspace from a tenant. Everywhere else must go through it.
//  3. LENS_API_KEY is never read. The BFF must hold the narrow provisioning secret, never the
//     admin key that authorises every workspace.

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// bffSourceFiles returns this package's non-test .go files, parsed.
func bffSourceFiles(t *testing.T) map[string]*ast.File {
	t.Helper()
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("read package dir: %v", err)
	}
	fset := token.NewFileSet()
	out := map[string]*ast.File{}
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		f, err := parser.ParseFile(fset, name, nil, parser.ParseComments)
		if err != nil {
			t.Fatalf("parse %s: %v", name, err)
		}
		out[name] = f
	}
	if len(out) == 0 {
		t.Fatal("no source files found — this guard has drifted from the code it protects")
	}
	return out
}

// 1. No startup-scoped Lens workspace id or key may exist on the config.
//
// This is the direct guard on the defect: eight routes used to close over cfg.workspaceID at
// registration, so every signed-in person shared one workspace. Removing the field is what makes
// that unrepresentable — so the field must stay removed.
func TestConfigCarriesNoStartupWorkspaceIdentity(t *testing.T) {
	banned := map[string]string{
		"workspaceID":  "a startup-scoped Lens workspace id — routes would close over it at registration and every session would share one workspace",
		"workspaceKey": "a single shared Lens workspace key — each session must present its OWN provisioned token",
		// Added when Track went per-session. Docs is NOT here, and the reason USED TO BE "it stays
		// pinned by design", pointing at a `…_RemainsPinnedByDesign` test. Both halves were stale:
		// that test never existed, and Docs is not pinned any more. DOCS_WORKSPACE_ID is gone (main.go says so
		// where it used to be read) and docsWorkspaceFor resolves the workspace from the SESSION,
		// exactly as Track's does. The real reason Docs needs no line here is therefore stronger than
		// the one that was written: there is no startup-scoped Docs identity left in config for this
		// list to forbid, and TestDocsWorkspacePathOnlyForWorkspaceScopedUpstreamRoutes is what holds
		// the builder to the session-derived id.
		"trackWorkspaceID": "a startup-scoped TRACK workspace id — every signed-in person would share one Track and read each other's issues",
	}
	for name, file := range bffSourceFiles(t) {
		ast.Inspect(file, func(n ast.Node) bool {
			ts, ok := n.(*ast.TypeSpec)
			if !ok || ts.Name.Name != "config" {
				return true
			}
			st, ok := ts.Type.(*ast.StructType)
			if !ok {
				return true
			}
			for _, f := range st.Fields.List {
				for _, id := range f.Names {
					if why, bad := banned[id.Name]; bad {
						t.Errorf("%s: config.%s reintroduces %s. Provision per session instead "+
							"(tenant.go), and read the workspace from the session per request.",
							name, id.Name, why)
					}
				}
			}
			return true
		})
	}
}

// 2. The Lens workspace path prefix may be assembled in exactly one place.
//
// lensWorkspacePath takes a tenant, so the workspace can only come from a session. A literal
// "/v1/workspaces/" anywhere else is a path being built from something else — which is how the
// original defect was written.
//
// DOCS is a separate upstream with its own PINNED workspace and is exempt. TRACK IS NO LONGER
// EXEMPT: it became per-session, so a "/v1/workspaces/" literal in track.go is now exactly the
// hazard this guard exists to catch — a path built from something other than the session. The
// exemption was correct while Track was legitimately pinned and became wrong the moment it was
// not, which is the kind of staleness an exemption list acquires silently.
func TestLensWorkspacePathBuiltInExactlyOnePlace(t *testing.T) {
	const prefix = "/v1/workspaces/"
	// One sanctioned builder PER TENANCY, each taking the workspace from the session. Sanctioning
	// the builder rather than the file is what let track.go come off the exemption list: a stray
	// literal in track.go is now caught, while the deliberate builder beside it is not.
	// The ONLY functions allowed to assemble a workspace-scoped upstream path. docsWorkspacePath
	// joined them when Docs stopped serving a pinned workspace: it takes the id the SESSION carries,
	// which is exactly the property this guard exists to force. The guard caught it on the way in —
	// a new builder is sanctioned deliberately here, never by loosening the check.
	sanctioned := map[string]bool{
		"lensWorkspacePath":  true,
		"trackWorkspacePath": true,
		"docsWorkspacePath":  true,
	}

	found := 0
	for name, file := range bffSourceFiles(t) {
		productProxyLits := collectProductProxyLiterals(file)
		// Which function does each literal sit in?
		ast.Inspect(file, func(n ast.Node) bool {
			fn, ok := n.(*ast.FuncDecl)
			if !ok {
				return true
			}
			ast.Inspect(fn.Body, func(m ast.Node) bool {
				lit, ok := m.(*ast.BasicLit)
				if !ok || lit.Kind != token.STRING {
					return true
				}
				if !strings.Contains(lit.Value, prefix) {
					return true
				}
				if sanctioned[fn.Name.Name] {
					found++
					return true
				}
				// Track/Docs upstreams pin their own workspaces and are not Lens tenancy. Exempt
				// PER LITERAL — a literal handed to proxyProduct addresses another service — rather
				// than per file or per function, so a Lens path added beside one is still caught.
				if nonLensUpstreamFile[name] || productProxyLits[lit] {
					return true
				}
				t.Errorf("%s: %s() builds a %q path directly. Build it with lensWorkspacePath / "+
					"trackWorkspacePath so the workspace comes from the session — a path assembled "+
					"anywhere else is how every user ended up sharing one workspace.",
					name, fn.Name.Name, prefix)
				return true
			})
			return true
		})
	}
	if found < len(sanctioned) {
		t.Fatalf("only %d of %d sanctioned builders still build the %q prefix — this guard has "+
			"drifted from the code it protects", found, len(sanctioned), prefix)
	}
}

// nonLensUpstreamFile lists files whose "/v1/workspaces/" literals address a STILL-PINNED
// upstream rather than Lens tenancy.
//
// track.go was removed from this list when Track went per-session (#33): its paths are now built
// by trackWorkspacePath from the session, and a literal there would be a regression. The list is
// empty rather than deleted so that adding a genuinely pinned upstream is a visible, argued edit.
var nonLensUpstreamFile = map[string]bool{}

// collectProductProxyLiterals returns every string literal appearing inside a proxyProduct(...)
// call — i.e. a path addressed at Track or Docs, not at Lens.
func collectProductProxyLiterals(file *ast.File) map[*ast.BasicLit]bool {
	out := map[*ast.BasicLit]bool{}
	ast.Inspect(file, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || !strings.HasPrefix(sel.Sel.Name, "proxyProduct") {
			return true
		}
		for _, a := range call.Args {
			ast.Inspect(a, func(m ast.Node) bool {
				if lit, ok := m.(*ast.BasicLit); ok {
					out[lit] = true
				}
				return true
			})
		}
		return true
	})
	return out
}

// 3. The BFF must never read LENS_API_KEY.
//
// The admin key makes workspaceAuthorized true for EVERY workspace and unlocks ~30 admin routes; a
// BFF compromise would escalate from one tenant's data to control of every tenant. The narrow
// provisioning secret can create a workspace and mint its session token, and nothing else.
// loadConfig also refuses to start if the variable is set in the environment — this guards the
// source, that guards the deployment.
func TestBFFNeverReadsTheLensAdminKey(t *testing.T) {
	for name, file := range bffSourceFiles(t) {
		ast.Inspect(file, func(n ast.Node) bool {
			lit, ok := n.(*ast.BasicLit)
			if !ok || lit.Kind != token.STRING {
				return true
			}
			// The refusal in loadConfig names the variable on purpose; that mention is the guard,
			// not a use. Distinguish by looking for an os.Getenv around it.
			if strings.Contains(lit.Value, "LENS_API_KEY") && isGetenvArg(file, lit) &&
				!inFunc(file, lit, "loadConfig") {
				t.Errorf("%s reads LENS_API_KEY outside loadConfig's refusal. The BFF must hold "+
					"LENS_PROVISION_SECRET instead: the admin key authorises every workspace and "+
					"~30 admin routes.", name)
			}
			return true
		})
	}
}

// inFunc reports whether lit sits inside the named function. loadConfig READS LENS_API_KEY on
// purpose — to refuse to start if it is set — and that refusal must not trip the guard that
// enforces it.
func inFunc(file *ast.File, lit *ast.BasicLit, fnName string) bool {
	hit := false
	for _, d := range file.Decls {
		fn, ok := d.(*ast.FuncDecl)
		if !ok || fn.Name.Name != fnName || fn.Body == nil {
			continue
		}
		ast.Inspect(fn.Body, func(n ast.Node) bool {
			if n == ast.Node(lit) {
				hit = true
			}
			return true
		})
	}
	return hit
}

// isGetenvArg reports whether lit is an argument to os.Getenv / os.LookupEnv.
func isGetenvArg(file *ast.File, lit *ast.BasicLit) bool {
	hit := false
	ast.Inspect(file, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || (sel.Sel.Name != "Getenv" && sel.Sel.Name != "LookupEnv") {
			return true
		}
		for _, a := range call.Args {
			if a == ast.Node(lit) {
				hit = true
			}
		}
		return true
	})
	return hit
}

// A belt-and-braces check that the sanctioned builder really does read the workspace from a
// tenant, so the guard above cannot be satisfied by a builder that takes a plain string.
func TestLensWorkspacePathTakesATenant(t *testing.T) {
	for name, file := range bffSourceFiles(t) {
		for _, d := range file.Decls {
			fn, ok := d.(*ast.FuncDecl)
			if !ok || fn.Name.Name != "lensWorkspacePath" {
				continue
			}
			if fn.Type.Params == nil || len(fn.Type.Params.List) == 0 {
				t.Fatalf("%s: lensWorkspacePath takes no parameters", name)
			}
			first := fn.Type.Params.List[0]
			id, ok := first.Type.(*ast.Ident)
			if !ok || id.Name != "tenant" {
				t.Errorf("%s: lensWorkspacePath's first parameter must be a tenant (the session's "+
					"workspace), got %v — otherwise a caller can pass any workspace id it likes",
					name, first.Type)
			}
			return
		}
	}
	t.Fatalf("lensWorkspacePath not found in %v", filepath.Base("."))
}

// TestDocsWorkspacePathOnlyForWorkspaceScopedUpstreamRoutes — the guard the last incident needed,
// with the premise it used to state CORRECTED.
//
// ⚠ THE MISTAKE IT CATCHES. Docs' prefixes are NOT uniform. Space create is POST /v1/spaces with
// the workspace in the BODY, and every by-id route (space detail, page list/create/detail/update)
// is registered at the TOP LEVEL. When Docs went per-identity, docsWorkspacePath was applied to
// all six call sites. Five of them then addressed paths Docs does not register, so opening a space
// returned Go's default `404 page not found` — which the web app reported as "Docs is not
// configured on this deployment", blaming the operator for our routing.
//
// ⚠ THIS TEST USED TO ASSERT `total == 1` AND TO SAY WHY: "Docs registers ONLY
// GET /v1/workspaces/{wsID}/spaces under a workspace." THAT SENTENCE WAS FALSE WHEN IT WAS
// WRITTEN. Measured at talyvor-docs `d7d936f` by grepping the chi mounts, Docs registers
// TWENTY-FOUR patterns under /workspaces/{wsID}/ — among them all five AI routes
// (ai/ask, ai/write, ai/transform, ai/translate, ai/suggest-title), search, pages/search,
// pages/stale, freshness, changelog/feed, analytics/pages, approvals/pending, template-library
// (4), custom-domains (4) and the two track/* reads. The count was a true statement about THIS
// repository's one call site dressed as a false statement about the UPSTREAM's route table, and
// the difference matters: every Tier-2/Tier-3 row in areas/docs/BFF-GAPS.md that this BFF has
// still to proxy is workspace-scoped upstream, so the old rule forbade all of them and gave a
// reason that was not true.
//
// ⚠ WHAT REPLACES THE COUNT, AND WHY IT IS NOT A PER-FUNCTION ALLOWLIST. The old comment's
// objection to an allowlist was right — the failure was ONE builder used in five wrong places, and
// a list of allowed FUNCTIONS would have passed while every one of them built a broken path. So
// the register below is keyed on the (function, SUFFIX) pair, which is the thing that was wrong,
// and above it sits a rule no register entry can waive: a suffix that reaches into the
// top-level /spaces/… or /pages/… families is refused outright. That is the incident's exact
// shape, and it stays unrepresentable however the register grows.
//
// ⚠ THE SUFFIX MUST BE A PLAIN STRING LITERAL. A computed one ("/spaces/"+id) would carry an id
// past a rule that can only read constants — which is precisely the argument that produced the
// incident — so it is refused rather than skipped.
func TestDocsWorkspacePathOnlyForWorkspaceScopedUpstreamRoutes(t *testing.T) {
	// (function, suffix) → the upstream pattern it addresses. Cited to talyvor-docs `d7d936f`.
	// Adding a row is a decision: name the chi mount the suffix lands on, and check it is under
	// /workspaces/{wsID}/ there.
	allowed := map[string]string{
		"docsSpaces:/spaces": "GET /v1/workspaces/{wsID}/spaces — internal/space/handler.go " +
			"(LIST only; create is POST /v1/spaces with the workspace in the body)",
		"docsAskAI:/ai/ask": "POST /v1/workspaces/{wsID}/ai/ask — internal/ai/handler.go Mount",
	}

	type site struct{ fn, suffix string }
	var sites []site
	for _, file := range bffSourceFiles(t) {
		ast.Inspect(file, func(n ast.Node) bool {
			fn, ok := n.(*ast.FuncDecl)
			if !ok {
				return true
			}
			ast.Inspect(fn.Body, func(m ast.Node) bool {
				call, ok := m.(*ast.CallExpr)
				if !ok {
					return true
				}
				id, ok := call.Fun.(*ast.Ident)
				if !ok || id.Name != "docsWorkspacePath" {
					return true
				}
				if len(call.Args) != 2 {
					t.Errorf("%s: docsWorkspacePath called with %d args, want 2", fn.Name.Name, len(call.Args))
					return true
				}
				lit, ok := call.Args[1].(*ast.BasicLit)
				if !ok || lit.Kind != token.STRING {
					t.Errorf("%s: docsWorkspacePath's suffix must be a plain string literal, got %T — "+
						"a computed suffix carries an id past a rule that can only read constants, "+
						"which is how the by-id routes acquired a workspace prefix in the first place",
						fn.Name.Name, call.Args[1])
					return true
				}
				suffix, err := strconv.Unquote(lit.Value)
				if err != nil {
					t.Errorf("%s: unquote %s: %v", fn.Name.Name, lit.Value, err)
					return true
				}
				sites = append(sites, site{fn: fn.Name.Name, suffix: suffix})
				return true
			})
			return true
		})
	}

	// A floor, so an AST walk that reads nothing cannot pass this file silently.
	if len(sites) == 0 {
		t.Fatal("no docsWorkspacePath call site found at all — the scan read nothing, so every " +
			"answer below is unsafe. Check bffSourceFiles and the call-expression match.")
	}

	for _, s := range sites {
		// THE RULE NO REGISTER ENTRY CAN WAIVE — the incident's exact shape.
		if strings.HasPrefix(s.suffix, "/spaces/") || strings.HasPrefix(s.suffix, "/pages/") {
			t.Errorf("%s builds a workspace-prefixed path %q. Docs registers the by-id space and "+
				"page routes at the TOP LEVEL (/v1/spaces/{id}…, /v1/pages/{id}…); prefixing one "+
				"with /workspaces/{ws} produces `404 page not found`, which this app reports to "+
				"the operator as \"Docs is not configured on this deployment\".", s.fn, s.suffix)
			continue
		}
		if _, ok := allowed[s.fn+":"+s.suffix]; !ok {
			t.Errorf("%s builds %q under a workspace prefix and no register entry says which "+
				"upstream mount that is. Add one to `allowed` naming the chi route in talyvor-docs, "+
				"having checked it really is under /workspaces/{wsID}/ there.", s.fn, s.suffix)
		}
	}

	// The register is held to the same standard in the other direction: a row for a call site
	// that no longer exists is a stale permission, and a reader would take it for coverage.
	live := map[string]bool{}
	for _, s := range sites {
		live[s.fn+":"+s.suffix] = true
	}
	for key := range allowed {
		if !live[key] {
			t.Errorf("register row %q permits a call site that does not exist — delete it rather "+
				"than leave a permission nobody uses", key)
		}
	}
}
