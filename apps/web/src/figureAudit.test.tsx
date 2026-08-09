import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  MUST_RENDER_CURRENCY,
  auditedFigures,
  currencyFiguresIn,
  isFigureOnly,
  onFigureFace,
  ownText,
} from './figureAudit'

/**
 * The controls for the rendered-figure audit. The audit itself runs from test-setup.ts on every
 * test in this app; this file proves it can FAIL, proves it reads what it claims to read, and
 * pins the three traps that each, on their own, would have made it green over a real defect.
 *
 * ⚠ THE OFF-FACE FIXTURES ARE BUILT DETACHED, never attached to `document`. The audit is
 * watching `document` for the whole run — attaching a deliberate offender here would trip the
 * afterEach in test-setup.ts and fail this file for doing its job.
 */

function frag(html: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = html
  return el
}

describe('what counts as a figure', () => {
  it('a currency figure in the sans is an offender', () => {
    const found = currencyFiguresIn(frag('<span class="text-body text-muted">$12.35</span>'))
    expect(found).toHaveLength(1)
    expect(found[0].onFace).toBe(false)
  })

  it('the same figure on the face is not', () => {
    const found = currencyFiguresIn(frag('<span class="font-figure text-body">$12.35</span>'))
    expect(found).toHaveLength(1)
    expect(found[0].onFace).toBe(true)
  })

  it('the face is inherited — an ancestor carrying it is enough', () => {
    const found = currencyFiguresIn(frag('<div class="font-figure"><span class="text-body">$12.35</span></div>'))
    expect(found).toHaveLength(1)
    expect(found[0].onFace).toBe(true)
  })

  it('font-mono is NOT the figure face — same family, no tnum, so money would not align', () => {
    expect(onFigureFace(frag('<span class="font-mono">$1</span>').firstElementChild)).toBe(false)
  })

  it('a `$` with no digits is not a figure — a shell snippet is not money', () => {
    expect(isFigureOnly('export KEY=$LENS_TOKEN')).toBe(false)
    expect(currencyFiguresIn(frag('<code class="font-mono">$ curl -H "x: $KEY"</code>'))).toEqual([])
  })
})

describe('TRAP TWO — a sentence that mentions a price is prose, and prose is set in the sans', () => {
  // The exact refusal Lens returns and TopUp surfaces verbatim (TopUp.test.tsx drives it) — and
  // the ONLY sans-rendered currency text left in the product at `7e2e9fc`. Copied, not
  // paraphrased: an em dash in it, not its letters, is what excluded it from an earlier version
  // of the control below, which made that control weaker than it read.
  const sentence =
    'this app offers $10, $50, $100, but Lens refused that amount — the two are running ' +
    'different top-up allow-lists. Nothing was charged.'

  it('does not police a sentence', () => {
    expect(isFigureOnly(sentence)).toBe(false)
    expect(currencyFiguresIn(frag(`<p class="text-body text-muted">${sentence}</p>`))).toEqual([])
  })

  it('but a figure carrying only its ≈ decoration IS policed', () => {
    expect(isFigureOnly('≈ $12.35')).toBe(true)
    expect(isFigureOnly('$0.0004')).toBe(true)
    expect(isFigureOnly('$1,250.00')).toBe(true)
  })

  it('the carve-out is narrow enough to still be a guard — one letter is not a licence', () => {
    // If prose were matched loosely, "Total $12.35" would escape and every offender could be
    // relabelled into compliance.
    expect(isFigureOnly('Total $12.35')).toBe(false)
  })
})

describe('TRAP ONE — React splits `≈ ${x}` into two text nodes', () => {
  /** The DOM React actually builds for `<span>≈ ${x}</span>`: two text children, not one. */
  function twoTextNodes(): HTMLElement {
    const host = document.createElement('div')
    const span = document.createElement('span')
    span.className = 'text-body text-muted'
    span.appendChild(document.createTextNode('≈ $'))
    span.appendChild(document.createTextNode('12.35'))
    host.appendChild(span)
    return host
  }

  it('reads the element own-text, so the split figure is still found', () => {
    expect(ownText(twoTextNodes().firstElementChild!)).toBe('≈ $12.35')
    const found = currencyFiguresIn(twoTextNodes())
    expect(found).toHaveLength(1)
    expect(found[0].onFace).toBe(false)
  })

  it('and a per-TEXT-NODE scan finds nothing — the version of this audit that passed clean', () => {
    // Not a hypothetical: keyed per text node, the first run of this audit reported the whole
    // product clean while Overview and Spend rendered "≈ $12.35" in the sans.
    const nodes = Array.from(twoTextNodes().firstElementChild!.childNodes).map((n) => n.nodeValue ?? '')
    expect(nodes).toEqual(['≈ $', '12.35'])
    expect(nodes.some((t) => /\$\s*\d/.test(t))).toBe(false)
  })
})

describe('TRAP THREE — the audit must not read the DOM in afterEach', () => {
  // Testing Library's cleanup is registered when the TEST FILE imports it, after test-setup.ts,
  // and vitest runs afterEach hooks last-registered-first. So by the time a setup-file afterEach
  // runs, `document.body` is EMPTY. An audit that scanned there would find nothing on every
  // surface in the product. These two tests, in this order, prove the observer captured a real
  // Testing Library render that afterEach could no longer have seen.
  it('renders a figure through the real render path', () => {
    render(<span className="font-figure text-body">$3.50</span>)
    expect(document.body.textContent).toContain('$3.50')
  })

  it('the previous render survived cleanup as a record', () => {
    // cleanup has run: the figure is gone from the DOM …
    expect(currencyFiguresIn(document.body)).toEqual([])
    // … and the audit still holds it.
    expect(auditedFigures().some((f) => f.text === '$3.50' && f.onFace)).toBe(true)
  })
})

describe('the audit cannot pass by rendering nothing', () => {
  it('every file in MUST_RENDER_CURRENCY exists, with a reason', () => {
    const appRoot = resolve(import.meta.dirname, '..')
    const missing = Object.keys(MUST_RENDER_CURRENCY).filter((f) => !existsSync(resolve(appRoot, f)))
    expect(missing, `listed but not in the tree: ${missing.join(', ')}`).toEqual([])
    expect(Object.values(MUST_RENDER_CURRENCY).every((r) => r.length > 10)).toBe(true)
    expect(Object.keys(MUST_RENDER_CURRENCY).length).toBeGreaterThanOrEqual(8)
  })

  it('this file is not one of them — it renders one figure of its own', () => {
    // Kept honest deliberately: the floor is about the SURFACES, not about this file's fixture.
    expect(MUST_RENDER_CURRENCY['src/figureAudit.test.tsx']).toBeUndefined()
  })
})
