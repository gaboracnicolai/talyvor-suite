# Docs BFF gaps — the one PR that unblocks this area

Enumerated from **talyvor-docs @ `e0cf605`** (origin/main), read-only.

> **STATUS — Tier 1 is DONE.** All four Tier-1 routes now exist in `apps/bff/lens.go`. This file
> said "the BFF serves exactly one Docs route today" long after that stopped being true, and the
> area's screens repeated the claim to users. Tier 2 and Tier 3 below are still genuinely absent.
>
> Tier 1 landing did NOT make the screens live: this deployment runs no Docs upstream (no `DOCS_*`
> variables, not in the compose stack), so all four routes answer 503. The tree and reader
> therefore probe and report what the deployment says — see `lib/productState.ts`. When a Docs
> upstream appears they light up without an edit here.

**Proxy mechanics (same as the existing route, `apps/bff/lens.go:87`):** upstream base
`cfg.docsBaseURL`, transit proof `X-Gateway-Auth: cfg.docsGatewaySecret`, identity headers from the
session (gatewayauth reads user email/id/teams/issuer AFTER the constant-time proof), workspace
resolved **per request from the SESSION** (`docsWorkspaceFor`), upstream body streamed **verbatim**.
Every route below is GET (one optional POST noted), so the BFF's read-only posture holds. Upstream
errors are `{"error":…,"code":…}` and pass through honestly. Authorization stays upstream: the
session user must be a member of that workspace, and space/page tiers (View) are enforced by
talyvor-docs per route — a 403 means "not your tier", not a BFF bug.

> ⚠ This paragraph said "workspace **pinned server-side to `cfg.docsWorkspaceID`**" until it was
> measured. There is no such config field: suite #59 (`030ea53`) deleted `DOCS_WORKSPACE_ID`, and
> `track_tenant_test.go`'s `configHasField` check now FAILS if it ever returns, because a handler
> closing over one workspace at registration is how every signed-in person came to share one.
> Docs is per-identity — the id is the session's Track workspace by construction
> (`docsWorkspacePath`).

Path-shape rule, following the existing route: the BFF strips `/api/docs` and substitutes the
SESSION's workspace where the upstream path carries `{wsID}`; space/page ids pass through as opaque
segments (they are upstream-scoped to that workspace by membership + tier checks).

## Tier 1 — MUST: makes browse + read live (this area flips off fixtures)

| BFF route | Upstream (all under `/v1`) | Returns |
|---|---|---|
| `GET /api/docs/spaces` | `GET /v1/workspaces/{ws}/spaces` | `[]model.Space` — **EXISTS** |
| `GET /api/docs/spaces/{spaceID}` | `GET /v1/spaces/{spaceID}` | `model.Space` (View-gated; 404 outside workspace) — **EXISTS** (`docsSpaceDetail`) |
| `GET /api/docs/spaces/{spaceID}/pages?limit=` | `GET /v1/spaces/{spaceID}/pages` | `[]model.Page` ordered `depth, position, created_at`; limit default 100, cap 500 — **EXISTS** (`docsPageList`, which also projects the heavy `content`/`content_text` off every list row). ⚠ NO PAGING: an `offset` is REFUSED with a 400, because talyvor-docs' page-list handler reads only `limit` and its `PageFilter.Offset` has no writer — forwarding one returned the FIRST page with a 200. So a space is listed one page deep, at most 500 rows, until that handler reads an offset. |
| `GET /api/docs/spaces/{spaceID}/pages/{pageID}` | `GET /v1/spaces/{spaceID}/pages/{pageID}` | `model.Page` (View; 404-not-403 outside workspace) — **EXISTS** (`docsPageDetail`) |

`model.Page` / `model.Space` field sets are mirrored verbatim in `./api.ts` (`DocsPage`, `DocsSpace`).

## Tier 2 — SHOULD: read-only UX substance (search, comments, versions)

| BFF route | Upstream | Returns |
|---|---|---|
| `GET /api/docs/search?q=&type=&space_id=&limit=&offset=` | `GET /v1/workspaces/{ws}/search` | **EXISTS** (`docsSearch`), driven by the Search card on `/docs`. ⚠ THE SHAPE IS AN ENVELOPE, NOT A LIST, and this row used to say otherwise: `{results,total,query,took_ms}`, each row `{page_id,page_title,space_name,headline,rank?,similarity?,source,url,ai_cost_usd?,own_ai_cost_usd?,total_ai_cost_usd?}` — `source` is `fulltext`\|`semantic`\|`both`, and the three costs are POINTERS upstream (absent on a semantic-only row, so 0 means measured-and-zero). `total` is `len(results)`, NEVER a corpus count. ⚠ TWO PARAMETERS ARE REFUSED RATHER THAN FORWARDED, both measured by running Docs' handler: an unrecognised `type` (upstream runs NEITHER half and answers 200 with an empty list) and, on `type=all`, `offset+limit > 50` (upstream's `maxFetchRows` bounds the MERGED window, so a deeper page comes back short — or empty — with a `total` equal to what it served). See `apps/bff/docs_search.go`. |
| `GET /api/docs/spaces/{spaceID}/pages/{pageID}/comments?include_resolved=` | same path under `/v1` | `[]comment.Comment` `{id, page_id, block_id?, thread_id?, parent_id?, author_id, author_name, content, resolved, …}` (threaded) |
| `GET /api/docs/spaces/{spaceID}/pages/{pageID}/comments/stats` | same | comment stats (open/resolved counts) |
| `GET /api/docs/spaces/{spaceID}/pages/{pageID}/versions` | same | `[]model.PageVersion` `{id, page_id, workspace_id, version, title, content, created_by, created_at}` |
| `GET /api/docs/spaces/{spaceID}/pages/{pageID}/versions/{version}` | same | one `model.PageVersion` (full historical content — a read-only history viewer needs nothing else) |
| `GET /api/docs/spaces/{spaceID}/pages/{pageID}/versions/{version}/diff/{other}` | same | server-computed diff |
| `POST /api/docs/spaces/{spaceID}/pages/{pageID}/view` | same (`internal/analytics.RecordView`) | bumps `view_count` + inserts `page_views`. The ONE write a read-only UI legitimately makes; skip it if the BFF's read-only posture is absolute — cost is stale view counts only |

