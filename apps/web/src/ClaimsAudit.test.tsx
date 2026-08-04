import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ClaimsAudit.test.tsx — every claim corrected in the copy audit, pinned.
//
// THE RECURRING DEFECT THIS GUARDS: a sentence true of an INTENTION sitting over code that does
// something narrower — and its close relative, a sentence that states the reassuring HALF of a
// mechanism and stops. Both have shipped in this project repeatedly. A wrong claim reads fine, so
// nothing catches it except someone measuring; these assertions are that measurement, kept.
//
// ⚠ EACH ASSERTION IS PAIRED — the false wording ABSENT and the true wording PRESENT. An absence
// assertion alone is decoration: it passes on an empty file, on a renamed file, and on a file
// whose sentence was reworded into a different falsehood. The presence half is what makes the
// absence half mean something.
//
// ⚠ AND EACH PAIR IS POSITIVE-CONTROLLED by TestControls below, which proves each matcher can
// actually fail. That exact mistake — a negative assertion that could never have failed — was
// made twice this week.

const SRC = join(__dirname, '..', 'src')
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8')

// Copy is authored across JSX lines, so a claim is matched on whitespace-collapsed source —
// with COMMENTS STRIPPED FIRST. That is not cosmetic: the corrections below are documented in
// comments that necessarily quote the wording they replaced, so a naive source match would find
// "about 72h" in the very comment explaining why it was removed and report the fix as unmade.
// Only what can reach a user is matched.
function flat(rel: string): string {
  return read(rel)
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ') // {/* JSX comment */}
    .replace(/\/\*[\s\S]*?\*\//g, ' ') //             /* block comment */
    .replace(/^\s*\/\/.*$/gm, ' ') //                    // line comment
    .replace(/\s+/g, ' ')
}

describe('held LENS — the whole mechanism, and no number this app cannot verify', () => {
  // WHAT WAS WRONG: both screens said held LENS "settles automatically, about 72h after it is
  // earned". Two defects in one sentence.
  //
  //  (1) THE NUMBER. 72h is LENS_POOL_HOLDBACK_WINDOW, an operator setting (Lens
  //      internal/config/config.go: `c.PoolHoldbackWindow = 72 * time.Hour`, overridable by env)
  //      that Lens publishes on NO endpoint — every use is a SetHoldbackWindow call into a
  //      minter, never a route. The suite therefore cannot read it and was printing a figure it
  //      had no way to verify. Terms goes further and PROMISES this screen "reflects how this
  //      deployment is currently configured", which a hardcoded constant cannot do.
  //
  //  (2) THE MISSING HALF. During the window a held payout can be REVOKED — Lens
  //      mining.RevokeHeldTx burns it — which is what the window is FOR. Saying it settles and
  //      omitting that it can be reversed describes the pleasant half. Terms says both; these
  //      screens contradicted Terms by omission.
  const screens = ['areas/lens/Overview.tsx', 'areas/lens/ConvertLens.tsx']

  it.each(screens)('%s states no unverifiable holdback length', (rel) => {
    const s = flat(rel)
    // ABSENT: the specific figure, in the forms it was written in.
    expect(s).not.toMatch(/about 72\s*h/i)
    expect(s).not.toMatch(/settles automatically, about/i)
  })

  it.each(screens)('%s says the held amount can be revoked', (rel) => {
    // PRESENT: the half that was missing. Without this, removing the number alone would have
    // "passed" the test above while leaving the mechanism half-described.
    expect(flat(rel)).toMatch(/can still be revoked/i)
  })

  it('Terms and the balance screens now agree that the length is an operator setting', () => {
    // Terms already said the length is not fixed here. The screens now say the same rather than
    // printing a constant that contradicts it.
    expect(flat('routes/Terms.tsx')).toMatch(/operator setting/i)
    expect(flat('areas/lens/ConvertLens.tsx')).toMatch(/operator\s+setting this screen cannot read/i)
  })
})

describe('Setup — the disclosures a user reads BEFORE pasting a key', () => {
  // WHAT WAS WRONG: logging was described as "who called what, when, and what it cost" and
  // stopped. That is the DEFAULT (`metadata`) setting. Under `full`, Lens writes prompt_text to
  // token_events AND publishes the raw prompt and response to a 30-day stream — proxy.go gates
  // both on LoggingFull. The Privacy page has always said so; the screen someone reads before
  // handing over their traffic said only the reassuring part.
  it('says the full setting keeps prompt text, not just cost metadata', () => {
    const s = flat('areas/lens/Setup.tsx')
    expect(s).toMatch(/full/i)
    expect(s).toMatch(/keeps? prompt text/i)
    expect(s).toMatch(/30-day stream/i)
    // ABSENT: the old formulation that implied metadata was the whole story.
    expect(s).not.toMatch(/Request logging controls the audit trail — who called what, when, and what it cost\. Turning it off/i)
  })

  // WHAT WAS WRONG: "Your prompts are never served to another company" is TRUE — matching uses
  // the hash and the embedding, and only the answer is transmitted. But an answer routinely
  // restates the question it answered, so a confidential prompt can leave inside its own answer.
  // Privacy.tsx states exactly this and warns against the other reading; Setup stopped at the
  // comfortable clause.
  it('completes the prompts-are-not-served claim with what does leave', () => {
    const s = flat('areas/lens/Setup.tsx')
    expect(s).toMatch(/Your prompts are never served to another company/i) // the true claim stays
    expect(s).toMatch(/often restates the question/i) // …and is now completed
    expect(s).toMatch(/the answer leaves this workspace/i)
  })

  it('matches the completion the Privacy page already made', () => {
    // The two pages must not disagree about the same mechanism.
    expect(flat('routes/Privacy.tsx')).toMatch(/restates the question/i)
  })
})

describe('empty states — a correct system that explains nothing reads as broken', () => {
  // WHAT WAS WRONG: "No mint-attributed LENS rows in the window yet." and "No ledger entries
  // yet." Both true on every brand-new workspace, and neither tells a first user whether the
  // product is working, broken, or waiting for them — nor what would make a row appear. This
  // exact failure has shipped twice (a held balance of 0 beside a ledger of 822; a Track fault
  // rendered identically to an empty tracker).
  it('the earnings empty state says what puts a row there', () => {
    const s = flat('areas/lens/Overview.tsx')
    expect(s).not.toMatch(/No mint-attributed LENS rows in the window yet/i)
    expect(s).toMatch(/No earnings yet/i)
    expect(s).toMatch(/served an answer this workspace produced/i)
  })

  it('the activity empty state names the action and links to it', () => {
    const s = flat('areas/lens/Overview.tsx')
    expect(s).not.toMatch(/No ledger entries yet\./i)
    expect(s).toMatch(/No activity yet/i)
    expect(s).toMatch(/first entry appears the moment a request goes through Lens/i)
    expect(s).toMatch(/to="\/setup"/)
  })
})

// ⚠ POSITIVE CONTROLS. Each matcher above is re-run against a string that SHOULD trip it. If a
// matcher cannot fail, the assertion using it is decoration — which is the mistake this file
// exists to stop repeating.
describe('controls — every matcher above can actually fail', () => {
  // Each row is a matcher used above paired with a string that MUST match it. If a row fails,
  // the assertion relying on that matcher is decoration — it could never have gone red.
  const cases: Array<[string, RegExp, string]> = [
    ['holdback figure', /about 72\s*h/i, 'it settles automatically, about 72h after it is earned'],
    ['old settles wording', /settles automatically, about/i, 'settles automatically, about 72h'],
    ['revocation half', /can still be revoked/i, 'a holding period, during which it can still be revoked'],
    ['operator setting', /operator\s+setting this screen cannot read/i, 'an operator setting this screen cannot read, so it is not stated'],
    ['full-logging prompt text', /keeps? prompt text/i, 'a full setting that does keep prompt text'],
    ['30-day stream', /30-day stream/i, 'sends the prompt and the answer to a 30-day stream'],
    ['answer restates', /often restates the question/i, 'an answer often restates the question it answered'],
    ['answer leaves', /the answer leaves this workspace/i, 'plan around the answer leaves this workspace'],
    ['old mint empty', /No mint-attributed LENS rows in the window yet/i, 'No mint-attributed LENS rows in the window yet.'],
    ['old ledger empty', /No ledger entries yet\./i, 'No ledger entries yet.'],
    ['new earnings empty', /No earnings yet/i, 'No earnings yet. A row appears here when'],
    ['served-an-answer', /served an answer this workspace produced/i, 'when another company is served an answer this workspace produced'],
    ['first-entry', /first entry appears the moment a request goes through Lens/i, 'The first entry appears the moment a request goes through Lens'],
    ['setup link', /to="\/setup"/, '<Link className="underline" to="/setup">'],
  ]

  it.each(cases)('%s: the matcher fires on the wording it is meant to catch', (_name, re, trip) => {
    // The control string is the wording the assertion is about. If this fails, the corresponding
    // assertion above proves nothing.
    expect(trip).toMatch(re)
  })

  it.each(cases)('%s: the matcher does NOT fire on unrelated prose', (_name, re) => {
    expect('the quick brown fox jumped over the lazy dog').not.toMatch(re)
  })
})
