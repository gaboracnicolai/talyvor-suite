package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

// THE SEARCH ROUTE, AND THE TWO PARAMETERS THAT MAKE IT MORE THAN PROXYING.
//
// ⚠ EVERY FINDING BELOW WAS MEASURED BY RUNNING talyvor-docs' OWN SEARCH HANDLER, NOT BY READING
// IT. At docs `7bfa1cf`, in a scratch copy (`git archive HEAD | tar -x` into /tmp; the repository
// was held by another tab and was never written to), the handler was mounted over a stub store
// with Lens deliberately unconfigured — `lensintegration.New("","")`, i.e. this deployment — and
// driven. The bytes:
//
//	?q=auth                    → 200 {"results":[{…"source":"fulltext"…}],"total":1,…}
//	?q=auth (no matches)       → 200 {"results":[],"total":0,…}
//	?q=auth&type=semantic      → 200 {"results":[],"total":0,…}   full-text store NOT called
//	?q=auth&type=banana        → 200 {"results":[],"total":0,…}   NEITHER half called
//
// THE LAST TWO ARE THE SAME BYTES AS "NOTHING MATCHED", and one of them is a typo. This BFF
// already has the rule for that shape, written on docsPageList: "A parameter the upstream ignores
// is worse than one it rejects: the reply RENDERS AS FILTERED while being unfiltered." An
// unrecognised `type` is worse again — it is not ignored, it SUPPRESSES BOTH HALVES and answers
// 200 with an empty list, so a caller who mistypes `fulltext` is told their workspace has no
// matching documents. This route refuses it here, before any dial.
//
// ⚠ AND THE MERGED WINDOW ENDS AT 50, SILENTLY. Also measured, same harness, 200 synthetic
// documents, `type=all` (the default):
//
//	limit=10&offset=0   → 10 rows  pg-00…pg-09
//	limit=10&offset=40  → 10 rows  pg-40…pg-49
//	limit=10&offset=45  →  5 rows  pg-45…pg-49      ← short, and nothing says so
//	limit=10&offset=50  →  0 rows                    ← the walk terminates cleanly
//	limit=10&offset=90  →  0 rows
//	limit=10&offset=90&type=fulltext → 10 rows pg-90…pg-99   ← the single-source path pages fine
//
// The cause is upstream's own `maxFetchRows = 50`: on `type=all` the offset cannot go into the SQL
// (merge() re-ranks the two halves, so row k of a half is not row k of the answer), so the handler
// fetches a window of `offset+limit` CLAMPED TO 50 and cuts the page out of it. `total` is
// `len(results)`, never a corpus count, so a pager reading 5 < limit concludes "last page" with
// 155 documents left. This route refuses the window it cannot serve rather than serving a short
// page that reads as the end of the corpus. On a SINGLE source the offset is that half's own SQL
// OFFSET and pages correctly, so it is allowed — the refusal is exactly as wide as the defect.

// searchUpstream stands in for Docs with exactly the ONE pattern this route addresses —
// `GET /v1/workspaces/{wsID}/search`, transcribed from talyvor-docs internal/search/handler.go
// Mount — so a request that addresses a path Docs does not register 404s here as it does on the
// box. It records the RAW QUERY, because what this route does that a bare forward would not is
// decide what appears in it.
type searchUpstream struct {
	srv      *httptest.Server
	mu       chan struct{}
	seen     []string
	gotQuery []string
	status   int
	body     string
	gotAuth  string
	gotEmail string
}

