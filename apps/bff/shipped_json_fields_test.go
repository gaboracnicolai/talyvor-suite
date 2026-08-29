package main

// EVERY FIELD THIS SERVICE SHIPS AS JSON MUST BE FILLED BY SOMETHING.
//
// Go zero-fills a field omitted from a keyed composite literal SILENTLY. Add
// `Foo string `+"`json:\"foo\"`"+` to a response type, forget the construction site, and the
// build succeeds, the tests pass, and every client receives `"foo": ""` — a
// value that looks measured and is structural.
//
// THIS ESTATE HAS SHIPPED THAT CLASS THREE TIMES, ALWAYS ONE LAYER DOWN:
//
//	talyvor-lens  token_events.cached      — a structural 0 reported as a measured
//	                                         cache hit rate, and separately
//	                                         estimated_savings_usd = $0.00 for a year.
//	talyvor-track members.avatar_url       — TEXT NOT NULL DEFAULT '', no writer, served
//	                                         on three surfaces, with a comment that said
//	                                         "Track already stores the field" (W3.66,
//	                                         internal/schemaguard).
//
// The BFF is where that kind of value reaches a person. This file asks the same
// question about the layer above the database: of the fields this service puts
// on the wire, is there any that nothing can ever fill?
//
// ⚠ THE ANSWER TODAY IS NONE, AND THAT IS WHY THIS IS A GUARD AND NOT A FIX.
// Every json-tagged field on every struct this service builds is set, at every
// construction site or by an assignment declared below. This file makes that a
// maintained fact instead of a fact about one afternoon.
//
// ⚠ IT ADDS NO PERMISSION, REMOVES NONE, AND CHANGES NO BEHAVIOUR.

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// DECLARED CLASSIFICATION
//
// Every NAMED struct carrying json tags must be in exactly one of these two
// maps. An unclassified one reds the test, so a new response type cannot arrive
// without somebody saying which direction it travels.
// ---------------------------------------------------------------------------

// builtByThisService: the BFF fills these itself, so an unfilled field is a
// value this process invented. These are the ones worth checking.
var builtByThisService = map[string]string{
	"binaryVersion":        "build identity of this binary; assembled by describeBinary",
	"bundleVersion":        "identity of the web bundle on disk; assembled by readBundleVersion",
	"convertQuote":         "the LENS->LXC quote returned to the money screen",
	"distillState":         "the distill panel's state, assembled in readDistillState",
	"docsGenerateBody":     "request body this service POSTs to the Docs changelog route",
	"docsSuggestTitleBody": "request body this service POSTs to the Docs suggest-title route",
	"docsSummarizeBody":    "request body this service POSTs to the Docs transform route",
	"docsTranslateBody":    "request body this service POSTs to the Docs translate route",
	"versionResponse":      "the /api/version payload",
}

// decodedFromUpstream: written wholesale by encoding/json from an upstream
// reply. The BFF never fills these, so "no assignment" is correct rather than
// suspicious and checking them would report the decoder as a defect.
var decodedFromUpstream = map[string]string{
	"provisionResult":      "Lens's POST /v1/provision reply, decoded in provision()",
	"trackBootstrapResult": "Track's POST /v1/bootstrap reply, decoded in bootstrapTrackWorkspace()",
}

// filledByAssignment names fields that are NOT set in a composite literal but
// ARE set by `x.Field = ...` later. A composite-literal census cannot see those
// — that idiom is the reason the first version of this measurement produced two
// false positives on version.go.
//
// Each entry names the file, and the test asserts an assignment to that field
// still exists there. Without that check an entry would go on excusing a field
// forever after the assignment it points at was deleted.
//
// ⚠ THE STRENGTH OF THAT CHECK, STATED RATHER THAN IMPLIED, BECAUSE A CONTROL
// MEASURED IT: the assertion is per-FILE and per-FIELD-NAME, not per-branch and
// not per-type. `Verdict` is assigned in six arms of one switch, so deleting ONE
// arm does not red this test — only deleting them all does. It is a rot detector
// for the whole excuse, not a coverage check on the arms, and it cannot tell one
// type's `Commit` from another's in the same file. Both limits are acceptable
// here because the map is three entries that a human reads; neither would be
// acceptable as the map grows, and the fix then is go/types, not a wider regexp.
var filledByAssignment = map[string]assignSite{
	"bundleVersion.Stamped":   {"version.go", "false until the bundle stamp parses; set with Commit at the one success return"},
	"versionResponse.Agree":   {"version.go", "left nil unless BOTH sides are stamped — two unknowns are not a match, and a false `true` would tell an operator the deploy is consistent when nothing was established"},
	"versionResponse.Verdict": {"version.go", "assigned in every arm of the comparison switch, so the conclusion is in words rather than reconstructed from the fields"},
}

