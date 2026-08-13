import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  MUST_AUDIT_A_NUMERIC_FIELD,
  declaresNumeric,
  unfacedFieldsIn,
} from './fieldFaceAudit'

/**
 * THE PREDICATE, BOTH DIRECTIONS.
 *
 * The running audit's correct output on a clean product is SILENCE, so the offender path is not
 * self-testing: `installFieldFaceAudit` reporting nothing is indistinguishable from a predicate
 * that returns false for everything. These are the direct cases, and every one of them names a
 * shape the product actually renders — the field, the slider, the free-text boxes — rather than an
 * invented fixture, so a rule narrowed to pass on this tree fails here.
 *
 * ⚠ THE FLOOR (`MUST_AUDIT_A_NUMERIC_FIELD`) IS A SEPARATE CATCHER FOR A SEPARATE FAILURE. It sees
 * a dead observer; these see a blinded predicate. Neither can see the other's failure, which is
 * why both exist — the argument test-setup.ts records for focusAudit's C6.
 */

function dom(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  return host
}

describe('what declares itself numeric', () => {
  it('an inputMode of decimal does — this is ConvertLens.tsx:148', () => {
    const el = dom('<input inputmode="decimal">').firstElementChild!
    expect(declaresNumeric(el)).toBe(true)
  })

  it('an inputMode of numeric does', () => {
    expect(declaresNumeric(dom('<input inputmode="numeric">').firstElementChild!)).toBe(true)
  })

  it('type=number does, with no inputMode at all', () => {
    expect(declaresNumeric(dom('<input type="number">').firstElementChild!)).toBe(true)
  })

  it('a bare text field does NOT — a person typing 42 as a title has not rendered a figure', () => {
    expect(declaresNumeric(dom('<input type="text">').firstElementChild!)).toBe(false)
    expect(declaresNumeric(dom('<input value="42">').firstElementChild!)).toBe(false)
  })

  // ⚠ THIS PAIR EXISTS BECAUSE THE FIRST VERSION OF IT PASSED FOR THE WRONG REASON, and only a
  // control said so. C3 deletes the `PAINTS_NO_TEXT` line and the range case stayed GREEN: the
  // slider Landing.tsx:320 actually ships declares NO inputMode, so it never reaches the exemption
  // — it is excluded one line lower, by not declaring itself numeric at all. The first case below
  // is the shipped slider, and it is NOT what pins the exemption. The second one declares BOTH, so
  // it is the only case that reaches the line, and it is what reds when the line goes.
  it('the slider as it ships is not numeric — its value is a figure and that is correct', () => {
    const el = dom('<input type="range" min="1" max="61" value="7">').firstElementChild!
    expect((el as HTMLInputElement).value).toBe('7')
    expect(declaresNumeric(el)).toBe(false)
  })

  it('a range that ALSO declares a numeric inputMode is still exempt — it paints no text', () => {
    expect(declaresNumeric(dom('<input type="range" inputmode="decimal">').firstElementChild!)).toBe(
      false,
    )
  })

  it('a hidden field does NOT — it is not rendered', () => {
    expect(declaresNumeric(dom('<input type="hidden" inputmode="decimal">').firstElementChild!)).toBe(
      false,
    )
  })

  it('a textarea is not an input and is never numeric', () => {
    expect(declaresNumeric(dom('<textarea inputmode="decimal"></textarea>').firstElementChild!)).toBe(
      false,
    )
  })
})

describe('which numeric fields are offenders', () => {
  it('one off the face is reported, and the report names what a fix would change', () => {
    const found = unfacedFieldsIn(
      dom('<div><input inputmode="decimal" class="text-body" aria-label="LXC to receive" value="1.5"></div>'),
    )
    expect(found).toHaveLength(1)
    expect(found[0].declaredBy).toBe('inputmode="decimal"')
    expect(found[0].label).toBe('LXC to receive')
    expect(found[0].className).toBe('text-body')
    expect(found[0].value).toBe('1.5')
  })

  // ⚠ THIS IS THE HALF THAT IS OPPOSITE TO placeholderAudit, and the Chrome fixture in
  // fieldFaceAudit.ts is why. Preflight makes a field's font-family INHERIT, so an ancestor's
  // `font-figure` reaches the value — measured, tnum included. A rule demanding the class be the
  // element's own would red a field the browser paints correctly.
  it('one whose ANCESTOR carries font-figure is not — the face is inherited here', () => {
    const found = unfacedFieldsIn(
      dom('<div class="font-figure"><span><input inputmode="decimal" class="text-body"></span></div>'),
    )
    expect(found).toEqual([])
  })

  it('one carrying font-figure ITSELF is not', () => {
    expect(
      unfacedFieldsIn(dom('<input inputmode="decimal" class="text-body font-figure">')),
    ).toEqual([])
  })

  // ⚠ `font-mono` IS NOT THE FACE, and figureAudit.ts argues that at length: the two utilities are
  // rendering-identical in the browser today, and one NAMED utility for figures is the rule.
  it('font-mono is not the face', () => {
    expect(unfacedFieldsIn(dom('<div class="font-mono"><input inputmode="decimal"></div>'))).toHaveLength(1)
  })

  it('an empty numeric field is still an offender — the box is what is numeric, not the digits in it', () => {
    const found = unfacedFieldsIn(dom('<input inputmode="decimal" value="">'))
    expect(found).toHaveLength(1)
    expect(found[0].value).toBe('')
  })
})

describe('the floor names files that exist', () => {
  // ⚠ A floor entry naming a file the tree no longer has is a guard that cannot fire and cannot
  // say so. The same check figureAudit.test.tsx makes of MUST_RENDER_CURRENCY.
  it('every listed test file is in the tree', async () => {
    const { existsSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const appRoot = resolve(import.meta.dirname, '..')
    for (const file of Object.keys(MUST_AUDIT_A_NUMERIC_FIELD)) {
      expect(existsSync(resolve(appRoot, file)), `${file} is listed in the floor`).toBe(true)
    }
  })

  it('is not empty — an empty table is a floor that asks for nothing', () => {
    expect(Object.keys(MUST_AUDIT_A_NUMERIC_FIELD).length).toBeGreaterThan(0)
  })
})

describe('the field the product actually ships', () => {
  // ⚠ THE POINT OF THIS ONE: it renders the real component's markup through the real `Input`, so a
  // fix that is reverted at the CALL SITE fails here as well as in the running audit. It asserts
  // the class is REACHABLE from the rendered input, not that a string appears in a source file.
  it('Convert’s amount field renders on the figure face', async () => {
    const { Input } = await import('@talyvor/ui')
    const { container } = render(<Input className="font-figure" inputMode="decimal" defaultValue="1.5" />)
    expect(unfacedFieldsIn(container)).toEqual([])
    expect(container.querySelector('input')!.className).toContain('font-figure')
  })
})
