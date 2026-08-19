package main

import (
	"net/http"
	"net/url"
)

// trackTriage — POST /api/track/issues/{id}/triage → POST /v1/workspaces/{ws}/issues/{id}/triage on
// the Track upstream, WITH NO QUERY STRING, EVER.
//
// ⚠⚠ THE PARAMETER THIS ROUTE EXISTS TO NOT FORWARD. talyvor-track's `ai.Handler.Triage` reads
// `?apply=true` and then overwrites the issue's priority AND labels with the model's suggestion:
//
//	if r.URL.Query().Get("apply") == "true" {
//	    updates := map[string]any{"priority": int(result.SuggestedPriority), "labels": result.SuggestedLabels}
//	    _, _ = h.issues.Update(r.Context(), iss.ID, wsID, updates)   // ← error DISCARDED
//	}
//
// W1.7 has recorded for six claims that a button doing that is a product decision and not a
// session's, and left the whole feature unreachable in a browser because of it. The SUGGESTION
// changes nothing, so it is built; the APPLY is not "off by default" here, it is unreachable — this
// handler forwards no query at all, so no spelling of the parameter, and no header, can ask for it.
//
// ⚠ AND THE WRITE IS WORSE THAN "SILENT". It is unvalidated in the same breath: talyvor-track's
// `issue.Store` allowlists the KEYS of an update and none of the VALUES (already recorded in this
// queue), and the triage engine passes the model's number through — MEASURED at track `655a0a0`,
// a completion answering `"suggested_priority":9` (and `-1`) marshals straight out as 9 and -1,
// outside Track's 0..4 vocabulary entirely. `apply=true` would write that into the column, and the
// suite's own issue screen then draws a BLANK priority control for a value nobody recognises.
//
// ⚠ WHAT THE ANSWER CAN AND CANNOT SAY — MEASURED BY RUNNING IT (tab-7f6b, talyvor-track's own
// `ai.Engine.TriageIssue` + `ai.Handler.Triage` at `655a0a0`, over a recording fake Lens, in a /tmp
// `git archive` export; the repo is held by another tab and was never written to). Rows in
// track_triage_test.go. Three of them shape this file:
//
//  1. TWO SHAPES, BOTH 200: the suggestion object, or `{"ai_available":false,"reason":…}` when Track
//     has no mint credential — which is this deployment. So the body travels VERBATIM: re-encoding
//     it, or turning the refusal into an error status, would destroy the only evidence the screen
//     has to tell "AI is off here" from "AI ran and suggested this". Discrimination lives in
//     areas/track/triage.ts.
//  2. `suggested_priority: 0` AND `confidence: 0` EACH MEAN TWO THINGS AND THE WIRE CANNOT SEPARATE
//     THEM — Track's own vocabulary value ("None" / a stated zero) and Go's zero value for a field
//     the model omitted. Measured byte-identical both ways. Nothing this route can do fixes that;
//     what it can do is not pretend otherwise, which is the screen's job.
//  3. THE METER IS THE ISSUE. The request reaching Lens carries `X-Talyvor-Feature: <the issue's
//     identifier>` (measured: `ENG-42`) and `claude-haiku-4-6`, so the charge lands on this issue's
//     `ai_cost_usd` — the number the Details card renders. That is why this is in
//     everyMutatingRoute() and behind the Origin gate: a cross-origin press is a stranger spending
//     someone else's balance.
//
// ⚠ NO BODY TRAVELS EITHER. `Triage` decodes none, so a forwarded body would be sent upstream to be
// ignored and would come back looking honoured — docsPageList's rule, and the same reason
// trackFindDuplicates and trackIssueSummary forward nothing.
//
// ⚠ THE WORKSPACE IS THE SESSION'S, and there is no parameter for one — trackWorkspacePath is the
// only place a Track workspace-scoped path is assembled, for exactly that reason.
func (a *app) trackTriage() http.HandlerFunc {
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
		// The empty string in the query position is the whole safety property of this route: it is
		// what makes `apply` unforwardable rather than merely filtered.
		a.forwardProduct(w, r, "track", a.cfg.trackBaseURL, a.cfg.trackGatewaySecret,
			trackWorkspacePath(ws, "/issues/"+url.PathEscape(id)+"/triage"), "",
			http.MethodPost, nil, nil)
	})
}
