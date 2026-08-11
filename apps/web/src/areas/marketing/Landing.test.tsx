import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CONTACT_EMAIL, Landing } from './Landing'
import { LEDGER_HIT, micro } from './economics'

// Area-owned test — replaces the deleted shared areas/scaffold.test.tsx (the
// deadlock: a shared test over per-area screens; see #7). The marketing tab
// owns this file with its screen. Kept from the scaffold contract: the landing
// renders with NO providers — no auth gate, no query client, no router —
// because it is a public page. Added on top: the page's honesty invariants
// (no unmeasured numbers) and the flagged contact wiring.

afterEach(cleanup)

describe('Landing', () => {
  it('renders standalone — no router, no providers — with exactly one Talyvor heading', () => {
    render(<Landing />)
    // One heading names the product; keeping it unique keeps every
    // getByRole('heading', { name: /talyvor/i }) consumer unambiguous.
    const headings = screen.getAllByRole('heading')
    expect(headings.filter((h) => /talyvor/i.test(h.textContent ?? ''))).toHaveLength(1)
  })

  it('keeps the single "Open the app" link pointing at the console', () => {
    render(<Landing />)
    expect(screen.getByRole('link', { name: /open the app/i })).toHaveAttribute('href', '/')
  })

  // THE DEAD-CTA GUARD. The page used to hardcode hello@talyvor.com as its only call to
  // action while a comment beside it said the alias did not route. A comment cannot fail a
  // build, so it shipped. Now the address is configuration, and the page renders its absence.
  it('draws NO mailto when no contact address is configured', () => {
    expect(CONTACT_EMAIL).toBe('') // the default in this build — no alias yet
    render(<Landing />)
    const mailtos = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href')?.startsWith('mailto:'))
    // A dead contact link is worse than none: better to offer no inbox than one that
    // silently drops a buyer's first message.
    expect(mailtos).toHaveLength(0)
    // and the page still has an action to take
    expect(screen.getByRole('link', { name: /see the suite/i })).toBeInTheDocument()
  })

  it('says plainly that there is no inbox yet, rather than implying one', () => {
    render(<Landing />)
    expect(screen.getByText(/no inbox to write to yet/)).toBeInTheDocument()
  })

  it('makes no quantitative marketing claims — no percentage anywhere on the page', () => {
    const { container } = render(<Landing />)
    // The brief's hard rule: no metrics we have not measured. There is no
    // cache-hit rate on this page because none has been measured yet; if a %
    // ever appears here, it must arrive together with the measurement — and
    // with this assertion consciously updated in the same change.
    expect(container.textContent).not.toMatch(/%/)
  })

  // ─────────────────────────────────────────────────────────────────────────
  // CHECKABLE CLAIMS. This page went live making four statements that source
  // does not support. Each assertion below names the string and the reason —
  // a test that only checked "the page renders" would pass on any wording.
  // ─────────────────────────────────────────────────────────────────────────

  // ⚠ TRUE AND IT STAYS. issues.ai_cost_usd is a running sum of ai_spend_events, idempotent on
  // request_id (talyvor-track internal/issue/store.go, migration 0017). Per-issue AI cost is real,
  // and it is the strongest sentence on the page.
  it('keeps the per-issue cost claim, which source supports', () => {
    const { container } = render(<Landing />)
    expect(container.textContent ?? '').toMatch(/cost of an issue/i)
  })

  // ⚠ FALSE AS WRITTEN. pages.ai_cost_usd is rolled up from LINKED TRACK ISSUES by
  // trackintegration/syncer.go — it is not AI work on the document. Docs tags its own Lens calls
  // by FEATURE (docs-ai-write / docs-ai-summarize) and never by page, so no per-page attribution
  // exists to report.
  it('does not claim a per-document cost, which nothing computes', () => {
    const { container } = render(<Landing />)
    expect(container.textContent ?? '').not.toMatch(/cost of (an issue, )?a document/i)
  })

  // ⚠ Code has no surface in this app at all — no route in App.tsx, no proxy in the BFF — so
  // there is no "cost of a change" a reader could go and look at.
  // The live wording is "the cost of an issue, a document or a change", so a literal
  // /cost of a change/ never appears and would pass without the page changing at all. The
  // assertion has to name the enumeration that actually makes the claim.
  it('does not claim a per-change cost, which has no surface', () => {
    const { container } = render(<Landing />)
    expect(container.textContent ?? '').not.toMatch(/a document or a change/i)
  })

  // ⚠ THE SHARPEST ONE: it named a channel nobody can connect to. deploy/Caddyfile publishes ONE
  // origin (app.talyvor.com → the BFF on :8787), the BFF registers no /mcp route, and Track and
  // Docs are not publicly routed. The MCP server exists in Track — it is simply not reachable by
  // any customer of the hosted product, so advertising it as a SURFACE is a promise the deployment
  // cannot keep.
  it('does not advertise MCP as a surface customers can reach', () => {
    const { container } = render(<Landing />)
    expect(container.textContent ?? '').not.toMatch(/\bMCP\b/)
  })

  // ⚠ THE 90-DAY CLAIM IS DECIDED AND STAYS EXACTLY AS WRITTEN. Pinned so a later tidy-up of the
  // sentences around it cannot soften it by accident.
  it('leaves the ninety-day claim exactly as written', () => {
    const { container } = render(<Landing />)
    expect(container.textContent ?? '').toMatch(
      /near-zero at roughly ninety days of constant use/i,
    )
  })

  /**
   * THE STEPPER'S OTHER THREE BEATS WERE RENDERED BY NOTHING, AND THAT WAS MEASURED, not assumed.
   *
   * `WorkedHit` renders only `beats[step].figure`, and `step` starts at 0. So of the SIX µ-prefixed
   * unit labels on this page, four tests rendered three — `µLXC list` (beat 1), `µLXC you pay` and
   * `µLXC kept` — and `µLXC charged`, `µLXC saved` and `µLENS earned` were behind a click no test
   * performed. The case audit found the three it could see and would have stayed green over a
   * regression in the other three forever.
   *
   * Advancing the stepper is what puts them in front of the audit. It also happens to be the only
   * test of the stepper at all: each beat must show its own figure and its own body, so a wiring
   * mistake that showed beat 1's number under beat 3's sentence is caught here too.
   *
   * ⚠ AND THE UNIT LABEL WAS THE ONLY THING ANYTHING CHECKED — THE NUMBER BESIDE IT WAS RENDERED
   * BY NOTHING. MEASURED at `dfb6566`, not reasoned about: beat 3's figure re-wired to
   * `LEDGER_HIT.contributorEarnedMicroLENS` (822) with its unit left as `µLXC saved`, then the
   * FULL root `pnpm test` — EXIT 0, apps/web 1070/1070, packages/ui 350/350, test-manifest ok,
   * audit-reach 72/72, audit-gate ok both projects. The front page would have told a visitor that
   * 1,645 charged and 822 saved make 2,350, an arithmetic contradiction on the ONE part of this
   * page its own caption presents as measured rather than modelled, and every gate in the repo
   * agreed. A label check cannot see a wrong number under a right label; the table below now
   * carries the value with its unit and the assertion binds the two.
   *
   * ⚠ THIS IS A WIRING GUARD, NOT A SECOND COPY OF THE ARITHMETIC — SAID PLAINLY BECAUSE THE
   * DIFFERENCE IS WHAT MAKES IT HONEST. The expected strings are built from `economics.ts`'s own
   * constants through the page's own `micro`, so MUTATING A CONSTANT MOVES BOTH SIDES AND IS NOT
   * CAUGHT HERE. Its catcher is `economics.test.ts` ("adds up: charged + saved is list"), the file
   * that owns the arithmetic — measured as a control, not predicted: `chargedMicroLXC` 1645→1700
   * reds economics.test.ts ALONE and this file stays green. Re-pinning the four literals here
   * would be the third copy of a number that already has two homes, which is the shape
   * `site-parity.test.ts` warns against in its own header.
   */
  it('advances through all four beats of the worked hit, rendering each unit with its own figure', async () => {
    const { container } = render(<Landing />)
    const beats: [RegExp, string, string][] = [
      [/A request arrives/i, 'µLXC list', micro(LEDGER_HIT.listMicroLXC)],
      [/The pool has it/i, 'µLXC charged', micro(LEDGER_HIT.chargedMicroLXC)],
      [/The consumer keeps the difference/i, 'µLXC saved', micro(LEDGER_HIT.savedMicroLXC)],
      [/The contributor is paid/i, 'µLENS earned', micro(LEDGER_HIT.contributorEarnedMicroLENS)],
    ]
    // ⚠ NOT `getByText`. CaseSafe splits a protected label into spans, so no element's OWN text is
    // "µLXC list" any more and Testing Library's default matcher reads own text — measured, that
    // query fails with "the text is broken up by multiple elements". `textContent` is what the
    // visitor sees and what survives the fix; caseAudit.test.tsx pins that consequence.
    //
    // ⚠ AND IT MUST YIELD BETWEEN CLICKS, WHICH WAS MEASURED RATHER THAN REASONED ABOUT. The case
    // audit captures through a MutationObserver, whose callback is a MICROTASK. Clicking all four
    // beats synchronously mounted and unmounted beats 2 and 3 inside one synchronous block, so the
    // observer only ever saw the final DOM: with the fix reverted the audit named FOUR offenders,
    // not six, and `µLXC charged` and `µLXC saved` were invisible. Yielding lets the observer run
    // at each step. Verified by counting: 4 offenders without the yield, 6 with it.
    for (const [label, unit, value] of beats) {
      fireEvent.click(screen.getByRole('button', { name: label }))
      await new Promise((r) => setTimeout(r, 0))
      // ⚠ THE BEAT PANEL, NOT THE WHOLE PAGE, AND THAT IS MEASURED RATHER THAN TIDINESS. The
      // compounding curve below renders its own `Figure`s and at its starting pool size one of
      // them is "2,350µLXC you pay" — so a page-wide search for beat 1's number would be answered
      // by a DIFFERENT section and would stay green with the stepper unwired. `.tal-rise` is the
      // beat panel and the only className of that name in this app; rename it and this reads ''
      // and reds, rather than quietly finding the number somewhere else.
      const panel = container.querySelector('.tal-rise')?.textContent ?? ''
      expect(panel, `beat "${unit}" must render ${value} beside its own unit`).toContain(
        `${value}${unit}`,
      )
      // and the step really MOVED — every other beat's unit is gone, so a mis-wired stepper
      // showing beat 1's figure under beat 3's sentence fails here rather than passing quietly.
      for (const [, other] of beats) {
        if (other !== unit) expect(container.textContent ?? '').not.toContain(other)
      }
    }
  })
})
