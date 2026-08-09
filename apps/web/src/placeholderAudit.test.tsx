import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  MUST_RENDER_PLACEHOLDER,
  PLACEHOLDER_CLASS,
  declaresPlaceholderColour,
  unstyledPlaceholdersIn,
} from './placeholderAudit'

/**
 * THE AUDIT'S OWN TESTS.
 *
 * The offender rule in test-setup.ts is SILENT when the product is correct, so once the three
 * sites are fixed it says nothing on any surface — which is indistinguishable from a predicate
 * that answers "styled" to everything. These are what catch that, and control C6 makes exactly
 * that edit and lands here.
 */

const dom = (html: string): ParentNode => {
  const host = document.createElement('div')
  host.innerHTML = html
  return host
}

describe('the predicate', () => {
  it('a bare field is an offender — nothing declares its placeholder colour', () => {
    const found = unstyledPlaceholdersIn(dom('<input placeholder="What needs doing?" class="text-ink">'))
    expect(found.map((f) => f.placeholder)).toEqual(['What needs doing?'])
  })

  it('a field carrying the class is not', () => {
    expect(unstyledPlaceholdersIn(dom(`<input placeholder="x" class="text-ink ${PLACEHOLDER_CLASS}">`))).toEqual([])
  })

  /**
   * ⚠ THE ONE THAT STOPS THE GUARD BEING WIDENED INTO A NO-OP. `text-faint` on the element sets
   * the TYPED text's colour and says nothing about `::placeholder`; only the `placeholder:`
   * variant compiles to the pseudo-element rule. A predicate that merely looked for `text-faint`
   * would call all three offenders styled — every one of them already carries `text-ink`, and
   * `text-faint` is one rename away.
   */
  it('a plain colour utility is not a placeholder colour', () => {
    expect(unstyledPlaceholdersIn(dom('<input placeholder="x" class="text-faint">'))).toHaveLength(1)
    const el = dom('<input class="text-faint">').firstElementChild
    expect(declaresPlaceholderColour(el!)).toBe(false)
  })

  /**
   * ⚠ THE CLASS MUST BE THE ELEMENT'S OWN. `.placeholder\:text-faint::placeholder` matches only
   * that element's pseudo-element, so an ancestor carrying it paints nothing. Walking up the tree
   * — which is exactly what figureAudit does for `font-figure`, correctly, because that one
   * inherits — would report a green Chrome does not paint. Control C6.
   */
  it('an ANCESTOR carrying the class does not style a descendant placeholder', () => {
    const found = unstyledPlaceholdersIn(dom(`<div class="${PLACEHOLDER_CLASS}"><input placeholder="x"></div>`))
    expect(found.map((f) => f.placeholder)).toEqual(['x'])
  })

  it('a prefix match is not a match — `placeholder:text-faint/50` is a different colour', () => {
    expect(unstyledPlaceholdersIn(dom('<input placeholder="x" class="placeholder:text-faint/50">'))).toHaveLength(1)
  })

  it('an EMPTY placeholder paints nothing, so it is not an offender', () => {
    expect(unstyledPlaceholdersIn(dom('<input placeholder="">'))).toEqual([])
  })

  it('a textarea is a field too — the rule is the attribute, not the tag', () => {
    const found = unstyledPlaceholdersIn(dom('<textarea placeholder="Body"></textarea>'))
    expect(found.map((f) => f.tag)).toEqual(['textarea'])
  })

  it('an element with no placeholder attribute is not asked', () => {
    expect(unstyledPlaceholdersIn(dom('<input class="text-ink"><div>hello</div>'))).toEqual([])
  })
})

/**
 * ⚠ THE CONSTANT IS HARDCODED HERE AND IN THE AUDIT, DELIBERATELY, AND THIS TEST IS WHY.
 *
 * Deriving the expected class from `Input.tsx` would make the audit compare the component to
 * itself: change the component's placeholder colour and the expectation changes with it, so every
 * check stays green for every value. So the audit states the literal and this test asserts the
 * component still agrees with it. Control C5 changes `Input.tsx` and lands here.
 */
describe('the literal the audit states is the one the design system declares', () => {
  const INPUT_TSX = resolve(import.meta.dirname, '../../../packages/ui/src/components/Input.tsx')
  // ⚠ Reads, never `existsSync`-and-skip: a missing path must throw here rather than quietly
  // turn this whole block into a pass. That is how a file-reading test goes blind (`c71ca9c`).
  const input = readFileSync(INPUT_TSX, 'utf8')

  it('reads the real component, not an empty string', () => {
    // ⚠ A file-reading test that goes blind reads as a pass. `grep` on nothing finds nothing.
    expect(input.length, 'Input.tsx read as empty — the path above is wrong').toBeGreaterThan(200)
    expect(input).toContain('export const Input')
  })

  it('Input.tsx declares exactly `placeholder:text-faint`', () => {
    expect(
      input.includes(PLACEHOLDER_CLASS),
      `Input.tsx no longer declares ${PLACEHOLDER_CLASS} — either the design system changed its ` +
        'placeholder colour (update PLACEHOLDER_CLASS and re-measure the contrast) or the ' +
        'component lost it.',
    ).toBe(true)
  })

  it('the audit is not policing a class the design system never uses', () => {
    expect(PLACEHOLDER_CLASS).toBe('placeholder:text-faint')
  })
})

/**
 * The floor's keys are the paths vitest reports, not basenames. #101's C3 found a floor keyed by
 * basename against a full-path lookup that had never fired once, so this asserts the SHAPE of the
 * key rather than trusting it.
 */
describe('the floor', () => {
  it('is keyed by the path vitest reports', () => {
    for (const key of Object.keys(MUST_RENDER_PLACEHOLDER)) {
      expect(key, `${key} is not a src-relative path — a basename key never matches`).toMatch(
        /^src\/.*\.test\.tsx$/,
      )
    }
  })

  it('names every file, and only files, that render a placeholder', () => {
    expect(Object.keys(MUST_RENDER_PLACEHOLDER).sort()).toEqual([
      'src/Legal.test.tsx',
      'src/SessionExpired.test.tsx',
      'src/areas/docs/DocsArea.test.tsx',
      'src/areas/lens/Keys.test.tsx',
      'src/areas/track/IssueList.test.tsx',
      'src/areas/track/TrackArea.test.tsx',
    ])
  })

  it('every entry carries a reason, so a future session can tell a lost fixture from a stale row', () => {
    for (const [file, why] of Object.entries(MUST_RENDER_PLACEHOLDER)) {
      expect(why.length, `${file} has no reason`).toBeGreaterThan(10)
    }
  })
})

/**
 * The design system's own field must satisfy the rule it declares — otherwise the audit polices
 * the hand-rolled twins and exempts the component, which is the shape focus.ts was corrected for.
 */
describe('the component the rule comes from', () => {
  it('an <Input> renders its own placeholder colour', async () => {
    const { Input } = await import('@talyvor/ui')
    const { container } = render(<Input placeholder="Key name" />)
    expect(unstyledPlaceholdersIn(container)).toEqual([])
  })
})
