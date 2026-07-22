package main

// Track Tier-1 read routes (the track area's gap list, items 1–3 and 5; item 4,
// the members roster, already ships as /api/members). Same non-negotiables as
// every product route: requireSession at registration, transit proof + session
// identity attached server-side by forwardProduct (the single credential path),
// upstream 403/404 preserved honestly (PLAIN proxy — proxyGated would launder a
// genuine not-found into "capability off"; its doc comment warns about exactly
// this case), and the workspace pinned from config so client input never names
// a tenant.
//
// THE ISSUES LIST QUERY IS A DECIDED SURFACE, NOT A PASSTHROUGH. Track's List
// handler reads ten parameters; this BFF forwards EXACTLY the allowlist below,
// each validated, and refuses everything else with a 400 that names the
// contract. Two reasons, argued in the PR:
//   · Forwarding blindly makes the BFF an open query surface onto whatever
//     upstream grows next — the surface must be enumerable HERE.
//   · A parameter the upstream ignores is worse than one it rejects: the reply
//     RENDERS AS FILTERED while being unfiltered. Track's own doc-comment
//     advertises `labels`, but its handler never parses it — so `labels` gets
//     an explicit refusal naming that fact, not a silent no-op (and not a
//     forward that pretends to work).
// Detail/comments/teams read no upstream parameters, so they forward none
// (query dropped, the docs id-route precedent — on a non-list route a stray
// parameter cannot misrepresent the result).

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// trackIssueFilterKeys are the opaque-value filters forwarded verbatim
// (validated, escaped). They correspond 1:1 to Track's IssueFilter string
// fields; values are parameterized upstream ($N placeholders), so the guard
// here is defence-in-depth plus wire hygiene, not the only line.
var trackIssueFilterKeys = []string{"status", "team_id", "project_id", "cycle_id", "assignee_id"}

// trackOrderBy mirrors the upstream store's ORDER BY allowlist. Upstream
// silently falls back to created_at on anything else — silently reordering an
// explicit sort request misrepresents the view, so the BFF refuses instead.
var trackOrderBy = map[string]bool{"created_at": true, "updated_at": true, "priority": true, "sort_order": true}

// trackIssuesAllowed names every accepted key, for the 400 message.
const trackIssuesAllowed = "status, team_id, project_id, cycle_id, assignee_id, priority, order_by, order_dir, limit, offset"

// trackQueryValue vets one opaque filter value: no control characters, sane
// length. Empty is handled by the caller (absent-filter semantics). Escaping
// for the wire happens at build time via url.QueryEscape.
func trackQueryValue(v string) bool {
	if len(v) > 200 {
		return false
	}
	for _, c := range v {
		if c < 0x20 || c == 0x7f {
			return false
		}
	}
	return true
}

