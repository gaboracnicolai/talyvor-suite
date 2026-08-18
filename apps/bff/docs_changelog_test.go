package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// THE CHANGELOG-GENERATE ROUTE — the fifth W1.7 control to reach a browser, and the FIRST one
// that is a durable WRITE rather than a metered read.
//
// ⚠⚠ WHAT IT COSTS IS NOT MONEY, AND THAT IS WHY THE REFUSAL LOOKS DIFFERENT FROM THE OTHER FOUR.
// Ask, search, summarise and translate all buy a Lens completion. This one buys NOTHING from
// Lens: it is not an AI call at all. `GenerateFromIssues` groups Track issues by label
// (talyvor-docs internal/changelog/store.go#GenerateFromIssues). Its cost is a ROW — a changelog
// entry that persists, that a later PATCH can retitle, and that a later `…/publish` puts into the
// workspace's RSS feed (internal/changelog/handler.go#Handler.Feed → Store.GetPublicFeed).
//
// ⚠⚠ THE FINDING, MEASURED BY RUNNING talyvor-docs' OWN GENERATE ROUTE RATHER THAN READING IT.
// tab-6d1a, talyvor-docs at ce997ff, in a `git archive` scratch export in /tmp — that repository
// is held by tab-b9d7 and was NEVER written to. The REAL route (changelog.Handler.Mount), the
// REAL permission.Enforcer, REAL Postgres, and the REAL trackintegration.Client pointed at a
// Track that COUNTS the HTTP requests that actually leave the client:
//
//	{"version":"v1.0.0","issue_ids":[]}   → 201 Created, rows 0→1, track HTTP +0
//	{"version":"v1.1.0"}                  → 201 Created, rows 1→2, track HTTP +0
//	{"version":"v1.2.0","issue_ids":null} → 201 Created, rows 2→3, track HTTP +0
//
// and the row the first one wrote, read back with SQL against the pool:
//
//	version="v1.0.0" title="v1.0.0" summary="Generated from 0 issues" type="improvement"
//	content={"type":"doc","content":[{"content":[{"text":"No issues.","type":"text"}],…}]}
//
// There is NO empty-list precondition anywhere on that path. `GenerateFromIssues` normalises a
// nil slice to `[]string{}` and hands it straight to `CreateEntry`, whose four preconditions are
// about the version, the title, the type and the pool — none about whether the entry documents
// anything. So "generate a changelog entry" with nothing selected is a real, durable,
// publishable row whose body is the words "No issues.", and it answers 201 Created.
//
// A BUTTON IS WHAT TURNS THAT FROM A THING CURL CAN DO INTO A THING A CLICK DOES, so the refusal
// lands with the button: 400, no upstream call, no row.
//
// ⚠ THE REFUSAL IS EXACTLY AS WIDE AS THE MEASUREMENT — an empty issue list, and nothing else.
// In particular this route does NOT validate the version, because measured on the same harness
// the upstream ALREADY does:
//
//	{"version":"","issue_ids":["iss-a"]}       → 400 {"error":"changelog: invalid version \"\""}
//	{"version":"   ","issue_ids":["iss-a"]}    → 400 {"error":"changelog: invalid version \"   \""}
//	{"version":"banana","issue_ids":["iss-a"]} → 400 {"error":"changelog: invalid version \"banana\""}
//	{"version":"2026-08-18","issue_ids":["iss-a"]} → 201 (the date form is legal, v-semver is too)
//
// This repo's rule is docsPageList's: a parameter the upstream IGNORES is worse than one it
// REJECTS. Upstream rejects this one, in four measured shapes, so a second version rule written
// here would be a proxy inventing a vocabulary — and it would drift the day Docs widens the
// regexp. The refusal that IS here exists because upstream has no rule at all for it.
//
// ⚠ MEASURED ON THE WAY PAST, REPORTED NOT FIXED (talyvor-docs is another tab's repo):
// an UNRESOLVABLE issue costs Track TWICE. Same harness, same client:
//
//	3 KNOWN issues   → 2 Track HTTP requests (the third was already warm from an earlier row)
//	3 UNKNOWN issues → 6 Track HTTP requests — 2N
//	the same issue 4× → 0 (warm)
//
// `Client.fetchIssue` caches only on SUCCESS, and `GenerateFromIssues` reads every issue TWICE
// (once in buildContent for the body, once in dominantType for the badge). So `lookupIssue`'s
// comment — "the client caches per (workspaceID|issueID), so the badge pass is served warm
// rather than re-fetched" — is true for issues that resolve and FALSE for issues that do not,
// which is the population that is large exactly when Track is unwell. Also measured: a request
// with an INVALID version still performs its Track lookups before `CreateEntry` rejects it, so a
// rejected generate is not a free one.

