// B29.21 — the brand as the browser paints it, every night. /marketing, /pricing and /signin as a
// signed-out stranger sees them, and / signed in, each at 1440×900 and 390×844 in the dark theme and
// the light one: sixteen views, each photographed into the day's report. A view fails on sideways
// scroll, no drawn SVG logo on screen, the old CSS tile, any computed colour #f0a030 (the retired
// amber), or a font stack that names Inter.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { CannotTest, type Scenario } from './scenarios.ts'
import { DocsPage } from './screens.ts'

const VIEWPORTS = [[1440, 900], [390, 844]] as const
const THEMES = ['dark', 'light'] as const
const PUBLIC = ['/marketing', '/pricing', '/signin'] as const
const HEADING_TIMEOUT_MS = 20_000
const SETTLE_TIMEOUT_MS = 10_000
/** B29.29 — A4 at 96 dpi: the paper a person prints the ROI report on. */
const PAPER = [794, 1123] as const
/** Mid grey (L* 50) as relative luminance: a canvas darker than this is a dark one. */
const DARK = 0.18

/** What one view looked like, as the browser computed it. */
export interface Look {
  /** The page's scroll width and the viewport's: wider than the viewport scrolls sideways. */
  scroll: number
  client: number
  /** Each drawn SVG logo on screen: an inline mark or wordmark, or a logo file ending .svg that loaded. */
  logos: string[]
  /** Each element still drawing the old CSS tile: a non-SVG element posing as the Talyvor image. */
  tiles: string[]
  /** How many elements compute a colour #f0a030, and the first few of them. */
  amberCount: number
  amber: string[]
  /** Each distinct font stack that names Inter, with the first element set in it. */
  inter: string[]
}

/** The oracle: what is wrong with a view, in words; nothing when it is the brand. */
export function brandFaults(l: Look): string[] {
  const faults: string[] = []
  if (l.scroll > l.client) faults.push(`scrolls sideways (${l.scroll} > ${l.client})`)
  if (l.logos.length === 0) faults.push('no drawn SVG logo on screen')
  if (l.tiles.length > 0) faults.push(`the old CSS tile (${l.tiles.join(', ')})`)
  if (l.amberCount > 0) faults.push(`#f0a030 on ${l.amberCount} element(s): ${l.amber.join(', ')}`)
  if (l.inter.length > 0) faults.push(`a font stack with Inter: ${l.inter.join(' | ')}`)
  return faults
}

/** Reads a view in the page. Self-contained: Playwright sends it to the browser as source. */
function lookInPage(): Look {
  const AMBER = /rgba?\(240, 160, 48[,)]/
  const PROPS = ['color', 'background-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'outline-color', 'text-decoration-color', 'fill', 'stroke', 'background-image', 'box-shadow']
  const name = (el: Element): string => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : []
    return el.tagName.toLowerCase() + (el.id !== '' ? `#${el.id}` : '') + cls.map((c) => `.${c}`).join('')
  }
  const onScreen = (el: Element): boolean => {
    const r = el.getBoundingClientRect()
    return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' &&
      r.width > 0 && r.height > 0 && r.right > 0 && r.left < window.innerWidth
  }
  const isInter = (stack: string): boolean =>
    stack.split(',').some((f) => /^inter($|[\s-]|var|variable|display)/i.test(f.trim().replace(/^["']|["']$/g, '')))

  let amberCount = 0
  const amber: string[] = []
  const stacks = new Set<string>()
  const inter: string[] = []
  for (const el of Array.from(document.querySelectorAll('*'))) {
    for (const pseudo of [null, '::before', '::after']) {
      const cs = getComputedStyle(el, pseudo)
      if (pseudo !== null && (cs.content === 'none' || cs.content === 'normal')) continue
      const hit = PROPS.find((p) => AMBER.test(cs.getPropertyValue(p)))
      if (hit !== undefined) {
        amberCount++
        if (amber.length < 5) amber.push(`${name(el)}${pseudo ?? ''} ${hit}`)
      }
      if (!stacks.has(cs.fontFamily)) {
        stacks.add(cs.fontFamily)
        if (isInter(cs.fontFamily)) inter.push(`${cs.fontFamily} (${name(el)}${pseudo ?? ''})`)
      }
    }
  }
  const drawn = Array.from(document.querySelectorAll('svg[data-brand="mark"], svg[data-brand="wordmark"]'))
    .filter(onScreen).map((s) => `svg ${s.getAttribute('data-brand')}`)
  const files = Array.from(document.querySelectorAll<HTMLImageElement>('img[data-brand="logo"]'))
    .filter((i) => onScreen(i) && i.naturalWidth > 0 && new URL(i.currentSrc || i.src).pathname.endsWith('.svg'))
    .map((i) => new URL(i.currentSrc || i.src).pathname)
  return {
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
    logos: [...drawn, ...files],
    tiles: Array.from(document.querySelectorAll('[role="img"][aria-label="Talyvor"]:not(svg)')).map(name),
    amberCount,
    amber,
    inter,
  }
}

/** Opens `path` in `page` as a person does, waits for it to settle, and reads it. */
async function view(page: Page, url: string, theme: 'dark' | 'light'): Promise<{ look: Look; note: string }> {
  await page.goto(url)
  await page.getByRole('heading').first().waitFor({ state: 'visible', timeout: HEADING_TIMEOUT_MS }).catch(() => undefined)
  await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => undefined)
  // A theme the person stored wins over the one the browser prefers; the view is of the theme asked for.
  const stored = await page.evaluate((t) => {
    const was = document.documentElement.dataset.theme ?? ''
    if (was !== t) document.documentElement.dataset.theme = t
    return was
  }, theme)
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(Array.from(document.images).filter((i) => !i.complete && i.loading !== 'lazy')
      .map((i) => new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }) })))
  })
  return { look: await page.evaluate(lookInPage), note: stored !== theme ? ` (the page opened ${stored || 'unthemed'}; set to ${theme})` : '' }
}

