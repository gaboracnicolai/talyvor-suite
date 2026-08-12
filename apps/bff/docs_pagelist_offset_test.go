package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// THE PAGE-LIST ROUTE OFFERED PAGING THE UPSTREAM CANNOT DO, AND THIS BFF ALREADY DECIDED
// WHAT TO DO ABOUT THAT ONE ROUTE OVER.
//
// ── WHAT WAS MEASURED (talyvor-docs, read-only, at a383c1b) ──────────────────────────────
//
//	internal/page/handler.go#List  parses ONE query key: `limit`. It builds a PageFilter and
//	                               never assigns Offset.
//	internal/page/store.go#List    binds `LIMIT $2 OFFSET $3` from filter.Limit / filter.Offset.
//
// A whole-repo census of `Offset` in talyvor-docs' Go tree returns THREE hits: the struct
// field declaration (store.go:112), the SQL bind (store.go:363), and an unrelated search test.
// `PageFilter.Offset` HAS NO WRITER — it is the zero value on every call, so the OFFSET in that
// statement is bound to 0 forever. The upstream page list cannot page, and nothing downstream
// can make it.
//
// The BFF nevertheless accepted `offset`, clamped it, and put it on the wire —
// `limit=100&offset=50` — under a comment that said it was "forwarded for contract-completeness
// but is a no-op upstream today". So a caller asking for the second page got the FIRST page,
// with a 200 and no way to tell. `BFF-GAPS.md` published that surface to the web area as
// `GET /api/docs/spaces/{spaceID}/pages?limit=&offset=`.
//
// ── WHY THIS IS NOT A NEW JUDGEMENT ──────────────────────────────────────────────────────
//
// track.go states this repo's rule, and enacts it for `labels`:
//
//	"A parameter the upstream ignores is worse than one it rejects: the reply RENDERS AS
//	 FILTERED while being unfiltered ... so `labels` gets an explicit refusal naming that
//	 fact, not a silent no-op (and not a forward that pretends to work)."
//
// Two routes in one BFF answered the same question in opposite directions. This file holds the
// docs route to the answer the repo already gave.
//
// ── THE SEAM, ENUMERATED RATHER THAN ASSUMED ─────────────────────────────────────────────
//
// Every BFF route that forwards a client-shaped query, checked against its upstream's source:
//
//	/api/tokens/history, /api/lxc/history  limit+offset  BOTH read (talyvor-lens cmd/lens/main.go)
//	/api/usage                             days          read (talyvor-lens internal/api/server.go#handleUsage)
//	/api/track/issues                      ten keys      all read (talyvor-track internal/issue/handler.go#List)
//	/api/docs/spaces/{spaceID}/pages       limit+offset  limit read, OFFSET NOT READ  ← this file
//
// One of four. The Ledger screen's paging is real; this route's was not.
//
// ── WHY THE EXISTING TESTS COULD NOT SEE IT ──────────────────────────────────────────────
//
// TestDocsPageList_ProjectsContentAway and TestDocsPageList_CapsLimitAt500 assert
// `strings.Contains(docs.rawQuery, "limit=50")`. A substring test on a query string is blind to
// every other parameter riding along with it. The assertions below are EQUALITIES on the whole
// forwarded query, which is the only shape that can see a parameter that should not be there.

// docsPageListReq drives one GET through the real handler chain and returns the recorder.
func docsPageListReq(t *testing.T, a *app, sess *http.Cookie, url string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, url, nil)
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)
	return rec
}

// TestDocsPageList_RefusesAnOffsetTheUpstreamCannotHonour: the key's PRESENCE is the claim, so
// every spelling of it is refused — including `offset=0`, which asks for the page the route does
// serve. A caller that sends the parameter believes the route pages; it does not, and the reply
// must say so rather than look like agreement.
//
// The refusal happens BEFORE the dial: an upstream that was asked at all would have served a
// first page that the caller reads as a second one.
func TestDocsPageList_RefusesAnOffsetTheUpstreamCannotHonour(t *testing.T) {
	for _, q := range []string{"?offset=100", "?offset=0", "?offset=", "?limit=50&offset=50", "?offset=abc"} {
		docs := newCaptureUpstream(t, `[{"id":"pg-1","title":"Runbook"}]`)
		a, sess := productApp(t, nil, docs)

		rec := docsPageListReq(t, a, sess, "/api/docs/spaces/sp-1/pages"+q)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: got %d (%s), want 400", q, rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "offset") {
			t.Fatalf("%s: the 400 does not name the parameter it refused: %s", q, rec.Body.String())
		}
		if docs.path != "" {
			t.Fatalf("%s: a refused request still reached the upstream at %q", q, docs.path)
		}
	}
}

