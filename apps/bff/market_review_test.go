package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// B20.12 — the review queue goes to Lens on the moderator key, names the operator, and is the
// operator's alone.

type seenLens struct {
	method, path, auth, operator, body string
}

func reviewApp(t *testing.T, key string, lensStatus int, lensBody string) (*app, *http.Cookie, *http.Cookie, *[]seenLens) {
	t.Helper()
	seen := &[]seenLens{}
	lens := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		*seen = append(*seen, seenLens{r.Method, r.URL.Path, r.Header.Get("Authorization"), r.Header.Get("X-Talyvor-Operator"), string(b)})
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(lensStatus)
		_, _ = io.WriteString(w, lensBody)
	}))
	t.Cleanup(lens.Close)
	a, op, user := operatorApp(t, []string{"sub-operator"})
	a.cfg.lensBaseURL = lens.URL
	a.cfg.moderatorKey = key
	return a, op, user, seen
}

func reviewCall(a *app, sess *http.Cookie, method, path, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Origin", opOrigin)
	req.AddCookie(sess)
	a.ServeHTTP(rec, req)
	return rec
}

func TestMarketReview_QueueGoesOnTheModeratorKeyNamingTheOperator(t *testing.T) {
	queue := `{"listings":[{"listing":{"id":"l1","title":"Leaky"},"open_reports":2,"report_reasons":["secret"],"report_details":["has a key"]}]}`
	a, op, _, seen := reviewApp(t, "tlv_mod_abc", http.StatusOK, queue)
	rec := reviewCall(a, op, http.MethodGet, "/api/admin/marketplace/review", "")
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != queue {
		t.Fatalf("queue: %d %s", rec.Code, rec.Body.String())
	}
	got := (*seen)[0]
	if got.path != "/v1/admin/marketplace/review" || got.auth != "Bearer tlv_mod_abc" || got.operator != "op@example.com sub=sub-operator" {
		t.Fatalf("Lens was asked %+v", got)
	}
}

func TestMarketReview_TakedownSendsTheReasonAndAnswersTheRefunds(t *testing.T) {
	answer := `{"listing":{"id":"l1","review_status":"taken_down"},"refunds":[{"use_id":"u1","buyer_workspace_id":"ws-b","price_ulxc":500000}]}`
	a, op, _, seen := reviewApp(t, "tlv_mod_abc", http.StatusOK, answer)
	rec := reviewCall(a, op, http.MethodPost, "/api/admin/marketplace/listings/l1/takedown", `{"reason":"exposes a key"}`)
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != answer {
		t.Fatalf("takedown: %d %s", rec.Code, rec.Body.String())
	}
	got := (*seen)[0]
	var body map[string]string
	_ = json.Unmarshal([]byte(got.body), &body)
	if got.method != http.MethodPost || got.path != "/v1/admin/marketplace/listings/l1/takedown" || body["reason"] != "exposes a key" {
		t.Fatalf("Lens was asked %+v", got)
	}
}

func TestMarketReview_ApproveReachesLens(t *testing.T) {
	a, op, _, seen := reviewApp(t, "tlv_mod_abc", http.StatusOK, `{"id":"l1","review_status":"approved"}`)
	if rec := reviewCall(a, op, http.MethodPost, "/api/admin/marketplace/listings/l1/approve", ""); rec.Code != http.StatusOK {
		t.Fatalf("approve: %d %s", rec.Code, rec.Body.String())
	}
	if got := (*seen)[0]; got.path != "/v1/admin/marketplace/listings/l1/approve" {
		t.Fatalf("Lens was asked %+v", got)
	}
}

func TestMarketReview_NonOperatorIsRefusedAndLensNeverAsked(t *testing.T) {
	a, _, user, seen := reviewApp(t, "tlv_mod_abc", http.StatusOK, `{}`)
	if rec := reviewCall(a, user, http.MethodPost, "/api/admin/marketplace/listings/l1/takedown", `{"reason":"x"}`); rec.Code != http.StatusForbidden {
		t.Fatalf("a signed-in non-operator got %d", rec.Code)
	}
	if len(*seen) != 0 {
		t.Fatalf("Lens was called for a non-operator: %+v", *seen)
	}
}

func TestMarketReview_UnsetKeyAnswers501(t *testing.T) {
	a, op, _, seen := reviewApp(t, "", http.StatusOK, `{}`)
	rec := reviewCall(a, op, http.MethodGet, "/api/admin/marketplace/review", "")
	if rec.Code != http.StatusNotImplemented || !strings.Contains(rec.Body.String(), "LENS_MODERATOR_KEY") || len(*seen) != 0 {
		t.Fatalf("unset key: %d %s (lens calls %d)", rec.Code, rec.Body.String(), len(*seen))
	}
}

// A revoked key is Lens's 401 — relayed as a 401 the browser would read as "sign in again".
func TestMarketReview_RefusedKeyIsNotASessionExpiry(t *testing.T) {
	a, op, _, _ := reviewApp(t, "tlv_mod_revoked", http.StatusUnauthorized, `{"error":"admin credentials required"}`)
	rec := reviewCall(a, op, http.MethodGet, "/api/admin/marketplace/review", "")
	if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "LENS_MODERATOR_KEY") {
		t.Fatalf("revoked key: %d %s", rec.Code, rec.Body.String())
	}
}
