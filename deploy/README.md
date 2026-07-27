# Deploying app.talyvor.com

> ### ⚠ Deploying everything at once? Start with [`FULL-STACK-DEPLOY.md`](./FULL-STACK-DEPLOY.md).
>
> This document is still correct for the box, systemd, Caddy and the Track/Docs
> mechanics. What it predates is **per-user signup** (suite #30), which makes the
> BFF's Lens environment a hard prerequisite rather than an optional extra and puts
> **Lens first** in the order. Two specifics that will bite if you follow this file
> alone: the BFF now **refuses to boot** if `LENS_API_KEY` is set, and it no longer
> reads `LENS_WORKSPACE_KEY` / `LENS_WORKSPACE_ID` — it requires
> `LENS_PROVISION_SECRET`, the same value Lens boots with. **§1.2 and §4's Lens
> block below are out of date on that point** — §4's rows now say so inline.
> `bff.env.example` is correct: it carries `LENS_PROVISION_SECRET` and marks the two
> workspace variables as inert-but-retained (they are kept so one env file boots either
> binary, which is what makes rollback a binary swap).
>
> ⚠ This claimed `bff.env.example` "has been corrected" while the file still omitted
> `LENS_PROVISION_SECRET` entirely — so anyone who trusted the claim and built the env
> file from the example got a BFF that refused to start, and had been told the likeliest
> cause was already ruled out. A status claim about another file is a second source of
> truth; this one was wrong for hours.

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
- ~15 minutes of one-time console work (step 1 below): consent screen, one
  OAuth web client, one redirect URI.
- **THE TRIAL GATE IS `OIDC_ALLOWED_EMAILS`, AND ONLY THAT.** This list
  previously claimed the gate was "enforced twice — `OIDC_ALLOWED_EMAILS` in
  the BFF (authoritative) and Google's test-user list (non-test-users can't
  even complete the Google prompt while the app is in Testing)". **The second
  half is false**, and believing it would leave an operator thinking the door
  is double-locked when it has one lock. Google's *OAuth app state overview*
  says of the **Testing** state, verbatim: *"Only users explicitly added to the
  test user allowlist can access the app (limited to a hard cap of 100 test
  users). **Exception: If the app only requests basic identity scopes
  (`openid`, `email`, `profile`), any user can access without being on the
  allowlist.**"* The BFF requests exactly `openid email profile` and nothing
  else (`apps/bff/auth.go`, pinned by `TestOnlyBasicIdentityScopesAreRequested`).
  So **any Google account can complete the Google half of the flow today**,
  test-user list or not, and the only thing standing between a stranger and a
  workspace is `OIDC_ALLOWED_EMAILS`. Set it deliberately — see the variable
  table.
- Google sets `email_verified: true`; the BFF's verified-email rule is
  satisfied.
- Costs, honestly: trial users need Google accounts, and Google is in the login
  path's availability. Sessions are the BFF's own (**no refresh tokens** — grep
  `apps/bff` for `AccessTypeOffline`: zero hits), so Testing mode's 7-day
  refresh-token expiry is irrelevant to us. An **unpublished** app shows a
  consent screen without our name or logo; publishing fixes that and needs no
  review for these scopes (step 1).

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
   *APIs & Services → OAuth consent screen* (newer console: *Google Auth
   Platform*): **External**. Then *Credentials → Create credentials → OAuth
   client ID → Web application*, with **Authorized redirect URI exactly**
   `https://app.talyvor.com/auth/callback` (scheme, host, and path must match
   to the character). Record the client id and secret. The issuer is
   `https://accounts.google.com`.

   **Scopes: leave them as the three prefilled non-sensitive ones**
   (`openid`, `email`, `profile`) and add nothing. That choice is what keeps
   this app out of verification entirely — see the ⚠ note below and
   `TestOnlyBasicIdentityScopesAreRequested`.

   **Publishing status — recommended, not required.** *Google Auth Platform →
   Audience → **Publish app** → Confirm*. With only the three basic scopes
   this is **instant and needs no review**: verification is required only for
   sensitive/restricted scopes, and the 100-user cap and unverified-app
   "Danger UI" both apply only to apps requesting those. Publishing buys one
   thing — an app in **Testing** shows a consent screen without our name or
   logo. **Test users already added are NOT locked out**: publishing widens
   access from "the list" to "any Google Account", so everyone previously
   admitted still is, and the test-user list simply stops being consulted.
   Nobody is removed and nothing needs re-adding.
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
   them individually. **For Docs that membership now creates itself**: Track mints a
   workspace per identity at login, Docs enumerates Track and syncs its roster, and
   the BFF asks for the session's workspace (suite #59). No manual seed — but there
   is a first-visit delay of up to 15 minutes; see **FULL-STACK-DEPLOY.md step
   3a-bis**. Docs therefore **requires the Track pair to be configured**.
