# Deploying app.talyvor.com

**This document describes the deploy as it actually runs**, corrected against
the first real deployment (2026-07-23). The single most important topology
fact, learned the hard way: **Caddy on this box is a Docker container from the
Lens stack** — it is not a host process, `127.0.0.1` inside it is the
*container*, and its config file lives in the **talyvor-lens repo**, not here.

```
browser ── https ──> Caddy :443 (container, talyvor-lens compose)
                        │  reverse_proxy host.docker.internal:8787  (the bridge, NOT loopback)
                        ▼
                     BFF 0.0.0.0:8787 (host systemd; ufw-scoped to the Docker bridge range)
                        ├── Lens  (workspace key attached server-side)
                        ├── Track (X-Gateway-Auth + session identity)
                        ├── Docs  (X-Gateway-Auth + session identity)
                        └── serves /opt/talyvor/web-dist (the SPA)
```

## Canonical paths — stated once, used everywhere

| Thing | Path | Owner/mode |
|---|---|---|
| BFF binary | `/opt/talyvor/bin/bff` (what `talyvor-bff.service` execs — same path, one truth) | `talyvor:talyvor` via the step-3a chown |
| Web bundle | `/opt/talyvor/web-dist` (`WEB_DIST` in the env file points here) | `talyvor:talyvor` |
| Env file | `/etc/talyvor/bff.env` | `root:talyvor` **0640** — see step 4 for why not 0600 |
| systemd unit | `/etc/systemd/system/talyvor-bff.service` | root |
| **Live Caddyfile** | **`talyvor-lens` repo → `deploy/caddy/Caddyfile`**, mounted read-only into the compose `caddy` service | lens repo owns it |
| This repo's `Caddyfile` | **reference copy only** — the app-host + apex blocks as they should appear in the live file. Editing it changes nothing on the server. | — |
| `Caddyfile.placeholder` | the pre-launch "coming soon" content, for rollback | — |

Everything below is verified at each step, not assumed — every step ends with a
command whose expected output is stated.

---

## 0. The IdP decision — read this before anything else

`BFF_AUTH_MODE=oidc` is mandatory on the public internet, and oidc mode needs a
real OIDC issuer: the BFF runs discovery against it **at boot** (an unreachable
IdP refuses to start), sends the browser to its authorize endpoint (so the
**browser** must be able to reach it — a loopback-only IdP on this box cannot
work), exchanges the code as a **confidential client** (client id + secret;
PKCE is added on top, it does not replace the secret), and takes the user's
identity from the id_token's `email` claim (an email the issuer marks
unverified is refused).

**The trial runs on Google as the issuer** (deployed and live). Not a provider
you sign up for and not a container you run — an IdP you already have. The BFF
is deliberately generic OIDC precisely so it can point at anything
standards-compliant, and `accounts.google.com` is the most battle-tested
issuer in existence for this exact stack (go-oidc + authorization code + PKCE).

- Zero new processes on the box; zero new config files beyond the env file.
- ~15 minutes of one-time console work (step 1 below): consent screen in
  **Testing** mode (≤100 test users — the shape of a closed trial), one OAuth
  web client, one redirect URI.
- The trial gate is enforced twice: `OIDC_ALLOWED_EMAILS` in the BFF
  (authoritative) and Google's test-user list (non-test-users can't even
  complete the Google prompt while the app is in Testing).
- Google sets `email_verified: true`; the BFF's verified-email rule is
  satisfied.
- Costs, honestly: trial users need Google accounts; the consent screen says
  the app is unverified (fine for a closed trial); Google is in the login
  path's availability. Sessions are the BFF's own (no refresh tokens), so
  Testing mode's 7-day refresh-token expiry is irrelevant.

**The self-contained alternative is Dex** on this box — choose it only if "no
third party in the login path" outweighs the cost. Be clear about the cost:
Dex must be **browser-reachable over https**, so it needs a public route (a
`handle_path /dex/*` block added to the live Caddyfile, or its own subdomain
and DNS), its own config file with `staticPasswords` (bcrypt hashes you
generate and manage by hand), and one more container/unit to run and patch.
Call it 45–90 minutes plus ongoing password custody. Keycloak/Authentik do the
same job with far more machinery; a hosted Auth0 tenant works but is a new
SaaS account when Google is already in hand.

