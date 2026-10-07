// B28.294 — THE LIGHT PASS, between the nightly runs. `scripts/e2e-nightly.sh --light`, run every few hours (the cron that
// starts it is Nicolai's), plays a few minutes of the core money and auth paths — a priced answer and its ledger row, the
// limits that refuse a spend and write nothing, money between two companies, sign-out, a revoked key, and the red-team
// scenarios on the ledger, webhooks, an agent's rules, the session and the keys — for six fresh synthetic users at once.
// A FAIL is filed in BUILD.md as the nightly's are (filing.ts, under its scenario's marker). It spends only what is left of
// the day's one cap (day.ts).

import { agentLimit } from './bank.ts'
import { ledgerCallOnce, ledgerMovesAtOnce } from './concurrency.ts'
import { keysUnlisted } from './keys.ts'
import { agentRulesUnbypassable } from './rules.ts'
import { type Scenario, capital, knownAnswer, spendingLimit } from './scenarios.ts'
import { csrfRefused, scriptInert } from './session.ts'
import { apiKeyRevoke, sessionSignOut } from './surface.ts'
import { crossCompanyTestMoney } from './testmoney.ts'
import { walletSendRefund } from './trade.ts'
import { webhookUnsigned } from './webhooks.ts'

/** The light pass's users: one journey each, all at once; the last is the other company, who plays nothing. */
export function lightJourneys(): Scenario[][] {
  return [
    // A priced answer, then a spending limit below what was spent: refused, and no spend row.
    [knownAnswer(1), capital(0), spendingLimit(0)],
    // An agent's limit refuses before the model; credits sent to another company and given back; that money test money.
    [agentLimit(1), walletSendRefund(1, 5), crossCompanyTestMoney(1, 5)],
    // A key made and revoked, then Sign out in a second browser ending that session alone.
    [apiKeyRevoke(2), sessionSignOut(2)],
    // The session, the keys and Stripe's webhook, each on a workspace of its own.
    [csrfRefused(), scriptInert(), keysUnlisted(), webhookUnsigned()],
    // The ledger under concurrency and an agent's rules, each on a workspace of its own.
    [ledgerMovesAtOnce(), ledgerCallOnce(), agentRulesUnbypassable()],
    [],
  ]
}
