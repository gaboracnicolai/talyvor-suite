import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FOCUS_RING_CLASSES,
  UNDERLINE_CLASSES,
  carriesFocusRing,
  focusOffendersIn,
  isKeyboardFocusable,
  isProseLink,
} from './focusAudit'

/**
 * The audit's vocabulary, the predicate, and the ONE exemption — each checked in the direction
 * that could go wrong quietly.
 *
 * ⚠ THE CLASS NAMES THE PRODUCT DOES NOT USE ARE NAMED ONLY IN HERE. Tailwind's extractor reads
 * raw text from every non-test file in the content set, so spelling a class in `focusAudit.ts`
 * would compile it into the shipped stylesheet — `89bd58d` shipped `.capitalize` and `.lowercase`
 * exactly that way, twice, including from the comment explaining why they had been removed. Test
 * files are excluded by the globs (`dc0bd07`'s `absoluteContent`), so this is where a name that
 * must not ship can be written down.
 */

const ring = (extra = '') => `${FOCUS_RING_CLASSES.join(' ')} ${extra}`.trim()

function el(html: string): Element {
  const host = document.createElement('div')
  host.innerHTML = html
  return host.firstElementChild as Element
}

describe('the ring this audit checks is the ring the system ships', () => {
  /**
   * ⚠ PARSED FROM THE SOURCE, NOT IMPORTED. Importing `focusRing` and comparing it to a list
   * derived from `focusRing` compares the constant to itself and passes for every value it could
   * ever hold — including the empty string, which would silence the whole audit. The two sets are
   * written independently and this is the only thing forcing them to agree.
   */
  const focusSource = readFileSync(
    resolve(import.meta.dirname, '../../../packages/ui/src/lib/focus.ts'),
    'utf8',
  )

  const shippedTokens = (): string[] => {
    const m = focusSource.match(/export const focusRing\s*=\s*\n?\s*'([^']+)'/)
    if (!m) throw new Error('could not find `export const focusRing = \'…\'` in focus.ts')
    return m[1].split(/\s+/).filter(Boolean)
  }

  it('finds the constant at all — a parse that quietly matched nothing would pass every check below', () => {
    expect(shippedTokens().length).toBeGreaterThan(0)
  })

  it('every class the system ships is one this audit requires', () => {
    for (const t of shippedTokens()) expect(FOCUS_RING_CLASSES).toContain(t)
  })

  it('every class this audit requires is one the system ships — a stale entry is red, not ignored', () => {
    for (const c of FOCUS_RING_CLASSES) expect(shippedTokens()).toContain(c)
  })

  it('the ring is the accent, at 2px, at 2px offset, only on keyboard focus', () => {
    // Pinned as NAMES rather than as a screenshot: these four are what Chrome 151 was measured
    // rendering as `solid 2px rgb(58,214,192) offset 2px` (see focusAudit.ts).
    expect(FOCUS_RING_CLASSES).toContain('focus-visible:outline-accent')
    expect(FOCUS_RING_CLASSES).toContain('focus-visible:outline-2')
    expect(FOCUS_RING_CLASSES).toContain('focus-visible:outline-offset-2')
    // `outline-none` suppresses the UA ring so the two never paint together.
    expect(FOCUS_RING_CLASSES).toContain('outline-none')
  })
})

describe('a partial ring is not the ring', () => {
  it('accepts the whole ring', () => {
    expect(carriesFocusRing(el(`<button class="${ring()}">go</button>`))).toBe(true)
  })

  /**
   * ⚠ THIS IS THE CASE THAT WAS ACTUALLY IN THE PRODUCT. SpaceList's space row carried
   * `outline-accent focus-visible:outline` — the right hue and nothing else — which Chrome 151
   * renders as `solid 1px` at offset 0 against the system's `solid 2px` at offset 2px. Half a
   * ring reads as a ring in review and is a different control on screen.
   */
  for (const missing of FOCUS_RING_CLASSES) {
    it(`rejects a ring missing ${missing}`, () => {
      const partial = FOCUS_RING_CLASSES.filter((c) => c !== missing).join(' ')
      expect(carriesFocusRing(el(`<button class="${partial}">go</button>`))).toBe(false)
    })
  }

  it('rejects the exact hand-rolled shape that was shipping', () => {
    expect(carriesFocusRing(el('<div tabindex="0" class="cursor-pointer outline-accent focus-visible:outline"></div>'))).toBe(
      false,
    )
  })
})

