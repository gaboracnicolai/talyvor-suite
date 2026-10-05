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
| `--testers-md` | `E2E_TESTERS_MD` | `~/talyvor-queue/TESTERS.md` | where the run's short summary goes; `none` writes none |
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
   the B17 series, `repo:` the repo it is looked for in first, `status: OPEN` — unless an item that is
   not DONE already carries its `e2e-scenario: <id>` line. So a second run files nothing new for the
   same failure, and a failure that returns after its item is DONE is filed again. An ERROR (the
   harness could not reach a verdict) is in the report but files nothing.

**The cap is hard.** Every question reserves its worst case before it is sent: its whole input plus
4,096 output tokens at list price. When the answer arrives, the reservation is settled with the real
cost. A question whose worst case would take committed spend plus in-flight reservations past the cap
is never sent. From then on the run sends nothing new and every remaining scenario SKIPs.

## Every night, and the explorers (B17.5)

`scripts/e2e-nightly.sh` is started once, like `~/talyvor-queue/deploy.sh`, and left running:

```sh
nohup scripts/e2e-nightly.sh >/dev/null 2>&1 &      # each night at E2E_NIGHTLY_AT (default 03:00)
scripts/e2e-nightly.sh --now                         # one run now
```

Before each run it reads `~/.config/talyvor/e2e.env` (`E2E_ENV_FILE`), which holds `LENS_SYNTHETIC_KEY`,
`E2E_APP_URL`, `E2E_LENS_URL` and any other `E2E_*` setting. It then brings the checkout up to main, if the
checkout is on main, and runs the harness with 10 explorers for 30 minutes each by default. Everything
runs under the one cap. It logs to `e2e/out/nightly.log`. A second start exits and leaves the first
running. It never deploys, pushes or commits.

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

Each entry ends in one state: **covered** (the scenarios that reached it, ×users), **explorers only** (nothing
with an oracle checked it), **cannot be tested yet** (and why — an operator screen, Lens's admin key, a Stripe
checkout until B25.2, a wallet action between test users until B25.3/B25.4), or **not covered**.

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

| Scenario | Who | Oracle |
|---|---|---|
| `every-screen` | 1 in 10 | every screen a customer can open (from the map, operator screens left out), opened as a person does — a screen with a parameter from the first link on the one above it: the console's heading names it (a public page shows a heading), nothing says "Nothing at this address", and while it loads there is no page error and no 5xx |
| `lens-reads` | 1 in 100 | every Lens read a customer's key can make (GET, no parameter but the workspace, from the map) answers within 15 s, never with a 5xx; 401/403/404 are counted, not failed |
| `brand-visual` | user 2, once a run | B29.21 — `/marketing`, `/pricing` and `/signin` signed out and `/` signed in, at 1440×900 and 390×844 in the dark theme and the light one: each view's first screen is saved to `<report dir>/shots/<run start>/` and shown in the report under **Screenshots**; a view fails on sideways scroll, no drawn SVG logo on screen, the old CSS tile, any computed colour #f0a030, or a font stack naming Inter |
| `brand-docs` | user 2, once a run | B29.28 — a Docs page the user writes, at 1440×900 and 390×844 in the dark theme and the light one: each view's first screen, and at 390 the sidebar opened from Menu, is saved beside `brand-visual`'s and shown under **Screenshots**; a view fails on no logo in the sidebar, any computed colour #f0a030, or a font stack naming Inter |

## Catalog v1, and each scenario's oracle

