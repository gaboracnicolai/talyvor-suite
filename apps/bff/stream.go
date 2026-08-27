package main

// stream.go — W4.6.1 STEP 3: streaming inference through the BFF to a browser.
//
// ⚠ THREE THINGS STOOD IN THE WAY, AND ONLY TWO OF THEM WERE ON THE LIST.
//
//  1. NO CREDENTIAL. Lens wraps every /v1/proxy/* route in RequireScope("proxy"); the BFF's
//     provisioned session token carries {analytics, keys} and is refused 403. Closed by
//     talyvor-lens #460 — session-scoped keys — so the BFF mints a NARROW, short-lived {proxy}
//     credential per session rather than (a) widening provisionScopes, which would give every
//     signed-in browser session a workspace-wide inference capability, or (b) minting a workspace
//     API key, which is worse still: no TTL, survives sign-out, and revocable only by hand.
//
//  2. NO FLUSH. The shared `forward` io.Copy's into the ResponseWriter. net/http buffers ~2KB
//     before anything reaches the wire, so a handful of SSE bytes SITS THERE until the buffer
//     fills or the handler returns. The browser sees one lump at the end, which is exactly not
//     streaming — and the finished bytes are IDENTICAL either way, which is why the test for this
//     asserts TIMING and not content.
//
//  3. ⚠ A TEN-SECOND WHOLE-EXCHANGE TIMEOUT ON THE SHARED CLIENT, WHICH NOBODY HAD NAMED.
//     `a.client` is `&http.Client{Timeout: 10 * time.Second}`, and http.Client.Timeout covers
//     READING THE BODY — not just the handshake. A flushing relay on that client streams
//     beautifully and is then guillotined at ten seconds, truncating every completion longer than
//     that, which is most of them. Fixing the flush alone would have shipped that.
//
//     The bound does not disappear; it moves to where it belongs. ResponseHeaderTimeout bounds the
//     phase that can actually hang without progress (waiting for the first byte), and the client's
//     own request context bounds the whole thing — so a browser that goes away ends the stream,
//     rather than a stopwatch that cannot tell a working stream from a stuck one.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

// lensSessionKeyPath is talyvor-lens's session-key mint (#460).
const lensSessionKeyPath = "/v1/auth/session-keys"

// sessionKeyPrefix mirrors talyvor-lens internal/sessionkey.KeyPrefix. Restated rather than
// imported because the two repos share no module; TestStream_UsesANarrowSessionKeyNotThe
// WorkspaceSessionToken asserts the credential actually carries it, so a drift shows up as a red
// test rather than as a comment that quietly stopped being true.
const sessionKeyPrefix = "tlv_sk_"

// chatCredentialRefusedCode marks the one seam a relayed upstream status cannot describe: Lens
// ANSWERED this BFF and declined to mint the chat credential. It is a code and not a diagnosis —
// see the note on handleAIStream's credential branch.
const chatCredentialRefusedCode = "CHAT_CREDENTIAL_REFUSED"

// mintRefused reports that Lens ANSWERED the session-key mint and this BFF came away without a
// credential. It exists to keep ONE distinction that the previous single error string destroyed:
// whether Lens spoke at all.
//
// ⚠ IT CARRIES THE STATUS FOR THE LOG AND NOT FOR A DIAGNOSIS. lib/productState.ts states the
// rule: "A 404 is a statement about an ADDRESS. It is never evidence about whether a product is
// deployed." An un-opted-in Lens (LENS_SESSION_KEYS_ENABLED unset ⇒ the mint route is never
// registered ⇒ chi 404) and a wrong LENS_BASE_URL are the same 404, so the browser is told WHAT
// happened and never WHY.
type mintRefused struct{ status int }

func (e mintRefused) Error() string {
	return fmt.Sprintf("session key mint refused: %d", e.status)
}

