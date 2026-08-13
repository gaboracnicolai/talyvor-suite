package main

import (
	"net/http"
	"net/url"
)

// trackIssueSummary — GET /api/track/issues/{id}/summary → GET
// /v1/workspaces/{ws}/issues/{id}/summary on the Track upstream.
//
// ⚠ THIS IS THE FIRST BROWSER CONTROL FOR ANY OF TRACK'S AI FEATURES. Track ships five (triage,
// find-duplicates, thread summary, sprint suggestion, semantic search) and until now every one was
// reachable only by curl: no route here named `/summary` or `/ai/`, and nothing under
// apps/web/src called them. W1.7 recorded that twice, measured, from two independent sessions.
//
// ⚠ WHY THE SUMMARY AND NOT ONE OF THE OTHER FOUR. It is the only one that is a GET with no body
// and no write: triage optionally overwrites priority and labels (`?apply=true`), find-duplicates
// and sprint-planning are POSTs, and semantic search is a workspace-wide read that belongs to the
// list screen, not the ticket. A read is also the only one of the five that can be introduced
// without deciding what the button is allowed to change.
//
// ⚠ THE WORKSPACE IS THE SESSION'S, and there is no parameter for one — trackWorkspacePath is the
// only place a Track workspace-scoped path is assembled, for exactly that reason.
//
// ⚠ THE BODY TRAVELS VERBATIM AND THAT IS LOAD-BEARING, NOT LAZINESS. Track answers this route
// with THREE different JSON shapes and discriminates by FIELD, not by status — all three are 200:
//
//	{"summary":…,"key_points":[…],"next_action":…,"sentiment":…}   the summary
//	{"ai_available":false,"reason":…}                              AI is not configured
//	{"summary_available":false,"min_comments":10}                  the thread is too short
//
// Re-encoding here, or mapping either refusal onto an error status, would destroy the only
// information the screen has to tell those two refusals apart.
//
// ⚠⚠ AND THE TWO REFUSALS ARE NOT ORDERED THE WAY A READER EXPECTS — MEASURED, NOT READ. tab-9e42
// ran talyvor-track's own engine at `eb0b39b` in a scratch copy: `SummarizeThread` checks the
// COMMENT COUNT FIRST and returns (nil, nil) for a short thread, so the availability check below
// it is never reached. With AI unconfigured, 0, 1 and 9 comments all answer
// `{"min_comments":10,"summary_available":false}` and only 10 answers `{"ai_available":false,…}`.
// So on a deployment where AI has never run — which is this one; TRACK_LENS_MINT_KEY is unset —
// the short-thread answer is what almost every issue returns, and it says nothing about whether a
// summary could ever be produced. A screen that renders it as "add ten comments and you'll get a
// summary" is making a promise this response cannot support. IssueDetail does not.
//
// ⚠ COST. A summary that actually runs is a metered Lens call, and it lands on THIS issue:
// `SummarizeThread` passes `issue.Identifier` as the feature id, and Track's spend syncer resolves
// a row with no issue header by `identifier = lens_feature` (internal/issue/store.go
// RecordRequestSpendAttributed), adding cost and tokens to `issues.ai_cost_usd` / `ai_tokens` —
// the number the Details card above already renders. Track caches a summary for an hour, so a
// re-read is free; the first one is not, which is why this is a button and not a page load.
func (a *app) trackIssueSummary() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		id, ok := pathID(w, "id", r.PathValue("id"))
		if !ok {
			return
		}
		ws, ok := a.trackWorkspaceFor(w, r)
		if !ok {
			return
		}
		// No query forwards: Track's Summary handler reads none, so anything the browser appended
		// would be sent upstream to be ignored — and would make this path look parameterised.
		a.forwardProduct(w, r, "track", a.cfg.trackBaseURL, a.cfg.trackGatewaySecret,
			trackWorkspacePath(ws, "/issues/"+url.PathEscape(id)+"/summary"), "",
			http.MethodGet, nil, nil)
	})
}
