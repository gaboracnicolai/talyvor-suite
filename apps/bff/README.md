# apps/bff — the Talyvor suite backend-for-frontend

A tiny Go proxy (stdlib only, no deps). It has **no authentication of its own yet** — by design.
Login has an unresolved decision behind it (Clerk isn't wired anywhere in Talyvor), so this increment
proves the *proxy*; a later increment adds auth to something already known to work.

Two jobs, and nothing else:

1. **Hold the Lens workspace key server-side. The key never reaches the browser.** It is attached only
   to the outbound upstream request and is never written into any response. `TestKeyNeverReachesResponse`
   fails if a `tlv_ws_` string ever appears in a response body or header.
2. **Serve the built web app and its API from one origin** — so CORS never enters the picture.

## Safety: loopback only

Because it has no auth, anything that can reach it is fully authorised. So it **refuses to start on a
non-loopback bind** — the shape of talyvor-code's `mcp.IsLoopbackHost`, but hard-failing instead of
warning. `127.0.0.1` / `localhost` / `[::1]` pass; `0.0.0.0`, `:PORT`, `[::]`, LAN and public addresses
are refused. It also refuses to start without a workspace key or id.

Read-only: `GET` only (else 405); upstream paths are built from the configured workspace id, never client
input; only `limit`/`offset` pass through, clamped.

## Run

```bash
BFF_ADDR=127.0.0.1:8787 \
LENS_BASE_URL=http://127.0.0.1:8080 \
LENS_WORKSPACE_KEY=tlv_ws_… \
LENS_WORKSPACE_ID=trial-ws-1 \
WEB_DIST=../web/dist \
go run .
```

| Env | Default | |
|---|---|---|
| `BFF_ADDR` | `127.0.0.1:8787` | must be loopback |
| `LENS_BASE_URL` | `http://127.0.0.1:8080` | |
| `LENS_WORKSPACE_KEY` | — | **required** (`tlv_ws_…`) |
| `LENS_WORKSPACE_ID` | — | **required** |
| `WEB_DIST` | `../web/dist` | built app to serve |

## Endpoints

Reads (`GET`): `/api/context` (workspace id + base url; never the key) · `/api/lxc/balance` ·
`/api/tokens/balance` · `/api/tokens/history?limit&offset` · `/api/lxc/history?limit&offset` ·
`/api/workspaces` · `/api/keys` · `/api/lxc/topup-options` (the top-up amounts on offer).

Writes (`POST`) — **both session-gated AND same-Origin-checked**, see `keys.go` for the CSRF
argument they share: `/api/keys` (mint a workspace key, returned exactly once) ·
`/api/lxc/checkout` (start a Stripe Checkout Session to buy LXC; charges nothing itself —
the LXC credit lands later, when Stripe's webhook reaches Lens). `/api/lxc/checkout` answers
`503 {billing_enabled:false}` when Lens runs without `LENS_BILLING_ENABLED`; `billing.go`
argues why a 404 from Lens is unambiguous on that route.

Everything else is the SPA (client routes fall back to `index.html`).

`go vet ./... && go test -race ./...`
