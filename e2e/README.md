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

**The cap is hard.** Every question reserves its worst case before it is sent: its whole input plus
4,096 output tokens at list price. When the answer arrives, the reservation is settled with the real
cost. A question whose worst case would take committed spend plus in-flight reservations past the cap
is never sent. From then on the run sends nothing new and every remaining scenario SKIPs.

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

Not yet in the catalog: "plans on Stripe test cards" and "a pooled serve pays the contributor's royalty" —
B17.1 refuses a synthetic checkout and funds no synthetic royalty, so they wait on a decision.

## Self-test

`pnpm --filter @talyvor/e2e selftest` runs the whole harness on this machine. It uses a stand-in Lens
(`selftest/stub-lens.ts`), the real BFF built from this checkout, and the real web bundle.
`STUB_BREAK=<name>` plants a defect, which must make the matching scenario FAIL: `price`,
`cross-replay`, and for catalog v2 `pii`, `injection`, `distill`, `tare`, `conversion`, `budget`,
`setting` and `logging` (stub-lens.ts says what each breaks).
