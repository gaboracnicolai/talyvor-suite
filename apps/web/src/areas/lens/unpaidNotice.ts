// The unpaid-contribution notice. ONE source, used by both surfaces that show it.
//
// WHY IT EXISTS, AND WHY BEFORE THE FLAG. Lens can put unproven earning mechanisms into SHADOW
// MODE: they compute what they would have paid, record it, and credit nothing
// (talyvor-lens@866f83e, LENS_SHADOW_MINTS_ENABLED). Turning that on is a STATEMENT TO TESTERS,
// not a config value — if the flag ships before this copy, we run unpaid mints without having
// said so. This is the precondition, and the deploy runbook should treat it as one.
//
// WHERE IT SHOWS:
//   · PoolingConsent — the signup disclosure. It BLOCKS (AuthGate renders it INSTEAD of the app),
//     so nobody generates a contribution before reading it, and it is already in the register of
//     "here is what happens to what you make" rather than asking permission.
//   · Ledger — at the point of ABSENCE. The disclosure is read once at signup; the question
//     "I contributed, why is there no row?" arrives later, at the ledger, and has to be answered
//     where it is asked.
//
// NOT settings: settings is where you go to change something, and this is not a preference.
//
// ── WHY THE WORDS ARE FIXED AND NOT READ FROM THE LIVE FLAG ─────────────────
//
// Setup.tsx reads the RECORDED sharing consent from /auth/me rather than hardcoding a default,
// and that is the pattern that stopped a false claim recurring there. It cannot be applied here,
// for a trust-boundary reason rather than an effort one:
//
//   · ShadowMintsEnabled is exposed on exactly ONE Lens route — GET /v1/admin/economy/flags,
//     behind requireAdmin. No non-admin route carries it.
//   · requireAdmin needs the Lens ADMIN key, and apps/bff/tenant_callsite_test.go asserts the BFF
//     never reads LENS_API_KEY: that key authorises EVERY workspace, so a BFF compromise would
//     escalate from one tenant to all of them.
//   · cache_poolable differs in KIND, not just in gating. It is a per-workspace fact the tenant
//     owns; shadow mode is a deployment-global operator setting. Reading the first is the BFF
//     reading its own tenant's data. Reading the second would be the BFF reading the operator's
//     configuration.
//
// So a live version would mean handing the BFF the admin key — trading a copy-accuracy problem
// for cross-tenant escalation — or adding an unauthenticated surface in another repo that exposes
// a money-path flag to every tenant. Both are worse than the problem.
//
// The copy is therefore worded to be TRUE IN EVERY STATE, and unpaidNotice.test.ts enforces that
// mechanically: no mechanism named (a seventh must not make it false), no unconditional
// present-tense claim about current activity (false when nothing is shadowed, which is the
// default), and the never-credited rule stated as a CONDITIONAL so it holds either way.
//
// Check the three states by hand as well as by test:
//   flag off, mechanisms off (the default) — "not every kind of contribution earns" is true;
//                                            they are switched off.
//   flag on  (shadow mode)                 — true; they are under evaluation and never credited.
//   some mechanisms live                   — still true; the others remain off.

/** The line someone who reads nothing else must still take away. */
export const UNPAID_NOTICE_HEADLINE = 'Not every kind of contribution earns LENS.'

/**
 * The explanation. Deliberately generic and conditional — see the file header for why it is not
 * read from the live flag, and unpaidNotice.test.ts for the properties that keep it true.
 */
export const UNPAID_CONTRIBUTION_NOTICE =
  'Several earning mechanisms are switched off or still being evaluated, so a contribution can ' +
  'be genuine and still produce no ledger entry. Where a mechanism is under evaluation, what it ' +
  'would have paid is recorded for checking and never credited — it does not reach your balance. ' +
  'Your balance and ledger show only what you have actually been paid, so if you contributed and ' +
  'see nothing there, that is the reason rather than an error.'
