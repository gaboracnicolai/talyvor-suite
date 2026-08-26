package main

// stream_test.go — W4.6.1 STEP 3: STREAMING THROUGH THE BFF TO A BROWSER.
//
// ⚠ THREE THINGS STOOD BETWEEN THIS BFF AND A STREAM, AND ONLY TWO OF THEM WERE KNOWN.
//
//  1. NO CREDENTIAL. Lens wraps every /v1/proxy/* route in RequireScope("proxy") and the BFF's
//     session token does not carry it. Closed by talyvor-lens #460 (session-scoped keys): the BFF
//     mints a narrow, short-lived {proxy} credential per session instead of widening
//     provisionScopes or minting a workspace-wide key.
//  2. NO FLUSH. `forward` is GET-only, sets Accept: application/json, and io.Copy's the body with
//     no Flush. net/http buffers ~2KB before it writes anything to the wire, so an SSE chunk of a
//     few bytes SITS THERE until the buffer fills or the handler returns — the browser sees
//     nothing until the whole completion is done, which is precisely not streaming.
//  3. ⚠ A TEN-SECOND WHOLE-EXCHANGE TIMEOUT, AND THIS ONE WAS NOT KNOWN. `a.client` is
//     `&http.Client{Timeout: 10 * time.Second}`. http.Client.Timeout covers READING THE BODY, not
//     just the handshake — so even a perfectly flushing relay on that client is CUT OFF MID-STREAM
//     at ten seconds. Most completions are longer than that. A flush-only fix would have shipped a
//     relay that streams beautifully and then truncates every real answer.
//
// Each is a separate test below, and each fails without its fix.
//
// ⚠ THE FLUSH TEST ASSERTS TIMING, NOT BYTES, AND THAT IS THE WHOLE POINT. Comparing the finished
// body proves nothing: io.Copy produces byte-identical output. The only assertion that can tell a
// flushing relay from a buffering one is "the client saw chunk 1 WHILE the upstream was still
// holding chunk 2".

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const testSessionKey = "tlv_sk_" + "0123456789abcdef0123456789abcdef0123456789abcdef"

// streamUpstream fakes Lens: the provision route, the session-key mint, and a streaming proxy
// endpoint whose pacing the test controls.
type streamUpstream struct {
	srv *httptest.Server

	// release gates the SECOND chunk. Nothing is timing-dependent: the upstream physically cannot
	// emit chunk 2 until the test says so, so "the client already has chunk 1" is unambiguous.
	release chan struct{}
	// upstreamCtxDone receives when the upstream handler's request context is cancelled — how the
	// disconnect test observes that the cancellation actually propagated.
	upstreamCtxDone chan struct{}

	gotProxyAuth string
	gotMintAuth  string
	gotProxyPath string
	gotAccept    string
	mintCalls    int
	proxyCalls   int
	chunkGap     time.Duration
	// noBlock skips the release gate entirely. Tests that care about CREDENTIALS rather than
	// pacing use it — the first version of the reuse test reassigned `release` between requests
	// while the upstream goroutine was selecting on it, which is a data race in the TEST.
	noBlock bool
}