## Tier 3 — LATER: whole screens, each optional

| BFF route | Upstream | Feeds |
|---|---|---|
| `GET /api/docs/stale` | `GET /v1/workspaces/{ws}/pages/stale` | freshness dashboard |
| `GET /api/docs/freshness` | `GET /v1/workspaces/{ws}/freshness` | workspace freshness rollup |
| `GET /api/docs/spaces/{spaceID}/pages/{pageID}/freshness` | same | per-page freshness |
| `GET /api/docs/changelog` | `GET /v1/workspaces/{ws}/changelog/feed` | workspace changelog feed |
| `GET /api/docs/spaces/{spaceID}/pages/{pageID}/changelog` | `…/changelog/entries` | per-page changelog list (+ `/{id}` detail) |
| `GET /api/docs/pages/{pageID}/links` | `GET /v1/pages/{pageID}/links` | Track-issue links on a page |
| `GET /api/docs/spaces/{spaceID}/pages/{pageID}/analytics?days=` | same | per-page view stats |
| `GET /api/docs/analytics` | `GET /v1/workspaces/{ws}/analytics/pages` | workspace top-pages |
| `GET /api/docs/spaces/{spaceID}/pages/{pageID}/lock` | same | soft-lock state (already on `model.Page`, this is the live read) |
| `GET /api/docs/spaces/{spaceID}/pages/{pageID}/approval` | same (`Latest`) | approval status |
| `GET /api/docs/approvals/pending` | `GET /v1/workspaces/{ws}/approvals/pending` | reviewer inbox |
| `GET /api/docs/spaces/{spaceID}/pages/{pageID}/editsession` | same (View-tier read) | who holds the single-writer session |
| `GET /api/docs/spaces/{spaceID}/pages/{pageID}/export?format=…` | same | server-rendered export (md/html/pdf) |
| `GET /api/docs/templates?category=&search=` | `GET /v1/workspaces/{ws}/template-library` | template gallery |

## Deliberately NOT proxied

- **Anything that writes page content** — creates, PATCH, deletes, restores, comment writes,
  template use/import, approval decisions. The BFF is read-only by design; the editor question is
  a separate arc (see `./EDITOR-SIZING.md`).
- **`/v1/collab/{pageID}/ws`** — WebSocket, needed only by an editor arc. Note for that future PR:
  it sits behind gatewayauth, and a browser cannot attach `X-Gateway-Auth` to a WebSocket — the BFF
  must terminate the browser socket and dial upstream with the secret (a small dedicated proxy, not
  `proxyProduct`).
- **`GET /v1/public/s/{token}`** — public share links bypass the gateway by design; out of scope.
- **DB-REST / MCP / importer surfaces** — not part of a read-only reader.
- ~~**AI**~~ — **ONE of the five is now proxied.** `POST /api/docs/ai/ask` →
  `POST /v1/workspaces/{ws}/ai/ask` (`apps/bff/docs_ai.go`), driven by the Ask card on `/docs`.
  The other four (`ai/write`, `ai/transform`, `ai/translate`, `ai/suggest-title`) all take page
  content or a page id and belong to the editor arc; they stay unproxied and unreachable from a
  browser. ⚠ THE ASK RESPONSE CARRIES NO COST: `Engine.AskDocs` binds an EMPTY page id by design,
  so no `page_ai_spend_events` row is written and no page's `own_ai_cost_usd` moves — an ask is
  visible only in the workspace's Lens spend under the feature tag `docs-ai-ask`.
- **`GET /api/docs/search`** IS NOW BUILT (Tier 2 above), and it is the other half W1.7 asked for.
  ⚠ IT IS NOT AN `/ai/` ROUTE, and the distinction is load-bearing rather than pedantic: Docs
  mounts search in its own package (`internal/search`), and the semantic half is one of TWO sources
  inside it — the full-text half serves with or without Lens. ⚠⚠ AND THE RESPONSE CANNOT SAY
  WHETHER THE SEMANTIC HALF RAN. Measured against docs `7bfa1cf` by running the handler with Lens
  unconfigured (this deployment): `SemanticSearch.Search` returns `[], nil` when `IsEnabled()` is
  false, the handler merges that empty half in, and the envelope carries no flag for it — so an
  all-`fulltext` answer is the same bytes whether the half ran and matched nothing or was never
  configured. A row tagged `semantic`/`both` proves it ran; nothing proves it did not, and the card
  says only that. THAT is why there is no `type` toggle on the screen even though the route takes
  one: a "Semantic only" control on a box without Lens empties the list every time and cannot say
  why.

## Error + auth semantics the area already assumes

- Upstream error body `{"error", "code"}`; BFF streams it verbatim; the area shows generic
  failure copy and never parses `code` today.
- 401 from the BFF (no session) throws the shared `ApiError` → App-level QueryCache re-probes
  `/auth/me` — already wired, nothing Docs-specific.
- 403 (workspace member without space tier) renders as the standard error state; when Tier 1
  lands, "couldn't load" copy could distinguish 403 with "you don't have access to this space".