4. The DNS for both hosts already points at this box, and the containerised
   Caddy already holds certificates for both in its `caddy_data` volume (they
   persist across config reloads; nothing here re-issues).

## ⚠ Before you build — confirm the commit was actually TESTED

**The rule: assert a run EXISTS for the head SHA, then read its conclusion.**
Never poll for "conclusion == success" without first establishing that a run
exists. Those are two checks, and skipping the first turns a specific, dangerous
state into something that looks like patience.

**Zero runs is a distinct verdict.** It means **NOT TESTED** — not "not
finished". Three outcomes, not two:

| runs at the head SHA | verdict |
|---|---|
| ≥1, all `success` | tested and green — proceed |
| ≥1, any other | tested and not green — stop |
| **0** | ⚠ **NOT TESTED.** No CI ever ran on this code. Indistinguishable from "pending" if you only watch conclusions. |

**Why zero happens, and why it is easy to miss.** `pull_request` workflows run
from the **merge commit**, so a PR that conflicts with its base has no merge ref
and therefore **no run at all**. `gh pr view` reports `mergeable=UNKNOWN`, not
`CONFLICTING`, and `gh pr checks` says *"no checks reported"* — which reads like
a delay. Observed on suite #39: the pre-rebase head had **0 runs**; the same tree
rebased had 1. Nothing was red; nothing had run.

```sh
REPO=gaboracnicolai/talyvor-suite
SHA=$(git rev-parse HEAD)          # ⚠ FULL 40 chars — see the trap below

N=$(gh api "repos/$REPO/actions/runs?head_sha=$SHA" --jq '.total_count')
if [ "$N" -eq 0 ]; then
  echo "NOT TESTED — no run exists for $SHA. Do not deploy this commit."
else
  gh api "repos/$REPO/actions/runs?head_sha=$SHA" \
    --jq '.workflow_runs[] | "\(.name) \(.status)/\(.conclusion)"'
fi
```

⚠ **THE TRAP INSIDE THE TRAP: `head_sha` must be the full 40-character SHA.**
Pass an abbreviated one and the API returns `total_count: 0` — **no error, no
warning** — which is indistinguishable from "never tested". A check written with
`git rev-parse --short HEAD` reports every commit as untested, and it will look
like a real finding. Use `git rev-parse HEAD`.

*(This bit me while auditing: an abbreviated SHA made all 35 of today's merges
appear untested. Re-run with full SHAs, all 35 had a run at their own head SHA
and all were green.)*

## 2. Build (on your workstation)

```sh
git clone https://github.com/gaboracnicolai/talyvor-suite.git && cd talyvor-suite
pnpm install --frozen-lockfile
scripts/build-release.sh                  # → apps/web/dist + bff-linux-amd64
```

**Use the script, not the two build commands directly.** It derives the commit
once (`git rev-parse --short HEAD`) and stamps **both** artifacts with it, then
asserts the stamp actually landed. CI runs the same script, so the thing the
pipeline checks is the thing you run — a hand-rolled `go build` here would
produce an unidentifiable binary that CI could never have caught.

It prints the stamp it used. Read that line:

```
==> stamping both artifacts with: b41ea4d
```

**A `-dirty` suffix means your working tree had uncommitted changes**, so what
you are about to deploy does not correspond to that commit as pushed. That is
not a warning to click through — either commit the changes or accept that the
deployed version is not reproducible from the repository.

**Verify:** the script fails loudly if either stamp is missing, so a clean exit
is the verification. Additionally: `ls apps/web/dist/index.html` exists,
`cat apps/web/dist/version.json` names the commit, and `file bff-linux-amd64`
says `ELF 64-bit LSB executable, x86-64 … statically linked` (~7 MB). Record
`shasum -a 256 bff-linux-amd64` — you will compare it on the server.

⚠ On a non-linux workstation the script **cannot execute** the linux binary it
just built, so it verifies the `-X` plumbing on a host-native probe instead and
says so. That probe is a different binary from the one you ship. The shipped
one gets checked on the server in step 3b.

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

**And verify the versions — this is the shipped artifact, so this is the check
that counts:**

```sh
ssh <server> '
  /opt/talyvor/bin/bff version
  cat /opt/talyvor/web-dist/version.json
'
```