// ⚠ THIS MAP IS DELIBERATELY SMALLER THAN THE FIRST DRAFT, AND THE GUARD IS WHAT
// SHRANK IT. Five more entries were written here — all four distillState fields
// and bundleVersion.Commit — and TestFilledByAssignmentEntriesStillAssign
// rejected every one as excusing nothing: distillState has no keyed composite
// literal at all, so no site can omit a field, and Commit is omitempty. An
// exemption list that accepts entries it does not need is a place things go to
// stop being checked.

type assignSite struct{ file, why string }

// Vacuity floors — literals, deliberately not derived from what they defend.
const (
	minNonTestFiles  = 15
	minTaggedStructs = 8
)

// ---------------------------------------------------------------------------

type structFacts struct {
	jsonFields  []jsonField
	compSites   []string          // "file:line"
	setAtSite   []map[string]bool // per composite site
	anySiteSeen bool
}

type bffFacts struct {
	named      map[string]*structFacts
	assignedIn map[string]map[string]bool // file -> field name -> assigned there
	anonVars   []anonStruct
	files      int
	decodeArgs map[string]bool // "file:&name"
}

type anonStruct struct {
	file string
	line int
	bind string
	n    int
}

func scanBFF(t *testing.T) *bffFacts {
	t.Helper()
	f := &bffFacts{
		named:      map[string]*structFacts{},
		assignedIn: map[string]map[string]bool{},
		decodeArgs: map[string]bool{},
	}
	fset := token.NewFileSet()

	err := filepath.Walk(".", func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() || !strings.HasSuffix(p, ".go") || strings.HasSuffix(p, "_test.go") {
			return nil
		}
		parsed, perr := parser.ParseFile(fset, p, nil, 0)
		if perr != nil {
			// Never skip a file we cannot read: a skipped file silently shrinks
			// the set of assignments and manufactures unfilled fields.
			t.Fatalf("parse %s: %v", p, perr)
		}
		f.files++
		rel := filepath.Base(p)

		ast.Inspect(parsed, func(n ast.Node) bool {
			switch x := n.(type) {
			case *ast.TypeSpec:
				st, ok := x.Type.(*ast.StructType)
				if !ok {
					return true
				}
				if fl := jsonFieldNames(st); len(fl) > 0 {
					sf := f.named[x.Name.Name]
					if sf == nil {
						sf = &structFacts{}
						f.named[x.Name.Name] = sf
					}
					sf.jsonFields = append(sf.jsonFields, fl...)
				}

			case *ast.ValueSpec:
				// var NAME struct{ ... json tags ... } — an inline struct.
				if st, ok := x.Type.(*ast.StructType); ok {
					if fl := jsonFieldNames(st); len(fl) > 0 {
						bind := ""
						if len(x.Names) > 0 {
							bind = x.Names[0].Name
						}
						f.anonVars = append(f.anonVars, anonStruct{rel, fset.Position(x.Pos()).Line, bind, len(fl)})
					}
				}

			case *ast.AssignStmt:
				for _, lhs := range x.Lhs {
					if se, ok := lhs.(*ast.SelectorExpr); ok {
						if f.assignedIn[rel] == nil {
							f.assignedIn[rel] = map[string]bool{}
						}
						f.assignedIn[rel][se.Sel.Name] = true
					}
				}

			case *ast.CompositeLit:
				id, ok := x.Type.(*ast.Ident)
				if !ok {
					return true
				}
				sf := f.named[id.Name]
				if sf == nil {
					sf = &structFacts{}
					f.named[id.Name] = sf
				}
				set := map[string]bool{}
				keyed := false
				for _, e := range x.Elts {
					if kv, ok := e.(*ast.KeyValueExpr); ok {
						if k, ok := kv.Key.(*ast.Ident); ok {
							set[k.Name] = true
							keyed = true
						}
					}
				}
				// A POSITIONAL literal sets every field by definition. Recorded
				// as such rather than read as "sets nothing", which would be the
				// wrong direction.
				if len(x.Elts) > 0 && !keyed {
					set["<positional>"] = true
				}
				sf.compSites = append(sf.compSites, rel+":"+strconv.Itoa(fset.Position(x.Pos()).Line))
				sf.setAtSite = append(sf.setAtSite, set)
				sf.anySiteSeen = true

			case *ast.CallExpr:
				if sel, ok := x.Fun.(*ast.SelectorExpr); ok {
					// Claims is go-oidc's IDToken.Claims, which is a
					// json.Unmarshal into the argument — a decode target under
					// another name.
					if sel.Sel.Name == "Decode" || sel.Sel.Name == "Unmarshal" || sel.Sel.Name == "Claims" {
						for _, a := range x.Args {
							if u, ok := a.(*ast.UnaryExpr); ok {
								if id, ok := u.X.(*ast.Ident); ok {
									f.decodeArgs[rel+":"+id.Name] = true
								}
							}
						}
					}
				}
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatalf("walk: %v", err)
	}

	if f.files < minNonTestFiles {
		t.Fatalf("VACUITY: walked only %d non-test files (floor %d) — did the walk read the package?",
			f.files, minNonTestFiles)
	}
	tagged := 0
	for _, sf := range f.named {
		if len(sf.jsonFields) > 0 {
			tagged++
		}
	}
	if tagged < minTaggedStructs {
		t.Fatalf("VACUITY: found only %d json-tagged named structs (floor %d)", tagged, minTaggedStructs)
	}
	return f
}

// jsonField carries the one tag option that decides whether an unset field can
// ship a structural zero at all.
//
// ⚠ AN `omitempty` FIELD THAT IS NOT SET IS ABSENT FROM THE JSON, NOT ZERO IN IT,
// and that distinction is the whole rule. version.go relies on it deliberately:
// "Commit is omitempty ON PURPOSE: an unstamped build reports NO commit rather
// than a commit called 'dev', so `jq .commit` yields null instead of a
// plausible-looking string." A guard that demanded those be filled would be
// arguing against the correct design. Only a field WITHOUT omitempty can put a
// zero on the wire that reads as a measurement.
type jsonField struct {
	name      string
	omitempty bool
}

func fieldNames(fs []jsonField) string {
	out := make([]string, 0, len(fs))
	for _, f := range fs {
		out = append(out, f.name)
	}
	return strings.Join(out, ", ")
}

func jsonFieldNames(st *ast.StructType) []jsonField {
	var out []jsonField
	for _, fl := range st.Fields.List {
		if fl.Tag == nil {
			continue
		}
		tv, err := strconv.Unquote(fl.Tag.Value)
		if err != nil {
			continue
		}
		tag := reflect.StructTag(tv).Get("json")
		if tag == "" || strings.HasPrefix(tag, "-") {
			continue
		}
		omit := false
		for _, opt := range strings.Split(tag, ",")[1:] {
			if opt == "omitempty" {
				omit = true
			}
		}
		for _, nm := range fl.Names {
			out = append(out, jsonField{nm.Name, omit})
		}
	}
	return out
}

// TestEveryJSONTaggedStructIsClassified stops a new response type arriving
// without anybody saying which direction it travels — which is the only reason
// the next test can tell "the decoder fills it" apart from "nothing fills it".
func TestEveryJSONTaggedStructIsClassified(t *testing.T) {
	f := scanBFF(t)
	for name, sf := range f.named {
		if len(sf.jsonFields) == 0 {
			continue
		}
		_, out := builtByThisService[name]
		_, in := decodedFromUpstream[name]
		switch {
		case out && in:
			t.Errorf("%s is in BOTH builtByThisService and decodedFromUpstream", name)
		case out, in:
		default:
			t.Errorf("UNCLASSIFIED JSON STRUCT %s (fields: %s).\n"+
				"    Add it to builtByThisService if this service fills it, or to\n"+
				"    decodedFromUpstream if encoding/json fills it from an upstream reply.\n"+
				"    The distinction is what lets the next test tell a decoder-written field\n"+
				"    apart from one nothing fills.", name, fieldNames(sf.jsonFields))
		}
	}
	for name := range builtByThisService {
		if f.named[name] == nil || len(f.named[name].jsonFields) == 0 {
			t.Errorf("builtByThisService names %s, which is not a json-tagged struct in this "+
				"package any more — delete the entry", name)
		}
	}
	for name := range decodedFromUpstream {
		if f.named[name] == nil || len(f.named[name].jsonFields) == 0 {
			t.Errorf("decodedFromUpstream names %s, which is not a json-tagged struct in this "+
				"package any more — delete the entry", name)
		}
	}
}

// TestEveryShippedJSONFieldIsFilled is the guard proper: for a struct this
// service builds, every json field must be set at EVERY construction site, or
// declared in filledByAssignment.
func TestEveryShippedJSONFieldIsFilled(t *testing.T) {
	f := scanBFF(t)
	checked := 0

	names := make([]string, 0, len(builtByThisService))
	for n := range builtByThisService {
		names = append(names, n)
	}
	sort.Strings(names)

	for _, name := range names {
		sf := f.named[name]
		if sf == nil {
			continue // reported by the classification test
		}
		for i, site := range sf.compSites {
			set := sf.setAtSite[i]
			if set["<positional>"] {
				continue // a positional literal sets every field
			}
			if len(set) == 0 {
				continue // an empty literal is a deliberate zero value, e.g. a sentinel
			}
			for _, jf := range sf.jsonFields {
				// An omitempty field that is unset is ABSENT, not a zero on the
				// wire — it cannot be read as a measurement, so it is out of
				// this guard's population by construction.
				if jf.omitempty {
					continue
				}
				fld := jf.name
				if set[fld] {
					continue
				}
				key := name + "." + fld
				if _, ok := filledByAssignment[key]; ok {
					continue
				}
				t.Errorf("UNFILLED SHIPPED FIELD: %s is not set at %s.\n"+
					"    Go zero-fills an omitted field in a keyed composite literal silently, so\n"+
					"    this ships a value that looks measured and is structural. Either set it\n"+
					"    here, or — if it is filled by a later `x.%s = ...` — declare it in\n"+
					"    filledByAssignment with the file and the reason.", key, site, fld)
			}
			checked++
		}
	}
	if checked == 0 {
		t.Fatal("VACUITY: no construction site was checked at all")
	}
}

// TestFilledByAssignmentEntriesStillAssign stops the excuse outliving the
// assignment. An entry here suppresses a field from the check above forever; if
// the assignment is deleted, the field silently becomes unfilled with a comment
// explaining why that is fine.
func TestFilledByAssignmentEntriesStillAssign(t *testing.T) {
	f := scanBFF(t)
	if len(filledByAssignment) == 0 {
		t.Fatal("VACUITY: no entries declared, so this test verifies nothing")
	}
	for key, site := range filledByAssignment {
		dot := strings.LastIndexByte(key, '.')
		if dot < 0 {
			t.Errorf("filledByAssignment key %q is not Struct.Field", key)
			continue
		}
		structName, field := key[:dot], key[dot+1:]
		if _, ok := builtByThisService[structName]; !ok {
			t.Errorf("filledByAssignment names %s, whose struct is not in builtByThisService", key)
		}
		// An entry that excuses nothing is dead weight, and dead weight is how an
		// exemption list becomes a place things go to stop being checked. An
		// entry is NEEDED only if the field is non-omitempty AND absent from at
		// least one keyed construction site.
		if sf := f.named[structName]; sf != nil {
			needed := false
			for i, set := range sf.setAtSite {
				_ = i
				if set["<positional>"] || len(set) == 0 {
					continue
				}
				for _, jf := range sf.jsonFields {
					if jf.name == field && !jf.omitempty && !set[field] {
						needed = true
					}
				}
			}
			if !needed {
				t.Errorf("filledByAssignment entry %s excuses nothing: the field is either\n"+
					"    omitempty (so an unset value is ABSENT, not a zero) or already set at\n"+
					"    every construction site. Delete the entry — an exemption that exempts\n"+
					"    nothing still reads as one.\n    declared reason: %s", key, site.why)
			}
		}
		if !f.assignedIn[site.file][field] {
			t.Errorf("%s is declared filled by assignment in %s, but that file contains NO\n"+
				"    assignment to a field named %q any more. Either the assignment was removed —\n"+
				"    in which case the field is now unfilled and this entry is hiding it — or it\n"+
				"    moved, and this entry must name where.\n    declared reason: %s",
				key, site.file, field, site.why)
		}
	}
}

// TestInlineJSONStructsAreDecodeTargets defends the blind spot that made the
// first version of this measurement wrong by a third.
//
// A TypeSpec-only walk sees 41 of this package's json-tagged fields; there are
// 67. The other 26 are on INLINE anonymous structs (`var in struct{...}`), and
// every one of them today is an upstream-reply or request-body decode target,
// which is why they need no filling. The day somebody builds a RESPONSE inline,
// it would be invisible to the guard above — so this test requires each inline
// json struct to be handed to Decode or Unmarshal in its own file.
func TestInlineJSONStructsAreDecodeTargets(t *testing.T) {
	f := scanBFF(t)
	if len(f.anonVars) == 0 {
		t.Fatal("VACUITY: no inline json-tagged structs found, so this test verifies nothing")
	}
	for _, a := range f.anonVars {
		if a.bind == "" {
			t.Errorf("%s:%d declares an inline json struct bound to nothing", a.file, a.line)
			continue
		}
		if !f.decodeArgs[a.file+":"+a.bind] {
			t.Errorf("the inline json struct %s at %s:%d (%d tagged field(s)) is NOT passed to\n"+
				"    Decode or Unmarshal in that file, so it is not an upstream-reply decode\n"+
				"    target. If this service BUILDS it and ships it, give it a named type and\n"+
				"    classify it — otherwise its fields are outside every check in this file.",
				a.bind, a.file, a.line, a.n)
		}
	}
}
