/**
 * The quality-floor focus ring: a 2px accent outline at 2px offset, only on keyboard focus
 * (focus-visible).
 *
 * ⚠ THIS SENTENCE USED TO READ "Applied to every interactive element" AND THAT WAS NOT TRUE.
 * A string constant cannot apply itself; only a component that imports it has a ring. Measured
 * as rendered across all 45 surface tests: 89 of 184 focusable elements carried it, and NINE
 * hand-rolled controls — three text fields, two textareas, a native select, the marketing
 * stepper, the pool slider and a role="link" row with half a ring — wore the BROWSER'S default
 * instead. Chrome 151, computed on keyboard focus: `auto 1px rgb(153,200,255)` in the dark theme
 * and `rgb(0,95,204)` in the light one, against an accent of #3AD6C0 / #0F7A6C — a second focus
 * hue in a system whose stated premise is one.
 *
 * So the claim is now CHECKED rather than asserted: apps/web/src/focusAudit.ts reads the DOM on
 * every surface test and fails on a keyboard-focusable element that does not carry this ring.
 * It reads the DOM because `Button asChild` merges this string onto a child element the source
 * never names.
 *
 * ⚠ WHAT IT COVERS, SAID RATHER THAN IMPLIED: every focusable element EXCEPT an underlined <a>,
 * which is a link in prose and keeps the UA ring. That exemption is a SHAPE, not a tag — an
 * anchor dressed as a tile is still a control and is still checked. Giving all 76 prose links an
 * offset outline is a design conversation about how text looks, not a defect.
 */
export const focusRing =
  'outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