describe('what a keyboard can actually reach', () => {
  it('reaches a button, a link with an href, and the form controls', () => {
    expect(isKeyboardFocusable(el('<button></button>'))).toBe(true)
    expect(isKeyboardFocusable(el('<a href="/x">x</a>'))).toBe(true)
    expect(isKeyboardFocusable(el('<input>'))).toBe(true)
    expect(isKeyboardFocusable(el('<select></select>'))).toBe(true)
    expect(isKeyboardFocusable(el('<textarea></textarea>'))).toBe(true)
  })

  it('reaches a div that was given a tab stop — the shape a tag-name rule cannot find', () => {
    // SpaceList's space row is exactly this: role="link", tabIndex 0, its own key handler.
    expect(isKeyboardFocusable(el('<div tabindex="0" role="link"></div>'))).toBe(true)
  })

  it('does NOT reach an anchor with no href, a disabled control, or a -1 tab stop', () => {
    expect(isKeyboardFocusable(el('<a>x</a>'))).toBe(false)
    expect(isKeyboardFocusable(el('<button disabled></button>'))).toBe(false)
    expect(isKeyboardFocusable(el('<div tabindex="-1"></div>'))).toBe(false)
  })
})

describe('the prose-link exemption, and the half that stops it widening', () => {
  for (const u of UNDERLINE_CLASSES) {
    it(`exempts an <a> carrying ${u} — a link in a run of text`, () => {
      expect(isProseLink(el(`<a href="/x" class="${u}">terms</a>`))).toBe(true)
    })
  }

  /**
   * ⚠ THE EXEMPTION IS A SHAPE, NOT A TAG. Without this, "anchors are exempt" is the rule, and a
   * link dressed as a tile or a card — the thing a keyboard user reads as a control — would be
   * silently uncovered by a carve-out written for prose.
   */
  it('does NOT exempt an <a> that is not underlined', () => {
    expect(isProseLink(el('<a href="/x" class="rounded-card border border-rule p-3">a tile</a>'))).toBe(false)
  })

  it('does NOT exempt a non-anchor that happens to be underlined', () => {
    expect(isProseLink(el('<button class="underline">not a link</button>'))).toBe(false)
  })
})

describe('the audit over a rendered tree', () => {
  it('names an unringed control and stays silent about a ringed one and a prose link', () => {
    const host = document.createElement('div')
    host.innerHTML = `
      <a href="/terms" class="underline">Terms</a>
      <button class="${ring()}">Save</button>
      <textarea class="min-h-32 w-full rounded-control"></textarea>
    `
    const found = focusOffendersIn(host)
    expect(found).toHaveLength(1)
    expect(found[0].tag).toBe('textarea')
  })

  it('reports WHICH of the ring it does carry, so a partial ring is not read as a bare control', () => {
    const host = document.createElement('div')
    host.innerHTML = '<div tabindex="0" class="outline-accent focus-visible:outline"></div>'
    const found = focusOffendersIn(host)
    expect(found).toHaveLength(1)
    expect(found[0].present).toEqual(['focus-visible:outline'])
  })

  it('is silent on a tree with nothing focusable — the floor, not this, is what catches an empty render', () => {
    const host = document.createElement('div')
    host.innerHTML = '<p>just words</p>'
    expect(focusOffendersIn(host)).toHaveLength(0)
  })
})
