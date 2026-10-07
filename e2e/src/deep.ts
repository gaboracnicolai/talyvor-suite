// B28.292 — THE WEEKLY DEEP RED-TEAM PASS. Once a week (scripts/e2e-nightly.sh, on E2E_DEEP_DAY) the night's run goes on,
// after its own scenarios and under the same hard cap, to `--deep-rounds` rounds: in each, a fresh attacker created for
// the run plays every red-team scenario (B28.279–B28.290) back to back, each on a fresh workspace of its own, against a
// counterparty created for that round alone. Rounds run one after another, never at once: keys-not-forwarded listens on
// the one upstream port. A FAIL is filed like any other (filing.ts, under its scenario's marker), so a hole the night's
// own run of a scenario let through becomes a build item naming the round that found it.

import { ledgerCallOnce, ledgerMovesAtOnce } from './concurrency.ts'
import { injectionExfil } from './injection.ts'
import { keysNotForwarded, keysUnlisted } from './keys.ts'
import { poolIsolation } from './pool.ts'
import { rateLimitsHold } from './ratelimit.ts'
import { agentRulesUnbypassable } from './rules.ts'
import type { Scenario } from './scenarios.ts'
import { csrfRefused, scriptInert } from './session.ts'
import { fileBombBounded, ssrfRefused } from './ssrf.ts'
import { crossCompanyTestMoney } from './testmoney.ts'
import { marketAbuse } from './trade.ts'
import { webhookReplayed, webhookUnsigned } from './webhooks.ts'

/** Every red-team scenario, in the order of their items: the chain one attacker plays in a round. */
export function redTeamChain(attacker: number, counterparty: number): Scenario[] {
  return [
    ledgerMovesAtOnce(), ledgerCallOnce(), // B28.279
    webhookUnsigned(), webhookReplayed(), // B28.280
    agentRulesUnbypassable(), // B28.281
    marketAbuse(attacker), // B28.282
    poolIsolation(), // B28.283
    injectionExfil(), // B28.284
    ssrfRefused(), fileBombBounded(), // B28.285
    csrfRefused(), scriptInert(), // B28.286
    keysUnlisted(), keysNotForwarded(), // B28.287
    rateLimitsHold(), // B28.288
    crossCompanyTestMoney(attacker, counterparty), // B28.290
  ]
}

/**
 * The deep pass's journeys, for the users after the night's own `users`: per round an attacker playing the chain, then
 * its counterparty, who plays nothing and is only traded with.
 */
export function deepJourneys(users: number, rounds: number): Scenario[][] {
  return Array.from({ length: rounds }, (_, r) => {
    const attacker = users + 2 * r
    return [redTeamChain(attacker, attacker + 1), []]
  }).flat()
}

/** The round (from 1) a user of the run is in, or undefined for one of the night's own users. */
export function roundOf(index: number, users: number): number | undefined {
  return index < users ? undefined : Math.floor((index - users) / 2) + 1
}