## 1. Obtain these BEFORE starting (nothing boots without them)

1. **OIDC client (Google path):** in Google Cloud Console —
   *APIs & Services → OAuth consent screen*: External, publishing status
   **Testing**, add every trial email as a test user. Then *Credentials →
   Create credentials → OAuth client ID → Web application*, with **Authorized
   redirect URI exactly** `https://app.talyvor.com/auth/callback` (scheme,
   host, and path must match to the character). Record the client id and
   secret. The issuer is `https://accounts.google.com`.
2. **Lens:** the base URL of the Lens box (**must be `https://…`** — the
   workspace key travels in a header on every read, and the BFF refuses to
   boot on a remote plain-http URL for exactly that reason; http is allowed
   only on loopback, for dev), the workspace key (`tlv_ws_…`) and workspace
   id. These come from Lens onboarding (the admin-minted trial workspace +
   key).
3. **Track / Docs — optional at launch:** each needs its base URL *reachable
   from this box*, its `GATEWAY_AUTH_SECRET` (the exact value that product was
   started with — the BFF replays it as `X-Gateway-Auth`), and a workspace id.
   Leave a product's trio entirely unset and its `/api/track/*` or
   `/api/docs/*` routes answer **503** — the app shell still works. Partial
   trios refuse to boot. Note: the BFF forwards the session email as
   `X-User-Email`, which is the membership join key — a trial user must also
   be a **member** of the Track/Docs workspace or those products will refuse
   them individually.
4. The DNS for both hosts already points at this box, and the containerised
   Caddy already holds certificates for both in its `caddy_data` volume (they
   persist across config reloads; nothing here re-issues).

## 2. Build (on your workstation)

```sh
git clone https://github.com/gaboracnicolai/talyvor-suite.git && cd talyvor-suite
pnpm install --frozen-lockfile
pnpm --filter @talyvor/web build          # → apps/web/dist
( cd apps/bff && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
    go build -trimpath -ldflags="-s -w" -o ../../bff-linux-amd64 . )
```

**Verify:** `ls apps/web/dist/index.html` exists, and
`file bff-linux-amd64` says `ELF 64-bit LSB executable, x86-64 … statically
linked` (~7 MB). Record `shasum -a 256 bff-linux-amd64` — you will compare it
on the server.

## 3a. First deploy ONLY — the service user, directories, firewall

None of this exists on a fresh box, and the unit **fails with
`status=217/USER`** if the user is missing (this happened):

```sh
ssh <server> '
  sudo useradd --system --no-create-home --shell /usr/sbin/nologin talyvor
  sudo mkdir -p /opt/talyvor/bin /opt/talyvor/web-dist /etc/talyvor
'
```

**Verify:** `id talyvor` prints a uid/gid, not "no such user".

**Firewall — required in this topology.** The BFF binds `0.0.0.0:8787` (step 4
explains why), so ufw must admit the Docker bridge and nothing else:

```sh
ssh <server> 'sudo ufw allow from 172.16.0.0/12 to any port 8787 proto tcp && sudo ufw status | grep 8787'
```

Why scoped to `172.16.0.0/12` rather than opened wide: Docker allocates its
bridge networks (the default `172.17.0.1` gateway and compose-created nets)
from this RFC-1918 block, so the rule admits exactly "containers on this
host" — the only legitimate caller. The internet stays blocked by ufw's
default deny; port 8787 must never be publicly reachable, because raw `:8787`
is plain http — the TLS, HSTS and `__Host-` cookie posture all live at Caddy.

## 3b. Ship the artifacts (every deploy)

```sh
scp bff-linux-amd64 <server>:/tmp/bff
rsync -r --delete apps/web/dist/ <server>:/tmp/web-dist/
scp deploy/talyvor-bff.service <server>:/tmp/
ssh <server> '
  sudo install -m 0755 /tmp/bff /opt/talyvor/bin/bff
  sudo rm -rf /opt/talyvor/web-dist && sudo mv /tmp/web-dist /opt/talyvor/web-dist
  sudo chown -R talyvor:talyvor /opt/talyvor
  sudo install -m 0644 /tmp/talyvor-bff.service /etc/systemd/system/talyvor-bff.service
  sudo systemctl daemon-reload
'
```