// TestDocsPageList_ForwardsExactlyLimit pins the WHOLE forwarded query, not a substring of it.
// The clamp cases (default 100, floor 1, cap 500, junk → default) mirror talyvor-docs
// store.List's own bounds, so this states the upstream's contract rather than a wish.
func TestDocsPageList_ForwardsExactlyLimit(t *testing.T) {
	cases := []struct{ url, want string }{
		{"/api/docs/spaces/sp-1/pages", "limit=100"},
		{"/api/docs/spaces/sp-1/pages?limit=25", "limit=25"},
		{"/api/docs/spaces/sp-1/pages?limit=9999", "limit=500"},
		{"/api/docs/spaces/sp-1/pages?limit=abc", "limit=100"},
		{"/api/docs/spaces/sp-1/pages?limit=0", "limit=1"},
		{"/api/docs/spaces/sp-1/pages?limit=-7", "limit=1"},
		// Every other client key is dropped, as it always was — the refusal above is specific to
		// `offset`, the one that would misrepresent the RESULT rather than merely be ignored.
		{"/api/docs/spaces/sp-1/pages?evil=DROP+TABLE&limit=3", "limit=3"},
	}
	for _, c := range cases {
		docs := newCaptureUpstream(t, `[]`)
		a, sess := productApp(t, nil, docs)

		rec := docsPageListReq(t, a, sess, c.url)

		if rec.Code != http.StatusOK {
			t.Fatalf("%s: got %d (%s), want 200", c.url, rec.Code, rec.Body.String())
		}
		if docs.path != "/v1/spaces/sp-1/pages" {
			t.Fatalf("%s: upstream path = %q, want /v1/spaces/sp-1/pages", c.url, docs.path)
		}
		if docs.rawQuery != c.want {
			t.Fatalf("%s: forwarded query = %q, want exactly %q", c.url, docs.rawQuery, c.want)
		}
	}
}

// TestBFFGaps_DoesNotAdvertiseTheParameterThisRouteRefuses closes the other half: the route
// contract is PUBLISHED in the web area's BFF-GAPS.md, and a document that still offers `offset=`
// is the same false promise one indirection away.
//
// It reads the ROUTE CELL — the first backticked span of the row — not the whole row, because the
// row's prose column now EXPLAINS the refusal and a whole-row scan would fail on its own
// explanation. Both anchors are asserted before the negative: exactly one page-list row must
// exist and it must still name `limit=`, so a renamed, reworded or deleted row fails LOUDLY
// instead of passing vacuously.
func TestBFFGaps_DoesNotAdvertiseTheParameterThisRouteRefuses(t *testing.T) {
	const gaps = "../web/src/areas/docs/BFF-GAPS.md"
	b, err := os.ReadFile(gaps)
	if err != nil {
		t.Fatalf("cannot read %s: %v", gaps, err)
	}
	var rows []string
	for _, line := range strings.Split(string(b), "\n") {
		if strings.Contains(line, "GET /api/docs/spaces/{spaceID}/pages") &&
			!strings.Contains(line, "{pageID}") {
			rows = append(rows, line)
		}
	}
	if len(rows) != 1 {
		t.Fatalf("want exactly 1 page-list row in %s, found %d — the anchor moved and this guard "+
			"would have passed on nothing", gaps, len(rows))
	}
	cell, ok := firstBacktickSpan(rows[0])
	if !ok {
		t.Fatalf("page-list row has no backticked route cell: %s", rows[0])
	}
	if !strings.Contains(cell, "limit=") {
		t.Fatalf("page-list route cell %q no longer names limit= — it stopped describing the "+
			"served surface, so its silence about offset proves nothing", cell)
	}
	if strings.Contains(cell, "offset") {
		t.Fatalf("BFF-GAPS.md still advertises offset on the page list: %q — the route refuses it "+
			"(talyvor-docs' List handler never reads it)", cell)
	}
}

// firstBacktickSpan returns the text between the first pair of backticks in s.
func firstBacktickSpan(s string) (string, bool) {
	i := strings.Index(s, "`")
	if i < 0 {
		return "", false
	}
	j := strings.Index(s[i+1:], "`")
	if j < 0 {
		return "", false
	}
	return s[i+1 : i+1+j], true
}
