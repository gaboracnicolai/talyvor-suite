package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
)

// body_cap_reach_test.go — DO THE REMAINING BODY CAPS BITE?
//
// ⚠ MEASURED FIRST (W4.46/W4.47, tab-k4m7, ~/talyvor-queue/w446-bff-reach-k4m7.py): each
// declared bound in this BFF was DISABLED at its enforcement site and CI's own command run.
// 17 bounds -> 6 ENFORCED, 11 UNTESTED. Three of the eleven carried a live defect and were
// fixed in #334. These are the ones worth a bite test out of the remaining eight.
//
// ⚠⚠ A STATUS-ONLY ASSERTION IS NOT A BITE TEST, AND THAT IS THE WHOLE DESIGN HERE.
// Every route below answers 400 when its cap trips — and also answers 400, by a completely
// different path, for a body that is merely wrong. So each case sends a body that is
// OVERSIZE **and otherwise entirely valid**: correct shape, an allowed amount, a non-empty
// name. With the cap gone it decodes and proceeds; with the cap present it cannot. The
// assertion is therefore on the error the CAP produces, never on the status alone.
// #334 is where that lesson was paid for: "want 400" would have passed either way.
//
// ⚠ WHAT IS DELIBERATELY NOT COVERED, WITH THE ARGUMENT RATHER THAN A SILENT OMISSION —
// W4.44's rule is that a bound nothing pins can be a true row and not a finding:
//
//	version.go:133  maxBundleVersionBytes — caps a read of a file THIS PROCESS WROTE, in a
//	                directory it owns. There is no adversary on that path; the cap is
//	                belt-and-braces and a test for it would assert against ourselves.
//	docs_search.go:120  the offset clamp at 1<<20 — an offset past a million rows is
//	                already meaningless, and the merged-window guard (X14) is separately
//	                tested and covers the case that reaches upstream.
//
//	tenant.go:367   the 64 KiB bound on /api/pooling — AND THIS ONE IS NOT A TEST GAP, IT
//	                IS A DIFFERENT THING WEARING THE SAME CLOTHES. It is io.LimitReader,
//	                not http.MaxBytesReader, and MEASURED (W4.47) the difference is visible
//	                from outside: a 100 KiB body whose JSON object CLOSES EARLY is accepted
//	                with 200, because the decoder stops at the brace and the remaining bytes
//	                are simply never read. Only a body whose VALUE spans past 64 KiB is
//	                refused. So it bounds the READ, it does not cap the REQUEST — which is
//	                what every sibling on this file's other routes does. A bite test here
//	                would pin a much weaker property than its name would imply, and writing
//	                one would make the inconsistency harder to see rather than easier. The
//	                measurement is recorded here instead; whether the route should use
//	                MaxBytesReader like its siblings is a change to a request path and wants
//	                a reviewer, not a session acting alone.
//
// Those stay UNTESTED on purpose, and the harness re-run after this change shows them still
// UNTESTED — which is how the claim "I covered what I said I covered" is checked rather than
// asserted.

const capPad = 5000 // > the 4096 cap on the three money/credential routes

// oversizeButOtherwiseValid pads a valid JSON object past a cap with a field the handler's
// struct does not bind, so nothing downstream can object to it. Without the cap it decodes
// cleanly; with the cap the decoder never sees a complete object.
func oversizeButOtherwiseValid(valid string, pad int) string {
	trimmed := strings.TrimSuffix(strings.TrimSpace(valid), "}")
	return trimmed + `,"pad":"` + strings.Repeat("x", pad) + `"}`
}

func errorField(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var out struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("response is not the JSON error shape: %v (%s)", err, rec.Body.String())
	}
	return out.Error
}