func newStreamUpstream(t *testing.T) *streamUpstream {
	t.Helper()
	u := &streamUpstream{
		release:         make(chan struct{}),
		upstreamCtxDone: make(chan struct{}, 1),
	}
	u.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == provisionPath:
			serveFakeProvision(w, r)
			return

		case r.URL.Path == lensSessionKeyPath && r.Method == http.MethodPost:
			u.mintCalls++
			u.gotMintAuth = r.Header.Get("Authorization")
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_, _ = io.WriteString(w, fmt.Sprintf(
				`{"key":%q,"id":"sk-1","prefix":"tlv_sk_01234567","expires_at":%q}`,
				testSessionKey, time.Now().Add(time.Hour).UTC().Format(time.RFC3339)))
			return

		case strings.HasPrefix(r.URL.Path, "/v1/proxy/"):
			u.proxyCalls++
			u.gotProxyAuth = r.Header.Get("Authorization")
			u.gotProxyPath = r.URL.Path
			u.gotAccept = r.Header.Get("Accept")
			w.Header().Set("Content-Type", "text/event-stream")
			w.WriteHeader(http.StatusOK)
			fl, _ := w.(http.Flusher)
			_, _ = io.WriteString(w, "data: one\n\n")
			if fl != nil {
				fl.Flush()
			}
			if u.noBlock {
				_, _ = io.WriteString(w, "data: two\n\n")
				if fl != nil {
					fl.Flush()
				}
				return
			}
			select {
			case <-u.release:
			case <-r.Context().Done():
				// The client hung up. Report it so the disconnect test can assert propagation
				// rather than infer it.
				select {
				case u.upstreamCtxDone <- struct{}{}:
				default:
				}
				return
			case <-time.After(5 * time.Second):
				// ⚠ THE FALLBACK EMITS A MARKER, NOT THE REAL CHUNK. Its only job is to stop a
				// broken test hanging forever. In its first form it wrote the real second chunk,
				// which let the relay buffer EVERYTHING and still pass five seconds later — the
				// safety net was quietly supplying the evidence. Assertions reject this marker.
				_, _ = io.WriteString(w, "data: FALLBACK-RELEASE-NEVER-CAME\n\n")
				if fl != nil {
					fl.Flush()
				}
				return
			}
			if u.chunkGap > 0 {
				time.Sleep(u.chunkGap)
			}
			_, _ = io.WriteString(w, "data: two\n\n")
			if fl != nil {
				fl.Flush()
			}
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(u.srv.Close)
	return u
}

func streamApp(t *testing.T, up *streamUpstream) (*app, *http.Cookie) {
	t.Helper()
	cfg := config{
		lensBaseURL: up.srv.URL, provisionSecret: testProvisionSecret,
		authMode: authModeOIDC, oidcIssuer: "https://idp.example.com",
		publicBaseURL: "https://app.talyvor.com", sessionTTL: time.Hour,
	}
	auth := newSessionOnlyAuthenticator(cfg)
	seedProvisionedSession(auth, "stream-sid", "u1", "ng@example.com", "u-test-workspace")
	a := newApp(cfg, auth)
	a.cfg.webDist = t.TempDir()
	return a, &http.Cookie{Name: sessionCookieName, Value: "stream-sid"}
}

// openStream drives a REAL server and a REAL client, because httptest.NewRecorder buffers
// everything and could never observe a flush.
func openStream(t *testing.T, a *app, sess *http.Cookie, path, body string) (*http.Response, *bufio.Reader, func()) {
	resp, br, _, done := openStreamTimed(t, a, sess, path, body)
	return resp, br, done
}