export function brandVisual(): Scenario {
  return {
    id: 'brand-visual',
    title: 'the public pages and Home, at 1440 and 390 in both themes: photographed, no sideways scroll, the SVG logo, no CSS tile, no #f0a030, no Inter',
    run: async (ctx) => {
      const browser = ctx.app.context.browser()
      if (browser === null) throw new CannotTest('no browser to open a signed-out context in')
      const origin = new URL(ctx.app.page.url()).origin
      const { dir, link } = ctx.env.shots
      await mkdir(dir, { recursive: true })
      const wrong: string[] = []
      const where = new Set<string>()
      for (const theme of THEMES) {
        // Signed out, a new browser that prefers this theme: what a stranger sees. Signed in, this user's own tab.
        const stranger = await browser.newContext({ colorScheme: theme })
        try {
          for (const path of [...PUBLIC, '/']) {
            const page = await (path === '/' ? ctx.app.context : stranger).newPage()
            try {
              await page.emulateMedia({ colorScheme: theme })
              for (const [width, height] of VIEWPORTS) {
                await page.setViewportSize({ width, height })
                const { look, note } = await view(page, origin + path, theme)
                const file = `${path === '/' ? 'home' : path.slice(1)}-${width}-${theme}.jpg`
                // The first screen, as a person sees it at this size; the checks above read the whole page.
                await page.screenshot({ path: join(dir, file), type: 'jpeg', quality: 80 })
                const faults = brandFaults(look)
                ctx.evidence.push({
                  note: `${path} ${width}×${height} ${theme}${note}: ${faults.length === 0 ? 'the brand' : faults.join('; ')} — ` +
                    `logo ${look.logos.join(', ') || 'none'}; scroll ${look.scroll}/${look.client}`,
                  shot: `${link}/${file}`,
                })
                if (faults.length > 0) {
                  wrong.push(`${path} ${width} ${theme}: ${faults.join('; ')}`)
                  where.add(path)
                }
              }
            } finally {
              await page.close()
            }
          }
        } finally {
          await stranger.close()
        }
      }
      return wrong.length === 0
        ? { pass: true, detail: '16 views photographed: no sideways scroll, a drawn SVG logo on screen, no CSS tile, no #f0a030 and no Inter in any' }
        : { pass: false, detail: wrong.join(' | '), where: [...where] }
    },
  }
}

/** B29.28 — the oracle for a Docs page: what is off-brand about it, in words; nothing when it is the brand. */
export function docsBrandFaults(l: Look, sidebar: string[]): string[] {
  const faults: string[] = []
  if (sidebar.length === 0) faults.push('no logo in the sidebar')
  if (l.amberCount > 0) faults.push(`#f0a030 on ${l.amberCount} element(s): ${l.amber.join(', ')}`)
  if (l.inter.length > 0) faults.push(`a font stack with Inter: ${l.inter.join(' | ')}`)
  return faults
}

