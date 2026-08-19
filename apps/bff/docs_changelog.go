package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// docsGenerateBody is the upstream schema, built HERE rather than forwarded, for the reason
// docsSummarizeBody and docsTranslateBody are: one of its three fields is authority rather than
// content. `workspace_id` is the tenancy key on talyvor-docs' generateBody
// (internal/changelog/handler.go#generateBody), and a body the browser writes is a body the
// browser chooses.
//
// ⚠ UPSTREAM ALREADY OVERRIDES IT — `in.WorkspaceID = ws`, from the page's own context, added by
// the SEC fix whose comment sits directly above it — and that is the argument FOR dropping it
// here, not against. MEASURED (see docs_changelog_test.go's header): a generate naming
// `workspace_id:"ws_ATTACKER"` answered 201 and wrote into the caller's real workspace. A field
// that travels the whole way and changes nothing is decoration a reader can mistake for tenancy;
// this route does not send one.
//
// ⚠ RE-MEASURED BY EXECUTION at talyvor-docs `8189d7b5` (a `git archive` scratch export; that repo
// was held by another tab and was NEVER written to), driving `changelog.Handler.Generate` over a
// recording issueLookup and a recording pgxDB, catcher predicted before each run:
//
//	body workspace_id ws_ATTACKER, context ws_REAL → 201; all four issue lookups and the INSERT's
//	                                                 workspace_id column read ws_REAL
//	the same body with NO workspace in context     → 403, the store never reached
//	the body with workspace_id omitted entirely    → identical to the first, so it is not required
//	instrument control: "ws_ATTACKER" appears in NOTHING the two recorders captured
//
// UPSTREAM-BINDS-ONLY docsGenerateBody: workspace_id
type docsGenerateBody struct {
	Version  string   `json:"version"`
	IssueIDs []string `json:"issue_ids"`
}

// docsChangelogGenerate — POST /api/docs/spaces/{spaceID}/pages/{pageID}/changelog/generate
// → POST /v1/spaces/{spaceID}/pages/{pageID}/changelog/generate on the Docs upstream.
//
// ⚠⚠ THIS IS THE FIFTH W1.7 CONTROL AND THE FIRST THAT IS NOT AN AI CALL. The item lists
// changelog generation among "eight AI features, every one a metered Lens call". MEASURED, it is
// not one: `GenerateFromIssues` reaches Lens never — it reads Track issues and groups them by
// label. Nothing is metered, no page's `own_ai_cost_usd` moves, and there is no feature tag. The
// cost of clicking this is a ROW, not a charge, which is why its card says something different
// from the other four rather than borrowing their cost sentence.
//
// ⚠⚠ THE REFUSAL: AN EMPTY ISSUE LIST. Upstream has no precondition on it — `GenerateFromIssues`
// normalises nil to `[]string{}` and `CreateEntry`'s four checks are about the version, the
// title, the type and the pool. Measured against talyvor-docs' own route at ce997ff on real
// Postgres (a `git archive` scratch export; that repo was held by tab-b9d7 and was never written
// to):
//
//	{"version":"v1.0.0","issue_ids":[]}          → 201 Created, one durable row
//	{"version":"v1.1.0"}                         → 201 Created, one durable row
//	{"version":"v1.2.0","issue_ids":null}        → 201 Created, one durable row
//	{"version":"v5.0.0","issue_ids":["","  ","\t"]} → 201 Created, "Generated from 3 issues"
//
// and the row the first one wrote, read back with SQL: title "v1.0.0", summary "Generated from 0
// issues", body `{"type":"doc",…"text":"No issues."…}`. The last one is worse than the first — it
// claims a count of three over three EMPTY bullets. Neither is an error; both persist, both can
// be retitled by a later PATCH, and both can be pushed into the workspace's public RSS feed by
// `…/changelog/entries/{id}/publish`. A button is what turns that from a thing curl can do into
// a thing a click does, so the refusal lands here: 400, no upstream call, no row.
//
// ⚠ THE REFUSAL IS EXACTLY AS WIDE AS THE MEASUREMENT — an issue list with nothing usable in it,
// and nothing else. A list with one real id and one blank (`["iss-a",""]`) is FORWARDED: measured,
// that produces a correctly-badged entry with one junk bullet and a count of two, which is a
// partial result and not the empty one. Deciding that a mostly-good entry is unacceptable would
// be a product threshold invented in a proxy.
//
// ⚠ AND THE VERSION IS NOT JUDGED HERE, WHICH IS THE OTHER HALF OF THE SAME RULE. Upstream has a
// real regexp and answers for itself — measured, 400 with its own message for `""`, `"   "` and
// `"banana"`, 201 for `v1.0.0` and `2026-08-18`. This repo's rule (docsPageList) is that a
// parameter the upstream IGNORES is worse than one it REJECTS; upstream rejects this one, so a
// second rule here would be a proxy authoring a vocabulary it does not own, and it would drift
// the day Docs widens the pattern. The refusal that IS here exists because upstream has no rule
// at all for it.
//
// ⚠ THE CAP IS maxDocsAskBody, THE QUESTION CAP — NOT maxDocsBody, the page cap that summarise and
// translate use. Those two carry a document; this carries a version string and a list of issue
// ids, so it is bounded at the size of the thing actually being sent, the argument
// docsAskAI already makes.
//
// ⚠ THE SPACE AND PAGE ARE PATH SEGMENTS, and this is the only Docs route in this BFF whose
// upstream is SPACE-scoped rather than workspace-scoped: Docs gates it with `pageEnf` on
// {pageID} and the object written is a page's changelog. docsWorkspacePath is deliberately not
// used. Both ids go through pathID, the same validation the page-detail routes use.
func (a *app) docsChangelogGenerate() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodPost)
			return
		}
		spaceID, ok := pathID(w, "spaceID", r.PathValue("spaceID"))
		if !ok {
			return
		}
		pageID, ok := pathID(w, "pageID", r.PathValue("pageID"))
		if !ok {
			return
		}
		raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxDocsAskBody))
		if err != nil {
			// 413 rather than a failure inside the forward, which reads from the outside as
			// "docs upstream unreachable" — a false statement about a healthy upstream.
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{
				"error": "too many issues to generate from at once"})
			return
		}
		var in docsGenerateBody
		if err := json.Unmarshal(raw, &in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad json"})
			return
		}
		usable := 0
		for _, id := range in.IssueIDs {
			if strings.TrimSpace(id) != "" {
				usable++
			}
		}
		if usable == 0 {
			// NOT a fault: nothing is broken and nothing is missing — there is simply nothing to
			// generate an entry FROM. Upstream would answer 201 to this and keep the row.
			writeJSON(w, http.StatusBadRequest, map[string]string{
				"error": "choose at least one issue to generate this entry from"})
			return
		}
		payload, err := json.Marshal(docsGenerateBody{Version: in.Version, IssueIDs: in.IssueIDs})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{
				"error": "could not build the changelog request"})
			return
		}
		a.forwardProduct(w, r, "docs", a.cfg.docsBaseURL, a.cfg.docsGatewaySecret,
			"/v1/spaces/"+url.PathEscape(spaceID)+"/pages/"+url.PathEscape(pageID)+
				"/changelog/generate", "", http.MethodPost, bytes.NewReader(payload), nil)
	})
}