// streamProviders is the CLOSED set of Lens proxy providers this route will address.
//
// ⚠ AN ALLOWLIST, NOT CALLER INPUT, AND THE REFUSAL HAPPENS BEFORE ANY REQUEST IS MADE. The path
// segment after /api/ai/stream/ selects an upstream path on Lens. Left open, it is a
// path-controlled proxy into everything Lens mounts, including its admin surface. The set is
// exactly the providers Lens registers under /v1/proxy/.
var streamProviders = map[string]bool{
	"openai": true, "anthropic": true, "google": true,
	"bedrock": true, "mistral": true, "groq": true, "vllm": true,
}

// sessionKeyLease is a minted Lens session key and when it stops being usable.
type sessionKeyLease struct {
	key     string
	expires time.Time
}

// sessionKeyRenewMargin is how long before expiry the BFF re-mints.
//
// ⚠ IT EXISTS BECAUSE A KEY THAT IS VALID WHEN CHECKED CAN BE EXPIRED WHEN USED. A completion can
// run for minutes; handing the relay a credential with four seconds left produces a 401 halfway
// through an answer, which reads to a user as the product breaking mid-sentence.
const sessionKeyRenewMargin = 2 * time.Minute

// newStreamClient builds the client the relay uses.
//
// ⚠ NO Timeout FIELD. See point 3 above — it would bound body reads and truncate every long
// completion. What IS bounded is the phase that can hang without any progress at all.
func newStreamClient() *http.Client {
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.ResponseHeaderTimeout = 60 * time.Second
	// SSE is a long-lived response; compression would defeat incremental delivery.
	tr.DisableCompression = true
	return &http.Client{Transport: tr}
}

