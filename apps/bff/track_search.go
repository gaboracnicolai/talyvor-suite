package main

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// trackSearchLimit is talyvor-track's OWN default page size for this route — `limit = 25` in
// internal/ai/engine.go SemanticSearch, restated here because this route sends the limit on the
// wire on every request rather than leaving it to that default. That is the whole reason the
// constant exists: an unsent limit would make the bound this route enforces depend on a number in
// another repository, and the day that number moved this route would be bounding one window while
// Track served another. It is also the CEILING offered here — the card downstream draws one page.
const trackSearchLimit = 25

// trackSearchAllowed names every accepted key, for the 400 message.
const trackSearchAllowed = "q, limit"

// trackIssueSearch — GET /api/track/issues/search → GET
// /v1/workspaces/{ws}/issues/semantic-search on the Track upstream.
//
// ⚠ THE LOCAL NAME IS `search` AND THE UPSTREAM NAME IS `semantic-search`, DELIBERATELY. W1.7
// records semantic search as one of Track's five AI features reachable only by curl, and this is
// its first browser address — so the route Track's AI package mounts is the one dialled. What the
// caller is promised, though, is a search: see the next warning for why this app may not use the
// word "semantic" in front of a user.
//
// ⚠⚠ THE RESPONSE IS A BARE ARRAY AND CANNOT SAY WHICH HALF SERVED IT. MEASURED, not read: at
// track `b6fec98`, `ai.Handler.SemanticSearch` driven in a /tmp `git archive` export over a
// recording full-text backend with the engine unconfigured (no mint credential — this deployment):
//
//	AI off,  backend matches       → 200 [ …issue… ]   backend called once
//	AI off,  backend matches none  → 200 []            backend called once
//	AI off,  NO backend wired      → 200 []            nothing called
//	AI on,   vector path fails     → 200 [ …issue… ]   backend called once  ← byte-identical to row 1
//
// `SemanticSearch` falls back to `e.issueSearch.Search` whenever Lens is unavailable, the pool is
// nil, the embedding call fails, the vector query fails, or the JOIN returns nothing — and its own
// docstring states the design: "The fallback path is invisible to callers — they always get a
// useful result." There is no envelope and no per-row source tag, so no field anywhere records
// which of those happened. This is the Docs search finding (docs_search.go) with the evidence
// removed: there, a row tagged `semantic` or `both` at least PROVES the half ran. Here nothing can.
//
// ⚠ AND `200 []` IS FOUR FACTS AT ONCE, one of which is a dead deployment: `fullTextFallback`
// returns `nil, nil` when no search backend is wired, and `issue.Store.Search` returns `nil, nil`
// when its pool is nil. Both arrive as an empty array — a search that is not plumbed in at all
// reports "nothing matched" forever, with a 200. Nothing this route can do fixes that; what it can
// do is not add a fifth indistinguishable way to get an empty list, which is why a blank query is
// refused here instead of being sent to match nothing.
//
// ⚠ WHAT IT COSTS. On a deployment where Lens is wired, the semantic half embeds the QUERY through
// Lens on every call under the feature tag `track-search`, so a search is a metered call billed to
// this workspace and attributed to no issue — the embedding is of the query, and there is no issue
// to charge. That is why this is a submitted form and not a keystroke-driven one. On THIS
// deployment `IsAvailable()` is false (TRACK_LENS_MINT_KEY is unset), so every search takes the
// full-text path and costs nothing.
//
// ⚠ THE WORKSPACE IS THE SESSION'S, and there is no parameter for one — trackWorkspacePath is the
// only place a Track workspace-scoped path is assembled, for exactly that reason.
func (a *app) trackIssueSearch() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		in := r.URL.Query()
		reject := func(msg string) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
		}
		// A parameter the upstream ignores is worse than one it rejects — docsPageList's rule.
		// Track's SemanticSearch reads exactly `q` and `limit`; anything else would travel to be
		// dropped and come back looking honoured. `type` is the one most likely to be tried, and
		// it is the Docs route's parameter, not this one's: Track has no type toggle at all.
		for key, vals := range in {
			if key != "q" && key != "limit" {
				reject("unknown query parameter " + strconv.Quote(key) +
					" — this route forwards exactly: " + trackSearchAllowed)
				return
			}
			if len(vals) > 1 {
				reject("query parameter " + strconv.Quote(key) +
					" given more than once — the upstream would silently use only the first")
				return
			}
		}
		// ⚠ TRIMMED BEFORE IT IS JUDGED, AND THE TRIMMED STRING IS WHAT TRAVELS. Upstream refuses
		// only the EMPTY string; `q="   "` reaches its full-text backend as the literal query
		// "   " and answers 200 — measured. If this route judged the trimmed value and forwarded
		// the raw one, the string it refused on and the string Track searched for would be two
		// different strings.
		q := strings.TrimSpace(in.Get("q"))
		if q == "" {
			reject("a search needs something to search for — Track accepts a whitespace-only query " +
				"and runs it, which spends a full-text scan to match nothing")
			return
		}
		if !trackQueryValue(q) {
			reject("invalid value for q")
			return
		}
		limit := clampInt(in.Get("limit"), trackSearchLimit, 1, trackSearchLimit)

		ws, ok := a.trackWorkspaceFor(w, r)
		if !ok {
			return
		}
		out := url.Values{}
		out.Set("q", q)
		out.Set("limit", strconv.Itoa(limit))
		a.forwardProduct(w, r, "track", a.cfg.trackBaseURL, a.cfg.trackGatewaySecret,
			trackWorkspacePath(ws, "/issues/semantic-search"), out.Encode(),
			http.MethodGet, nil, nil)
	})
}