| Scenario | Who | Oracle |
|---|---|---|
| `known-answer` | everyone | `a + b` with numbers unique to the user; the answer states the sum and carries a price |
| `capital` | everyone | a capital from a fixed table |
| `every-model` | user 0 | every model the picker offers answers; its footer shows the price the catalog gives for its token counts |
| `repeat-new-chat` | 1 in 10 | an exact repeat in a new chat shows "from your earlier answer · 0 LXC" and the same text; Regenerate is priced; the judge agrees the two answers match |
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
| `sdk-wallet-quickstart` | 1 in 10 (after `agent-open-fund`) | the TypeScript SDK's README quickstart, with Lens's own `sdk/typescript` from `--lens-src`: the owner creates an agent, funds it 10 LXC, issues its key; the agent asks a model through `.openai()` with that key; the agent's statement opens on the fund line (+10,000,000 µLXC), then the call's spend line at 10,000,000 minus that spend, each line's balance following from the one before. `--lens-src none` skips it |
| `features-wallets-first` | 1 in 10 (after `sdk-wallet-quickstart`) | an agent created and funded on Agent Wallets has one fund line of exactly that on its statement; then Features opens on the Agent Wallets row, whose line names the agents and the LXC they hold as Lens's book has them, and its Marketplace row counts the listings Lens's catalogue holds |
| `agent-limit` | 1 in 10 | a limit per request of 0.000001 LXC refuses the agent's request (403, the limit named) with its balance and the ledger unmoved; raised to 1 LXC, the same request is served once from the agent's balance |
| `wallet-currency` | 1 in 10 (after `agent-limit`) | an agent funded 12.5 LXC on Agent Wallets: Lens's book has it holding exactly 12,500,000 µLXC and its row reads "12.5 LXC ($1.25)" at the peg; its Allowed models field is a select, the model picked there is the one model Lens stores in its rules, and the Rules card says "It may use only <that model>." |
| `agent-archive` | 1 in 10 (after `agent-approval`) | an agent funded 0.75 LXC and given a key is renamed and described on Agent Wallets, and Lens's book carries both; archived there, its account gains exactly ONE line — a withdraw of -750,000 µLXC leaving 0 — the workspace's agents hold that much less and the workspace the same, and its key is then refused with no new line on its account and no spend row on the ledger |
| `agent-rule-simulator` | 1 in 10 (after `agent-hourly-limit`) | an agent funded 2 LXC with a daily limit of 1 LXC asks Would it pass? on Agent Wallets of a 1.5 LXC payment to another of the workspace's agents and is told Refused, by the daily limit; of 0.5 LXC, Allowed — and neither agent's account gains a line, and the payer still holds 2 LXC |
| `agent-rules-rollback` | 1 in 10 (after `agent-rule-simulator`) | an agent's rules saved with a 1 LXC daily limit (version 1) and changed twice on Agent Wallets are rolled back to version 1 on Rules history: Lens's rules read is byte for byte version 1's, and its newest version is "rollback to 1" by the same credential that saved version 1, which the row reads as "by you" |
| `agent-pause-all` | 1 in 10 | Pause every agent refuses both agents (403, every agent paused) with nothing charged; started again, one is served |
| `agent-approval` | 1 in 10 | a 1 LXC payment above a 0.5 LXC approval amount waits in Approvals with nothing moved, Lens's approval and its row naming the payee and memo ("Payer N wants to pay Payee N 1 LXC — …"); Approve pays it once (one pay line, the approval used) |
| `company-payment` | 1 in 10 | an agent pays another company's agent with its own key: one line on the payer's marketplace bill (and on Your bill); the payee's pending earnings rise by exactly the amount, and nothing is payable or available before that bill is paid and the 14-day holdback passes |
| `marketplace-sale` | 1 in 10 | another company publishes a prompt at 0.5 LXC on Publish; this user uses it on its page: the right answer, one line on their bill, one spend row for the model it called, and the seller's pending earnings up by exactly their share |
| `statement-reconciles` | 1 in 10 | after funding, a payment, a take-back and a request, the statement downloaded from Agent Wallets: each account's opening + in − out = closing, every entry sums to zero, each agent closes at its balance, and spend = the ledger's spend row |
| `agent-balance-stored` | 1 in 10 (after `statement-reconciles`) | one agent funded 100 times at once, each a different amount, through Lens as the owner: the balance Lens stores and reads as one row equals the 100 postings on the downloaded statement and their sum, every funding sums to zero, the workspace's agents hold that much more, and Agent Wallets shows the same balance |
| `agent-spend-question` | 1 in 10 (after `agent-balance-stored`) | an agent funded 2 LXC pays another agent 1.23 LXC; asked in Chat what it spent today, the model answers through Lens's wallet tool (`wallet_agents_spend`, via the BFF's `/api/chat/tools/call`): its words say 1.23, the link under them is to exactly that pay line on Lens's statement and opens Agent Wallets with the row marked, and the agent's account has no new line. SKIP until Lens offers the tool (talyvor-lens B28.83) |

The other company is a user no other scenario reads the earnings of: 9, 19, … take a payment, 8, 18, …
sell. A synthetic company's bill is never paid, so a sale or a payment stays pending: the scenarios check
it is pending, exactly, and not yet payable — the holdback itself is Lens's own test (B20.2, B20.5).

## Plans on a Stripe test card, and a pooled serve's royalty (B17.10)

Test users pay with Stripe test cards and earn royalties, every such row marked test — never paid out,
never counted in real totals (Nicolai, 30 Sep 2026; Lens B25.2). One user in ten again.

| Scenario | Who | Oracle |
|---|---|---|
| `plan-test-card` | 6, 16, … (last in the journey) | Plans → Choose Plus → Stripe's hosted checkout, paid with test card 4242 → back in the app; Lens's allowance for the period is granted, at Plus's 2000 cents. The plan is then cancelled at the end of its period |
| `pooled-royalty` | 7, 17, … with 9, 19, … | a question only this user has asked, asked again by another test user and served from the pool: the contributor's earnings ledger (`tokens/history`) gains a `pool_royalty_held` row. Not served from the pool, it is an ERROR — no royalty was owed |

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

`market-review` and `market-takedown` need a moderator key in `LENS_MODERATOR_KEY` (`lens moderator-keys
create`, inside the lens container; every use is recorded under the operator `e2e-testers`). Without one
they SKIP. What happens days later — a loan's instalment and its default (a day at the soonest), a payout (a
paid bill, then the 14-day holdback), the refund of a paid bill, and a purchase on the card (Stripe's
authorization) — is B25.8's, below.

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

## Self-test

`pnpm --filter @talyvor/e2e selftest` runs the whole harness on this machine. It uses a stand-in Lens
(`selftest/stub-lens.ts`), the real BFF built from this checkout, and the real web bundle.
Track and Docs are stood in for by `selftest/stub-products.ts`.
`STUB_BREAK=<name>` plants a defect, which must make the matching scenario FAIL: `price`,
`cross-replay`, and for catalog v2 `pii`, `injection`, `distill`, `tare`, `conversion`, `budget`,
`setting`, `logging` (stub-lens.ts), `docs-ai`, `track-ai`, `export` (stub-products.ts) and, for
catalog v3, `agent-limit` (stub-bank.ts, the stub's Agent Bank and marketplace), and for B17.10 `subscribe`
and `royalty` (stub-lens.ts, which stands in for Stripe's hosted checkout too), each file saying what each
breaks. Catalog v4's sixteen and B25.8's five (`loan-repay-lost`, `loan-default-never`, `card-free`,
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