// openStreamTimed also returns the instant the request was ISSUED.
//
// ⚠ THE START INSTANT IS LOAD-BEARING AND ITS ABSENCE IS WHAT MADE THE FIRST VERSION OF THE FLUSH
// TEST PASS AGAINST A BUFFERING RELAY. `Client.Do` returns when the RESPONSE HEADERS arrive — and a
// relay that never flushes holds the headers too, so Do itself blocks until the handler returns.
// Any budget measured from AFTER Do therefore starts counting only once the buffering has already
// finished, and can never observe it. Control E1 in w461-stream-controls-k7v3.py is what found this.
func openStreamTimed(t *testing.T, a *app, sess *http.Cookie, path, body string) (*http.Response, *bufio.Reader, time.Time, func()) {
	t.Helper()
	ts := httptest.NewServer(a)
	req, err := http.NewRequest(http.MethodPost, ts.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.AddCookie(sess)
	req.Header.Set("Origin", "https://app.talyvor.com")
	req.Header.Set("Content-Type", "application/json")
	start := time.Now()
	resp, err := ts.Client().Do(req)
	if err != nil {
		ts.Close()
		t.Fatalf("do: %v", err)
	}
	return resp, bufio.NewReader(resp.Body), start, func() { resp.Body.Close(); ts.Close() }
}

// readLineWithin returns the next line, or fails if it does not arrive in time. ⚠ THE TIMEOUT IS
// THE ASSERTION: a non-flushing relay does not produce a slow line, it produces NO line at all
// until the handler returns.
func readLineWithin(t *testing.T, br *bufio.Reader, d time.Duration, what string) string {
	t.Helper()
	type res struct {
		s   string
		err error
	}
	ch := make(chan res, 1)
	go func() {
		s, err := br.ReadString('\n')
		ch <- res{s, err}
	}()
	select {
	case r := <-ch:
		if r.err != nil && r.s == "" {
			t.Fatalf("%s: read error: %v", what, r.err)
		}
		return r.s
	case <-time.After(d):
		t.Fatalf("%s: nothing reached the client within %v. THIS IS THE FLUSHING ASSERTION: the "+
			"upstream has already written this chunk and is deliberately holding the next one, so "+
			"the only way for the client to see nothing is a relay that buffers — io.Copy into an "+
			"http.ResponseWriter holds ~2KB before anything reaches the wire", what, d)
		return ""
	}
}

// ⚠ THE HEADLINE, AND IT IS A TIMING ASSERTION MEASURED FROM THE REQUEST.
//
// The upstream writes chunk 1, flushes, and then BLOCKS — it physically cannot emit chunk 2 until
// this test releases it. So if the relay is honest, the client holds chunk 1 within milliseconds
// while the upstream is still parked. If the relay buffers, NOTHING reaches the client — not even
// the headers — until the handler returns.
//
// ⚠ THE BUDGET IS MEASURED FROM THE REQUEST, NOT FROM AFTER Client.Do. That distinction is the
// entire test: Do returns when headers arrive, and a buffering relay holds the headers too, so a
// budget started after Do begins counting only once the buffering is over. The first version of
// this test did exactly that and PASSED against an io.Copy relay. Control E1 found it.
const firstChunkBudget = 2 * time.Second

func TestStream_ChunksReachTheClientBeforeTheUpstreamFinishes(t *testing.T) {
	up := newStreamUpstream(t)
	a, sess := streamApp(t, up)

	resp, br, start, done := openStreamTimed(t, a, sess, "/api/ai/stream/anthropic/v1/messages", `{"stream":true}`)
	defer done()

	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(br)
		t.Fatalf("status = %d (%s), want 200", resp.StatusCode, string(b))
	}
	if ct := resp.Header.Get("Content-Type"); !strings.Contains(ct, "text/event-stream") {
		t.Fatalf("Content-Type = %q, want text/event-stream — a browser's EventSource will not "+
			"treat anything else as a stream", ct)
	}

	got := readLineWithin(t, br, firstChunkBudget, "first chunk")
	elapsed := time.Since(start)

	if strings.Contains(got, "FALLBACK") {
		t.Fatalf("the upstream's safety fallback fired: the relay delivered nothing until the "+
			"upstream gave up waiting. That is a BUFFERING relay. (%q after %v)", got, elapsed)
	}
	if !strings.Contains(got, "one") {
		t.Fatalf("first line = %q after %v, want the first chunk", got, elapsed)
	}
	if elapsed > firstChunkBudget {
		t.Fatalf("the first chunk reached the client %v after the request was issued, budget %v. "+
			"The upstream flushed it immediately and is STILL parked on the release gate, so the "+
			"delay is the relay buffering — io.Copy into an http.ResponseWriter holds the body AND "+
			"THE HEADERS until the handler returns", elapsed, firstChunkBudget)
	}

	close(up.release)
	deadline := time.Now().Add(3 * time.Second)
	var saw bool
	for time.Now().Before(deadline) && !saw {
		line := readLineWithin(t, br, 2*time.Second, "second chunk")
		if strings.Contains(line, "two") {
			saw = true
		}
		if line == "" {
			break
		}
	}
	if !saw {
		t.Fatal("the second chunk never arrived")
	}
}

