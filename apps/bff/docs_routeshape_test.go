package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The Docs route shapes, checked against a router that REGISTERS WHAT DOCS REGISTERS.
//
// ⚠ WHY THIS FILE EXISTS. Every other Docs test here records the path the BFF sent and
// compares it to a string. That catches a typo and cannot catch a path that is well-formed
// and unregistered upstream — the upstream double answers 200 to ANYTHING, so a request to a
// route Docs does not have looks identical to one it does. Three assertions in
// products_test.go were consequently updated to match the broken code while their own failure
// messages still named the correct path:
//
//	if docs.path != "/v1/workspaces/track-ws-7/spaces/sp-1" {
//	    t.Fatalf("upstream path = %q, want /v1/spaces/sp-1", docs.path)   // ← the truth, unasserted
//	}
//
// In production those routes returned Go's default `404 page not found`, which the web app
// then reported as "Docs is not configured on this deployment". Docs was running and had just
// served the space list.
//
// So this upstream is a chi router carrying DOCS' REAL PATTERNS, transcribed from
// talyvor-docs internal/space/handler.go and internal/page/handler.go. Anything the BFF sends
// that Docs does not register 404s here exactly as it does on the box.
//
// ⚠ THE PREFIXES ARE NOT UNIFORM, WHICH IS THE WHOLE TRAP:
//
//	POST   /v1/spaces                                  create   (workspace in the BODY)
//	GET    /v1/workspaces/{wsID}/spaces                list     ← the ONLY workspace-scoped one
//	GET    /v1/spaces/{spaceID}                        detail
//	GET    /v1/spaces/{spaceID}/pages                  page list
//	POST   /v1/spaces/{spaceID}/pages                  page create
//	GET    /v1/spaces/{spaceID}/pages/{pageID}         page detail
//	PATCH  /v1/spaces/{spaceID}/pages/{pageID}         page update
//
// Reading the rule off the list route and applying it everywhere is what happened, and it is
// what this file makes impossible to do quietly.

// docsRouter is a minimal stand-in for Docs that is FAITHFUL ABOUT WHICH PATHS EXIST. It
// deliberately uses net/http's own pattern mux rather than importing chi: the property under
// test is "is this path registered", and an unregistered path must 404 the way a real router
// 404s, which both do.
type docsRouter struct {
	srv  *httptest.Server
	mu   chan struct{} // 1-buffered, used as a mutex without importing sync
	seen []string
	// pages is the tiny bit of state the sequence test needs: id → title/text, so an edit
	// followed by a read proves the write actually landed rather than that a 200 came back.
	pages map[string]map[string]any
}

func newDocsRouter(t *testing.T) *docsRouter {
	t.Helper()
	d := &docsRouter{mu: make(chan struct{}, 1), pages: map[string]map[string]any{}}
	mux := http.NewServeMux()

	record := func(h http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			d.mu <- struct{}{}
			d.seen = append(d.seen, r.Method+" "+r.URL.Path)
			<-d.mu
			w.Header().Set("Content-Type", "application/json")
			h(w, r)
		}
	}

	// ── exactly Docs' route table, and nothing else ──────────────────────────
	mux.HandleFunc("POST /v1/spaces", record(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		_, _ = io.WriteString(w, `{"id":"sp-1","name":"Handbook"}`)
	}))
	mux.HandleFunc("GET /v1/workspaces/{wsID}/spaces", record(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `[{"id":"sp-1","name":"Handbook"}]`)
	}))
	mux.HandleFunc("GET /v1/spaces/{spaceID}", record(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"id":"`+r.PathValue("spaceID")+`","name":"Handbook"}`)
	}))
	mux.HandleFunc("GET /v1/spaces/{spaceID}/pages", record(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `[{"id":"pg-1","title":"Runbook","content":{"x":1},"content_text":"hello"}]`)
	}))
	mux.HandleFunc("POST /v1/spaces/{spaceID}/pages", record(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var in map[string]any
		_ = json.Unmarshal(body, &in)
		d.mu <- struct{}{}
		d.pages["pg-1"] = map[string]any{"id": "pg-1", "title": in["title"], "content_text": ""}
		<-d.mu
		out, _ := json.Marshal(d.pages["pg-1"])
		_, _ = w.Write(out)
	}))
	mux.HandleFunc("GET /v1/spaces/{spaceID}/pages/{pageID}", record(func(w http.ResponseWriter, r *http.Request) {
		d.mu <- struct{}{}
		p, ok := d.pages[r.PathValue("pageID")]
		<-d.mu
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			_, _ = io.WriteString(w, `{"error":"page not found"}`)
			return
		}
		out, _ := json.Marshal(p)
		_, _ = w.Write(out)
	}))
	mux.HandleFunc("PATCH /v1/spaces/{spaceID}/pages/{pageID}", record(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var in map[string]any
		_ = json.Unmarshal(body, &in)
		d.mu <- struct{}{}
		p := d.pages[r.PathValue("pageID")]
		if p == nil {
			p = map[string]any{"id": r.PathValue("pageID")}
		}
		for k, v := range in {
			p[k] = v
		}
		d.pages[r.PathValue("pageID")] = p
		out, _ := json.Marshal(p)
		<-d.mu
		_, _ = w.Write(out)
	}))
	// The BFF's own provisioning probe shares this server in productApp.
	mux.HandleFunc(provisionPath, func(w http.ResponseWriter, r *http.Request) { serveFakeProvision(w, r) })
	// Track's bootstrap, because Docs' workspace comes from the session Track mints.
	mux.HandleFunc(trackBootstrapPath, record(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"workspace_id":"track-ws-7"}`)
	}))

	d.srv = httptest.NewServer(mux)
	t.Cleanup(d.srv.Close)
	return d
}

