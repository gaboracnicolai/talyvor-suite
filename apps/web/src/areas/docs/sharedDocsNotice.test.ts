import { describe, expect, it } from 'vitest'

import {
  DOCS_SHARED_GUIDANCE,
  DOCS_SHARED_HEADLINE,
  DOCS_SHARED_NOTICE,
} from './sharedDocsNotice'

// The shared-Docs notice — the CLAIM, not the rendering (rendering is pinned beside the surface).
//
// Same shape as unpaidNotice.test.ts: one source, properties enforced mechanically rather than by
// good intentions. A DIFFERENT fact from that notice — that one is about what earns LENS, this one
// is about who can read what — so it must not restate it.
//
// ⚠ THE DESIGN DECISION HERE IS THE MIRROR OF THEIRS. unpaidNotice is worded to be true in every
// state because its flag lives behind requireAdmin and reading it would mean giving the BFF the
// Lens admin key. Its header names reading the value from /auth/me as "the pattern that stopped a
// false claim recurring" and explains why it could not be used.
//
// It can be used here, and the difference is a trust boundary, not effort: whether Docs is pinned
// is the BFF's OWN configuration — it holds docsWorkspaceID because it builds the Docs path from
// it. No key to acquire, no other service's operator setting to read. So this copy is CONDITIONAL
// on a live value, and the tests below pin that it stays conditional.

describe('the shared-Docs notice — the claim', () => {
  const text = `${DOCS_SHARED_HEADLINE} ${DOCS_SHARED_NOTICE} ${DOCS_SHARED_GUIDANCE}`

  it('states the ASYMMETRY, which is the actual hazard', () => {
    // Being the odd one out is the danger: someone just told their Lens and Track workspaces are
    // their own will generalise to Docs. A notice that said only "Docs is shared", without saying
    // the others are not, would leave the wrong inference untouched.
    expect(text).toMatch(/lens/i)
    expect(text).toMatch(/track/i)
    expect(text).toMatch(/your own|nobody else/i)
  })

  it('says plainly that other people can see it', () => {
    expect(text).toMatch(/visible to everyone|see each other|visible to the group/i)
  })

  it('gives GUIDANCE, not only a fact', () => {
    // "Docs is shared" is a fact; "don't put anything private in it" is what stops the harm. The
    // guidance must say what NOT to do and be reachable on its own.
    expect(DOCS_SHARED_GUIDANCE).toMatch(/don’t|do not|avoid/i)
    expect(DOCS_SHARED_GUIDANCE).toMatch(/private|confidential|personal/i)
    expect(DOCS_SHARED_GUIDANCE.length).toBeGreaterThan(40)
  })

  it('describes THIS DEPLOYMENT, not the product', () => {
    // The wording has to survive Docs gaining its own tenancy root — a parked decision with a
    // stated reopening condition, not a permanent state. "Docs on this deployment works
    // differently" stops being rendered when the configuration changes; "Docs is shared" as a
    // product claim would simply become false.
    expect(DOCS_SHARED_NOTICE).toMatch(/this deployment|this trial/i)
  })

  it('claims no number of people and names no other tester', () => {
    // A count goes stale as testers are added, and naming anyone would be a privacy problem in a
    // notice about privacy.
    expect(text).not.toMatch(/\b\d+\s+(people|users|testers|others)\b/i)
    expect(text).not.toMatch(/@/)
  })

  it('does not restate the unpaid-contribution notice', () => {
    // Two notices sit on the same screen. This one is about visibility; that one is about
    // payment. Overlap would make both easier to skim past.
    expect(text).not.toMatch(/\bLENS\b/)
    expect(text).not.toMatch(/earn|ledger|balance|credited/i)
  })

  it('is one source, so the surfaces cannot drift', () => {
    for (const s of [DOCS_SHARED_HEADLINE, DOCS_SHARED_NOTICE, DOCS_SHARED_GUIDANCE]) {
      expect(typeof s).toBe('string')
      expect(s.trim().length).toBeGreaterThan(0)
    }
  })
})