// changelogUpstream stands in for Docs registering exactly the ONE pattern this route addresses,
// transcribed from talyvor-docs internal/changelog/handler.go#Handler.Mount:
//
//	r.With(h.pageEnf.Require(permission.AccessEdit)).
//	    Post("/spaces/{spaceID}/pages/{pageID}/changelog/generate", h.Generate)
type changelogUpstream struct {
	srv     *httptest.Server
	mu      chan struct{}
	seen    []string
	status  int
	body    string
	gotAuth string
	gotBody string
}

func newChangelogUpstream(t *testing.T, status int, body string) *changelogUpstream {
	t.Helper()
	u := &changelogUpstream{mu: make(chan struct{}, 1), status: status, body: body}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/spaces/{spaceID}/pages/{pageID}/changelog/generate",
		func(w http.ResponseWriter, r *http.Request) {
			raw, _ := io.ReadAll(r.Body)
			u.mu <- struct{}{}
			u.seen = append(u.seen, r.Method+" "+r.URL.Path)
			u.gotAuth = r.Header.Get("X-Gateway-Auth")
			u.gotBody = string(raw)
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

func (u *changelogUpstream) requests() []string {
	u.mu <- struct{}{}
	defer func() { <-u.mu }()
	return append([]string(nil), u.seen...)
}

func changelogApp(t *testing.T, u *changelogUpstream) (*app, *http.Cookie) {
	t.Helper()
	return productApp(t, &captureUpstream{srv: u.srv}, &captureUpstream{srv: u.srv})
}

func postGenerate(t *testing.T, a *app, sess *http.Cookie, spaceID, pageID, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost,
		"/api/docs/spaces/"+spaceID+"/pages/"+pageID+"/changelog/generate", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if sess != nil {
		req.AddCookie(sess)
	}
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	return rec
}

// docsGenerateWire is talyvor-docs' generate request struct, TRANSCRIBED FIELD FOR FIELD from
// internal/changelog/handler.go#generateBody including its json tags. Decoding the SENT body
// through the upstream's own shape is what makes a wrong key visible — the lesson
// docs_translate_test.go paid for.
type docsGenerateWire struct {
	Version     string   `json:"version"`
	IssueIDs    []string `json:"issue_ids"`
	WorkspaceID string   `json:"workspace_id"`
}

const generated201 = `{"id":"cl-1","page_id":"pg-1","version":"v2.0.0","title":"v2.0.0",` +
	`"summary":"Generated from 2 issues","type":"feature","issue_ids":["iss-a","iss-b"]}`

func TestDocsChangelogGenerate_ForwardsToTheSpaceScopedUpstreamPath(t *testing.T) {
	u := newChangelogUpstream(t, http.StatusCreated, generated201)
	a, sess := changelogApp(t, u)

	rec := postGenerate(t, a, sess, "sp-1", "pg-1", `{"version":"v2.0.0","issue_ids":["iss-a","iss-b"]}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST generate → %d: %s", rec.Code, strings.TrimSpace(rec.Body.String()))
	}

	// ⚠ THE UPSTREAM PATH IS SPACE-SCOPED, NOT WORKSPACE-SCOPED, and it is the ONLY Docs AI-family
	// route in this BFF that is. Ask/summarise/translate all go to /v1/workspaces/{ws}/…; this one
	// goes to /v1/spaces/{spaceID}/pages/{pageID}/…, because the object it writes to is a PAGE and
	// the gate upstream is pageEnf on {pageID}. docsWorkspacePath is deliberately not used here.
	if got := u.requests(); len(got) != 1 || got[0] != "POST /v1/spaces/sp-1/pages/pg-1/changelog/generate" {
		t.Fatalf("upstream saw %v, want [POST /v1/spaces/sp-1/pages/pg-1/changelog/generate]", got)
	}
	if u.gotAuth != testDocsSecret {
		t.Errorf("X-Gateway-Auth = %q, want the docs secret attached server-side", u.gotAuth)
	}

	var sent docsGenerateWire
	if err := json.Unmarshal([]byte(u.gotBody), &sent); err != nil {
		t.Fatalf("upstream body is not JSON: %v (%s)", err, u.gotBody)
	}
	if sent.Version != "v2.0.0" {
		t.Errorf("version arrived as %q, want v2.0.0 — decoded through docs' OWN struct tags "+
			"(json:\"version\"), so a %q here means the key sent does not bind. Sent: %s",
			sent.Version, sent.Version, u.gotBody)
	}
	if len(sent.IssueIDs) != 2 || sent.IssueIDs[0] != "iss-a" || sent.IssueIDs[1] != "iss-b" {
		t.Errorf("issue_ids arrived as %v, want [iss-a iss-b]. Sent: %s", sent.IssueIDs, u.gotBody)
	}
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("response is not JSON: %v (%s)", err, rec.Body.String())
	}
	if out["id"] != "cl-1" {
		t.Errorf("id = %v, want the upstream body streamed through verbatim", out["id"])
	}
}

// ⚠⚠ THE FINDING, PINNED. An empty issue list is 201 Created and a durable publishable row
// upstream. Refused here, and NOTHING is written — no upstream call at all.
func TestDocsChangelogGenerate_EmptyIssueListIsRefusedAndWritesNothing(t *testing.T) {
	for _, tc := range []struct{ name, body string }{
		{"empty array", `{"version":"v1.0.0","issue_ids":[]}`},
		{"absent", `{"version":"v1.0.0"}`},
		{"null", `{"version":"v1.0.0","issue_ids":null}`},
		{"blank strings only", `{"version":"v1.0.0","issue_ids":["","   ","\t"]}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			u := newChangelogUpstream(t, http.StatusCreated, `{"id":"should never be reached"}`)
			a, sess := changelogApp(t, u)
			rec := postGenerate(t, a, sess, "sp-1", "pg-1", tc.body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("%s issue list → %d, want 400 (body: %s)", tc.name, rec.Code,
					strings.TrimSpace(rec.Body.String()))
			}
			if len(u.requests()) != 0 {
				t.Errorf("a generate with no issues reached the upstream — measured, that is a "+
					"201 Created and a durable changelog row whose body is the words \"No "+
					"issues.\", publishable to the workspace RSS feed: %v (body %s)",
					u.requests(), u.gotBody)
			}
			// The refusal must not read as a broken upstream: nothing is wrong with Docs here.
			if low := strings.ToLower(rec.Body.String()); strings.Contains(low, "unreachable") {
				t.Errorf("the refusal blames the upstream, which is healthy and was never "+
					"dialled: %s", strings.TrimSpace(rec.Body.String()))
			}
		})
	}
}