func (d *docsRouter) requests() []string {
	d.mu <- struct{}{}
	defer func() { <-d.mu }()
	return append([]string(nil), d.seen...)
}

func docsApp(t *testing.T, d *docsRouter) (*app, *http.Cookie) {
	t.Helper()
	// Reuses the existing productApp harness — it reads only .srv.URL off these — pointing BOTH
	// products at the faithful router, because Docs' workspace is the session's, which Track
	// mints. Everything else (session seeding, the track-ws-7 workspace) is that harness's.
	return productApp(t, &captureUpstream{srv: d.srv}, &captureUpstream{srv: d.srv})
}

// TestDocs_TheWholeSequenceAgainstARealRouteTable is the failure a person reported, in order:
// create a space, open it, create a page, edit it, read it back.
//
// Each step goes through the BFF's real handler to an upstream that only answers on paths Docs
// actually registers. A step that targets an unregistered path 404s here, which is what
// production did.
func TestDocs_TheWholeSequenceAgainstARealRouteTable(t *testing.T) {
	d := newDocsRouter(t)
	a, sess := docsApp(t, d)

	do := func(method, path, body string) *httptest.ResponseRecorder {
		t.Helper()
		var rdr io.Reader
		if body != "" {
			rdr = strings.NewReader(body)
		}
		req := httptest.NewRequest(method, path, rdr)
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		req.AddCookie(sess)
		rec := httptest.NewRecorder()
		a.ServeHTTP(rec, req)
		return rec
	}

	step := func(name, method, path, body string) *httptest.ResponseRecorder {
		t.Helper()
		rec := do(method, path, body)
		if rec.Code == http.StatusNotFound {
			t.Fatalf("%s: %s %s → 404 from the upstream route table. The BFF is addressing a path "+
				"Docs does not register — this is the bug that reads on screen as "+
				"\"Docs is not configured\". Body: %s", name, method, path, strings.TrimSpace(rec.Body.String()))
		}
		if rec.Code < 200 || rec.Code > 299 {
			t.Fatalf("%s: %s %s → %d: %s", name, method, path, rec.Code, strings.TrimSpace(rec.Body.String()))
		}
		return rec
	}

	step("create a space", http.MethodPost, "/api/docs/spaces", `{"name":"Handbook","slug":"handbook"}`)
	step("list spaces", http.MethodGet, "/api/docs/spaces", "")
	step("open the space", http.MethodGet, "/api/docs/spaces/sp-1", "")
	step("list its pages", http.MethodGet, "/api/docs/spaces/sp-1/pages", "")
	step("create a page", http.MethodPost, "/api/docs/spaces/sp-1/pages", `{"title":"Runbook"}`)
	step("edit the page", http.MethodPatch, "/api/docs/spaces/sp-1/pages/pg-1",
		`{"content_text":"the text that must survive a reload"}`)

	// THE RELOAD. A 200 on the edit proves a request was accepted; only reading it back proves
	// the write landed where a later read looks for it.
	rec := step("reload the page", http.MethodGet, "/api/docs/spaces/sp-1/pages/pg-1", "")
	var page map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil {
		t.Fatalf("reload body is not JSON: %v (%s)", err, rec.Body.String())
	}
	if got, _ := page["content_text"].(string); got != "the text that must survive a reload" {
		t.Errorf("after reload content_text = %q, want the edited text — the edit and the read "+
			"did not address the same page", got)
	}
}

// TestDocs_UpstreamPathsMatchDocsRouteTable states the contract as a table, so a mismatch names
// itself instead of surfacing as a 404 three layers up.
func TestDocs_UpstreamPathsMatchDocsRouteTable(t *testing.T) {
	for _, tc := range []struct{ name, method, in, body, want string }{
		{"space create", http.MethodPost, "/api/docs/spaces", `{"name":"H","slug":"h"}`, "POST /v1/spaces"},
		{"space list", http.MethodGet, "/api/docs/spaces", "", "GET /v1/workspaces/track-ws-7/spaces"},
		{"space detail", http.MethodGet, "/api/docs/spaces/sp-1", "", "GET /v1/spaces/sp-1"},
		{"page list", http.MethodGet, "/api/docs/spaces/sp-1/pages", "", "GET /v1/spaces/sp-1/pages"},
		{"page create", http.MethodPost, "/api/docs/spaces/sp-1/pages", `{"title":"R"}`, "POST /v1/spaces/sp-1/pages"},
		{"page detail", http.MethodGet, "/api/docs/spaces/sp-1/pages/pg-1", "", "GET /v1/spaces/sp-1/pages/pg-1"},
		{"page update", http.MethodPatch, "/api/docs/spaces/sp-1/pages/pg-1", `{"title":"R2"}`, "PATCH /v1/spaces/sp-1/pages/pg-1"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			d := newDocsRouter(t)
			a, sess := docsApp(t, d)
			var rdr io.Reader
			if tc.body != "" {
				rdr = strings.NewReader(tc.body)
			}
			req := httptest.NewRequest(tc.method, tc.in, rdr)
			if tc.body != "" {
				req.Header.Set("Content-Type", "application/json")
			}
			req.AddCookie(sess)
			a.ServeHTTP(httptest.NewRecorder(), req)

			var got []string
			for _, r := range d.requests() {
				if !strings.Contains(r, "/bootstrap") && !strings.Contains(r, "provision") {
					got = append(got, r)
				}
			}
			if len(got) != 1 || got[0] != tc.want {
				t.Errorf("upstream saw %v, want [%s]", got, tc.want)
			}
		})
	}
}
