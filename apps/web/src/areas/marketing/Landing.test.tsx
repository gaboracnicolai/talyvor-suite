import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CONTACT_EMAIL, Landing, POOLED_DISCOUNT_PERCENT } from './Landing'
import { LEDGER_HIT, SAVED_MICRO_LXC, micro } from './economics'

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
    expect(screen.getByRole('link', { name: /see how it works/i })).toBeInTheDocument()
  })

  it('says plainly that there is no inbox yet, rather than implying one', () => {
    render(<Landing />)
    expect(screen.getByText(/no inbox to write to yet/)).toBeInTheDocument()
  })

  // B28.2: ONE percentage is allowed, and it is the measured one. The pooled discount is derived in
  // Landing.tsx from the settled ledger row (list − charged over list), so the "30% off" in the copy
  // and the stepper's figures are one number. Any other % on the page is an unmeasured claim.
  it('prints exactly one kind of percentage — the pooled discount derived from the ledger row', () => {
    const { container } = render(<Landing />)
    expect(POOLED_DISCOUNT_PERCENT).toBe(30)
    // The page's own <style> block (B29.4's photo scrim and crops) is CSS, not copy a visitor reads.
    const page = container.cloneNode(true) as HTMLElement
    page.querySelectorAll('style').forEach((s) => s.remove())
    const percents = new Set(page.textContent?.match(/\d+%/g) ?? [])
    expect([...percents]).toEqual([`${POOLED_DISCOUNT_PERCENT}%`])
  })

  // ─────────────────────────────────────────────────────────────────────────
  // CHECKABLE CLAIMS. This page went live making four statements that source
  // does not support. Each assertion below names the string and the reason —
  // a test that only checked "the page renders" would pass on any wording.
  // ─────────────────────────────────────────────────────────────────────────

  // ⚠ THE REASON THIS ASSERTION USED TO CARRY IS FALSE, AND THIS ASSERTION COULD NOT HAVE TOLD
  // ANYONE. It read "Docs tags its own Lens calls by FEATURE (docs-ai-write / docs-ai-summarize)
  // and never by page, so no per-page attribution exists to report" — measured against
  // talyvor-docs `63b7ea6` that is no longer true (migration 0018's page_ai_spend_events ledger,
  // pages.own_ai_cost_usd, and cmd/docs/main.go's WithSpendBinder wiring; Landing.tsx carries the
  // three commands). The assertion below is an ABSENCE test on THIS page's text: it is green for
  // every possible state of the upstream, so no amount of drift over there can red it. That is not
  // a flaw to fix here — a claim guard's job is to hold the page — it is the reason the premise now
  // lives in deploy/decision-expiry.sh's uncheckable half, where a deployer is told to run it in a
  // talyvor-docs checkout. Read the register entry, not this comment, for the live premise.
  //
  // WHAT KEEPS THE SENTENCE OFF THE PAGE TODAY: the claim is the enumeration "an issue, a document
  // or a change" and the change half has no surface at all (the assertion two below), and
  // own_ai_cost_usd is a documented LOWER BOUND — docs-ai-ask and docs-search have no single page
  // and are excluded by design. Restoring the sentence is a claim decision, not a session's.
  it('does not claim a per-document cost, whose upstream number is a lower bound', () => {
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

  // B28.2: the page leads with wallets, and the price-curve claim is gone — "toward zero" and
  // the "near-zero" ninety-day bill were a projected shape, and no ledger row supports either.
  it('leads with wallets, and makes no price-curve claim', () => {
    const { container } = render(<Landing />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Money and markets for AI agents.')
    const text = container.textContent ?? ''
    expect(text).toMatch(/budget, spending rules, approvals and a live statement/i)
    expect(text).toMatch(/enforced before the model call or the payment/i)
    // wallets, chat, marketplace, and the one pooling block — each section's own heading
    for (const h of [/rules before the money moves/i, /console for your agents/i, /where agents spend/i, /repeated questions cost less/i])
      expect(screen.getByRole('heading', { level: 2, name: h })).toBeInTheDocument()
    expect(text).not.toMatch(/toward zero|ninety\s+days|90 days|near-zero/i)
    // B29.4 moved the footer line to the widened product, word for word from the build item.
    expect(text).toContain('Talyvor Ltd · money and markets for AI agents')
  })

  // B29.4: the board's WEBSITE HERO. The pieces a visitor sees, each read from the DOM: the drawn
  // lockup files (one per theme), the hero photograph with the 1200 version for phones and the
  // SAME srcset and sizes index.html preloads, and the band. The verb stack ROUTE · PROVE · REUSE ·
  // COMPOUND was retired with the tagline on 5 Oct 2026 (B32.1): no verb sits on the photograph.
  it('draws the board: the logo lockup, the preloaded hero photo without the verbs, and the band', () => {
    const { container } = render(<Landing />)
    const logos = [...container.querySelectorAll('img[data-brand="logo"]')].map((i) => i.getAttribute('src'))
    expect(logos).toEqual(['/brand/svg/talyvor-logo-dark-notag.svg', '/brand/svg/talyvor-logo-light-notag.svg'])

    const photo = container.querySelector('figure img')!
    expect(photo.getAttribute('src')).toBe('/brand/photos/hero.jpg')
    const srcset = photo.getAttribute('srcset')!
    expect(srcset).toContain('/brand/photos/hero-1200.jpg 1200w')
    const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf8')
    expect(html, 'index.html must preload the srcset the page uses').toContain(srcset)
    expect(html, 'index.html must preload with the sizes the page uses').toContain(photo.getAttribute('sizes')!)

    const figure = container.querySelector('figure.tal-hero-photo')!
    expect(figure.querySelector('.tal-hero-scrim'), 'the scrim stays').not.toBeNull()
    expect(container.querySelector('.tal-verbs')).toBeNull()
    // Per text node: the page's textContent joins adjacent spans, so "Route" + "Prove" reads as one word.
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    const words: string[] = []
    while (walker.nextNode()) words.push(...(walker.currentNode.textContent!.match(/\b(route|prove|reuse|compound)\b/gi) ?? []))
    expect(words, 'a retired verb shows as a word').toEqual([])

    const text = container.textContent ?? ''
    for (const line of [
      'SovereignDesigned to run on your own infrastructure.',
      'MeasurableEvery call and payment on a statement.',
      'IntegratedAccounts, payments, gateway and marketplace in one.',
      'CompoundingSavings and earnings build over time.',
    ])
      expect(text).toContain(line)
    // one brand icon per numbered section, in the page's order
    const icons = [...container.querySelectorAll('section img[src^="/brand/svg/icon-"]')].map((i) => i.getAttribute('src'))
    expect(icons).toEqual(['prove', 'route', 'compound', 'reuse'].map((n) => `/brand/svg/icon-${n}-teal.svg`))
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
      [/An agent asks/i, 'µLXC list', micro(LEDGER_HIT.listMicroLXC)],
      [/It is served from the pool/i, 'µLXC charged', micro(LEDGER_HIT.chargedMicroLXC)],
      [/The wallet keeps the difference/i, 'µLXC saved', micro(SAVED_MICRO_LXC)],
      [/The contributor is paid half/i, 'µLENS earned', micro(LEDGER_HIT.contributorEarnedMicroLENS)],
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
      // ⚠ THE BEAT PANEL, NOT THE WHOLE PAGE. A page-wide search for a beat's number could be
      // answered by some other section and stay green with the stepper unwired. `.tal-rise` is the
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
