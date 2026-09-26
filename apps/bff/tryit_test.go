package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// B11.3 — each Try-it route reaches the session workspace's Lens preview with the input as sent, and
// relays Lens's answer; a 4xx reason from Lens (an unsupported document) reaches the page intact.
func TestTryItRoutesForwardToLensPreviewAndRelayItsAnswer(t *testing.T) {
	var got []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		got = append(got, r.Method+" "+r.URL.Path+" "+r.Header.Get("Content-Type")+" "+string(raw))
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(r.URL.Path, "/tare/preview"):
			_, _ = io.WriteString(w, `{"reduced":"R","kind":"json","refused":false,"tokens_in_estimated":40,"tokens_out_estimated":10}`)
		case r.Header.Get("Content-Type") == "image/png":
			w.WriteHeader(http.StatusBadRequest)
			_, _ = io.WriteString(w, `{"error":"unsupported or missing Content-Type"}`)
		default:
			_, _ = io.WriteString(w, `{"markdown":"# Plan","format":"html","savings":{"tokens_saved":12}}`)
		}
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret,
		webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	rec := doJSON(a, http.MethodPost, "/api/features/tare/preview", `{"content":"[1,2]","kind":"json","model":"gpt-4o"}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"reduced":"R"`) {
		t.Fatalf("tare preview = %d %s", rec.Code, rec.Body.String())
	}
	if len(got) != 1 || !strings.HasPrefix(got[0], "POST /v1/workspaces/") || !strings.Contains(got[0], "/tare/preview application/json ") ||
		!strings.Contains(got[0], `"content":"[1,2]"`) || !strings.Contains(got[0], `"model":"gpt-4o"`) {
		t.Errorf("Lens saw %q", got)
	}

	got = nil
	req := httptest.NewRequest(http.MethodPost, "/api/features/conversion/preview", strings.NewReader("<h1>Plan</h1>"))
	req.Header.Set("Content-Type", "text/html")
	rec = httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"markdown":"# Plan"`) {
		t.Fatalf("conversion preview = %d %s", rec.Code, rec.Body.String())
	}
	if len(got) != 1 || !strings.Contains(got[0], "/distill/preview text/html <h1>Plan</h1>") {
		t.Errorf("Lens saw %q, want the document bytes under its own Content-Type", got)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/features/conversion/preview", strings.NewReader("\x89PNG"))
	req.Header.Set("Content-Type", "image/png")
	rec = httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "unsupported or missing Content-Type") {
		t.Errorf("an unsupported document = %d %s, want Lens's 400 reason relayed", rec.Code, rec.Body.String())
	}
}
