package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// THE CONVERSION, ASSERTED ON WHAT THE BFF SENDS AND WHAT IT PROMISES.
//
// Earned LENS had no exit: Lens has had the conversion for a while, the BFF had no code for it and
// the UI had none. These pin the two things that make wiring it safe rather than merely present —
// the workspace comes from the SESSION, and the screen is told the truth about reversibility
// BEFORE the click.

// convertUpstream is a Lens stand-in that RECORDS what it was asked and refuses what Lens refuses.
// It answers only on the paths Lens actually registers, so a request to a path Lens does not have
// 404s here exactly as it would on the box — the lesson from the Docs route-shape incident.
type convertUpstream struct {
	srv  *httptest.Server
	path string
	body string
	auth string
	code int // 0 ⇒ 200

	// rateBody, when non-empty, REPLACES the conversion-rate response body. The default body
	// mirrors what Lens actually serves — `rate`, `usd_per_lxc` and `lens_per_lxc`, with the
	// first and last carrying THE SAME value, the one its `/v1/economy/conversion-rate` handler
	// takes from `economy.RateEngine.CurrentRate` (cmd/lens/main.go at `a04310a`, cited by
	// symbol: a line in another repository is unverifiable from here, cited_lines_test.go). That
	// faithfulness is also this fixture's one blind spot: with both keys present and equal, the
	// quote tests below pass whichever of the two the handler reads, so they cannot say which
	// key this deployment depends on, and they cannot see the handler reading NEITHER. Tests
	// that need to distinguish those set this.
	rateBody string
}

func newConvertUpstream(t *testing.T, rate float64) *convertUpstream {
	t.Helper()
	u := &convertUpstream{}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/economy/conversion-rate", func(w http.ResponseWriter, r *http.Request) {
		u.path, u.auth = r.URL.Path, r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		if u.rateBody != "" {
			_, _ = io.WriteString(w, u.rateBody)
			return
		}
		_, _ = io.WriteString(w, `{"rate":`+jsonNum(rate)+`,"usd_per_lxc":0.1,"lens_per_lxc":`+jsonNum(rate)+`}`)
	})
	mux.HandleFunc("POST /v1/workspaces/{wsID}/lxc/convert", func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		u.path, u.body, u.auth = r.URL.Path, string(b), r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		if u.code != 0 {
			w.WriteHeader(u.code)
			_, _ = io.WriteString(w, `{"error":"insufficient LENS"}`)
			return
		}
		_, _ = io.WriteString(w, `{"lxc_minted_ulxc":100000,"lens_spent_ulens":100000,"rate":1,`+
			`"new_lxc_balance_ulxc":600000,"new_lens_balance_ulens":900000}`)
	})
	u.srv = httptest.NewServer(mux)
	t.Cleanup(u.srv.Close)
	return u
}

func jsonNum(f float64) string {
	b, _ := json.Marshal(f)
	return string(b)
}

// Mirrors checkoutApp — same session seeding, same config shape — so the conversion is exercised
// through the tenancy the rest of the money path uses rather than a bespoke one.
func convertApp(t *testing.T, up *convertUpstream) (*app, *http.Cookie) {
	t.Helper()
	cfg := config{
		lensBaseURL: up.srv.URL, provisionSecret: testProvisionSecret,
		authMode: authModeOIDC, oidcIssuer: "https://idp.example.com",
		publicBaseURL: "https://app.talyvor.com", sessionTTL: time.Hour,
	}
	auth := newSessionOnlyAuthenticator(cfg)
	seedProvisionedSession(auth, "conv-sid", "u1", "ng@example.com", "u-test-workspace")
	a := newApp(cfg, auth)
	a.cfg.webDist = t.TempDir()
	return a, &http.Cookie{Name: sessionCookieName, Value: "conv-sid"}
}

