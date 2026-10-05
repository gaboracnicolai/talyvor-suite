package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// B29.30 — Export as HTML reaches talyvor-docs' page export for the SESSION's identity and comes
// back as the HTML file Docs named, sandboxed so it can never run on the app's origin.
func TestDocsExportPage_DownloadsTheHTMLDocsRendered(t *testing.T) {
	docs := &captureUpstream{}
	docs.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		docs.path, docs.method, docs.rawQuery, docs.headers = r.URL.Path, r.Method, r.URL.RawQuery, r.Header.Clone()
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="runbook.html"`)
		_, _ = io.WriteString(w, `<!doctype html><style>:root{--tv-accent:#0F7A6C}</style><h1>Runbook</h1>`)
	}))
	t.Cleanup(docs.srv.Close)
	a, sess := productApp(t, nil, docs)

	rec := cycleReq(t, a, sess, http.MethodGet, "/api/docs/spaces/s1/pages/p1/export?format=html", "")
	if rec.Code != http.StatusOK || docs.method != http.MethodGet ||
		docs.path != "/v1/spaces/s1/pages/p1/export" || docs.rawQuery != "format=html" {
		t.Fatalf("export: %d, upstream got %s %s?%s", rec.Code, docs.method, docs.path, docs.rawQuery)
	}
	if docs.headers.Get("X-User-Email") == "" {
		t.Fatal("the session identity was not attached, so Docs could not check View on the page")
	}
	if got := rec.Header().Get("Content-Disposition"); got != `attachment; filename="runbook.html"` {
		t.Fatalf("Content-Disposition = %q, want Docs' attachment filename", got)
	}
	if got := rec.Header().Get("Content-Type"); !strings.HasPrefix(got, "text/html") {
		t.Fatalf("Content-Type = %q, want text/html", got)
	}
	if got := rec.Header().Get("Content-Security-Policy"); got != "sandbox" {
		t.Fatalf("Content-Security-Policy = %q, want sandbox", got)
	}
	if !strings.Contains(rec.Body.String(), "<h1>Runbook</h1>") {
		t.Fatalf("body = %q, want the page Docs rendered", rec.Body.String())
	}

	docs.path = ""
	rec = cycleReq(t, a, sess, http.MethodGet, "/api/docs/spaces/s1/pages/p1/export?format=pdf", "")
	if rec.Code != http.StatusBadRequest || docs.path != "" {
		t.Fatalf("format=pdf: %d, upstream path %q — want 400 before any dial", rec.Code, docs.path)
	}
}
