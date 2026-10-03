package main

// lens_restart.go — B17.41: a screen opened while Lens restarts waits for it instead of showing a 502.
//
// The BFF calls Lens on 127.0.0.1:8080 directly, not through Caddy, so a Lens redeploy leaves a
// gap of a few seconds in which every dial is refused (or accepted by docker-proxy and closed at
// once). The e2e run of 2026-10-03 opened six screens inside one such gap and every Lens-backed
// read on them answered 502 — /api/keys, /api/usage, /api/models, /api/marketplace/*, /api/distill.
//
// A read that never reached Lens is safe to send again, so a GET or HEAD that fails that way is
// retried until Lens answers, lensRestartWait passes, or the request's own deadline (the client's
// 10 s) runs out. Anything else — a POST, a request with a body, any other error — is returned
// exactly as before, unless the caller marked it with resendOnRestart.
//
// B17.30 — a question asked in Chat while Lens restarts is answered once Lens is back. The chat's
// two calls (the session-key mint and the question itself) are POSTs, so B17.41 left them to fail
// with "lens upstream unreachable" (e2e 2026-10-03, capital, user 173). Both are marked: a mint
// moves no LXC, and a question Lens never answered was never settled — the hold it may have taken
// is swept and refunded, so asking it again charges it once.
//
// B17.36 — the chat's third call, a document attached to the question (POST /api/documents), is
// marked too: the upload only stores the file, so one Lens never answered is safe to send again.

import (
	"context"
	"errors"
	"io"
	"net/http"
	"syscall"
	"time"
)

const (
	// lensRestartWait is how long the server waits for a restarting Lens; a Lens redeploy measured
	// a few seconds. The client's 10 s whole-exchange timeout bounds it as well.
	lensRestartWait = 10 * time.Second
	// lensRestartRetryEvery is how often a refused read is sent again while Lens restarts.
	lensRestartRetryEvery = 250 * time.Millisecond
)

type restartTolerantTransport struct {
	base  http.RoundTripper
	wait  time.Duration
	every time.Duration
}

// newRestartTolerantTransport returns base, unchanged, when wait is zero.
func newRestartTolerantTransport(base http.RoundTripper, wait time.Duration) http.RoundTripper {
	if wait <= 0 {
		return base
	}
	return restartTolerantTransport{base: base, wait: wait, every: lensRestartRetryEvery}
}

type resendOnRestartKey struct{}

// resendOnRestart marks a request as safe to send again when it never got an answer from Lens.
// Only the chat's calls carry it; nothing that moves LXC may.
func resendOnRestart(ctx context.Context) context.Context {
	return context.WithValue(ctx, resendOnRestartKey{}, true)
}

func (t restartTolerantTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	giveUp := time.Now().Add(t.wait)
	for {
		resp, err := t.base.RoundTrip(req)
		if err == nil || !retriable(req) || !lensNotListening(err) || time.Now().After(giveUp) {
			return resp, err
		}
		timer := time.NewTimer(t.every)
		select {
		case <-req.Context().Done():
			timer.Stop()
			return nil, err
		case <-timer.C:
		}
		if req.GetBody != nil {
			body, berr := req.GetBody()
			if berr != nil {
				return nil, err
			}
			req = req.Clone(req.Context())
			req.Body = body
		}
	}
}

func retriable(req *http.Request) bool {
	if marked, _ := req.Context().Value(resendOnRestartKey{}).(bool); marked {
		return req.Body == nil || req.Body == http.NoBody || req.GetBody != nil
	}
	return (req.Method == http.MethodGet || req.Method == http.MethodHead) &&
		(req.Body == nil || req.Body == http.NoBody)
}

// lensNotListening reports the errors a restarting Lens produces: nothing listening (refused), or
// a connection docker-proxy accepted and dropped before Lens could answer (reset, EOF).
func lensNotListening(err error) bool {
	return errors.Is(err, syscall.ECONNREFUSED) ||
		errors.Is(err, syscall.ECONNRESET) ||
		errors.Is(err, io.EOF) ||
		errors.Is(err, io.ErrUnexpectedEOF)
}
