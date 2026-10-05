// B29.21 — the brand as the browser paints it, every night. /marketing, /pricing and /signin as a
// signed-out stranger sees them, and / signed in, each at 1440×900 and 390×844 in the dark theme and
// the light one: sixteen views, each photographed into the day's report. A view fails on sideways
// scroll, no drawn SVG logo on screen, the old CSS tile, any computed colour #f0a030 (the retired
// amber), or a font stack that names Inter.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { CannotTest, type Scenario } from './scenarios.ts'

const VIEWPORTS = [[1440, 900], [390, 844]] as const
const THEMES = ['dark', 'light'] as const
const PUBLIC = ['/marketing', '/pricing', '/signin'] as const
const HEADING_TIMEOUT_MS = 20_000
const SETTLE_TIMEOUT_MS = 10_000

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
