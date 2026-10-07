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

// B32.53 — a room is opened on the session's own workspace with the body the screen sent and no other key, a fourth
// public room on a Free plan reaches the screen with Lens's rooms_plan_limits sentence, the directory asks Lens for
// the topic asked, and a join carries the terms version the person accepted.
func TestRoomsRelayToLensOnTheSessionsWorkspace(t *testing.T) {
	var mu sync.Mutex
	var got []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		mu.Lock()
		got = append(got, r.Method+" "+r.URL.RequestURI()+" "+string(raw))
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/rooms"):
			w.WriteHeader(http.StatusPaymentRequired)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"error":   "rooms_plan_limits (LENS_ROOMS_PLAN_LIMITS): your free plan allows 3 public rooms — the team plan allows 25",
				"setting": "rooms_plan_limits", "plan": "free", "limit": "public_rooms", "max": 3, "allows": "team",
			})
		case r.URL.Path == "/v1/rooms":
			_ = json.NewEncoder(w).Encode(map[string]any{"rooms": []any{}, "joined": []any{}, "invited": []any{}})
		case strings.HasSuffix(r.URL.Path, "/join"):
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{"workspace_id": "ws", "role": "member", "terms_version": 2})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)

	rec := doJSON(a, http.MethodPost, "/api/rooms", `{"title":"Fourth","topic":"research","visibility":"public","terms":{"split_rule":"equal"}}`)
	if rec.Code != http.StatusPaymentRequired || !strings.Contains(rec.Body.String(), "your free plan allows 3 public rooms") {
		t.Fatalf("open = %d %s, want Lens's 402 and its rooms_plan_limits sentence", rec.Code, rec.Body.String())
	}
	if rec = doJSON(a, http.MethodPost, "/api/rooms", `{"title":`); rec.Code != http.StatusBadRequest {
		t.Fatalf("a body that is not JSON = %d, want 400 before Lens is asked", rec.Code)
	}
	// Nothing the screen does not send reaches Lens: not an owner, not a key inside the terms.
	for _, body := range []string{`{"title":"Mine","owner_workspace_id":"ws_other"}`, `{"title":"Mine","terms":{"split_rule":"equal","status":"closed"}}`} {
		if rec = doJSON(a, http.MethodPost, "/api/rooms", body); rec.Code != http.StatusBadRequest {
			t.Fatalf("open with %s = %d, want 400 before Lens is asked", body, rec.Code)
		}
	}
	if rec = doJSON(a, http.MethodGet, "/api/rooms?topic=open+source", ""); rec.Code != http.StatusOK {
		t.Fatalf("directory = %d %s", rec.Code, rec.Body.String())
	}
	if rec = doJSON(a, http.MethodPost, "/api/rooms/room_1/join", `{"terms_version":2}`); rec.Code != http.StatusCreated {
		t.Fatalf("join = %d %s", rec.Code, rec.Body.String())
	}
	if len(got) != 3 {
		t.Fatalf("Lens received %d requests, want 3: %q", len(got), got)
	}
	open := strings.Fields(got[0])
	ws := strings.Split(strings.TrimPrefix(open[1], "/v1/workspaces/"), "/")[0]
	if ws == "" || open[1] != "/v1/workspaces/"+ws+"/rooms" || !strings.HasSuffix(got[0], `,"terms":{"split_rule":"equal"}}`) {
		t.Fatalf("Lens received %q, want the room on the session's workspace with the screen's body", got[0])
	}
	if got[1] != "GET /v1/rooms?topic=open+source " {
		t.Fatalf("Lens received %q, want the directory for the topic asked", got[1])
	}
	if got[2] != `POST /v1/rooms/room_1/join {"terms_version":2}` {
		t.Fatalf("Lens received %q, want the join with the accepted terms version", got[2])
	}
}

// B32.54 — a room's event stream reaches the browser event by event, while Lens still holds it open, with the cursor the
// browser resumes from; and a vote and a run reach Lens on the room and contribution the screen named, with its body.
func TestRoomEventsStreamAndRoomWritesRelay(t *testing.T) {
	release := make(chan struct{})
	var mu sync.Mutex
	var got []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		mu.Lock()
		got = append(got, r.Method+" "+r.URL.RequestURI()+" "+r.Header.Get("Last-Event-ID")+" "+string(raw))
		mu.Unlock()
		if strings.HasSuffix(r.URL.Path, "/events") {
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = io.WriteString(w, "id: 8\ndata: {\"cursor\":8,\"kind\":\"message.posted\"}\n\n")
			w.(http.Flusher).Flush()
			select {
			case <-release:
			case <-r.Context().Done():
			}
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}))
	t.Cleanup(srv.Close)
	t.Cleanup(func() { close(release) })
	a := newApp(config{addr: "127.0.0.1:0", lensBaseURL: srv.URL, provisionSecret: testProvisionSecret, webDist: t.TempDir(), authMode: authModeDisabled}, nil)
	bff := httptest.NewServer(a)
	t.Cleanup(bff.Close)

	req, _ := http.NewRequest(http.MethodGet, bff.URL+"/api/rooms/room_1/events", nil)
	req.Header.Set("Last-Event-ID", "7")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK || resp.Header.Get("Content-Type") != "text/event-stream" {
		t.Fatalf("events = %d %q, want 200 text/event-stream", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
	buf := make([]byte, 256)
	n, err := resp.Body.Read(buf)
	if err != nil || !strings.Contains(string(buf[:n]), `"cursor":8`) {
		t.Fatalf("first read = %q %v, want the event while Lens still holds the stream open", buf[:n], err)
	}

	if rec := doJSON(a, http.MethodPut, "/api/rooms/room_1/contributions/c_2/vote", `{"value":-1}`); rec.Code != http.StatusOK {
		t.Fatalf("vote = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodPost, "/api/rooms/room_1/runs", `{"target":"c_2","input":"go","pay":"room"}`); rec.Code != http.StatusOK {
		t.Fatalf("run = %d %s", rec.Code, rec.Body.String())
	}
	if rec := doJSON(a, http.MethodPost, "/api/rooms/room_1/runs", `{"target":"c_2","payer_workspace_id":"ws_other"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("a run naming its own payer = %d, want 400 before Lens is asked", rec.Code)
	}
	mu.Lock()
	defer mu.Unlock()
	want := []string{
		"GET /v1/rooms/room_1/events 7 ",
		`PUT /v1/rooms/room_1/contributions/c_2/vote  {"value":-1}`,
		`POST /v1/rooms/room_1/runs  {"target":"c_2","input":"go","pay":"room"}`,
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("Lens received\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}
