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

// TRACK'S ISSUE SEARCH, AND WHY THE ROUTE IS MORE THAN A FORWARD.
//
// ⚠ EVERY FINDING BELOW WAS MEASURED BY RUNNING talyvor-track's OWN `ai.Handler.SemanticSearch`,
// NOT BY READING IT. At track `b6fec98`, in a scratch copy (`git archive HEAD | tar -x` into /tmp;
// that repository was held by tab-7b2c and was never written to), the real handler was driven over
// a recording full-text backend with the engine unconfigured — no mint credential, i.e. this
// deployment. The bytes:
//
//	?q=auth       AI off, backend matches      → 200 [ …one issue… ]      backend called once
//	?q=auth       AI off, backend matches none → 200 []                   backend called once
//	?q=auth       AI off, NO BACKEND WIRED     → 200 []                   nothing called
//	?q=auth       AI on,  vector path fails    → 200 [ …one issue… ]      backend called once
//	?q=   (blank) AI off, backend matches      → 200 [ …one issue… ]      backend called, q="   "
//	(no q)                                     → 400 {"code":"MISSING_QUERY"}
//	?q=auth&limit=99999999                     → 200, and 99999999 reaches the backend
//
// ⚠⚠ THE RESPONSE IS A BARE ARRAY. There is no envelope, no per-row source tag, and therefore NO
// FIELD ANYWHERE that says which of those paths served the answer. Rows 1 and 4 above are
// BYTE-IDENTICAL: "the semantic half ran and fell back" and "there is no semantic half here" are
// the same response. So is row 3 against a genuine no-match — a deployment with no search backend
// at all reports "nothing matched" forever, 200. This is the Docs finding one product over
// (docs_search.go) with the evidence removed: Docs at least tags each row `fulltext`/`semantic`/
// `both`, so a positive claim is available there. Here nothing can ever prove the semantic half
// ran, which is why the card this route feeds says nothing about it at all.
//
// ⚠ WHAT IS REFUSED HERE AND WHY EACH ONE IS EXACTLY AS WIDE AS ITS MEASUREMENT: a blank query
// (upstream refuses `q=""` and accepts `q="   "`, buying a real `websearch_to_tsquery` scan for a
// whitespace box); an unbounded limit (upstream's `Atoi` puts whatever it parses on the query and
// only the full-text store clamps it — the vector path formats it straight into `LIMIT $3`); and
// any third parameter, on this repo's docsPageList rule.

// trackSearchUpstream stands in for Track with exactly the ONE pattern this route addresses —
// `GET /v1/workspaces/{wsID}/issues/semantic-search`, transcribed from talyvor-track
// internal/ai/handler.go Mount — so a request that addresses a path Track does not register 404s
// here exactly as it would on the box. It counts calls, because "no upstream call" is the claim
// half these tests make and a status code cannot support it.
type trackSearchUpstream struct {
	srv      *httptest.Server
	gate     chan struct{}
	seen     []string
	gotQuery []string
	status   int
	body     string
}

func newTrackSearchUpstream(t *testing.T, status int, body string) *trackSearchUpstream {
	t.Helper()
	u := &trackSearchUpstream{gate: make(chan struct{}, 1), status: status, body: body}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/workspaces/{wsID}/issues/semantic-search", func(w http.ResponseWriter, r *http.Request) {
		u.gate <- struct{}{}
		u.seen = append(u.seen, r.Method+" "+r.URL.Path)
		u.gotQuery = append(u.gotQuery, r.URL.RawQuery)
		<-u.gate
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

func (u *trackSearchUpstream) requests() []string {
	u.gate <- struct{}{}
	defer func() { <-u.gate }()
	return append([]string(nil), u.seen...)
}

func (u *trackSearchUpstream) queries() []string {
	u.gate <- struct{}{}
	defer func() { <-u.gate }()
	return append([]string(nil), u.gotQuery...)
}

func trackSearchApp(t *testing.T, u *trackSearchUpstream) (*app, *http.Cookie) {
	t.Helper()
	return productApp(t, &captureUpstream{srv: u.srv}, nil)
}

func getTrackSearch(t *testing.T, a *app, sess *http.Cookie, rawQuery string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/track/issues/search?"+rawQuery, nil)
	if sess != nil {
		req.AddCookie(sess)
	}
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	return rec
}

const oneIssueBody = `[{"id":"iss-1","identifier":"ENG-1","title":"auth is broken",` +
	`"status":"in_progress","priority":2,"ai_cost_usd":0.0125,"ai_tokens":1840,` +
	`"updated_at":"2026-08-18T10:00:00Z"}]`

// ⚠ THE ROUTE HAS TO WIN AGAINST `/api/track/issues/{id}`, WHICH IS REGISTERED ON THE SAME MUX.
// If the wildcard won, a search would be served as a request for the issue whose id is the literal
// string "search" — a 404 from the detail route, which reads exactly like "no such issue" and not
// at all like "this app's search never leaves the building". Nothing else in this package asserts
// that precedence, so it is asserted rather than trusted to net/http's specificity rules.
func TestTrackSearch_AddressesTrackSearchPathAndBeatsTheDetailWildcard(t *testing.T) {
	u := newTrackSearchUpstream(t, http.StatusOK, oneIssueBody)
	a, sess := trackSearchApp(t, u)

	rec := getTrackSearch(t, a, sess, "q=auth")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/track/issues/search → %d: %s", rec.Code, strings.TrimSpace(rec.Body.String()))
	}
	got := u.requests()
	if len(got) != 1 || got[0] != "GET /v1/workspaces/track-ws-7/issues/semantic-search" {
		t.Fatalf("upstream saw %v, want [GET /v1/workspaces/track-ws-7/issues/semantic-search] — "+
			"the detail wildcard served this, or the path is wrong", got)
	}
}