func newSearchUpstream(t *testing.T, status int, body string) *searchUpstream {
	t.Helper()
	u := &searchUpstream{mu: make(chan struct{}, 1), status: status, body: body}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/workspaces/{wsID}/search", func(w http.ResponseWriter, r *http.Request) {
		u.mu <- struct{}{}
		u.seen = append(u.seen, r.Method+" "+r.URL.Path)
		u.gotQuery = append(u.gotQuery, r.URL.RawQuery)
		u.gotAuth = r.Header.Get("X-Gateway-Auth")
		u.gotEmail = r.Header.Get("X-User-Email")
		<-u.mu
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(u.status)
		_, _ = io.WriteString(w, u.body)
	})
	mux.HandleFunc(provisionPath, func(w http.ResponseWriter, r *http.Request) { serveFakeProvision(w, r) })
	mux.HandleFunc(trackBootstrapPath, func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"workspace_id":"track-ws-7"}`)
	})
	u.srv = httptest.NewServer(mux)
	t.Cleanup(u.srv.Close)
	return u
}

func (u *searchUpstream) requests() []string {
	u.mu <- struct{}{}
	defer func() { <-u.mu }()
	return append([]string(nil), u.seen...)
}

func (u *searchUpstream) queries() []string {
	u.mu <- struct{}{}
	defer func() { <-u.mu }()
	return append([]string(nil), u.gotQuery...)
}

func searchApp(t *testing.T, u *searchUpstream) (*app, *http.Cookie) {
	t.Helper()
	return productApp(t, &captureUpstream{srv: u.srv}, &captureUpstream{srv: u.srv})
}

func getSearch(t *testing.T, a *app, sess *http.Cookie, rawQuery string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/docs/search?"+rawQuery, nil)
	if sess != nil {
		req.AddCookie(sess)
	}
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	return rec
}

const oneHitBody = `{"results":[{"page_id":"pg-1","page_title":"Auth flow","space_name":"Eng",` +
	`"headline":"an <mark>auth</mark> excerpt","rank":0.9,"source":"fulltext",` +
	`"url":"/spaces/sp-1/pages/pg-1"}],"total":1,"query":"auth","took_ms":3}`

// The route exists, addresses the path Docs registers, and does so in the SESSION's workspace.
func TestDocsSearch_AddressesDocsSearchPathInTheSessionWorkspace(t *testing.T) {
	u := newSearchUpstream(t, http.StatusOK, oneHitBody)
	a, sess := searchApp(t, u)

	rec := getSearch(t, a, sess, "q=auth")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/docs/search → %d: %s", rec.Code, strings.TrimSpace(rec.Body.String()))
	}
	got := u.requests()
	if len(got) != 1 || got[0] != "GET /v1/workspaces/track-ws-7/search" {
		t.Fatalf("upstream saw %v, want [GET /v1/workspaces/track-ws-7/search]", got)
	}
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("body is not JSON: %v (%s)", err, rec.Body.String())
	}
	if out["total"] != float64(1) {
		t.Errorf("total = %v, want 1 — the upstream body must stream through verbatim", out["total"])
	}
}

// The credential is attached server-side, and the response never carries it.
func TestDocsSearch_AttachesGatewayCredentialsServerSide(t *testing.T) {
	u := newSearchUpstream(t, http.StatusOK, oneHitBody)
	a, sess := searchApp(t, u)

	if rec := getSearch(t, a, sess, "q=auth"); rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	if u.gotAuth != testDocsSecret {
		t.Errorf("X-Gateway-Auth = %q, want the docs secret", u.gotAuth)
	}
	if u.gotEmail != "ng@example.com" {
		t.Errorf("X-User-Email = %q, want the session identity", u.gotEmail)
	}
}

// A stranger gets nothing, and no request is made upstream on their behalf.
//
// ⚠⚠ ITS GREEN DOES NOT PROVE THE `requireSession` WRAPPER IS ON THIS ROUTE, AND SAYING SO HERE IS
// THE POINT OF THIS COMMENT. Positive control P5 (~/talyvor-queue/w17-search-controls-3d9e.py)
// deleted the wrapper and NOTHING IN THE PACKAGE FAILED — not this test, not the anonymous-read
// sweep. Measured directly, both ways, one mutation at a time:
//
//	with requireSession:     401 {"error":"authentication required — sign in at /auth/login"}
//	without requireSession:  401 {"error":"authentication required — sign in at /auth/login"}
//
// BYTE-IDENTICAL, because `docsWorkspaceFor` → `trackWorkspaceFor` refuses a session-less caller
// with the same message before any dial. The route fails closed either way — that is defence in
// depth and it is genuinely two layers — but no black-box assertion can say which one refused, so
// this test asserts the PROPERTY (a stranger gets nothing; the upstream sees nothing) and claims
// nothing about the mechanism. authz_population_test.go records the identical situation for
// /api/docs/ai/ask; this is the second route in that class, and the second one to say so instead
// of letting a green imply a check it never made.
func TestDocsSearch_RequiresASession(t *testing.T) {
	u := newSearchUpstream(t, http.StatusOK, oneHitBody)
	a, _ := searchApp(t, u)

	rec := getSearch(t, a, nil, "q=auth")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous GET → %d, want 401", rec.Code)
	}
	if got := u.requests(); len(got) != 0 {
		t.Fatalf("upstream saw %v for an anonymous caller; it must see nothing", got)
	}
}

// It is a read. A write to it is refused by the method, not by the upstream.
// ⚠⚠ THE MOUNT IS ASSERTED IN THIS SAME TEST, AND WITHOUT IT THIS TEST COULD NOT FAIL.
// `handleAPINotFound` (lens.go) is mounted at `/api/` and answers **405 to any non-GET on any
// unmounted `/api/*` path**, so a non-GET loop cannot tell "this route refuses writes" from
// "this route does not exist". MEASURED: with the `/api/docs/search` mount removed from lens.go,
// ten tests in this package went red and this one stayed GREEN — and note the upstream-saw-nothing
// assertion below did not save it, because an unmounted route reaches no upstream either, so that
// arm is satisfied MORE easily by the defect than by the contract. The GET below is what makes the
// rest of this test about a route.
func TestDocsSearch_RefusesNonGET(t *testing.T) {
	u := newSearchUpstream(t, http.StatusOK, oneHitBody)
	a, sess := searchApp(t, u)

	// The route EXISTS: a GET reaches Docs.
	if rec := getSearch(t, a, sess, "q=auth"); rec.Code != http.StatusOK {
		t.Fatalf("GET /api/docs/search → %d (%s), want 200 — the 405s below prove nothing "+
			"about an unmounted route", rec.Code, strings.TrimSpace(rec.Body.String()))
	}
	// The baseline is that ONE forwarded GET, not zero: the loop must add nothing to it.
	mounted := len(u.requests())
	if mounted != 1 {
		t.Fatalf("upstream saw %v for the GET, want exactly one forwarded request", u.requests())
	}

	for _, m := range []string{http.MethodPost, http.MethodPatch, http.MethodDelete, http.MethodPut} {
		req := httptest.NewRequest(m, "/api/docs/search?q=auth", strings.NewReader(`{}`))
		req.AddCookie(sess)
		rec := httptest.NewRecorder()
		a.ServeHTTP(rec, req)
		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s → %d, want 405", m, rec.Code)
		}
	}
	if got := u.requests(); len(got) != mounted {
		t.Fatalf("upstream saw %v; the non-GET methods must add nothing to the GET above", got)
	}
}

// ⚠ THE FIRST OF THE TWO FINDINGS. An unrecognised `type` is refused HERE, because upstream
// answers it with a confident empty list.
// ⚠ THIS TEST WAS RENAMED, AND THE OLD NAME IS DELIBERATELY NOT WRITTEN HERE — see git history.
// It said upstream answers an unrecognised type with a confident empty list. A test NAME is a
// claim, and that one was false. talyvor-docs `d54d375` (#198) made it refuse with a 400 of its own, before either dispatch
// arm — so both the name and the message below asserted the opposite of what upstream does. The
// ASSERTIONS were and are correct: this route refuses, and its refusal names what IS accepted.
// Cited nowhere (checked by whole-tree grep before renaming). ⚠ AND WRITING THE OLD NAME IN THIS
// COMMENT REDDENED TestEveryCitedTestExists — correctly: a comment naming a test that does not
// exist is exactly what that guard is for, and the rename is what made it not exist. Third time a
// citation guard has caught this tab today; the fix is to describe the rename, not to spell it.
func TestDocsSearch_RefusesAnUnrecognisedTypeAndNamesWhatIsAccepted(t *testing.T) {
	u := newSearchUpstream(t, http.StatusOK, oneHitBody)
	a, sess := searchApp(t, u)

	for _, bad := range []string{"banana", "Fulltext", "full-text", "FULLTEXT", "sematic", "%20all", "all%20"} {
		rec := getSearch(t, a, sess, "q=auth&type="+bad)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("type=%q → %d, want 400. This route refuses before calling Docs; Docs refuses "+
				"it too since d54d375, so neither layer serves a mistyped type as an empty list.",
				bad, rec.Code)
			continue
		}
		var out map[string]string
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Errorf("type=%q: body is not JSON: %v", bad, err)
			continue
		}
		// The refusal must name what IS accepted — a 400 that does not is a dead end.
		for _, want := range []string{"all", "fulltext", "semantic"} {
			if !strings.Contains(out["error"], want) {
				t.Errorf("type=%q refusal %q does not name the accepted value %q", bad, out["error"], want)
			}
		}
	}
	if got := u.requests(); len(got) != 0 {
		t.Fatalf("upstream saw %v for an unrecognised type; the refusal must precede the dial", got)
	}
}

// The three values Docs recognises are forwarded, and an absent `type` is not invented.
func TestDocsSearch_ForwardsTheThreeTypesDocsRecognisesAndInventsNoDefault(t *testing.T) {
	u := newSearchUpstream(t, http.StatusOK, oneHitBody)
	a, sess := searchApp(t, u)

	for _, ok := range []string{"all", "fulltext", "semantic"} {
		if rec := getSearch(t, a, sess, "q=auth&type="+ok); rec.Code != http.StatusOK {
			t.Fatalf("type=%s → %d: %s", ok, rec.Code, rec.Body.String())
		}
	}
	if rec := getSearch(t, a, sess, "q=auth"); rec.Code != http.StatusOK {
		t.Fatalf("no type → %d: %s", rec.Code, rec.Body.String())
	}
	got := u.queries()
	if len(got) != 4 {
		t.Fatalf("upstream saw %d requests, want 4: %v", len(got), got)
	}
	for i, want := range []string{"type=all", "type=fulltext", "type=semantic"} {
		if !strings.Contains(got[i], want) {
			t.Errorf("query %d = %q, want it to carry %q", i, got[i], want)
		}
	}
	// ⚠ AN ABSENT type IS ABSENT ON THE WIRE. Upstream defaults it to "all" itself; writing a
	// default here would be a second author of the same rule, to drift from the day it changes.
	if strings.Contains(got[3], "type=") {
		t.Errorf("query with no type = %q; it must carry no type at all", got[3])
	}
}

// ⚠ THE SECOND FINDING. The merged window ends at 50 rows and says nothing when it does.
func TestDocsSearch_RefusesTheMergedWindowUpstreamCannotServe(t *testing.T) {
	u := newSearchUpstream(t, http.StatusOK, oneHitBody)
	a, sess := searchApp(t, u)

	// offset+limit > 50 on the TWO-SOURCE path: upstream truncates and nothing says so.
	for _, q := range []string{
		"q=auth&limit=10&offset=45",          // measured: 5 rows, silently short
		"q=auth&limit=10&offset=50",          // measured: 0 rows, walk ends cleanly
		"q=auth&limit=10&offset=90",          // measured: 0 rows
		"q=auth&limit=10&offset=45&type=all", // the same, said explicitly
		"q=auth&limit=50&offset=1&type=all",  // 51 > 50
	} {
		rec := getSearch(t, a, sess, q)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s → %d, want 400 (upstream serves a short page and calls it the end)", q, rec.Code)
			continue
		}
		var out map[string]string
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		if !strings.Contains(out["error"], "50") {
			t.Errorf("%s refusal %q does not name the 50-row window it is about", q, out["error"])
		}
	}
	if got := u.requests(); len(got) != 0 {
		t.Fatalf("upstream saw %v past the window; the refusal must precede the dial", got)
	}
}

// The refusal is exactly as wide as the defect: inside the window, and on a SINGLE source at any
// depth, the offset pages correctly and is forwarded.
func TestDocsSearch_AllowsTheOffsetsUpstreamActuallyPages(t *testing.T) {
	u := newSearchUpstream(t, http.StatusOK, oneHitBody)
	a, sess := searchApp(t, u)

	for _, q := range []string{
		"q=auth&limit=10&offset=40",               // measured: 10 rows, pg-40…pg-49 — exactly the window
		"q=auth&limit=10&offset=0",                // measured: 10 rows
		"q=auth&limit=10&offset=90&type=fulltext", // measured: 10 rows, pg-90…pg-99
		"q=auth&limit=10&offset=90&type=semantic", // single source: its own SQL OFFSET
	} {
		if rec := getSearch(t, a, sess, q); rec.Code != http.StatusOK {
			t.Errorf("%s → %d: %s", q, rec.Code, strings.TrimSpace(rec.Body.String()))
		}
	}
	got := u.queries()
	if len(got) != 4 {
		t.Fatalf("upstream saw %d requests, want 4: %v", len(got), got)
	}
	for i, want := range []string{"offset=40", "offset=0", "offset=90", "offset=90"} {
		if !strings.Contains(got[i], want) {
			t.Errorf("query %d = %q, want it to carry %q", i, got[i], want)
		}
	}
}

// The query is the whole point of the route and it travels unaltered, including the characters a
// naive concatenation would break.
func TestDocsSearch_ForwardsTheQueryAndSpaceFilterUnaltered(t *testing.T) {
	u := newSearchUpstream(t, http.StatusOK, oneHitBody)
	a, sess := searchApp(t, u)

	if rec := getSearch(t, a, sess, "q=auth+%26+authz+%3D+fun&space_id=sp-1"); rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	got := u.queries()
	if len(got) != 1 {
		t.Fatalf("upstream saw %d requests, want 1", len(got))
	}
	// Parsed back, not string-matched: what matters is the VALUE Docs decodes, not the encoding.
	vals, err := url.ParseQuery(got[0])
	if err != nil {
		t.Fatalf("upstream query %q does not parse: %v", got[0], err)
	}
	if vals.Get("q") != "auth & authz = fun" {
		t.Errorf("upstream q = %q, want %q", vals.Get("q"), "auth & authz = fun")
	}
	if vals.Get("space_id") != "sp-1" {
		t.Errorf("upstream space_id = %q, want sp-1", vals.Get("space_id"))
	}
}

// A parameter this route does not know is DROPPED rather than forwarded — the same rule
// docsPageList applies to `offset`: an upstream that ignores it renders as filtered.
func TestDocsSearch_DropsParametersDocsDoesNotRead(t *testing.T) {
	u := newSearchUpstream(t, http.StatusOK, oneHitBody)
	a, sess := searchApp(t, u)

	if rec := getSearch(t, a, sess, "q=auth&sort=rank&author=ng&highlight=false"); rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	got := u.queries()
	if len(got) != 1 {
		t.Fatalf("upstream saw %d requests, want 1", len(got))
	}
	for _, dropped := range []string{"sort", "author", "highlight"} {
		if strings.Contains(got[0], dropped+"=") {
			t.Errorf("upstream query %q carries %q, which Docs' Search handler never reads", got[0], dropped)
		}
	}
}

// Docs' own refusals pass through honestly — a two-character minimum is upstream's rule and this
// route does not re-implement it (a second author of the same number drifts from it).
func TestDocsSearch_PassesUpstreamsOwnRefusalThrough(t *testing.T) {
	u := newSearchUpstream(t, http.StatusBadRequest, `{"error":"query must be at least 2 characters"}`)
	a, sess := searchApp(t, u)

	rec := getSearch(t, a, sess, "q=a")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 forwarded from Docs", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "at least 2 characters") {
		t.Errorf("body = %q, want Docs' own sentence", rec.Body.String())
	}
	if got := u.requests(); len(got) != 1 {
		t.Fatalf("upstream saw %v, want the request to reach Docs so its own rule answers", got)
	}
}

// An unwired deployment answers 503 with no AI code — the same separation docs_ai_test.go pins,
// asserted here because THIS route has no AI_UNAVAILABLE of its own to be confused with.
func TestDocsSearch_UnwiredDeploymentAnswers503WithNoCode(t *testing.T) {
	a, sess := productApp(t, nil, nil)
	rec := getSearch(t, a, sess, "q=auth")
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("body is not JSON: %v (%s)", err, rec.Body.String())
	}
	if _, present := out["code"]; present {
		t.Errorf("the BFF's own \"not configured\" 503 carries code=%v; it must not", out["code"])
	}
}

// ⚠ THE REFUSAL THIS ROUTE SHIPS MAKES A FACTUAL CLAIM ABOUT ANOTHER REPOSITORY, AND THAT CLAIM
// EXPIRED — THE CONSTANT'S OWN COMMENT SAID IT WOULD.
//
// `docsSearchTypeRefusal` opens: "names the upstream FACT rather than a policy, so it expires the
// day the fact does." The fact was: talyvor-docs' Search handler runs neither half for an
// unrecognised type and answers 200 with an empty list, so a mistyped type is indistinguishable
// from a workspace with no matching documents. That sentence is written into the message a BROWSER
// receives.
//
// MEASURED at talyvor-docs `d54d375` (#198), in a read-only `git archive` export of the object
// store: `internal/search/handler.go` now answers
// `400 {"error":"type must be one of all, fulltext, semantic"}` for any value outside the closed
// set, BEFORE either dispatch arm. The day the fact expired is the day that merged.
//
// ⚠ WHY THIS ROUTE STILL REFUSES, so the constant is corrected rather than deleted: refusing here
// costs no upstream round trip, and it is the only refusal whose wording this repository controls.
// Belt-and-braces is a fine reason to keep a check; claiming to be the ONLY one is not.
//
// ⚠ AND THE REGISTER COULD NOT SEE IT, WHICH IS THE HALF THAT MATTERS. deploy/decision-expiry.sh
// carried this premise with a settle command pinning the two dispatch ARMS verbatim. My change
// upstream added a refusal ABOVE those arms and left them untouched — so the command still EXITS 0
// and reports "the premise holds" about a premise that is now false. That is the exact failure the
// register's own header warns about ("a command that exits 0 when the premise is FALSE turns
// 'someone will notice' into 'someone confirmed it'"), and it is fixed in the same change.
func TestDocsSearchTypeRefusal_DoesNotClaimUpstreamAnswers200(t *testing.T) {
	// MUST STAY GREEN: the actionable half of the sentence is the closed set, and it is unchanged.
	for _, want := range []string{"all", "fulltext", "semantic"} {
		if !strings.Contains(docsSearchTypeRefusal, want) {
			t.Fatalf("the refusal no longer names %q. The set is what makes this message "+
				"actionable; only the claim about upstream was wrong.", want)
		}
	}

	// THE FINDING. Each of these is a way the sentence asserts that upstream ACCEPTS the value and
	// answers emptily — which upstream stopped doing at talyvor-docs d54d375.
	for _, stale := range []string{
		"answers 200",
		"runs neither half",
		"indistinguishable from a workspace with no matching documents",
	} {
		if strings.Contains(docsSearchTypeRefusal, stale) {
			t.Errorf("the shipped refusal still tells a browser %q.\n"+
				"talyvor-docs REFUSES an unrecognised type with a 400 as of d54d375 — measured in "+
				"a read-only git archive export, internal/search/handler.go, before either "+
				"dispatch arm. This message is the one place this repository states that fact to a "+
				"user, and it states the opposite.", stale)
		}
	}
}
