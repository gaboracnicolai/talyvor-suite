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

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
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

/**
 * B29.8 — Home opens like the board's PRODUCT UI tile: "Welcome to Talyvor" and a raised card for each
 * product. Each card is clicked from a freshly opened Home, as a person does, and must land on its route
 * with the console's own heading naming the page there — not the catch-all's "Not found".
 */
export const HOME_CARDS = [
  { title: 'Agent Wallets', path: '/agents', heading: 'Agent Wallets' },
  { title: 'Approvals', path: '/approvals', heading: 'Approvals' },
  { title: 'Statements', path: '/statements', heading: 'Statements' },
  { title: 'Chat', path: '/chat', heading: 'Chat' },
  { title: 'Marketplace', path: '/marketplace', heading: 'Marketplace' },
  { title: 'Track', path: '/track', heading: 'Track' },
  { title: 'Docs', path: '/docs', heading: 'Docs' },
  { title: 'Developers', path: '/setup', heading: 'Setup' },
] as const

export function homeCards(): Scenario {
  return {
    id: 'home-cards',
    title: 'Home welcomes the person and each of its eight product cards opens its own screen',
    run: async (ctx) => {
      const wrong: string[] = []
      const landed: string[] = []
      for (const card of HOME_CARDS) {
        const page = await ctx.app.tab('/')
        try {
          await page.getByRole('heading', { level: 2, name: 'Welcome to Talyvor' }).waitFor({ timeout: HEADING_TIMEOUT_MS })
          const link = page.getByRole('list', { name: 'Products' }).getByRole('link', { name: new RegExp(`^${card.title}`) })
          if ((await link.count()) !== 1) {
            wrong.push(`Home has ${await link.count()} "${card.title}" card(s)`)
            continue
          }
          if ((await link.locator('svg[data-icon]').count()) < 1) wrong.push(`the ${card.title} card has no icon`)
          await link.click()
          await page.waitForURL((u) => u.pathname === card.path, { timeout: HEADING_TIMEOUT_MS }).catch(() => undefined)
          const at = new URL(page.url()).pathname
          if (at !== card.path) {
            wrong.push(`the ${card.title} card opened ${at}, not ${card.path}`)
            continue
          }
          const title = page.locator('header h1')
          await title.filter({ hasText: card.heading }).waitFor({ timeout: HEADING_TIMEOUT_MS }).catch(() => undefined)
          const said = ((await title.textContent()) ?? '').trim()
          if (said !== card.heading) wrong.push(`the ${card.title} card opened ${at}, titled "${said}", not "${card.heading}"`)
          else landed.push(`${card.title} → ${at}`)
        } finally {
          await page.close()
        }
      }
      ctx.evidence.push({ note: `Home's cards: ${landed.join(', ') || 'none landed'}` })
      return wrong.length === 0
        ? { pass: true, detail: `all ${HOME_CARDS.length} Home cards open their screen: ${landed.join(', ')}` }
        : { pass: false, detail: wrong.join('; '), where: ['/'] }
    },
  }
}

/**
 * B29.9 — the wallet screens in the brand, as the browser paints them in the dark theme: each screen's one
 * teal action (Fund on Agent Wallets, Approve on Approvals, Download on Statements, none elsewhere), its
 * cards on the raised plane, every LXC amount in IBM Plex Mono with tabular figures, and a pill on each
 * waiting approval and each statement line. Runs after wallet-home, whose agent is funded and waiting.
 */
export const WALLET_SCREENS = [
  { path: '/agents', title: 'Agent Wallets', teal: 'Fund' },
  { path: '/approvals', title: 'Approvals', teal: 'Approve' },
  { path: '/statements', title: 'Statements', teal: 'Download' },
  { path: '/statements/royalties', title: 'Royalties', teal: null },
  { path: '/ledger', title: 'Ledger', teal: null },
  { path: '/spend', title: 'Spend & routing', teal: null },
] as const
export const DARK_WALLET = { teal: 'rgb(58, 214, 192)', raised: 'rgb(14, 26, 42)' } as const

