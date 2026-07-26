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

**Verify:** each is ≥32 chars and is not the published placeholder
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

### ⚠ 2a-bis. CREATE `lens.env`. It does not exist on the box, and its absence is SILENT.

`#377` changed the lens service from `env_file: .env` to `env_file: lens.env`,
because `.env` also holds the **Track and Docs gateway secrets** — which would
otherwise be loaded into the Lens process, giving it two other services' credentials
for no reason.

⚠ **The mapping is `required: false`** (verified, `docker-compose.yaml:64-66`). A
missing `lens.env` therefore does **not** fail the boot. Lens starts healthy with every
value from that file unset: provisioning off, pooling off, billing off — silently. This
is the same shape as the mute-variable class, arriving through a different door.

```sh
# On the Lens box, in the talyvor-lens checkout, NEXT TO docker-compose.yaml:
cat > lens.env <<'ENV'
LENS_PROVISION_SECRET=<same value as the BFF>
LENS_CACHE_POOLABLE_ENABLED=true
LENS_ECONOMY_ENABLED=true
LENS_POOL_ROYALTY_MINTING_ENABLED=true
LENS_POOL_ROYALTY_SHARE=0.5
# EARN GATE — leave UNSET for the comped trial (a vouch is enough to earn).
# Set true before OPEN SIGNUP, so earning requires a real completed purchase.
#LENS_EARN_REQUIRE_LIVE_PURCHASE=true
# SHADOW MINTS — do NOT set yet. See step 6d: it has a precondition.
#LENS_SHADOW_MINTS_ENABLED=true
ENV
chmod 600 lens.env
```

**Verify it reached the PROCESS, which is the only thing that counts:**
```sh
docker compose up -d lens && sleep 5
docker compose exec -T lens printenv LENS_PROVISION_SECRET | wc -c
# expect: >1.  A 1 (just the newline) or empty means lens.env was not read —
# check it sits beside docker-compose.yaml, not in deploy/ or your home directory.
```

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
the databases, the compose fragment, the secret-digest comparison and the
membership seeding. Two things to hold in mind while you do:

- **Track migrates by subcommand** (`cmd/track/main.go:132`): the
  `track-migrate` one-shot service in the compose fragment is what applies its
  schema. Its verify step (README: "expect a number > 0") is not optional — a
  Track that boots against an empty schema 500s on every call.
- **Docs migrates itself on boot** (`cmd/docs/main.go:162`), fail-closed and
  advisory-locked, so a re-run is a no-op and there is no separate step. A
  migration failure is a boot failure; you will see it in `docker compose logs
  docs`, not in a silent 500 later.

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
enough; nothing anywhere reports which of the three is shut. Run the royalty test
with one still closed and you see no mint, with no way to tell *not implemented*
from *not switched on*. Check all three at once, before you conclude anything.

| # | Gate | Where it lives | Shut by default? |
|---|---|---|---|
| 1 | `LENS_CACHE_POOLABLE_ENABLED` | Lens process env — **must be forwarded by compose**, see STEP 2a | **yes** |
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

echo "GATE 1 (global flag, as the PROCESS sees it — not as .env claims):"
docker compose exec -T lens printenv LENS_CACHE_POOLABLE_ENABLED || echo "  <empty>  ⇒ SHUT"

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

- **gate 1 empty** → the flag never reached the process. Check STEP 2a: it must be
  in the lens service's `environment:`, not only in `.env`. `printenv` above is the
  authority; the file is not.
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

```sh
# On the app host. Greps the bundle that is actually being served.
grep -l 'Not every kind of contribution earns LENS' /opt/talyvor/web-dist/assets/*.js
# expect: one filename.  NO OUTPUT ⇒ the served bundle predates the notice —
# DO NOT set LENS_SHADOW_MINTS_ENABLED. Ship the web bundle first.
```
*(Verified against a real `pnpm build` of suite `2d239d7`: the string survives
minification and appears exactly once.)*

Only once that prints a filename:
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

## ⚠ Steps that do NOT fully meet the "prove it, don't believe it" bar

Read as an operator who was not in the conversation. These are the places where a
step can still look like it worked. Named rather than left for you to discover.

| Step | What is not proven | What to do instead |
|---|---|---|
| **STEP 3 (Track/Docs)** | This document delegates to `README.md`'s Track/Docs section rather than restating its checks. Two documents means one can drift. | Follow README's section directly; its migration checks are now count-derived. If the two ever disagree, README is authoritative for Track/Docs mechanics. |
| **STEP 1 (secrets)** | "≥32 chars and not the placeholder" is checkable, but nothing here proves the two sides *match* until step 4 and step 3's digest compare. | A mismatch surfaces as a 401 from Track/Docs and a 404 on login — both loud, but LATE. If you want it early, run the step-4 digest compare for all three secrets before starting any service. |
| **STEP 6a (Lens canary)** | Proves the money path settles. It does **not** prove the *suite* works — the BFF no longer touches `default`. | Always run 6a **and** 6b/6c. 6a passing alone is compatible with provisioning being entirely broken. |
| **Caddy (README §7)** | The `curl` checks prove the front door serves. They do not prove the BFF behind it is the *build you just shipped*. | Compare `shasum -a 256` of the shipped binary against the one recorded in STEP 5 before restarting. |
| **`docker compose ps` anywhere** | "healthy" is a liveness probe. Lens passes it with provisioning off, pooling off and billing off. | Never treat `ps` as a deploy verdict. Every capability has its own explicit check in this document; run those. |

The general shape, since it recurred all day: **a green status is a claim about the
process, not about the capability.** Every step above that matters has a command
whose output distinguishes "running" from "actually doing the thing".

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
