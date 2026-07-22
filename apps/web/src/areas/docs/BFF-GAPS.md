# Docs BFF gaps — the one PR that unblocks this area

Enumerated from **talyvor-docs @ `e0cf605`** (origin/main), read-only. The BFF serves exactly one
Docs route today (`/api/docs/spaces`); everything below does not exist on the BFF. `apps/bff/**` is
another tab's territory — this file is the spec for that PR, not a change to it.

**Proxy mechanics (same as the existing route, `apps/bff/lens.go:74`):** upstream base
`cfg.docsBaseURL`, transit proof `X-Gateway-Auth: cfg.docsGatewaySecret`, identity headers from the
session (gatewayauth reads user email/id/teams/issuer AFTER the constant-time proof), workspace
pinned server-side to `cfg.docsWorkspaceID`, upstream body streamed **verbatim**. Every route below
is GET (one optional POST noted), so the BFF's read-only posture holds. Upstream errors are
`{"error":…,"code":…}` and pass through honestly. Authorization stays upstream: the session user
must be a member of the pinned workspace, and space/page tiers (View) are enforced by talyvor-docs
per route — a 403 means "not your tier", not a BFF bug.

Path-shape rule, following the existing route: the BFF strips `/api/docs` and pins the workspace
where the upstream path carries `{wsID}`; space/page ids pass through as opaque segments (they are
upstream-scoped to the pinned workspace by membership + tier checks).

## Tier 1 — MUST: makes browse + read live (this area flips off fixtures)

| BFF route | Upstream (all under `/v1`) | Returns |
|---|---|---|
| `GET /api/docs/spaces` | `GET /v1/workspaces/{ws}/spaces` | `[]model.Space` — **exists already** |
| `GET /api/docs/spaces/{spaceID}` | `GET /v1/spaces/{spaceID}` | `model.Space` (View-gated; 404 outside workspace) |
| `GET /api/docs/spaces/{spaceID}/pages?limit=&offset=` | `GET /v1/spaces/{spaceID}/pages` | `[]model.Page` ordered `depth, position, created_at`; limit default 100, cap 500. ⚠ rows include full `content` — fine at doc scale, but the BFF PR may want to note it |
| `GET /api/docs/spaces/{spaceID}/pages/{pageID}` | `GET /v1/spaces/{spaceID}/pages/{pageID}` | `model.Page` (View; 404-not-403 outside workspace) |

`model.Page` / `model.Space` field sets are mirrored verbatim in `./api.ts` (`DocsPage`, `DocsSpace`).

## Tier 2 — SHOULD: read-only UX substance (search, comments, versions)

| BFF route | Upstream | Returns |
|---|---|---|
| `GET /api/docs/search?q=&type=&space_id=&limit=&offset=` | `GET /v1/workspaces/{ws}/search` | ranked results (`SearchWithRank`): `[]{page, space_name, rank, headline}`; limit default 10 cap 50; templates excluded server-side |
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
- **DB-REST / MCP / AI / importer surfaces** — not part of a read-only reader.

## Error + auth semantics the area already assumes

- Upstream error body `{"error", "code"}`; BFF streams it verbatim; the area shows generic
  failure copy and never parses `code` today.
- 401 from the BFF (no session) throws the shared `ApiError` → App-level QueryCache re-probes
  `/auth/me` — already wired, nothing Docs-specific.
- 403 (workspace member without space tier) renders as the standard error state; when Tier 1
  lands, "couldn't load" copy could distinguish 403 with "you don't have access to this space".
