package main

import (
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// fakeLensOn serves the provisioning call and echoes every other path, on a fixed address so the
// test can stop it and start it again on the same port — a Lens redeploy, as the BFF sees it.
func fakeLensOn(t *testing.T, addr string) *httptest.Server {
	t.Helper()
	l, err := net.Listen("tcp", addr)
	if err != nil {
		t.Fatalf("listen %s: %v", addr, err)
	}
	srv := &httptest.Server{Listener: l, Config: &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"path":"`+r.URL.Path+`"}`)
	})}}
	srv.Start()
	t.Cleanup(srv.Close)
	return srv
}

// B17.41 — a screen opened while Lens restarts waits for it instead of showing a 502.
func TestScreenReadWaitsForLensRestartInsteadOf502(t *testing.T) {
	addr := "127.0.0.1:0"
	first := fakeLensOn(t, addr)
	addr = first.Listener.Addr().String()
	// The wait the real server boots with (loadConfig), so the test proves it is switched on.
	wait := bootWithUnset(t, "LENS_BASE_URL", minimalDisabled()).lensRestartWait
	a := newApp(config{
		addr:            "127.0.0.1:0",
		lensBaseURL:     "http://" + addr,
		lensRestartWait: wait,
		provisionSecret: testProvisionSecret,
		webDist:         t.TempDir(),
		authMode:        authModeDisabled,
	}, nil)

	get := func() *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/usage", nil))
		return rec
	}
	if rec := get(); rec.Code != http.StatusOK {
		t.Fatalf("before the restart: %d %s", rec.Code, rec.Body)
	}

	first.Close() // Lens goes down: every dial to its port is refused
	go func() {
		time.Sleep(700 * time.Millisecond)
		fakeLensOn(t, addr) // and comes back on the same port
	}()

	start := time.Now()
	rec := get()
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "/v1/api/usage") {
		t.Fatalf("a screen read during the restart answered %d %s, want Lens's answer once it is back", rec.Code, rec.Body)
	}
	if waited := time.Since(start); waited < 500*time.Millisecond {
		t.Fatalf("answered after %v — the read never met the restart gap", waited)
	}
}

// A request that may change something is never sent twice: a POST to a Lens that is down fails at
// once, as it did before B17.41.
func TestPostToARestartingLensIsNotRetried(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	_ = l.Close()

	client := &http.Client{Timeout: 10 * time.Second, Transport: newRestartTolerantTransport(lensRestartWait)}
	start := time.Now()
	resp, err := client.Post("http://"+addr+"/v1/agents/fund", "application/json", strings.NewReader(`{}`))
	if err == nil {
		_ = resp.Body.Close()
		t.Fatal("POST to a closed port succeeded")
	}
	if waited := time.Since(start); waited > time.Second {
		t.Fatalf("POST failed after %v — it was retried", waited)
	}
}