// ⚠ THE TENANCY INVARIANT, which is the one that must not regress: the upstream path is built
// from the SESSION's workspace and can never be named by the caller.
func TestConvert_AddressesTheSessionWorkspaceOnly(t *testing.T) {
	up := newConvertUpstream(t, 1.0)
	a, sess := convertApp(t, up)

	req := httptest.NewRequest(http.MethodPost, "/api/lens/convert",
		strings.NewReader(`{"lxc_amount_ulxc":100000,"workspace_id":"ws-someone-else"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://app.talyvor.com") // the app origin the BFF is configured with
	req.AddCookie(sess)
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(up.path, "ws-someone-else") {
		t.Fatalf("upstream path %q carries a workspace from the REQUEST — the session's workspace "+
			"is the only one this route may ever address", up.path)
	}
	if !strings.HasSuffix(up.path, "/lxc/convert") {
		t.Errorf("upstream path = %q, want …/lxc/convert", up.path)
	}
	// Sanitised by reconstruction: only the one field survives.
	if strings.Contains(up.body, "workspace_id") {
		t.Errorf("the forwarded body carries a client-supplied workspace_id: %s", up.body)
	}
	if !strings.Contains(up.body, "lxc_amount_ulxc") {
		t.Errorf("the forwarded body lost the amount: %s", up.body)
	}
}

// The quote carries the three facts the screen cannot invent, and the rate is READ from the
// deployment rather than baked in — it changes, and a stale number on a money screen is a lie.
func TestConvertQuote_CarriesTheLiveRateAndTheMinimum(t *testing.T) {
	up := newConvertUpstream(t, 2.5)
	a, sess := convertApp(t, up)

	req := httptest.NewRequest(http.MethodGet, "/api/lens/convert-quote", nil)
	req.AddCookie(sess)
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	var q convertQuote
	if err := json.Unmarshal(rec.Body.Bytes(), &q); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if q.LENSPerLXC != 2.5 {
		t.Errorf("lens_per_lxc = %v, want the upstream's 2.5 — the rate must come from the "+
			"deployment, not the bundle", q.LENSPerLXC)
	}
	if q.MinLXCMicros != minConversionULXC {
		t.Errorf("min_lxc_ulxc = %d, want %d", q.MinLXCMicros, minConversionULXC)
	}
}

// ⚠ WHICH UPSTREAM KEY THE RATE COMES FROM, PINNED — because the faithful fixture cannot say.
//
// Lens serves `rate` and `lens_per_lxc` from the same variable, so the shared fixture sets both to
// the same number and every quote assertion above passes for a handler reading either one. That is
// a guard that cannot fail in the direction that matters: the two keys agreeing upstream today is
// a fact about `a04310a`, not a contract, and the handler reads exactly one of them. This makes the
// fixture disagree with itself so the answer names the key.
func TestConvertQuote_TakesTheRateFromLENSPerLXC(t *testing.T) {
	up := newConvertUpstream(t, 0)
	up.rateBody = `{"rate":9,"usd_per_lxc":0.1,"lens_per_lxc":2.5}`
	a, sess := convertApp(t, up)

	req := httptest.NewRequest(http.MethodGet, "/api/lens/convert-quote", nil)
	req.AddCookie(sess)
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	var q convertQuote
	if err := json.Unmarshal(rec.Body.Bytes(), &q); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if q.LENSPerLXC != 2.5 {
		t.Errorf("lens_per_lxc = %v, want 2.5 — the quote must carry the upstream's `lens_per_lxc`; "+
			"%v would mean it is quoting `rate` instead, and the two are only equal by coincidence "+
			"of one upstream commit", q.LENSPerLXC, q.LENSPerLXC)
	}
}

// ⚠⚠ A RATE THE HANDLER COULD NOT READ MUST NOT LEAVE HERE AS A RATE OF ZERO, AND THIS IS A MONEY
// SCREEN.
//
// `json.Unmarshal` into a struct SUCCEEDS when a field is absent — it leaves the zero value — so
// the decode-failure branch above cannot see an upstream that answered 200 with a shape this
// handler does not understand. The quote then leaves with `lens_per_lxc: 0`, and zero is not an
// unreadable number on the other end: ConvertLens.tsx renders "Rate: 0 LENS per LXC", its
// `lensCostForLXC` returns `ceil(micros × 0)` = 0, and `tooExpensive = cost > balance` is
// therefore FALSE for every amount — the panel promises a free conversion and enables the button
// against an empty LENS balance, right before an irreversible click that Lens charges at the real
// rate.
//
// ZERO CANNOT BE A GENUINE READING, which is why refusing costs nothing true. Measured read-only at
// talyvor-lens `a04310a`: `RateEngine.CurrentRate` returns `Phase1FloorRate` (1.0) with no pool and
// on `pgx.ErrNoRows`, `ApproveRate` floors every approved rate at `Phase1FloorRate`, and the only
// path that returns 0 returns an error with it — on which the route answers 500, not 200. So a 200
// carrying no positive rate is the shape of a handler that failed to read one, always.
//
// This is #206's finding on the other side of the same wire: there, Lens spent a status code to
// keep "not wired" apart from "converted nothing" and the BFF collapsed them. Here the BFF would
// collapse "no rate was readable" into "the rate is zero" — and the second one is a price.
// ⚠ THE BASE RATE IS 2.5, NOT 0, AND THAT IS WHAT MAKES THIS TEST FAIL CLOSED. Both new tests
// depend on `rateBody` actually replacing the body; a fixture that quietly ignored the override
// would hand this test the DEFAULT body, and at base rate 0 that body carries `lens_per_lxc: 0`,
// the guard would fire, and the test would pass while asserting nothing about an ABSENT key. At
// 2.5 the same breakage serves a readable rate, the handler answers 200, and this reds. Control C7.
func TestConvertQuote_RefusesARateItCouldNotRead(t *testing.T) {
	up := newConvertUpstream(t, 2.5)
	// The shape Lens has if the redundant alias is ever dropped: `rate` still there, the key this
	// handler reads gone. A decode of this SUCCEEDS.
	up.rateBody = `{"rate":2.5,"usd_per_lxc":0.1}`
	a, sess := convertApp(t, up)

	req := httptest.NewRequest(http.MethodGet, "/api/lens/convert-quote", nil)
	req.AddCookie(sess)
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)

	if rec.Code == http.StatusOK {
		var q convertQuote
		if err := json.Unmarshal(rec.Body.Bytes(), &q); err != nil {
			t.Fatalf("decode: %v", err)
		}
		t.Fatalf("the quote left with status 200 and lens_per_lxc = %v. A rate this handler could "+
			"not read must not be served as a rate — at 0 the panel says the conversion is free and "+
			"enables the button against any balance.", q.LENSPerLXC)
	}
	if rec.Code < 500 {
		t.Errorf("status = %d, want a 5xx — an upstream 200 whose shape carries no rate is a fault "+
			"of the deployment, not of the caller's request", rec.Code)
	}
}

// ⚠ THE IRREVERSIBILITY IS PART OF THE CONTRACT, not a UI nicety. There is no LXC→LENS conversion
// in Lens — the function does not exist. A quote that said nothing, or said "true", would let a
// screen imply the click is undoable.
func TestConvertQuote_SaysItIsOneWay(t *testing.T) {
	up := newConvertUpstream(t, 1.0)
	a, sess := convertApp(t, up)

	req := httptest.NewRequest(http.MethodGet, "/api/lens/convert-quote", nil)
	req.AddCookie(sess)
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)

	var q convertQuote
	_ = json.Unmarshal(rec.Body.Bytes(), &q)
	if q.Reversible {
		t.Error("the quote claims the conversion is reversible. Lens has no LXC→LENS path at all, " +
			"so this would be a false promise made before the money moves.")
	}
	if !strings.Contains(strings.ToLower(q.ReversibleNote), "not back") &&
		!strings.Contains(strings.ToLower(q.ReversibleNote), "cannot") {
		t.Errorf("reversible_note does not say plainly that it is one-way: %q", q.ReversibleNote)
	}
}

// Below the minimum is refused HERE, with the minimum quoted, rather than after a round trip.
func TestConvert_BelowMinimumRefusedBeforeDialing(t *testing.T) {
	up := newConvertUpstream(t, 1.0)
	a, sess := convertApp(t, up)

	req := httptest.NewRequest(http.MethodPost, "/api/lens/convert",
		strings.NewReader(`{"lxc_amount_ulxc":1}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://app.talyvor.com") // the app origin the BFF is configured with
	req.AddCookie(sess)
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if up.path != "" {
		t.Errorf("the BFF dialled upstream (%q) for an amount it could refuse itself", up.path)
	}
	if !strings.Contains(rec.Body.String(), "min_lxc_ulxc") {
		t.Errorf("the refusal does not quote the minimum: %s", rec.Body.String())
	}
}

// A 402 from upstream (not enough LENS) must reach the screen intact, so it can say which balance
// was short rather than reporting a generic failure.
func TestConvert_InsufficientLENSReachesTheScreen(t *testing.T) {
	up := newConvertUpstream(t, 1.0)
	up.code = http.StatusPaymentRequired
	a, sess := convertApp(t, up)

	req := httptest.NewRequest(http.MethodPost, "/api/lens/convert",
		strings.NewReader(`{"lxc_amount_ulxc":100000}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://app.talyvor.com") // the app origin the BFF is configured with
	req.AddCookie(sess)
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)

	if rec.Code != http.StatusPaymentRequired {
		t.Errorf("status = %d, want 402 passed through", rec.Code)
	}
}

// A write without a session is refused before anything is read.
func TestConvert_RequiresASession(t *testing.T) {
	up := newConvertUpstream(t, 1.0)
	a, _ := convertApp(t, up)

	req := httptest.NewRequest(http.MethodPost, "/api/lens/convert",
		strings.NewReader(`{"lxc_amount_ulxc":100000}`))
	// Same-origin, as a real browser sends: this test is about the SESSION gate, so it must
	// get past the write-path Origin gate to reach it.
	req.Header.Set("Origin", "https://app.talyvor.com")
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", rec.Code)
	}
}