export function walletBrand(): Scenario {
  return {
    id: 'wallet-brand',
    title: 'the wallet screens carry one teal action each, raised cards, mono amounts and status pills',
    run: async (ctx) => {
      const wrong: string[] = []
      const seenAll: string[] = []
      for (const screen of WALLET_SCREENS) {
        const page = await ctx.app.tab(screen.path)
        try {
          await page.locator('header h1').filter({ hasText: screen.title }).waitFor({ timeout: HEADING_TIMEOUT_MS })
          await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => undefined)
          // The theme first, then a pause: a Button's colour eases over 200ms, and read mid-ease it is neither theme's teal.
          await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
          await page.waitForTimeout(400)
          const seen = await page.evaluate((want) => {
            const main = document.querySelector('main')
            if (!main) return null
            const teal = Array.from(main.querySelectorAll('button, a'))
              .filter((b) => getComputedStyle(b).backgroundColor === want.teal)
              .map((b) => (b.textContent ?? '').trim())
            const cards = Array.from(main.querySelectorAll('.rounded-card')).map((c) => getComputedStyle(c).backgroundColor)
            const amounts: string[] = []
            const notMono: string[] = []
            const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT)
            for (let n = walker.nextNode(); n; n = walker.nextNode()) {
              const el = n.parentElement
              if (!el || !/^\s*LXC\b/.test(n.textContent ?? '') || !/\d\s+LXC\b/.test(el.textContent ?? '')) continue
              const st = getComputedStyle(el)
              amounts.push((el.textContent ?? '').trim())
              if (!st.fontFamily.includes('IBM Plex Mono') || !st.fontFeatureSettings.includes('tnum')) notMono.push(`"${(el.textContent ?? '').trim()}" in ${st.fontFamily}`)
            }
            const lines = Array.from(main.querySelectorAll('[data-testid="agent-statement"] tbody tr'))
            const pilled = lines.filter((tr) => tr.querySelector('span.rounded-pill') !== null).length
            const waiting = Array.from(main.querySelectorAll('span.rounded-pill')).filter((p) => (p.textContent ?? '').trim() === 'Waiting').length
            return { teal, cards, amounts: amounts.length, notMono, lines: lines.length, pilled, waiting }
          }, DARK_WALLET)
          if (seen === null) {
            wrong.push(`${screen.path} has no main`)
            continue
          }
          seenAll.push(`${screen.path}: teal [${seen.teal.join(', ')}], ${seen.cards.length} cards, ${seen.amounts} LXC amounts, ${seen.pilled}/${seen.lines} statement lines pilled, ${seen.waiting} waiting`)
          // Approve reads "Approve with Face ID" once the workspace signs its approvals.
          const one = screen.teal === null ? seen.teal.length === 0 : seen.teal.length === 1 && seen.teal[0].startsWith(screen.teal)
          if (!one) wrong.push(`${screen.path} fills [${seen.teal.join(', ')}] teal; want ${screen.teal ?? 'nothing'}`)
          if (seen.cards.length === 0) wrong.push(`${screen.path} shows no card`)
          const flat = seen.cards.filter((c) => c !== DARK_WALLET.raised)
          if (flat.length > 0) wrong.push(`${screen.path}: ${flat.length} card(s) not on raised ${DARK_WALLET.raised}: ${flat.join(', ')}`)
          if (seen.notMono.length > 0) wrong.push(`${screen.path}: amounts off the figure face: ${seen.notMono.slice(0, 3).join('; ')}`)
          if (seen.pilled !== seen.lines) wrong.push(`${screen.path}: ${seen.lines - seen.pilled} statement line(s) without a pill`)
          if (screen.path === '/approvals' && seen.waiting === 0) wrong.push('the approval wallet-home left waiting shows no Waiting pill')
        } finally {
          await page.close()
        }
      }
      ctx.evidence.push({ note: seenAll.join(' | ') })
      return wrong.length === 0
        ? { pass: true, detail: `all ${WALLET_SCREENS.length} wallet screens in the brand: ${seenAll.join(' | ')}` }
        : { pass: false, detail: wrong.join('; '), where: WALLET_SCREENS.map((w) => w.path) }
    },
  }
}