Both must name the commit you built. `dev` from the binary, or a
`"stamped": false` from the bundle, means that half was built without the
script — you cannot identify what is running, and that is worth fixing before
continuing rather than after something goes wrong.

⚠ **THESE TWO CAN DISAGREE, AND THAT IS THE FAILURE THIS EXISTS TO CATCH.** The
binary and the bundle are shipped by two separate commands above (`scp` + a
service restart; `rsync` of a directory). Either can succeed while the other
fails or is skipped, and the service keeps serving whatever is on disk. A
mismatch tells you which half is stale:

| reading | what happened |
|---|---|
| binary newer than bundle | the `rsync`/`mv` of the bundle did not land — **the browser is running old code against a new backend** |
| bundle newer than binary | the binary was not replaced, or the service was never restarted (step 6) |
| they match | both halves of this deploy completed |

Step 6 gets the same comparison from the running process in one request.

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
| `LENS_PROVISION_SECRET` | **yes** | — | ⚠ **The required one.** Gates Lens's `POST /v1/provision`, which turns a login into that person's own workspace + session token. Missing → **refuses to start, naming itself**. Must equal Lens's own `LENS_PROVISION_SECRET` (same name both sides). Deliberately **not** `LENS_API_KEY` — the admin key authorises every workspace and ~30 admin routes; setting it here is also a boot refusal. |
| `LENS_WORKSPACE_KEY` | no — **inert** | — | ⚠ Read by **nothing** since per-user signup (#30): `grep -c LENS_WORKSPACE apps/bff/main.go` = 0. Kept in `bff.env.example` on purpose — the **pre-#30 binary requires it**, so one env file boots either binary and rollback stays a binary swap. Tolerated silently by the current BFF. |
| `LENS_WORKSPACE_ID` | no — **inert** | — | As above. Both were previously documented here as required with "Missing → refuses to start"; that was true of the old binary and false of this one, in the direction that wastes the most time — it sends you looking at a working variable while the real refusal names a different one. |
| `WEB_DIST` | **yes, here** | `../web/dist` | Path to the built SPA — `/opt/talyvor/web-dist`. The default is a repo-relative dev path that means nothing under systemd; the unit deliberately does not set it, so **it must be in the env file** (it is in the template now — it wasn't, and that cost a round-trip). Wrong path won't stop boot — step 6's `curl /` catches it. |
| `BFF_PUBLIC_BASE_URL` | **yes** (oidc) | — | Browser-facing origin, `https://app.talyvor.com`. Derives the OIDC redirect URI (`<origin>/auth/callback`) and scopes the `__Host-` cookie. Must be a **bare origin** — any path/query → refuses to start; non-https public → refuses a non-loopback bind. |
| `OIDC_ISSUER` | **yes** (oidc) | — | Discovery base (`https://accounts.google.com`). Missing → refuses to start. Reachable but wrong / IdP down → **boot-time discovery fails** and the process exits (systemd retries). Must be https (http only on loopback, dev). |
| `OIDC_CLIENT_ID` | **yes** (oidc) | — | The client registered at the IdP. Missing → refuses to start. |
| `OIDC_CLIENT_SECRET` | **yes** (oidc) | — | Confidential-client secret; PKCE supplements it, never replaces it. Missing → refuses to start. |
| `OIDC_ALLOWED_EMAILS` | **yes** (oidc) | — | **`*` for a public trial; a comma-separated list for a closed one.** See "Which value goes here" directly below — this is the only thing gating signup, so it is a decision, not a formality. Lower-cased match against the id_token email; `*` alone admits every identity the issuer authenticates. Empty → refuses to start ("authorization must be stated, not implied"). Identities whose email the issuer marks unverified are refused by a list, not by `*`. **Read at boot: changing it needs a BFF restart.** |
| `BFF_SESSION_TTL` | no | `12h` | Absolute session lifetime (Go duration). Unparseable or ≤0 → refuses to start. Sessions are **in-memory**: every BFF restart signs everyone out (they just re-login). |
| `TRACK_BASE_URL` | no† | — | Track upstream base (reachable from this box). |
| `TRACK_GATEWAY_SECRET` | no† | — | Track's own `GATEWAY_AUTH_SECRET`, replayed as the `X-Gateway-Auth` transit proof. Held server-side, never emitted. |
| ~~`TRACK_WORKSPACE_ID`~~ | **MUST BE ABSENT** | — | ⚠ **The BFF now REFUSES TO START if this is set** (`apps/bff/main.go:112`). Track is per-session: each person is bootstrapped their own workspace at login. Delete the line from any existing env file. |
| `DOCS_BASE_URL` | no‡ | — | Docs upstream base. |
| `DOCS_GATEWAY_SECRET` | no‡ | — | Docs' `GATEWAY_AUTH_SECRET`, as above. |
| `DOCS_WORKSPACE_ID` | **gone** | — | ⚠ Removed from the BFF by suite #59 (`030ea53`): every Docs route resolves the SESSION's Track workspace (`docsWorkspaceFor`). Docs is per-identity now. **Leaving it set is silently ignored** — there is no refusal for it, unlike `TRACK_WORKSPACE_ID` — so delete the line rather than trusting it to be harmless. Not the counterpart of the Docs container's `DOCS_DEFAULT_WORKSPACE`, which now only scopes background jobs. |

† — Track's PAIR and ‡ — Docs' PAIR are each **all-or-nothing**: either set without the
other two → refuses to start, naming the missing ones. Both trios require
`BFF_AUTH_MODE=oidc` (in disabled mode there is no authenticated identity to
forward, and the BFF refuses to invent one). Base URLs obey the same boot-time
transport rule as `LENS_BASE_URL` — https anywhere, http only on loopback —
because the gateway secret rides every request. Fully unset → that product's
routes answer 503 and the rest of the app works.

### Which value goes in `OIDC_ALLOWED_EMAILS`

**There is no unsafe default, because there is no default** — the variable is
required and the BFF refuses to start without it. So this is a decision about
which trial you are running, not a risk to be hedged.

**Running a PUBLIC trial → `OIDC_ALLOWED_EMAILS=*`.**

Three facts make that safe, each of them checked rather than assumed:

1. **Every identity gets its own workspace.** Lens derives the workspace id
   from `(issuer, subject)` and the BFF never names one; Track bootstraps the
   same way. Two unrelated strangers signing up reach two workspaces, and
   neither can read the other's balance, keys, ledger, roster or spend —
   asserted on the RESPONSE BODIES of every workspace-scoped route, not just
   on the upstream paths (`apps/bff/stranger_signup_test.go`).
2. **An open door does not open the wallet.** A newly provisioned workspace
   has a zero LXC balance. The only two writers into an LXC balance in Lens are
   the Stripe top-up (`internal/billing/billing.go`, a paid purchase) and an
   admin grant route that is **default-off** behind
   `LENS_ADMIN_LXC_GRANT_ENABLED` — `cmd/lens/provision_handler.go` credits
   nothing. An unwanted signup therefore costs you one empty row, not money.
3. **Google does not gate this for us.** See the section above: with only
   `openid email profile`, any Google account completes the Google half
   regardless of publishing status or test-user list. A list here is the whole
   lock; `*` removes it deliberately rather than by accident.

**Running a CLOSED trial → the comma-separated list.** Costs, plainly: adding
someone means editing this file **and restarting the BFF** (config is read at
boot), so every new tester waits for you to be awake. That is the real price of
the list, and it is why `*` is the right value the moment you want strangers.

Whichever you choose, a refusal is now something you can act on rather than
hunt for. The person turned away gets a styled page that says the sign-in
worked, that this workspace has not granted them access, and offers a
different-account restart — it leaks nothing about the list. You get a log line
that **names the address** and tells you what to do with it:

```
bff: login DENIED — email=newcomer@example.org sub=1180024… reason=the address is not on
OIDC_ALLOWED_EMAILS | to admit them, add that address to OIDC_ALLOWED_EMAILS and RESTART the
BFF (config is read at boot); or set OIDC_ALLOWED_EMAILS=* to admit every identity this
issuer authenticates
```

An identity that carried **no** email claim renders as
`email=(none — the id_token carried no email claim)`, never as a blank field:
"the issuer sent no address" and "the address is not listed" are different
problems and must not look identical at 2am.

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
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/              # 200 — index.html exists
```

⚠ **That last 200 proves only that `index.html` exists** — not that the bundle is
complete or current. Assets are separate files, so a stale or half-copied
`web-dist` answers 200 at `/` just the same. And because the SPA falls back to
`index.html` for any path that is not a real file, **a status code cannot verify
any other path on this origin either** — `curl -f /version.json`, `/ledger`,
`/billing/success` all succeed whether or not the thing exists. Prove content,
not status; for "is this the bundle I built?", use `/api/version` below.

### Which commit is actually running?

```sh
curl -s http://127.0.0.1:8787/api/version
```

This is the check to reach for whenever the question is "did my deploy land?".
It answers from the **running process** and the bundle **currently on disk**, so
it reflects reality rather than what the deploy was supposed to do. Read
`verdict` first — it states the conclusion in words:

```json
{
  "service": "bff",
  "commit": "b41ea4d",
  "stamped": true,
  "bundle": { "readable": true, "commit": "b41ea4d", "stamped": true },
  "agree": true,
  "verdict": "MATCH — the BFF and the bundle it serves were built from b41ea4d."
}
```

- **`agree: true`** — both halves of the deploy landed.
- **`agree: false`** — a partial deploy. `verdict` names which half is stale.
- **`agree: null`** — *not* a match and *not* a mismatch: at least one side is
  unstamped or unreadable, so nothing was established. Never read `null` as
  agreement.

**It needs no authentication, deliberately.** Every other `/api/` route requires
a session; this one does not, because the moment you most need it is when the
IdP is misconfigured and nobody can log in — and because build identity is
already public on this origin (`index.html` names its content-hashed asset
files). Details and the reasoning are pinned in
`TestVersionEndpointIsNotBehindTheSession`.

`bff version` on the binary and `/api/version` from the running service answer
different questions: the first identifies a **file**, the second identifies the
**process** plus the bundle it is serving. After a deploy where you replaced the
binary but the restart failed, the file says the new commit and the process says
the old one — which is exactly the case worth catching.

### Reading the bundle's version without the BFF

The bundle carries its own stamp, so it can be identified even if the API is
broken — and by anything that serves `dist/`, not just this BFF:

```sh
curl -s https://app.talyvor.com/version.json | jq .        # must PARSE as JSON
curl -s https://app.talyvor.com/ | grep -o 'name="talyvor-build" content="[^"]*"'
```

⚠ **Do not test `/version.json` by status code.** The SPA falls back to
`index.html` for any path that is not a real file, so on a bundle built before
this existed the request returns **200 with HTML**. `curl -f` passes, `jq`
fails — which is why the check above pipes to `jq`. The `<meta>` tag has no such
ambiguity: it lives in `index.html` itself, so it is either there or it is not.

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

Open `https://app.talyvor.com` → sign in → Google prompt → back at the app,
signed in. Then confirm the areas: Lens screens live; Track/Docs live or a
clean 503 state per what you wired in step 4. If Google bounces the redirect,
the registered URI does not equal `https://app.talyvor.com/auth/callback`
character-for-character — fix it at the console, no server change needed.

**Then walk the stranger's path, which is the one the trial actually depends
on.** Signing in as yourself proves user one; almost everything works for user
one. In a private window, open `https://app.talyvor.com/marketing` → **Get
started** → `/signup` → **Continue**, as a **second, different Google account
that has never signed in here**:

- The access line on `/signup` must match reality: "no invitation needed" if
  you set `*`, the closed-trial sentence if you set a list. It is rendered from
  the BFF's own gate (`signup_open` on `/auth/me`), so a mismatch means the BFF
  you are talking to is not the one you configured.
- The pooling disclosure must **block** before the app, then land on `/setup`.
- `/setup` must show a workspace id **different** from your own account's, and
  a key you mint there must work.
- With a list configured, a third account not on it must get the styled
  "Access not granted" page — and `journalctl -u talyvor-bff` must show a
  `login DENIED — email=…` line naming that address.

---

## Redeploying after a merge — the common case

The whole of steps 0–7 is one-time. A routine redeploy is only this:

```sh
# workstation — the SAME script as step 2. Do not hand-roll the two builds here:
# this is the path that actually runs on every redeploy, so an unstamped build
# here is an unidentifiable deployment every time.
pnpm install --frozen-lockfile && scripts/build-release.sh
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

**Verify — one request, and read `verdict` first:**

```sh
ssh <server> "curl -s http://127.0.0.1:8787/api/version" | jq '{commit, bundle: .bundle.commit, agree, verdict}'
```

`agree: true` and both commits equal to what the script printed ⇒ **both halves
landed**. This is the check that catches the characteristic failure of *this*
section: the two artifacts are shipped by two separate commands above, and
`scp`-then-forget-the-`rsync` (or a restart that did not happen) leaves the
service serving one old half. `agree: false` names which half is stale;
`agree: null` means at least one side is unstamped, so **nothing was
established** — do not read it as a match.

Also: `curl -s https://app.talyvor.com/auth/me` answers, and the journal shows
the fresh boot lines. Caddy, the env file, the unit, the user, ufw — all
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

---

## Deploying Track and Docs

Neither has ever run on this box. The stack today is lens, postgres, pgbouncer,
redis, nats, caddy, autoheal — nothing else.

**Read this section start to finish before running step 1.** Two failures here are
silent: a gateway secret that differs between a product and the BFF 401s only that
product's routes, and a Track container started against an unmigrated database
boots fine and fails at the first query. Each step below therefore states what
success looks like, and §8 verifies reachability *from the BFF* rather than merely
that a container is running.

### What you are adding

| | Track | Docs |
|---|---|---|
| Image | `ghcr.io/gaboracnicolai/talyvor-track:latest` | `ghcr.io/gaboracnicolai/talyvor-docs:latest` |
| Published on | merge to `main` | merge to `main` |
| Database | `talyvor_track` | `talyvor_docs` |
| Migrations | **separate step — does NOT migrate on boot** | **on boot, fail-closed** |
| Listens | `0.0.0.0:3000` in-container | `0.0.0.0:4000` in-container |
| Published as | `127.0.0.1:3000` | `127.0.0.1:4000` |
| Caddy hostname | none | none |

### Why separate databases, not schemas in `talyvor_lens`

1. **Two migration runners, one table name.** Track and Docs each own a migration
   runner writing its own `schema_migrations`. In one database they collide unless
   every runner is schema-qualified — which neither is. This alone settles it.
2. **Blast radius.** Lens's own test and maintenance paths do destructive resets
   (`TRUNCATE`s guarded by triggers). A separate database means the worst case for
   a Lens mistake is Lens.
3. **Backup and restore granularity.** `pg_dump talyvor_docs` restores Docs without
   touching a money ledger. With schemas, restore is all-or-nothing.
4. **Least privilege later.** Per-database roles are a one-line change; carving
   equivalent isolation out of schemas in a shared database is not.

They share the postgres *server* — one instance, three databases. That is the
level of sharing worth having (one thing to back up, patch and monitor); sharing
the database itself buys nothing and costs the four points above.

### Order, and why it is this order

Databases → migrations → services → BFF. Each step depends on the previous one
having actually happened, not merely having been attempted.

---

#### 1. Generate the two gateway secrets

**You run these — no secret value is written down in this repo, and none should
be committed anywhere.** Two DIFFERENT secrets: one per product, so compromising
one does not grant the other.

```bash
export TRACK_GATEWAY_AUTH_SECRET="$(openssl rand -base64 32)"
export DOCS_GATEWAY_AUTH_SECRET="$(openssl rand -base64 32)"
```

**Success:** both are 44 characters and unequal.

```bash
printf 'track=%s docs=%s equal=%s\n' \
  "${#TRACK_GATEWAY_AUTH_SECRET}" "${#DOCS_GATEWAY_AUTH_SECRET}" \
  "$([ "$TRACK_GATEWAY_AUTH_SECRET" = "$DOCS_GATEWAY_AUTH_SECRET" ] && echo YES-REGENERATE || echo no)"
```

Both products require ≥ 16 chars and refuse to boot below that. Docs additionally
rejects `dev-only-insecure-gateway-secret-change-me` **permanently** — it shipped
in that repo's compose file and env template, so it is in git history and public
forever. `openssl rand` cannot produce it; do not hand-write a value.

Persist them where the compose stack reads its environment (the same
`.env` the lens stack already uses for `POSTGRES_PASSWORD`), mode `0600`:

```bash
cd /Users/ng/talyvor-lens
printf 'TRACK_GATEWAY_AUTH_SECRET=%s\nDOCS_GATEWAY_AUTH_SECRET=%s\n' \
  "$TRACK_GATEWAY_AUTH_SECRET" "$DOCS_GATEWAY_AUTH_SECRET" >> .env
chmod 600 .env
grep -c GATEWAY_AUTH_SECRET .env    # expect: 2
```

> **The same two values go into the BFF's env in step 7, under different names.**
> `GATEWAY_AUTH_SECRET` (product side) ↔ `TRACK_GATEWAY_SECRET` / `DOCS_GATEWAY_SECRET`
> (BFF side). Keep this shell open until step 7, or you will be generating a
> second pair by accident.

#### 2. Create the two databases

```bash
docker compose exec -T postgres psql -U lens -d talyvor_lens \
  -c 'CREATE DATABASE talyvor_track OWNER lens' \
  -c 'CREATE DATABASE talyvor_docs  OWNER lens'
```

**Success:** both listed, owned by `lens`.

```bash
docker compose exec -T postgres psql -U lens -d postgres -tAc \
  "SELECT datname FROM pg_database WHERE datname IN ('talyvor_track','talyvor_docs') ORDER BY 1"
# expect exactly:
#   talyvor_docs
#   talyvor_track
```

Both connect **directly to `postgres:5432`, not through pgbouncer** — pgbouncer is
pinned to `DB_NAME=talyvor_lens` and runs `POOL_MODE=transaction`, which breaks the
session-scoped advisory locks a migration runner needs. This is the same reason the
lens stack's own `migrate` service bypasses it.

#### 3. Add the services

Paste the services from `deploy/track-docs.compose.yaml` into
`talyvor-lens/docker-compose.yaml`. That file explains the two placement options;
pasting is recommended so the services are picked up by your habitual
`docker compose up -d` rather than depending on remembering a third `-f`.

**Success:** compose resolves with no interpolation errors and shows the new services.

```bash
cd /Users/ng/talyvor-lens
docker compose config --services | sort
# expect the existing seven PLUS: docs, track, track-migrate
```

If this errors with `TRACK_GATEWAY_AUTH_SECRET must be set`, step 1 did not persist
— fix it here rather than exporting a shell variable, or the next `up -d` from a
fresh shell will fail the same way.

#### 4. Pull the images

```bash
docker compose pull track docs
```

**Success:** both pull. If either 401s, `docker login ghcr.io` first — these are
private packages, same as the lens image.

Confirm you actually got a current image rather than a stale `:latest` from a
previous pull:

```bash
docker image inspect ghcr.io/gaboracnicolai/talyvor-track:latest \
  --format '{{index .Config.Labels "org.opencontainers.image.revision"}}{{"\n"}}{{.Created}}'
```

#### 5. Migrate Track — separately, because Track does not migrate on boot

This is the step that has no equivalent for Docs, and skipping it produces a Track
that starts cleanly and fails at the first request.

```bash
docker compose run --rm track-migrate
```

**Success:** the run exits 0 and the schema exists.

```bash
# Compare against the checkout, NEVER a number written here: a hardcoded count goes
# stale the next time a migration lands, and then this step fails for the wrong
# reason — which is the exact failure this runbook exists to prevent.
# `want` comes from the talyvor-track REPO. If it is not cloned on this box, run the
# `ls` on your workstation and paste the number — do not skip the comparison.
want=$(ls talyvor-track/migrations/*.sql | wc -l | tr -d ' ')
got=$(docker compose exec -T postgres psql -U lens -d talyvor_track -tAc \
  "SELECT count(*) FROM schema_migrations" | tr -d ' ')
echo "track schema_migrations: got=$got want=$want"; [ "$got" = "$want" ] && echo OK || echo MISMATCH
# expect: OK.  A number > 0 is NOT sufficient — a partial run leaves tables behind
# and would pass the old check.
```

Docs needs nothing here: its server applies pending migrations before serving,
and exits non-zero if they fail.

#### 6. Start both services

```bash
docker compose up -d track docs
```

**Success:** both healthy or running, and — for Docs — the boot log shows the
migration actually ran.

```bash
docker compose ps track docs
docker compose logs docs | grep -E "migrations (applied|up to date)"   # expect one of these

# And check the COUNT, not just the log line: "up to date" is also what a Docs that
# already migrated says, so on a redeploy the grep passes without proving the NEW
# migrations landed. Derived from the checkout so it cannot go stale.
# `want` comes from the talyvor-docs REPO. If it is not cloned on this box, run the
# `ls` on your workstation and paste the number — do not skip the comparison.
want=$(ls talyvor-docs/migrations/*.sql | wc -l | tr -d ' ')
got=$(docker compose exec -T postgres psql -U lens -d talyvor_docs -tAc \
  "SELECT count(*) FROM schema_migrations" | tr -d ' ')
echo "docs schema_migrations: got=$got want=$want"; [ "$got" = "$want" ] && echo OK || echo MISMATCH
docker compose logs track | tail -5
```

**Failure to expect here if step 1 went wrong:** a boot loop with
`missing required environment variable: GATEWAY_AUTH_SECRET must be set and >= 16 chars`,
or for Docs, `GATEWAY_AUTH_SECRET is a PUBLISHED placeholder`. Both are fail-closed
and loud — this is the *good* failure.

Confirm they are bound to loopback only, not the internet:

```bash
ss -ltnp | grep -E ':3000|:4000'   # expect 127.0.0.1:3000 and 127.0.0.1:4000, NOT 0.0.0.0
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/healthz   # 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4000/healthz   # 200
```

#### 7. Wire the BFF — the second half of the secret

Edit `/etc/talyvor/bff.env` and set both trios. **The secrets are the same two
values from step 1, under the BFF's names:**

```
TRACK_BASE_URL=http://127.0.0.1:3000
TRACK_GATEWAY_SECRET=<the TRACK_GATEWAY_AUTH_SECRET from step 1>

DOCS_BASE_URL=http://127.0.0.1:4000
DOCS_GATEWAY_SECRET=<the DOCS_GATEWAY_AUTH_SECRET from step 1>
```

⚠ **No `DOCS_WORKSPACE_ID` — it was removed from the BFF in suite #59.** Docs is
per-identity: each route resolves the session's Track workspace. If an older env
file on the box still has the line, **delete it**; the BFF ignores it silently, so
it will otherwise sit there stating a pinning that does not happen.

⚠ **Docs now requires the Track pair above.** The Docs workspace id *is* the one
Track mints at login, so with Track unconfigured every `/api/docs/*` route answers
`503 {"error":"track upstream not configured on this BFF"}` — a Docs symptom that
names Track.

`http://127.0.0.1:…`, **not** a docker service name: the BFF is a host systemd
process, so Docker DNS does not apply to it, and its config check refuses any URL
that is neither https nor loopback — `http://track:3000` fails startup outright.

Each trio is all-three-or-none, and oidc mode only; a partial trio refuses to boot
and names the missing variable.

**Success — verify the two sides match before restarting anything:**

```bash
# Run as a user who can read both. Compares digests, never prints a secret.
sudo sh -c '
  . /etc/talyvor/bff.env
  cd /Users/ng/talyvor-lens; . ./.env
  for p in TRACK DOCS; do
    eval bff=\$${p}_GATEWAY_SECRET
    eval svc=\$${p}_GATEWAY_AUTH_SECRET
    if [ -n "$bff" ] && [ "$bff" = "$svc" ]; then echo "$p: MATCH"; else echo "$p: MISMATCH — /api/${p} will 401"; fi
  done'
# expect: TRACK: MATCH   DOCS: MATCH
```

#### 8. Restart the BFF, and verify reachability *through* it

```bash
sudo systemctl restart talyvor-bff && sudo systemctl status talyvor-bff --no-pager
journalctl -u talyvor-bff -n 20 --no-pager | grep "product upstreams"
# expect: track=http://127.0.0.1:3000 docs=http://127.0.0.1:4000  (NOT "(unset)")
```

**A running container is not a reachable one.** These call the products *through*
the BFF, with a real session, which is the only test that exercises the whole
chain — session → gateway secret → identity header → workspace membership:

```bash
# In a signed-in browser at https://app.talyvor.com, or with a session cookie:
curl -s -o /dev/null -w 'track %{http_code}\n' -b "$COOKIE" https://app.talyvor.com/api/track/workspaces
curl -s -o /dev/null -w 'docs  %{http_code}\n' -b "$COOKIE" https://app.talyvor.com/api/docs/spaces
```

Reading the result — each code means one specific thing:

| Code | Meaning | Where to look |
|---|---|---|
| `200` | working end to end | done |
| `503` | the BFF has no upstream configured | step 7 trio incomplete, or the BFF was not restarted |
| `401` | **the gateway secrets do not match** | step 7 — the two names, one value |
| `403` | secret fine; your email is not a member of that workspace | For Docs this is normally the **first-visit window** — the member sync has not yet pulled the roster for a workspace created moments ago. It clears within 15 minutes, or immediately on `docker compose restart docs`. See **FULL-STACK-DEPLOY.md step 3a-bis**. Persisting past that means the sync is not running: check `MEMBER_SYNC_SECRET`. |
| `404` | secret and membership fine; the workspace does not exist upstream | Both products are per-session now, so there is no id to mistype. A 404 means the session's Track workspace is not present in that product — for Docs, that is normally the member-sync roster not having arrived yet (see FULL-STACK-DEPLOY.md step 3a-bis). |
| `502` | the BFF cannot reach the container | step 6 — check the loopback publish |

Finally, confirm neither product became internet-facing:

```bash
curl -s -o /dev/null -w '%{http_code}\n' --max-time 5 http://<public-ip>:3000/healthz   # expect: timeout/refused
curl -s -o /dev/null -w '%{http_code}\n' --max-time 5 http://<public-ip>:4000/healthz   # expect: timeout/refused
```

### Rollback

Both are additive; nothing existing changes.

```bash
docker compose stop track docs && docker compose rm -f track docs track-migrate
# then comment the two trios out of /etc/talyvor/bff.env and:
sudo systemctl restart talyvor-bff
```

The BFF returns to answering 503 on `/api/track/*` and `/api/docs/*`, and every
other screen is unaffected. The databases are left in place — dropping them is a
separate, deliberate act.