// ⚠⚠ THE REFUSAL THIS ROUTE EXISTS FOR. Upstream refuses `q=""` (400 MISSING_QUERY) and does NOT
// refuse `q="   "` — measured: it reaches the full-text backend as the literal query "   " and
// answers 200. A whitespace box is not a search, and sending one buys a real Postgres scan to be
// told nothing.
func TestTrackSearch_RefusesABlankQueryWithoutDialling(t *testing.T) {
	for _, q := range []string{"", "%20%20%20", "%09", "%0A", "+"} {
		u := newTrackSearchUpstream(t, http.StatusOK, oneIssueBody)
		a, sess := trackSearchApp(t, u)
		rec := getTrackSearch(t, a, sess, "q="+q)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("q=%q → %d, want 400 (%s)", q, rec.Code, strings.TrimSpace(rec.Body.String()))
		}
		if got := u.requests(); len(got) != 0 {
			t.Errorf("q=%q: upstream saw %v — a refusal that still dials has refused nothing", q, got)
		}
	}
}

// THE MUST-STAY-GREEN COMPANION. Without it a refusal that fired on every query would pass the
// test above, and a fix would be indistinguishable from an outage.
func TestTrackSearch_ARealQueryIsForwardedVerbatim(t *testing.T) {
	u := newTrackSearchUpstream(t, http.StatusOK, oneIssueBody)
	a, sess := trackSearchApp(t, u)

	rec := getTrackSearch(t, a, sess, "q="+url.QueryEscape("  auth broken  "))
	if rec.Code != http.StatusOK {
		t.Fatalf("→ %d: %s", rec.Code, strings.TrimSpace(rec.Body.String()))
	}
	qs := u.queries()
	if len(qs) != 1 {
		t.Fatalf("upstream saw %d requests, want 1", len(qs))
	}
	v, err := url.ParseQuery(qs[0])
	if err != nil {
		t.Fatal(err)
	}
	// TRIMMED, not forwarded raw: the trim is what makes the blank refusal above meaningful, so the
	// string this route judged has to be the string Track searches for. Anything else and the two
	// disagree about what the query was.
	if got := v.Get("q"); got != "auth broken" {
		t.Errorf("q on the wire = %q, want %q", got, "auth broken")
	}
}

// ⚠ THE LIMIT IS SENT EXPLICITLY ON EVERY REQUEST — the same argument docs_search.go makes: the
// bound this route reasoned about has to be the bound Track serves, or the day the upstream default
// moves this route is bounding one window while Track serves another.
func TestTrackSearch_SendsAnExplicitBoundedLimit(t *testing.T) {
	cases := []struct{ in, want string }{
		{"", "25"},         // Track's own default (ai/engine.go), restated on the wire
		{"5", "5"},         // in range, honoured
		{"0", "1"},         // upstream substitutes 25 for this; a page of zero rows is not a request
		{"-5", "1"},        //
		{"abc", "25"},      // unparseable ⇒ the default, never a silent 0
		{"99999999", "25"}, // MEASURED: upstream's Atoi forwards this into the query it runs
	}
	for _, c := range cases {
		u := newTrackSearchUpstream(t, http.StatusOK, oneIssueBody)
		a, sess := trackSearchApp(t, u)
		rec := getTrackSearch(t, a, sess, "q=auth&limit="+c.in)
		if rec.Code != http.StatusOK {
			t.Fatalf("limit=%q → %d", c.in, rec.Code)
		}
		v, _ := url.ParseQuery(u.queries()[0])
		if got := v.Get("limit"); got != c.want {
			t.Errorf("limit=%q: wire limit = %q, want %q", c.in, got, c.want)
		}
	}
}

