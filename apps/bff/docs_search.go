package main

import (
	"net/http"
	"net/url"
	"strconv"
)

// docsSearchMergedWindow is talyvor-docs' own `maxFetchRows` (internal/search/handler.go), named
// here because the two numbers cannot be allowed to disagree silently. It is the total number of
// MERGED rows the two-source path can ever produce, and therefore the last row a `type=all` search
// can reach — see the refusal below for what upstream does past it.
const docsSearchMergedWindow = 50

// docsSearchDefaultLimit is THIS route's default page size, and it is sent on the wire on every
// request rather than left to upstream's identical default. That is the whole reason it exists: the
// window arithmetic below compares `offset+limit` against docsSearchMergedWindow, so the limit this
// route reasoned about has to be the limit Docs serves. An unsent limit would make a refusal here
// depend on a default in another repository, and the day that default moved this route would be
// refusing one window while upstream truncated a different one.
const docsSearchDefaultLimit = 10

// docsSearchTypes is the set talyvor-docs' Search handler discriminates on: `all` (both halves,
// merged), `fulltext` and `semantic`. It is a closed set upstream in the only sense that matters —
// see docsSearchTypeRefusal for what an unrecognised value does there.
var docsSearchTypes = map[string]bool{"all": true, "fulltext": true, "semantic": true}

// docsSearchTypeRefusal names the upstream FACT rather than a policy, so it expires the day the
// fact does. MEASURED against talyvor-docs `7bfa1cf` by running its Search handler: `type=banana`
// runs NEITHER half — the two `if kind == "all" || kind == …` arms both miss — and answers
// `200 {"results":[],"total":0}`, byte-identical to a query that genuinely matched nothing.
const docsSearchTypeRefusal = "type must be one of all, fulltext, semantic — talyvor-docs' search " +
	"handler runs neither half for any other value and answers 200 with an empty result list, so a " +
	"mistyped type is indistinguishable from a workspace with no matching documents"

// docsSearchWindowRefusal is the same argument one parameter along. MEASURED, same handler, 200
// synthetic documents, type=all: limit=10&offset=45 returned FIVE rows and limit=10&offset=50
// returned NONE, both 200, both with `total` equal to the row count they served.
const docsSearchWindowRefusal = "offset+limit exceeds the 50-row window talyvor-docs can merge — " +
	"on type=all the offset is applied AFTER the two halves are re-ranked, so upstream fetches at " +
	"most 50 merged rows and cuts the page out of them; past that it serves a short page (or none) " +
	"with a `total` equal to what it served, which reads as the end of the corpus. Narrow the " +
	"query, or ask for one source (type=fulltext or type=semantic), which pages in SQL at any depth"

// docsSearch — GET /api/docs/search → GET /v1/workspaces/{ws}/search on the Docs upstream.
//
// ⚠ SEMANTIC PAGE SEARCH IS ONE OF THE AI FEATURES W1.7 RECORDED AS REACHABLE ONLY BY CURL, and
// this is its first browser address. It is not, however, an /ai/ route: Docs mounts search in its
// own package, the semantic half is one of two sources inside it, and the full-text half serves
// with or without Lens. That matters for what the screen may claim — see the next warning.
//
// ⚠⚠ THE RESPONSE CANNOT SAY WHETHER THE SEMANTIC HALF RAN, AND NOTHING HERE INVENTS THE ANSWER.
// MEASURED against talyvor-docs `7bfa1cf` with Lens unconfigured (which is this deployment):
// `SemanticSearch.Search` returns `[]SemanticResult{}, nil` when `IsEnabled()` is false, the
// handler merges that empty half in silently, and the envelope — `{results,total,query,took_ms}` —
// carries no flag for it. So a `type=all` answer of all-`fulltext` rows is the SAME BYTES whether
// the semantic half ran and matched nothing or was never configured at all. The one thing a caller
// CAN conclude is one-directional: a row tagged `semantic` or `both` proves the half ran. Its
// absence proves nothing. Any screen must say only that.
//
// ⚠ THE WORKSPACE IS THE SESSION'S, and there is no parameter for one — docsWorkspacePath is the
// only place a Docs workspace-scoped path is assembled, for exactly that reason.
//
// ⚠ THE QUERY IS REBUILT, NOT FORWARDED, and that is this repo's rule rather than a preference.
// docsPageList states it: "A parameter the upstream ignores is worse than one it rejects: the reply
// RENDERS AS FILTERED while being unfiltered." Docs' Search reads exactly five keys — q, type,
// space_id, limit, offset — so a sixth (`sort`, `author`, `highlight`) would travel to be ignored
// and come back looking honoured. Two of the five get more than forwarding, for the reasons on
// their refusals above.
//
// ⚠ WHAT IT COSTS. The full-text half is Postgres and free. The semantic half embeds the QUERY via
// Lens on every call (`embed(ctx, workspaceID, q)`), so a `type=all` or `type=semantic` search is a
// metered Lens call billed to this workspace under Docs' own feature tag — on a deployment where
// Lens is wired. It is attributed to no page: the embedding is of the query, and there is no page
// to attribute it to. This is why search is a submitted form here and not a keystroke-driven one.
func (a *app) docsSearch() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		in := r.URL.Query()
		kind := in.Get("type")
		// The empty string is ABSENT, not invalid: upstream defaults it to "all" itself, and a
		// default written here would be a second author of the same rule.
		if kind != "" && !docsSearchTypes[kind] {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": docsSearchTypeRefusal})
			return
		}
		limit := clampInt(in.Get("limit"), docsSearchDefaultLimit, 1, docsSearchMergedWindow)
		offset := clampInt(in.Get("offset"), 0, 0, maxDocsSearchOffset)
		// Both halves run for "all" and for an absent type. That is the only case where the
		// offset cannot go into SQL, and therefore the only case with a ceiling.
		if (kind == "" || kind == "all") && offset+limit > docsSearchMergedWindow {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": docsSearchWindowRefusal})
			return
		}
		ws, ok := a.docsWorkspaceFor(w, r)
		if !ok {
			return
		}
		out := url.Values{}
		// `q` travels VERBATIM and its rules stay upstream — the two-character minimum is Docs'
		// and is answered by Docs, so there is only ever one author of that number.
		out.Set("q", in.Get("q"))
		if kind != "" {
			out.Set("type", kind)
		}
		if sp := in.Get("space_id"); sp != "" {
			out.Set("space_id", sp)
		}
		// Explicit on every request — see docsSearchDefaultLimit, and the same argument applies to
		// an offset of zero: the window this route refused on is the window Docs is asked for.
		out.Set("limit", strconv.Itoa(limit))
		out.Set("offset", strconv.Itoa(offset))
		a.forwardProduct(w, r, "docs", a.cfg.docsBaseURL, a.cfg.docsGatewaySecret,
			docsWorkspacePath(ws, "/search"), out.Encode(), http.MethodGet, nil, nil)
	})
}

// maxDocsSearchOffset bounds the parsed offset. It is not an upstream limit — the single-source
// path pages in SQL to any depth — only a guard against an absurd value being formatted onto the
// wire. Past the merged window a two-source search is refused above long before this matters.
const maxDocsSearchOffset = 1 << 20
