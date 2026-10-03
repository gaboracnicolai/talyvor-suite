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
// exactly as before.

import (
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

// newRestartTolerantTransport returns the default transport, unchanged, when wait is zero.
func newRestartTolerantTransport(wait time.Duration) http.RoundTripper {
	if wait <= 0 {
		return http.DefaultTransport
	}
	return restartTolerantTransport{base: http.DefaultTransport, wait: wait, every: lensRestartRetryEvery}
}

func (t restartTolerantTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	giveUp := time.Now().Add(t.wait)
	for {
		resp, err := t.base.RoundTrip(req)
		if err == nil || !retriableRead(req) || !lensNotListening(err) || time.Now().After(giveUp) {
			return resp, err
		}
		timer := time.NewTimer(t.every)
		select {
		case <-req.Context().Done():
			timer.Stop()
			return nil, err
		case <-timer.C:
		}
	}
}

func retriableRead(req *http.Request) bool {
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
