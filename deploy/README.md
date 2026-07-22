# Deploying app.talyvor.com

Two processes on one box. Caddy (the `Caddyfile` here) terminates TLS on 443
for `talyvor.com` (301 → app) and `app.talyvor.com` (reverse-proxy). The BFF
listens on loopback `127.0.0.1:8787` and is never network-facing itself.

```
browser ── https ──> Caddy :443 ── http (loopback) ──> BFF :8787 ──> Lens
                                                        │
                                                        └── serves apps/web/dist
```

## BFF environment (public posture = oidc mode)

| Variable | Value |
|---|---|
| `BFF_AUTH_MODE` | `oidc` — required; there is no default mode |
| `BFF_PUBLIC_BASE_URL` | `https://app.talyvor.com` |
| `OIDC_ISSUER` | your IdP's issuer URL (Keycloak realm, Authentik app, Dex, or a Clerk instance acting as an OIDC provider) |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | a **confidential** client registered at the IdP with redirect URI exactly `https://app.talyvor.com/auth/callback` |
| `OIDC_ALLOWED_EMAILS` | comma-separated allowlist, or `*` to admit every identity the issuer authenticates |
| `BFF_SESSION_TTL` | optional, default `12h` |
| `LENS_BASE_URL` / `LENS_WORKSPACE_KEY` / `LENS_WORKSPACE_ID` | as in inc2 — the key never reaches the browser |
| `WEB_DIST` | path to the built `apps/web/dist` |

The BFF fails closed on any inconsistency: missing OIDC settings, an `http`
public URL off loopback, or a non-loopback `BFF_ADDR` without an `https`
public origin all refuse to start. `BFF_AUTH_MODE=disabled` (the dev mode)
refuses to bind beyond loopback at all.

Sessions are in-memory: restarting the BFF signs everyone out (they re-login).

## Caddy

```sh
caddy run --config deploy/Caddyfile   # or point the system service at it
```

Certificates for both hosts are automatic (Let's Encrypt). The certificate
already issued for `app.talyvor.com` on the server persists — replacing the
placeholder config with this file does not re-issue.