// TestLXCCheckout_BodyCapBites — the TOP-UP route. 1000 cents is an advertised amount, so
// without the cap this body is accepted and dialled upstream.
func TestLXCCheckout_BodyCapBites(t *testing.T) {
	up := newCheckoutUpstream(t)
	a, sess := checkoutApp(t, up)

	rec := postCheckout(a, sess, "https://app.talyvor.com",
		oversizeButOtherwiseValid(`{"usd_cents":1000}`, capPad))

	if got := errorField(t, rec); got != "invalid JSON body" {
		t.Fatalf("oversize checkout body -> %d %q, want 400 \"invalid JSON body\". 1000 is an "+
			"ADVERTISED amount, so anything else means the body decoded — i.e. the 4 KiB cap on "+
			"a route that starts a payment did not apply", rec.Code, got)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if up.gotMethod == http.MethodPost {
		t.Errorf("an oversize checkout body reached the billing upstream")
	}
}

// TestLXCCheckout_OrdinaryBodyStillWorks is the counterweight: every assertion above is also
// satisfied by a route that refuses every body.
func TestLXCCheckout_OrdinaryBodyStillWorks(t *testing.T) {
	up := newCheckoutUpstream(t)
	a, sess := checkoutApp(t, up)
	rec := postCheckout(a, sess, "https://app.talyvor.com", `{"usd_cents":1000}`)
	if rec.Code >= 400 {
		t.Fatalf("an ordinary checkout returned %d (%s) — this test would pass on a route that "+
			"refuses everything", rec.Code, strings.TrimSpace(rec.Body.String()))
	}
}

// TestKeysMint_BodyCapBites — the API-KEY MINT route. A non-empty name is all the handler
// requires before going upstream, so without the cap this body mints a key.
func TestKeysMint_BodyCapBites(t *testing.T) {
	up := newKeysUpstream(t)
	a, sess := keysApp(t, up)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/keys",
		strings.NewReader(oversizeButOtherwiseValid(`{"name":"CI","scopes":["proxy"]}`, capPad)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://app.talyvor.com")
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if got := errorField(t, rec); got != "invalid JSON body" {
		t.Fatalf("oversize mint body -> %d %q, want 400 \"invalid JSON body\". The name is "+
			"non-empty, so any other answer means the body decoded and a CREDENTIAL was minted "+
			"from a request the 4 KiB cap was supposed to refuse", rec.Code, got)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if up.gotMethod == http.MethodPost {
		t.Errorf("an oversize mint body reached the upstream — a key may have been created")
	}
}

// TestConvert_BodyCapBites — the CONVERSION route, which moves money. 100000 µLXC is above
// the minimum, so without the cap this body converts.
func TestConvert_BodyCapBites(t *testing.T) {
	up := newConvertUpstream(t, 1.0)
	a, sess := convertApp(t, up)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/lens/convert",
		strings.NewReader(oversizeButOtherwiseValid(`{"lxc_amount_ulxc":100000}`, capPad)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://app.talyvor.com")
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if got := errorField(t, rec); got != "invalid JSON body" {
		t.Fatalf("oversize convert body -> %d %q, want 400 \"invalid JSON body\". 100000 µLXC is "+
			"ABOVE the minimum, so any other answer means the body decoded and a conversion was "+
			"attempted from a request the 4 KiB cap was supposed to refuse", rec.Code, got)
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

// TestStream_RequestCapBites — the 4 MiB prompt cap, the largest body this BFF accepts. Its
// refusal message is distinct from every other 400 on the route, so this one can key on the
// message directly.
func TestStream_RequestCapBites(t *testing.T) {
	up := newStreamUpstream(t)
	a, sess := streamApp(t, up)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/ai/stream/anthropic/v1/messages",
		strings.NewReader(oversizeButOtherwiseValid(`{"stream":true}`, streamRequestMaxBytes+1)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://app.talyvor.com")
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("oversize stream body -> %d (%s), want 400", rec.Code, strings.TrimSpace(rec.Body.String()))
	}
	if got := errorField(t, rec); !strings.Contains(got, "too large") {
		t.Fatalf("oversize stream body -> %q, want the cap's own message. Anything else means "+
			"the 4 MiB bound did not apply", got)
	}
	if up.proxyCalls != 0 {
		t.Errorf("an oversize prompt reached the upstream %d times — the cap exists so that "+
			"tokens nobody asked for are never generated or billed", up.proxyCalls)
	}
}

// TestDocsSearch_CallerSuppliedPageSizeIsClamped — X15. The merged-window guard (X14) is
// separately tested but only fires on the two-source path; a request naming a single kind
// walks straight past it, so the clamp is the only thing bounding what this BFF asks the
// upstream for. Without it a caller sets the page size of a request the SERVER makes.
func TestDocsSearch_CallerSuppliedPageSizeIsClamped(t *testing.T) {
	u := newSearchUpstream(t, http.StatusOK, oneHitBody)
	a, sess := searchApp(t, u)

	// type=fulltext is a SINGLE-source kind, which keeps this off the merged-window path, so nothing but the clamp is in play.
	rec := getSearch(t, a, sess, "q=auth&limit=100000&type=fulltext")
	if rec.Code != http.StatusOK {
		t.Fatalf("clamped search -> %d (%s), want 200", rec.Code, strings.TrimSpace(rec.Body.String()))
	}
	if len(u.gotQuery) == 0 {
		t.Fatal("nothing reached the upstream, so this test proves nothing about the clamp")
	}
	for _, q := range u.gotQuery {
		v, err := url.ParseQuery(q)
		if err != nil {
			t.Fatalf("upstream query %q: %v", q, err)
		}
		got, err := strconv.Atoi(v.Get("limit"))
		if err != nil {
			t.Fatalf("upstream limit %q is not a number (query %q)", v.Get("limit"), q)
		}
		if got > docsSearchMergedWindow {
			t.Fatalf("the BFF asked the upstream for limit=%d; the caller said 100000 and the "+
				"clamp is %d. A caller must not be able to set the page size of a request the "+
				"SERVER makes", got, docsSearchMergedWindow)
		}
	}
}

// TestDocsSearch_AnOrdinaryPageSizeIsPassedThrough is the counterweight: the assertion above
// is satisfied by a clamp that pins every request to 1, which would be a broken product.
func TestDocsSearch_AnOrdinaryPageSizeIsPassedThrough(t *testing.T) {
	u := newSearchUpstream(t, http.StatusOK, oneHitBody)
	a, sess := searchApp(t, u)

	if rec := getSearch(t, a, sess, "q=auth&limit=7&type=fulltext"); rec.Code != http.StatusOK {
		t.Fatalf("ordinary search -> %d (%s)", rec.Code, strings.TrimSpace(rec.Body.String()))
	}
	if len(u.gotQuery) == 0 {
		t.Fatal("nothing reached the upstream")
	}
	v, _ := url.ParseQuery(u.gotQuery[0])
	if v.Get("limit") != "7" {
		t.Fatalf("a limit of 7 reached the upstream as %q — the clamp is not passing legitimate "+
			"values through", v.Get("limit"))
	}
}
