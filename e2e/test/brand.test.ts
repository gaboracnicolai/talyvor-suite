import { describe, expect, it } from 'vitest'
import { type Look, type ReportLook, brandFaults, docsBrandFaults, roiBrandFaults } from '../src/brand.ts'

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

describe('the brand-roi oracle (B29.29)', () => {
  const report: ReportLook = { scroll: 390, client: 390, marks: ['tv-mark span.tv-mark-dark'], retiredCount: 0, retired: [], inter: [], canvas: 'rgb(6, 10, 18)' }

  it('passes the report in the brand on screen, and on paper with a light canvas', () => {
    expect(roiBrandFaults(report, false, [])).toEqual([])
    expect(roiBrandFaults({ ...report, canvas: 'rgb(246, 247, 249)' }, true, [])).toEqual([])
  })

  it('names sideways scroll, no mark, the old navy or amber, Inter, another host and a dark canvas on paper', () => {
    expect(roiBrandFaults({
      scroll: 420, client: 390, marks: [], retiredCount: 3, retired: ['h1 color #1a1a2e'], inter: ['Inter, sans-serif (h1)'], canvas: 'rgb(26, 26, 46)',
    }, true, ['http://fonts.invalid/inter.css'])).toEqual([
      'scrolls sideways (420 > 390)',
      'no inline mark (tv-mark) on screen',
      '#1a1a2e or #f0a030 on 3 element(s): h1 color #1a1a2e',
      'a font stack with Inter: Inter, sans-serif (h1)',
      'a dark canvas on paper (rgb(26, 26, 46))',
      '1 request(s) to another host: http://fonts.invalid/inter.css',
    ])
  })
})
