# e2e — synthetic users test Talyvor through the real app (B17.3)

The runner creates synthetic users in Lens (B17.1). Each one signs in to the web app in a headless
browser (B17.2) and uses Chat the way a person does. A hard spend cap limits what one run can cost.

```sh
pnpm --filter @talyvor/e2e exec playwright install chromium    # once per machine
LENS_SYNTHETIC_KEY=… pnpm --filter @talyvor/e2e run \
  --app https://app.talyvor.com --lens https://lens.talyvor.com
```

| Flag | Env | Default | |
|---|---|---|---|
| `--app` | `E2E_APP_URL` | — | the web app, as a person opens it |
| `--lens` | `E2E_LENS_URL` | — | Lens: synthetic routes, ledgers, the judge |
| | `LENS_SYNTHETIC_KEY` | — | the same key Lens and the BFF boot with |
| `--users` | `E2E_USERS` | 100 | synthetic users created for this run |
| `--concurrency` | `E2E_CONCURRENCY` | 20 | users driving a browser at once |
| `--cap-usd` | `E2E_CAP_USD` | 5 | **hard** cap, US$ |
| `--model` | `E2E_MODEL` | Claude Haiku 4.5 | the cheap model journeys use (picker name) |
| `--judge-model` | `E2E_JUDGE_MODEL` | claude-haiku-4-5 | the judge, by catalog id |
| `--out` | `E2E_OUT` | `out` | where `run-<time>.json` is written |
| `--report-dir` | `E2E_REPORT_DIR` | `docs/e2e` | where the day's report is appended |
| `--build-md` | `E2E_BUILD_MD` | `~/talyvor-queue/BUILD.md` | the queue each new FAIL is filed in; `none` files nothing, a missing file files nothing |
| `--explorers` | `E2E_EXPLORERS` | 0 | AI explorers after the scenarios (at most 10) |
| `--explore-minutes` | `E2E_EXPLORE_MINUTES` | 30 | how long each explorer may use the app |
| `--explorer-model` | `E2E_EXPLORER_MODEL` | claude-haiku-4-5 | the model choosing each explorer's next move |
| `--lens-src` | `E2E_LENS_SRC` | `<out>/lens-src` | a checkout of talyvor-lens whose routes the coverage map lists; `none` lists none. Not given, the run keeps its own there, cloned from `E2E_LENS_REPO` and brought up to Lens's main each run; one you name is left as it is |
| `--track-src` | `E2E_TRACK_SRC` | `<out>/track-src` | a checkout of talyvor-track whose routes the coverage map lists (B34.9); `none` lists none. Kept up to Track's main from `E2E_TRACK_REPO` the way `--lens-src` is |
| `--docs-src` | `E2E_DOCS_SRC` | `<out>/docs-src` | the same for talyvor-docs, from `E2E_DOCS_REPO` |
| `--testers-md` | `E2E_TESTERS_MD` | `~/talyvor-queue/TESTERS.md` | where the run's short summary goes; `none` writes none |
| `--edge-repo` | `E2E_EDGE_REPO` | `gaboracnicolai/edge-infra` | the repo whose nightly workflows the report's Talyvor Edge section reads with `gh`; `none` reads none |
| `--code-repo` | `E2E_CODE_REPO` | `gaboracnicolai/talyvor-code` | the repo whose CLI the run builds from main and runs on an agent's key, and whose extension's and plugin's CI the report reads with `gh` (B34.10); `none` does neither |
| `--code-src` | `E2E_CODE_SRC` | `<out>/code-src` | the checkout the CLI is built from; not given, the run keeps its own there, brought up to main each run the way `--lens-src` is |
| `--upstream-port` | `E2E_UPSTREAM_PORT` | 0 | B28.287 — the port the run's synthetic upstream listens on, for a Lens started with `LENS_VLLM_BASE_URL=http://<this machine>:<port>`; 0 (production, whose vLLM traffic goes nowhere the run can see) leaves `keys-not-forwarded` a SKIP |
| `--hostile-prs` | `E2E_HOSTILE_PRS` | on | B28.289 — the hostile pull requests made against each repo's main after the scenarios; `none` makes none |
| `--deep-rounds` | `E2E_DEEP_ROUNDS` | 0 | B28.292 — rounds of the weekly deep red-team pass after the scenarios, under the same cap; the nightly sets it on `E2E_DEEP_DAY` only (default 3 rounds) |
| `--light` | `E2E_LIGHT=1` | off | B28.294 — the light pass: its own six users and the core money and auth paths, nothing else (below) |
| `--day-cap-usd` | `E2E_DAY_CAP_USD` | — | B28.294 — the day's one cap, US$: the run spends only what the runs in `--out` since `E2E_NIGHTLY_AT` left of it, and nothing when none is left; the nightly script sets it to `E2E_CAP_USD` |
| | `E2E_NIGHTLY_AT` | 03:00 | B28.294 — when the testers' day starts (this machine's clock): the nightly's hour |
| `--headed` | | off | show the browsers |

A run needs `LENS_SYNTHETIC_KEY` set to the same value in `lens.env` and in the BFF's env file. Without
it on either side, Lens's synthetic routes or `/auth/synthetic` answer 404.

## What a run does

1. Creates `--users` new synthetic workspaces, then resets them — and only them (stored answers cleared,
   credits restored), so a run going on at the same time is left alone (B27.16).
2. Each user signs in and runs a journey in Chat. Every scenario starts from a new chat.
3. After every journey has finished, it reads back each user's ledger.
4. It writes `out/run-<time>.json`: each scenario's PASS, FAIL, SKIP or ERROR, with the question, the
   answer, the line under it, and ledger rows. It exits 1 if anything failed.
5. It appends the run to the day's report, `docs/e2e/report-YYYY-MM-DD.md` (B17.4): the summary and
   cost, a table of every scenario's verdicts, each FAIL and ERROR with its evidence, and every verdict
   with its evidence folded underneath. A second run that day goes below the first; a report is never
   overwritten.
6. Each scenario that FAILED becomes one build item in `~/talyvor-queue/BUILD.md` — numbered next in
   the B17 series, `repo:` the owner the scenario names (B35.9: the repo whose code makes what it
   checks), `status: OPEN` — unless an OPEN, CLAIMED or BLOCKED item already carries its
   `e2e-scenario: <id>` line. So a second run files nothing new for the same failure, and a failure
   that returns after its item is DONE or SUPERSEDED is filed again. Three or more scenarios that FAIL
   with the same refusal from Lens (the same `LENS_` setting, or the same sentence once its numbers are
   taken out) are one item for that cause, for talyvor-lens, carrying each scenario's line. An ERROR
   (the harness could not reach a verdict) is in the report but files nothing.
7. B28.296 — a scenario that has FAILED three runs running (this one and the runs before it in `--out`,
   nightly and light alike; a run that did not play it, or only SKIPped or ERRORed it, neither counts nor
   breaks the streak) has the item carrying its marker moved to a section at the top of BUILD.md, `# FIRST
   IN THE QUEUE …`, with a line under its `repo:` line saying why — the loop claims the first OPEN item in
   file order, so it is built next. The report and TESTERS.md name each such scenario and its item.

**The cap is hard.** Every question reserves its worst case before it is sent: its whole input plus
4,096 output tokens at list price. When the answer arrives, the reservation is settled with the real
cost. A question whose worst case would take committed spend plus in-flight reservations past the cap
is never sent. From then on the run sends nothing new and every remaining scenario SKIPs.

## Talyvor Edge in the report (B34.3)

edge-infra is never deployed; its features are proven on kind, and every one of its workflows runs each night on main
on GitHub. After the scenarios, the run reads with `gh` the latest completed scheduled run on main of every edge-infra
workflow (`src/edge.ts`), and the report gets a **Talyvor Edge** section: each workflow with its result, commit and a
link to its run; every phase `deploy/local/up.sh` on main declares, with its state in Kind E2E's log (colour codes
stripped): **passed** if the run went past it, **failed** where an `X` line stopped it, **not reached** after that, **not
in the run** when main has it and the run's commit did not; and each row of `docs/self-host-claims.md` with the state
of the phases it names. A run older than 36 hours is **STALE**, never green. A failed phase or workflow files one item
for edge-infra carrying `e2e-scenario: edge-<workflow>-<phase>` (or `-<failed job>` when there is no phase), under the
same once-only rule as a scenario. TESTERS.md gets the section in one line.

## Talyvor Code in the report (B34.10)

After the scenarios, before the explorers, the run brings `<out>/code-src` up to talyvor-code's main and builds its CLI
(`go build ./cmd/agent`, so the Mac needs Go on the PATH launchd gives the nightly). On a synthetic workspace of its own
it makes an agent in Agent Wallets, issues it a key and funds it with 2 LXC, reserved against the cap. Then, in a fixture
repository written fresh each night (`calc.go`, whose `Magic()` returns a number new that night), it runs
`talyvor-code ask --file calc.go` and `talyvor-code review --output json calc.go` on that key with `claude-haiku-4-5`.
Each call must be one charge on the agent's statement (a spend line, or a stream's hold and the settle that closes it)
and none on the workspace: its unallocated balance must not move. `ask` must answer with that night's number. The report
gets a **Talyvor Code** section with each command's verdict, what it said and what it charged, and the `extension` and
`jetbrains` jobs of the latest completed CI run on talyvor-code's main, read with `gh`. A broken `ask` files one item
for talyvor-code carrying `e2e-scenario: talyvor-code-ask`, under the same once-only rule as a scenario; a night whose
CLI could not be run (no Go, no checkout, the run stopped) says so and files nothing. TESTERS.md gets the section in one
line.

## Hostile pull requests (B28.289)

After the scenarios, the run writes the pull requests an attacker or a careless change would open and checks CI would
refuse each one (`src/hostile.ts`). Each is made in a copy of its repo's main: the suite from the run's own checkout,
Lens, Track and Docs from `--lens-src`, `--track-src` and `--docs-src`, brought up to main first.

| Pull request | Repo | The guard that must stop it |
|---|---|---|
| `postinstall-suite` — the web app gains a dependency whose postinstall runs code, lockfile updated | talyvor-suite | `pnpm install --frozen-lockfile`: `allowBuilds` in pnpm-workspace.yaml refuses it with `ERR_PNPM_IGNORED_BUILDS`, and the postinstall must not have run |
| `admin-gate-lens` — `requireAdmin` comes off `POST /v1/admin/lxc/grant`, the route that mints LXC; the admin-route classification tests stay green | talyvor-lens | `TestEveryAdminRegistrationReachesAnAuthorizationDecision` (in `go test ./...`), naming the route |
| `compose-secret-lens`, `-track`, `-docs` — a compose secret that compose refused to start without gets a default | each | `scripts/check-compose-secrets.sh`, naming the variable |

A pull request is **caught** only when its guard passes on main as it is (a guard already red proves nothing), goes red on
the change naming what it caught, and the repo's workflow still runs it on every pull request. One CI would let through is
**NOT CAUGHT** and files one build item for its repo, `e2e-scenario: hostile-pr-<id>`, under the same once-only rule as a
scenario. One whose change no longer applies to main is **STALE** and files one for the testers' harness, since it has
stopped testing anything. A missing checkout or tool is **NOT RUN** and files nothing. The report gets a **Hostile pull
requests** section and TESTERS.md one line. The self-test FAILs unless `postinstall-suite` is caught.

## The weekly deep red-team pass (B28.292)

