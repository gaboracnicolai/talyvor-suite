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

// B28.380 — the files uploaded in Chat, listed and deleted on the chat's own session key, the credential
// that uploaded them: Lens GET /v1/documents lists them, DELETE /v1/documents/{id} removes one, and after
// that its id answers 404 and it is gone from the list (B28.132's DONE line, as the BFF passes it on).
func TestDocumentsListedAndDeletedOnTheChatsKey(t *testing.T) {
	type stored struct{ id, name string }
	docs := []stored{{"tdoc_3f2a9c1e-0b7d-4c55-9e21-6a0d1c2b3e4f", "report.pdf"}, {"tdoc_8b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d", "notes.md"}}
	var auths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == provisionPath:
			serveFakeProvision(w, r)
			return
		case r.URL.Path == lensSessionKeyPath && r.Method == http.MethodPost:
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_, _ = fmt.Fprintf(w, `{"key":%q,"id":"sk-1","prefix":"tlv_sk_01234567","expires_at":%q}`,
				testSessionKey, time.Now().Add(time.Hour).UTC().Format(time.RFC3339))
			return
		}
		auths = append(auths, r.Method+" "+r.URL.Path+" "+r.Header.Get("Authorization"))
		switch {
		case r.URL.Path == "/v1/documents" && r.Method == http.MethodGet:
			var b strings.Builder
			for i, d := range docs {
				if i > 0 {
					b.WriteString(",")
				}
				fmt.Fprintf(&b, `{"id":%q,"media_type":"application/pdf","filename":%q,"size_bytes":1234,"uploaded_at":"2026-10-08T12:00:00Z"}`, d.id, d.name)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprintf(w, `{"documents":[%s]}`, b.String())
		case strings.HasPrefix(r.URL.Path, "/v1/documents/") && r.Method == http.MethodDelete:
			id := strings.TrimPrefix(r.URL.Path, "/v1/documents/")
			for i, d := range docs {
				if d.id == id {
					docs = append(docs[:i], docs[i+1:]...)
					w.WriteHeader(http.StatusNoContent)
					return
				}
			}
			http.Error(w, `{"error":"document not found"}`, http.StatusNotFound)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	a, sess := streamApp(t, &streamUpstream{srv: srv})
	ts := httptest.NewServer(a)
	t.Cleanup(ts.Close)

	do := func(method, path string) (int, string) {
		req, _ := http.NewRequest(method, ts.URL+path, nil)
		req.AddCookie(sess)
		req.Header.Set("Origin", "https://app.talyvor.com")
		resp, err := ts.Client().Do(req)
		if err != nil {
			t.Fatalf("%s %s: %v", method, path, err)
		}
		defer func() { _ = resp.Body.Close() }()
		b, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, string(b)
	}
	report, notes := docs[0].id, docs[1].id

	code, body := do(http.MethodGet, "/api/documents")
	if code != http.StatusOK || !strings.Contains(body, `"id":"`+report+`"`) || !strings.Contains(body, `"filename":"notes.md"`) ||
		!strings.Contains(body, `"size_bytes":1234`) || !strings.Contains(body, `"uploaded_at":"2026-10-08T12:00:00Z"`) {
		t.Fatalf("list = %d %s, want both files with their name, size and upload time", code, body)
	}
	if code, body := do(http.MethodDelete, "/api/documents/"+report); code != http.StatusNoContent {
		t.Fatalf("delete = %d %s, want 204", code, body)
	}
	code, body = do(http.MethodGet, "/api/documents")
	if code != http.StatusOK || strings.Contains(body, report) || !strings.Contains(body, notes) {
		t.Fatalf("list after the delete = %d %s, want notes.md alone", code, body)
	}
	if code, body := do(http.MethodDelete, "/api/documents/"+report); code != http.StatusNotFound {
		t.Fatalf("the deleted file's id = %d %s, want 404", code, body)
	}
	// Not an id Lens stores a document under: refused here, never sent.
	if code, _ := do(http.MethodDelete, "/api/documents/..%2Fapi-keys"); code != http.StatusNotFound {
		t.Fatalf("delete of a path that is not a document id = %d, want 404", code)
	}
	for _, got := range auths {
		if !strings.HasSuffix(got, " Bearer "+testSessionKey) {
			t.Fatalf("Lens received %q, want every documents call on the chat's session key", got)
		}
	}
	if len(auths) != 4 {
		t.Fatalf("Lens received %d documents calls %q, want 4 (list, delete, list, delete)", len(auths), auths)
	}
}

// B28.380 — a Lens without the list (before talyvor-lens B28.132) answers the upload's path with 405: the
// browser is told the list is not on this deployment yet, not that there are no files.
func TestDocumentListSaysWhenLensHasNone(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == provisionPath:
			serveFakeProvision(w, r)
		case r.URL.Path == lensSessionKeyPath && r.Method == http.MethodPost:
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_, _ = fmt.Fprintf(w, `{"key":%q,"id":"sk-1","prefix":"tlv_sk_01234567","expires_at":%q}`,
				testSessionKey, time.Now().Add(time.Hour).UTC().Format(time.RFC3339))
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}))
	t.Cleanup(srv.Close)
	a, sess := streamApp(t, &streamUpstream{srv: srv})
	req := httptest.NewRequest(http.MethodGet, "/api/documents", nil)
	req.AddCookie(sess)
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), `"code":"documents_unavailable"`) {
		t.Fatalf("list on a Lens without one = %d %s, want 404 documents_unavailable", rec.Code, rec.Body.String())
	}
}