/** Each logo in the sidebar on screen: a drawn mark or wordmark, or a logo image that loaded. Self-contained. */
function sidebarLogosInPage(): string[] {
  const onScreen = (el: Element): boolean => {
    const r = el.getBoundingClientRect()
    return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' &&
      r.width > 0 && r.height > 0 && r.right > 0 && r.left < window.innerWidth
  }
  const found: string[] = []
  for (const side of Array.from(document.querySelectorAll('aside'))) {
    for (const s of Array.from(side.querySelectorAll('svg[data-brand="mark"], svg[data-brand="wordmark"]'))) {
      if (onScreen(s)) found.push(`svg ${s.getAttribute('data-brand')}`)
    }
    for (const i of Array.from(side.querySelectorAll<HTMLImageElement>('img'))) {
      const path = new URL(i.currentSrc || i.src, location.href).pathname
      if ((i.dataset.brand === 'logo' || /logo/i.test(path)) && i.naturalWidth > 0 && onScreen(i)) found.push(path)
    }
  }
  return found
}

/**
 * B29.28 — the Docs app in the brand: a page this user writes in Docs, at 1440×900 and 390×844 in the dark
 * theme and the light one, each photographed into the day's report. Where the sidebar is a drawer (390), the
 * Menu opens it and the open drawer is photographed too. A view fails on no logo in the sidebar, any computed
 * colour #f0a030, or a font stack that names Inter.
 */
export function brandDocs(): Scenario {
  return {
    id: 'brand-docs',
    title: 'a Docs page, at 1440 and 390 in both themes: photographed, the logo in the sidebar, no #f0a030, no Inter',
    run: async (ctx) => {
      const stamp = Date.now().toString(36)
      const doc = await DocsPage.write(ctx.app, `Brand check ${stamp}`, `Brand check ${stamp}`,
        'The nightly brand check reads this page at 1440 and 390, in the dark theme and the light one.')
      const page = doc.page
      const url = page.url()
      const { dir, link } = ctx.env.shots
      await mkdir(dir, { recursive: true })
      const wrong: string[] = []
      try {
        for (const theme of THEMES) {
          await page.emulateMedia({ colorScheme: theme })
          for (const [width, height] of VIEWPORTS) {
            await page.setViewportSize({ width, height })
            const { look, note } = await view(page, url, theme)
            const file = `docs-page-${width}-${theme}.jpg`
            await page.screenshot({ path: join(dir, file), type: 'jpeg', quality: 80 })
            const shots = [file]
            let sidebar = await page.evaluate(sidebarLogosInPage)
            const menu = page.getByRole('button', { name: 'Menu', exact: true })
            if (sidebar.length === 0 && await menu.isVisible()) {
              await menu.click()
              await page.locator('aside').first().waitFor({ state: 'visible', timeout: SETTLE_TIMEOUT_MS }).catch(() => undefined)
              sidebar = await page.evaluate(sidebarLogosInPage)
              const open = `docs-page-${width}-${theme}-menu.jpg`
              await page.screenshot({ path: join(dir, open), type: 'jpeg', quality: 80 })
              shots.push(open)
              await page.keyboard.press('Escape')
            }
            const faults = docsBrandFaults(look, sidebar)
            for (const [n, f] of shots.entries()) {
              ctx.evidence.push({
                note: `Docs page ${width}×${height} ${theme}${n > 0 ? ', Menu open' : ''}${note}: ` +
                  `${faults.length === 0 ? 'the brand' : faults.join('; ')} — sidebar logo ${sidebar.join(', ') || 'none'}`,
                shot: `${link}/${f}`,
              })
            }
            if (faults.length > 0) wrong.push(`Docs page ${width} ${theme}: ${faults.join('; ')}`)
          }
        }
      } finally {
        await page.close()
      }
      return wrong.length === 0
        ? { pass: true, detail: 'a Docs page at 1440 and 390 in both themes, photographed: a logo in the sidebar, no #f0a030 and no Inter in any' }
        : { pass: false, detail: wrong.join(' | '), where: ['/docs'] }
    },
  }
}

