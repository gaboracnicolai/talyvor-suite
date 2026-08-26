import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Row } from '../components/Row'

/**
 * rowHintWraps.test.tsx — A ROW'S HINT IS PROSE AND MUST NOT BE CLIPPED; ITS LABEL MAY BE.
 *
 * ── WHAT THIS EXISTS FOR, MEASURED RATHER THAN PREFERRED ────────────────────
 *
 * `Row` gave BOTH lines `truncate` (nowrap, overflow hidden, ellipsis). A census in real Chrome
 * on the BUILT artifact, over ten console addresses against a POPULATED fixture, found **168
 * rendered `.truncate` elements** and exactly **TWO clipped at desktop width** — and both were
 * hints, not labels:
 *
 *     /      112px cut at 1280, 104px at 1440 — "settles on its own after a holding period —
 *            during which it can still be revoked"
 *     /keys  136px cut at 1280 AND 1440 — "Minted server-side with the proxy scope; the key is
 *            shown once, then only its identifier remains"
 *
 * ⚠ THE FIRST IS THE HALF TWO GUARDS EXIST TO KEEP. `ClaimsAudit.test.tsx` and `Held.test.tsx`
 * both assert "can still be revoked" is present, because the copy once described only settlement
 * and omitted the revocation. Both read `textContent` under jsdom, which has no layout, so both
 * were green on a sentence no reader could finish.
 *
 * ⚠ THE SECOND HAD NO GUARD AND NO SECOND VOICE AT ALL — "the key is shown once" is the
 * disclosure that this secret is unrecoverable, and it was cut with nothing anywhere repeating it.
 *
 * ── WHAT THIS GUARD CAN AND CANNOT DO, SAID PLAINLY ─────────────────────────
 *
 * ⚠⚠ IT PINS THE RULE. IT DOES NOT MEASURE THE CLIP, AND IT CANNOT. Clipping is
 * `scrollWidth > clientWidth`, which only a layout engine knows; jsdom reports 0 for both. That
 * blindness IS the finding this file was written under, so claiming otherwise here would repeat
 * it one level up. What is asserted is the decision — hints wrap, labels may clip — which is
 * checkable without layout and is what actually regressed.
 *
 * THE MEASUREMENT lives in `~/talyvor-queue/w1112-truncate-census-m3r8.mjs` (fixture) and
 * `w1112-truncate-driver-m3r8.mjs` (driver). They run a real browser over the built bundle and
 * report every clipped element per address and width. They are NOT in CI — this repository has no
 * browser in its pipeline — so the honest state is: the rule is enforced on every commit, and the
 * pixel truth is re-derivable on demand by a person. A source grep is not a substitute: it finds
 * 13 sites where the browser finds 168 elements, because this component is shared by 24 files.
 *
 * ── A SECOND FINDING THIS MERGE TRIPPED OVER ────────────────────────────────
 *
 * ⚠ A COMPOUND LINE CITATION — the shape that names two lines of one file separated by a slash —
 * IS OUTSIDE EVERY POINTER INSTRUMENT IN THIS REPO, AND TWO OF THE THREE IN ONE COMMENT WERE
 * WRONG. `checkoutRefusalSurface.test.tsx`'s header cites three such pairs, each meant to be an
 * error-gate line and the class-check line inside it. `pointerAudit.test.ts` parses only a single
 * trailing number, so it re-points the FIRST half when a file moves and cannot see the second at
 * all. Re-derived by reading the three files: the Keys pair was correct; the ConvertLens pair's
 * second half pointed at a COMMENT and had drifted before today, uncaught, while its first half
 * moved with this merge and WAS caught; the IssueList pair's second half pointed at a
 * `heading=` prop and has never been a class check at all. All three are corrected.
 *
 * ⚠ THE CLASS IS NOT CLOSED AND THIS IS NOT THE FILE TO CLOSE IT IN: nothing checks the second
 * half of a compound citation, and a repo-wide sweep for that shape would say how many others
 * exist. Filed rather than run — it is not this merge's subject.
 *
 * ⚠ AND THE PARAGRAPH ABOVE DELIBERATELY DESCRIBES THE SHAPE INSTEAD OF WRITING ONE. The first
 * draft spelled the citations out literally, and `pointerAudit.test.ts` immediately parsed them
 * as SEVEN new pointers from this file and went red — a comment about stale pointers becoming a
 * source of them. Prose about a pattern must not BE the pattern.
 *
 * ⚠ AND THE LABEL KEEPS `truncate` ON PURPOSE. Blanket-removing it trades a silent clip for a
 * silent reflow: a long value in a label would break the row's grid. After the fix the census
 * found SIX clipped elements at 390px and every one is a short label ("Current balance", "Add
 * credit", "Create a key", "pattern shared", "Untagged — no feature header") — the class where an
 * ellipsis is the intended behaviour. Zero at 1280 and 1440.
 */

/** The classes that make an element clip rather than wrap. */
const CLIPPING = ['truncate', 'overflow-hidden', 'whitespace-nowrap', 'text-ellipsis']

describe('Row: a hint is prose and wraps; a label may clip', () => {
  it('the hint carries no clipping class', () => {
    const sentence =
      'settles on its own after a holding period — during which it can still be revoked'
    render(<Row label="Held" hint={sentence} />)
    const hint = screen.getByText(sentence)
    for (const cls of CLIPPING) {
      expect(
        hint.className.split(/\s+/),
        `Row's hint carries \`${cls}\`, so a sentence longer than the row is cut with an ellipsis ` +
          'and no test in this repository can see it — jsdom has no layout. Measured in Chrome ' +
          'before this rule existed: two disclosures were cut at 1280 AND 1440, one of them the ' +
          'half ClaimsAudit.test.tsx and Held.test.tsx exist to preserve, the other the only ' +
          'statement that an API key is shown once and never again.',
      ).not.toContain(cls)
    }
  })

  // ⚠ THE PAIR, AND IT IS NOT SYMMETRY FOR ITS OWN SAKE. Without it, "hints wrap" is satisfied by
  // a component that clips NOTHING — which is the blanket removal the finding explicitly warns
  // against, because a long label would then break the row's grid instead of ellipsing. The rule
  // is a SPLIT, so both halves are asserted.
  it('the label still clips, because a long one would break the row grid', () => {
    render(<Row label="A label long enough to need the ellipsis it was given" hint="short" />)
    const label = screen.getByText('A label long enough to need the ellipsis it was given')
    expect(
      label.className.split(/\s+/),
      "Row's label lost `truncate`. Blanket-removing it trades a silent clip for a silent " +
        'reflow: the label sits beside a control in a fixed row, and a long value would break ' +
        'the grid rather than ellipse. The census supports the split — every desktop clip in the ' +
        'product was a HINT and none was a label.',
    ).toContain('truncate')
  })

  // The floor: if `Row` stopped rendering a hint at all, both assertions above would be about
  // elements that do not exist, and `getByText` throwing is a less legible failure than this.
  it('a hint is rendered at all — otherwise the rule above is about nothing', () => {
    render(<Row label="L" hint="H" />)
    expect(screen.queryByText('H'), 'Row rendered no hint element').not.toBeNull()
  })
})