// ⚠ THE OTHER DIRECTION, AND IT IS THE CONTROL ON THE REFUSAL'S WIDTH. A version this route
// thinks is nonsense is still FORWARDED, because upstream has a real rule for it and answers
// with its own words. A second rule here would drift from that one.
func TestDocsChangelogGenerate_DoesNotInventAVersionRule(t *testing.T) {
	for _, tc := range []struct{ name, version string }{
		{"upstream rejects banana", "banana"},
		{"upstream accepts a date", "2026-08-18"},
		{"upstream accepts bare semver", "1.2.3"},
		{"upstream rejects blank", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			u := newChangelogUpstream(t, http.StatusBadRequest, `{"error":"changelog: invalid version"}`)
			a, sess := changelogApp(t, u)
			body, err := json.Marshal(map[string]any{"version": tc.version, "issue_ids": []string{"iss-a"}})
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			postGenerate(t, a, sess, "sp-1", "pg-1", string(body))
			if len(u.requests()) != 1 {
				t.Fatalf("version %q was judged HERE instead of upstream (upstream calls: %v). "+
					"Measured, talyvor-docs answers this one itself — 400 with its own message "+
					"for the three invalid shapes and 201 for the two legal ones — so a rule in "+
					"this proxy would be a second author of a vocabulary it does not own.",
					tc.version, u.requests())
			}
			var sent docsGenerateWire
			if err := json.Unmarshal([]byte(u.gotBody), &sent); err != nil {
				t.Fatalf("upstream body is not JSON: %v (%s)", err, u.gotBody)
			}
			if sent.Version != tc.version {
				t.Errorf("version arrived as %q, want %q verbatim", sent.Version, tc.version)
			}
		})
	}
}