/** B29.29 — what one view of the ROI report looked like, as the browser computed it. */
export interface ReportLook {
  scroll: number
  client: number
  /** Each inline mark (class tv-mark) on screen, by the variant whose drawn SVG shows. */
  marks: string[]
  /** How many elements compute a retired colour, #1a1a2e or #f0a030, and the first few of them. */
  retiredCount: number
  retired: string[]
  /** Each distinct font stack that names Inter, with the first element set in it. */
  inter: string[]
  /** The canvas: the body's computed background, or the root's when the body's is transparent. */
  canvas: string
}

/** The relative luminance of a computed rgb() or rgba() colour, 0 (black) to 1 (white); undefined for none or a transparent one. */
export function luminance(css: string): number | undefined {
  const m = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(css.trim())
  if (m === null || m[4] === '0') return undefined
  const [r, g, b] = [m[1], m[2], m[3]].map((v) => {
    const c = Number(v) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * B29.29 — the oracle for the ROI report: what is off-brand about one view, in words; nothing when it is the
 * brand. `paper` is the view under print media; `elsewhere` the requests it made to a host other than Lens's.
 */
export function roiBrandFaults(l: ReportLook, paper: boolean, elsewhere: string[]): string[] {
  const faults: string[] = []
  if (l.scroll > l.client) faults.push(`scrolls sideways (${l.scroll} > ${l.client})`)
  if (l.marks.length === 0) faults.push('no inline mark (tv-mark) on screen')
  if (l.retiredCount > 0) faults.push(`#1a1a2e or #f0a030 on ${l.retiredCount} element(s): ${l.retired.join(', ')}`)
  if (l.inter.length > 0) faults.push(`a font stack with Inter: ${l.inter.join(' | ')}`)
  if (paper && (luminance(l.canvas) ?? 1) < DARK) faults.push(`a dark canvas on paper (${l.canvas})`)
  if (elsewhere.length > 0) {
    faults.push(`${elsewhere.length} request(s) to another host: ${elsewhere.slice(0, 3).join(', ')}`)
  }
  return faults
}

/** Reads a view of the ROI report in the page. Self-contained: Playwright sends it to the browser as source. */
function reportLookInPage(): ReportLook {
  const RETIRED: Array<[RegExp, string]> = [[/rgba?\(26, 26, 46[,)]/, '#1a1a2e'], [/rgba?\(240, 160, 48[,)]/, '#f0a030']]
  const PROPS = ['color', 'background-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'outline-color', 'text-decoration-color', 'fill', 'stroke', 'background-image', 'box-shadow']
  const name = (el: Element): string => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : []
    return el.tagName.toLowerCase() + (el.id !== '' ? `#${el.id}` : '') + cls.map((c) => `.${c}`).join('')
  }
  const onScreen = (el: Element): boolean => {
    const r = el.getBoundingClientRect()
    return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' &&
      r.width > 0 && r.height > 0 && r.right > 0 && r.left < window.innerWidth
  }
  const isInter = (stack: string): boolean =>
    stack.split(',').some((f) => /^inter($|[\s-]|var|variable|display)/i.test(f.trim().replace(/^["']|["']$/g, '')))

  let retiredCount = 0
  const retired: string[] = []
  const stacks = new Set<string>()
  const inter: string[] = []
  for (const el of Array.from(document.querySelectorAll('*'))) {
    for (const pseudo of [null, '::before', '::after']) {
      const cs = getComputedStyle(el, pseudo)
      if (pseudo !== null && (cs.content === 'none' || cs.content === 'normal')) continue
      for (const p of PROPS) {
        const hit = RETIRED.find(([re]) => re.test(cs.getPropertyValue(p)))
        if (hit === undefined) continue
        retiredCount++
        if (retired.length < 5) retired.push(`${name(el)}${pseudo ?? ''} ${p} ${hit[1]}`)
        break
      }
      if (!stacks.has(cs.fontFamily)) {
        stacks.add(cs.fontFamily)
        if (isInter(cs.fontFamily)) inter.push(`${cs.fontFamily} (${name(el)}${pseudo ?? ''})`)
      }
    }
  }
  const marks = Array.from(document.querySelectorAll('.tv-mark')).filter(onScreen)
    .flatMap((m) => Array.from(m.querySelectorAll('svg')).filter(onScreen).map((s) => s.parentElement === m ? 'tv-mark' : `tv-mark ${name(s.parentElement as Element)}`))
  const transparent = (c: string): boolean => c === 'transparent' || /^rgba\(.*,\s*0\)$/.test(c)
  const canvas = [document.body, document.documentElement].map((el) => getComputedStyle(el).backgroundColor).find((c) => !transparent(c)) ?? 'transparent'
  return {
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
    marks,
    retiredCount,
    retired,
    inter,
    canvas,
  }
}

/**
 * B29.29 — Lens's executive ROI report in the brand: the HTML Lens renders for this user's workspace, opened at
 * 1440×900 and 390×844 in the dark theme and the light one, and once as it prints (A4 wide, for a person who
 * prefers dark), each photographed into the day's report. A view fails on sideways scroll, no inline mark, any
 * computed colour #1a1a2e (the report's old navy) or #f0a030, a font stack that names Inter, a request to a host
 * other than Lens's, or — on paper — a dark canvas.
 */
export function brandROI(): Scenario {
  return {
    id: 'brand-roi',
    title: 'the ROI report, at 1440 and 390 in both themes and on paper: photographed, the inline mark, no #1a1a2e or #f0a030, no Inter, nothing from another host, light on paper',
    run: async (ctx) => {
      const browser = ctx.app.context.browser()
      if (browser === null) throw new CannotTest('no browser to open the ROI report in')
      const user = ctx.app.user
      const report = await ctx.env.lens.roiReportHTML(user)
      if (!report.ok) return { pass: false, detail: `Lens answered the ROI report ${report.status}: ${report.error}` }
      const url = `${ctx.env.lens.baseURL}/v1/workspaces/${user.workspaceID}/roi/report?format=html`
      const lens = new URL(url).host
      const { dir, link } = ctx.env.shots
      await mkdir(dir, { recursive: true })
      const views = [
        ...THEMES.flatMap((theme) => VIEWPORTS.map(([width, height]) => ({ theme, width, height, paper: false }))),
        { theme: 'dark' as const, width: PAPER[0], height: PAPER[1], paper: true },
      ]
      // A browser does not send the user's token, so the page is Lens's own answer, served at Lens's own address.
      const context = await browser.newContext()
      const wrong: string[] = []
      try {
        const page = await context.newPage()
        const elsewhere: string[] = []
        page.on('request', (r) => {
          const u = new URL(r.url())
          if (/^(https?|wss?):$/.test(u.protocol) && u.host !== lens) elsewhere.push(r.url())
        })
        await page.route((u) => u.href === url, (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: report.value }))
        for (const v of views) {
          await page.emulateMedia({ media: v.paper ? 'print' : 'screen', colorScheme: v.theme })
          await page.setViewportSize({ width: v.width, height: v.height })
          const asked = elsewhere.length
          await page.goto(url)
          await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => undefined)
          await page.evaluate(async () => { await document.fonts.ready })
          const look = await page.evaluate(reportLookInPage)
          const file = v.paper ? 'roi-report-print.jpg' : `roi-report-${v.width}-${v.theme}.jpg`
          // On paper, the whole report as it prints; on screen, the first screen as a person sees it at this size.
          await page.screenshot({ path: join(dir, file), type: 'jpeg', quality: 80, fullPage: v.paper })
          const faults = roiBrandFaults(look, v.paper, elsewhere.slice(asked))
          const label = v.paper ? `ROI report on paper (print, ${v.width} wide, preferring dark)` : `ROI report ${v.width}×${v.height} ${v.theme}`
          ctx.evidence.push({
            note: `${label}: ${faults.length === 0 ? 'the brand' : faults.join('; ')} — ` +
              `mark ${look.marks.join(', ') || 'none'}; canvas ${look.canvas}; scroll ${look.scroll}/${look.client}`,
            shot: `${link}/${file}`,
          })
          if (faults.length > 0) wrong.push(`${label}: ${faults.join('; ')}`)
        }
      } finally {
        await context.close()
      }
      return wrong.length === 0
        ? { pass: true, detail: 'the ROI report at 1440 and 390 in both themes and on paper, photographed: the inline mark, no sideways scroll, no #1a1a2e or #f0a030, no Inter, nothing from another host, and a light canvas on paper' }
        : { pass: false, detail: wrong.join(' | ') }
    },
  }
}
