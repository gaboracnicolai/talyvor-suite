package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// B23.12 — the chat learns which request an answer was (Lens's X-Talyvor-Request-ID, relayed on the
// stream), and a thumbs-down naming it reaches Lens's POST /v1/feedback on the chat's session key;
// the chat is told what Lens removed.
func TestFeedback_AThumbsDownOnAStreamedAnswerReachesLensAndSaysWhatWasRemoved(t *testing.T) {
	var mu sync.Mutex
	stored := map[string]bool{"req-7": true}
	var gotAuth, gotBody string
	lens := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == provisionPath:
			serveFakeProvision(w, r)
		case r.URL.Path == lensSessionKeyPath:
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_, _ = fmt.Fprintf(w, `{"key":%q,"expires_at":%q}`,
				testSessionKey, time.Now().Add(time.Hour).UTC().Format(time.RFC3339))
		case strings.HasPrefix(r.URL.Path, "/v1/proxy/"):
			w.Header().Set("Content-Type", "text/event-stream")
			w.Header().Set("X-Talyvor-Request-ID", "req-7")
			_, _ = io.WriteString(w, "data: one\n\n")
		case r.URL.Path == "/v1/feedback" && r.Method == http.MethodPost:
			b, _ := io.ReadAll(r.Body)
			var in struct {
				RequestID string `json:"request_id"`
				Signal    string `json:"signal"`
			}
			_ = json.Unmarshal(b, &in)
			mu.Lock()
			gotAuth, gotBody = r.Header.Get("Authorization"), string(b)
			was := stored[in.RequestID]
			delete(stored, in.RequestID)
			mu.Unlock()
			removed := 0
			if was {
				removed = 1
			}
			_, _ = fmt.Fprintf(w, `{"request_id":%q,"signal":%q,"stored":%t,"served_from":"pool","answers_removed":%d,"exact_copies_removed":%d}`,
				in.RequestID, in.Signal, was, removed, 2*removed)
		default:
			http.NotFound(w, r)
		}
	}))
	defer lens.Close()
	a, sess := streamApp(t, &streamUpstream{srv: lens})

	resp, br, done := openStream(t, a, sess, "/api/ai/stream/anthropic/v1/messages", `{"stream":true}`)
	_, _ = io.ReadAll(br)
	done()
	id := resp.Header.Get("X-Talyvor-Request-ID")
	if id != "req-7" {
		t.Fatalf("the stream carried request id %q, want Lens's req-7 — without it the chat cannot name the answer", id)
	}

	bff := httptest.NewServer(a)
	defer bff.Close()
	post := func(body string) (int, string) {
		req, _ := http.NewRequest(http.MethodPost, bff.URL+"/api/ai/feedback", strings.NewReader(body))
		req.AddCookie(sess)
		req.Header.Set("Origin", "https://app.talyvor.com")
		req.Header.Set("Content-Type", "application/json")
		res, err := bff.Client().Do(req)
		if err != nil {
			t.Fatalf("feedback: %v", err)
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		return res.StatusCode, string(b)
	}

	code, body := post(`{"request_id":"` + id + `","signal":"negative"}`)
	want := `{"stored":true,"served_from":"pool","answers_removed":1,"exact_copies_removed":2}` + "\n"
	if code != http.StatusOK || body != want {
		t.Fatalf("thumbs-down = %d %s, want 200 %s", code, body, want)
	}
	mu.Lock()
	auth, sent, still := gotAuth, gotBody, stored["req-7"]
	mu.Unlock()
	if auth != "Bearer "+testSessionKey || sent != `{"request_id":"req-7","signal":"negative"}` {
		t.Fatalf("Lens received %q with %s, want the chat's session key and the request id", auth, sent)
	}
	if still {
		t.Fatal("the answer is still stored in Lens")
	}
	if code, _ := post(`{"request_id":"req-7","signal":"positive"}`); code != http.StatusBadRequest {
		t.Fatalf("a signal that removes nothing = %d, want 400", code)
	}
}
