import { describe, expect, it } from 'vitest'
import { type Look, brandFaults, docsBrandFaults } from '../src/brand.ts'

const brand: Look = { scroll: 390, client: 390, logos: ['svg mark', 'svg wordmark'], tiles: [], amberCount: 0, amber: [], inter: [] }

describe("the brand-visual oracle (B29.21)", () => {
  it('passes a view in the brand', () => {
    expect(brandFaults(brand)).toEqual([])
  })

  it('names sideways scroll, a missing SVG logo, the CSS tile, #f0a030 and Inter', () => {
    expect(brandFaults({
      scroll: 412, client: 390, logos: [], tiles: ['span.inline-flex.shrink-0'],
      amberCount: 7, amber: ['button.bg-amber color'], inter: ['Inter, sans-serif (body)'],
    })).toEqual([
      'scrolls sideways (412 > 390)',
      'no drawn SVG logo on screen',
      'the old CSS tile (span.inline-flex.shrink-0)',
      '#f0a030 on 7 element(s): button.bg-amber color',
      'a font stack with Inter: Inter, sans-serif (body)',
    ])
  })
})

describe('the brand-docs oracle (B29.28)', () => {
  it('passes a Docs page in the brand', () => {
    expect(docsBrandFaults(brand, ['svg mark', 'svg wordmark'])).toEqual([])
  })

  it('names no logo in the sidebar, #f0a030 and Inter', () => {
    expect(docsBrandFaults({ ...brand, amberCount: 2, amber: ['a.link color'], inter: ['Inter, sans-serif (main)'] }, [])).toEqual([
      'no logo in the sidebar',
      '#f0a030 on 2 element(s): a.link color',
      'a font stack with Inter: Inter, sans-serif (main)',
    ])
  })
})
