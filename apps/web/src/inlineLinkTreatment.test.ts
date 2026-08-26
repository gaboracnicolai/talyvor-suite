import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

// THE INLINE LINK HAS NO ONE ANSWER, AND THE DIVERGENCE IS GROWING — W1.1.16, MEASURED.
//
// W1.1.16 asks for one treatment applied to every underlined link, plus "the sweep that keeps it".
// ⚠ THE SWEEP IS HERE. THE ONE TREATMENT IS NOT, AND THIS FILE IS WHY: the item says
// "DECIDE FIRST, DO NOT GUESS: `hover:text-ink` vs `hover:text-muted` is a real choice … Measure
// what the site does" — and the site, measured, does NEITHER.
//
// ⚠⚠ THE ITEM'S EVIDENCE IS A BUTTON. It cites one line of `Landing.tsx` for "on the site every
// state change moves". That element is the STEPPER TAB — a `<button>` — and the second moving
// element on that page is the stepper's own progress rule. The site's own inline LINKS, all of
// them, carry a bare `underline` and no hover state at all. So the tiebreaker the item names
// declines to break the tie, and both halves of the choice would move the console AWAY from the
// front door rather than toward it, which is W1.1's whole purpose.
//
// ⚠ THAT CLAIM IS CITED BY SHAPE, NOT BY LINE, AND DELIBERATELY. Writing this file with the line
// number in it made `pointerAudit` red — a new citing file is a new pointer, not a new registry
// entry to add quietly — and a line number pointing into the front page would rot the next time
// anyone edits it. The second test below checks the claim against the source instead, which is
// what a pointer was standing in for.
//
// ⚠ AND THE CHOICE IS WIDER THAN THE ITEM KNEW. It recorded "5 carry one, in FOUR different
// shapes". Measured at `24979ab` there are NINE across FOUR hover shapes, including two the item
// does not mention (`hover:text-accent`, `hover:decoration-accent`). The set is diverging, not
// converging: every screen rebuild adds links, and each picks whatever its neighbour did.
//
// ⚠ `@talyvor/ui` SHIPS A COMPONENT FOR EVERY CONTROL EXCEPT THIS ONE. Button, Input, Select,
// Switch, Row, Pill, NavItem, Card, TierDot, ThemeToggle — and no Link. The most-rendered
// interactive element in the product is the one with no component and no rule, which is exactly
// how it ends up in four shapes.
//
// ⚠⚠ SO THIS FILE PINS THE FACTS AND REFUSES TO INVENT THE RULE. It fails when a FIFTH shape
// appears, when the counts move, or — the load-bearing one — when the SITE's links acquire a hover
// state, because that is the day the decision becomes measurable and the item can be finished
// without a product call.

const WEB = join(__dirname)
const UI = join(__dirname, '../../../packages/ui/src')

function sources(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '__tests__') continue
        walk(p)
        continue
      }
      if (!p.endsWith('.tsx')) continue
      if (p.includes('.test.')) continue
      out.push(p)
    }
  }
  walk(root)
  return out
}

/** Every `className` in the product that carries the `underline` class, with its file. */
function underlinedClassLists(): Array<{ file: string; cls: string }> {
  const out: Array<{ file: string; cls: string }> = []
  for (const root of [WEB, UI]) {
    for (const file of sources(root)) {
      const src = readFileSync(file, 'utf8')
      // Both spellings the product uses: a plain string, and a template literal (the shape that
      // interpolates `focusRing`). A rule that read only one of them would under-report by a third.
      for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        const cls = m[1] ?? m[2] ?? ''
        if (!/\bunderline\b/.test(cls)) continue
        out.push({ file: relative(join(__dirname, '../../..'), file), cls })
      }
    }
  }
  return out
}

/** The hover/motion tokens of one class list, normalised so order cannot make two shapes look like three. */
function treatment(cls: string): string {
  const toks = cls
    .split(/\s+/)
    .filter((t) => t.startsWith('hover:') || t.startsWith('transition') || t.startsWith('duration'))
    .sort()
  return toks.length === 0 ? '(none)' : toks.join(' ')
}

/**
 * THE PINNED CENSUS. Every entry carries the reason it is what it is. Do not delete a row to make
 * this pass — a row disappearing is either the migration W1.1.16 asks for (in which case update the
 * table and say so) or a link that lost its affordance.
 */
