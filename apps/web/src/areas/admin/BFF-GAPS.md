# Admin BFF gaps — the one PR that flips these screens live

Enumerated against **edge-infra @ `7e721f4`** (merged #51, `cmd/server/admin.go`), read-only. The
BFF proxies **nothing** from edge-infra today; `apps/bff/**` is another tab's territory — this file
is the spec for that PR, not a change to it.

## Upstream contract (all real, all shipping)

Fourth listener on the edge control plane, **`:18002`** by default. Every route is `GET`; auth is a
constant-time **`X-Admin-Key`** header match, fail-closed (empty configured key refuses everything;
the listener does not even start without one). Errors are `{"error": …}` with generic messages —
internals never echoed. `read_only: true` is stamped into `/config`. There is **no write route to
proxy, ever** — the API's own header comment: a config write path "would silently make the UI a
GitOps writer."

| BFF route (new) | Upstream | Returns |
|---|---|---|
| `GET /api/admin/topology` | `GET /admin/v1/topology` | `{gateways[], routes[], clusters[], endpoints[]}` — DTOs pinned in admin.go; secret fields are NAME references only |
| `GET /api/admin/nodes` | `GET /admin/v1/nodes` | `{scope:"connected-only", note, published_version, active_streams, nodes_behind, last_reconcile_unix, last_reconcile_duration_seconds, nodes:[{node_id, acked_version, behind}]}` |
| `GET /api/admin/certificates` | `GET /admin/v1/certificates` | `{certificates:[{name, kind, fingerprint_sha256?, issuer?, not_after?(RFC3339), parse_error?}]}` |
| `GET /api/admin/provisioning` | `GET /admin/v1/provisioning` | `{services[], requests[] (newest-first, status PENDING\|COMPLETED\|FAILED, error verbatim), request_limit:100}` |
| `GET /api/admin/config` | `GET /admin/v1/config` | `adminConfigView` — `read_only:true`, node_id, xds/ext_authz/rate-limit/HA presence booleans |

TypeScript mirrors of all five shapes already exist in `./api.ts`; the BFF PR streams upstream
bodies verbatim (the lens.go convention) and nothing client-side changes except deleting the
fixture function bodies.

## What the BFF PR must decide/build

1. **Env pair, all-or-none** (the products convention): `EDGE_ADMIN_BASE_URL` +
   `EDGE_ADMIN_KEY`. Unconfigured → explicit 503 JSON, like Track/Docs. The key is injected
   server-side as `X-Admin-Key` and must join the existing leak-sweep family (same assertion shape
   as `tlv_ws_` / gateway secrets: never in any response body/header, upstream DID receive it).
2. **⭐ The authz decision — this one is new.** Every existing `/api/*` route is available to any
   OIDC-allowlisted session, and for workspace data that is right. The admin surface is an
   OPERATOR surface: fleet topology, cert fingerprints, failure logs. The BFF PR must either add
   an operator allowlist (e.g. `ADMIN_ALLOWED_EMAILS`, checked after `requireSession`) or record
   the explicit decision that every user of this deployment is an operator. Silence is not a
   decision; the current single-operator posture makes `*` defensible but it should be WRITTEN.
3. **Read-only enforced at the BFF too**: register the five routes GET-only so the BFF never
   becomes the write path the upstream refused to be. No mutation route exists upstream to proxy;
   keep it that way structurally (mux method patterns), not by convention.
4. **Reachability note for deploy (not code):** `:18002` is a control-plane listener (Helm exposes
   it as an internal service port). The BFF likely reaches it over the private network / a tunnel —
   `EDGE_ADMIN_BASE_URL` is where that gets encoded; nothing here should ever require publishing
   :18002 to the internet.
5. **Error passthrough**: upstream `{"error"}` bodies stream through with their status (401 from a
   wrong key surfaces as 502-ish operator-visible failure or passes as-is — pick the lens.go
   convention and note that a BFF-side 401 means the BFF's own key is wrong, not the user's
   session).

## Deliberately NOT proxied

Nothing else exists — the upstream API is exactly these five GETs, v1, read-only by design. If a
sixth route ever appears upstream, it gets its own row here first.