// ⚠ THE DEFECT NOBODY HAD NAMED. http.Client.Timeout bounds the WHOLE exchange including body
// reads, so the shared 10s client would guillotine every completion longer than ten seconds. This
// proves the mechanism in under a second by injecting a short timeout, and proves the relay's own
// client is not subject to it.
func TestStream_AWholeExchangeClientTimeoutTruncatesTheStream(t *testing.T) {
	up := newStreamUpstream(t)
	up.chunkGap = 400 * time.Millisecond
	a, sess := streamApp(t, up)

	// (a) THE DEFECT, REPRODUCED: a client whose Timeout expires mid-stream.
	a.streamClient = &http.Client{Timeout: 200 * time.Millisecond}
	resp, br, done := openStream(t, a, sess, "/api/ai/stream/anthropic/v1/messages", `{"stream":true}`)
	close(up.release)
	body, _ := io.ReadAll(br)
	done()
	if strings.Contains(string(body), "two") {
		t.Fatalf("a client with Timeout=200ms delivered the whole stream (%q) — then this test is "+
			"not exercising the timeout at all and proves nothing about the fix", string(body))
	}
	_ = resp

	// (b) THE FIX: the relay's real client, same upstream pacing, whole stream arrives.
	up2 := newStreamUpstream(t)
	up2.chunkGap = 400 * time.Millisecond
	a2, sess2 := streamApp(t, up2)
	if a2.streamClient.Timeout != 0 {
		t.Fatalf("the streaming client has a whole-exchange Timeout of %v. http.Client.Timeout "+
			"covers reading the body, so this truncates every completion longer than that — the "+
			"bound belongs on the request context and on the response-header phase, not on the "+
			"whole exchange", a2.streamClient.Timeout)
	}
	resp2, br2, done2 := openStream(t, a2, sess2, "/api/ai/stream/anthropic/v1/messages", `{"stream":true}`)
	defer done2()
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp2.StatusCode)
	}
	close(up2.release)
	full, _ := io.ReadAll(br2)
	if !strings.Contains(string(full), "one") || !strings.Contains(string(full), "two") {
		t.Fatalf("the relay's own client lost part of the stream: %q", string(full))
	}
}

// ⚠ A BROWSER THAT NAVIGATES AWAY MUST STOP THE MODEL, because the tokens are still being paid for.
func TestStream_ClientDisconnectCancelsTheUpstream(t *testing.T) {
	up := newStreamUpstream(t)
	a, sess := streamApp(t, up)

	ts := httptest.NewServer(a)
	defer ts.Close()
	ctx, cancel := context.WithCancel(context.Background())
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost,
		ts.URL+"/api/ai/stream/anthropic/v1/messages", strings.NewReader(`{"stream":true}`))
	req.AddCookie(sess)
	req.Header.Set("Origin", "https://app.talyvor.com")
	resp, err := ts.Client().Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	br := bufio.NewReader(resp.Body)
	readLineWithin(t, br, 2*time.Second, "first chunk before disconnect")

	// The browser goes away mid-stream.
	cancel()
	resp.Body.Close()

	select {
	case <-up.upstreamCtxDone:
	case <-time.After(3 * time.Second):
		t.Fatal("the client disconnected and the UPSTREAM request was never cancelled — Lens keeps " +
			"generating, the provider keeps billing, and the workspace pays for tokens nobody reads")
	}
}

// ⚠ THE CREDENTIAL. This is the whole reason step 4 came first.
func TestStream_UsesANarrowSessionKeyNotTheWorkspaceSessionToken(t *testing.T) {
	up := newStreamUpstream(t)
	a, sess := streamApp(t, up)

	resp, br, done := openStream(t, a, sess, "/api/ai/stream/anthropic/v1/messages", `{"stream":true}`)
	close(up.release)
	_, _ = io.ReadAll(br)
	done()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}

	if up.mintCalls != 1 {
		t.Fatalf("session-key mint calls = %d, want 1", up.mintCalls)
	}
	if !strings.HasPrefix(up.gotProxyAuth, "Bearer "+sessionKeyPrefix) {
		t.Fatalf("the proxy call carried %q. It must present the NARROW session key (%s…), not the "+
			"workspace session token: the session token cannot reach /v1/proxy/* at all, and the "+
			"alternative — a workspace API key — is workspace-wide and survives sign-out",
			up.gotProxyAuth, sessionKeyPrefix)
	}
	if strings.Contains(up.gotProxyAuth, "tlv_ws_") {
		t.Fatal("a WORKSPACE key reached the proxy call")
	}
	if !strings.Contains(up.gotAccept, "text/event-stream") {
		t.Fatalf("Accept = %q — the shared forward() sets application/json, which is how a "+
			"streaming lane silently becomes a buffered one", up.gotAccept)
	}
}