// ⚠ THE WORKSPACE IS NEVER THE BROWSER'S TO NAME. Upstream overrides `workspace_id` from the
// page's own context (handler.go#Generate: `in.WorkspaceID = ws`) — measured, a body naming
// `ws_ATTACKER` still wrote into the caller's real workspace and answered 201. So forwarding the
// field would change nothing upstream, which is exactly why it must not be forwarded: a field
// that travels and is ignored is decoration a reader can mistake for authority. This BFF builds
// the body from the two fields that are content, and drops the one that is not.
func TestDocsChangelogGenerate_DropsACallerNamedWorkspace(t *testing.T) {
	u := newChangelogUpstream(t, http.StatusCreated, generated201)
	a, sess := changelogApp(t, u)

	rec := postGenerate(t, a, sess, "sp-1", "pg-1",
		`{"version":"v2.0.0","issue_ids":["iss-a"],"workspace_id":"ws_ATTACKER"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST generate → %d: %s", rec.Code, strings.TrimSpace(rec.Body.String()))
	}
	var loose map[string]any
	if err := json.Unmarshal([]byte(u.gotBody), &loose); err != nil {
		t.Fatalf("upstream body is not a JSON object: %v (%s)", err, u.gotBody)
	}
	if _, present := loose["workspace_id"]; present {
		t.Errorf("workspace_id reached the upstream: %s — upstream ignores it, so it is a field "+
			"that looks like tenancy and is not", u.gotBody)
	}
	if strings.Contains(u.gotBody, "ws_ATTACKER") {
		t.Errorf("a caller-named workspace travelled to the upstream: %s", u.gotBody)
	}
}

func TestDocsChangelogGenerate_OnlyPOST(t *testing.T) {
	for _, m := range []string{http.MethodGet, http.MethodPatch, http.MethodDelete, http.MethodPut} {
		t.Run(m, func(t *testing.T) {
			u := newChangelogUpstream(t, http.StatusCreated, generated201)
			a, sess := changelogApp(t, u)
			req := httptest.NewRequest(m, "/api/docs/spaces/sp-1/pages/pg-1/changelog/generate", nil)
			req.AddCookie(sess)
			rec := httptest.NewRecorder()
			a.ServeHTTP(rec, req)
			if rec.Code != http.StatusMethodNotAllowed {
				t.Errorf("%s → %d, want 405", m, rec.Code)
			}
			if len(u.requests()) != 0 {
				t.Errorf("%s reached the upstream: %v", m, u.requests())
			}
		})
	}
}

// ⚠⚠ THIS TEST'S GREEN DOES NOT PROVE THE GATE IS CHECKED, AND CONTROL C6 IS WHY IT SAYS SO
// INSTEAD OF IMPLYING OTHERWISE. The comment that stood here first claimed this route was the
// fourth in the "three byte-identical layers" class that /api/docs/ai/ask, /api/docs/search and
// /api/docs/pages/{id}/summarize belong to. THAT WAS WRONG, and the control refuted it rather
// than a reading confirming it. Unlike those three, this handler never calls `docsWorkspaceFor`
// at all — its upstream path is space-scoped, so it has no workspace to resolve. It has TWO
// gates, not three: `requireSession`, and `forwardProduct`'s own `sessionFrom` at the very end.
//
// MEASURED with `requireSession` removed from the registration, one mutation alone:
//
//	anonymous POST, VALID body → 401. forwardProduct's sessionFrom refuses, so THIS TEST PASSES
//	                             with the wrapper deleted — it cannot tell the two apart.
//	anonymous POST, EMPTY body → 400 {"error":"choose at least one issue to generate this entry
//	                             from"} — MY OWN refusal, i.e. THE HANDLER RAN FOR A STRANGER
//	                             and answered from product logic instead of from a gate.
//
// That second row is the `/api/pooling` shape `authz_population_test.go` records, created here by
// this route's own precondition sitting in front of the remaining gate. Nothing is open today —
// `requireSession` is present and is load-bearing — but the assertion that would NOTICE it going
// missing is `TestEveryMountedRoute_RefusesAnonymousWrite` (the sweep #224 added), NOT this test,
// precisely because that sweep sends the empty body this handler answers first. The green below
// is worth having (a stranger really is refused and really does not reach Docs); it is evidence
// about the OUTCOME and not about which layer produced it.
func TestDocsChangelogGenerate_RefusesAnonymously(t *testing.T) {
	u := newChangelogUpstream(t, http.StatusCreated, generated201)
	a, _ := changelogApp(t, u)
	rec := postGenerate(t, a, nil, "sp-1", "pg-1", `{"version":"v2.0.0","issue_ids":["iss-a"]}`)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous generate → %d, want 401 (body: %s)", rec.Code,
			strings.TrimSpace(rec.Body.String()))
	}
	if len(u.requests()) != 0 {
		t.Errorf("an anonymous generate reached Docs and would have WRITTEN a row: %v", u.requests())
	}
}

func TestDocsChangelogGenerate_OversizeBodyIsRefusedAsTooLarge(t *testing.T) {
	u := newChangelogUpstream(t, http.StatusCreated, generated201)
	a, sess := changelogApp(t, u)
	// A list of issue ids is not a document. The cap is the ASK cap, not the page cap — see
	// docs_changelog.go for why this route does not borrow maxDocsBody.
	huge := `{"version":"v1.0.0","issue_ids":["` + strings.Repeat("i", maxDocsAskBody+1) + `"]}`
	rec := postGenerate(t, a, sess, "sp-1", "pg-1", huge)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversize generate → %d, want 413 (body: %s)", rec.Code,
			strings.TrimSpace(rec.Body.String()))
	}
	if len(u.requests()) != 0 {
		t.Errorf("an oversize generate reached the upstream: %v", u.requests())
	}
	if low := strings.ToLower(rec.Body.String()); strings.Contains(low, "unreachable") {
		t.Errorf("a 413 was reported as an upstream failure, which is a false statement about a "+
			"healthy upstream: %s", strings.TrimSpace(rec.Body.String()))
	}
}

func TestDocsChangelogGenerate_BadJSONIsRefusedHere(t *testing.T) {
	u := newChangelogUpstream(t, http.StatusCreated, generated201)
	a, sess := changelogApp(t, u)
	rec := postGenerate(t, a, sess, "sp-1", "pg-1", `{`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("bad json → %d, want 400 (body: %s)", rec.Code, strings.TrimSpace(rec.Body.String()))
	}
	if len(u.requests()) != 0 {
		t.Errorf("a malformed generate reached the upstream: %v", u.requests())
	}
}
