package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// docs_pagewrite_oversize_test.go — AN OVERSIZE BODY IS A CLIENT ERROR, NOT AN UPSTREAM OUTAGE.
//
// This package already states the rule, five times, in test names:
// TestDocsAsk_OversizeQuestionIs413AndNotAnUpstreamDiagnosis and its siblings for summarize,
// translate, suggest-title and changelog. Their shared comment says it plainly — a 413 "rather
// than surfacing as 'docs upstream unreachable', which is what a MaxBytesReader failing inside
// the forward looks like from the outside and is a false statement about the upstream".
//
// ⚠ MEASURED (W4.46, tab-k4m7): THE TWO PAGE-WRITE RELAYS NEVER GOT THAT TREATMENT, and they
// are the routes a person actually edits documents through. Before this change, on `75091a8`:
//
//	POST  /api/docs/spaces                     -> 413 {"error":"request body too large"}
//	POST  /api/docs/spaces/{s}/pages           -> 502 {"error":"docs upstream unreachable"}
//	PATCH /api/docs/spaces/{s}/pages/{p}       -> 502 {"error":"docs upstream unreachable"}
//
// The first reads the body under the cap and answers for itself. The other two passed
// `http.MaxBytesReader(...)` straight INTO forwardProduct as the request body, so the cap trips
// mid-forward and the forward reports what it sees: the upstream call failed. A 5xx blaming
// Docs, for a request Docs never received.
//
// ⚠ WHY THIS IS A DEFECT AND NOT A PREFERENCE. It is the wrong CLASS (5xx says "retry, our
// fault"; the client must shrink the body instead), and it names the wrong SYSTEM — someone
// paged by this would go and look at Docs, which is healthy. The repo had already decided this
// question five times; these two routes were missed.
//
// ⚠ AND THE CAP ITSELF WAS UNTESTED ON ALL THREE, which is how it stayed missed:
// ~/talyvor-queue/w446-bff-reach-k4m7.py removed each cap in turn and the whole suite stayed
// green (X2/X3/X4), while the same probe against the five AI routes reds a named test each time.
// Same constant, maxDocsBody. Five defended, three not.

// oversizeRelayBody is one byte past the page-body cap on every route below.
func oversizeRelayBody() string {
	return `{"title":"` + strings.Repeat("x", maxDocsBody+1) + `"}`
}

func TestDocsPageWrite_OversizeBodyIs413AndNotAnUpstreamDiagnosis(t *testing.T) {
	cases := []struct {
		name   string
		method string
		path   string
	}{
		{"create space", http.MethodPost, "/api/docs/spaces"},
		{"create page", http.MethodPost, "/api/docs/spaces/sp-1/pages"},
		{"update page", http.MethodPatch, "/api/docs/spaces/sp-1/pages/pg-1"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			d := newDocsRouter(t)
			a, sess := docsApp(t, d)

			req := httptest.NewRequest(c.method, c.path, strings.NewReader(oversizeRelayBody()))
			req.Header.Set("Content-Type", "application/json")
			req.AddCookie(sess)
			rec := httptest.NewRecorder()
			a.ServeHTTP(rec, req)

			if rec.Code != http.StatusRequestEntityTooLarge {
				t.Fatalf("oversize %s %s -> %d, want 413. A body the caller sent is the caller's "+
					"problem; anything in the 5xx range tells them to retry and blames a service "+
					"that never saw the request. Body: %s",
					c.method, c.path, rec.Code, strings.TrimSpace(rec.Body.String()))
			}
			if strings.Contains(rec.Body.String(), "unreachable") {
				t.Errorf("the refusal blames the upstream: %s", strings.TrimSpace(rec.Body.String()))
			}
			// The sharpest assertion of the three: an oversize body must never be FORWARDED.
			// Without it, a route could answer 413 after already streaming most of the body
			// upstream — the status would be right and the protection would not exist.
			for _, seen := range d.requests() {
				if strings.Contains(seen, "/v1/spaces") {
					t.Errorf("an oversize body reached the upstream anyway: %v", d.requests())
					break
				}
			}
		})
	}
}

// TestDocsPageWrite_OrdinaryBodyStillReaches is the counterweight. Every assertion above is
// satisfied by a relay that refuses EVERYTHING with a 413, which would be a worse product than
// the bug. This pins that a normal write still goes through and still reaches the upstream.
func TestDocsPageWrite_OrdinaryBodyStillReaches(t *testing.T) {
	d := newDocsRouter(t)
	a, sess := docsApp(t, d)

	req := httptest.NewRequest(http.MethodPost, "/api/docs/spaces/sp-1/pages",
		strings.NewReader(`{"title":"Runbook"}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(sess)
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)

	if rec.Code == http.StatusRequestEntityTooLarge {
		t.Fatalf("an ordinary page create was refused as too large — the cap is biting at the "+
			"wrong size. Body: %s", strings.TrimSpace(rec.Body.String()))
	}
	if rec.Code >= 400 {
		t.Fatalf("an ordinary page create returned %d: %s", rec.Code, strings.TrimSpace(rec.Body.String()))
	}
	var forwarded bool
	for _, seen := range d.requests() {
		if strings.Contains(seen, "/v1/spaces/sp-1/pages") {
			forwarded = true
		}
	}
	if !forwarded {
		t.Errorf("an ordinary page create never reached the upstream: %v", d.requests())
	}
}
