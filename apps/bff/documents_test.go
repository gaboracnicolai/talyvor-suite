package main

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// B18.24 — a document the chat attaches reaches Lens POST /v1/documents whole, with its media type and
// name, on the chat's own session key (the credential that will reference it), and Lens's answer — the
// tdoc_ id — comes back as Lens gave it. A file over 25 MB is refused here and never sent.
func TestDocumentUploadReachesLensOnTheChatsKey(t *testing.T) {
	var gotAuth, gotType, gotQuery string
	var gotBytes int
	uploads := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == provisionPath:
			serveFakeProvision(w, r)
		case r.URL.Path == lensSessionKeyPath && r.Method == http.MethodPost:
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_, _ = fmt.Fprintf(w, `{"key":%q,"id":"sk-1","prefix":"tlv_sk_01234567","expires_at":%q}`,
				testSessionKey, time.Now().Add(time.Hour).UTC().Format(time.RFC3339))
		case r.URL.Path == "/v1/documents" && r.Method == http.MethodPost:
			uploads++
			gotAuth, gotType, gotQuery = r.Header.Get("Authorization"), r.Header.Get("Content-Type"), r.URL.RawQuery
			b, _ := io.ReadAll(r.Body)
			gotBytes = len(b)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_, _ = io.WriteString(w, `{"id":"tdoc_1","media_type":"application/vnd.openxmlformats-officedocument.presentationml.presentation","filename":"Q3 deck.pptx","size_bytes":20000000}`)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	a, sess := streamApp(t, &streamUpstream{srv: srv})
	ts := httptest.NewServer(a)
	t.Cleanup(ts.Close)

	post := func(size int) *http.Response {
		req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/documents?filename=Q3%20deck.pptx", bytes.NewReader(make([]byte, size)))
		req.AddCookie(sess)
		req.Header.Set("Origin", "https://app.talyvor.com")
		req.Header.Set("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation")
		resp, err := ts.Client().Do(req)
		if err != nil {
			t.Fatalf("do: %v", err)
		}
		t.Cleanup(func() { _ = resp.Body.Close() })
		return resp
	}

	resp := post(20_000_000)
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusCreated || !strings.Contains(string(body), `"id":"tdoc_1"`) {
		t.Fatalf("upload = %d %s, want Lens's 201 and its id", resp.StatusCode, body)
	}
	if gotAuth != "Bearer "+testSessionKey || gotBytes != 20_000_000 || gotQuery != "filename=Q3+deck.pptx" ||
		gotType != "application/vnd.openxmlformats-officedocument.presentationml.presentation" {
		t.Fatalf("Lens received auth %q, %d bytes, query %q, type %q", gotAuth, gotBytes, gotQuery, gotType)
	}

	if resp := post(documentMaxBytes + 1); resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("a 25 MB + 1 byte upload = %d, want 413", resp.StatusCode)
	}
	if uploads != 1 {
		t.Fatalf("Lens received %d uploads, want 1 (the oversized file never leaves the BFF)", uploads)
	}
}

// B18.24 — what converting a document saved reaches the browser with the answer, on the stream.
func TestStreamRelaysWhatConversionSaved(t *testing.T) {
	up := newStreamUpstream(t)
	up.noBlock = true
	up.answerHeaders = map[string]string{"X-Talyvor-Distill-Tokens-Saved": "1834", "X-Talyvor-Distill-Bytes-Saved": "19950000"}
	a, sess := streamApp(t, up)
	resp, _, done := openStream(t, a, sess, "/api/ai/stream/openai/v1/chat/completions", `{"model":"m","stream":true,"messages":[]}`)
	defer done()
	if got := resp.Header.Get("X-Talyvor-Distill-Tokens-Saved"); got != "1834" {
		t.Fatalf("tokens saved = %q, want Lens's 1834", got)
	}
	if got := resp.Header.Get("X-Talyvor-Distill-Bytes-Saved"); got != "19950000" {
		t.Fatalf("bytes saved = %q, want Lens's 19950000", got)
	}
}
