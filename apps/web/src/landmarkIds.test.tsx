import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Input } from '@talyvor/ui'

import { App, CONSOLE_ROUTES, queryClient } from './App'
import { Region, RegionScreen } from './components/Region'

/**
 * AN `id` IS A DOCUMENT-WIDE NAME, AND NOTHING IN THIS REPO CHECKED THAT TWO THINGS DID NOT TAKE
 * THE SAME ONE.
 *
 * ── HOW THIS WAS FOUND, WHICH IS THE PART WORTH KEEPING ──────────────────────────────────────
 *
 * Not by reading. W1.1.3's control C4 set a new region's `index` to `01`, colliding with the
 * balances region, and PREDICTED exactly one catcher — the index-sequence assertion. It was caught
 * by TWO, and the second catcher is the finding: `Region.tsx` built its label id as
 * `region-${index}-label` and pointed `aria-labelledby` at it, so two regions sharing an index
 * share a DOM id. `getElementById` returns the FIRST. **The second region's accessible name
 * silently becomes the first region's label** — a screen reader lists two sections called "What
 * you have", and nothing about the visible page changes.
 *
 * ── THE CLASS, MEASURED BEFORE THE INSTANCE WAS FIXED (W1.1.13's own instruction) ────────────
 *
 * "How many other id/aria-labelledby pairs in this app are built from a caller-supplied string
 * rather than a generated one? That is the class, not the instance." MEASURED at `5a82c89` across
 * both packages: **31 call sites in 5 files** carry an `id`, `aria-labelledby`, `aria-describedby`
 * or `htmlFor`. The answer is sharper than the question expected:
 *
 *   · `Region.tsx` (3) was the ONLY one built from a caller-supplied string.
 *   · The other 28 — `Landing.tsx` ×18, `IssueDetail.tsx` ×4, `PageChangelog.tsx` ×4,
 *     `PageTranslation.tsx` ×2 — are CONSTANT LITERALS (`hero-heading`, `issue-description`).
 *   · **`useId` appears ZERO times in either package.** Not one id in this product is generated.
 *
 * So the class is not "callers supply ids"; it is "every id here is hand-written, and exactly one
 * of them was parameterised". The constants are safe only while each owning component renders at
 * most once per document, which is true today and is a fact nothing was checking either.
 *
 * ── AND THE DEFECT WAS LATENT, WHICH IS WHY THIS IS A SWEEP AND NOT AN EDIT ───────────────────
 *
 * MEASURED across all 17 addresses (the twelve `CONSOLE_ROUTES` plus /marketing, /privacy, /terms,
 * /signup, /signin) at `5a82c89`, BEFORE the fix: 44 ids rendered, **0 duplicates and 0 dangling
 * references**. There was nothing to repair. A defect that is invisible until someone reuses a
 * number is exactly the kind that arrives with the next screen rebuild, and six of those are still
 * OPEN — all of them instructed to use this component.
 *
 * ⚠ THIS IS NOT `LandmarkCoverage.test.tsx` A SECOND TIME, and the distinction is worth keeping so
 * the two are not merged later. That file asks whether the product's CONTENT SITS INSIDE a
 * landmark — coverage, "is any readable text outside every region". This one asks whether the
 * landmarks that exist are DISTINCTLY NAMED — identity. A screen can be perfectly covered and
 * still report two sections with one name; that is precisely the state W1.1.3's control produced.
 */

