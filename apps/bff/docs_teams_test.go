package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// B28.450 — the team routes address the SESSION's Docs workspace whatever the browser sends, a team add syncs the
// roster first so someone just added on Members can go on, and a page grant reaches Docs with the caller's identity.
func TestDocsTeams_SessionWorkspaceAndASyncBeforeAnAdd(t *testing.T) {
	var mu sync.Mutex
	var got []string
	docs := &captureUpstream{}
	docs.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		b, _ := io.ReadAll(r.Body)
		mu.Lock()
		got = append(got, r.Method+" "+r.URL.Path+" "+string(b)+" email="+r.Header.Get("X-User-Email"))
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{}`)
	}))
	t.Cleanup(docs.srv.Close)
	a, sess := productApp(t, nil, docs)

	for _, c := range []struct{ method, path, body string }{
		{http.MethodPost, "/api/docs/teams", `{"name":"Design","workspace_id":"someone-else"}`},
		{http.MethodPut, "/api/docs/teams/t1/members/m1", ``},
		{http.MethodDelete, "/api/docs/teams/t1/members/m1", ``},
		{http.MethodPost, "/api/docs/spaces/s1/pages/p1/permissions", `{"subject_type":"team","subject_id":"t1","access":"edit"}`},
	} {
		if rec := cycleReq(t, a, sess, c.method, c.path, c.body); rec.Code != http.StatusOK {
			t.Fatalf("%s %s = %d %s; want Docs' 200 relayed", c.method, c.path, rec.Code, rec.Body.String())
		}
	}
	mu.Lock()
	defer mu.Unlock()
	want := []string{
		`POST /v1/workspaces/track-ws-7/teams {"name":"Design","workspace_id":"someone-else"}`,
		`POST /v1/service/workspaces/track-ws-7/member-sync `,
		`PUT /v1/workspaces/track-ws-7/teams/t1/members/m1 `,
		`DELETE /v1/workspaces/track-ws-7/teams/t1/members/m1 `,
		`POST /v1/spaces/s1/pages/p1/permissions {"subject_type":"team","subject_id":"t1","access":"edit"}`,
	}
	if len(got) != len(want) {
		t.Fatalf("Docs was asked:\n  %s\nwant:\n  %s", strings.Join(got, "\n  "), strings.Join(want, "\n  "))
	}
	for i, w := range want {
		if !strings.HasPrefix(got[i], w) {
			t.Errorf("call %d to Docs = %q; want %q…", i, got[i], w)
		}
		if i != 1 && strings.HasSuffix(got[i], "email=") {
			t.Errorf("call %d to Docs carried no identity, so Docs could not tell who is asking: %q", i, got[i])
		}
	}
}
