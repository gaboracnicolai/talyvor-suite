import { describe, expect, it } from 'vitest'
import { COMPANY_LINE, type Look, type ReportLook, brandFaults, companyFaults, docsBrandFaults, exportBrandFaults, heroFadeFaults, readingFaults, roiBrandFaults } from '../src/brand.ts'

const brand: Look = {
  scroll: 390, client: 390, logos: ['svg mark', 'svg wordmark'], tiles: [], amberCount: 0, amber: [], inter: [],
  canvas: 'rgb(244, 247, 251)', brightCount: 0, bright: [],
}

describe("the brand-visual oracle (B29.21)", () => {
  it('passes a view in the brand', () => {
    expect(brandFaults(brand)).toEqual([])
  })

  it('names sideways scroll, a missing SVG logo, the CSS tile, #f0a030 and Inter', () => {
    expect(brandFaults({
      scroll: 412, client: 390, logos: [], tiles: ['span.inline-flex.shrink-0'],
      amberCount: 7, amber: ['button.bg-amber color'], inter: ['Inter, sans-serif (body)'],
      canvas: 'rgb(6, 10, 18)', brightCount: 0, bright: [],
    })).toEqual([
      'scrolls sideways (412 > 390)',
      'no drawn SVG logo on screen',
      'the old CSS tile (span.inline-flex.shrink-0)',
      '#f0a030 on 7 element(s): button.bg-amber color',
      'a font stack with Inter: Inter, sans-serif (body)',
    ])
  })
})

describe('the light pass (B29.15)', () => {
  it('passes a light view on #F4F7FB with no bright Teal outside the logo', () => {
    expect(brandFaults(brand, 'light')).toEqual([])
  })

  it('names a light view on another canvas, or with bright Teal as text or a fill', () => {
    expect(brandFaults({ ...brand, canvas: 'rgb(243, 246, 250)', brightCount: 2, bright: ['a.link color', 'button.primary background-color'] }, 'light')).toEqual([
      'a light canvas other than #F4F7FB (rgb(243, 246, 250))',
      'bright Teal #3AD6C0 in the light theme on 2 element(s): a.link color, button.primary background-color',
    ])
  })

  it('holds the dark theme to neither', () => {
    expect(brandFaults({ ...brand, canvas: 'rgb(6, 10, 18)', brightCount: 3, bright: ['a.link color'] }, 'dark')).toEqual([])
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

describe('the Docs HTML export oracle (B29.31)', () => {
  const html = '<!DOCTYPE html><html><body><h1>Brand check k1</h1><p>The page.</p></body></html>'

  it('passes the page exported in the brand', () => {
    expect(exportBrandFaults(brand, 'Brand check k1', html)).toEqual([])
  })

  it('names another file, #f0a030 and Inter', () => {
    expect(exportBrandFaults({ ...brand, amberCount: 1, amber: ['a color'], inter: ['Inter, sans-serif (body)'] }, 'Brand check k2', html)).toEqual([
      'not the page: no heading "Brand check k2"',
      '#f0a030 on 1 element(s): a color',
      'a font stack with Inter: Inter, sans-serif (body)',
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

describe('the hero-fade oracle (B36.1)', () => {
  // Measured on /marketing at 1440×900 in the light theme, 7 Oct 2026: before the mask, and after it.
  it('passes a photo that melts into the page, and names each edge still drawn as a line', () => {
    expect(heroFadeFaults([
      { edge: '1440 light left edge against the page', gaps: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
      { edge: '1440 light bottom against the page', gaps: [0, 1, 2, 3, 3, 3, 3, 3, 3, 3] },
    ])).toEqual([])
    expect(heroFadeFaults([
      { edge: '1440 light left edge against the page', gaps: [238, 238, 238] },
      { edge: '1440 light bottom against the page', gaps: [3, 9] },
      { edge: '390 light top row against the page', gaps: [] },
    ])).toEqual([
      '1440 light left edge against the page: a hard edge (238 238 238 apart, over 8)',
      '1440 light bottom against the page: a hard edge (3 9 apart, over 8)',
      '390 light top row against the page: nothing sampled',
    ])
  })
})

describe('the company-line oracle (B32.2)', () => {
  const terms = 'These terms are between you and TALYVOR LTD, a company registered in England and Wales (number 17299143) ' +
    'whose registered office is 71-75 Shelton Street, Covent Garden, London, United Kingdom, WC2H 9JQ. Contact: nicolai@talyvor.com.'

  it('passes a page that names the company, and Terms opening with who it is between', () => {
    expect(companyFaults('/pricing', `Pricing … ${COMPANY_LINE}`, '')).toEqual([])
    expect(companyFaults('/terms', `Terms ${terms} … ${COMPANY_LINE}`, terms)).toEqual([])
  })

  it('names a missing line and a legal page that opens with something else', () => {
    expect(companyFaults('/terms', 'Terms', 'This is a trial.')).toEqual([
      'no company line',
      'opens with "This is a trial.", not who runs Talyvor',
    ])
  })
})

describe('the reading-pages oracle (B29.13)', () => {
  const page = { headerLogo: true, eyebrow: 'Talyvor', rule: true, measure: 66, footer: true }

  it('passes a reading page in the brand, and a phone view whatever its measure', () => {
    expect(readingFaults(page, true)).toEqual([])
    expect(readingFaults({ ...page, measure: 42 }, false)).toEqual([])
  })

  it('names a missing header logo, eyebrow, rule and footer, and lines far from 65 on a desktop', () => {
    expect(readingFaults({ headerLogo: false, eyebrow: '', rule: false, measure: 89, footer: false }, true)).toEqual([
      'no drawn logo in the header',
      'no eyebrow over the title',
      'no teal rule under the title',
      'lines of 89 characters, not near 65',
      'no footer with the mark and the company line',
    ])
  })
})