// trackIssuesQuery validates the request's query against the decided contract
// and builds the upstream query string in a fixed order. On any violation it
// writes the 400 and returns ok=false.
func trackIssuesQuery(w http.ResponseWriter, r *http.Request) (string, bool) {
	q := r.URL.Query()
	reject := func(msg string) (string, bool) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
		return "", false
	}

	// Every provided key must be known, and provided at most once — the
	// upstream reads only the first value, and a silently dropped second
	// value is a filter the caller believes is applied.
	for key, vals := range q {
		switch {
		case key == "labels":
			return reject("labels is documented upstream but not implemented — filtering by it would silently return unfiltered results; omit it")
		case key == "priority", key == "limit", key == "offset", key == "order_by", key == "order_dir":
		default:
			known := false
			for _, k := range trackIssueFilterKeys {
				if key == k {
					known = true
					break
				}
			}
			if !known {
				return reject("unknown query parameter " + strconv.Quote(key) + " — this route forwards exactly: " + trackIssuesAllowed)
			}
		}
		if len(vals) > 1 {
			return reject("query parameter " + strconv.Quote(key) + " given more than once — the upstream would silently use only the first")
		}
	}

	var parts []string
	for _, k := range trackIssueFilterKeys {
		v := q.Get(k)
		if v == "" {
			continue // absent or empty = no filter, the upstream's own semantics
		}
		if !trackQueryValue(v) {
			return reject("invalid value for " + k)
		}
		parts = append(parts, k+"="+url.QueryEscape(v))
	}

	// priority: upstream filters only on a positive integer (0 or garbage =
	// no filter). Refuse non-integers rather than forwarding a no-op.
	if v := q.Get("priority"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 {
			return reject("priority must be a positive integer")
		}
		parts = append(parts, "priority="+strconv.Itoa(n))
	}

	if v := q.Get("order_by"); v != "" {
		if !trackOrderBy[v] {
			return reject("order_by must be one of created_at, updated_at, priority, sort_order")
		}
		parts = append(parts, "order_by="+v)
	}
	if v := q.Get("order_dir"); v != "" {
		d := strings.ToLower(v)
		if d != "asc" && d != "desc" {
			return reject("order_dir must be asc or desc")
		}
		parts = append(parts, "order_dir="+d)
	}

	// limit/offset mirror the upstream store's own bounds (default 50, cap
	// 250; offset ≥ 0) so the BFF contract states the truth, not a wish.
	limit := clampInt(q.Get("limit"), 50, 1, 250)
	offset := clampInt(q.Get("offset"), 0, 0, 1<<31-1)
	parts = append(parts, "limit="+strconv.Itoa(limit), "offset="+strconv.Itoa(offset))

	return strings.Join(parts, "&"), true
}

// trackIssues — GET /api/track/issues → GET /v1/workspaces/{pin}/issues with the
// decided query contract above. Returns Track's bare []model.Issue verbatim.
// NOTE (confirmed from source, not papered over): the upstream list carries NO
// total count — no COUNT query exists in Track's issue store — so this route
// cannot honestly offer "N of M" pagination. Deriving a total here would mean
// the BFF paging the entire result set per render; that is a Track-side change
// (count endpoint, window column, or a total header), not a proxy trick.
func (a *app) trackIssues() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		raw, ok := trackIssuesQuery(w, r)
		if !ok {
			return
		}
		a.forwardProduct(w, r, "track", a.cfg.trackBaseURL, a.cfg.trackGatewaySecret,
			"/v1/workspaces/"+a.cfg.trackWorkspaceID+"/issues", raw, nil)
	}
}

// trackIssueDetail — GET /api/track/issues/{id} → GET /v1/workspaces/{pin}/issues/{id}.
// Foreign or unknown ids are a 404 upstream (SEC-5: foreign ≡ unknown) and the 404
// passes through untouched. Query is dropped: the upstream detail reads none.
func (a *app) trackIssueDetail() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		id, ok := pathID(w, "id", r.PathValue("id"))
		if !ok {
			return
		}
		a.forwardProduct(w, r, "track", a.cfg.trackBaseURL, a.cfg.trackGatewaySecret,
			"/v1/workspaces/"+a.cfg.trackWorkspaceID+"/issues/"+url.PathEscape(id), "", nil)
	}
}

// trackIssueComments — GET /api/track/issues/{id}/comments → the issue's comment
// thread, []model.Comment verbatim (author names resolve client-side via the
// roster from /api/members).
func (a *app) trackIssueComments() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		id, ok := pathID(w, "id", r.PathValue("id"))
		if !ok {
			return
		}
		a.forwardProduct(w, r, "track", a.cfg.trackBaseURL, a.cfg.trackGatewaySecret,
			"/v1/workspaces/"+a.cfg.trackWorkspaceID+"/issues/"+url.PathEscape(id)+"/comments", "", nil)
	}
}

// trackTeams — GET /api/track/teams → GET /v1/workspaces/{pin}/teams,
// []model.Team verbatim. The upstream list reads no parameters; none forward.
func (a *app) trackTeams() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		a.forwardProduct(w, r, "track", a.cfg.trackBaseURL, a.cfg.trackGatewaySecret,
			"/v1/workspaces/"+a.cfg.trackWorkspaceID+"/teams", "", nil)
	}
}
