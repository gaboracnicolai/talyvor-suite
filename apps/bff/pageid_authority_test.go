package main

import (
	"net/http"
	"strings"
	"testing"
)

// PAGE_ID IS BILLING AUTHORITY, AND TWO OF THE THREE ROUTES THAT SEND IT NEVER VALIDATED IT.
//
// docs_ai.go says it out loud, above docsSuggestTitleBody: "`page_id` is authority rather than
// content -- IT DECIDES WHICH DOCUMENT THE CHARGE LANDS ON -- and it comes from this route's path."
// All three AI page routes send it. docsSuggestTitlePage passes it through pathID;
// docsSummarizePage and docsTranslatePage took r.PathValue("pageID") straight into the upstream
// body.
//
// FOUND BY CENSUS, NOT BY READING. Of the 21 r.PathValue(...) sites in this package, 18 go through
// pathID. The three that do not are stream.go's `provider` (an allowlist decides it before any
// request is made), stream.go's `rest` (deliberately a path remainder), and these two.
//
// WHY NOBODY NOTICED: THE UNENCODED FORMS NEVER ARRIVE. MEASURED through the real handler:
//
//	pageID=".."      -> 307. net/http's mux normalises the path; the handler never runs.
//	pageID="."       -> 307. Same.
//	pageID="%2e%2e"  -> 200, and the upstream body carries page_id ".."
//	pageID="a%2Fb"   -> 200, and the upstream body carries page_id "a/b"
//	pageID="%00bad"  -> 200, and the upstream body carries a page_id whose first byte is NUL
//
// The mux protects the shapes a person would try by hand, and none of the shapes pathID was
// written for. A NUL byte in a billing identifier is the same class this repository has chased
// twice already: a value that survives every layer that looks at it and changes what a later one
// reads.
//
// THIS IS A TIGHTENING WITH NO LEGITIMATE CALLER AFFECTED, and that is asserted rather than
// assumed: a real page id is a UUID, pathID admits it, and the must-stay-green arms drive one
// through both routes and read it back off the wire.
//
// AND THE INSTRUMENT IS THE UPSTREAM, NOT THE STATUS. A route that answered 400 having already
// posted the body would satisfy a status-only assertion while the charge had already been
// attributed. Every case asserts the upstream saw NOTHING.

// hostilePageIDs are the encoded forms that REACH the handler. The unencoded ".." and "." are
// answered 307 by the mux and are listed in the header rather than driven, because a case that
// never reaches the code under test proves nothing about it.
var hostilePageIDs = []struct{ name, raw string }{
	{"an encoded traversal", "%2e%2e"},
	{"an encoded separator", "a%2Fb"},
	{"a NUL byte", "%00bad"},
	{"an encoded dot", "%2e"},
}

const realPageID = "353a3110-a64f-46bd-b99a-71f1c287b360"

func TestDocsSummarize_RefusesAPageIDItWouldBillAgainst(t *testing.T) {
	for _, tc := range hostilePageIDs {
		t.Run(tc.name, func(t *testing.T) {
			u := newTransformUpstream(t, http.StatusOK, `{"text":"ok"}`)
			a, sess := summarizeApp(t, u)
			rec := postSummarize(t, a, sess, tc.raw, `{"text":"hello"}`)
			if rec.Code != http.StatusBadRequest {
				t.Errorf("pageID=%q -> %d, want 400. page_id decides which document the charge "+
					"lands on, and suggest-title -- same file, same authority -- refuses this. "+
					"Upstream body was: %s", tc.raw, rec.Code, u.gotBody)
			}
			if reqs := u.requests(); len(reqs) != 0 {
				t.Errorf("pageID=%q: the upstream was called %d time(s) (%v) with body %s. A "+
					"refusal issued after the request is not a refusal -- the charge has already "+
					"been attributed.", tc.raw, len(reqs), reqs, u.gotBody)
			}
		})
	}

	t.Run("a real page id still bills the page it names", func(t *testing.T) {
		u := newTransformUpstream(t, http.StatusOK, `{"text":"ok"}`)
		a, sess := summarizeApp(t, u)
		if rec := postSummarize(t, a, sess, realPageID, `{"text":"hello"}`); rec.Code != http.StatusOK {
			t.Fatalf("a UUID page id was refused (%d) -- the guard is too wide", rec.Code)
		}
		if !strings.Contains(u.gotBody, `"page_id":"`+realPageID+`"`) {
			t.Errorf("upstream body = %s, want page_id %q carried through unchanged", u.gotBody, realPageID)
		}
	})
}

func TestDocsTranslate_RefusesAPageIDItWouldBillAgainst(t *testing.T) {
	for _, tc := range hostilePageIDs {
		t.Run(tc.name, func(t *testing.T) {
			u := newTranslateUpstream(t, http.StatusOK, `{"text":"bonjour"}`)
			a, sess := translateApp(t, u)
			rec := postTranslate(t, a, sess, tc.raw, `{"text":"hello","language":"French"}`)
			if rec.Code != http.StatusBadRequest {
				t.Errorf("pageID=%q -> %d, want 400 (see the summarise test for why)", tc.raw, rec.Code)
			}
			if reqs := u.requests(); len(reqs) != 0 {
				t.Errorf("pageID=%q: the upstream was called %d time(s) -- the charge is already "+
					"attributed before the refusal", tc.raw, len(reqs))
			}
		})
	}

	t.Run("a real page id still bills the page it names", func(t *testing.T) {
		u := newTranslateUpstream(t, http.StatusOK, `{"text":"bonjour"}`)
		a, sess := translateApp(t, u)
		if rec := postTranslate(t, a, sess, realPageID, `{"text":"hello","language":"French"}`); rec.Code != http.StatusOK {
			t.Fatalf("a UUID page id was refused (%d) -- the guard is too wide", rec.Code)
		}
	})
}

// THE THIRD ROUTE, PINNED SO THE THREE CANNOT DRIFT APART AGAIN. suggest-title already refuses
// these -- it is the sibling the other two were measured against, and if it ever stops, the
// asymmetry this file closed has reopened from the other end.
func TestDocsSuggestTitle_StillRefusesTheSamePageIDs(t *testing.T) {
	for _, tc := range hostilePageIDs {
		t.Run(tc.name, func(t *testing.T) {
			u := newSuggestTitleUpstream(t, http.StatusOK, `{"title":"x"}`)
			a, sess := suggestTitleApp(t, u)
			if rec := postSuggestTitle(t, a, sess, tc.raw, `{"text":"hello"}`); rec.Code != http.StatusBadRequest {
				t.Errorf("pageID=%q -> %d, want 400 -- suggest-title is the route the other two "+
					"were brought into line with", tc.raw, rec.Code)
			}
		})
	}
}