// ⚠ A PARAMETER THE UPSTREAM IGNORES IS WORSE THAN ONE IT REJECTS — this repo's docsPageList rule.
// Track's SemanticSearch reads exactly two keys, `q` and `limit`; a third would travel to be
// ignored and the reply would render as filtered while being unfiltered.
func TestTrackSearch_RefusesAnyOtherParameter(t *testing.T) {
	for _, p := range []string{"type=semantic", "offset=10", "status=open", "team_id=t1", "sort=rank"} {
		u := newTrackSearchUpstream(t, http.StatusOK, oneIssueBody)
		a, sess := trackSearchApp(t, u)
		rec := getTrackSearch(t, a, sess, "q=auth&"+p)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s → %d, want 400", p, rec.Code)
		}
		if got := u.requests(); len(got) != 0 {
			t.Errorf("%s: upstream saw %v", p, got)
		}
	}
}

// A key given twice: upstream reads only the first, so the second is a parameter the caller
// believes is applied. The same rule trackIssuesQuery already enforces on the list route.
func TestTrackSearch_RefusesARepeatedParameter(t *testing.T) {
	u := newTrackSearchUpstream(t, http.StatusOK, oneIssueBody)
	a, sess := trackSearchApp(t, u)
	rec := getTrackSearch(t, a, sess, "q=auth&q=other")
	if rec.Code != http.StatusBadRequest {
		t.Errorf("→ %d, want 400", rec.Code)
	}
	if got := u.requests(); len(got) != 0 {
		t.Errorf("upstream saw %v", got)
	}
}

func TestTrackSearch_OnlyGET(t *testing.T) {
	for _, m := range []string{http.MethodPost, http.MethodPatch, http.MethodDelete, http.MethodPut} {
		u := newTrackSearchUpstream(t, http.StatusOK, oneIssueBody)
		a, sess := trackSearchApp(t, u)
		req := httptest.NewRequest(m, "/api/track/issues/search?q=auth", nil)
		req.AddCookie(sess)
		rec := httptest.NewRecorder()
		a.ServeHTTP(rec, req)
		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s → %d, want 405", m, rec.Code)
		}
		if got := u.requests(); len(got) != 0 {
			t.Errorf("%s: upstream saw %v", m, got)
		}
	}
}

// ⚠ THE OUTCOME A STRANGER GETS, and this test claims only that. Like the sibling product routes,
// more than one layer here answers 401 with the same bytes, so a green does not prove WHICH layer
// refused — track_ai.go and authz_population_test.go already record that property for two other
// routes. What it does prove is that no anonymous request reaches Track.
func TestTrackSearch_RefusesAnonymously(t *testing.T) {
	u := newTrackSearchUpstream(t, http.StatusOK, oneIssueBody)
	a, _ := trackSearchApp(t, u)
	req := httptest.NewRequest(http.MethodGet, "/api/track/issues/search?q=auth", nil)
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("anonymous → %d, want 401", rec.Code)
	}
	if got := u.requests(); len(got) != 0 {
		t.Errorf("upstream saw %v for a stranger", got)
	}
}

// The bare array travels VERBATIM. Re-encoding it here would put a second author on a shape this
// app does not own, and an envelope invented at this layer would be a claim Track never made.
func TestTrackSearch_ForwardsTheBareArrayVerbatim(t *testing.T) {
	u := newTrackSearchUpstream(t, http.StatusOK, oneIssueBody)
	a, sess := trackSearchApp(t, u)
	rec := getTrackSearch(t, a, sess, "q=auth")
	if strings.TrimSpace(rec.Body.String()) != oneIssueBody {
		t.Errorf("body = %q\nwant  = %q", strings.TrimSpace(rec.Body.String()), oneIssueBody)
	}
	var out []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("response is not the bare array Track sent: %v", err)
	}
}

// An upstream FAULT is not an empty result. Track answers a failed search 500 SEARCH_FAILED
// (measured: the full-text backend erroring), and that status has to survive the proxy — a 200
// with an empty body here would render as "no matching issues", which is the exact confusion this
// whole route is written around.
func TestTrackSearch_UpstreamFaultIsNotAnEmptyList(t *testing.T) {
	u := newTrackSearchUpstream(t, http.StatusInternalServerError, `{"error":"db is down","code":"SEARCH_FAILED"}`)
	a, sess := trackSearchApp(t, u)
	rec := getTrackSearch(t, a, sess, "q=auth")
	if rec.Code == http.StatusOK {
		t.Fatalf("a 500 from Track became %d here — a fault must not arrive as a result", rec.Code)
	}
	if strings.TrimSpace(rec.Body.String()) == "[]" {
		t.Error("a fault was rewritten as an empty array")
	}
}
