# Full-stack deploy — Lens + suite + Track + Docs, all at once

**This extends [`README.md`](./README.md); it does not replace it.** README covers
the box, the service user, systemd, Caddy and the Track/Docs mechanics, and all
of that still holds. What it does not know is that the **suite now provisions a
Lens workspace per person**, which changes the BFF's environment from *optional
extra* to *hard prerequisite*, and puts **Lens first in the order**.

This deploy is not degradable. Four services move together and three of the
couplings are shared secrets that fail in opposite directions — one side silently
401s, the other refuses to boot. Follow the steps in order. Every step ends with a
command and the exact output that means "continue".

---

## Verified against these commits

Read from `origin` at the time of writing, not from a local checkout:

| Repo | `origin/main` |
|---|---|
| talyvor-suite | `2d239d7` feat(notice): tell testers Docs is shared, and refuse TRACK_WORKSPACE_ID (#37) |
| talyvor-lens | `bcd82b8` fix(deploy): forward lens.env, not .env (#377) |
| talyvor-track | `98d0f6c` feat(workspace): idempotent per-identity bootstrap (#63) |
| talyvor-docs | `c8d9053` test(testutil): FAIL without a database instead of skipping (#44) |

Re-run STEP 0 below before you start; if a SHA has moved, the image check is
what catches it.

---

## What changed since README was written

Verified from source, with the file and line so you can re-check rather than
trust this table.

| Change | Verified at | Failure if ignored |
|---|---|---|
| BFF **requires** `LENS_PROVISION_SECRET` | `apps/bff/main.go:94` | Refuses to start, names itself |
| BFF **refuses to boot** if `LENS_API_KEY` is set | `apps/bff/main.go:96` | Refuses to start, names itself |
| BFF no longer reads `LENS_WORKSPACE_KEY` / `_ID` | absent from `apps/bff/*.go` | Silently ignored — they do nothing now |
| Lens fails **closed** without `LENS_PROVISION_SECRET` | `cmd/lens/provision_handler.go` `mountProvisionRoute` returns early on `""` | Route not registered → provisioning 404 → **every login fails** |
| Lens is at **107** migrations | `ls migrations/*.sql \| wc -l` = 107 | — |
| Track migrates by **subcommand** | `cmd/track/main.go:132` (`os.Args[1] == "migrate"`) | Empty schema, every call 500s |
| Docs migrates **on boot**, fail-closed | `cmd/docs/main.go:162` `migrate.Apply` before serving | — (it self-applies; a failure is a boot failure) |
| Track/Docs **reject published placeholder secrets** | `internal/config/config.go:137` in both | Refuses to boot |

> **Note (cosmetic, not blocking):** `apps/bff/auth.go:14-15` still carries a
> comment describing the old one-workspace model. It is stale prose, not
> behaviour. Worth a follow-up; it changes nothing here.

---

## ⚠ Read this once, before step 0: status is not capability

Every `docker compose ps`, every `/healthz`, every "healthy" in this deploy is a claim
about a **process**: it started, it is listening, it has not crashed. None of them is a
claim about a **capability**.

Lens passes every liveness check in this document with provisioning off, pooling off,
billing off and `lens.env` missing entirely. That is not a bug in the healthcheck — a
healthcheck that went red because an optional feature was unconfigured would take the
gateway out of rotation for no reason. It is simply answering a different question from
the one you are asking.

**So: never read `ps`, `healthy` or a 200 from `/healthz` as a deploy verdict.** Each
capability below has its own check that *exercises the capability* — provisioning is
proven by a 401 from the route, pooling by three gates and a similarity margin, billing
by a row count that increases. Where a step has no such check, it says so in
"Steps that cannot be fully verified" near the end, rather than letting a green status
stand in for one.

This is the single generalisation behind most of the traps in this document. It is
stated here once instead of five times.

---

## ⚠ Reading verification output: on the app origin, 200 does not mean "it is there"

A sibling of the above, for a different reason, and it changes how you write checks
against `app.talyvor.com` / `127.0.0.1:8787`.

**The BFF serves the SPA, and falls back to `index.html` for any path that is not a real
file.** So on that origin:

| path | what a 200 means |
|---|---|
| `/api/…`, `/auth/…` | a real handler answered — the code is meaningful |
| anything else | **`index.html` was served.** Says nothing about the path existing. |

**Measured** against a `web-dist` containing *only* `index.html` — no assets, no
`version.json`:

| request | code | content-type | `curl -f` exit |
|---|---|---|---|
| `/` | 200 | text/html | **0** |
| `/version.json` | 200 | **text/html** | **0** |
| `/billing/success` | 200 | text/html | **0** |
| `/ledger` | 200 | text/html | **0** |
| `/assets/index-nope.js` | 200 | **text/html** | **0** |
| `/api/version` | 200 | application/json | 0 |
| `/api/nope` | **404** | application/json | 22 |

Consequences, in order of how easy they are to get wrong:

1. **`curl -f` and `-w '%{http_code}'` cannot verify that a client-side route or a
   static file exists** on this origin. They succeed unconditionally — see every `0` in
   the last column. That includes `/version.json` and every SPA route: `/ledger`,
   `/setup`, and the `LENS_BILLING_SUCCESS_URL` landing page `/billing/success`. A
   post-purchase page that was never built into the bundle answers 200 exactly like one
   that was.
2. ⚠ **A MISSING JS ASSET ALSO ANSWERS 200 WITH HTML** — row five. This is the failure
   mode of a partial `rsync`: `index.html` lands, `assets/` does not, **every curl check
   in this document passes, and the app is a white screen.** The browser requests a
   content-hashed `.js` file, receives HTML, and fails to parse it. Nothing on the server
   side reports anything wrong. Check the asset actually referenced by `index.html`:
   ```sh
   JS=$(curl -s http://127.0.0.1:8787/ | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' | head -1)
   curl -s -o /dev/null -w "%{content_type}\n" "http://127.0.0.1:8787$JS"
   # expect: text/javascript.  text/html ⇒ the asset is MISSING and the app is broken.
   ```
3. **`curl / → 200` proves `index.html` exists, not that the bundle is complete or
   current.** See (2).
4. **Require content, not status.** `| jq -e '.field'` for JSON, a content-type or
   `grep -o` for everything else. Where what you want to prove is "the deployed bundle is
   the one I built", use the version comparison in STEP 6d — that is what it is for.

`/api/…` is the exception, and the last two rows show why: the `/api/` catch-all returns
a genuine **404**, so codes on `/api/…` routes discriminate real states. STEP 6's
Track/Docs table (200 / 401 / 403 / 404 / 502 / 503 → one cause each) is correct as
written for exactly that reason.

This does **not** apply to Lens, Track or Docs: they have no SPA fallback, so a 404 there
genuinely means "not mounted" (STEP 7's `400` vs `404` on the webhook route depends on
exactly that, and is correct as written).

---

## ⚠ Where each command runs, and what that host must already have

A runbook that fails at step one is worse than one that fails at step ten. **Three
different hosts** appear below and the commands are not interchangeable.

| Host | What it is | Must already have |
|---|---|---|
| **workstation** | your laptop | `git`, `docker` (logged in to `ghcr.io`, `read:packages`), **`gh`** (authenticated), `pnpm`, `go`, `ssh`, `shasum` |
| **app box** | runs the BFF (host systemd) + the Caddy/Lens compose stack | `docker compose`, `psql` via the postgres container, `ss`, `sudo` |
| **lens box** | in this deployment, the **same machine** as the app box — Caddy and Lens are containers there | the `talyvor-lens` checkout, beside which `lens.env` must live |

### ⚠ `check-images.sh` runs on the WORKSTATION, from the suite checkout

You already clone the suite there to build the BFF (README §2), so **no extra clone is
needed** — it is the same checkout:

```sh
git clone https://github.com/gaboracnicolai/talyvor-suite.git && cd talyvor-suite
bash deploy/check-images.sh
```

It does **not** need lens/track/docs checked out. It asks the GitHub API for each
commit's file list rather than reading a local repo, precisely because the workstation
is unlikely to have all four. It needs **`gh` authenticated** — without it every
service reports `UNKNOWN`, not a false OK.

**Do not run it on the app box.** That machine has the lens checkout but typically no
`gh` and no ghcr login, so it would report `UNKNOWN` across the board and read as an
outage.

### Prerequisites the steps below assume, and where to get them

| Needed by | Prerequisite | If missing |
|---|---|---|
| STEP 0 | `gh auth login`; `docker login ghcr.io` | every verdict is `UNKNOWN` |
| STEP 2a-bis | the `talyvor-lens` checkout on the app box | the long-tail settings have nowhere to live — and a curated variable put in `lens.env` is silently discarded |
| STEP 3 | ⚠ **the `talyvor-track` and `talyvor-docs` checkouts ARE needed on the box** — not for the images (those are pulled), but because the migration checks compare against `ls migrations/*.sql`. Clone them, or read the two numbers on your workstation and substitute them. | the count check cannot run, and `> 0` is not a substitute — it passes on a partial migration |
| STEP 5 | the suite checkout on the workstation (build host) | nothing to ship |
| STEP 7 | the `stripe` CLI **on the workstation**, logged in | the webhook-records proof cannot be run; do NOT enable billing without it |
| 6c / 7 | `psql` is reached via `docker compose exec postgres`, so no host psql is needed | — |

⚠ **The `stripe` CLI is the one prerequisite that is easy to discover too late** — it
is needed in the middle of the billing sequence, after the values are already in place.
Install and `stripe login` before starting STEP 7.

---

## STEP 0 — image preflight. Do this before touching the server.

**Nothing else in this document is safe to start until this passes.** Today a
Lens image build failed twice on a Docker Hub timeout, and a re-run pushed an
**older** commit over `:latest`. The check that was run could not tell "no image
for this commit" from "an image exists but `:latest` points somewhere else" —
those need different responses, so the check must distinguish them.

All three services publish `:latest` **and** `:<full-sha>` to
`ghcr.io/gaboracnicolai/talyvor-<svc>` (verified: lens `images.yaml:50-52`,
track `ci.yaml:203-205`, docs `ci.yaml:163-165`).

```sh
# Run on your workstation. Needs: docker logged in to ghcr.io (read:packages).
bash deploy/check-images.sh    # exits non-zero unless all three are OK
```

**Tested against the live registry, not written from the API docs.** Three things
that only showed up by running it, each of which would have made the check lie:

1. **`<none>` as a shell placeholder breaks under zsh** — it is parsed as a
   redirection inside `${var:-<none>}`, so every lookup reported absent. The
   script uses bare words.
2. **A registry hiccup is indistinguishable from an absent tag** if you only test
   for empty output. A transient failure and a genuinely missing image both give
   you nothing. The script reads stderr and separates them: `not found` /
   `MANIFEST_UNKNOWN` ⇒ **MISSING**, anything else ⇒ **UNKNOWN**. Treating a
   hiccup as MISSING is how you re-run a build you already have — or worse,
   conclude an image is fine when the lookup never happened.
3. **Image tags are the FULL 40-character SHA.** A short SHA silently resolves to
   nothing, which reads as MISSING. The script takes the SHA from `git ls-remote`
   so it cannot be truncated by hand.



**Expect: `OK` on all three lines.** Anything else, and what to do:

| Verdict | What it means | Do this |
|---|---|---|
| `MISSING` | The image workflow never succeeded for this commit (the Docker Hub timeout case). | Re-run the image workflow **for that exact SHA**: `gh workflow run images.yaml --repo gaboracnicolai/talyvor-lens --ref main`. Wait, then re-run STEP 0. |
| `STALE` | An image for this commit exists, but `:latest` was overwritten by a later re-run of an **older** commit — exactly what happened today. | **Do not deploy `:latest`.** Pin the compose/unit to `:<sha>` for that service (see the note under each service's step), or re-run the workflow so `:latest` is re-pushed from this commit. |
| `NO-LATEST` | Tag missing entirely. | Same as `MISSING` — re-run the workflow. |
| `UNKNOWN` | The **lookup** failed — network, auth, or rate limit. **Not** the same as MISSING. | Retry. Do not re-run a build on the strength of this, and do not deploy: you have learned nothing about the image either way. |

Why digests and not `docker pull`: pulling `:latest` and reading its labels
tells you what you *got*, not whether it *matches main*. Comparing the two tags'
manifest digests answers the actual question, and reports `<none>` distinctly
from a mismatch — which is the distinction that failed today.

> **If you must proceed with `STALE`:** pin by digest, never by `:latest`.
> `image: ghcr.io/gaboracnicolai/talyvor-lens@sha256:<by_sha digest>` is
> unambiguous and immune to a later re-push.

### ⚠ STEP 0b — after the LAST merge, wait for the image. This is a step, not a note.

**Every merge leaves a window of roughly 8-13 minutes in which main is ahead of the
registry.** Deploy inside it and `docker compose pull` fetches `:latest` from the
*previous* commit — which is how a stale image got deployed earlier today. The stack
comes up healthy and runs code you did not merge.

The check above reports **BUILDING** with elapsed minutes for exactly this. It is a
distinct verdict from MISSING because it wants the opposite response: wait, do not
investigate and do not re-run.

```sh
# Watch until every service is OK. Re-run after your last merge, not before it.
until bash deploy/check-images.sh; do echo "  …waiting"; sleep 60; done
echo "all images match main — safe to deploy"
```

**How long is too long,** derived from this repo's own runs rather than guessed —
11 of 12 recent lens builds finished in **8.3–12.2 min**, and **one took 60.1 min and
still succeeded**:

| Elapsed | Read it as |
|---|---|
| ≤ 15 min | Normal. Wait. |
| 15–45 min | Slow, but a 60-minute build has succeeded here. Keep waiting. |
| > 45 min | Past anything observed. Open the run before deploying — this is where "BUILDING forever" would otherwise become its own silence. |

A flat "40 minutes means stuck" would have condemned that 60-minute build, which is
why the bands come from measurement.

**Config-only merges produce no image, by design.** `images.yaml` is path-filtered to
`cmd/ internal/ migrations/ go.mod go.sum Dockerfile .github/workflows/images.yaml`.
Verified against history: `a41dd89`, `cc67661` and `6e78c37` (LICENSE/docs only) have
no image and needed none — the check calls that **NO-BUILD**, not MISSING, and `:latest`
correctly still points at the previous commit.

⚠ **But the filter does not watch `docker-compose.yaml`.** A merge that changes *only*
compose produces no image — so a compose fix reaches the server through `git pull` on
the Lens checkout, not through the registry. (The compose-plumbing merge `30c3f50` did
build, but only because it also touched test files under `cmd/**`. Do not rely on that.)

---

## STEP 1 — generate the three shared secrets, once

Three couplings, each one value under two names. Generate them together so they
cannot drift, and hold them somewhere you can paste from twice.

```sh
export PROVISION_SECRET=$(openssl rand -base64 48 | tr -d '\n')
export TRACK_SECRET=$(openssl rand -base64 48 | tr -d '\n')
export DOCS_SECRET=$(openssl rand -base64 48 | tr -d '\n')
printf 'provision=%s\ntrack=%s\ndocs=%s\n' \
  "${PROVISION_SECRET:0:8}…" "${TRACK_SECRET:0:8}…" "${DOCS_SECRET:0:8}…"
```

| Secret | Goes into | And into |
|---|---|---|
| `PROVISION_SECRET` | Lens stack: `LENS_PROVISION_SECRET` | BFF env: `LENS_PROVISION_SECRET` (**same name**) |
| `TRACK_SECRET` | Track container: `GATEWAY_AUTH_SECRET` | BFF env: `TRACK_GATEWAY_SECRET` (**different name**) |
| `DOCS_SECRET` | Docs container: `GATEWAY_AUTH_SECRET` | BFF env: `DOCS_GATEWAY_SECRET` (**different name**) |

**Verify — prove all three MATCH now, not three steps later.** Previously a mismatch
surfaced only as a 401 from Track/Docs or a 404 on login, which is loud but late: you
have already deployed four services by then. Compare digests at the moment you set
them. Never prints a secret.

```sh
# Run after you have written all three into their destinations.
dig() { printf '%s' "$1" | sha256sum | cut -c1-16; }
echo "provision  local=$(dig "$PROVISION_SECRET")"
ssh <lens-box>  "grep -oP '(?<=^LENS_PROVISION_SECRET=).*' /path/to/lens/lens.env" | sha256sum | cut -c1-16
echo "track      local=$(dig "$TRACK_SECRET")"
ssh <app-box>   "grep -oP '(?<=^TRACK_GATEWAY_SECRET=).*' /etc/talyvor/bff.env" | sha256sum | cut -c1-16
echo "docs       local=$(dig "$DOCS_SECRET")"
ssh <app-box>   "grep -oP '(?<=^DOCS_GATEWAY_SECRET=).*' /etc/talyvor/bff.env" | sha256sum | cut -c1-16
# expect: each pair of 16-char digests IDENTICAL. Any mismatch = fix it here,
# before a single service starts.
```

**Also verify:** each is ≥32 chars and is not the published placeholder
`dev-only-insecure-gateway-secret-change-me` — Track and Docs both reject that
string at boot regardless of length, because it is in git history and therefore
public (`internal/config/config.go:137` in each).

---

## STEP 2 — Lens first, and why

Lens is 7+ merges behind and must be **up, migrated and provisioning** before the
BFF starts, because the BFF calls `/v1/provision` on the very first login. Deploy
it in the other order and every login 404s.

### ⚠ 2a. Lens's compose does not pass the secret through. Fix that first.

**`LENS_PROVISION_SECRET` is absent from `talyvor-lens/docker-compose.yaml`.**
Verified: `grep -n LENS_PROVISION_SECRET docker-compose.yaml` returns nothing.

Putting it in `.env` therefore does **not** reach the container. Lens starts
cleanly, reports healthy, and — because provisioning fails *closed* — simply does
not register the route. Every login then 404s, with nothing in the Lens logs
saying why. This is the silent half-deploy this document exists to prevent, and
it is one line away.

This is a change to the **talyvor-lens** repo (not made here — that repo is
read-only for this work). Add to the `lens` service's `environment:` list,
beside the other `:-` defaults at `docker-compose.yaml:63-66`:

```yaml
      - LENS_PROVISION_SECRET=${LENS_PROVISION_SECRET:-}
```

`:-` keeps it safe by default: unset ⇒ empty ⇒ route unregistered, which is the
existing fail-closed behaviour.

**Verify before deploying:**
```sh
grep -cE '^\s*- LENS_PROVISION_SECRET=' docker-compose.yaml
# expect: 1.  0 = the secret cannot reach the container; STOP.
```

Count the **forwarding entry**, not any mention: a `grep -c LENS_PROVISION_SECRET`
also matches the comment explaining it, so it reports 1 when the line is gone.
(That exact mistake made the first version of the repo-side guard useless.)

⚠ **The same trap applies to ten more variables**, including
`LENS_CACHE_POOLABLE_ENABLED` — the global gate on pooling. Both are fixed in
talyvor-lens and held by `cmd/lens/compose_env_reach_test.go`; if you deploy a
Lens older than that fix, check each one with the pattern above.

### ⚠ 2a-bis. `lens.env` — and the trap that will bite you if you skip this section

`#377` changed the lens service from `env_file: .env` to `env_file: lens.env`, because `.env` also
holds the **Track and Docs gateway secrets** (this document's own step writes them there), which
would otherwise be loaded into the Lens process.

#### ⚠ FIRST — CORRECTION. The previous version of this step was wrong, in the direction that matters.

It said a missing `lens.env` leaves **provisioning, pooling and billing silently off**. That is
**false**, and was verified by rendering the compose project with the file absent: `LENS_PROVISION_SECRET`,
`LENS_BILLING_ENABLED`, `LENS_CACHE_POOLABLE_ENABLED` and `LENS_ECONOMY_ENABLED` **all reach the
container**, because they are named in `docker-compose.yaml`'s `environment:` list and take their
values from `.env`.

**What a missing `lens.env` actually costs** is the *long tail* — the mint caps, the embedding model,
the reservation/settlement toggles. Real, but not the headline failure the old text described.

#### ⚠⚠ SECOND — THE ACTUAL TRAP, AND IT IS A STEP, NOT A NOTE

**A variable set in BOTH `.env`'s curated list and `lens.env` arrives EMPTY.**

Compose's `environment:` **overrides** `env_file`. The curated entries are written
`- LENS_X=${LENS_X:-}`, which resolves from `.env` / the shell — and if neither defines it, that
resolves to **empty**, and the empty wins over whatever `lens.env` says. Verified in a real container;
there is no spelling of `environment:` that defers to `env_file`.

⚠ **The previous version of this step told you to put six such variables into `lens.env`**:
`LENS_PROVISION_SECRET`, `LENS_CACHE_POOLABLE_ENABLED`, `LENS_ECONOMY_ENABLED`,
`LENS_POOL_ROYALTY_MINTING_ENABLED`, `LENS_POOL_ROYALTY_SHARE`, `LENS_SHADOW_MINTS_ENABLED`. **All six
would have arrived empty.** `lens.env.example` invited the same mistake until #378 removed them.

**If you followed this document before #378, do this now:**

```sh
cd <talyvor-lens checkout>
# Anything in BOTH files is being discarded. Expect NO output.
comm -12 <(grep -oE '^[A-Z_]+' lens.env 2>/dev/null | sort -u) \
         <(grep -oE '^\s+- (LENS_[A-Z_]+)' docker-compose.yaml | grep -oE 'LENS_[A-Z_]+' | sort -u)
```

Every name it prints must be **moved out of `lens.env` and into `.env`**.

#### Which file does a variable go in?

⚠ **There is no rule to apply — the split is by mechanism, not by importance, and it does not follow
any category.** Two mint caps are curated while six others are not; secrets split 16 to 1. So this is
enumerated rather than explained, because a rule nobody can apply is worse than a list.

**These 44 go in `.env`** (they are named in `docker-compose.yaml`; putting them in `lens.env` yields
an empty value):

```
LENS_ADMIN_LXC_GRANT_ENABLED     LENS_ANTHROPIC_API_KEY            LENS_API_KEY
LENS_AWS_ACCESS_KEY_ID           LENS_AWS_REGION                   LENS_AWS_SECRET_ACCESS_KEY
LENS_BILLING_CANCEL_URL          LENS_BILLING_ENABLED              LENS_BILLING_SUCCESS_URL
LENS_CACHE_POOLABLE_ENABLED      LENS_DATABASE_URL                 LENS_DB_MAX_CONNS
LENS_DB_PGBOUNCER                LENS_DISTILL_POOLABLE_ENABLED     LENS_ECONOMY_ENABLED
LENS_GOOGLE_API_KEY              LENS_GROQ_API_KEY                 LENS_JWT_PRIVATE_KEY
LENS_LOG_LEVEL                   LENS_MINT_RATE_CAP_LENS_24H       LENS_MISTRAL_API_KEY
LENS_MODEL_CATALOG_OVERRIDES     LENS_MODEL_WATCH_ENABLED          LENS_MODEL_WATCH_INTERVAL
LENS_NATS_URL                    LENS_OLLAMA_URL                   LENS_OPENAI_API_KEY
LENS_OPERATOR_ALERT_WEBHOOK_SECRET  LENS_OPERATOR_ALERT_WEBHOOK_URL  LENS_PATTERN_CAPTURE_ENABLED
LENS_PATTERN_EARNING_ENABLED     LENS_PATTERN_MINING_ENABLED       LENS_POOL_ROYALTY_MINTING_ENABLED
LENS_POOL_ROYALTY_SHARE          LENS_POVI_CHALLENGE_KEY           LENS_PROVISION_SECRET
LENS_REDIS_URL                   LENS_SHADOW_MINTS_ENABLED         LENS_STRIPE_SECRET_KEY
LENS_STRIPE_WEBHOOK_SECRET       LENS_TRACK_WEBHOOK_SECRET         LENS_TRACK_WEBHOOK_URL
LENS_VLLM_API_KEY                LENS_VLLM_BASE_URL
```

**Everything else goes in `lens.env`** — see `lens.env.example` in the Lens checkout for the ones
worth setting (mint caps, `LENS_EMBEDDING_MODEL`, the reservation and settlement toggles).

For any variable not on either list, this decides it mechanically:

```sh
grep -qE "^\s+- ${VAR}(=|$)" docker-compose.yaml && echo ".env" || echo "lens.env"
```

#### Create the files

```sh
# On the Lens box, in the talyvor-lens checkout, NEXT TO docker-compose.yaml.
# CURATED — these belong in .env:
grep -q '^LENS_PROVISION_SECRET=' .env || echo "LENS_PROVISION_SECRET=$PROVISION_SECRET" >> .env
grep -q '^LENS_CACHE_POOLABLE_ENABLED=' .env || echo "LENS_CACHE_POOLABLE_ENABLED=true" >> .env
grep -q '^LENS_ECONOMY_ENABLED=' .env || echo "LENS_ECONOMY_ENABLED=true" >> .env
grep -q '^LENS_POOL_ROYALTY_MINTING_ENABLED=' .env || echo "LENS_POOL_ROYALTY_MINTING_ENABLED=true" >> .env
grep -q '^LENS_POOL_ROYALTY_SHARE=' .env || echo "LENS_POOL_ROYALTY_SHARE=0.5" >> .env
chmod 600 .env

# LONG TAIL — these belong in lens.env. Optional; the file itself is optional too.
cat > lens.env <<'ENV'
# EARN GATE — leave UNSET for the comped trial (a vouch is enough to earn).
# Set true before OPEN SIGNUP, so earning requires a real completed purchase.
#LENS_EARN_REQUIRE_LIVE_PURCHASE=true
ENV
chmod 600 lens.env
```

> `LENS_SHADOW_MINTS_ENABLED` is **curated**, so it goes in `.env` — and do NOT set it yet; see step 6d
> for its precondition.

#### ⚠ Verify against the PROCESS, and make the check able to FAIL

```sh
docker compose up -d lens && sleep 5
# 1. The curated secret arrived:
docker compose exec -T lens printenv LENS_PROVISION_SECRET | wc -c   # expect >1
# 2. ⚠ POSITIVE CONTROL — a variable you did NOT set must be absent. If this also prints a value,
#    you are reading a stale container and check 1 proves nothing.
docker compose exec -T lens printenv LENS_NOT_A_REAL_VAR || echo "correctly absent"
```

⚠ Note that the old verify step could not detect the trap it was next to: it read
`LENS_PROVISION_SECRET`, which step 2b *also* appends to `.env`. So the `.env` copy satisfied the check
while the `lens.env` line sat inert — a green that proved the wrong thing.

### 2b. Deploy

```sh
# On the Lens box, in the talyvor-lens checkout:
git fetch origin && git checkout main && git pull --ff-only
grep -q '^LENS_PROVISION_SECRET=' .env || echo "LENS_PROVISION_SECRET=$PROVISION_SECRET" >> .env
docker compose pull
docker compose run --rm migrate       # one-shot; `restart: "no"`, NOT run on boot
docker compose up -d
```

There is **no compose profile** on the migrate service (verified: no `profiles:`
key anywhere in the file) — it is an ordinary service with `restart: "no"`, so
`run --rm migrate` is the invocation and `up -d` will also start it once. Run it
explicitly first so a migration failure stops you here rather than surfacing as a
half-started stack.

⚠ **Expect cross-tenant pooling to be OFF at this point, even with the flag set.** The
gateway holds it off until `lens poolcheck` has recorded a pool-safety attestation for
this database, which happens at STEP 6b — it cannot happen here, because `poolcheck`
runs *inside* the container this step is starting. The boot log says so explicitly:

```
POOLING FORCED OFF: cross-tenant cache pooling is enabled in config but is NOT currently justified
  reason: no pool-safety attestation has ever been recorded for this database ...
```

That is the correct state, not a fault. STEP 6b clears it **without a restart**.

**Verify the secret actually reached the process** — not just the file:
```sh
docker compose exec -T lens printenv LENS_PROVISION_SECRET | sha256sum | cut -c1-16
# expect: the same 16 chars as the BFF side in step 4. Empty output = not plumbed.
```

**Verify — migrations match the checkout.** Derived, never hardcoded: a number
written here goes stale the next time a migration lands, and then this step fails
for the wrong reason. (It was pinned at 107; main is at 109 today.)
```sh
want=$(ls migrations/*.sql | wc -l | tr -d ' ')
got=$(docker compose exec -T postgres psql -U lens -d talyvor_lens -tAc \
  'SELECT count(*) FROM schema_migrations' | tr -d ' ')
echo "lens schema_migrations: got=$got want=$want"; [ "$got" = "$want" ] && echo OK || echo MISMATCH
# expect: OK.  MISMATCH ⇒ the migrate service did not run or failed — stop,
# read `docker compose logs migrate`, do not start the BFF.
```

**Verify — the provisioning route EXISTS** (this is the fail-closed one):
```sh
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<lens-host>/v1/provision \
  -H 'Content-Type: application/json' -d '{}'
# expect: 401   ← route registered, secret required, empty body refused BEFORE parsing
# 404         ← LENS_PROVISION_SECRET is unset on Lens. Every login will fail. FIX BEFORE CONTINUING.
```
`401` is the success signal here, not an error. It proves the route is mounted
and the gate is in front of it. `404` is the failure — and it is silent from the
browser's point of view, which is why it is checked here explicitly.

**Verify — the binary is the commit you think:**
```sh
docker compose exec -T lens /lens --version 2>/dev/null || \
  docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
    $(docker compose ps -q lens)
# expect: the same SHA STEP 0 reported for lens
```

---

## STEP 3 — Track and Docs

**README's "Deploying Track and Docs" section is still correct** — follow it for
the databases, the compose fragment and the secret-digest comparison. Two things
to hold in mind while you do:

- **Track migrates by subcommand** (`cmd/track/main.go:132`): the
  `track-migrate` one-shot service in the compose fragment is what applies its
  schema. Its verify step (README: "expect a number > 0") is not optional — a
  Track that boots against an empty schema 500s on every call.
- **Docs migrates itself on boot** (`cmd/docs/main.go:162`), fail-closed and
  advisory-locked, so a re-run is a no-op and there is no separate step. A
  migration failure is a boot failure; you will see it in `docker compose logs
  docs`, not in a silent 500 later.

**Then do 3a. README does not cover it** — it names the requirement ("a trial
user must also be a **member**") and its troubleshooting table says `403` → "add
the membership", but no step anywhere says how, because until now there was no
mechanism.

### ⚠ 3a. Seed the first Docs membership. WITHOUT THIS, DOCS 403s EVERY TESTER.

**Docs cannot bootstrap its own tenancy.** Membership comes only from Track's
roster sync, and that sync enumerates *the workspaces Docs already holds content
for* (`SELECT workspace_id FROM spaces UNION SELECT workspace_id FROM pages`,
`internal/membership/store.go`). A brand-new Docs database holds no content, so
nothing is enumerated, so no roster is pulled, so nobody is a member, so
`space.Create` 403s before its insert — and the space that would have made the
workspace enumerable can never be created. **Content is needed to get a roster,
and a roster to create content.** The parked decision and the fix shape are
recorded on `DistinctWorkspaceIDs` in talyvor-docs (#45).

The seed breaks the cycle. Run it after Docs' first boot (it migrates on boot, so
the table exists), **one row per tester**. Same `docker compose exec postgres`
route as every other database step here — no host `psql` needed:

```sh
# From the compose .env, which is what the docs container reads (the fragment maps
# DOCS_DEFAULT_WORKSPACE: ${DOCS_WORKSPACE_ID:-default}). It must ALSO equal the
# BFF's own DOCS_WORKSPACE_ID in /etc/talyvor/bff.env — that is a separate file and
# a separate copy, and a mismatch is a 404 on every Docs route, not a 403.
WS=$(grep -oP '(?<=^DOCS_WORKSPACE_ID=).*' .env 2>/dev/null || echo default)
echo "seeding workspace: $WS"      # sanity-check this before continuing
sudo grep -oP '(?<=^DOCS_WORKSPACE_ID=).*' /etc/talyvor/bff.env   # must print the same

docker compose exec -T postgres psql -U lens -d talyvor_docs -c \
  "INSERT INTO workspace_members (workspace_id, email, role, member_id, source)
   VALUES ('$WS', 'tester@example.com', 'admin', 'seed-tester@example.com', 'seed')
   ON CONFLICT (workspace_id, email) DO NOTHING;"
```

#### Verify by FORCING the reconcile, not by waiting for it

**Confirming the rows exist immediately after the `INSERT` proves nothing — they
always do.** The check has to survive a sync, and the sync is what deletes a
wrongly-marked row. Docs runs a boot pass before its 15-minute ticker
(`cmd/docs/main.go:224`), so a restart forces the first reconcile now instead of
leaving you to discover the result a quarter of an hour after you have moved on:

```sh
docker compose restart docs && sleep 30

docker compose exec -T postgres psql -U lens -d talyvor_docs -tAc \
  "SELECT email, role, source FROM workspace_members WHERE workspace_id = '$WS';"
# expect: every tester you seeded, each with source = seed.
# ⚠ ZERO ROWS means source was omitted (defaulted to 'track') and the reconcile
#   deleted them. Re-run the INSERT with source = 'seed', then repeat this check.
```

#### ⚠⚠ THE FAILURE MODE — omitting `source` looks fine and reverts ~15 minutes later

`source` **defaults to `'track'`**, so a seed written without that column is
marked as Track's own row. The roster prune is
`WHERE workspace_id = $1 AND source = 'track' AND email <> ALL($2)` — it deletes
`track`-owned rows that Track's roster does not contain, and Track has never
heard of your testers.

So the naive seed **works**: the tester creates a space, everything looks correct,
you move on. Then the first reconcile runs and deletes the row, and every tester
is back to `403` with nothing in the deploy log to connect the two events. This
was tested both ways against a real empty database:

| Seed | First create | After the first reconcile |
|---|---|---|
| `source = 'seed'` | `201` | survives — still `201` |
| `source` omitted (defaults `'track'`) | `201` | **pruned** → back to `403` |

**Always write `source` explicitly.** If a row vanishes, that is what happened —
re-insert it with `'seed'`.

#### The workspace id does NOT need to exist in Track

Track is per-session now, so there is no shared Track workspace to point at, and
you do not need one. `DOCS_WORKSPACE_ID` is just the id the BFF asks for; Docs
authorizes it against the caller's memberships, which the seed supplies. All
three things Track can answer were tested, and the seed survives every one: **404**
(no such workspace — the pull errors, the syncer skips that workspace and leaves
the roster untouched), **200 with an empty roster** (empty-pull safety no-ops),
and **200 with a roster that does not contain the tester** (the prune skips rows
that are not `source = 'track'`). Seeding also does not block the sync: a seeded
row and a Track-owned row coexist in the same workspace.

#### ⚠ What you do for each new tester: one row, by hand, every time

**There is no self-service path.** Membership is keyed on the verified email, and
nothing creates a row except this `INSERT` and Track's sync. A tester who signs in
before you have seeded them gets `403` from Docs — the rest of the suite works.

So the standing operational cost is: **run one `INSERT` per person, before their
first visit, for as long as Docs is pinned.** Seed the batch you know about now
rather than one at a time:

This block is self-contained on purpose — you will be running it in a fresh shell
weeks from now, from the compose project directory:

```sh
WS=$(grep -oP '(?<=^DOCS_WORKSPACE_ID=).*' .env 2>/dev/null || echo default)

for e in alice@example.com bob@example.com carol@example.com; do
  docker compose exec -T postgres psql -U lens -d talyvor_docs -c \
    "INSERT INTO workspace_members (workspace_id, email, role, member_id, source)
     VALUES ('$WS', '$e', 'admin', 'seed-$e', 'seed')
     ON CONFLICT (workspace_id, email) DO NOTHING;"
done

# Confirm — and confirm the source, because that is the column that bites:
docker compose exec -T postgres psql -U lens -d talyvor_docs -c \
  "SELECT email, source FROM workspace_members WHERE workspace_id = '$WS' ORDER BY email;"
```

This ends when the enumeration is inverted to ask Track which workspaces exist
(the recorded fix), not before. Until then it is a manual step that will be
forgotten at least once — the symptom is a single tester getting `403` from Docs
while everyone else is fine, which is this and nothing else.

Notes on the values: `role` is stored and resolved but **never decides anything**
in Docs today, so `'admin'` is a safe placeholder rather than a grant. `member_id`
is free-form — Docs owns no members table, and this value only needs to be stable
and distinct.

---

## STEP 4 — the BFF environment. ⚠ THIS STEP IS ONE-WAY.

**Read this before editing the file.**

Once you remove `LENS_WORKSPACE_KEY` and `LENS_WORKSPACE_ID` and add
`LENS_PROVISION_SECRET`, **the previous BFF binary will no longer start** — it
requires the two variables you just deleted (old `main.go:89,92`). And the new
binary will not start while the old variables are the only ones present.

There is no environment file that satisfies both binaries at once, because the
new one *also* refuses to boot if `LENS_API_KEY` is set and the old one has no
opinion about it. So:

> **The env edit and the binary swap are a single atomic step.** Keep a copy of
> the old file (`sudo cp /etc/talyvor/bff.env /etc/talyvor/bff.env.pre-signup`)
> — rolling the BFF back means restoring **both** the old binary and that file,
> together. See the rollback matrix.

Edit `/etc/talyvor/bff.env`:

```diff
- LENS_WORKSPACE_KEY=tlv_ws_…
- LENS_WORKSPACE_ID=default
+ LENS_PROVISION_SECRET=<the PROVISION_SECRET from step 1 — same value Lens has>
```

**Verify — the two sides match** (compares digests, never prints a secret):
```sh
a=$(sudo grep -oP '(?<=^LENS_PROVISION_SECRET=).*' /etc/talyvor/bff.env | sha256sum | cut -c1-16)
b=$(ssh <lens-box> "grep -oP '(?<=^LENS_PROVISION_SECRET=).*' /path/to/lens/.env" | sha256sum | cut -c1-16)
[ "$a" = "$b" ] && echo "PROVISION: MATCH" || echo "PROVISION: MISMATCH — logins will fail"
# expect: PROVISION: MATCH
```

**Verify — `LENS_API_KEY` is absent:**
```sh
sudo grep -c '^LENS_API_KEY=' /etc/talyvor/bff.env
# expect exactly: 0    (any other number = the BFF will refuse to boot)
```

---

## STEP 5 — ship the BFF and preflight it

Build and ship per README §2 and §3b (unchanged). Then use README §5's preflight
boot — it is the step that catches an env mistake **before** systemd and Caddy
are involved, and it is more valuable now than it was, because three of the
failure modes above are boot refusals with named causes.

**Verify — preflight names no missing variable:**
```sh
sudo -u talyvor env $(sudo cat /etc/talyvor/bff.env | grep -v '^#' | xargs) \
  /opt/talyvor/bin/bff 2>&1 | head -5
# expect: a listening line, NOT "LENS_PROVISION_SECRET is required" and
#         NOT "LENS_API_KEY must not be set on the BFF"
```

Then `systemctl restart talyvor-bff` per README §6.

---

## STEP 6 — verification. ⚠ YOUR EXISTING CANARY NO LONGER PROVES WHAT IT DID.

### The decision you asked for: `default`, and the key `tlv_ws_27f4…`

**The key still works. The canary that uses it no longer verifies the suite.**
Both halves matter, and they were verified from source rather than reasoned about:

- **Against Lens directly — unchanged.** Nothing in the signup work touched
  Lens's key validation: `ValidateAPIKey` still resolves a `tlv_` key to its own
  workspace row (`internal/auth/manager.go:283-289`), no migration in 0104–0107
  touches `api_keys`, and `default` is still registered unconditionally at every
  Lens boot (`cmd/lens/main.go:349`). Your key authenticates, resolves to
  `default`, and its balance and ledger are exactly where you left them.
- **Through the BFF — it is not used at all any more.** The BFF no longer holds
  a configured workspace key; every BFF→Lens request now carries the *signed-in
  person's* session JWT. So a request through the suite lands in **that person's
  own workspace**, never in `default`.

So the old canary — "hit the app, watch `default`'s ledger move" — now proves
nothing about the suite: the suite never touches `default`. Worse, it would look
like a *pass* while per-user provisioning was completely broken.

**Split the verification in two.** Each proves a different thing, and you need
both:

**6a. Lens is alive and settling money** — unchanged, keep using your key:
```sh
curl -s https://<lens-host>/v1/messages \
  -H "Authorization: Bearer tlv_ws_27f4…" -H 'Content-Type: application/json' \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":16,
       "messages":[{"role":"user","content":"deploy canary"}]}' -o /dev/null -w '%{http_code}\n'
# expect: 200

docker compose exec -T postgres psql -U lens -d lens -tAc \
  "SELECT status FROM lxc_reservations ORDER BY created_at DESC LIMIT 1"
# expect: settled     ← the go/no-go. 'held' or no row means the money path is broken.
```

⚠ **6a ALONE IS NOT A PASS, and this is proven rather than cautionary.** The BFF no
longer touches `default` at all — every request carries the signed-in person's own
token. So 6a can be fully green while provisioning is completely broken: it exercises
Lens directly with your own key and never goes near the code path the suite uses.
**Treat 6a and 6b as one gate; neither result means anything without the other.**

```sh
# The combined gate. Both halves, one verdict — so a green 6a cannot be mistaken
# for a deploy that works.
LENS_OK=$(docker compose exec -T postgres psql -U lens -d talyvor_lens -tAc \
  "SELECT status FROM lxc_reservations ORDER BY created_at DESC LIMIT 1" | tr -d ' ')
WS_N=$(docker compose exec -T postgres psql -U lens -d talyvor_lens -tAc \
  "SELECT count(*) FROM workspaces WHERE id LIKE 'u%'" | tr -d ' ')
echo "lens settles: $LENS_OK    derived workspaces: $WS_N"
[ "$LENS_OK" = "settled" ] && [ "$WS_N" -ge 1 ] && echo "DEPLOY OK" || echo "NOT OK — do not proceed"
# expect: DEPLOY OK.  'settled' with 0 workspaces = Lens is fine and signup is broken.
```

**6b. Per-user provisioning works** — this is the new one, and it is the one
that proves the *suite* deploy:
```sh
# Sign in at https://app.talyvor.com as a trial user, then:
curl -s https://app.talyvor.com/auth/me -b <your session cookie> | jq .
# expect: "authenticated": true
#         "workspace_id": "u…"        ← a DERIVED id, 27 chars, starts with u
#         NOT "default", NOT empty
```
```sh
# And on the Lens box — the workspace really exists, and it is not 'default':
docker compose exec -T postgres psql -U lens -d lens -tAc \
  "SELECT id, cache_poolable FROM workspaces WHERE id LIKE 'u%' ORDER BY created_at DESC LIMIT 3"
# expect: one row per person who has signed in, each id starting 'u',
#         cache_poolable = f   ← created DECLINED; consent is opt-in
```

**Two people, two workspaces** — the property the whole change exists for:
```sh
docker compose exec -T postgres psql -U lens -d lens -tAc \
  "SELECT count(DISTINCT id) FROM workspaces WHERE id LIKE 'u%'"
# expect: equal to the number of distinct people who have signed in.
#         1 when two people have signed in = provisioning is collapsing them. STOP.
```

---

## STEP 6b — `lens poolcheck`, before you open the pooling gate

⚠ **Run this on the Lens box after deploy, and after ANY change to
`LENS_EMBEDDING_MODEL` or `LENS_SEMANTIC_THRESHOLD`.**

Cross-tenant pooling serves one workspace's cached answer to another when two prompts
are similar enough. `poolcheck` embeds a corpus of *"same fixed preamble, unrelated
content"* prompts through **the configured embedder** and exits non-zero if any
unrelated pair reaches `LENS_SEMANTIC_THRESHOLD` — i.e. if this configuration could
serve one company's response to another.

```sh
docker compose exec -T lens /lens poolcheck
# prints: embedding model / threshold / pooling enabled, then per-pair scores
# exit 0 = margin holds.  exit 1 = "pool-safety check FAILED: unrelated prompts reach
#                                   the pooling threshold" — DO NOT open gate 1.
```

### ⚠ What running it actually changes — and why no restart is needed

On success `poolcheck` **records an attestation**: a row naming the embedding model and
threshold it just measured safe. The gateway re-reads that row **every 30 seconds** and
opens or closes cross-tenant pooling to match. So:

```
STEP 2b  docker compose up -d      → no attestation yet → pooling FORCED OFF
STEP 6b  lens poolcheck            → passes, records the attestation
         ...within ~30s            → "POOLING ENABLED" in the gateway log. No restart.
```

⚠ **Do not restart the gateway to "apply" it.** You do not need to, and a restart here
buys nothing: the gateway is already watching. Wait for the log line below, or check
gate 1b in STEP 6c.

**Confirm it actually opened** — the gateway log is the authority:

```sh
docker compose logs lens --since 2m | grep -E 'POOLING (ENABLED|FORCED OFF)' | tail -1
# want: POOLING ENABLED: the live embedding configuration matches the last passing poolcheck
```

If it still says `FORCED OFF` after 30 seconds, the `reason` field on that line names the
cause exactly — a model or threshold that does not match what was attested, or a database
the gateway cannot read. It is never a bare "off".

⚠ **The attestation is bound to the configuration — but only the DATABASE side is re-read.**
The refresh compares the attested row against the model and threshold **this process booted
with**. Those come from the environment and cannot change while it runs (there is no config
reload in Lens), so:

- **Editing `LENS_EMBEDDING_MODEL` or `LENS_SEMANTIC_THRESHOLD` changes nothing until the
  gateway restarts.** Do not expect the 30-second refresh to notice an env edit — it is not
  watching the environment, and reading it as a live guard on config changes is the one
  wrong conclusion to draw from this section. On the next restart the comparison runs
  against the new values and pooling closes then, naming what changed.
- **What the refresh does catch on its own** is the row moving underneath a running
  gateway — `poolcheck` re-run with a different configuration, or against a restored
  database. That is the shared-mutable-state case, and it is why re-reading exists.

Direction matters and is deliberate: **lowering** the threshold voids the attestation
(it widens what counts as a match beyond what was measured), while **raising** it does
**not** — a stricter setting is already covered by a measurement that passed at a looser
one, and forcing pooling off on the conservative change would be a false alarm
(`internal/poolsafety/attestation.go`, `MatchesLive`).

**Why it is a deploy step and not a CI gate:** it costs real embedding calls and needs
a live `LENS_OPENAI_API_KEY`, and a gateway restart is the wrong moment to discover a
config problem *and* pay for it on every replica.

**Why it is not optional:** the margin depends on which embedder is configured. On the
real model, unrelated pairs score **0.6534** against a **0.92** threshold — a 0.27
margin. An earlier 0.985 alarm came from a local stand-in with a compressed range and
is not real. But `text-embedding-ada-002` scores **0.81**, which eats more than half
the margin — so the safety of this depends on a variable someone can change without
touching any code. This is the only thing standing between "today's model happens to be
safe" and "we would notice if it stopped being".

---

## STEP 6c — the three pooling gates, in one query

⚠ **Cross-tenant pooling has THREE gates and all three must be satisfied before a
single royalty can mint.** Setting one is the natural thing to do and is not
enough; gate 1 is now self-reporting (below) but gates 2 and 3 are not. Run the royalty
test with one still closed and you see no mint, with no way to tell *not implemented*
from *not switched on*. Check all three at once, before you conclude anything.

| # | Gate | Where it lives | Shut by default? |
|---|---|---|---|
| 1 | `LENS_CACHE_POOLABLE_ENABLED` **AND** a current pool-safety attestation | Lens process env (see STEP 2a) **and** the `pool_safety_attestation` row written by STEP 6b | **yes**, both halves |
| 2 | `workspaces.cache_poolable` | per workspace, in the Lens database | no — new workspaces are created ON |
| 3 | `earn_verified` **on both sides** | derived: an admin vouch **or** a completed `lxc_purchases` row | **yes** for a comped trial |

Gate 3 is the one that surprises: it is not a flag you set, it is
`earn_verified = true` **OR** a completed real-money purchase
(`internal/earnverify/verify.go`). A comped trial user satisfies neither, so a
trial with no payments mints nothing **even with gates 1 and 2 open** — by
design, it is the Sybil floor.

```sh
# On the Lens box. Prints all three gates for the pair you are testing.
# Replace the two ids with the contributor and requester workspaces.
CONTRIB=u...   # whose cached answer is reused
REQUESTER=u... # who reuses it

echo "GATE 1a (global flag, as the PROCESS sees it — not as .env claims):"
docker compose exec -T lens printenv LENS_CACHE_POOLABLE_ENABLED || echo "  <empty>  ⇒ SHUT"

echo "GATE 1b (pool-safety attestation — the flag alone is NOT enough):"
docker compose exec -T postgres psql -U lens -d talyvor_lens -tAc "
SELECT embedding_model, threshold, worst_score, checked_at
FROM pool_safety_attestation;"
# empty  ⇒ SHUT: poolcheck has never passed here. Run STEP 6b.
# a row  ⇒ it must MATCH the live config, or the gateway still holds pooling off:
docker compose exec -T lens printenv LENS_EMBEDDING_MODEL LENS_SEMANTIC_THRESHOLD

echo "GATE 1b, the authoritative read — what the PROCESS decided:"
docker compose logs lens --since 10m | grep -E 'POOLING (ENABLED|FORCED OFF)' | tail -1
# want: POOLING ENABLED: ...
# FORCED OFF carries a "reason" naming the cause exactly. It is never a bare "off".

echo "GATE 2+3 (per workspace):"
docker compose exec -T postgres psql -U lens -d talyvor_lens -tAc "
SELECT w.id,
       w.cache_poolable                                   AS gate2_poolable,
       (w.earn_verified
        OR EXISTS (SELECT 1 FROM lxc_purchases p
                   WHERE p.workspace_id = w.id
                     AND p.status = 'completed' AND p.lxc_amount > 0)) AS gate3_may_earn
FROM workspaces w WHERE w.id IN ('$CONTRIB','$REQUESTER');"
```

**Expect, for a royalty to be able to fire:**

```
GATE 1: true
GATE 2+3:
  u<contributor>|t|t
  u<requester>  |t|t
```

Read it as: **any `f`, or an empty gate 1, and no royalty will mint** — and that
is a configuration state, not a bug. Specifically:

- **gate 1a empty** → the flag never reached the process. Check STEP 2a: it must be
  in the lens service's `environment:`, not only in `.env`. `printenv` above is the
  authority; the file is not.
- **gate 1b `POOLING FORCED OFF`** → the flag reached the process and the process is not
  honouring it, because the live embedding configuration is not the one that passed
  `poolcheck`. The `reason` on that log line names the cause. Re-run STEP 6b; pooling
  reopens within 30 seconds with no restart. ⚠ Note that `printenv` says `true` in this
  state — the env var is set and ineffective, which is exactly why gate 1a alone is not
  an answer.

  If you have the admin key, `GET /v1/admin/economy/flags` reports the same thing in one
  place: `CachePoolableEnabled` comes back with `"state":"forced_off_at_runtime"`, the
  configured value it is overriding, and a `note` carrying the reason. That endpoint is
  admin-gated and this runbook never establishes an admin key, so the log above is the
  check to use here.
- **gate 2 `f`** → that workspace declined at signup, or was set off by hand. It is
  consent; do not flip it in SQL on a customer's behalf.
- **gate 3 `f`** → no payment and no vouch. On a comped trial this is expected and
  correct. To exercise the royalty path deliberately, use the admin vouch
  (`earn_verified`) rather than faking a purchase row — a fabricated
  `lxc_purchases` row is money that was never collected.

> **Do not conclude "royalties are broken" until this query shows `true / t / t`
> on both sides.** Setting `default`'s `cache_poolable` by hand satisfies gate 2
> for one workspace and nothing else — it is one of three, and the other two are
> shut by default.

---

## STEP 6d — shadow mints. ⚠ PRECONDITION: the notice must already be SERVING.

`LENS_SHADOW_MINTS_ENABLED` records what six unproven earning mechanisms *would*
have paid, without crediting it. Turning it on while testers have not been told is
running unpaid contribution without having said so.

**The precondition is not "the suite is deployed", it is "the bundle being served
contains the notice".** A built-but-not-shipped bundle passes the first and fails
the second.

### The check — a version comparison, with the content grep as fallback

Suite `619e27a` (#39) stamps the commit into every bundle, so this is now a version
question rather than a content probe. **Both checks are here on purpose** — see the
transition note below for which one applies to you.

**1. What commit is the SERVED bundle?**

```sh
# On the app host. Either works; the first also reports the BFF for comparison.
curl -s http://127.0.0.1:8787/api/version | jq -r '.bundle.commit // "UNSTAMPED"'
jq -r '.commit // "UNSTAMPED"' /opt/talyvor/web-dist/version.json
```

⚠ **Read `.bundle.commit`, NOT `.commit`.** `.commit` is the **BFF's** version and says
nothing about whether a web copy is serving. The two are shipped by separate commands
and can differ; only the bundle's commit answers "can a tester see this?". Reading the
wrong field passes this precondition on the strength of a *backend* deploy.

**2. Is the notice in that commit?** Ancestry, in a checkout of `talyvor-suite`:

```sh
NOTICE=b41ea4d          # the commit that added the tester notice (#34)
DEPLOYED=$(curl -s http://127.0.0.1:8787/api/version | jq -r '.bundle.commit')
git merge-base --is-ancestor "$NOTICE" "${DEPLOYED%-dirty}" \
  && echo "notice IS in the served bundle" \
  || echo "notice is NOT — do not set LENS_SHADOW_MINTS_ENABLED"
```

Controlled both ways before being written here: `f010599` (the commit immediately
before the notice) reports **ABSENT**; `b41ea4d` and everything after report PRESENT.
`${DEPLOYED%-dirty}` strips the marker a workstation build adds when its tree had
uncommitted changes — if you see `-dirty`, the deployed bundle does not correspond to
any pushed commit and the ancestry answer is approximate.

Why this beats the grep: it generalises to every future precondition instead of needing
a new string each time, it survives a copy reword, and it cannot pass because the string
happens to appear somewhere unrelated.

### ⚠ THE TRANSITION — the grep stays for now

**`version.json` exists only in bundles built from #39 onward, so the first
script-built bundle is the one being deployed tonight.** Until one is actually serving,
the version check has nothing to read and reports `UNSTAMPED` / `readable: false`.

- **Bundle predates #39** (or the check says `UNSTAMPED`) → use the grep below. It is
  the only check available.
- **Bundle built with `scripts/build-release.sh`** → use the version comparison above,
  and `.bundle.commit` also answers "did my deploy land?" in the same request.

Do not delete the grep in the same change that adds the version check.

```sh
# FALLBACK. On the app host. Greps the bundle that is actually being served.
grep -l 'Not every kind of contribution earns LENS' /opt/talyvor/web-dist/assets/*.js
# expect: one filename.  NO OUTPUT ⇒ the served bundle predates the notice —
# DO NOT set LENS_SHADOW_MINTS_ENABLED. Ship the web bundle first.
```
*(Verified against a real `pnpm build` of suite `2d239d7`: the string survives
minification and appears exactly once.)*

### ⚠ DO NOT VERIFY THIS WITH A STATUS CODE — `curl -f` PASSES ON A BUNDLE WITH NO VERSION

`GET /version.json` on a bundle that predates #39 returns **HTTP 200 with HTML**, not a
404, because the BFF serves the SPA and falls back to `index.html` for any path that is
not a real file. Measured:

```
GET /version.json on a bundle with NO version.json → 200, content-type: text/html, body: <!doctype html>…
```

So `curl -f $APP/version.json` **succeeds against a bundle carrying no version at
all** — absence read as success, a green check sitting next to the exact condition it
was meant to detect. **Require the response to parse as JSON**, never the exit code:

```sh
curl -s http://127.0.0.1:8787/version.json | jq -e '.commit' >/dev/null \
  && echo "bundle reports a commit" \
  || echo "NO VERSION — pre-#39 bundle, or not the app you think. Use the grep."
```

This is a property of the app origin generally, not of `/version.json` — see
**Reading verification output** at the top of this document.

Only once one of the two checks above passes:
```sh
# add LENS_SHADOW_MINTS_ENABLED=true to lens.env, then
docker compose up -d lens
docker compose exec -T lens printenv LENS_SHADOW_MINTS_ENABLED   # expect: true
```

---

## STEP 7 — billing. ⚠ THE ORDER IS LOAD-BEARING.

Enabling billing *before* proving the webhook works charges a customer's card with
nothing recorded on our side: Stripe takes the money, the webhook fails, and no LXC
is credited. The sequence below never has money in flight before the recording path
is proven.

**1. Put all five values in `lens.env` with billing still OFF:**
```sh
LENS_STRIPE_SECRET_KEY=sk_live_...
LENS_STRIPE_WEBHOOK_SECRET=whsec_...
LENS_BILLING_SUCCESS_URL=https://app.talyvor.com/billing/success?session_id={CHECKOUT_SESSION_ID}
LENS_BILLING_CANCEL_URL=https://app.talyvor.com/billing/cancel
LENS_BILLING_ENABLED=false        # ← still false
```

**2. Restart, and confirm billing is genuinely off:**
```sh
docker compose up -d lens
curl -s -o /dev/null -w '%{http_code}\n' https://<lens-host>/v1/billing/webhook -X POST -d '{}'
# expect: 400  ← the route is registered and refused an unsigned body.
# 404 ⇒ the webhook route is NOT mounted; fix that before going further.
```

**3. Prove the webhook records, using Stripe's own replay — still with billing off:**
```sh
stripe trigger checkout.session.completed --forward-to https://<lens-host>/v1/billing/webhook
# expect: 200 from the endpoint, and:
docker compose exec -T postgres psql -U lens -d talyvor_lens -tAc \
  "SELECT count(*) FROM lxc_purchases WHERE status='completed'"
# expect: a number that INCREASED by 1. Unchanged ⇒ the signature or the handler is
# wrong — stop here, with no real card involved.
```

**4. Only now enable:**
```sh
# LENS_BILLING_ENABLED=true in lens.env
docker compose up -d lens
docker compose exec -T lens printenv LENS_BILLING_ENABLED   # expect: true
```

---

## ⚠ Steps that cannot be fully verified — and what to watch instead

Five steps were named as reading like verification without being it. Four are now
fixed; the fifth cannot be fixed on a single box, and says so.

| Step | Was | Now |
|---|---|---|
| `docker compose ps` everywhere | A green status read as a deploy verdict | **Fixed by statement, once**, at the top: *status is not capability*. Every capability has its own exercising check. |
| Secret matching | Mismatch surfaced as a 401/404 three steps later | **Fixed**: STEP 1 compares all three digests at the moment you set them, before any service starts. |
| Lens canary alone | Passed while provisioning was broken | **Fixed**: 6a and 6b are one combined gate printing a single `DEPLOY OK`; `settled` with zero derived workspaces now reads as NOT OK. |
| Caddy front door | Proved the door serves, not *which* binary is behind it | **Fixed** below. |
| Track/Docs delegation | Two documents that can drift | **Partly fixed** below — and the residue is stated. |

### Which binary is behind Caddy — fixed

The `curl` checks in README §7 prove the front door serves. They do not prove the BFF
behind it is the build you just shipped; a failed `scp` or a `systemctl` that never
restarted leaves the old binary answering, healthily.

```sh
# On your workstation, after STEP 5 recorded the checksum:
LOCAL=$(shasum -a 256 bff-linux-amd64 | cut -d' ' -f1)
REMOTE=$(ssh <app-box> 'shasum -a 256 /opt/talyvor/bin/bff' | cut -d' ' -f1)
RUNNING=$(ssh <app-box> 'shasum -a 256 /proc/$(pgrep -f /opt/talyvor/bin/bff | head -1)/exe' | cut -d' ' -f1)
echo "built  =$LOCAL"; echo "on disk=$REMOTE"; echo "RUNNING=$RUNNING"
# expect: all three IDENTICAL.
# on-disk matches but RUNNING differs ⇒ the file was replaced and the service never
# restarted — the exact case a healthy front door hides.
```

`/proc/<pid>/exe` is the authority: it is the image the kernel actually loaded, so it
cannot be fooled by a file that was copied over after the process started.

### Track/Docs delegation — partly fixed, residue stated

README's Track/Docs section is now the **single authority** for their mechanics, and
its migration checks are count-derived rather than "> 0". STEP 3 here no longer
restates any check — it points, so there is one place to change.

**What is not fixed:** two files can still disagree in *prose*. Nothing enforces that
STEP 3's summary stays true to README. **What to watch:** if the two ever conflict,
README wins for Track/Docs mechanics, and this line is your tie-breaker. A test could
enforce it, but a test that greps documentation for agreement is the kind of guard
that passes on its own comment — see `cmd/lens/compose_env_reach_test.go` in
talyvor-lens for how that failed in practice.

### Genuinely unverifiable on one box

- **Certificate renewal.** Caddy auto-renews from its `caddy_data` volume. Nothing in
  a deploy proves a renewal 60 days out will succeed. **Watch instead:**
  `curl -sI https://app.talyvor.com | grep -i strict-transport` today, and set a
  calendar reminder to re-check before expiry. There is no deploy-time check for a
  future event, and pretending otherwise would be the failure this document is about.
- **The IdP staying reachable.** Google is in the login path. A deploy-time login proves
  today. **Watch instead:** the BFF logs `bff: session created for sub=…` on every
  success; its absence over a period is the signal.

---

## ⚠ EXPECTED NOISE — read this BEFORE you read the logs

Whoever opens the logs first will find these and reasonably conclude the deploy is
broken. Most of them are not. This section exists so a known-harmless line does not
trigger the rollback of a working deploy — **and so that anything NOT listed here is
treated as real.** A warning that repeats forever and means nothing is how people
learn to stop reading logs, and the next warning will be a real one.

**One row below is deliberately not harmless.** A regression can wear the same shape
as expected noise, so the table says which is which rather than implying that
everything listed is safe.

| What you will see | Where | Harmless? | Why |
|---|---|---|---|
| `member sync — pull failed, skipping workspace`, **every 15 minutes, forever** | `docker compose logs docs` | **Yes** | The Docs workspace id has no Track counterpart — Track is per-session since #36 — so Track answers `404` and the syncer skips that workspace. Detail below; it is also what protects your seeded rows. |
| `member sync — workspace reconciled` at INFO | `docker compose logs docs` | **Yes, but read `pruned`** | Normal sync output. `pruned` should be `0` for your seeded workspace — detail below. |
| `environment hygiene: this container holds CREDENTIAL-SHAPED variables that are not Lens's` (ERROR), naming e.g. `TRACK_GATEWAY_AUTH_SECRET` / `DOCS_GATEWAY_AUTH_SECRET` | `docker compose logs lens` | **NO — fix it** | Lens is being handed another service's secrets. It means `env_file:` is forwarding the project `.env` instead of `lens.env`, i.e. the leak lens#377/#378 closed has returned. A Lens crash dump would carry Track's and Docs's gateway secrets. Fires only when the unexpected variable name ends in `SECRET`/`KEY`/`TOKEN`/`PASSWORD`/`CREDENTIALS` (`cmd/lens/env_hygiene.go:98`). |
| `modelwatch: NO ALERT SINK CONFIGURED` (ERROR) at Lens boot | `docker compose logs lens` | **Yes** | `LENS_OPERATOR_ALERT_WEBHOOK_URL` is unset, which is currently correct — nothing accepts that payload yet. Logged at ERROR deliberately so the gap stays visible (`internal/modelwatch/modelwatch.go:197`). Expect it once per boot. |
| Lens WARN: *"the embedding model has been changed while cross-tenant pooling is ENABLED … Run `lens poolcheck`"* | `docker compose logs lens` | **Only if you meant it** | Fires only when `LENS_EMBEDDING_MODEL` differs from the default **and** pooling is on (`cmd/lens/env_hygiene.go:127`). It does not judge the model and does not block boot — but the cross-tenant margin is a property of the embedder, so run `lens poolcheck` before trusting it. If you did not change the model, something else did. |

The two Docs lines are the ones this deploy introduces, so they get the detail:

### `docs` — member sync warns every 15 minutes, forever

```json
{"level":"WARN","msg":"trackintegration: member sync — pull failed, skipping workspace",
 "workspace_id":"<DOCS_WORKSPACE_ID>",
 "err":"trackintegration: member pull for <DOCS_WORKSPACE_ID>: 404 Not Found"}
```

**Expected, and permanent.** Docs asks Track for the roster of every workspace it
holds content for. Its pinned workspace has no counterpart in Track — Track is
per-session now (#36), so there is no shared Track workspace for it to match — and
Track answers `404`. The syncer treats a failed pull as *skip this workspace*, so
the existing roster is left intact rather than pruned. That is the branch you
want: it is also what protects your seeded rows.

It repeats on the 15-minute sync interval and at every restart, and it will not
stop until Docs is given a real Track workspace or the enumeration is inverted.

**What would NOT be noise, in the same line:** a `workspace_id` you do not
recognise (something enumerated that should not exist), or the same message with
a connection error rather than `404 Not Found` — that is Track being unreachable
from the Docs container, which *is* a deploy problem and also breaks
`/api/track/*`.

### `docs` — `member sync — workspace reconciled` at INFO

```json
{"level":"INFO","msg":"trackintegration: member sync — workspace reconciled",
 "workspace_id":"…","upserted":1,"pruned":1}
```

Normal. Worth one look though: **`pruned` should be `0` for your seeded
workspace.** A non-zero prune there means rows were written with `source =
'track'` and are being deleted — see step 3a's failure mode.

---

## Rollback matrix

| Step | Reversible? | How |
|---|---|---|
| STEP 0 image preflight | n/a | Nothing changed. |
| STEP 2 Lens image | **Yes** | `docker compose` pinned to the previous `:<sha>`, `up -d`. Verified safe: migrations 0104–0107 are all `ADD COLUMN` / `CREATE INDEX`, zero destructive statements, so the old binary runs against the new schema. |
| STEP 2 Lens **migrations** | **NO** | Forward-only; there are no down-migrations. This is fine *because* they are additive — but you cannot un-apply them. |
| STEP 3 Track image | **Yes** | Previous `:<sha>`. Verified: **0 destructive statements** across all Track migrations — I checked rather than assuming Lens's property transfers. |
| STEP 3 Docs image | **Yes** | Previous `:<sha>`. Verified: **0 destructive statements**. Note Docs migrates on boot, so an older image simply finds its schema already ahead — additive, so it runs. |
| STEP 3 Track/Docs **databases** | **NO** | Forward-only, as above. Dropping the databases is the only "undo" and it destroys data. |
| **STEP 4 BFF environment** | **⚠ ONE-WAY IN PRACTICE** | See below. |
| STEP 5 BFF binary | Yes, **only with step 4's file** | Restore `/opt/talyvor/bin/bff` *and* `/etc/talyvor/bff.env.pre-signup` together, then restart. |
| STEP 7 Caddy | Yes | README's placeholder rollback, unchanged. |

### ⚠ Why the BFF env change is one-way

The old binary **requires** `LENS_WORKSPACE_KEY` and `LENS_WORKSPACE_ID` and
refuses to start without them. The new binary **requires** `LENS_PROVISION_SECRET`
and refuses to start if `LENS_API_KEY` is present. A file containing all three
starts *both* binaries — so a rollback is possible **only if you kept the old
values**. That is the entire reason for `bff.env.pre-signup` in step 4.

**If you deleted the old values and did not keep a copy, you cannot roll the BFF
back** — the previous binary will not boot, and the workspace key/id would have
to be recovered from Lens (the key is hashed at rest; you would have to mint a
new one and look the workspace id up).

**Rolling the BFF back does not roll back the Lens workspaces.** Every workspace
provisioned during the window keeps existing, keeps its balance, and keeps
`cache_poolable = false`. That is harmless — they are simply unused until the
suite rolls forward again. Nothing needs cleaning up.

---

## The one thing that is not reversible at all

People who sign in after this lands get **their own empty workspace**. Their
history is not in it — the shared `default` history is co-mingled across every
trial user and cannot be attributed per person. That is the intended outcome and
`default` is deliberately untouched (its balance, keys and ledger rows, including
the ones your deploy was verified against, all stay). But a user who signs in,
sees an empty ledger, and asks where their data went is asking a fair question,
and the answer is "it was never yours individually" — worth saying to trial users
before they discover it.
