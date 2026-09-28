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
| `--headed` | | off | show the browsers |

A run needs `LENS_SYNTHETIC_KEY` set to the same value in `lens.env` and in the BFF's env file. Without
it on either side, Lens's synthetic routes or `/auth/synthetic` answer 404.

## What a run does

1. Resets every synthetic workspace (stored answers cleared, credits restored), then creates `--users`
   new ones.
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
| `try-tare` | 1 in 10 | Try Tare: 40 same-shaped JSON rows shrink to fewer tokens, the figures add up, and every field name survives |
| `docs-ai` | 1 in 10 | a space and a page written in Docs: Summarise and Translate (French) keep the page's access code, and Ask answers it and cites the page |
| `track-ai` | 1 in 10 | an issue with a ten-comment thread about one cause: the summary names it (tax calls), Look for duplicates names its near-twin, and triage suggests a priority |
| `track-export` | 1 in 10 | Export JSON and CSV: both hold every issue, the counts agree with the screen, and a title that starts with `=` is defused (`'`) and quoted |

Docs and Track call Lens on their own account, so their AI actions never reach the user's ledger. Each
one holds its worst case against the cap — the product's model, the whole input, its most output —
and is counted at that, since its real cost cannot be read.

Not yet in the catalog: "plans on Stripe test cards" and "a pooled serve pays the contributor's royalty" —
B17.1 refuses a synthetic checkout and funds no synthetic royalty, so they wait on a decision.

## Self-test

`pnpm --filter @talyvor/e2e selftest` runs the whole harness on this machine. It uses a stand-in Lens
(`selftest/stub-lens.ts`), the real BFF built from this checkout, and the real web bundle.
Track and Docs are stood in for by `selftest/stub-products.ts`.
`STUB_BREAK=<name>` plants a defect, which must make the matching scenario FAIL: `price`,
`cross-replay`, and for catalog v2 `pii`, `injection`, `distill`, `tare`, `conversion`, `budget`,
`setting`, `logging` (stub-lens.ts) and `docs-ai`, `track-ai`, `export` (stub-products.ts), each file
saying what each breaks.
