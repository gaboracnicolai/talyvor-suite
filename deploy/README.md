# Deploying app.talyvor.com

Two processes on one box. Caddy (the `Caddyfile` here) terminates TLS on 443
for `talyvor.com` (301 → app) and `app.talyvor.com` (reverse-proxy). The BFF
listens on loopback `127.0.0.1:8787` and is never network-facing itself.

```
browser ── https ──> Caddy :443 ── http (loopback) ──> BFF :8787 ──┬── Lens  (workspace key attached server-side)
                                                                   ├── Track (X-Gateway-Auth + session identity)
                                                                   ├── Docs  (X-Gateway-Auth + session identity)
                                                                   └── serves apps/web/dist (the SPA)
```

Files in this directory:

| File | Role |
|---|---|
| `Caddyfile` | the real front door (apex 301 + reverse_proxy) — what this deploy installs |
| `Caddyfile.placeholder` | the pre-launch behaviour (apex 301 + "coming soon") — what rollback installs |
| `talyvor-bff.service` | systemd unit for the BFF |
| `bff.env.example` | template for `/etc/talyvor/bff.env` |

Everything below is written to be **verified at each step, not assumed** — every
step ends with a command whose expected output is stated. Nothing here touches
application code.

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

**Recommendation for the trial: use Google as the issuer.** Not a provider you
sign up for and not a container you run — an IdP you already have. The BFF is
deliberately generic OIDC precisely so it can point at anything
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
`handle_path /dex/*` block added to the Caddyfile, or its own subdomain and
DNS), its own config file with `staticPasswords` (bcrypt hashes you generate
and manage by hand), and one more container/unit to run and patch. Call it
45–90 minutes plus ongoing password custody. Keycloak/Authentik do the same
job with far more machinery; a hosted Auth0 tenant works but is a new SaaS
account when Google is already in hand.

**Either way there is real setup work before this can run at all** — an IdP,
a client id, a client secret, and the redirect URI registered at that IdP.
None of it can be skipped; the BFF fails closed without each one.

## 1. Obtain these BEFORE starting (nothing boots without them)

1. **OIDC client (Google path):** in Google Cloud Console —
   *APIs & Services → OAuth consent screen*: External, publishing status
   **Testing**, add every trial email as a test user. Then *Credentials →
   Create credentials → OAuth client ID → Web application*, with **Authorized
   redirect URI exactly** `https://app.talyvor.com/auth/callback` (scheme,
   host, and path must match to the character). Record the client id and
   secret. The issuer is `https://accounts.google.com`.
2. **Lens:** the base URL of the Lens box (**must be `https://…`** — the
   BFF does not police this URL, and the workspace key travels in a header on
   every read, so a plain-http remote value would put the key on the wire in
   clear), the workspace key (`tlv_ws_…`) and workspace id. These come from
   Lens onboarding (the admin-minted trial workspace + key).
3. **Track / Docs — optional at launch:** each needs its base URL *reachable
   from this box*, its `GATEWAY_AUTH_SECRET` (the exact value that product was
   started with — the BFF replays it as `X-Gateway-Auth`), and a workspace id.
   Leave a product's trio entirely unset and its `/api/track/*` or
   `/api/docs/*` routes answer **503** — the app shell still works. Partial
   trios refuse to boot. Note: the BFF forwards the session email as
   `X-User-Email`, which is the membership join key — a trial user must also
   be a **member** of the Track/Docs workspace or those products will refuse
   them individually.
4. The DNS for both hosts already points at this box (it does — the site is
   live), and Caddy already holds certificates for both (they persist across
   config reloads; nothing here re-issues).

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

## 3. Ship to the server

Target layout (one-time setup, first deploy only):

```sh
ssh <server> '
  sudo useradd --system --home /nonexistent --shell /usr/sbin/nologin talyvor 2>/dev/null || true
  sudo mkdir -p /opt/talyvor/bin /opt/talyvor/web-dist /etc/talyvor
'
```

Copy the artifacts (every deploy):

```sh
scp bff-linux-amd64 <server>:/tmp/bff
rsync -r --delete apps/web/dist/ <server>:/tmp/web-dist/
scp deploy/talyvor-bff.service <server>:/tmp/
ssh <server> '
  sudo install -m 0755 /tmp/bff /opt/talyvor/bin/bff
  sudo rm -rf /opt/talyvor/web-dist && sudo mv /tmp/web-dist /opt/talyvor/web-dist
  sudo install -m 0644 /tmp/talyvor-bff.service /etc/systemd/system/talyvor-bff.service
  sudo systemctl daemon-reload
'
```

**Verify:** on the server, `sha256sum /opt/talyvor/bin/bff` matches the local
hash, and `test -f /opt/talyvor/web-dist/index.html && echo bundle-ok` prints
`bundle-ok`.

## 4. The environment — exhaustive

