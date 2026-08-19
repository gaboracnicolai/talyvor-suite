package main

import (
	"net/http"
	"net/url"
)

// trackFindDuplicates — POST /api/track/issues/{id}/find-duplicates → POST
// /v1/workspaces/{ws}/issues/{id}/find-duplicates on the Track upstream.
//
// ⚠ THE THIRD BROWSER CONTROL FOR A TRACK AI FEATURE, and the first that is a POST. W1.7 names
// five (triage, find-duplicates, thread summary, sprint suggestion, semantic search); the summary
// (#225) and the search (#230) already reached a browser. Of what is left, this is the only one
// that changes nothing: triage optionally OVERWRITES the issue's priority and labels
// (`?apply=true`, talyvor-track internal/ai/handler.go#Triage), and the sprint suggestion is a
// team-and-cycle read that belongs to a screen this app does not have.
//
// ⚠ IT IS A POST THAT WRITES NOTHING, AND IT IS STILL A WRITE PATH HERE. Nothing in Track changes;
// what it does is SPEND — one metered Lens completion per press, billed to the caller's workspace
// and attributed to THIS issue. MEASURED, not read: the request that reaches Lens carries
// `X-Talyvor-Feature: <the issue's identifier>` (R5X-2 for the subject issue in the harness run)
// and `"model":"claude-haiku-4-6"`, so Track's spend syncer resolves the row by
// `identifier = lens_feature` and the charge lands on `issues.ai_cost_usd` — the number the
// Details card renders. That is why it is in everyMutatingRoute() and behind the Origin gate: a
// cross-origin press is a stranger spending someone else's balance.
//
// ⚠⚠ WHAT THE UPSTREAM CAN ANSWER — MEASURED BY RUNNING IT, NOT BY READING IT. tab-9f27 drove
// talyvor-track's own `ai.Handler.FindDuplicates` at `6b31a75` over a REAL Postgres (throwaway
// pgvector:pg16, track's own 27 migrations) and a recording fake Lens, in a /tmp `git archive`
// export — talyvor-track is held by another tab and was never written to. The rows are in
// track_duplicates_test.go. Three of them shape this file:
//
//  1. TWO SHAPES, BOTH 200: a bare ARRAY of candidates, or the OBJECT
//     `{"ai_available":false,"reason":…}` when Track has no mint credential — which is this
//     deployment. So the body travels VERBATIM: re-encoding it, or turning the refusal into an
//     error status, would destroy the only evidence the screen has to tell "AI is off here" from
//     "AI ran and named nobody". The discrimination is in areas/track/duplicates.ts.
//
//  2. `200 []` IS AT LEAST FOUR FACTS and the response cannot say which: the model named none; it
//     named one below Track's 0.7 threshold; it named an issue that was not in the candidate
//     window, which the id lookup drops silently; or the window was empty. This is the Track
//     search finding (track_search.go) in a second place — an answer that is useful and cannot
//     be interrogated. Nothing this route can do fixes it; what it can do is not add a fifth way,
//     which is why no parameter of any kind is accepted or forwarded.
//
//  3. THE CANDIDATE WINDOW IS ONE TEAM, NOT THE WORKSPACE — `List(WorkspaceID, iss.TeamID, 20,
//     created_at desc)`. A byte-identical twin filed in another team of the SAME workspace was
//     measured NOT to be in the prompt at all, and the answer was `[]`. The screen says so.
//
// ⚠ NO BODY AND NO QUERY TRAVEL. `FindDuplicates` decodes no body (it is the only POST in that
// package that does not) and reads no query parameter, so anything forwarded would be sent
// upstream to be ignored and would come back looking honoured — docsPageList's rule, and the same
// reason trackIssueSummary forwards no query. The upstream request is a POST with NO body at all.
//
// ⚠ THE WORKSPACE IS THE SESSION'S, and there is no parameter for one — trackWorkspacePath is the
// only place a Track workspace-scoped path is assembled, for exactly that reason.
func (a *app) trackFindDuplicates() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodPost)
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
		a.forwardProduct(w, r, "track", a.cfg.trackBaseURL, a.cfg.trackGatewaySecret,
			trackWorkspacePath(ws, "/issues/"+url.PathEscape(id)+"/find-duplicates"), "",
			http.MethodPost, nil, nil)
	})
}