// sessionKeyFor returns a {proxy}-scoped Lens credential for this session, minting one if the
// cached lease is missing or close to expiry.
//
// ⚠ CACHED PER (workspace, user) AND NOT PER REQUEST. A mint is a database write in Lens plus a
// round trip; doing it per chat message would put both on the latency path of every keystroke-sized
// request. The lease is dropped when it nears expiry, never extended in place.
func (a *app) sessionKeyFor(ctx context.Context, t tenant) (string, error) {
	cacheKey := t.workspaceID + "\x00" + t.token[:min(len(t.token), 24)]

	a.skMu.Lock()
	if lease, ok := a.sessionKeys[cacheKey]; ok && time.Until(lease.expires) > sessionKeyRenewMargin {
		a.skMu.Unlock()
		return lease.key, nil
	}
	a.skMu.Unlock()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		a.cfg.lensBaseURL+lensSessionKeyPath, bytes.NewReader([]byte(`{}`)))
	if err != nil {
		return "", err
	}
	// The SESSION's workspace token — the only credential the BFF holds, and the only shape Lens's
	// mint route accepts. It is never emitted to the browser.
	req.Header.Set("Authorization", "Bearer "+t.token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := a.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("mint session key: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		// ⚠ THE BODY IS NOT ECHOED. A refusal from the mint route can name the credential shape it
		// refused; that is upstream detail, not something to hand a browser.
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		log.Printf("bff: session-key mint upstream %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
		return "", mintRefused{status: resp.StatusCode}
	}
	var out struct {
		Key       string    `json:"key"`
		ExpiresAt time.Time `json:"expires_at"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&out); err != nil {
		return "", mintRefused{status: resp.StatusCode}
	}
	if out.Key == "" {
		return "", mintRefused{status: resp.StatusCode}
	}

	a.skMu.Lock()
	a.sessionKeys[cacheKey] = sessionKeyLease{key: out.Key, expires: out.ExpiresAt}
	a.skMu.Unlock()
	return out.Key, nil
}

// handleAIStream relays POST /api/ai/stream/{provider}/{rest...} to Lens's streaming proxy.
func (a *app) handleAIStream() http.HandlerFunc {
	return a.requireTenant(func(w http.ResponseWriter, r *http.Request, t tenant) {
		if r.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodPost)
			return
		}
		// ⚠ NO same-origin check here. sameOriginWriteAllowed in ServeHTTP is "the SINGLE decider"
		// by its own comment, and it has already refused every cross-origin POST before this
		// handler is reached. A second check is a second decider, and two deciders drift.
		provider := r.PathValue("provider")
		if !streamProviders[provider] {
			// ⚠ BEFORE ANY UPSTREAM CALL. A refusal issued after the request is not a refusal.
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown provider"})
			return
		}
		rest := strings.TrimPrefix(r.PathValue("rest"), "/")

		key, err := a.sessionKeyFor(r.Context(), t)
		if err != nil {
			log.Printf("bff: stream credential: %v", err)
			// ⚠ TWO CAUSES, AND THEY WERE ONE SENTENCE. A Lens that ANSWERED the mint and declined
			// is not an unreachable Lens — and on a Lens that has not opted into session keys it is
			// the ONLY thing this route can ever say, so the collapsed form sent an operator to
			// check whether Lens was running while Lens was running. Measured, both arms, in
			// TestStream_ALensThatAnsweredIsNotReportedAsUnreachable.
			var refused mintRefused
			if errors.As(err, &refused) {
				writeJSON(w, http.StatusBadGateway, map[string]string{
					"error": "lens refused the chat credential",
					"code":  chatCredentialRefusedCode,
				})
				return
			}
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream unreachable"})
			return
		}

		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, streamRequestMaxBytes))
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "request body too large or unreadable"})
			return
		}

		// r.Context() is the browser's connection. Cancelling it cancels the upstream, which is
		// what stops Lens generating — and being billed for — tokens nobody will read.
		up, err := http.NewRequestWithContext(r.Context(), http.MethodPost,
			a.cfg.lensBaseURL+"/v1/proxy/"+provider+"/"+rest, bytes.NewReader(body))
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream request"})
			return
		}
		up.Header.Set("Authorization", "Bearer "+key)
		up.Header.Set("Content-Type", "application/json")
		// ⚠ NOT application/json. The shared forward() sets that, and it is how a streaming lane
		// silently becomes a buffered one.
		up.Header.Set("Accept", "text/event-stream")

		resp, err := a.streamClient.Do(up)
		if err != nil {
			if r.Context().Err() != nil {
				return // the browser went away; nothing to report to nobody
			}
			log.Printf("bff: stream upstream: %v", err)
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream unreachable"})
			return
		}
		defer resp.Body.Close()

		if ct := resp.Header.Get("Content-Type"); ct != "" {
			w.Header().Set("Content-Type", ct)
		}
		// A stream must not be cached or buffered by anything between here and the browser.
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Accel-Buffering", "no")
		w.WriteHeader(resp.StatusCode)
		relayFlushing(w, resp.Body)
	})
}

// streamRequestMaxBytes bounds the prompt a browser may post. Generous — a long conversation is a
// legitimately large body — but not unbounded.
const streamRequestMaxBytes = 4 << 20

// relayFlushing copies src to w, flushing after every chunk.
//
// ⚠ THE Flush IS THE ENTIRE FUNCTION. Without it this is io.Copy, the finished bytes are
// byte-identical, and every test that compares bodies still passes while the browser sees nothing
// until the completion ends. The only observable difference is WHEN the client can read a chunk,
// which is what stream_test.go asserts.
//
// A ResponseWriter that is not a Flusher cannot stream; copying without flushing is then the
// honest fallback rather than a panic, and it is unreachable from net/http's own writer.
func relayFlushing(w http.ResponseWriter, src io.Reader) {
	fl, ok := w.(http.Flusher)
	if !ok {
		_, _ = io.Copy(w, src)
		return
	}
	buf := make([]byte, 4096)
	for {
		n, err := src.Read(buf)
		if n > 0 {
			if _, werr := w.Write(buf[:n]); werr != nil {
				return // the browser hung up mid-write
			}
			fl.Flush()
		}
		if err != nil {
			return // io.EOF, a cancelled context, or an upstream fault — all end the stream
		}
	}
}
