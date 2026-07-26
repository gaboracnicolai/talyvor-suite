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
| talyvor-suite | `0a35473` feat(signup): give every person their own Lens workspace (#30) |
| talyvor-lens | `cc67661` chore(license): Business Source License 1.1 (#365) |
| talyvor-track | `aa735a0` chore(license): Business Source License 1.1 (#61) |
| talyvor-docs | `d785747` chore(license): Business Source License 1.1 (#41) |

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
for svc in lens track docs; do
  repo="ghcr.io/gaboracnicolai/talyvor-$svc"
  sha=$(git ls-remote "https://github.com/gaboracnicolai/talyvor-$svc.git" refs/heads/main | cut -f1)

  by_sha=$(docker buildx imagetools inspect "$repo:$sha"    --format '{{.Manifest.Digest}}' 2>/dev/null)
  latest=$(docker buildx imagetools inspect "$repo:latest"  --format '{{.Manifest.Digest}}' 2>/dev/null)

  if   [ -z "$by_sha" ]; then verdict="MISSING  — no image was ever published for this commit"
  elif [ -z "$latest" ]; then verdict="NO-LATEST— :sha exists but :latest is absent"
  elif [ "$by_sha" != "$latest" ]; then verdict="STALE    — :latest points at a DIFFERENT build"
  else verdict="OK"
  fi
  printf '%-6s %s\n         main=%s\n         :sha=%s\n         :latest=%s\n' \
    "$svc" "$verdict" "${sha:0:12}" "${by_sha:-<none>}" "${latest:-<none>}"
done
```

**Expect: `OK` on all three lines.** Anything else, and what to do:

| Verdict | What it means | Do this |
|---|---|---|
| `MISSING` | The image workflow never succeeded for this commit (the Docker Hub timeout case). | Re-run the image workflow **for that exact SHA**: `gh workflow run images.yaml --repo gaboracnicolai/talyvor-lens --ref main`. Wait, then re-run STEP 0. |
| `STALE` | An image for this commit exists, but `:latest` was overwritten by a later re-run of an **older** commit — exactly what happened today. | **Do not deploy `:latest`.** Pin the compose/unit to `:<sha>` for that service (see the note under each service's step), or re-run the workflow so `:latest` is re-pushed from this commit. |
| `NO-LATEST` | Tag missing entirely. | Same as `MISSING` — re-run the workflow. |

Why digests and not `docker pull`: pulling `:latest` and reading its labels
tells you what you *got*, not whether it *matches main*. Comparing the two tags'
manifest digests answers the actual question, and reports `<none>` distinctly
from a mismatch — which is the distinction that failed today.

> **If you must proceed with `STALE`:** pin by digest, never by `:latest`.
> `image: ghcr.io/gaboracnicolai/talyvor-lens@sha256:<by_sha digest>` is
> unambiguous and immune to a later re-push.

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
grep -c 'LENS_PROVISION_SECRET' docker-compose.yaml
# expect: 1 or more.  0 = the secret cannot reach the container; STOP.
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

**Verify — migrations at 107:**
```sh
docker compose exec -T postgres psql -U lens -d lens -tAc \
  'SELECT count(*) FROM schema_migrations'
# expect exactly: 107
```
A number below 107 means the migrate service did not run or failed — **stop**,
read `docker compose logs migrate`, do not start the BFF.

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
