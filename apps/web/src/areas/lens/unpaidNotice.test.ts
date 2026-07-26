import { describe, expect, it } from 'vitest'

import { UNPAID_CONTRIBUTION_NOTICE, UNPAID_NOTICE_HEADLINE } from './unpaidNotice'

// This notice is a PRECONDITION for turning shadow mode on in Lens: enabling
// LENS_SHADOW_MINTS_ENABLED is a statement to testers, not a config value, so the copy has to
// exist before the flag ships or we run unpaid mints without having said so.
//
// These tests are about THE CLAIM, not the rendering. The rendering tests live beside each
// surface; what is pinned here is that the words are TRUE — on every deployment, including the
// one where nothing is shadowed at all.
//
// ⚠ WHY THE COPY IS NOT CONDITIONAL ON THE LIVE FLAG, which is the design decision here.
//
// Setup.tsx reads the RECORDED sharing consent from /auth/me rather than hardcoding a default,
// and that pattern is what stopped a false claim recurring there. It cannot be applied to shadow
// mode, and the reason is a trust boundary rather than effort:
//
//   · ShadowMintsEnabled is exposed on exactly ONE Lens route, GET /v1/admin/economy/flags,
//     behind requireAdmin. No non-admin route carries it (verified against talyvor-lens@866f83e).
//   · requireAdmin needs the Lens ADMIN key, and apps/bff/tenant_callsite_test.go asserts the BFF
//     NEVER reads LENS_API_KEY — because that key makes workspaceAuthorized true for every
//     workspace, so a BFF compromise would escalate from one tenant to all of them.
//   · cache_poolable is different in KIND, not just in gating: it is a per-workspace fact the
//     tenant owns. Shadow mode is a deployment-global operator setting. Reading the first is the
//     BFF reading its own tenant's data; reading the second would be the BFF reading the
//     operator's configuration.
//
// So making this copy live would mean either handing the BFF the admin key — trading a
// copy-accuracy problem for a cross-tenant escalation risk — or adding a new unauthenticated
// surface in another repo that exposes a money-path flag to every tenant. Both are worse than the
// problem. The copy is therefore worded to be true in EVERY state, which the tests below enforce
// mechanically rather than by good intentions.

describe('the unpaid-contribution notice — the claim', () => {
  const text = `${UNPAID_NOTICE_HEADLINE} ${UNPAID_CONTRIBUTION_NOTICE}`

  it('names no mechanism, so a seventh cannot make it false', () => {
    // The exact failure mode flagged before building: hardcode six names and the copy becomes
    // false the moment a seventh is shadowed — the same defect as the pooling sentence #33
    // invalidated on the setup page. mining.ShadowableMintTypes() is the list, and it lives in
    // another repo, so this copy must never mirror it.
    // ⚠ MATCHED AS MECHANISM NAMES, NOT BARE SUBSTRINGS. The first version of this banned 'eval',
    // which also matches "evaluated" and "evaluation" — the very words that keep the copy generic.
    // A ban at the wrong granularity forbids the thing that makes the text correct, the same shape
    // as an earlier assertion that would have deleted a page's most useful sentence.
    for (const named of [
      /\bPOVI\b/i,
      /\bannotation\b/i,
      /\beval[- ]contribution\b/i,
      /\brouting[- ]prediction\b/i,
      /\blatency\b/i,
      /\bconfidential\b/i,
      /receipt_mine|eval_contribution|routing_prediction|latency_locality|confidential_compute/i,
    ]) {
      expect(text).not.toMatch(named)
    }
    // Nor a count, which decays the same way.
    expect(text).not.toMatch(/\bsix\b|\b6\b|\bseven\b/i)
  })

  it('asserts nothing that is false when shadow mode is OFF', () => {
    // Shadow mode defaults off, and that is a self-hoster's normal state. An unconditional
    // present-tense claim that contributions ARE being measured is false there.
    //
    // Forbidden: a bare present-tense assertion about current activity. Permitted: a statement
    // about what is NOT paid (true whenever any mechanism is off — and they default off), or a
    // CONDITIONAL about what happens where a mechanism is under evaluation.
    for (const forbidden of [
      /\bare being (measured|recorded|shadowed)\b/i,
      /\bis being (measured|recorded|shadowed)\b/i,
      /\bwe are (currently )?(measuring|recording)\b/i,
      /\bare currently being\b/i,
    ]) {
      expect(text).not.toMatch(forbidden)
    }
  })

  it('says the thing a tester needs: some contributions do not pay', () => {
    expect(text).toMatch(/not every|some/i)
    expect(text).toMatch(/earn|paid|pay/i)
  })

  it('explains the ABSENCE, which is what someone actually notices', () => {
    // The ledger is where a contributor looks for money and does not find it. The copy has to
    // account for the empty row, or the notice answers a question nobody asked.
    expect(text).toMatch(/ledger|balance/i)
    expect(text).toMatch(/no entry|nothing|no ledger entry|see nothing/i)
  })

  it('states the never-credited rule as a CONDITIONAL, so it holds either way', () => {
    // "Where/if a mechanism is under evaluation, what it would have paid is recorded and never
    // credited" is true whether or not anything currently is. An indicative "we record it" is not.
    expect(text).toMatch(/\b(where|if)\b/i)
    expect(text).toMatch(/never|not credited|does not reach/i)
  })

  it('claims no figure', () => {
    // Same discipline as the setup page and the README: no measured number exists.
    expect(text).not.toMatch(/\d+\s?%/)
  })

  it('is one source, so the two surfaces cannot drift', () => {
    // PoolingConsent already learned this: its first draft carried its own copy and promised a
    // settings screen that did not exist. Both surfaces import these constants.
    expect(UNPAID_NOTICE_HEADLINE.length).toBeGreaterThan(10)
    expect(UNPAID_CONTRIBUTION_NOTICE.length).toBeGreaterThan(80)
  })
})