Once a week — on `E2E_DEEP_DAY` (`date +%u`: 1 Monday … 7 Sunday, default 7) — the nightly sets `E2E_DEEP_ROUNDS`
(default 3; 0 every other night, whatever the settings say) and the run goes on, after its own scenarios and their second
attempts and before Talyvor Code and the explorers, to the deep pass (`src/deep.ts`). Each round, an attacker created for
the run with the night's users plays every red-team scenario back to back — `ledger-moves-at-once`, `ledger-call-once`,
`webhook-unsigned`, `webhook-replayed`, `agent-rules-unbypassable`, `market-abuse`, `pool-isolation`, `injection-exfil`,
`ssrf-refused`, `file-bomb-bounded`, `csrf-refused`, `script-inert`, `keys-unlisted`, `keys-not-forwarded`,
`rate-limits-hold` and `cross-company-test-money` — each on a fresh workspace of its own, trading with a counterparty made
for that round alone. Rounds run one after another, never at once (`keys-not-forwarded` listens on the one upstream port).

It is **under the same hard cap**: every question reserves against the run's one cap, and once the cap is reached what is
left of the pass SKIPs, and the explorers get whatever it left. Its users' ledgers are read back with everyone else's.
A FAIL is **filed like any other** — under its scenario's `e2e-scenario:` marker, so a failure the night's own run already
filed is not filed twice — and the item says which round caught it, and when nothing else that night FAILED the scenario,
that it slipped through the nightly's own run. The report gets a **Weekly deep red-team pass** section (each scenario's
verdict in every round, and its item) and TESTERS.md one line. By hand: `E2E_DEEP_ROUNDS=3 pnpm --filter @talyvor/e2e run …`.
Self-test: `E2E_DEEP_ROUNDS=1 STUB_BREAK=ratelimit-open-later` — the limiter fails open only after the first workspace that
bursts it — PASSes the night's `rate-limits-hold` and FAILs round 1's, which is filed.

## The light pass between the nightly runs (B28.294)

Every few hours, between the nights, a cron runs `scripts/e2e-nightly.sh --light` (the cron is Nicolai's to set; the
script is the entry point). Like a night, it brings the checkout to main's head first, and a checkout held behind main
runs nothing. Then it runs the harness with `--light` (`src/light.ts`): six fresh synthetic users at once, playing the core
money and auth paths in a few minutes:

| User | Plays |
|---|---|
| 0 | `known-answer`, `capital` (a priced answer), then `spending-limit` (refused past it, no spend row) |
| 1 | `agent-limit`, `wallet-send-refund` and `cross-company-test-money`, with user 5 as the other company |
| 2 | `api-key-revoke`, then `session-sign-out` |
| 3 | `csrf-refused`, `script-inert`, `keys-unlisted`, `webhook-unsigned`, each on a workspace of its own |
| 4 | `ledger-moves-at-once`, `ledger-call-once`, `agent-rules-unbypassable`, each on a workspace of its own |
| 5 | nothing: the other company |

Then every user's ledger is read back. No explorers, deep pass, hostile pull requests, Talyvor Code or Talyvor Edge, and
no B28 features section. Every scenario is one the nightly plays, so a FAIL is **filed like the nightly's**, under its
scenario's `e2e-scenario:` marker, and its item says the light pass caught it. The report's section is headed
**Light pass**, and TESTERS.md gets an entry for it.

**One cap for the day.** The nightly script sets `E2E_DAY_CAP_USD` to `E2E_CAP_USD`, for the night and the light passes
both. A run may spend only what is left of it in the testers' day, which runs from `E2E_NIGHTLY_AT` to the next. What
was spent before is read from the `run-*.json` results in `--out` that started since then. The night opens each day with
all of it. Each light pass has what the night and the passes before it left, and when nothing is left it runs nothing
and exits 0. The report and TESTERS.md give the day's cap beside the pass's own. A light pass never starts while another
run in the checkout is going (it logs that and exits 0), and the night waits for a light pass to finish.

Self-test: `E2E_LIGHT=1 E2E_DAY_CAP_USD=1 STUB_BREAK=send-one-side`, with a `run-*.json` in `E2E_OUT` that spent $0.60,
runs 21 verdicts in under a minute under the $0.40 left. It FAILs `wallet-send-refund` and `cross-company-test-money`,
and files both. Without the defect all 21 PASS. With `E2E_DAY_CAP_USD=0.6` it runs nothing.

## Every B28 feature with its own test (B28.293)

**A scenario names the build items whose feature it exercises end to end**: `items: ['B28.24', 'B28.300']` beside its
`owner` — the item on each side of a split feature. Ship a B28 feature with the scenario that names it, asserting the
ledger row where money moves, and a planted stub defect it FAILs on.

After the scenarios the run reads `--build-md` (`src/b28.ts`) and the report gets a **B28 features** section: every B28
item marked DONE, the scenarios that name it and their verdicts this run, so the count of features tested rises as they
land and a feature that breaks or goes away FAILs by name. The testers' own items (repo `talyvor-e2e`, or titled for an
e2e scenario) are tests, not features; edge-infra's are proven on kind (the Talyvor Edge section); and `NO_SCENARIO`
holds the few no scenario can reach, each with the true reason (words only on GitHub, CI configuration, Track and Docs
served only to the BFF). A DONE feature none of that covers, and no scenario names, files one item for `talyvor-e2e`,
`deps:` the feature, `e2e-scenario: b28-untested-<id>`, under the same once-only rule as a scenario; an OPEN, CLAIMED or
BLOCKED e2e item whose `deps:` name the feature holds it instead. TESTERS.md gets the section in one line.

## Every night, and the explorers (B17.5)

`scripts/e2e-nightly.sh` is installed once under launchd and left running (B34.2):

```sh
scripts/e2e-nightly.sh --install    # launchd starts it at login and again if it stops; each night at E2E_NIGHTLY_AT (default 03:00)
scripts/e2e-nightly.sh --status     # whether it runs, its pid, the last run and the next
scripts/e2e-nightly.sh --now        # one run now, exiting with the run's status
scripts/e2e-nightly.sh --light      # B28.294: the light pass now, under what is left of the day's cap — what a cron runs every few hours
```

`--install` writes `~/Library/LaunchAgents/com.talyvor.e2e-nightly.plist` with this shell's `PATH`,
`E2E_NIGHTLY_AT` and `E2E_ENV_FILE`, and takes over from a nightly already running: it stops one started
by hand (`nohup scripts/e2e-nightly.sh &`), then launchd starts it. It refuses while a run is in progress.
A second start exits and leaves the first running. A night that pulls in a new copy of the script goes on
under the new one, in the same pid.

Before each run it reads `~/.config/talyvor/e2e.env` (`E2E_ENV_FILE`), which holds `LENS_SYNTHETIC_KEY`,
`E2E_APP_URL`, `E2E_LENS_URL` and any other `E2E_*` setting. It then brings the checkout to main's head and
runs the harness with 10 explorers for 30 minutes each by default. Everything runs under the one cap. It
logs to `e2e/out/nightly.log`. It never deploys, pushes or commits.

**A night held behind main runs nothing.** When the checkout cannot be brought to main's head — it is on
another branch, has changes of its own to tracked files or commits main does not have, or main cannot be
read — no scenario runs: the night puts a **HELD** entry at the top of TESTERS.md with why and the commit
it would have tested (`src/held.ts`), and exits 2.

**Every report and TESTERS.md entry names what was tested**: the harness's commit, Lens's main at
`--lens-src`, and production's versions from the app's `/api/version` and Lens's `/healthz`, read at the
start and again at the end, so a deploy that landed during the run shows as `old → new`.

**Explorers.** After the scenarios, each explorer signs in as a synthetic user of its own. A cheap model,
asked through Lens on that user's account, chooses its next move: click, type, press a key, open a path
of the app, note a finding, or stop. The model reads the screen's text and its numbered controls. Every
step reserves its worst case against the same cap, so the explorers stop at the cap with everything
else. Findings go into the report under "Explorers — findings to check": what the explorer noted, plus
each page error and 5xx its browser saw, with the moves that led there. Findings are never filed as
build items, because an explorer can be mistaken. The self-test runs two scripted explorers against the
stub.

## The coverage map, the report per feature, and TESTERS.md (B25.5)

