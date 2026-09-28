package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// fakeLensStoredAnswers keeps a workspace's stored answers and deletion requests the way Lens's
// B21.3 routes do: counts by scope, a DELETE that needs the workspace's name, and requests that
// start "requested".
type fakeLensStoredAnswers struct {
	mu       sync.Mutex
	counts   storedAnswersCounts
	requests []map[string]any
	deletes  []string // the method and path of every delete Lens received
}

func newFakeLensStoredAnswers(t *testing.T) (*app, *fakeLensStoredAnswers) {
	t.Helper()
	f := &fakeLensStoredAnswers{counts: storedAnswersCounts{SharedAnswers: 12, PrivateAnswers: 30, SharedConversions: 2, PrivateConversions: 5}}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		raw, _ := io.ReadAll(io.LimitReader(r.Body, 1<<16))
		var in map[string]string
		_ = json.Unmarshal(raw, &in)
		ws := strings.Split(strings.TrimPrefix(r.URL.Path, "/v1/workspaces/"), "/")[0]
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(r.URL.Path, "/stored-answers") && r.Method == http.MethodDelete:
			f.deletes = append(f.deletes, r.Method+" "+r.URL.Path)
			if in["confirm"] != ws {
				w.WriteHeader(http.StatusBadRequest)
				_ = json.NewEncoder(w).Encode(map[string]string{"error": "confirm must be this workspace's name"})
				return
			}
			deleted := storedAnswersCounts{SharedAnswers: f.counts.SharedAnswers, SharedConversions: f.counts.SharedConversions}
			f.counts.SharedAnswers, f.counts.SharedConversions = 0, 0
			if in["scope"] == "all" {
				deleted.PrivateAnswers, deleted.PrivateConversions = f.counts.PrivateAnswers, f.counts.PrivateConversions
				f.counts.PrivateAnswers, f.counts.PrivateConversions = 0, 0
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"scope": in["scope"], "deleted": deleted})
		case strings.HasSuffix(r.URL.Path, "/stored-answers"):
			_ = json.NewEncoder(w).Encode(f.counts)
		case strings.HasSuffix(r.URL.Path, "/deletion-requests") && r.Method == http.MethodPost:
			req := map[string]any{"id": len(f.requests) + 1, "workspace_id": ws, "requested_by": "session_token",
				"note": in["note"], "status": "requested", "requested_at": "2026-09-28T01:00:00Z"}
			f.requests = append(f.requests, req)
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(req)
		case strings.HasSuffix(r.URL.Path, "/deletion-requests"):
			_ = json.NewEncoder(w).Encode(map[string]any{"requests": f.requests})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return newApp(config{
		addr:            "127.0.0.1:0",
		lensBaseURL:     srv.URL,
		provisionSecret: testProvisionSecret,
		webDist:         t.TempDir(),
		authMode:        authModeDisabled,
	}, nil), f
}

func readStoredAnswers(t *testing.T, a *app) storedAnswersReading {
	t.Helper()
	rec := doJSON(a, http.MethodGet, "/api/features/stored-answers", "")
	var out storedAnswersReading
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &out) != nil {
		t.Fatalf("GET /api/features/stored-answers = %d %s", rec.Code, rec.Body.String())
	}
	return out
}

// B21.4 — the counts come from Lens with the name to confirm by; a wrong name deletes nothing and
// says so; "shared" empties the shared counts and leaves the private ones; "all" empties the rest.
func TestStoredAnswersAreCountedAndDeletedByScopeOnlyWithTheWorkspaceName(t *testing.T) {
	a, f := newFakeLensStoredAnswers(t)
	st := readStoredAnswers(t, a)
	if st.SharedAnswers != 12 || st.PrivateAnswers != 30 || st.ConfirmWith == "" {
		t.Fatalf("read = %+v", st)
	}

	if rec := doJSON(a, http.MethodPost, "/api/features/stored-answers/delete", `{"scope":"shared","confirm":"not-mine"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("a wrong name = %d %s, want Lens's 400", rec.Code, rec.Body.String())
	}
	if st := readStoredAnswers(t, a); st.SharedAnswers != 12 {
		t.Fatalf("a refused delete removed answers: %+v", st)
	}

	rec := doJSON(a, http.MethodPost, "/api/features/stored-answers/delete", `{"scope":"shared","confirm":"`+st.ConfirmWith+`"}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"shared_answers":12`) {
		t.Fatalf("delete shared = %d %s", rec.Code, rec.Body.String())
	}
	if st := readStoredAnswers(t, a); st.SharedAnswers != 0 || st.SharedConversions != 0 || st.PrivateAnswers != 30 {
		t.Fatalf("after deleting shared: %+v", st)
	}
	if want := "DELETE /v1/workspaces/" + st.ConfirmWith + "/stored-answers"; f.deletes[len(f.deletes)-1] != want {
		t.Fatalf("Lens received %q, want %q", f.deletes[len(f.deletes)-1], want)
	}

	if rec := doJSON(a, http.MethodPost, "/api/features/stored-answers/delete", `{"scope":"all","confirm":"`+st.ConfirmWith+`"}`); rec.Code != http.StatusOK {
		t.Fatalf("delete all = %d %s", rec.Code, rec.Body.String())
	}
	if st := readStoredAnswers(t, a); st.storedAnswersCounts != (storedAnswersCounts{}) {
		t.Fatalf("after deleting everything: %+v", st)
	}
	if rec := doJSON(a, http.MethodPost, "/api/features/stored-answers/delete", `{"scope":"private","confirm":"x"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("an unknown scope = %d, want 400", rec.Code)
	}
}

// B21.4 — asking Talyvor to delete everything files a request with Lens, and its status is then listed.
func TestDeletionRequestIsFiledAndItsStatusListed(t *testing.T) {
	a, _ := newFakeLensStoredAnswers(t)
	if rec := doJSON(a, http.MethodGet, "/api/features/deletion-requests", ""); rec.Body.String() != `{"requests":[]}`+"\n" {
		t.Fatalf("GET before any request = %d %s", rec.Code, rec.Body.String())
	}
	rec := doJSON(a, http.MethodPost, "/api/features/deletion-requests", "")
	if rec.Code != http.StatusCreated || !strings.Contains(rec.Body.String(), `"status":"requested"`) {
		t.Fatalf("POST = %d %s", rec.Code, rec.Body.String())
	}
	rec = doJSON(a, http.MethodGet, "/api/features/deletion-requests", "")
	if !strings.Contains(rec.Body.String(), `"id":1,"status":"requested","requested_at":"2026-09-28T01:00:00Z"`) {
		t.Fatalf("GET after the request = %d %s", rec.Code, rec.Body.String())
	}
}