// The mint is per session, not per request: a second stream reuses the credential.
func TestStream_TheSessionKeyIsReusedAcrossRequests(t *testing.T) {
	up := newStreamUpstream(t)
	up.noBlock = true // this test is about the CREDENTIAL, not about pacing
	a, sess := streamApp(t, up)

	for i := 0; i < 2; i++ {
		resp, br, done := openStream(t, a, sess, "/api/ai/stream/anthropic/v1/messages", `{"stream":true}`)
		_, _ = io.ReadAll(br)
		status := resp.StatusCode
		done()
		if status != http.StatusOK {
			t.Fatalf("request %d: status %d", i, status)
		}
	}
	if up.mintCalls != 1 {
		t.Fatalf("minted %d session keys for 2 requests, want 1 — a mint per request is a database "+
			"write and a round trip on every chat message", up.mintCalls)
	}
	if up.proxyCalls != 2 {
		t.Fatalf("proxy calls = %d, want 2 — if the second request never reached the upstream, "+
			"'one mint' proves nothing", up.proxyCalls)
	}
}

// ⚠ THE PROVIDER IS AN ALLOWLIST, NOT CALLER INPUT. Without this the route is a path-controlled
// proxy into everything Lens mounts, including its admin surface. The refusal must happen BEFORE any
// upstream call — a refusal issued afterwards is not a refusal.
func TestStream_ProviderIsAnAllowlistAndTheUpstreamIsNeverCalled(t *testing.T) {
	for _, bad := range []string{"evil", "v1", "admin", "openai2", "OPENAI"} {
		t.Run(bad, func(t *testing.T) {
			up := newStreamUpstream(t)
			a, sess := streamApp(t, up)
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/ai/stream/"+bad+"/v1/messages",
				strings.NewReader(`{"stream":true}`))
			req.AddCookie(sess)
			req.Header.Set("Origin", "https://app.talyvor.com")
			a.ServeHTTP(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("provider %q = %d (%s), want 400", bad, rec.Code, rec.Body.String())
			}
			if up.proxyCalls != 0 {
				t.Fatalf("provider %q reached the upstream %d times — the refusal happens AFTER the "+
					"request, which is not a refusal", bad, up.proxyCalls)
			}
		})
	}
}

// ⚠ A TRAVERSAL SEGMENT IS REFUSED, BUT NOT BY THE ALLOWLIST — AND THE DIFFERENCE IS RECORDED HERE
// RATHER THAN PAPERED OVER. net/http's ServeMux CLEANS the path before matching, so
// `/api/ai/stream/../v1/messages` becomes a 307 redirect to `/api/v1/messages` and never reaches
// this handler at all. The property that matters — the upstream is not called with an
// attacker-chosen provider — holds; the status code differs because the refusal is at a different
// layer. Asserting 400 here would have been asserting a mechanism that does not exist.
func TestStream_ATraversalSegmentNeverReachesTheUpstream(t *testing.T) {
	for _, bad := range []string{"..", "../admin"} {
		t.Run(bad, func(t *testing.T) {
			up := newStreamUpstream(t)
			a, sess := streamApp(t, up)
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/ai/stream/"+bad+"/v1/messages",
				strings.NewReader(`{"stream":true}`))
			req.AddCookie(sess)
			req.Header.Set("Origin", "https://app.talyvor.com")
			a.ServeHTTP(rec, req)
			if rec.Code == http.StatusOK {
				t.Fatalf("provider %q was SERVED (200)", bad)
			}
			if up.proxyCalls != 0 {
				t.Fatalf("provider %q reached the upstream %d times", bad, up.proxyCalls)
			}
		})
	}
}

func TestStream_RequiresASession(t *testing.T) {
	up := newStreamUpstream(t)
	a, _ := streamApp(t, up)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/ai/stream/anthropic/v1/messages",
		strings.NewReader(`{"stream":true}`))
	req.Header.Set("Origin", "https://app.talyvor.com")
	a.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated stream = %d (%s), want 401", rec.Code, rec.Body.String())
	}
	if up.proxyCalls != 0 {
		t.Fatalf("an unauthenticated request reached the upstream %d times", up.proxyCalls)
	}
}

// Same-origin discipline, matching every other write route on this BFF.
func TestStream_ForeignOriginIsRefused(t *testing.T) {
	up := newStreamUpstream(t)
	a, sess := streamApp(t, up)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/ai/stream/anthropic/v1/messages",
		strings.NewReader(`{"stream":true}`))
	req.AddCookie(sess)
	req.Header.Set("Origin", "https://evil.example.com")
	a.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("foreign-origin stream = %d (%s), want 403", rec.Code, rec.Body.String())
	}
	if up.proxyCalls != 0 {
		t.Fatalf("a foreign-origin request reached the upstream %d times", up.proxyCalls)
	}
}