const SHAPES: Record<string, { count: number; why: string }> = {
  '(none)': {
    count: 36,
    why:
      'the majority, and the shape the SITE ITSELF uses for all five of its inline links. It is not ' +
      'a bug by default — it is the front door\'s answer — which is precisely why "give them all a ' +
      'hover" is a decision rather than a repair.',
  },
  'duration-200 hover:text-ink transition-colors': {
    count: 4,
    why:
      'docs/components.tsx (the breadcrumb, the one site with a recorded argument, and it argues ' +
      'about the RESTING underline rather than this colour), Overview ×2 and CacheCard — the three ' +
      "W1.1.0 shipped as `/`'s motion proof. W1.1.17a's census reads those three as the whole of " +
      "that screen's motion, so removing them would take `/` to zero.",
  },
  'duration-200 hover:text-muted transition-colors': {
    count: 3,
    why:
      'the legal footer, twice in App.tsx and once in legalParts.tsx. It DIMS on hover where the ' +
      'set above BRIGHTENS, which is the two candidate answers shipping side by side in one product.',
  },
  'duration-200 hover:text-accent transition-colors': {
    count: 1,
    why: 'track/IssueList.tsx — a third answer the item did not know existed.',
  },
  'duration-200 hover:decoration-accent transition-colors': {
    count: 1,
    why:
      'docs/pm.tsx — a fourth, and the only one that moves the RULE rather than the text. It is ' +
      'rendered inside user content, which is an argument for it being different; nothing records ' +
      'that argument.',
  },
}

describe('the inline link has no one answer, and this file is the census that says so', () => {
  const found = underlinedClassLists()

  // NON-VACUITY. A collector that finds nothing passes every assertion below. This repo has shipped
  // that three times, so the floor is first and it sits under the real number rather than on it.
  it('the collector actually finds the links', () => {
    expect(found.length).toBeGreaterThanOrEqual(40)
  })

  it('reads BOTH className spellings — a rule that read only strings would miss a third of them', () => {
    // The template-literal shape is what interpolates `focusRing`, and it is where docs and track
    // write their links. Measured: at least four such lists exist.
    const templated = found.filter((f) => /focusRing|\$\{/.test(f.cls))
    expect(templated.length).toBeGreaterThanOrEqual(3)
  })

  it('the shape SET is exactly the pinned one, in both directions', () => {
    const measured = new Set(found.map((f) => treatment(f.cls)))
    const pinned = new Set(Object.keys(SHAPES))
    const appeared = [...measured].filter((s) => !pinned.has(s))
    const vanished = [...pinned].filter((s) => !measured.has(s))
    expect(
      { appeared, vanished },
      'A FIFTH inline-link treatment appeared, or a pinned one is gone.\n' +
        'W1.1.16 exists because this set has more than one member; it is not allowed to grow while ' +
        'the item is open. If this IS the migration the item asks for, update SHAPES and say which ' +
        'answer was chosen and by whom — the choice is a product decision, not a repair.',
    ).toEqual({ appeared: [], vanished: [] })
  })

  it('each shape has the pinned number of sites', () => {
    const counted: Record<string, number> = {}
    for (const f of found) counted[treatment(f.cls)] = (counted[treatment(f.cls)] ?? 0) + 1
    const drift = Object.entries(SHAPES)
      .filter(([shape, { count }]) => (counted[shape] ?? 0) !== count)
      .map(([shape, { count }]) => `${shape}: pinned ${count}, measured ${counted[shape] ?? 0}`)
    expect(
      drift,
      'The inline-link census moved. A new link picked one of the four existing answers (or none), ' +
        'which is the drift W1.1.16 is about — every screen rebuild adds links and each copies its ' +
        'neighbour. Update the number here WITH the reason, the way caseCallSites.test.ts does.',
    ).toEqual([])
  })
})

describe('the premise W1.1.16 rests on, pinned so it cannot rot silently', () => {
  it('THE SITE\'S OWN INLINE LINKS CARRY NO HOVER STATE — so "measure what the site does" answers "nothing"', () => {
    const landing = readFileSync(join(WEB, 'areas/marketing/Landing.tsx'), 'utf8')
    const links = [...landing.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)]
      .map((m) => m[1] ?? m[2] ?? '')
      .filter((cls) => /\bunderline\b/.test(cls))

    // Two-sided: the front page must still HAVE inline links, or "none of them moves" would be a
    // statement about the search rather than about the site.
    expect(links.length).toBeGreaterThanOrEqual(5)

    const moving = links.filter((cls) => treatment(cls) !== '(none)')
    expect(
      moving,
      'The site\'s own inline links now carry a hover treatment.\n' +
        '⚠ THAT IS GOOD NEWS FOR W1.1.16: the tiebreaker it names has started answering. Take the ' +
        'site\'s answer, apply it to every link in the console, update SHAPES to a single entry, and ' +
        'close the item. Until then this test is what records that the site declined to choose.',
    ).toEqual([])
  })

  it('the item\'s cited evidence is a BUTTON, not a link — which is why it could not settle the choice', () => {
    const landing = readFileSync(join(WEB, 'areas/marketing/Landing.tsx'), 'utf8')
    // Every element on the front page that DOES carry a colour transition, and whether any is a link.
    const movingLists = [...landing.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)]
      .map((m) => m[1] ?? m[2] ?? '')
      .filter((cls) => /transition-colors/.test(cls))
    expect(movingLists.length).toBeGreaterThanOrEqual(2) // the stepper tab and its progress rule
    // None of them is underlined — i.e. none is a link in prose.
    expect(
      movingLists.filter((cls) => /\bunderline\b/.test(cls)),
      'A moving element on the front page is now an underlined link. If the site has started ' +
        'animating its links, W1.1.16 is decidable — see the test above.',
    ).toEqual([])
  })
})