Create `/etc/talyvor/bff.env` from `bff.env.example`, then
`sudo chmod 0600 /etc/talyvor/bff.env` (it holds three secrets: the Lens key,
the OIDC client secret, and any gateway secrets).

Every variable the BFF reads, and what happens without it:

| Variable | Required | Default | What it does / what happens if missing |
|---|---|---|---|
| `BFF_ADDR` | no | `127.0.0.1:8787` | Bind address. Keep the default: Caddy is the ingress. Non-loopback binds are refused unless oidc mode with an https public origin. |
| `BFF_AUTH_MODE` | **yes** | — none, deliberately | `oidc` or `disabled`. Missing or anything else → **refuses to start** ("say which one you mean"). Production is `oidc`; `disabled` additionally hard-fails on any non-loopback bind and refuses Track/Docs upstreams outright. |
| `LENS_BASE_URL` | no | `http://127.0.0.1:8080` | Lens API base. **Set `https://<lens-host>`** for the remote Lens box — this URL is *not* validated, and the workspace key rides every request to it. |
| `LENS_WORKSPACE_KEY` | **yes** | — | The `tlv_ws_…` key, held server-side and attached to every Lens read; it never reaches the browser (test-enforced). Missing → refuses to start. |
| `LENS_WORKSPACE_ID` | **yes** | — | The pinned workspace all Lens read paths are built from. Missing → refuses to start. |
| `WEB_DIST` | no | `../web/dist` | Path to the built SPA. Set `/opt/talyvor/web-dist`. Wrong path won't stop boot — step 6's `curl /` catches it. |
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
forward, and the BFF refuses to invent one). Fully unset → that product's
routes answer 503 and the rest of the app works.

## 5. Preflight boot — prove the env before touching systemd or Caddy

Run the BFF once in the foreground as the service user. **Every fail-closed
rule in the table above surfaces here**, before anything public changes:

```sh
sudo -u talyvor bash -c 'set -a; . /etc/talyvor/bff.env; set +a; /opt/talyvor/bin/bff'
```

**Verify — expect these lines, in order:**

```
bff: auth=oidc issuer=https://accounts.google.com public=https://app.talyvor.com allowlist=N entries
bff: product upstreams: track=… docs=… (unset = routes answer 503)
bff: serving 127.0.0.1:8787 → Lens https://… (workspace …); web bundle from /opt/talyvor/web-dist
bff: the Lens key is held server-side and never sent to the browser
```

Anything else is the BFF telling you exactly which variable is wrong — fix and
re-run. (`OIDC setup (issuer …)` here means discovery failed: issuer URL or
network.) Ctrl-C when the four lines are clean.

## 6. Run under systemd

```sh
ssh <server> 'sudo systemctl enable --now talyvor-bff && systemctl status talyvor-bff --no-pager -l | head -12'
```

**Verify (all on the server, all against loopback — nothing public yet):**

```sh
journalctl -u talyvor-bff -n 20 --no-pager        # the same four boot lines
curl -s http://127.0.0.1:8787/auth/me             # {"authenticated":false,"mode":"oidc","user":null}
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/api/context   # 401 — the auth gate is on
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/              # 200 — the SPA is served
```

## 7. The Caddyfile swap (the reversible step)

Snapshot what is live **first**, then install the repo front door:

```sh
ssh <server> '
  sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.pre-deploy.$(date +%Y%m%d%H%M)   # snapshot of the placeholder
'
scp deploy/Caddyfile <server>:/tmp/Caddyfile
ssh <server> '
  sudo caddy validate --config /tmp/Caddyfile               # expect: Valid configuration
  sudo install -m 0644 /tmp/Caddyfile /etc/caddy/Caddyfile
  sudo systemctl reload caddy                               # reload, not restart: certs and conns persist
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

## Rollback — back to the placeholder in one move

The Caddyfile swap is the reversible part, and it does not depend on the BFF:

```sh
ssh <server> '
  sudo cp /etc/caddy/Caddyfile.pre-deploy.<STAMP> /etc/caddy/Caddyfile   # the step-7 snapshot
  sudo systemctl reload caddy
'
# no snapshot? deploy/Caddyfile.placeholder in this repo reconstructs the same behaviour:
#   scp deploy/Caddyfile.placeholder <server>:/tmp/ && ssh <server> \
#     'sudo caddy validate --config /tmp/Caddyfile.placeholder && sudo install -m 0644 /tmp/Caddyfile.placeholder /etc/caddy/Caddyfile && sudo systemctl reload caddy'
```

**Verify:** `curl -s https://app.talyvor.com` → `Talyvor app — coming soon`,
and the apex still 301s. Certificates are untouched either direction — Caddy
reuses its issued certs across reloads.

Optionally stop the (now unreferenced, loopback-only) BFF:
`sudo systemctl stop talyvor-bff`. Rolling back Caddy alone is already a
complete rollback from the internet's point of view.

Re-deploying later is step 7 again — the two files swap cleanly in both
directions.
