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

// B18.25 — the operator screen reads every workspace from Lens on the operator read key and joins
// the roster with B18.17's spend, held and last-activity reads. Who may call it is
// operator_boundary_test.go's job; this is what the operator gets.

func operatorWorkspacesApp(t *testing.T, key string, lensStatus int) (*app, *http.Cookie, *[]string) {
	t.Helper()
	var mu sync.Mutex
	auths := &[]string{}
	bodies := map[string]string{
		"/v1/admin/workspaces":               `[{"id":"ws-a","name":"Acme","created_at":"2026-08-01T00:00:00Z"},{"id":"ws-b","name":"Beta"},{"id":"ws-c","name":"Quiet"}]`,
		"/v1/admin/workspaces/spend":         `{"workspaces":[{"workspace_id":"ws-a","current_month_usd":1.25,"all_time_usd":9.5,"requests":40},{"workspace_id":"ws-b","current_month_usd":0,"all_time_usd":0.02,"requests":1},{"workspace_id":"ws-c","current_month_usd":0,"all_time_usd":0,"requests":0}]}`,
		"/v1/admin/workspaces/held":          `{"workspaces":[{"workspace_id":"ws-a","held_ulens":0},{"workspace_id":"ws-b","held_ulens":822},{"workspace_id":"ws-c","held_ulens":0}]}`,
		"/v1/admin/workspaces/last-activity": `{"workspaces":[{"workspace_id":"ws-a","last_request_at":"2026-09-20T10:00:00Z"},{"workspace_id":"ws-b","last_request_at":"2026-09-28T09:30:00Z"},{"workspace_id":"ws-c","last_request_at":null}]}`,
	}
	lens := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		*auths = append(*auths, r.Method+" "+r.URL.Path+" "+r.Header.Get("Authorization"))
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(lensStatus)
		_, _ = io.WriteString(w, bodies[r.URL.Path])
	}))
	t.Cleanup(lens.Close)
	a, op, _ := operatorApp(t, []string{"sub-operator"})
	a.cfg.lensBaseURL = lens.URL
	a.cfg.operatorReadKey = key
	return a, op, auths
}

func TestOperatorWorkspaces_JoinsEveryWorkspaceOnTheOperatorReadKey(t *testing.T) {
	a, op, auths := operatorWorkspacesApp(t, "op-read-key", http.StatusOK)
	rec := getAdmin(t, a, op)
	if rec.Code != http.StatusOK {
		t.Fatalf("operator read: %d %s", rec.Code, rec.Body.String())
	}
	for _, seen := range *auths {
		if !strings.HasPrefix(seen, "GET ") || !strings.HasSuffix(seen, " Bearer op-read-key") {
			t.Errorf("Lens was asked %q — every read must be a GET on the operator read key", seen)
		}
	}
	if len(*auths) != 4 {
		t.Fatalf("Lens was asked %d times, want the roster and the three per-workspace reads: %v", len(*auths), *auths)
	}
	var got struct {
		Workspaces []operatorWorkspace `json:"workspaces"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	ids := []string{}
	for _, ws := range got.Workspaces {
		ids = append(ids, ws.ID)
	}
	// most recently active first; the workspace that never made a request last
	if strings.Join(ids, ",") != "ws-b,ws-a,ws-c" {
		t.Fatalf("order = %v, want ws-b,ws-a,ws-c", ids)
	}
	b, acme, quiet := got.Workspaces[0], got.Workspaces[1], got.Workspaces[2]
	if b.Name != "Beta" || b.HeldULENS != 822 || b.Requests != 1 || b.AllTimeUSD != 0.02 {
		t.Errorf("ws-b = %+v", b)
	}
	if acme.Name != "Acme" || acme.CurrentMonthUSD != 1.25 || acme.AllTimeUSD != 9.5 || acme.Requests != 40 ||
		acme.LastRequestAt == nil || acme.LastRequestAt.Format("2006-01-02T15:04") != "2026-09-20T10:00" {
		t.Errorf("ws-a = %+v", acme)
	}
	if quiet.LastRequestAt != nil || quiet.Requests != 0 {
		t.Errorf("ws-c never made a request, got %+v", quiet)
	}
}

func TestOperatorWorkspaces_UnsetKeySaysWhichVariableToSet(t *testing.T) {
	a, op, auths := operatorWorkspacesApp(t, "", http.StatusOK)
	rec := getAdmin(t, a, op)
	if rec.Code != http.StatusNotImplemented || !strings.Contains(rec.Body.String(), "LENS_OPERATOR_READ_KEY") {
		t.Fatalf("unset key: %d %s", rec.Code, rec.Body.String())
	}
	if len(*auths) != 0 {
		t.Fatalf("Lens was asked %v with no key", *auths)
	}
}

func TestOperatorWorkspaces_LensRefusingTheKeyIsNotASignOut(t *testing.T) {
	a, op, _ := operatorWorkspacesApp(t, "wrong-key", http.StatusUnauthorized)
	rec := getAdmin(t, a, op)
	if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "LENS_OPERATOR_READ_KEY") {
		t.Fatalf("refused key: %d %s — Lens's 401 is about the web app's key, not the operator's session", rec.Code, rec.Body.String())
	}
}