The `chown -R` is not optional: `install`/`mv` leave the files root-owned, and
the service runs as `talyvor` — without it the unit starts and then cannot
read its own web bundle (this happened).

**Verify:** on the server, `sha256sum /opt/talyvor/bin/bff` matches the local
hash; `test -f /opt/talyvor/web-dist/index.html && echo bundle-ok` prints
`bundle-ok`; `stat -c %U /opt/talyvor/bin/bff` prints `talyvor`.

## 4. The environment — exhaustive

Create `/etc/talyvor/bff.env` from `bff.env.example`, then:

```sh
sudo chown root:talyvor /etc/talyvor/bff.env && sudo chmod 640 /etc/talyvor/bff.env
```

**0640, not 0600 — deliberately.** systemd reads `EnvironmentFile=` as root,
but the step-5 preflight (and any future as-`talyvor` debugging) sources the
file *as the service user* — group-read is what makes that possible while the
secrets stay unreadable to everyone else (this exact permission bounce
happened).

Every variable the BFF reads, and what happens without it:

| Variable | Required | Default | What it does / what happens if missing |
|---|---|---|---|
| `BFF_ADDR` | **yes, here** | `127.0.0.1:8787` | **On this server: `0.0.0.0:8787`.** The loopback default is a host-Caddy assumption — Caddy is a *container* here, and from inside it `127.0.0.1` is the container itself; it reaches the host only via the Docker bridge (`host.docker.internal` → `172.17.0.1`), so a loopback-bound BFF is unreachable and Caddy fails with `dial tcp 172.17.0.1:8787: i/o timeout` (this happened). The bind guard permits a non-loopback bind **only** in oidc mode with an https public origin — exactly this posture; in `disabled` mode the same bind hard-fails. The step-3a ufw rule keeps `:8787` off the internet. |
| `BFF_AUTH_MODE` | **yes** | — none, deliberately | `oidc` or `disabled`. Missing or anything else → **refuses to start** ("say which one you mean"). Production is `oidc`; `disabled` additionally hard-fails on any non-loopback bind and refuses Track/Docs upstreams outright. |
| `LENS_BASE_URL` | no | `http://127.0.0.1:8080` | Lens API base. **Set `https://<lens-host>`** for the remote Lens box. Enforced at boot: the workspace key rides every request to it, so https anywhere / http only on loopback — a remote http value **refuses to start**. |
| `LENS_WORKSPACE_KEY` | **yes** | — | The `tlv_ws_…` key, held server-side and attached to every Lens read; it never reaches the browser (test-enforced). Missing → refuses to start. |
| `LENS_WORKSPACE_ID` | **yes** | — | The pinned workspace all Lens read paths are built from. Missing → refuses to start. |
| `WEB_DIST` | **yes, here** | `../web/dist` | Path to the built SPA — `/opt/talyvor/web-dist`. The default is a repo-relative dev path that means nothing under systemd; the unit deliberately does not set it, so **it must be in the env file** (it is in the template now — it wasn't, and that cost a round-trip). Wrong path won't stop boot — step 6's `curl /` catches it. |
| `BFF_PUBLIC_BASE_URL` | **yes** (oidc) | — | Browser-facing origin, `https://app.talyvor.com`. Derives the OIDC redirect URI (`<origin>/auth/callback`) and scopes the `__Host-` cookie. Must be a **bare origin** — any path/query → refuses to start; non-https public → refuses a non-loopback bind. |
| `OIDC_ISSUER` | **yes** (oidc) | — | Discovery base (`https://accounts.google.com`). Missing → refuses to start. Reachable but wrong / IdP down → **boot-time discovery fails** and the process exits (systemd retries). Must be https (http only on loopback, dev). |
| `OIDC_CLIENT_ID` | **yes** (oidc) | — | The client registered at the IdP. Missing → refuses to start. |
| `OIDC_CLIENT_SECRET` | **yes** (oidc) | — | Confidential-client secret; PKCE supplements it, never replaces it. Missing → refuses to start. |
| `OIDC_ALLOWED_EMAILS` | **yes** (oidc) | — | Comma-separated allowlist (lower-cased match against the id_token email), or `*` alone to admit every identity the issuer authenticates. Empty → refuses to start ("authorization must be stated, not implied"). Identities whose email the issuer marks unverified are refused at login. |
| `BFF_SESSION_TTL` | no | `12h` | Absolute session lifetime (Go duration). Unparseable or ≤0 → refuses to start. Sessions are **in-memory**: every BFF restart signs everyone out (they just re-login). |
| `TRACK_BASE_URL` | no† | — | Track upstream base (reachable from this box). |
| `TRACK_GATEWAY_SECRET` | no† | — | Track's own `GATEWAY_AUTH_SECRET`, replayed as the `X-Gateway-Auth` transit proof. Held server-side, never emitted. |
| `TRACK_WORKSPACE_ID` | no† | — | The Track workspace served. |
| `DOCS_BASE_URL` | no‡ | — | Docs upstream base. |
| `DOCS_GATEWAY_SECRET` | no‡ | — | Docs' `GATEWAY_AUTH_SECRET`, as above. |
| `DOCS_WORKSPACE_ID` | no‡ | — | The Docs workspace served. |

† / ‡ — each product's trio is **all-or-nothing**: any one set without the
other two → refuses to start, naming the missing ones. Both trios require
`BFF_AUTH_MODE=oidc` (in disabled mode there is no authenticated identity to
forward, and the BFF refuses to invent one). Base URLs obey the same boot-time
transport rule as `LENS_BASE_URL` — https anywhere, http only on loopback —
because the gateway secret rides every request. Fully unset → that product's
routes answer 503 and the rest of the app works.

## 5. Preflight boot — prove the env before touching systemd or Caddy

Run the BFF once in the foreground as the service user. **Every fail-closed
rule in the table above surfaces here**, before anything public changes (this
is also why the env file must be group-readable — this command runs as
`talyvor`):

```sh
sudo -u talyvor bash -c 'set -a; . /etc/talyvor/bff.env; set +a; /opt/talyvor/bin/bff'
```

**Verify — expect these lines, in order:**

```
bff: non-loopback bind 0.0.0.0:8787 permitted: BFF_AUTH_MODE=oidc with https public origin https://app.talyvor.com
bff: auth=oidc issuer=https://accounts.google.com public=https://app.talyvor.com allowlist=N entries
bff: product upstreams: track=… docs=… (unset = routes answer 503)
bff: serving [::]:8787 → Lens https://… (workspace …); web bundle from /opt/talyvor/web-dist
bff: the Lens key is held server-side and never sent to the browser
```

The first line is the bind guard's *deliberate relaxation* announcing itself —
auth proven on + https public origin is the one posture where a non-loopback
bind is allowed. Anything else is the BFF telling you exactly which variable
is wrong — fix and re-run. (`OIDC setup (issuer …)` here means discovery
failed: issuer URL or network.) Ctrl-C when the lines are clean.

## 6. Run under systemd

```sh
ssh <server> 'sudo systemctl enable --now talyvor-bff && systemctl status talyvor-bff --no-pager -l | head -12'
```

**Verify (on the server — loopback curls still work because `0.0.0.0`
includes loopback):**

```sh
journalctl -u talyvor-bff -n 20 --no-pager        # the same boot lines as step 5
curl -s http://127.0.0.1:8787/auth/me             # {"authenticated":false,"mode":"oidc","user":null}
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/api/context   # 401 — the auth gate is on
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/              # 200 — the SPA is served
```

## 7. The front door — lives in the talyvor-lens repo, NOT here

**⚠ The live Caddy is the Lens stack's compose service.** Its config is
`deploy/caddy/Caddyfile` **in the talyvor-lens repo**, mounted read-only into
the `caddy` container. This repo's `deploy/Caddyfile` is a *reference copy* of
what the app-host and apex blocks should say — editing it changes nothing on
the server (a round-trip was spent learning this). Make the change where the
container reads it.

Two edits in **talyvor-lens**:

1. `docker-compose.yaml`, `caddy` service — the container must be able to
   resolve the host:

   ```yaml
   caddy:
     # …existing image/ports/env/volumes…
     extra_hosts:
       - "host.docker.internal:host-gateway"
   ```

2. `deploy/caddy/Caddyfile` — add the two site blocks (alongside the existing
   Lens block), exactly as in this repo's reference copy:

   ```caddyfile
   talyvor.com {
   	redir https://app.talyvor.com{uri} 301
   }

   app.talyvor.com {
   	header Strict-Transport-Security "max-age=31536000"
   	reverse_proxy host.docker.internal:8787
   }
   ```

   `host.docker.internal`, **not** `127.0.0.1`: inside the container, loopback
   is the container. Without both edits Caddy fails with
   `dial tcp 172.17.0.1:8787: i/o timeout` (this happened).

Snapshot, validate **inside the container**, then reload:

```sh
ssh <server> '
  cd <talyvor-lens checkout> &&
  cp deploy/caddy/Caddyfile deploy/caddy/Caddyfile.pre-deploy.$(date +%Y%m%d%H%M) &&
  docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile ; # validates the OLD mount first run
  docker compose up -d caddy &&                                            # picks up extra_hosts if newly added
  docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
'
```

**Verify, from your workstation (the outside view):**

```sh
curl -sI https://app.talyvor.com | head -5
# expect: HTTP/2 200 · strict-transport-security: max-age=31536000 · content-type: text/html…
curl -s https://app.talyvor.com/auth/me
# expect: {"authenticated":false,"mode":"oidc","user":null}
curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}\n' https://talyvor.com/anything
# expect: 301 -> https://app.talyvor.com/anything
```

## 8. The login round-trip (the only step that needs a browser)

Open `https://app.talyvor.com` → sign in → Google prompt (as a test user, with
an allowlisted email) → back at the app, signed in. Then confirm the areas:
Lens screens live; Track/Docs live or a clean 503 state per what you wired in
step 4. If Google bounces the redirect, the registered URI does not equal
`https://app.talyvor.com/auth/callback` character-for-character — fix it at
the console, no server change needed.

---

## Redeploying after a merge — the common case

The whole of steps 0–7 is one-time. A routine redeploy is only this:

```sh
# workstation
pnpm install --frozen-lockfile && pnpm --filter @talyvor/web build
( cd apps/bff && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
    go build -trimpath -ldflags="-s -w" -o ../../bff-linux-amd64 . )
scp bff-linux-amd64 <server>:/tmp/bff
rsync -r --delete apps/web/dist/ <server>:/tmp/web-dist/

# server
ssh <server> '
  sudo install -m 0755 /tmp/bff /opt/talyvor/bin/bff &&
  sudo rm -rf /opt/talyvor/web-dist && sudo mv /tmp/web-dist /opt/talyvor/web-dist &&
  sudo chown -R talyvor:talyvor /opt/talyvor &&
  sudo systemctl restart talyvor-bff
'
```

**Verify:** `curl -s https://app.talyvor.com/auth/me` answers, and the journal
shows the fresh boot lines. Caddy, the env file, the unit, the user, ufw — all
untouched. Note: sessions are in-memory, so a restart signs everyone out
(they re-login; nothing else is lost).

## Rollback — back to the placeholder in one move

The front-door swap is the reversible part, and it does not depend on the BFF.
In the **talyvor-lens** checkout on the server:

```sh
ssh <server> '
  cd <talyvor-lens checkout> &&
  cp deploy/caddy/Caddyfile.pre-deploy.<STAMP> deploy/caddy/Caddyfile &&
  docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
'
```

No snapshot? Replace the two talyvor site blocks in the live Caddyfile with
the contents of this repo's `deploy/Caddyfile.placeholder` (apex 301 +
`respond "Talyvor app — coming soon"`) and reload the same way.

**Verify:** `curl -s https://app.talyvor.com` → `Talyvor app — coming soon`,
and the apex still 301s. Certificates are untouched either direction — they
live in the `caddy_data` volume and persist across reloads.

Optionally stop the BFF: `sudo systemctl stop talyvor-bff`. Rolling back the
front door alone is already a complete rollback from the internet's point of
view.
