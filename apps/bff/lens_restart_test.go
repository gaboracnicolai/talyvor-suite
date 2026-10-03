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
		switch {
		case r.URL.Path == provisionPath:
			serveFakeProvision(w, r)
		case r.URL.Path == lensSessionKeyPath:
			w.WriteHeader(http.StatusCreated)
			_, _ = io.WriteString(w, `{"key":"`+testSessionKey+`","expires_at":"`+time.Now().Add(time.Hour).UTC().Format(time.RFC3339)+`"}`)
		case strings.HasPrefix(r.URL.Path, "/v1/proxy/"):
			// The answer repeats the question, so a test sees the question arrived whole.
			question, _ := io.ReadAll(r.Body)
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = io.WriteString(w, "data: "+string(question)+"\n\n")
		default:
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"path":"`+r.URL.Path+`"}`)
		}
	})}}
	srv.Start()
	t.Cleanup(srv.Close)
	return srv
}

// lensRestarting stands on Lens's port as docker-proxy does while the new container boots: it takes
// each connection, reads the request, and hangs up without an answer.
func lensRestarting(t *testing.T, addr string) net.Listener {
	t.Helper()
	l, err := net.Listen("tcp", addr)
	if err != nil {
		t.Fatalf("listen %s: %v", addr, err)
	}
	go func() {
		for {
			c, err := l.Accept()
			if err != nil {
				return
			}
			go func() {
				_ = c.SetReadDeadline(time.Now().Add(50 * time.Millisecond))
				_, _ = io.Copy(io.Discard, c)
				_ = c.Close()
			}()
		}
	}()
	return l
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

	client := &http.Client{Timeout: 10 * time.Second, Transport: newRestartTolerantTransport(http.DefaultTransport, lensRestartWait)}
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

// B17.30 — a question asked in Chat while Lens restarts is answered once Lens is back: for a person
// whose chat credential is not minted yet (the mint meets the restart), and for one whose is (the
// question meets it).
func TestChatQuestionWaitsForLensRestartInsteadOf502(t *testing.T) {
	lens := fakeLensOn(t, "127.0.0.1:0")
	addr := lens.Listener.Addr().String()
	cfg := config{
		lensBaseURL:     "http://" + addr,
		lensRestartWait: bootWithUnset(t, "LENS_BASE_URL", minimalDisabled()).lensRestartWait,
		provisionSecret: testProvisionSecret,
		authMode:        authModeOIDC, oidcIssuer: "https://idp.example.com",
		publicBaseURL: "https://app.talyvor.com", sessionTTL: time.Hour,
		webDist: t.TempDir(),
	}
	auth := newSessionOnlyAuthenticator(cfg)
	seedProvisionedSession(auth, "chat-sid", "u1", "ng@example.com", "u-test-workspace")
	a := newApp(cfg, auth)

	const question = `{"stream":true,"messages":[{"role":"user","content":"What is the capital of Greece?"}]}`
	askDuringRestart := func(who string) {
		lens.Close()
		down := lensRestarting(t, addr)
		back := make(chan *httptest.Server, 1)
		go func() {
			time.Sleep(700 * time.Millisecond)
			_ = down.Close()
			back <- fakeLensOn(t, addr)
		}()

		req := httptest.NewRequest(http.MethodPost, "/api/ai/stream/openai/v1/chat/completions", strings.NewReader(question))
		req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "chat-sid"})
		req.Header.Set("Origin", "https://app.talyvor.com")
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		start := time.Now()
		a.ServeHTTP(rec, req)
		waited := time.Since(start)
		lens = <-back

		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "capital of Greece") {
			t.Fatalf("%s: a question asked during the restart answered %d %s, want Lens's answer once it is back", who, rec.Code, rec.Body)
		}
		if waited < 500*time.Millisecond {
			t.Fatalf("%s: answered after %v — the question never met the restart gap", who, waited)
		}
	}
	askDuringRestart("first question, credential not minted yet")
	askDuringRestart("next question, credential already minted")
}
