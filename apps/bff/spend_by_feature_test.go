package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// /api/spend/by-feature — the route that makes the feature tag six screens PRINT into something
// a reader can look up.
//
// ── WHY THIS ROUTE EXISTS, MEASURED RATHER THAN ASSUMED ─────────────────────
//
// W1.7's third bullet is "SHOW WHAT IT COST", and this app satisfies it today by NAMING a tag:
// five Docs cards and one Track card each end with a sentence of the form "a metered Lens call
// billed to this workspace under `docs-ai-summarize`". A tag is a JOIN KEY — it is only worth
// printing if the reader can join on it. MEASURED at talyvor-lens
// `469a255751c8a124fb132d875ecd0ca32664f88e` (read-only; that repo was held by another tab and
// was never written to) and in this repository at `fe114149`:
//
//	talyvor-lens internal/api/server.go#Server.MountAuthenticated  GET /v1/api/spend/by-feature → handleSpendBy("feature")
//	talyvor-lens migrations/0001_init.sql            token_events.feature TEXT
//	apps/bff/lens.go                          mounted NOTHING onto it
//	apps/web/src/areas/lens/                  ZERO occurrences of the word `feature`
//
// So Lens records the dimension, Lens serves the aggregate, and the product had no way to show
// it — the tag was printed as evidence for a claim the reader could not check anywhere in the
// product that made it.
//
// ── THE UPSTREAM SHAPE, TRANSCRIBED FROM SOURCE AT THAT SHA ─────────────────
//
// handleSpendBy("feature") is `SELECT feature, SUM(cost_usd), COUNT(*), SUM(input_tokens),
// SUM(output_tokens) FROM token_events WHERE workspace_id = $1 AND created_at > NOW() -
// INTERVAL '1 day' * $2 GROUP BY feature ORDER BY cost_usd DESC`, emitted as
// `[{"feature":…,"cost_usd":…,"requests":…,"input_tokens":…,"output_tokens":…}]`.
//
// ⚠⚠ ITS ZERO-ROW ANSWER IS `null`, NOT `[]`, AND THAT IS NOT A GUESS. The handler accumulates
// into `var out []map[string]any` and hands it to `json.NewEncoder(w).Encode(body)` — a nil
// slice encodes as the literal `null`. A workspace that has spent nothing in the window
// therefore gets `200 null`. This BFF must not launder that into `[]`: the reader on the other
// side has to be able to tell Lens's documented no-rows answer from a shape it does not
// recognise, and it can only do that if the byte it receives is the byte Lens sent.
//
// ── WHY proxyWindowed, AND WHY THE TENANCY IS THE SAME ARGUMENT AS /api/usage ──
//
// The upstream path carries NO workspace segment. `/v1/api/spend/by-feature` scopes itself from
// the AUTHENTICATED KEY (`effectiveWorkspaceID`, internal/api/server.go#Server.effectiveWorkspaceID) exactly as
// `/v1/api/usage` does, and the key is what this BFF attaches server-side from the SESSION. The
// pinning is done by the credential rather than by a config-built path.
//
// ⚠ AND `?workspace_id=` IS THE SAME LIVE HAZARD IT IS ON /api/usage, for the same reason:
// `effectiveWorkspaceID` returns `queryDefault(r, "workspace_id", "default")` when the caller's
// identity is an ADMIN one. This deployment holds a workspace key, so the parameter is inert
// today — dropping it is what keeps the route un-aimable if that ever changes. proxyWindowed
// forwards `days` and nothing else, which is why this route uses it rather than a plain proxy.

func TestSpendByFeatureForwardsToLens(t *testing.T) {
	var gotAuth string
	a := newTestApp(t, &gotAuth)

	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/spend/by-feature", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	// newTestApp's fake Lens echoes {"path":…,"query":…}.
	if !strings.Contains(rec.Body.String(), `"path":"/v1/api/spend/by-feature"`) {
		t.Errorf("upstream path = %s, want /v1/api/spend/by-feature", rec.Body.String())
	}
	if !strings.HasPrefix(gotAuth, "Bearer ") || gotAuth == "Bearer " {
		t.Errorf("upstream Authorization = %q, want the session's workspace-scoped bearer token", gotAuth)
	}
}

// The window is the only parameter that travels, and it is clamped to the same bounds
// /api/usage uses — Lens's own default (30) mirrored here so the BFF states the upstream's
// truth rather than a second opinion, and this app's 365 ceiling.
func TestSpendByFeatureDaysSanitised(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{"", "days=30"},
		{"?days=7", "days=7"},
		{"?days=0", "days=1"},
		{"?days=9999", "days=365"},
		{"?days=abc", "days=30"},
		{"?days=-5", "days=1"},
	} {
		a := newTestApp(t, nil)
		rec := httptest.NewRecorder()
		a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/spend/by-feature"+tc.in, nil))
		if !strings.Contains(rec.Body.String(), tc.want) {
			t.Errorf("days %q → query %s, want %s", tc.in, rec.Body.String(), tc.want)
		}
	}
}

