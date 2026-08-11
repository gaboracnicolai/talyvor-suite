# apps/bff — the Talyvor suite backend-for-frontend

A small Go service (stdlib plus `go-oidc` + `x/oauth2`). Three jobs:

1. **Authenticate the browser.** `BFF_AUTH_MODE=oidc` runs an authorization-code + PKCE flow
   against any standards-compliant provider, and hands back an opaque `__Host-talyvor_session`
   cookie. Tokens and upstream credentials stay server-side. `BFF_AUTH_MODE=disabled` is the
   no-auth dev posture — loopback bind only. **There is no default mode**: silence refuses to
   start, because a default would decide an authentication question by omission.
2. **Hold the upstream credentials server-side. They never reach the browser.** They are attached
   only to outbound upstream requests. `TestKeyNeverReachesResponse` fails if any secret **this
   app's own config is holding** — read off `config` by `installedSecrets`, not from a constant —
   appears in a response body or header, or if a `tlv_ws_`/`gwsecret_` credential does.

   ⚠ It used to search only for the constant `testKey` (`tlv_ws_…`), which **no fixture in the
   package installs**, so it could not fail. See `secretleak_test.go` for the measurement and
   `~/talyvor-queue/w11-secretleak-controls.py` for the controls.
3. **Serve the built web app and its API from one origin** — so CORS never enters the picture.

Each signed-in person is provisioned their **own** Lens workspace (and their own Track workspace,
and Docs follows Track). There is no pinned workspace and no stored workspace key: the BFF holds
`LENS_PROVISION_SECRET`, which can create a workspace and mint that workspace's session token and
nothing else. Deliberately **not** `LENS_API_KEY` — the admin key authorises every workspace and
~30 admin routes, so a BFF compromise would escalate from one tenant to all of them.

## What refuses to start

All of it is in `loadConfig` (`main.go`), so a refusal happens before anything binds:

- `LENS_PROVISION_SECRET` missing.
- `BFF_AUTH_MODE` unset or not `oidc`/`disabled`.
- `LENS_API_KEY` **set** — the wrong credential for this process, so it is rejected rather than
  ignored.
- `TRACK_WORKSPACE_ID` **set** — Track is per-session; a pinned id would state a pinning that does
  not happen. Ignoring it would be worse than refusing.
- `LENS_BASE_URL` neither https nor loopback — credentials ride every request to it.
- `disabled` mode on a non-loopback bind. In `oidc` mode a non-loopback bind is permitted **only**
  with an https `BFF_PUBLIC_BASE_URL`, the origin the Secure `__Host-` cookie needs.
- `oidc` mode missing any of `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`,
  `BFF_PUBLIC_BASE_URL`, or `OIDC_ALLOWED_EMAILS` (authorisation must be stated; `*` states it).
- Track or Docs configured with only half its pair, or in `disabled` mode — the BFF forwards an
  identity it authenticated, and there is none to forward without auth.

A missing `WEB_DIST` bundle is **not** a refusal: it logs `WARNING web bundle not found` and serves
the API anyway.

## Run

```bash
BFF_ADDR=127.0.0.1:8787 \
BFF_AUTH_MODE=disabled \
LENS_BASE_URL=http://127.0.0.1:8080 \
LENS_PROVISION_SECRET=dev-provision-secret \
WEB_DIST=../web/dist \
go run .
```

`readme_boot_test.go` pastes that block into `loadConfig` and fails if it does not start — the
previous one named two variables this binary never reads and omitted two it refuses to start
without.

| Env | Default | |
|---|---|---|
| `BFF_ADDR` | `127.0.0.1:8787` | loopback, unless `oidc` + https public origin |
| `BFF_AUTH_MODE` | — | **required**: `oidc` or `disabled` |
| `LENS_BASE_URL` | `http://127.0.0.1:8080` | how the BFF reaches Lens; https or loopback |
| `LENS_PROVISION_SECRET` | — | **required**; same value Lens boots with |
| `LENS_PUBLIC_BASE_URL` | — | how a *customer* reaches Lens; unset ⇒ the Setup page has no snippets |
| `LENS_API_KEY` | — | must **not** be set (boot refusal) |
| `TRACK_WORKSPACE_ID` | — | must **not** be set (boot refusal) |
| `WEB_DIST` | `../web/dist` | built app to serve; missing ⇒ warning, not refusal |
| `BFF_PUBLIC_BASE_URL` | — | `oidc`: browser-facing origin, bare, no path |
| `OIDC_ISSUER` | — | `oidc`: discovery base URL |
| `OIDC_CLIENT_ID` | — | `oidc` |
| `OIDC_CLIENT_SECRET` | — | `oidc`: confidential client; PKCE is on top, not instead |
| `OIDC_ALLOWED_EMAILS` | — | `oidc`: comma-separated, or `*` for any authenticated identity |
| `BFF_SESSION_TTL` | `12h` | absolute session lifetime; sessions are in-memory |
| `OPERATOR_SUBS` | — | OIDC `sub`s that may read every tenant. Unset means **nobody** |
| `TRACK_BASE_URL` | — | optional pair with the secret below; `oidc` only |
| `TRACK_GATEWAY_SECRET` | — | must equal Track's `GATEWAY_AUTH_SECRET` |
| `DOCS_BASE_URL` | — | optional pair; unset ⇒ `/api/docs/*` answers 503 |
| `DOCS_GATEWAY_SECRET` | — | must equal Docs' `GATEWAY_AUTH_SECRET` |

That is the whole surface, and it is held to the binary from both sides:
`TestEveryEnvVarTheBinaryReadsIsDocumented` fails if a variable is read and missing here,
`TestReadmeNamesNoVariableTheBinaryIgnores` fails if one is listed here and read by nobody. For an
operator, `deploy/README.md` §4 and `deploy/bff.env.example` say what each value does to a
deployment and how it fails.

## Endpoints

Reads are `GET`. Writes — `POST`/`PATCH`/`DELETE` — are **both session-gated and
same-Origin-checked**; `keys.go` carries the CSRF argument they share. The registered set is in
`newApp` (`lens.go`) and covers `/api/context`, the LXC and token ledgers, keys, spend, pooling,
distill, convert, the Track and Docs proxies, the operator-only `/api/admin/*`, and `/auth/*`.
Not enumerated here on purpose: a list in this file is a second source of truth that nothing
compares to the router.

`/api/lxc/checkout` starts a Stripe Checkout Session to buy LXC and charges nothing itself — the
credit lands later, when Stripe's webhook reaches Lens. It answers `503 {billing_enabled:false}`
when Lens runs without `LENS_BILLING_ENABLED` (a **Lens** variable, not one of the BFF's);
`billing.go` argues why a 404 from Lens is unambiguous on that route.

Everything else is the SPA (client routes fall back to `index.html`).

`go vet ./... && go test -race ./...`