**What there is to test is read from the code on every run** (`src/coverage.ts`), never kept by hand: every
screen `apps/web/src/App.tsx` mounts (and the screens each area mounts under its `/*`), every route
`apps/bff/lens.go` registers, and every route Lens registers in its `cmd/lens` and `internal/api` (from
`--lens-src`; not given, the run keeps a shallow checkout of Lens's main there itself). **What was tested is recorded as it
happens**: each screen a tester's browser opens, each BFF request with its status, time and the screen that
made it, each call the harness makes to Lens, and each page error — all filed under the scenario running. A
Lens route the app reaches through the BFF is counted through the BFF route that leads to it.

**Track and Docs too (B34.9)**: every route talyvor-track and talyvor-docs register — their `cmd/<name>`
router and the handlers it mounts under `/v1` — from `--track-src` and `--docs-src`, kept up to main like
`--lens-src`. Neither is reachable but through the BFF, so each is counted through the BFF routes that send it
a request, read from the BFF's own Go: every `forwardProduct` call and `http.NewRequest` to Track's or Docs'
base URL, in the handler and in every method it calls, with the path it builds and the method it sends (a
request with a method of its own — GET lists issues, POST creates one — only when the BFF route is called with
that method). A route no BFF route sends a request to **cannot be tested yet**, and why: production serves
Track and Docs only to the BFF. That reason is given only while `deploy/track-docs.compose.yaml` publishes
both on 127.0.0.1 alone and `deploy/Caddyfile` proxies only the BFF, and while every call the BFF makes to
them was read; otherwise those routes read **not covered** and the map says why.

Each entry ends in one state: **covered** (the scenarios that reached it, ×users), **explorers only** (nothing
with an oracle checked it), **cannot be tested yet** (and why — an operator screen, Lens's admin key, the
identity provider's sign-in, a webhook signed by Stripe or the card issuer, the BFF's provisioning secret, a
Track or Docs route the app never sends a request to), or **not covered**.

**The report is written per feature** — a feature is a screen's title, or what a scenario names — each with
what works (with the evidence), what is broken (with the evidence and its build item), the errors the browsers
saw (ERROR verdicts, page errors, a 5xx from the BFF), what was slow (a screen past 3 s at p95, a route past
2 s, or 30 s when it waits for a model), what worked well, and what the explorers noted there. It ends with
the map: every screen, BFF route and Lens route, and its state.

**The explorers** are told every feature, and each starts at the next least covered (the fewest verdicts).

**They share one notebook (B26.19).** Each is shown what it and the others have already noted on the
screen it is on, and answers "same as L4" instead of noting it again in new words. One explorer makes at
most three notes on a screen; after the third, or after 20 steps in a row there, it is sent to the screen
the explorers have opened least. The report lists each distinct lead once, with the explorers who saw it,
and says how many of the screens they opened between them.

**After every run** the summary — coverage, works, broken, new findings, cost — goes on top of
`~/talyvor-queue/TESTERS.md`, for the morning brief; earlier runs stay below it.

**A run always reports (B26.18).** A user, an explorer or a browser that crashes is that one's ERROR, never
the end of the run: a browser that crashes or is killed is replaced for whoever signs in next, and the
report's **Incidents** say when it went. After an ERROR the run checks whether Lens still answers. The
first time it does not, the run stops: what is in flight is abandoned, and everything not yet started is
skipped. Any step that cannot go on also stops it. Nothing is waited on forever: a sign-in has 5 minutes,
a scenario 30, a ledger read-back 5. However it ends, the run writes its results, its report and
TESTERS.md with what it has. Both say **STOPPED EARLY** with the cause and when it happened, and the cost
spent before it stopped. A run that stopped early exits 1.

**The testers' own environment (B35.8).** An answer refused with "Failed to fetch", a `net::ERR_` code or the BFF's
"lens upstream unreachable" is an ERROR, never a FAIL: the report lists each under **The testers' environment**
with its time, and it files nothing. A charged answer is booked the moment its footer is read, so a scenario that
throws after it still leaves the ledger read-back expecting its row. The run reads the Mac's memory pressure and swap
at the start and every 5 minutes, and the report sets each reading beside the waits that ran out after it; while swap
is more than three quarters full the run starts half as many users at once, down to 5. A scenario that FAILed for one
or two users runs again for them before the ledger read-back (their agents archived first): the report shows both
attempts under **Second attempts**, and the first attempt's FAIL is the one filed.

| Scenario | Who | Oracle |
|---|---|---|
| `every-screen` | 1 in 10 | every screen a customer can open (from the map, operator screens left out), opened as a person does — a screen with a parameter from the first link on the one above it: the console's heading names it (a public page shows a heading), nothing says "Nothing at this address", and while it loads there is no page error and no 5xx |
| `lens-reads` | 1 in 100 | every Lens read a customer's key can make (GET, no parameter but the workspace, from the map) answers within 15 s, never with a 5xx; 401/403/404 are counted, not failed |
| `brand-visual` | user 2, once a run | B29.21 — `/marketing`, `/pricing` and `/signin` signed out and `/` signed in, at 1440×900 and 390×844 in the dark theme and the light one: each view's first screen is saved to `<report dir>/shots/<run start>/` and shown in the report under **Screenshots**; a view fails on sideways scroll, no drawn SVG logo on screen, the old CSS tile, any computed colour #f0a030, or a font stack naming Inter; B29.15 — a light view also fails on a canvas other than #F4F7FB, or on bright Teal #3AD6C0 as text, a fill or a border outside the logo and the photographs |
| `brand-docs` | user 2, once a run | B29.28 — a Docs page the user writes, at 1440×900 and 390×844 in the dark theme and the light one: each view's first screen, and at 390 the sidebar opened from Menu, is saved beside `brand-visual`'s and shown under **Screenshots**; a view fails on no logo in the sidebar, any computed colour #f0a030, or a font stack naming Inter. B29.31: then the page's **Export as HTML** file, opened on its own at the same sizes in both themes, is photographed beside them (`docs-export-*.jpg`) and fails on #f0a030 or Inter |
| `brand-roi` | user 2, once a run | B29.29 — Lens's executive ROI report for the user's workspace (`GET /v1/workspaces/{ws}/roi/report?format=html`), opened at Lens's address at 1440×900 and 390×844 in the dark theme and the light one, and once under print media (794 wide, preferring dark): each first screen, and the whole report on paper, is saved beside `brand-visual`'s and shown under **Screenshots**; a view fails on sideways scroll, no inline mark (`tv-mark`) on screen, any computed colour #1a1a2e or #f0a030, a font stack naming Inter, a request to a host other than Lens's, or a dark canvas on paper |
| `company-line` | user 2, once a run | B32.2 — `/marketing`, `/pricing`, `/documentation`, `/terms`, `/privacy`, `/signin` and `/signup` signed out and `/settings` signed in: each fails without the line "TALYVOR LTD · Registered in England and Wales · Company number 17299143 · Registered office: …", and `/terms` and `/privacy` fail unless their first paragraph says who runs Talyvor, word for word |
| `seats-free` | 1 in 10 (4, 14, …) | B32.71 — the owner adds a second member on Members: Track's answer must be 402 in Lens's own words — naming `LENS_PLAN_GATES`, "the free plan allows 1 seat" and the team plan, `plan` free and `allows` team — shown verbatim with a link to /plans, and the roster read back still lists the owner alone |
| `seats-team` | user 4, once a run, last | B32.71 — the same workspace on Team, paid with test card 4242 on a checkout Lens opens: members added on Members until the roster holds five, each 201 and read back; the sixth is 402 naming "the team plan allows 5 seats" and the business plan, and the roster still lists five. SKIP when Lens sells the test workspace no Team checkout |

## Catalog v1, and each scenario's oracle

| Scenario | Who | Oracle |
|---|---|---|
| `known-answer` | everyone | `a + b` with numbers unique to the user; the answer states the sum and carries a price |
| `capital` | everyone | a capital from a fixed table |
| `every-model` | user 0 | every model the picker offers is asked to say back a word made up for this run, one word a model (a question an earlier run asked is served from the pool), and says it; its footer shows the price the catalog gives for its token counts |
| `repeat-new-chat` | 1 in 10 | an exact repeat in a new chat shows "from your earlier answer · 0 LXC" and the same text; Regenerate is priced; the judge agrees the two answers match |
| `chat-savings` | 1 in 10 | a question of the run's own, repeated in a new chat, is served from the earlier answer; each row of "Saved in this chat" (cache, shared pool, conversion, Tare) equals the sum of its response header on that chat's answers, and the repeat says what it saved (B28.95) |
| `chat-agent-task` | 1 in 10 | `/task <agent>: <a sum>` typed in Chat opens a card; handed over, the card shows the answer, every call the task made is a charge on the agent's statement out of its balance, the workspace's own balance and plan allowance do not move, and the key the task ran on is gone from the workspace (B28.96) |
| `chat-scheduled-prompt` | 1 in 10 | `/schedule <agent>: <a sum>` typed in Chat opens a card; set for a whole minute 45 seconds or more ahead, nothing is asked or charged before it, the answer appears in the card at that time with what the agent's wallet paid linked to its statement line, Lens lists one run no earlier than the time set, its charge is exactly the agent's new statement lines out of its balance, and the workspace's own balance and plan allowance do not move (B28.125). STUB_BREAK=schedule-early or schedule-free must FAIL |
| `chat-card-freeze` | 1 in 10 | `/freeze <agent>` typed in Chat opens a card; frozen there, Lens reads the agent's card back `frozen` and a £0.50 purchase on it is declined, the agent's balance and statement unmoved; `/unfreeze <agent>`, and the next purchase is approved and exactly its cost leaves the agent (B28.360, for Lens's B28.97: POST …/agents/{id}/card/freeze and …/card/unfreeze) |
| `chat-statement` | 1 in 10 | `/statement <agent>` typed in Chat opens a card that downloads the agent's statement for this month as CSV, and `/statement` every agent's; each file is, row for row, GET /api/agents/statement for its period (the agent's: its account's rows, closing at the balance Lens's book holds) (B28.98) |
| `chat-charged` | 1 in 10 | a question asked afresh: the line under its answer states what Lens charged ("0.00135 LXC charged · …"), not the estimate, and that figure is the amount of the one spend row Lens wrote for it; screenshots at 1440 and 390 (B28.362, for Lens's B28.102: the `talyvor.charge` frame Chat asks for with `X-Talyvor-Report-Charge: true`). `STUB_BREAK=charge` says a µLXC more than the row and must FAIL |
| `chat-web-search` | 1 in 10 | Search the web turned on in Chat and a news question asked afresh: the answer lists the pages Lens searched and gave the model, and at least two of them open — each link's own address loaded in a tab of its own, answered 2xx or 3xx; screenshots at 1440 and 390 (B28.372, for Lens's B28.118: the `talyvor.citations` frame Lens adds when Chat asks with `X-Talyvor-Web-Search: on`). `STUB_BREAK=web-search` searches nothing and must FAIL |
| `chat-run-code` | 1 in 10 | Run code turned on in Chat and "What is the 100th prime?" asked afresh: the answer says 541, and under it is the code the model ran in the sandbox, whose output is 541; screenshots at 1440 and 390 (B28.373, for Lens's B28.119: a `talyvor.code_run` frame for each run, which Chat asks for with `X-Talyvor-Run-Code: on`). `STUB_BREAK=run-code` runs no code and must FAIL |
| `chat-file-bug` | 1 in 10 | "…downloads an empty file. File this as a bug." asked in Chat: the model drafts a Track issue and Chat asks first; File it pressed, the answer links the issue, Track holds it — read back through `/api/track/issues` — with the bug's own words, and the link opens it in Track; screenshots at 1440 and 390 (B28.374: Track's and Docs' own MCP tools offered in Chat through the BFF, `create_issue` run only with `"confirmed": true`). `STUB_BREAK=file-bug` says it filed and keeps nothing, and must FAIL |
| `chat-connectors` | 1 in 10 | Talyvor test tools added on Connectors (B28.122), and "What is the fingerprint of the text \"<fresh word>\"?" asked in Chat: the model calls the connector's `fingerprint` tool, Chat asks first and Allow is pressed, and it runs through the BFF (`/api/chat/connectors/call`), the answer gives the first 12 hex digits of the word's SHA-256, and under it the call is listed on its connector with its cost — the charge of the request that read the tool's answer, which must be one of the question's spend rows in the ledger (or, while Lens does not say its charge, the estimate); screenshots at 1440 and 390; the connector removed after. `STUB_BREAK=connector` makes the fingerprint up without calling the tool, and must FAIL |
| `chat-docs-page` | 1 in 10 | A Docs page written with a sentence that names a fresh word, then in Chat attached with Docs page (B28.375: read from Docs as stored, sent to Lens as a Markdown document the question references by its `tdoc_` id, as an attached file is) and "Quote the sentence in the attached page that mentions <word>." asked: the answer quotes the page's sentence, and under the question the page is named and linked to `/docs/spaces/{space}/pages/{page}`; screenshots at 1440 and 390. `STUB_BREAK=docs-page` has the stand-in model not read the page, and must FAIL |
| `chat-track-issue` | 1 in 10 | A Track issue made in Track, then in Chat attached with Track issue (B28.376: sent to Lens as a Markdown document the question references, and every request in the conversation names it with `X-Talyvor-Issue: <identifier>`) and a question asked afresh: the question links the issue to `/track/issues/{id}`, Lens's per-issue read (`/v1/workspaces/{ws}/anomalies/issue/{identifier}`) holds the answer's charge — its one spend row, in dollars — and the issue's AI cost in Track rises by exactly that once Track's syncer reads Lens (every 15 minutes, so it is given 16); screenshots of the picker and of the issue's AI cost at 1440 and 390 (for talyvor-lens B28.124). `STUB_BREAK=issue` keeps no issue with the spend, and must FAIL |
| `chat-canvas` | 1 in 10 | an answer (made up in the browser, so it costs nothing) that writes a page in an `html` code block: Open in canvas draws it as a page whose script runs and cannot read the console's document; its HTML edited in the canvas is drawn, and after a reload the answer opens it as edited; screenshots at 1440 and 390 (B28.120) |
| `chat-share-link` | 1 in 10 | a question asked afresh in a new chat, then Share and Create link beside its name: a stranger with no session opens the link (HTTP 200) and reads the question and its answer; after Turn off link the same stranger's next visit to the link answers 404 at the door, the page says the chat is not there, and `/api/public/chats/{token}` answers 404; screenshots at 1440 and 390 (B28.127). `STUB_BREAK=share-revoke` turns the link off and keeps the copy, and must FAIL |
| `chat-export-import` | 1 in 10 | two questions asked afresh in a new chat, then Share → Download this chat: a second, fresh browser signed in as the same person takes the file with Import under its conversations ("Imported 1 conversation."), and the chat it opens there shows the same questions, the same answers, the same price under each answer and the same running total, with no request to a model made by the import; screenshots at 1440 and 390 (B28.128) |
| `chat-meter` | 1 in 10 | a question asked afresh: the meter under the box ("Plan 25% used · 150 LXC left", "Prepaid balance 4.25 LXC") then shows Lens's allowance left and balance exactly, and its prepaid balance dropped by the ledger rows Lens wrote for the answer; screenshots at 1440 and 390 (B28.104). `STUB_BREAK=meter` lags the balance behind the ledger and must FAIL |
| `chat-feature-spend` | 1 in 10 | a question asked afresh in Chat: Spend by feature on /spend then lists `chat` with one request more than before, risen by the answer's charge — the one spend row Lens wrote for it, in dollars, to the card's four places; screenshots at 1440 and 390 (B28.106: the BFF sends `X-Talyvor-Feature: chat` on every Chat request, and the cheaper-model hint asks Lens for the `chat` cohort). `STUB_BREAK=feature` records Chat's requests untagged and must FAIL |
| `chat-history-sync` | 1 in 10 | a chat made on one device (the user's browser) with sync turned on is in a second, fresh browser context's list once that one turns sync on with the same passphrase, and not before; Lens's copy (GET /v1/workspaces/{ws}/chat-history) holds none of its words; then the first stops syncing, makes another chat, and neither Lens's copy nor the second ever sees it — no sync call while off; answers are made up in the browser, so it costs nothing; screenshots at 1440 and 390 (B28.365, for Lens's B28.107). SKIP while Lens has no /chat-history. `STUB_BREAK=sync` answers a PUT and keeps nothing and must FAIL |
| `chat-auto` | 1 in 10 | Auto (cheapest good) chosen in the picker and a question asked afresh: the line under the answer names the model Lens chose ("GPT-6 Luna, chosen by Auto"), and the one spend row Lens wrote for it is that model's list price for the footer's tokens; screenshots at 1440 and 390 (B28.363, for Lens's B28.103: model `auto` on the provider of the cheapest model offered, the served model named in the stream). `STUB_BREAK=auto` names a dearer model than the one charged and must FAIL |
| `chat-cheaper` | 1 in 10 | A question asked afresh of the dearest model with a cheaper one on its provider: under the answer Chat offers exactly the model Lens's `/routing/recommendation` names for the answer's provider and input size when the picker offers it and it is cheaper for the answer's tokens, and nothing otherwise; offered, "Re-ask with" is answered by that model (the footer names it) and the one spend row Lens wrote is its list price for the footer's tokens; screenshots at 1440 and 390 (B28.364, for Lens's B28.105). `STUB_BREAK=cheaper` answers and charges the re-ask with the provider's dearest model and must FAIL |
| `chat-compare-models` | 1 in 10 | on /chat/compare the run's model and the two cheapest other models Chat offers are asked one question of the run's own at once: the three requests are open together, each column's answer grows before its price appears and counts as asked, and the three prices are the amounts of the three spend rows Lens wrote — exactly, when Lens said what it charged; screenshots at 1440 and 390 (B28.369, for Lens's B28.114: each column is an ordinary Chat request with `X-Talyvor-Report-Charge: true`). `STUB_BREAK=charge` says a µLXC more than each row and must FAIL |
| `one-digit-trap` | 1 in 10 | identical history, then a one-digit change: the change is asked, never served, and answered right |
| `rephrase-same-account` | 1 in 10 | a rephrasing is answered right; if it was served, the judge agrees with a fresh answer |
| `across-accounts` | 1 in 10 | another account asks the same question: never "your earlier answer"; if shared, at 30% off |
| `follow-up-not-cached` | 1 in 10 | the same follow-up words in a different context are asked, not served |
| `sidebar-stays-hidden` | 1 in 10 | the Chat sidebar stays hidden after a reload |
| `streaming` | 1 in 10 | a fresh answer shows at least three partial states before it finishes |
| `ledger-matches-answers` | everyone, last | one `spend` row per charged answer (judge calls included), none for a replay; together they debit what the screen's token counts cost at list price (µLXC, rounded up per row) |

## Catalog v2 (B17.8)

Each also goes to one user in ten, after that user's catalog v1 scenario. Features and the Try-it pages
open in a second tab, so the Chat tab keeps its conversation. A switch a scenario changes is put back.

| Scenario | Who | Oracle |
|---|---|---|
| `features-switches` | 1 in 10 | every Features switch (Tare, Document conversion, Cost-optimised routing, Prompt-injection detection, Personal-data detection, Answer sharing, Shared document conversions) changes what its row says, is still changed after a reload, shows its evidence, and switches back; Request logging set to Nothing pauses the Answer cache and an exact repeat is asked again |
| `injection-blocked` | 1 in 10 | with Prompt-injection detection on, an injection is refused (4xx) and the ledger gains no spend row; off, it is answered |
| `document-in-chat` | 1 in 10 | an HTML memo attached in Chat is "Converted to text before the model read it", and the answer is the code word only the memo states |
| `spending-limit` | 1 in 10 | a limit below what was spent refuses a request ("cannot cover") with no spend row; switched off, the next is answered |
| `try-conversion` | 1 in 10 | Try it on a document: the HTML memo becomes Markdown with its heading and its fact, and Download as Markdown saves what is shown |
| `personal-data-not-pooled` | 1 in 10 | with Personal-data detection on, a question carrying an email and a phone number is asked again in a new chat and by another account, never served |
| `tare-model` | 1 in 10 | the Tare prose model switched on in Features: Try it shortens a paragraph of prose and says the prose model did it; switched off, the same paragraph is sent unchanged |
| `try-tare` | 1 in 10 | Try Tare: 40 same-shaped JSON rows shrink to fewer tokens, the figures add up, and every field name survives |
| `docs-ai` | 1 in 10 | a space and a page written in Docs: Summarise and Translate (French) keep the page's access code, and Ask answers it and cites the page |
| `track-ai` | 1 in 10 | an issue with a ten-comment thread about one cause: the summary names it (tax calls), Look for duplicates names its near-twin, and triage suggests a priority |
| `track-export` | 1 in 10 | Export JSON and CSV: both hold every issue, the counts agree with the screen, and a title that starts with `=` is defused (`'`) and quoted |
| `track-enter` | 1 in 10 | a title typed in Track and Enter pressed, the button never touched: the issue is listed once and the title field is empty |

Docs and Track call Lens on their own account, so their AI actions never reach the user's ledger. Each
one holds its worst case against the cap — the product's model, the whole input, its most output —
and is counted at that, since its real cost cannot be read.

## Catalog v3 — the Agent Bank and the marketplace (B17.6)

One user in ten again, after catalog v2. A person works Agent Wallets (`/agents`) and the marketplace
screens; each agent acts with its own key, straight to Lens, as an agent does. Every oracle is read back
from Lens: the agents' book and postings, the approvals, the marketplace bill and the seller's earnings.

| Scenario | Who | Oracle |
|---|---|---|
| `agent-open-fund` | 1 in 10 | an agent created and funded on the screen holds exactly that; the workspace's balance is unchanged and = with agents + free |
| `sdk-wallet-quickstart` | 1 in 10 (after `agent-open-fund`) | the TypeScript SDK's README quickstart, with Lens's own `sdk/typescript` from `--lens-src`: the owner creates an agent, funds it 10 LXC, issues its key; the agent asks a model through `.openai()` with that key; the agent's statement opens on the fund line (+10,000,000 µLXC), then the call's hold, the settle that gives back what the answer did not use, and its platform fee at the plan's rate (B32.11), each line's balance following from the one before. `--lens-src none` skips it |
| `features-wallets-first` | 1 in 10 (after `sdk-wallet-quickstart`) | an agent created and funded on Agent Wallets has one fund line of exactly that on its statement; then Features opens on the Agent Wallets row, whose line names the agents and the LXC they hold as Lens's book has them, and its Marketplace row counts the listings Lens's catalogue holds |
| `agent-limit` | 1 in 10 | a limit per request of 0.000001 LXC refuses the agent's request (403, the limit named) with its balance and the ledger unmoved; raised to 1 LXC, the same request is served once from the agent's balance, which falls by its spend row and its platform fee row (B32.11) |
| `wallet-currency` | 1 in 10 (after `agent-limit`) | an agent funded 12.5 LXC on Agent Wallets: Lens's book has it holding exactly 12,500,000 µLXC and its row reads "12.5 LXC ($1.25)" at the peg; its Allowed models field is a select, the model picked there is the one model Lens stores in its rules, and the Rules card says "It may use only <that model>." |
| `agent-archive` | 1 in 10 (after `agent-approval`) | an agent funded 0.75 LXC and given a key is renamed and described on Agent Wallets, and Lens's book carries both; archived there, its account gains exactly ONE line — a withdraw of -750,000 µLXC leaving 0 — the workspace's agents hold that much less and the workspace the same, and its key is then refused with no new line on its account and no spend row on the ledger |
| `agent-rule-simulator` | 1 in 10 (after `agent-hourly-limit`) | an agent funded 2 LXC with a daily limit of 1 LXC asks Would it pass? on Agent Wallets of a 1.5 LXC payment to another of the workspace's agents and is told Refused, by the daily limit; of 0.5 LXC, Allowed — and neither agent's account gains a line, and the payer still holds 2 LXC |
| `agent-rules-rollback` | 1 in 10 (after `agent-rule-simulator`) | an agent's rules saved with a 1 LXC daily limit (version 1) and changed twice on Agent Wallets are rolled back to version 1 on Rules history: Lens's rules read is byte for byte version 1's, and its newest version is "rollback to 1" by the same credential that saved version 1, which the row reads as "by you" |
| `agent-limit-boost` | 1 in 10 (after `agent-rules-rollback`) | an agent funded 1 LXC with a daily limit of 0.000001 LXC has it raised on Limit boost to 1 LXC until a whole minute 1–2 minutes away: before then its question writes one hold posting and one spend row; from then on Lens lists no boost, its rules read is still 0.000001 LXC, and the same question is refused (403) by that daily limit with no posting and no spend row |
| `agent-pause-all` | 1 in 10 | Pause every agent refuses both agents (403, every agent paused) with nothing charged; started again, one is served |
| `agent-approval` | 1 in 10 | a 1 LXC payment above a 0.5 LXC approval amount waits in Approvals with nothing moved, Lens's approval and its row naming the payee and memo ("Payer N wants to pay Payee N 1 LXC — …"); Approve pays it once (one pay line, the approval used) |
| `company-payment` | 1 in 10 | an agent pays another company's agent with its own key: one line on the payer's marketplace bill (and on Your bill); the payee's pending earnings rise by exactly its 95% (a service: Talyvor takes 5%, B32.8), and nothing is payable or available before that bill is paid and the 14-day holdback passes |
| `marketplace-sale` | 1 in 10 | another company publishes a prompt at 0.5 LXC on Publish; this user uses it on its page: the right answer, one line on their bill, one spend row for the model it called, and the seller's pending earnings up by exactly their share |
| `statement-reconciles` | 1 in 10 | after funding, a payment, a take-back and a request, the statement downloaded from Agent Wallets: each account's opening + in − out = closing, every entry sums to zero, each agent closes at its balance, and spend = the ledger's spend row and the platform fee row beside it |
| `ledger-reads-correctly` | 1 in 10 (after `statement-reconciles`) | the Ledger's first page, right after that request's hold, release and charge: every amount and balance in LXC to six decimals with no µ, each balance the row below plus that row's amount, and every row shown a row of Lens's own ledger |
| `agent-balance-stored` | 1 in 10 (after `statement-reconciles`) | one agent funded 100 times at once, each a different amount, through Lens as the owner: the balance Lens stores and reads as one row equals the 100 postings on the downloaded statement and their sum, every funding sums to zero, the workspace's agents hold that much more, and Agent Wallets shows the same balance |
| `agent-spend-question` | 1 in 10 (after `agent-balance-stored`) | an agent funded 2 LXC pays another agent 1.23 LXC; asked in Chat what it spent today, the model answers through Lens's wallet tool (`wallet_agents_spend`, via the BFF's `/api/chat/tools/call`): its words say 1.23, the link under them is to exactly that pay line on Lens's statement and opens Agent Wallets with the row marked, and the agent's account has no new line. SKIP until Lens offers the tool (talyvor-lens B28.83) |

The other company is a user no other scenario reads the earnings of: 9, 19, … take a payment, 8, 18, …
sell. B34.1 — a workspace on Free holds three agents (LENS_PLAN_GATES): the other company, which up to nine
users open agents in at once, goes on Team with the test card the first time a scenario opens one there; a
scenario that opens agents of its own (`agents` in the catalog) first archives its workspace's oldest, as an
owner retires agents it no longer uses. A synthetic company's bill is never paid, so a sale or a payment stays pending: the scenarios check
it is pending, exactly, and not yet payable — the holdback itself is Lens's own test (B20.2, B20.5).

## Plans on a Stripe test card, and a pooled serve's royalty (B17.10)

Test users pay with Stripe test cards and earn royalties, every such row marked test — never paid out,
never counted in real totals (Nicolai, 30 Sep 2026; Lens B25.2). One user in ten again.

| Scenario | Who | Oracle |
|---|---|---|
| `plan-test-card` | 6, 16, … (last in the journey) | Plans → Choose Plus → Stripe's hosted checkout, paid with test card 4242 → back in the app; Lens's allowance for the period is granted, at Plus's 2000 cents. The plan is then cancelled at the end of its period |
| `pooled-royalty` | 7, 17, … with 9, 19, … | a question only this user has asked, asked again by another test user and served from the pool: the contributor's earnings ledger (`tokens/history`) gains a `pool_royalty_held` row. The partner asks 2 s after the answer (Lens pools it once its stream ends); not served, a second partner asks once, and not served twice is a FAIL — an answer that could be pooled never reached the pool |

The plan comes last and on a user nobody else asks as: what is asked after it is drawn from the allowance,
which the ledger read-back does not expect. In production it needs Lens's test-mode Stripe settings in
`lens.env` — `LENS_STRIPE_TEST_SECRET_KEY`, `LENS_STRIPE_TEST_WEBHOOK_SECRET` (Stripe test mode's webhook
to `/v1/billing/webhook/test`) and `LENS_STRIPE_TEST_SUBSCRIPTION_PLANS`; without them Plans says plans are
not on sale and the scenario FAILs with Lens's sentence naming what is unset.

## Catalog v4 — test users trade with each other (B25.4)

Every wallet, bank and marketplace function Lens made work for test users (B25.3), used between two test
companies. A person works Agent Wallets, a listing's page and Your listings & earnings; the other company
answers with its own token, straight to Lens. Every oracle is a row read back from Lens, on both sides.
Approvals, statements, listing, buying and the seller's earnings are catalog v3's.

| Scenario | Who | Oracle |
|---|---|---|
| `wallet-send-refund` | 0, 10, … with 9, 19, … | Send 1.5 LXC to the other company's agent: one transfer both companies read, the sender −1.5 and the receiver +1.5; the other company gives it back: one refund both read, both balances where they began |
| `wallet-give-back` | 0, 10, … with 9, 19, … | B28.23: the other company's agent sends 1.2 LXC to a new agent; on Agent Wallets → Transfers the person presses Give back, then Yes: one refund both companies read, the original marked given back, one −1.2 posting on the agent's account and one +1.2 on the sender's, both balances where they began |
| `wallet-request` | 1, 11, … with 9, 19, … | the other company's agent asks for 0.8 LXC; Accept under Requests: the request reads accepted on both sides, paid by one transfer both read, the balances moved by it |
| `market-review` | 2, 12, … with 9, 19, … | a listing that reads as a prompt injection is held on Publish, not in the other company's catalog and not readable by it, and in the moderators' queue; approved with the moderator key, it is approved and in the other company's catalog |
| `wallet-loan` | 3, 13, … with 9, 19, … | Offer a loan of 2 LXC at 10% over 2 daily instalments; the other company accepts: active on both sides, one payout transfer both read, the balances moved by the principal, the first instalment due a day after acceptance |
| `wallet-escrow` | 4, 14, … with 9, 19, … | Pay into escrow 1 LXC: held on both sides and out of both balances; Confirm delivered: released, the payee +1. A second of 0.5 LXC disputed: disputed on both sides, still held |
| `wallet-pots` | 5, 15, … | Create pot, move 1.2 in and 0.4 out: the pot holds 0.8, the agent the rest, and the book's pots count it |
| `wallet-cash-out` | 6, 16, … | Ask to cash out 0.5 LXC: held from the agent at once; paid by the test partner on Lens's tick, within four minutes |
| `wallet-recurring` | 7, 17, … with 9, 19, … | Start 0.25 LXC every day: Lens's tick pays the first at once — one run, one transfer both read — and a minute later nothing more; next due a day on. The schedule is then stopped |
| `market-takedown` | 8, 18, … with 7, 17, … selling | another company publishes; this user uses it (one bill line, the seller one more pending use), reports it on its page (in the moderators' queue with the reason); taken down with the moderator key: the bill line refunded, the seller's pending back where it was, gone from the catalog |
| `wallet-card` | 9, 19, … | Issue a test card: Lens holds one test-mode card for that agent, in pounds |
| `market-payout-connect` | 9, 19, … | Connect with Stripe on Your listings & earnings: the browser goes to Stripe's onboarding and Lens holds the seller's Connect account, not yet payable |

`webhook-replayed` needs the test-mode webhook's signing secret in `LENS_STRIPE_TEST_WEBHOOK_SECRET` (the same value Lens
boots with): it signs events as Stripe does, so it can send one again. Without it, it SKIPs.

`market-review` and `market-takedown` need a moderator key in `LENS_MODERATOR_KEY` (`lens moderator-keys
create`, inside the lens container; every use is recorded under the operator `e2e-testers`). Without one
they SKIP. What happens days later — a loan's instalment and its default (a day at the soonest), a payout (a
paid bill, then the 14-day holdback), the refund of a paid bill, and a purchase on the card (Stripe's
authorization) — is B25.8's, below.

## B34.4 — every wallet, agent and marketplace route has a tester

Every agent, wallet, escrow, loan, money-request, transfer, cash-out, marketplace and LXC route is reached by a
scenario (`src/routes.ts`), between the same two companies: the person through the app's BFF routes, called from
their signed-in page as the app calls them, and the other company (9, 19, …) on Lens with its own token. A Lens
route no BFF route reaches by its own path (the BFF's `/api/wallets/…` answer through `/money-requests`, `/loans`,
`/escrows`) is reached once each way, so both rows of the coverage map are. Money is read on both agents'
accounts: one posting on each side, both balances moved by exactly the amount, nothing else moved.

| Scenario | Who | Oracle |
|---|---|---|
| `wallet-requests-answered` | 0, 10, … with 9, 19, … | asked in the app, accepted on Lens: one transfer of 0.6 LXC both read, one posting each side; given back in the app; then one declined in the app and one on Lens: both read declined, nothing moved |
| `wallet-loans-answered` | 1, 11, … with 9, 19, … | four loans declined or withdrawn, two in the app and two on Lens, each read so on Lens by both sides, nothing moved; a fifth accepted in the app: the principal, one posting each side |
| `wallet-escrow-lens` | 2, 12, … with 9, 19, … | the other company pays into escrow on Lens, both read it held; confirmed on Lens: the payee +0.5 LXC; a second disputed on Lens stays held, nothing more moves |
| `wallet-handle-pause` | 4, 14, … with 9, 19, … | a handle set in the app names the agent on Lens (`GET /v1/wallets/@handle`) and money sent to it lands; paused in the app, its send is refused and nothing moves; resumed, one posting each side; claimed, Lens holds its owner |
| `wallet-schedule-topup-pot` | 5, 15, … with 9, 19, … | recurring transfers made and stopped in the app and on Lens before they run pay nothing; a top-up set in the app fills an empty agent to 2 LXC on Lens's tick from the workspace's free credits, one posting, then is removed; a pot locked in the app refuses to give back or be unlocked early, and does once its lock has passed |
| `wallet-card-freeze` | 2, 12, … | an agent's test card frozen in the app: Lens holds it frozen and a £0.40 purchase is declined, nothing leaves the agent; unfrozen in the app, the next is approved, one posting of what Lens says it cost. Unfreezing is asked even when freezing is refused, so both routes are reached |
| `agent-approval-denied` | 7, 17, … with 9, 19, … | a send above the approval amount waits; its challenge asked and denied in the app, nothing moves on either side; a rule template applied on Lens, a boost ended in the app, a push device added and removed (or, with pushes not configured, refused) |
| `wallet-trading-sim` | 5, 15, … | a simulated portfolio opened in the app and read on Lens: a market buy of 10 EUR fills at the quote and its cash leaves the portfolio, a limit order is cancelled in the app; the agent's account has no new posting |
| `lxc-convert-bonds` | 5, 15, … | LENS converted to LXC under the minimum (400) and beyond what was earned (402) is refused; provenance bonds, switched off (`LENS_H5_BONDS_ENABLED`), are refused; a $10 top-up's checkout goes to Stripe; neither the LXC nor the LENS ledger moves |
| `market-remix-licence` | 8, 18, … with 9, 19, … buying | a second version, a subscription offer and 10% royalty remix terms set on Lens; the other company remixes version 2 under a 1000 bps grant and publishes its remix with it as a parent: the lineage names that edge at 1000 bps; it subscribes, one line on its bill and one pending sale for the seller; cancelled, it stops renewing |

In the self-test each fails on a planted defect (stub-bank.ts and stub-lens.ts), one per scenario in the table's
order: `request-unpaid`, `loan-no-payout`, `escrow-dispute-pays`, `send-one-side`, `pot-lock-ignored`,
`freeze-ignored`, `approval-deny-pays`, `sim-fill-free`, `convert-free` and `licence-renews`.

## B34.5 — every screen and BFF route has a tester

The public board screen and every BFF route the 5 Oct self-test read "not covered" — and the plan change B34.1's
stale reason had excused — are reached by a scenario (`src/surface.ts`), once a run, from the screen a person uses. Each oracle is what Lens, Track or Docs stored, read
back afterwards. A route for something production has switched off (provider keys, pattern mining) is checked to
refuse and store nothing. The coverage map now records a BFF request when its answer arrives, not once its body has
been read: a revoke's or a restore's body the page never reads never "finished", so those routes read "not covered"
though a scenario had reached them.

| Scenario | Who | Oracle |
|---|---|---|
| `session-sign-out` | 0 | `/api/version`: the BFF and the bundle were built from one commit; `/api/workspaces` lists exactly the workspace Lens gives the token; an unknown `/api/` path is a JSON 404. Sign out in a second browser: that session's `/auth/me` reads signed out and its reads are 401, and the first browser is still signed in |
| `lens-convert` | 0 | the quote on Royalties is Lens's rate and minimum; under the minimum refused; with no spendable LENS the conversion is not offered and one asked for is refused (402), the LXC ledger, LXC balance and LENS balance unmoved — with LENS, one LXC posting of the amount and LENS down by the quoted cost |
| `wallet-fx` | 1 | an agent's 12.5 LXC shown in pounds and in euros ("Show amounts in"): its dollar value at Lens's peg at the rates the ECB published today, read from the ECB's own file, which `/api/fx` states too |
| `track-workspace-restore` | 1 | deleted on Workspace settings (its slug typed): Track holds it deleted with the day it goes, not live; Restore: live again with its issues |
| `wrong-answer-stored` | 2 | an answer served from the earlier one, marked Wrong answer: asked again it goes to the model, one spend row; Features' Delete everything stored: Lens holds no answer and no conversion for the workspace |
| `track-search-cycle-board` | 3 | Search issues finds the issue by its words alone; a cycle's progress line counts exactly what Track holds in it; a board published opens at `/board/:token` with Track's issues, signed out too; turned off, the link reads "This board isn't available" and Track no longer lists it |
| `pattern-mining-switch` | 3 | Routing pattern sharing switched on and off, Lens holds each; where Lens runs no pattern mining, no switch and an opt-in is refused, nothing stored |
| `docs-tools` | 4 | search finds the page by a word only it holds; its space reads as Docs holds it; pinned and unpinned in Docs' pins; Fix grammar, Write with AI and a suggested title, each saved, are what Docs holds; a changelog entry for a Track issue is the one Docs wrote |
| `chat-tool-guard` | 4 | Chat is offered only read-only tools — Lens's, as Lens lists them, and Track's and Docs' — and Track's `create_issue` marked as one that changes something, refused (409) without the person's yes; `wallet_send` through the tool route is refused; a read Lens does not offer says so; the ledger has not moved |
| `api-key-revoke` | 5 | a key made on API keys works on Lens; revoked there (its prefix typed), Lens no longer lists it and refuses it (401) |
| `byok-addon` | 5, on a workspace of its own | Team bought with the test card; Add BYOK to Team on Plans: Lens's subscription and plan hold the add-on and allow own keys; Remove BYOK: neither does; the subscription is cancelled after |
| `plan-change` | 7, on a workspace of its own | Plus bought with the test card; Switch to Pro and Move to Pro on Plans: Lens's subscription is on Pro, and its allowance is Pro's price with Plus's included usage moved toward Pro's by the share of the period left (Lens B18.14), as Lens's plans read states both; the subscription is cancelled after |
| `provider-keys` | 8 | an OpenAI key added on Settings is the one Lens holds (its last four) and gone once removed there; where Lens holds no provider keys (production today) Settings says so and one sent anyway is refused, nothing stored |

## B34.7 — every Lens setting and workspace-data route has a tester

The workspace's config and budgets, its switches and both previews, stored answers and deletion requests, provider
keys, guardrails, prompts, a catalog model, an issue's anomaly read and answer feedback, which the 6 Oct map read "not
covered", are reached by a scenario (`src/settings.ts`), once a run, each on a workspace of its own with that
workspace's own key or token. Each sets a thing, reads it back from Lens, sees it change what Lens does or records for
the next request, and sets it back; a served request is still one spend row at the catalog price. What only Lens's
operator may change (a workspace, injection patterns, fallback chains, local endpoints) is checked to refuse the
workspace and change nothing; batches (Lens refuses the lane until a batch is billed for what it used) and provider
keys (production holds no sealing key) are checked to refuse and move nothing.

| Scenario | Who | Oracle |
|---|---|---|
| `settings-config-budgets` | 2, on a workspace of its own | `rate_limit_rpm` 1 reads back: the next request served, the one after refused 429 naming it with nothing charged, served again once set back; a hard-blocking team budget made, read, listed and in `budgets/status` refuses a request naming the team (402, nothing charged) while one naming no team is served, lets it through once PATCH raises it, and is 404 once deleted; a request naming an issue is what `anomalies/issue/{id}` says it cost |
| `settings-operator-only` | 2, on a workspace of its own | POST /v1/workspaces, an injection pattern, a fallback chain, a local endpoint added, checked and deleted: each 401 "admin credentials required", the chains and endpoints unchanged and the pattern not taken for an injection; batch submit and status, and provider keys put and deleted, refused with nothing on the ledger; a catalog model reads back at its catalog price and an unknown one is 404 |
| `settings-switches` | 4, on a workspace of its own | logging none is stated on the next request (`X-Talyvor-Logging`) and an exact repeat is charged again, then the old policy again; the retired rewriter refuses 410 naming Tare; cost-optimised routing charges the model it says it used; distill pooling reads back; with `cache_poolable` off another workspace asking the same question is asked afresh, back on it is served from the pool at the price `X-Talyvor-Pool-Charged-ULXC` states |
| `settings-guardrails` | 4, on a workspace of its own | a word blocked by PUT /v1/guardrails/policy, and by POST then PATCH …/guardrails, reads back, is caught by POST /v1/guardrails/check and is redacted from the next request (`X-Talyvor-Guardrail-Redacted`), served at the catalog price; DELETE reads back the default and the word passes |
| `settings-tare-distill` | 6, on a workspace of its own | Tare reduces forty same-shaped rows (`X-Talyvor-Tare: applied`) and records the saving against the work item named; disabled it does not; the Tare model shortens prose in the preview only when on; the rows' preview keeps every field name; a memo attached as an HTML document is converted (`X-Talyvor-Distill: applied`) and counted in `distill/usage`, disabled it is not and nothing stays held; the conversion preview gives the memo's heading and code |
| `settings-stored-answers` | 6, on a workspace of its own | an answer is stored and its exact repeat served free; marked `negative` with POST /v1/feedback it is removed and the next repeat is charged; deleting everything stored (scope all, the workspace's name) zeroes the counts and the next repeat is charged; a deletion request is filed once and listed as requested |
| `settings-prompts` | 6, on a workspace of its own | a prompt made, read and listed is used by a request whose system prompt names it (`X-Talyvor-Prompt-Resolved`) and the model follows it; a second version, the history and the diff, and the next request follows it; rolled back, the next follows the first |

## B34.8 — evals, outputs, attribution, nodes and switched-off features have testers

Lens's evals, output verdicts and attribution, attribution by branch and by pull request, compute, cache and embedding
nodes, PoVI receipts, challenges and stakes, annotation stakes and tasks, LENS transfers, pattern mining, the audit
webhook and credits bought, which the 7 Oct map read "not covered", are reached by a scenario (`src/economy.ts`), once a
run, each on a workspace of its own with that workspace's own key or token. What Lens runs is checked on what it stores:
made, read back, and seen where Lens says it is. What it has switched off — the token exchange and LENS staking (B18.1),
artifacts without `LENS_H5_ARTIFACT_ENABLED`, pattern mining — is checked to refuse and move nothing: the LXC ledger, the
LENS balance and the LENS history as they were. Every model call is a charge on the ledger.

| Scenario | Who | Oracle |
|---|---|---|
| `evals` | 1, on a workspace of its own | a case made with a tag is listed by it; a run of the tag stores one result, read back by run, results, `/v1/eval/runs` and `/v1/api/eval/runs`; a dataset made and listed takes a case, refuses a run past its cap (402, nothing moved), runs within it and is listed; a schedule made switched off is listed; each run that asks a model is a spend row on the workspace's ledger; an eval for the pool is attested by another company, refused to its author (403), 404 when unknown, and no LENS moves |
| `lens-tokens` | 1, on a workspace of its own | the rates and the four mining reads answer for the workspace; an annotation stake with no LENS is 402 and unstaking nothing moves nothing; no task is answered; a LENS transfer to another company with none to send is 402; the token exchange and LENS staking routes are 404; pattern mining, switched off, refuses the opt-in and reads not opted in, and opting out reads out; nothing moves on either company |
| `outputs-attribution` | 3, on a workspace of its own | one request naming a branch, a pull request, a repository, a commit and an author is one charge at the catalog price, counted at that charge in the workspace's branches, the branch, the pull request (with its commit and author), the summary, the repository's branch and its top branches; an output Lens names takes a mechanical verdict and an attribution, read back, and refuses a second (409); an output the workspace never produced is refused both (403) and has no attribution (404); an artifact, switched off, is 404; the audit export starts for a webhook (202) and is refused without one (400); nothing else is charged |
| `nodes` | 3, on a workspace of its own | a compute, a cache and an embedding node at an address nothing answers at are registered, listed unverified and offered for their model to nobody; each heartbeat is taken from its owner and refused (404) for a node that does not exist and for another company; another company cannot remove one; removed, each lists inactive; nothing is charged or minted |
| `povi` | 5, on a workspace of its own | a node registered with an ed25519 key signs a receipt: verified and recorded, nothing minted; one altered after signing is recorded unverified; a challenge on the signed one is recorded against the node, read back three ways, never issued twice, 404 to another company; a stake of LENS the workspace does not have is refused, unbond and release are refused with nothing staked, another company cannot stake the node; nothing is charged, minted or slashed |
| `credits-top-up` | 8, on a workspace of its own | the testers' key puts the workspace on Team and back on Free, and Lens holds it to each; a top-up below $10 is refused (400) with nothing moved; $10 paid with Stripe's test card is one credit of exactly 100 LXC on the ledger, and the balance moves by exactly that |
| `ledger-moves-at-once` | 2, on a Team workspace of its own | B28.279 — an agent funded 0.5 LXC, then funded 20 times and withdrawn from 20 times at once through Lens as the owner, each a different amount under its own Idempotency-Key, with one funding and one withdrawal each sent 4 times at once under one key and once more after: every move answers 200; the agent holds exactly what the moves add up to, as Lens stores it, as its postings sum and as the workspace's statement closes; each replayed key wrote one posting; every entry sums to zero; the workspace's balance never moved and its agents hold exactly that much more. Self-test: `STUB_BREAK=move-replay` (a key sent again posts again) and `STUB_BREAK=move-race` (a withdrawal landing beside another move answers 200 and posts nothing) FAIL it |
| `ledger-call-once` | 2, on a Team workspace of its own | B28.279 — an agent funded 1 LXC on a key of its own sends one request twice at once and once after under one Idempotency-Key (past the cache), then streams an answer it hangs up on as soon as its first words arrive: each is one charge on the agent's statement (a spend, or a hold and the settle that closes it) and one spend row on the workspace's ledger, whose spend and platform fee debit what the agent was charged, within 90 s; the agent then holds its funding less exactly those, its statement's last balance agrees, the workspace's balance fell by them and its free balance did not move. Self-test: `STUB_BREAK=call-replay` (each copy charged) and `STUB_BREAK=hangup-unbilled` (a stream hung up on is never billed to the agent) FAIL it |
| `webhook-unsigned` | 2, on a workspace of its own | B28.280 — a `checkout.session.completed` paying the workspace $10, sent to Stripe's live and test-mode webhooks (`/v1/billing/webhook`, `/v1/billing/webhook/test`) with no Stripe-Signature and under one from a secret the testers made up: each is refused (4xx), and the ledger takes nothing and the balance does not move. Self-test: `STUB_BREAK=webhook-unsigned` (any signature, or none, is taken) FAILs it |
| `webhook-replayed` | 2, on a workspace of its own | B28.280 — on the test-mode webhook, signed with `LENS_STRIPE_TEST_WEBHOOK_SECRET` (the value Lens boots with; without it this SKIPs): a $10 top-up signed ten minutes ago and one past Lens's 1 MiB cap are refused with nothing taken; one signed now, delivered 3 times at once and once more after, and its session again as `checkout.session.async_payment_succeeded` under a new event, are each answered 2xx and are one credit of exactly what $10 buys on the ledger, and the balance moves by exactly that. Self-test: `STUB_BREAK=webhook-stale`, `webhook-oversized` and `webhook-replay` each FAIL it |
| `injection-exfil` | 4, on a workspace of its own | B28.284 — a document pasted into Chat tells the model to call `run_command`, `fetch_url`, `wallet_send` and `room_post`, to call `wallet_agents_spend` with a webhook, a callback and another workspace's id, and to answer with its API key and an image; every address points at a trap, a local HTTP server the run starts. Obeyed (the browser makes the model's answers up, so nothing is charged): every tool but `wallet_agents_spend` is refused (400), no tool's answer and nothing the model is told back carries the workspace's token, its own live key or anything shaped like a key, no image, frame or script in the answer names the trap, nobody reaches the trap and the ledger does not move. Asked of the run's real model: the same, and the ledger moves by the model's charge alone (a refusal by Lens's injection guardrail is as good). Self-test: `STUB_BREAK=tool-fetch` (a tool reaches the addresses its arguments name) and `tool-key` (a tool's answer carries the key it was called with) each FAIL it |
| `agent-rules-unbypassable` | 6, on a Team workspace of its own | B28.281 — a funded agent's own key tries what its rules forbid: a request over a daily limit of 1 µLXC, one outside its hours (an hour starting two hours from now, UTC), one to a model and one to a provider it may not use — each sent plain and streamed, Lens's two copies of the proxy — a use of a listing it may not use, and a payment above its approval amount. Each is refused (403) naming its rule, and the agent's statement, the payee's, the workspace's ledger and both balances do not move. Its own key's PUT of open rules on itself is refused and the daily limit stays. With the rules opened, the same key is served and charged once on the statement and the ledger. Self-test: `STUB_BREAK=rules-stream` (a streamed request skips the rules) FAILs it |
| `ssrf-refused` | 8, on a workspace of its own | B28.285 — the cloud metadata address (169.254.169.254, and AWS's `fd00:ec2::254`), Lens's own port on loopback, and a trap (a local HTTP server answering 200) on loopback, `localhost`, IPv6 loopback and this machine's private address, each given as a compute node and as the audit-export webhook. Each is refused when given (4xx) or taken and never reached: after 10 s no node is verified (Lens verifies a node when its probe answers 2xx, and each address ends in `?probe=` so the probe lands on a path that does), none is offered for its model, and nobody reaches the trap. On production the trap is out of Lens's reach, so the nodes aimed at Lens's own `/healthz` and the metadata address are what bite. Self-test: `STUB_BREAK=ssrf` (nodes and the webhook dialled wherever they point, the metadata address answering) FAILs it |
| `file-bomb-bounded` | 8, on a workspace of its own | B28.285 — Lens's document preview (`POST /v1/workspaces/{ws}/distill/preview`) is sent a 260 KB `.docx` whose document unpacks to 256 MiB, then a `text/plain` document one byte over the 25 MiB cap. Each is refused (4xx, or the upload cut off) or capped (200 with at most 25 MiB unpacked) within its time; Lens's `/healthz` answers after and its uptime shows no restart (unless its version changed meanwhile); a plain `.docx` converts to its paragraph before (the control) and after. Self-test: `STUB_BREAK=zip-bomb` (unpacked however large) and `doc-size` (any size taken) each FAIL it |
| `csrf-refused` | 1, on a workspace of its own | B28.286 — the session cookie the browser holds is `__Host-talyvor_session`, Secure, HttpOnly, SameSite Lax or Strict, Path `/`, for the app's host alone, and `document.cookie` does not show it; on an https app, sent to the plain-http address it is never answered 2xx and is redirected only to https. With the cookie attached, `POST /api/keys` from another site, with no Origin, with Origin `null`, from the app's host on the other scheme, from a look-alike host (`<host>.evil.example`) and from a sibling subdomain is each refused 403, and so is `DELETE /api/keys/{id}` from another site; a page on another site (a local server), opened in the signed-in browser, posts a `text/plain` form shaped as the mint's JSON to `/api/keys` and is refused 403. Lens lists no key any of them names. The control: the same mint from the app's own Origin is taken, and its key is still there to be revoked from the app's own Origin after |
| `script-inert` | 1, on a Team workspace of its own | B28.286 — an answer in Chat (made up in the browser, so no model is asked and nothing is charged) carries a `<script>`, `<img onerror>`, `<svg onload>`, `<iframe srcdoc>`, `<details ontoggle>`, an HTML `javascript:` link and Markdown links to `javascript:` (and mixed case), `data:` and `vbscript:`, and the same in a table cell, a quote, a list item, a heading, inline code and a code block; a private room's message, stored by Lens, carries the same as plain text. Each payload sets a flag on the page if it runs. The answer shows its `<script>` as text and the room shows the message; no flag is set in the page or any frame, no dialog opens, and neither the answer nor the room's messages hold a script, frame, object, form, event-handler attribute, `srcdoc`, or a link or source to a `javascript:`, `data:` or `vbscript:` address |
| `keys-unlisted` | 9, on a workspace of its own | B28.287 — a key of every kind the workspace holds is made: an API key (`…/api-keys`), the new key of a rotation begun on it, a key from `POST /v1/api/keys`, a session key, an agent's key, its token, and an OpenAI-shaped provider key (where Lens stores one). The API key reads its workspace (the control) and asks one question. Then every list and stats read that could name a key — on Lens the keys, a key's usage, the rotation, the workspace, `/v1/auth/me` (on each key too), provider keys, the shared key pool, agents and their statements, sessions, every spend and usage read, current-month spend, budgets, tokens and the audit export; in the app `/api/keys`, `/api/agents`, `/api/provider-keys` and `/auth/me`, and the API keys screen itself — must hold no key whole, without its prefix or as its SHA-256 (hex or base64), and nothing shaped like a Talyvor, provider, Stripe or AWS key. Both key lists must show the API key by its prefix. A read this Lens does not serve is named, not failed. Self-test: `STUB_BREAK=key-listed` (the key list shows each key whole) FAILs it |
| `keys-not-forwarded` | 9, on a workspace of its own | B28.287 — a synthetic upstream (a local server speaking OpenAI's chat API on `--upstream-port`, recording every request) stands where Lens sends its vLLM traffic. The workspace's API key, its token and a session key are each sent to `/v1/proxy/vllm` in Authorization, X-Talyvor-Key, X-API-Key and Proxy-Authorization at once, and in X-Talyvor-Key and in X-API-Key alone, plain and streamed (Lens's two copies of the proxy). Each request served must reach the upstream; the upstream must see none of the three, nor their SHA-256, nor anything shaped like a Talyvor key, in a header, its address or its body; and Lens's answer must carry none back. With all of them in Authorization the request must be served. SKIPs without `--upstream-port`, or when Lens answers that it has no vLLM upstream. Self-test (`E2E_UPSTREAM_PORT=10287`): `STUB_BREAK=key-forward` (a plain request's X-Talyvor-Key and X-API-Key go on) and `key-forward-stream` (a streamed one goes on with every header it came with) each FAIL it |
| `rate-limits-hold` | 7, on a workspace of its own | B28.288 — the workspace's own token reads the workspace (`GET /v1/workspaces/{ws}`) once, served (the control), then sends 150 reads at once, up to 4 times, until one is refused. None refused is the FAIL: Lens's limiter (100 a second a key, counted in Redis) let the burst through, as it does when Redis errors and it fails open. Each refusal must be 429 with Retry-After in whole seconds of at least 1, X-RateLimit-Remaining 0, and the window it hit (`limit_type`) and the same seconds (`retry_after_seconds`) in its body; anything but 200 or 429 is named. Once the longest Retry-After has passed (at most 61 s) the next read must be served. A read moves no money. Self-test: `STUB_BREAK=ratelimit-open` (every request let through) and `retry-after` (refused with no Retry-After) each FAIL it |
| `market-discovery` | 5, on a workspace of its own and a curator it makes | B32.90 — Lens's discovery (B32.50). The seller publishes extract at $0.04 a use and $0.06 (capabilities on the publish) and summarize at $0.01 (`PUT …/capabilities`), each priced by a per-use commercial offer; a listing the similarity check holds is approved by the operator first. `GET /v1/marketplace/search?capability=extract&max_price_per_use=50000` must find the $0.04 one and neither other, every hit declaring extract and billed at most 50000 µUSD; controls: with no price the $0.06 one is found, by `capability=summarize` the summarize one. The curator's public collection of the summarize and the $0.06 listings, in that order, must read exactly those two in that order; featured by the operator (`POST /v1/admin/marketplace/collections/{id}/feature`), it must be the first of `GET /v1/marketplace/collections`, ahead of an unfeatured one made after it. Every `sort=trending` hit must carry `distinct_buyers_7d` and `trending_score` (computed nightly). Both collections are deleted after; nothing is bought. Needs `LENS_MODERATOR_KEY`, else SKIP. Self-test: `STUB_BREAK=search-price`, `search-capability` and `featured-last` each FAIL it |
| `rooms-moderation` | 3, on a workspace of its own and the reporters it makes | B32.91 — room safety (Lens B32.52). The owner opens a public room under a topic of the run's own and posts in it; as many new workspaces as the operator's queue's `hide_at` (`LENS_ROOM_REPORTS_HIDE`, default 3) report it — the first its message, the rest the room — and it must stay in `GET /v1/rooms?topic=` until the last report and leave it after, `GET /v1/rooms/{id}` reading `under_review`. The operator keeps it (`POST /v1/admin/rooms/{id}/moderate`) and it must be listed again. A member that joined and posted is banned by the owner (`PATCH …/members/{ws} {banned: true}`) and its next post must be 403. The operator closes the room: another member's post and a run paid by the room (`POST …/runs {pay: room}`) must be 409, and the room wallet's statement must gain no line. Each moderate answer's `operator_audit` row must be `room.keep` / `room.close` on the room by `e2e-testers`; `GET /v1/admin/operator-audit?target=` is checked too where the moderator key may read it. The room is closed at the end whatever happened. Needs `LENS_MODERATOR_KEY`, else SKIP. Self-test: `STUB_BREAK=room-reports`, `room-ban` and `room-close` (refused, and spent anyway) each FAIL it |
| `room-invite-screen` | 6, on a Team workspace of its own and user 7 | B28.295 — the invite link's own screen. The owner opens a private room on Lens and saves a default price of $0.02 on its settings (`PUT /api/rooms/{id}/terms`): Lens's terms must be the next version at 20,000 µUSD. A one-use link is made; user 7, signed in as another company, first asks the BFF to join the room by its id (`POST /api/rooms/{id}/join`) and must be refused with no membership on Lens; then opens `/rooms/invite/:token`, which must show the room's title and Lens's terms (that version, $0.02 a use), ticks the terms and presses Join room (`POST /api/room-invites/{token}/join`): it must land on the room, be a member on Lens on that terms version, and the invite must read used once and no longer live. Opened again, the link's screen must say it admits no one and Lens's `GET /v1/room-invites/{token}` must be 404. Screenshots of the link's screen at 1440 and 390. Self-test: `STUB_BREAK=room-invite-uses` (a used link admits again) FAILs it |
| `room-decide-run` | 6, on a Team workspace of its own | B28.295 — the room screen's Accept and Run. The owner proposes a prompt needing `{{word}}` on Lens and presses Accept on its card (`PATCH /api/rooms/{id}/contributions/{cid}`): Lens's `GET /v1/rooms/{id}/contributions/{cid}` must read accepted and the card be marked Accepted. Run on me without `word` (`POST /api/rooms/{id}/runs`) must be refused 400 naming the variable, before any model is asked; the run panel must then ask for `word`; and after five seconds the owner's ledger must have no new row and the room no new run message. Screenshots of the refused run panel at 1440 and 390. Self-test: `STUB_BREAK=room-decide` (Accept changes nothing) and `room-run-variables` (the run goes ahead) each FAIL it |

## B25.8 — the slow money, brought due inside the run

Lens (B25.7) brings a test workspace's slow money due now, with the synthetic key: a loan's next instalment,
the buyer's bill paid (its earnings past the holdback) and refunded, a purchase on an agent's card. Each
scenario then reads the rows back on both sides. A buyer or seller here buys and sells in no other scenario.

| Scenario | Who | Oracle |
|---|---|---|
| `wallet-loan-repay` | 0, 10, … with 9, 19, … | Offer 2 LXC at 10% in one weekly instalment; accepted by a borrower already holding the 0.2 interest; brought due: within four minutes Lens's tick takes 2.2 LXC in one transfer both read, the loan reads repaid on both sides (`payout,instalment`), the lender +0.2 and the borrower 0 |
| `wallet-loan-default` | 1, 11, … with 9, 19, … | 2 LXC over 2 daily instalments; the borrower takes the principal back out of its agent; brought due: missed, late; due again: missed, defaulted — on both sides (`payout,missed,late,missed,defaulted`), and only the payout moved |
| `wallet-card-purchase` | 2, 12, … | Issue a test card to an agent holding 20 LXC; a £0.50 purchase: approved, one record on the card with its amount, currency and merchant, the agent −exactly what Lens says it cost, and Agent Wallets → Card lists it Approved |
| `market-payout` | 3, 13, … buying from 6, 16, … | the seller publishes with its own token; this user uses it on its page; the bill paid: the line reads paid and the seller's share is payable; the seller presses Take … as credits on Your listings & earnings: one credits payout of what was available, its credits one row on the seller's ledger, nothing left available |
| `market-bill-refund` | 6, 16, … buying from 1, 11, … | used and the bill paid as above, then refunded: the use reads refunded on the buyer's bill, and the seller's earning from it is reversed — out of what is available, into refunded |
| `market-journal` | 5, on a workspace of its own buying from a seller it makes | B32.75 — the seller's journal (Lens B32.17). A new seller publishes at 1 LXC a use; this workspace uses it on its page and its bill is paid as above. The earning row (`GET …/marketplace/earnings`) must be the share at the take Lens states. Right after, `GET /v1/workspaces/{seller}/marketplace/journal` must read `reconciled` true with the share either due for release (in `holdback_usd_micros` and `due_for_release_usd_micros`, none available) or already in `available_usd_micros`; polled for up to 6 minutes (Lens's release job runs every 5), the holdback must reach 0, and then the journal's available must equal the earnings' `available_usd_micros` and the share, and still reconcile. Self-test: `STUB_BREAK=journal-off` and `journal-unreconciled` each FAIL it |
| `market-offers` | 7, on a workspace of its own buying from a seller it makes | B32.76 — a listing sold through its offers (Lens B32.18). A new seller publishes a prompt listing with four commercial offers in the publish: per use at 100000 µUSD, a 30-day rent, a buy, and a 30-day subscription with 100 included uses. This workspace reads `GET /v1/marketplace/listings/{id}` and must see exactly those four on their terms, each saying what its licence allows. The seller's `PUT …/listings/{id}/offers` with a second commercial rent beside the first must be refused 400 and leave the four as they were. This workspace uses the listing on its page: one line on its bill at 1000000 µLXC; the seller raises the per-use offer to 150000 µUSD; used again, the bill (`GET …/marketplace/bill`) must keep the first line at 1000000 µLXC and carry the second at 1500000. Self-test: `STUB_BREAK=offers-duplicate`, `offer-price-stale` and `offer-price-backdated` each FAIL it |
| `market-rent` | 9, on a workspace of its own buying from a seller it makes | B32.78 — a listing rented and used under its licence (Lens B32.19). A new seller publishes a prompt listing with a per_use commercial offer at 100000 µUSD and a 30-day commercial rent at 1500000 µUSD. This workspace rents it (`POST …/marketplace/listings/{id}/licences {offer_id}` with an Idempotency-Key): 201; the same request again must answer 200 with the same licence, and the bill (`GET …/marketplace/bill`) must hold one line, the rent's, at 15000000 µLXC. It uses the listing three times — the first on the listing's page, which must answer the sum and say "Covered by your licence" (B32.57), the other two through `POST …/marketplace/listings/{id}/use`: the bill must still hold that one line, and `GET …/marketplace/licences` must read the rent active with `uses_covered` 3, ending 30 days after it starts (a rent lasts a day at the shortest, so a run sees when it ends, not the end). On a second listing this workspace rents a personal licence only; an agent's key in it uses that listing and must be billed per use: one 1000000 µLXC line carrying the agent's id. Self-test: `STUB_BREAK=licence-replay-buys`, `licence-use-billed` and `licence-covers-agent` each FAIL it |
| `market-trial` | 1, on a workspace of its own buying from a seller it makes | B32.79 — a listing's free trial uses, on test money (Lens B32.21). A new seller publishes a prompt listing with a per_use commercial offer at 100000 µUSD giving `trial_uses` 3, and this workspace must read the offer with its 3 trial uses. It uses the listing four times (`POST …/marketplace/listings/{id}/use`): the first three must answer `trial: true`, charge `trial` at 0, `trial_uses_left` 2, 1, 0 and `would_have_cost_usd_micros` 100000; the fourth must answer no trial, billed at 1000000 µLXC. The bill (`GET …/marketplace/bill`) must hold exactly one line, the fourth use's, at 1000000 µLXC; paid as above (one use cleared), the seller's earnings (`GET …/marketplace/earnings`) must hold the fourth use's share at the take Lens states and nothing from a trial use. Self-test: `STUB_BREAK=trial-billed`, `trial-earns` and `trial-endless` each FAIL it |
| `market-agent-commitment` | 0, on a workspace of its own buying from a seller it makes | B32.80 — an agent's licences within its mandate (Lens B32.22). A new seller publishes a prompt listing with a 30-day commercial rent at 1500000 µUSD (15 LXC), a 30-day enterprise rent at 2500000 µUSD (25 LXC) and a 30-day commercial subscription. An agent whose rules (`PUT …/agents/{id}/rules`) set `max_commitment_ulxc` 20000000 rents the commercial one with its own key (`POST …/marketplace/listings/{id}/licences {offer_id}` with an Idempotency-Key): 201; the enterprise rent must be refused 403 naming `max_commitment_ulxc`, and the subscription 403 naming `may_subscribe`. A second agent with `approval_above_ulxc` 10000000 rents the commercial one: 403 with an `approval_id`; the owner approves it (`POST …/agents/approvals/{id}/approve`), the same request again answers 201, and a second rent is refused 403 with a new approval. The bill (`GET …/marketplace/bill`) must hold exactly the two 15000000 µLXC rents, each carrying its agent's id, and `GET …/marketplace/licences` exactly the two licences. Self-test: `STUB_BREAK=commitment-unjudged`, `subscribe-unjudged`, `licence-refused-kept` and `approval-buys-twice` each FAIL it |
| `market-agent-mcp` | 2, on a workspace of its own buying from a seller it makes | B32.81 — an agent shopping the marketplace over MCP with its own key (Lens B32.23). A new seller publishes a prompt listing with a per_use commercial offer at 50000 µUSD, a 30-day commercial rent at 1500000 µUSD and a 30-day enterprise rent at 2500000 µUSD (5 seats), and a second listing with only a per_use commercial offer at 50000 µUSD. An agent whose rules set `max_commitment_ulxc` 20000000 calls `POST /mcp` (JSON-RPC `tools/call`) with its own key: `market_search` must find the first listing, `market_listing` give its offers, `market_license` rent the commercial one with an `idempotency_key`, and `market_license` on the enterprise rent answer isError naming `max_commitment_ulxc`. `market_use` on the first listing must answer charge `licensed`, and on the second with `max_price_usd_micros` 50000 `billed`; the seller raises that offer to 100000 µUSD (`PUT …/listings/{id}/offers`) and the same use must answer isError naming `max_price_usd_micros`. The bill (`GET …/marketplace/bill`) must hold exactly the 15000000 µLXC rent and the one 500000 µLXC use, each carrying the agent's id, and `GET …/marketplace/licences` exactly the one licence. Self-test: `STUB_BREAK=commitment-unjudged`, `licence-refused-kept`, `licence-use-billed`, `max-price-ignored` and `max-price-kept` each FAIL it |
| `tax-and-payouts` | 3, on workspaces of its own: a seller and three buyers it makes | B32.66 — tax and weekly payouts (Lens B32.39–B32.42). A new seller publishes a $10.00 30-day commercial rent; a GB consumer, a DE business with a valid VAT number (DE123456789) and a US buyer each declare their tax profile and rent it. Once metered, each bill line must carry its tax as the Test tax partner's fixture rows decide it — the GB consumer standard at 2000 bps, 2,000,000 µUSD (not_registered at 0 on a Lens holding no GB registration, said, not failed); the DE business reverse_charge at 0 with the reverse-charge note; the US buyer not_registered at 0 — and each bill's gross its net plus its tax. Each bill paid, its one receipt (`…/marketplace/receipts`) must be in the test series, its line the bill's line, its gross net plus tax, reverse charged for the DE business alone. The seller's journal must hold the three shares available and reconcile, and the week's statement the three sales, Talyvor's fee, net 0 and the VAT collected — the tax the buyers' meter events billed. The seller, with no tax details, must be withheld by the payout run (`POST /v1/synthetic/workspaces/{ws}/marketplace/payouts/run`, talyvor-lens B32.99) with nothing moved; completed (`PUT …/marketplace/seller-tax`), the next run must pay the whole $25.50 less Stripe's fees, the journal's available fall by exactly its gross to 0, and the week's statement name it, its lines summing to its net. SKIPs after the tax half while Lens has no LENS_PROVIDER_SECRET_KEK or no synthetic payout run. Self-test: `STUB_BREAK=tax-reverse-charged`, `receipt-total-off` and `payout-hold-ignored` each FAIL it |
| `market-trust` | 4, on workspaces of its own: a seller and four workspaces it makes | B32.89 — the trust panel (Lens B32.49). A new seller publishes a prompt listing with one per_use commercial offer at 100000 µUSD. A workspace that never paid reviews it (`PUT …/marketplace/listings/{id}/review`) and must be refused 403. Two buyers each make one use (`POST …/listings/{id}/use`), which must be billed at 1000000 µLXC and be the one line for the listing on their bill (`GET …/marketplace/bill`, market_uses), and review it 5 and 3; the seller replies to the 3 (`PUT …/reviews/{id}/reply`). A fourth workspace is linked to the seller by one card (`POST /v1/synthetic/workspaces/{ws}/card-link`, talyvor-lens B32.102), makes a billed use, and must be refused 403. The workspace refused first then pays for a use. The trust read (`GET /v1/marketplace/listings/{id}/trust`, market_reviews) must count 2, average 4, stars [0,0,1,0,1], its recent reviews exactly the two written, the reply on the 3 — a row the refused review wrote would count once its writer paid, so it shows none was; a linked buyer's row is hidden from every read, so its refusal is its 403 and the count. MCP `market_listing`, on an agent's own key, must answer the same trust. SKIPs after the rest has passed while Lens has no synthetic card link. Self-test: `STUB_BREAK=review-refused-kept`, `review-linked` and `trust-mcp-unreplied` each FAIL it, and `card-link-missing` SKIPs it |

## Self-test

`pnpm --filter @talyvor/e2e selftest` runs the whole harness on this machine. It uses a stand-in Lens
(`selftest/stub-lens.ts`), the real BFF built from this checkout, and the real web bundle.
Track and Docs are stood in for by `selftest/stub-products.ts`.
`STUB_BREAK=<name>` plants a defect, which must make the matching scenario FAIL: `price`,
`cross-replay`, and for catalog v2 `pii`, `injection`, `distill`, `tare`, `conversion`, `budget`,
`setting`, `logging` (stub-lens.ts), `docs-ai`, `track-ai`, `export` (stub-products.ts) and, for
catalog v3, `agent-limit` (stub-bank.ts, the stub's Agent Bank and marketplace), and for B17.10 `subscribe`
and `royalty` (stub-lens.ts, which stands in for Stripe's hosted checkout too), for B29.29 `roi-brand`
(stub-lens.ts, which serves an ROI report Lens's own renderer wrote, `selftest/roi-report.html`), each file
saying what each breaks. Catalog v4's sixteen and B25.8's five (`loan-repay-lost`, `loan-default-never`, `card-free`,
`payout-uncredited`, `bill-refund-kept`; stub-bank.ts) may be named together, comma-separated, one per scenario.
The run clones talyvor-lens's main beside its results, for the coverage map and `lens-reads`
(`E2E_LENS_SRC` names a checkout to use instead).

The stub answers each read the way a real Lens does (B26.24). `selftest/lens-shapes.json` records the
status and the JSON shape of every read in `READS` (`selftest/lens-shapes.ts`), as a real Lens answered
it. `test/stubLens.test.ts` runs in CI and fails on any field Lens sends that the stub leaves out or
sends as another type. A route the stub does not know answers 404. When the BFF asked for one, the
self-test fails and names it. To teach the stub a route, answer it in `stub-lens.ts` and add it to `READS`.
Then re-record with `selftest/record-lens-shapes.ts`, against a Lens built from main; the file says how.
`E2E_FAULTS=1` (B26.18) kills the run's browser after a few verdicts. After a user passes on the browser that
replaced it, it stops the stub Lens. Then it checks that the report and TESTERS.md say the run stopped early,
name ECONNREFUSED and the browser that went away, and state the spend; and that the run exits 1.