// ?workspace_id= is how an ADMIN key targets another workspace upstream (effectiveWorkspaceID's
// admin branch). Dropping it is the load-bearing half: the route cannot be aimed at another
// tenant even if this deployment's key were ever upgraded to an admin one.
func TestSpendByFeatureDropsUnknownParams(t *testing.T) {
	a := newTestApp(t, nil)
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet,
		"/api/spend/by-feature?days=7&workspace_id=someone-else&feature=docs-ai-summarize", nil))

	body := rec.Body.String()
	if strings.Contains(body, "workspace_id") || strings.Contains(body, "docs-ai-summarize") {
		t.Errorf("unknown parameters reached Lens: %s", body)
	}
	if !strings.Contains(body, "days=7") {
		t.Errorf("days was dropped along with them: %s", body)
	}
}

// A read, and only a read. Spend is never written through this app.
//
// ⚠⚠ THE MOUNT IS ASSERTED IN THIS SAME TEST, AND THAT IS NOT TIDINESS — WITHOUT IT THIS TEST
// CANNOT FAIL. Measured, and it is why the route's first run was suspected rather than believed:
// with `/api/spend/by-feature` NOT MOUNTED AT ALL, the 405 half passed on its first run, green,
// while the three tests above went red. `handleAPINotFound` (lens.go) answers **405 to any
// non-GET on any unmounted `/api/*` path** before it ever reaches the 404 — so "this route
// refuses writes" and "this route does not exist" are the same response, and a test that reads
// only the status code cannot tell them apart. Asserting the GET first makes the 405s evidence
// about a route rather than about the fallback.
//
// ⚠ THE SHAPE WAS NOT UNIQUE TO THIS ROUTE, AND THE HAND-OFF THIS COMMENT USED TO CARRY NAMED
// ONLY ONE OF THREE. Every mounted `/api/*` route was unmounted one at a time and the full package
// run against each: THREE method-gate tests passed with their own route deleted — usage_test.go's
// TestUsageIsReadOnly (the one named here), docs_search_test.go's TestDocsSearch_RefusesNonGET and
// track_ai_test.go's TestTrackIssueSummary_OnlyGET. All three now assert their mount first, and
// each was re-measured as CAUGHT afterwards with this test carried as the positive control. The
// POST-only routes were never blind and the census says why: an unmounted GET is a 404, not a 405,
// so their `GET → 405` arm catches the deletion on its own.
func TestSpendByFeatureIsReadOnlyAndMounted(t *testing.T) {
	a := newTestApp(t, nil)

	// The route EXISTS: a GET reaches Lens. Without this the loop below is a test of
	// handleAPINotFound.
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/spend/by-feature", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"path":"/v1/api/spend/by-feature"`) {
		t.Fatalf("GET = %d %s, want 200 forwarded to /v1/api/spend/by-feature — the 405s below "+
			"prove nothing about an unmounted route", rec.Code, rec.Body.String())
	}

	for _, m := range []string{http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodPatch} {
		rec := httptest.NewRecorder()
		a.ServeHTTP(rec, httptest.NewRequest(m, "/api/spend/by-feature", nil))
		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s /api/spend/by-feature = %d, want 405", m, rec.Code)
		}
	}
}

// Lens's zero-row answer is the literal `null` — see this file's header for where that comes
// from in its source. It reaches the browser as `null`, not as `[]`: the BFF streams the
// upstream body and must not improve it, because `null` is the only thing that distinguishes
// "this workspace has spent nothing in the window" from a payload this app cannot read.
func TestSpendByFeatureForwardsLensNullVerbatim(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == provisionPath {
			serveFakeProvision(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		// Byte-for-byte what `json.NewEncoder(w).Encode(out)` writes for a nil slice.
		_, _ = io.WriteString(w, "null\n")
	}))
	t.Cleanup(upstream.Close)
	a := newApp(config{
		addr:            "127.0.0.1:0",
		lensBaseURL:     upstream.URL,
		provisionSecret: testProvisionSecret,
		webDist:         t.TempDir(),
		authMode:        authModeDisabled,
	}, nil)

	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/spend/by-feature", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got := strings.TrimSpace(rec.Body.String()); got != "null" {
		t.Errorf("body = %q, want the upstream's own %q — an empty array here would erase "+
			"Lens's no-rows answer", got, "null")
	}
}