/**
 * B29.10 — Chat in the brand, as the browser paints it in the dark theme: the composer on the raised plane
 * edged in line-strong with the teal Send, the model picker in spaced caps of IBM Plex Mono in the label
 * colour, the newest reply in Space Grotesk 15/24 with its numbers and price line in IBM Plex Mono, and the
 * wallet lines under a spend answer on the raised card. Opens the newest conversation in a tab of its own,
 * asking one question first if there is none, and photographs it at 1440 and 390.
 */
export const CHAT_VIEWPORTS = [[1440, 900], [390, 844]] as const

export function chatBrand(): Scenario {
  return {
    id: 'chat-brand',
    title: 'Chat in the brand: the composer on raised with the teal Send, the picker in eyebrow caps, replies at 15/24 with mono figures',
    run: async (ctx) => {
      if ((await ctx.app.page.locator('[data-testid="turn-assistant"]').count()) === 0) {
        const t = await ctx.app.ask('What is 12 + 30? Reply with the number only.')
        if (t.error !== undefined) return { pass: false, detail: `no reply to read: the question was refused: ${t.error}`, where: ['/chat'] }
      }
      const { dir, link } = ctx.env.shots
      await mkdir(dir, { recursive: true })
      const page = await ctx.app.tab('/chat')
      const wrong: string[] = []
      try {
        await page.locator('[data-testid="turn-reply"]').last().waitFor({ timeout: HEADING_TIMEOUT_MS })
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
        await page.waitForTimeout(400)
        for (const [width, height] of CHAT_VIEWPORTS) {
          await page.setViewportSize({ width, height })
          await page.waitForTimeout(200)
          const seen = await page.evaluate(() => {
            // The token as this theme computes it, so a value is compared in the browser's own spelling.
            const token = (prop: 'backgroundColor' | 'borderTopColor' | 'color', v: string) => {
              const probe = document.createElement('div')
              probe.style.setProperty(prop === 'borderTopColor' ? 'border-top-color' : prop === 'color' ? 'color' : 'background-color', `var(${v})`)
              document.body.appendChild(probe)
              const got = getComputedStyle(probe)[prop]
              probe.remove()
              return got
            }
            const want = { raised: token('backgroundColor', '--raised'), strong: token('borderTopColor', '--rule-strong'), teal: token('backgroundColor', '--accent'), label: token('color', '--label') }
            const form = document.getElementById('chat-message')?.closest('form')
            if (!form) return null
            const f = getComputedStyle(form)
            const send = form.querySelector('button[type="submit"]')
            const picker = form.querySelector('button[aria-haspopup="listbox"]')
            const p = picker ? getComputedStyle(picker) : null
            const replies = document.querySelectorAll('[data-testid="turn-reply"]')
            const reply = replies[replies.length - 1]
            const r = reply ? getComputedStyle(reply) : null
            const turn = reply?.closest('[data-testid="turn-assistant"]')
            const figures = reply ? Array.from(reply.querySelectorAll('span.font-figure')).map((s) => getComputedStyle(s).fontFamily) : []
            // A number standing on its own, in prose rather than code, that is not on the figure face.
            const bare: string[] = []
            if (reply) {
              const walker = document.createTreeWalker(reply, NodeFilter.SHOW_TEXT)
              for (let n = walker.nextNode(); n; n = walker.nextNode()) {
                if (n.parentElement?.closest('code, pre, .font-figure')) continue
                const m = /(?<![\p{L}\p{N}_])[$£€]?\p{N}(?:[\p{N},.]*\p{N})?%?(?![\p{L}\p{N}_])/u.exec(n.textContent ?? '')
                if (m) bare.push(m[0])
              }
            }
            const cost = turn?.querySelector('[data-testid="turn-cost"]')
            const lines = turn?.querySelector('[data-testid="turn-statement-lines"]')
            return {
              want,
              composer: { bg: f.backgroundColor, border: f.borderTopColor },
              send: send ? getComputedStyle(send).backgroundColor : null,
              picker: p ? { transform: p.textTransform, family: p.fontFamily, color: p.color } : null,
              reply: r ? { size: r.fontSize, leading: r.lineHeight, family: r.fontFamily } : null,
              figures,
              bare,
              cost: cost ? getComputedStyle(cost).fontFamily : null,
              lines: lines?.parentElement ? getComputedStyle(lines.parentElement).backgroundColor : null,
              scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            }
          })
          const file = `chat-${width}-dark.jpg`
          await page.screenshot({ path: join(dir, file), type: 'jpeg', quality: 80 })
          if (seen === null) {
            wrong.push(`${width}: /chat has no composer`)
            continue
          }
          const at = `${width}`
          if (seen.composer.bg !== seen.want.raised) wrong.push(`${at}: the composer is on ${seen.composer.bg}, not raised ${seen.want.raised}`)
          if (seen.composer.border !== seen.want.strong) wrong.push(`${at}: the composer is edged ${seen.composer.border}, not line-strong ${seen.want.strong}`)
          if (seen.send !== seen.want.teal) wrong.push(`${at}: Send is ${seen.send ?? 'missing'}, not teal ${seen.want.teal}`)
          if (seen.picker === null) wrong.push(`${at}: no model picker in the composer`)
          else if (seen.picker.transform !== 'uppercase' || !seen.picker.family.includes('IBM Plex Mono') || seen.picker.color !== seen.want.label)
            wrong.push(`${at}: the model picker is ${seen.picker.transform} ${seen.picker.family} in ${seen.picker.color}, not eyebrow caps of IBM Plex Mono in ${seen.want.label}`)
          if (seen.reply === null) wrong.push(`${at}: no reply on screen`)
          else {
            if (seen.reply.size !== '15px' || seen.reply.leading !== '24px' || !seen.reply.family.includes('Space Grotesk'))
              wrong.push(`${at}: the reply is ${seen.reply.size}/${seen.reply.leading} ${seen.reply.family}, not Space Grotesk 15/24`)
            if (seen.bare.length > 0) wrong.push(`${at}: number(s) in the reply off the figure face: ${seen.bare.slice(0, 3).join(', ')}`)
          }
          const offFace = seen.figures.filter((fam) => !fam.includes('IBM Plex Mono'))
          if (offFace.length > 0) wrong.push(`${at}: ${offFace.length} number(s) in the reply not in IBM Plex Mono: ${offFace[0]}`)
          if (seen.cost !== null && !seen.cost.includes('IBM Plex Mono')) wrong.push(`${at}: the price line is in ${seen.cost}`)
          if (seen.lines !== null && seen.lines !== seen.want.raised) wrong.push(`${at}: the wallet lines' card is on ${seen.lines}, not raised`)
          if (seen.scroll > 0) wrong.push(`${at}: /chat scrolls ${seen.scroll}px sideways`)
          ctx.evidence.push({
            note: `/chat ${width}×${height} dark: composer ${seen.composer.bg} edged ${seen.composer.border}, Send ${seen.send}, picker ${seen.picker?.transform ?? '—'} ${seen.picker?.color ?? ''}, ` +
              `reply ${seen.reply?.size ?? '—'}/${seen.reply?.leading ?? '—'}, ${seen.figures.length} figure(s) in mono, wallet lines ${seen.lines ?? 'none under this reply'}`,
            shot: `${link}/${file}`,
          })
        }
      } finally {
        await page.close()
      }
      return wrong.length === 0
        ? { pass: true, detail: 'Chat in the brand at 1440 and 390: composer on raised in line-strong, teal Send, eyebrow picker, replies at 15/24 with mono figures' }
        : { pass: false, detail: wrong.join('; '), where: ['/chat'] }
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
