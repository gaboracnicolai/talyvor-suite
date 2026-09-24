package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// B2.3 — POST /api/docs/pages/{pageID}/rewrite relays shorten / lengthen / fix-grammar on the
// Docs editor's selection to talyvor-docs' Transform. The harness is docs_summarize_test.go's.

func postRewrite(t *testing.T, a *app, sess *http.Cookie, pageID, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/docs/pages/"+pageID+"/rewrite", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(sess)
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	return rec
}

// The allowlisted action goes upstream with THIS route's page id, whatever else the caller sent.
func TestDocsRewrite_SendsTheActionOnThisPage(t *testing.T) {
	for _, action := range []string{"shorter", "longer", "grammar"} {
		u := newTransformUpstream(t, http.StatusOK, `{"text":"rewritten"}`)
		a, sess := summarizeApp(t, u)
		rec := postRewrite(t, a, sess, "pg-mine",
			`{"action":"`+action+`","text":"the selected words","page_id":"pg-someone-elses"}`)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status = %d: %s", action, rec.Code, rec.Body.String())
		}
		var sent map[string]any
		if err := json.Unmarshal([]byte(u.gotBody), &sent); err != nil {
			t.Fatalf("%s: upstream body is not JSON: %v", action, err)
		}
		if sent["action"] != action || sent["page_id"] != "pg-mine" || sent["text"] != "the selected words" {
			t.Errorf("%s: upstream body = %v, want the action, this path's page and the text", action, sent)
		}
	}
}

// Anything outside the three — summarize included, which has its own route — and an empty text
// are refused before a completion is bought.
func TestDocsRewrite_RefusesOtherActionsAndEmptyTextWithoutSpending(t *testing.T) {
	for _, body := range []string{
		`{"action":"summarize","text":"words"}`,
		`{"action":"translate","text":"words"}`,
		`{"text":"words"}`,
		`{"action":"shorter","text":"  \n "}`,
	} {
		u := newTransformUpstream(t, http.StatusOK, `{"text":"x"}`)
		a, sess := summarizeApp(t, u)
		rec := postRewrite(t, a, sess, "pg-1", body)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400", body, rec.Code)
		}
		if n := len(u.requests()); n != 0 {
			t.Errorf("%s: upstream saw %d request(s), want 0 — a refused rewrite must spend nothing", body, n)
		}
	}
}

// newWriteUpstream is newTransformUpstream's fake Docs, answering /ai/write instead.
func newWriteUpstream(t *testing.T, status int, body string) *transformUpstream {
	t.Helper()
	u := &transformUpstream{mu: make(chan struct{}, 1), status: status, body: body}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/workspaces/{wsID}/ai/write", func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		u.mu <- struct{}{}
		u.seen = append(u.seen, r.Method+" "+r.URL.Path)
		u.gotBody = string(raw)
		<-u.mu
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(u.status)
		_, _ = io.WriteString(w, u.body)
	})
	mux.HandleFunc(provisionPath, func(w http.ResponseWriter, r *http.Request) { serveFakeProvision(w, r) })
	mux.HandleFunc(trackBootstrapPath, func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"workspace_id":"track-ws-7"}`)
	})
	u.srv = httptest.NewServer(mux)
	t.Cleanup(u.srv.Close)
	return u
}

// Write with AI: the prompt and context go to /ai/write with THIS route's page id; a blank prompt
// is refused before anything is sent.
func TestDocsWrite_SendsPromptOnThisPageAndRefusesABlankOne(t *testing.T) {
	u := newWriteUpstream(t, http.StatusOK, `{"text":"written"}`)
	a, sess := summarizeApp(t, u)
	req := httptest.NewRequest(http.MethodPost, "/api/docs/pages/pg-mine/write",
		strings.NewReader(`{"prompt":"a rollback checklist","context":"the page","page_id":"pg-other"}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(sess)
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	if got := u.requests(); len(got) != 1 || got[0] != "POST /v1/workspaces/track-ws-7/ai/write" {
		t.Fatalf("upstream saw %v, want one POST to /ai/write in the session workspace", got)
	}
	var sent map[string]any
	if err := json.Unmarshal([]byte(u.gotBody), &sent); err != nil {
		t.Fatalf("upstream body is not JSON: %v", err)
	}
	if sent["prompt"] != "a rollback checklist" || sent["context"] != "the page" || sent["page_id"] != "pg-mine" {
		t.Errorf("upstream body = %v, want the prompt, the context and this path's page", sent)
	}

	u2 := newWriteUpstream(t, http.StatusOK, `{"text":"x"}`)
	a2, sess2 := summarizeApp(t, u2)
	req2 := httptest.NewRequest(http.MethodPost, "/api/docs/pages/pg-1/write", strings.NewReader(`{"prompt":"  "}`))
	req2.Header.Set("Content-Type", "application/json")
	req2.AddCookie(sess2)
	rec2 := httptest.NewRecorder()
	a2.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusBadRequest || len(u2.requests()) != 0 {
		t.Errorf("blank prompt: status %d, %d upstream request(s); want 400 and none", rec2.Code, len(u2.requests()))
	}
}