function mockBff() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url === '/auth/me') {
      return new Response(JSON.stringify({ mode: 'disabled', authenticated: false, user: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response('null', { status: 404 })
  })
}

beforeEach(mockBff)
afterEach(() => {
  vi.restoreAllMocks()
  queryClient.clear()
  document.body.replaceChildren()
})

/** The public addresses. `CONSOLE_ROUTES` covers the gated twelve; these are the rest of the app. */
const PUBLIC_ADDRESSES = ['/marketing', '/privacy', '/terms', '/signup', '/signin']

/**
 * The two failures an id can have, found on whatever is currently in the document.
 *
 * ⚠ IT RETURNS PROBLEMS RATHER THAN ASSERTING, so the same function runs over the real app AND
 * over the deliberately-broken fixtures below. A predicate that only ever sees correct input is a
 * predicate nobody has tested — every one of the controls at the bottom of this file feeds this
 * exact function something wrong and requires it to say so.
 *
 * ⚠ AND IT COUNTS RATHER THAN LOOKING UP. `document.getElementById` returns the FIRST match and
 * cannot report that there were two, which is precisely the failure being hunted: the browser
 * resolves a duplicated `aria-labelledby` silently and successfully. `querySelector('#' + id)` is
 * not an option either — MEASURED: React 18.3.1's `useId()` emits `:r0:`, and
 * `querySelector('#:r0:-label')` throws `SyntaxError: is not a valid selector`. So the census
 * collects the ids as strings and counts them.
 */
export function idProblems(root: ParentNode, where: string): string[] {
  const problems: string[] = []
  const ids = Array.from(root.querySelectorAll('[id]')).map((e) => e.id)

  const times = new Map<string, number>()
  for (const id of ids) times.set(id, (times.get(id) ?? 0) + 1)
  for (const [id, n] of times) {
    if (n > 1) problems.push(`${where}: id "${id}" is on ${n} elements — a document-wide name taken twice`)
  }

  const resolves = (token: string) => ids.filter((i) => i === token).length
  for (const attr of ['aria-labelledby', 'aria-describedby']) {
    for (const el of Array.from(root.querySelectorAll(`[${attr}]`))) {
      // The attribute is a SPACE-SEPARATED ID LIST, not one id — a reader that split on nothing
      // would score every multi-token reference as dangling and every one of them as a false red.
      for (const token of (el.getAttribute(attr) ?? '').split(/\s+/).filter(Boolean)) {
        const n = resolves(token)
        if (n !== 1) problems.push(`${where}: ${attr}="${token}" resolves to ${n} elements, not 1`)
      }
    }
  }
  for (const el of Array.from(root.querySelectorAll('label[for]'))) {
    const token = el.getAttribute('for') ?? ''
    const n = resolves(token)
    if (n !== 1) problems.push(`${where}: <label for="${token}"> resolves to ${n} elements, not 1`)
  }
  return problems
}

async function at(address: string) {
  window.history.pushState({}, '', address)
  render(<App />)
  try {
    await screen.findByRole('navigation', { name: /sections/i })
  } catch {
    // A public address has no console nav; let its first paint settle instead.
    await new Promise((r) => setTimeout(r, 250))
  }
}

describe('no two things in this product answer to the same name', () => {
  it(
    'every address renders unique ids and no dangling reference',
    { timeout: 60_000 },
    async () => {
      const problems: string[] = []
      let idsSeen = 0
      const addresses = [
        ...CONSOLE_ROUTES.map((r) => r.path.replace(/\/\*$/, '')),
        ...PUBLIC_ADDRESSES,
      ]
      for (const address of addresses) {
        await at(address)
        idsSeen += document.querySelectorAll('[id]').length
        problems.push(...idProblems(document, address))
        document.body.replaceChildren()
        queryClient.clear()
      }

      // ⚠ THE FLOOR IS THE HALF THAT KEEPS THIS FROM GOING QUIETLY VACUOUS. A sweep that stops
      // finding ids passes with an empty problem list, which reads exactly like a correct product.
      // MEASURED at `5a82c89`: 44 ids across these 17 addresses.
      expect(
        idsSeen,
        'the census found (almost) no ids at all — it is passing because it has no subject',
      ).toBeGreaterThan(25)
      expect(problems).toEqual([])
    },
  )
})

describe('Region — the one id in this product that was built from a caller-supplied string', () => {
  // THE REGRESSION, STATED AS A TEST. Two regions given the same index is a mistake a screen
  // rebuild makes by writing `index="01"` twice, and it used to be silent.
  it('two regions with the SAME index still get different ids', () => {
    const { container } = render(
      <RegionScreen>
        <Region index="01" label="What you have">
          <p>first</p>
        </Region>
        <Region index="01" label="What you owe">
          <p>second</p>
        </Region>
      </RegionScreen>,
    )
    expect(idProblems(container, 'two regions sharing index 01')).toEqual([])
  })

  it('and each one keeps its OWN accessible name', () => {
    render(
      <RegionScreen>
        <Region index="01" label="What you have">
          <p>first</p>
        </Region>
        <Region index="01" label="What you owe">
          <p>second</p>
        </Region>
      </RegionScreen>,
    )
    // The failure this replaces: BOTH sections were named "What you have".
    expect(screen.getByRole('region', { name: 'What you have' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'What you owe' })).toBeInTheDocument()
  })

  it('the same holds when the regions are named by their HEADING rather than their eyebrow', () => {
    render(
      <RegionScreen>
        <Region index="00" label="Members" heading="Everyone who can reach this workspace.">
          <p>first</p>
        </Region>
        <Region index="00" label="Keys" heading="Mint and revoke the keys that reach Lens.">
          <p>second</p>
        </Region>
      </RegionScreen>,
    )
    expect(
      screen.getByRole('region', { name: 'Everyone who can reach this workspace.' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: 'Mint and revoke the keys that reach Lens.' }),
    ).toBeInTheDocument()
  })

  // The index is still what the reader SEES. Making the id independent of it must not quietly
  // turn the visible label into a generated string.
  it('the index a reader sees is still the one the caller wrote', () => {
    const { container } = render(
      <Region index="07" label="Somewhere">
        <p>x</p>
      </Region>,
    )
    expect(container.querySelector('[data-testid="region-index"]')?.textContent).toBe('07')
  })

  // ⚠ AND THE ID MUST BE USABLE AS A CSS SELECTOR, which is not automatic. React 18.3.1's raw
  // `useId()` is `:r0:` and `querySelector('#:r0:-label')` throws SyntaxError — measured. Tests and
  // any future guard reach for elements that way, so an id that cannot be selected turns a clean
  // red into a crash somewhere unrelated.
  it('the ids it writes can be used in a selector', () => {
    const { container } = render(
      <Region index="00" label="Somewhere">
        <p>x</p>
      </Region>,
    )
    const section = container.querySelector('section')
    const labelledBy = section?.getAttribute('aria-labelledby') ?? ''
    expect(labelledBy).not.toBe('')
    expect(() => container.querySelector(`#${labelledBy}`)).not.toThrow()
    expect(container.querySelector(`#${labelledBy}`)).not.toBeNull()
  })
})

describe('CONTROLS — the census can report a problem, so its silence means something', () => {
  // ⚠ EVERY CASE ABOVE PASSED ON ITS FIRST RUN AGAINST THE REAL APP, because there is no live
  // duplicate today. That is exactly when a guard is worth least and looks worth most. These feed
  // `idProblems` the three shapes it exists to catch and require it to name each one.
  it('C1 a duplicated id is reported, and named', () => {
    const { container } = render(
      <div>
        <span id="taken">one</span>
        <span id="taken">two</span>
      </div>,
    )
    const problems = idProblems(container, 'C1')
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('"taken" is on 2 elements')
  })

  it('C2 an aria-labelledby pointing at a DUPLICATED id is reported — the exact W1.1.3 failure', () => {
    // This is the pre-fix Region, written out by hand: two sections, one index, one id.
    const { container } = render(
      <div>
        <section aria-labelledby="region-01-label">
          <span id="region-01-label">What you have</span>
        </section>
        <section aria-labelledby="region-01-label">
          <span id="region-01-label">What you owe</span>
        </section>
      </div>,
    )
    const problems = idProblems(container, 'C2')
    // one duplicate id, and two references that each resolve to two elements
    expect(problems.length).toBeGreaterThanOrEqual(3)
    expect(problems.join('\n')).toContain('resolves to 2 elements')
  })

  it('C3 an aria-labelledby pointing at NOTHING is reported', () => {
    const { container } = render(
      <section aria-labelledby="never-rendered">
        <p>x</p>
      </section>,
    )
    const problems = idProblems(container, 'C3')
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('resolves to 0 elements')
  })

  it('C4 a <label for> pointing at nothing is reported', () => {
    const { container } = render(
      <div>
        <label htmlFor="no-such-field">Name</label>
        {/* The product's Input, not a bare <input>: focusAudit runs after every test in this
            project and refuses a keyboard-focusable element with no accent focus ring. A fixture
            that trips a DIFFERENT repo-wide rule reds this case for a reason that has nothing to
            do with what it is checking. */}
        <Input id="a-different-field" aria-label="A different field" />
      </div>,
    )
    const problems = idProblems(container, 'C4')
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('<label for="no-such-field">')
  })

  // ⚠ THE NEGATIVE CONTROL, AND IT IS THE ONE THAT KEEPS THE OTHERS HONEST. A predicate that
  // reported a problem for every input would pass C1–C4 and be useless. A MULTI-TOKEN reference is
  // the specific shape a naive reader gets wrong — `aria-labelledby` is an ID LIST, and treating
  // it as one id would score this correct markup as dangling.
  it('C5 correct markup — including a MULTI-TOKEN reference — reports nothing', () => {
    const { container } = render(
      <div>
        <span id="part-one">Monthly</span>
        <span id="part-two">spend</span>
        <section aria-labelledby="part-one part-two">
          <label htmlFor="field-a">A</label>
          <Input id="field-a" aria-describedby="part-two" />
        </section>
      </div>,
    )
    expect(idProblems(container, 'C5')).toEqual([])
  })
})
