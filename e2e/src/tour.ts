// B25.5 — two scenarios that take their list from the coverage map's inventory rather than from a
// hand list, so a screen or a Lens read added tomorrow is tested tomorrow:
//
//   every-screen  every screen a customer can open, opened as a person does: the console's own heading
//                 names it (a public page shows a heading), nothing says "Nothing at this address",
//                 and while it loads the browser sees no page error and the BFF answers no 5xx.
//   lens-reads    every read of the Lens API a customer's key can make (GET, no parameter but the
//                 workspace) answers within 15 s and never with a server error.
//
// Neither spends: no screen is submitted, and a read costs nothing.

import type { Page } from 'playwright'
import { type Entry, Matcher, cannotTest } from './coverage.ts'
import type { Scenario, ScenarioCtx } from './scenarios.ts'

const HEADING_TIMEOUT_MS = 20_000
const SETTLE_TIMEOUT_MS = 5_000
const READ_TIMEOUT_MS = 15_000

/** Where a screen with a parameter is opened from: the nearest screen above it (/track for /track/issues/:id). */
function parentOf(screen: Entry, screens: readonly Entry[]): Entry | undefined {
  return screens
    .filter((s) => s.path !== '/' && screen.path.startsWith(`${s.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0]
}

/**
 * Opens `path` and reads what a person would: the heading, the catch-all's sentence, page errors and
 * the BFF's 5xx while it loads. The problems found, and how long it took to settle.
 */
async function visit(ctx: ScenarioCtx, page: Page, origin: string, path: string, screen: Entry): Promise<{ problems: string[]; ms: number }> {
  const errors: string[] = []
  const failed: string[] = []
  const onError = (e: Error) => errors.push(e.message.slice(0, 160))
  const onResponse = (r: { status(): number; url(): string; request(): { method(): string } }) => {
    const url = new URL(r.url())
    if (r.status() >= 500 && url.origin === origin) failed.push(`${r.request().method()} ${url.pathname} answered ${r.status()}`)
  }
  page.on('pageerror', onError)
  page.on('response', onResponse)
  const t0 = Date.now()
  const problems: string[] = []
  try {
    await page.goto(origin + path)
    // A console screen's heading is its title; a public page names itself in its own heading.
    const heading = screen.public === true
      ? page.getByRole('heading').first()
      : page.getByRole('heading', { level: 1, name: screen.feature, exact: true })
    const shown = await heading.waitFor({ state: 'visible', timeout: HEADING_TIMEOUT_MS }).then(() => true, () => false)
    await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => undefined)
    if (!shown) {
      const said = (await page.getByRole('heading', { level: 1 }).first().innerText({ timeout: 1_000 }).catch(() => '')).trim()
      problems.push(screen.public === true ? 'no heading' : `no heading "${screen.feature}"${said !== '' ? ` (it says "${said}")` : ''}`)
    }
    if ((await page.getByText('Nothing at this address').count()) > 0) problems.push('it says "Nothing at this address"')
  } catch (e) {
    problems.push(`did not open: ${(e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 160)}`)
  } finally {
    page.off('pageerror', onError)
    page.off('response', onResponse)
  }
  const ms = Date.now() - t0
  ctx.app.screenTimed(path, problems.length === 0 ? 200 : 0, ms)
  return { problems: [...problems, ...errors.map((m) => `page error: ${m}`), ...failed], ms }
}

export function everyScreen(): Scenario {
  return {
    id: 'every-screen',
    title: 'every screen a customer can open shows its name, with no page error and no 5xx while it loads',
    run: async (ctx) => {
      const screens = ctx.env.inventory.screens
      const origin = new URL(ctx.app.page.url()).origin
      const page = await ctx.app.context.newPage()
      const opened = new Map<string, string>() // a screen's pattern → the address it was opened at
      const wrong: string[] = []
      const where: string[] = []
      let count = 0
      try {
        for (const s of screens) {
          const why = cannotTest(s)
          if (why !== undefined) {
            ctx.evidence.push({ note: `${s.path}: not opened — ${why}` })
            continue
          }
          let path = s.path
          if (s.path.includes(':')) {
            // Opened the way a person reaches it: from the list above it, by its first link.
            const parent = parentOf(s, screens)
            const from = parent === undefined ? undefined : parent.path.includes(':') ? opened.get(parent.path) : parent.path
            if (from === undefined) {
              ctx.evidence.push({ note: `${s.path}: not opened — nothing above it was opened` })
              continue
            }
            await page.goto(origin + from)
            await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => undefined)
            const match = new Matcher([s], false)
            const hrefs = await page.locator('a[href]').evaluateAll((as) => as.map((a) => new URL((a as HTMLAnchorElement).href).pathname))
            const link = hrefs.find((h) => match.match('GET', h) !== undefined)
            if (link === undefined) {
              ctx.evidence.push({ note: `${s.path}: not opened — ${from} has no link to one yet (a new workspace has none)` })
              continue
            }
            path = link
          }
          const { problems, ms } = await visit(ctx, page, origin, path, s)
          count++
          opened.set(s.path, path)
          ctx.evidence.push({ note: `${path} (${s.feature}) — ${(ms / 1000).toFixed(1)} s${problems.length > 0 ? `: ${problems.join('; ')}` : ''}` })
          if (problems.length > 0) {
            wrong.push(`${path}: ${problems.join('; ')}`)
            where.push(path)
          }
        }
      } finally {
        await page.close()
      }
      return wrong.length === 0
        ? { pass: true, detail: `${count} screens opened: each named itself, with no page error and no 5xx` }
        : { pass: false, detail: `${wrong.length} of ${count} screens wrong — ${wrong.join(' | ')}`, where }
    },
  }
}

/** B29.2 — the brand board's two dark planes, as the browser paints them: Obsidian and Surface. */
export const DARK_PLANES = { canvas: 'rgb(6, 10, 18)', sidebar: 'rgb(8, 18, 32)' } as const

export function brandPlanes(): Scenario {
  return {
    id: 'brand-planes',
    title: 'in the dark theme the page canvas is the board’s Obsidian and the sidebar its Surface',
    run: async (ctx) => {
      const page = await ctx.app.tab('/')
      try {
        await page.locator('aside[aria-label="Primary"]').waitFor({ state: 'attached', timeout: HEADING_TIMEOUT_MS })
        // The theme a person picks is the attribute on <html>; setting it here leaves their stored choice alone.
        const seen = await page.evaluate(() => {
          document.documentElement.setAttribute('data-theme', 'dark')
          const bg = (el: Element | null) => (el === null ? 'no element' : getComputedStyle(el).backgroundColor)
          return { canvas: bg(document.body), sidebar: bg(document.querySelector('aside[aria-label="Primary"]')) }
        })
        ctx.evidence.push({ note: `dark: canvas ${seen.canvas}, sidebar ${seen.sidebar}` })
        const wrong = (Object.keys(DARK_PLANES) as (keyof typeof DARK_PLANES)[])
          .filter((k) => seen[k] !== DARK_PLANES[k])
          .map((k) => `the ${k} is ${seen[k]}, not ${DARK_PLANES[k]}`)
        return wrong.length === 0
          ? { pass: true, detail: `dark canvas ${seen.canvas} and sidebar ${seen.sidebar}, as on the board` }
          : { pass: false, detail: wrong.join('; '), where: ['/'] }
      } finally {
        await page.close()
      }
    },
  }
}

/**
 * B29.7 — the shell in the board's PRODUCT UI tile, as the browser paints it in the dark theme: every
 * destination in the sidebar carries a 20px line icon, the selected row (Home, on /) sits on the
 * accent tint with Teal text, and the top-bar title is Space Grotesk 500 at 20px.
 */
export const DARK_SHELL = { activeBg: 'rgb(14, 43, 46)', activeInk: 'rgb(58, 214, 192)', titleSize: '20px', titleWeight: '500' } as const

export function appShell(): Scenario {
  return {
    id: 'app-shell',
    title: 'every sidebar link carries its icon, the selected row is Teal on the tint, and the top bar is 20px',
    run: async (ctx) => {
      const page = await ctx.app.tab('/')
      try {
        const nav = page.getByRole('navigation', { name: 'Sections' })
        await nav.locator('a[aria-current="page"]').waitFor({ timeout: HEADING_TIMEOUT_MS })
        const seen = await page.evaluate(() => {
          document.documentElement.setAttribute('data-theme', 'dark')
          const nav = document.querySelector('nav[aria-label="Sections"]')!
          // Privacy and Terms are the two policy links under the rule, not destinations; they carry no icon.
          const rows = Array.from(nav.querySelectorAll('a[href]')).filter((a) => !['/privacy', '/terms'].includes(a.getAttribute('href') ?? ''))
          const bare = rows
            .filter((a) => {
              const svg = a.querySelector('svg[data-icon]')
              return svg === null || svg.getBoundingClientRect().width !== 20
            })
            .map((a) => (a.textContent ?? '').trim())
          const active = nav.querySelector('a[aria-current="page"]')
          const h1 = document.querySelector('header h1')
          return {
            rows: rows.length,
            bare,
            active: active ? (active.textContent ?? '').trim() : null,
            activeBg: active ? getComputedStyle(active).backgroundColor : 'none',
            activeInk: active ? getComputedStyle(active).color : 'none',
            titleSize: h1 ? getComputedStyle(h1).fontSize : 'no title',
            titleWeight: h1 ? getComputedStyle(h1).fontWeight : 'no title',
            titleFace: h1 ? getComputedStyle(h1).fontFamily : 'no title',
          }
        })
        ctx.evidence.push({
          note: `${seen.rows} sidebar links, ${seen.bare.length} without an icon; selected "${seen.active}" ${seen.activeInk} on ${seen.activeBg}; title ${seen.titleSize}/${seen.titleWeight} ${seen.titleFace}`,
        })
        const wrong: string[] = []
        if (seen.rows === 0) wrong.push('the sidebar has no links')
        if (seen.bare.length > 0) wrong.push(`no 20px icon on ${seen.bare.join(', ')}`)
        if (seen.active !== 'Home') wrong.push(`on / the selected row is ${seen.active ?? 'nothing'}, not Home`)
        for (const k of ['activeBg', 'activeInk', 'titleSize', 'titleWeight'] as const) {
          if (seen[k] !== DARK_SHELL[k]) wrong.push(`${k} is ${seen[k]}, not ${DARK_SHELL[k]}`)
        }
        if (!seen.titleFace.includes('Space Grotesk')) wrong.push(`the title is set in ${seen.titleFace}`)
        return wrong.length === 0
          ? { pass: true, detail: `all ${seen.rows} sidebar links carry an icon; Home is Teal on the tint; the title is 20px Space Grotesk 500` }
          : { pass: false, detail: wrong.join('; '), where: ['/'] }
      } finally {
        await page.close()
      }
    },
  }
}

/** The Lens reads a customer's own key can make: GET, and no parameter but its workspace. */
export function customerReads(lens: readonly Entry[]): Entry[] {
  return lens.filter((e) => e.method === 'GET' && cannotTest(e) === undefined &&
    !/^\/v1\/synthetic\/|\/sse$|\*/.test(e.path) &&
    (e.path.match(/\{[^}]*\}/g) ?? []).every((p) => p === '{wsID}'))
}

export function lensReads(): Scenario {
  return {
    id: 'lens-reads',
    title: 'every Lens read a customer\'s key can make answers within 15 s, never with a server error',
    feature: 'Lens API',
    run: async (ctx) => {
      const user = ctx.app.user
      const reads = customerReads(ctx.env.inventory.lens)
      // Nothing to read is no verdict: an ERROR, never a PASS that checked nothing.
      if (reads.length === 0) throw new Error(`no Lens routes to read: ${ctx.env.inventory.lensMissing ?? 'the inventory lists none'}`)
      const by = { ok: 0, refused: 0, absent: 0, other: 0 }
      const broken: string[] = []
      for (const r of reads) {
        const path = r.path.replace('{wsID}', encodeURIComponent(user.workspaceID))
        const a = await ctx.env.lens.read(user, path, READ_TIMEOUT_MS)
        if (a.status === 0) broken.push(`${r.path} did not answer within ${READ_TIMEOUT_MS / 1000} s`)
        else if (a.status >= 500) broken.push(`${r.path} answered ${a.status}: ${a.body.replace(/\s+/g, ' ').slice(0, 120)}`)
        else if (a.status < 300) by.ok++
        else if (a.status === 401 || a.status === 403) by.refused++
        else if (a.status === 404) by.absent++
        else by.other++
        ctx.evidence.push({ note: `GET ${r.path} → ${a.status === 0 ? 'no answer' : a.status} in ${a.ms} ms` })
      }
      const tally = `${reads.length} reads: ${by.ok} answered, ${by.refused} refused this key, ${by.absent} not served here (404), ${by.other} other 4xx`
      return broken.length === 0
        ? { pass: true, detail: `${tally}; none with a server error` }
        : { pass: false, detail: `${tally}; ${broken.length} broken — ${broken.join(' | ')}` }
    },
  }
}
