import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, CONSOLE_ROUTES, queryClient } from './App'
import { BRAND, HOME_TITLE, documentTitle } from './documentTitle'

/**
 * THE BROWSER TAB NAMED NO PAGE — ON EVERY ADDRESS THE SUITE HAS.
 *
 * ── WHAT WAS MEASURED, AT `d26f9ad`, WITH EVERY GATE GREEN ───────────────────────────
 *
 * A throwaway probe drove the real `<App />` to 23 addresses and recorded, for each, the string
 * the banner paints and the value of `document.title`. The banner was right 23 times out of 23.
 * `document.title` was written ZERO times out of 23 — the probe set a sentinel before every
 * navigation and read the same sentinel back after every one:
 *
 *   /              banner "Overview"          document.title UNWRITTEN
 *   /ledger        banner "Ledger"            document.title UNWRITTEN
 *   /billing…      banner "Billing"           document.title UNWRITTEN
 *   … 12 console pages, 2 deep splat addresses, 3 not-founds, 6 public pages, all UNWRITTEN.
 *
 * And on the SHIPPED artifact rather than in jsdom: `apps/web/dist/assets/index-*.js` contains
 * `document.title` 0 times, with `Talyvor` and `Not found` present in the same file as the
 * positive control that the grep read the bundle at all. So the only title this product has ever
 * had is the ONE STATIC STRING in `index.html`, `Talyvor Suite`, and a single-page app never
 * re-reads that. Every tab, every bookmark, every history entry, and every screen reader
 * announcing a route change gets the same five syllables for all 23 states.
 *
 * ⚠ THIS IS `ConsoleTitle.test.tsx`'s DEFECT ONE CONSUMER OUT. That file exists because two
 * tables of paths had to agree and nothing asked whether they did; its fix made the BANNER name
 * the page you are on, and its own prose says why that matters — "to a screen reader arriving at
 * the banner landmark, it IS the page". The document has the same job for the browser, and it
 * was never wired to the answer the product already computes. A curated instrument guards what
 * it lists: ConsoleTitle reads `getByRole('banner')` and nothing reads `document`.
 *
 * ── WHERE THE FORMAT COMES FROM, MEASURED RATHER THAN CHOSEN ─────────────────────────
 *
 * The item is "suite redesign to the WEBSITE language", so the shape is the website's, fetched
 * 2026-08-10 from the live marketing site:
 *
 *   https://talyvor.higgsfield.app/pricing      <title>Pricing | TALYVOR</title>
 *   https://talyvor.higgsfield.app/economy      <title>The economy | TALYVOR</title>
 *   https://talyvor.higgsfield.app/attribution  <title>Attribution | TALYVOR</title>
 *   https://talyvor.higgsfield.app/self-host    <title>Self-host | TALYVOR</title>
 *   https://talyvor.higgsfield.app/             <title>TALYVOR: the AI development suite …</title>
 *
 * `<page> | <brand>`, and the FRONT DOOR carries the brand alone. Both halves are copied here.
 * The brand string is not the site's `TALYVOR` but this app's own shipped `<title>` — asserted
 * against `index.html` below, so the cold-load default and this module cannot drift.
 *
 * ⚠ NO PAGE NAME IS INVENTED. Every name below is a string the product already paints:
 * the twelve console names come from `CONSOLE_ROUTES`, the same table the banner reads (so the
 * tab and the header cannot disagree — asserted, not assumed); `Not found` is `NOT_FOUND_TITLE`;
 * `Privacy` and `Terms` are those pages' own `<h1>`; `Sign in` and `Create a workspace` are the
 * labels the product writes on its own links to `/signin` and `/signup` (areas/auth/Entry.tsx);
 * `Share your answers, and earn from them` is the consent screen's own `CardHeader`. `/marketing/*` takes
 * the brand alone because it IS the front door, which is what the website does with its own.
 *
 * ⚠ AND THE SENTINEL IS LOAD-BEARING. `document.title` is one property of one jsdom document
 * that every test in this file shares, so a case that writes nothing passes on the PREVIOUS
 * case's title. Every case below overwrites it with a string no assertion accepts first.
 */

const SENTINEL = '<<< nothing wrote a title >>>'

function mockBff(me: Record<string, unknown>) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url === '/auth/me') {
      return new Response(JSON.stringify(me), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response('null', { status: 404 })
  })
}

/** Loopback dev: the gate passes straight through, so the console pages actually render. */
const PASSES_THROUGH = { mode: 'disabled', authenticated: false, user: null }
const SIGNED_OUT = { mode: 'oidc', authenticated: false, user: null }
const NEEDS_POOLING = {
  mode: 'oidc',
  authenticated: true,
  user: { email: 'a@b.c' },
  needs_pooling_choice: true,
}

beforeEach(() => {
  document.title = SENTINEL
  // ⚠ LOAD-BEARING, AND IT CAUGHT ITSELF. `queryClient` is a module singleton with
  // `staleTime: 60_000` on `['auth-me']`, so without this the first mock in the file answers
  // every later case: the two gate cases below rendered the CONSOLE and titled "Ledger" and
  // "Overview". They failed only because they pin the exact string — a case asserting merely
  // "something was written" would have been green while exercising the wrong screen.
  queryClient.clear()
})
afterEach(() => {
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

/** Render at an address and wait for the settled paint. Public routes have no nav landmark, so
 *  this waits on the body having content rather than on a console-only element. */
async function at(address: string) {
  window.history.pushState({}, '', address)
  render(<App />)
  await waitFor(() => expect(document.body.textContent ?? '').not.toBe(''))
}

const addressOf = (routePath: string) => routePath.replace(/\/\*$/, '')

/**
 * ⚠ WHAT IS DELIBERATELY *NOT* ASSERTED HERE, AND WHY. An earlier draft also checked that the
 * document title's page half EQUALS the string `getByRole('banner')` paints. It cannot fail:
 * `AppShell` computes `page` once and hands the same value to both, and any mutation that makes
 * the banner say something else is caught by `ConsoleTitle.test.tsx`, which pins the banner for
 * this exact address set. An invariant held twice cannot be breached by a control that only one
 * of the two guards can see, so the copy is gone rather than kept as decoration. The agreement
 * is STRUCTURAL — one expression, two consumers — and App.tsx says so at the call site.
 */

/** EVERY CONSOLE PAGE'S NAME, AS A LITERAL, keyed by the `<Route path>` string. Pinned rather
 *  than read from `CONSOLE_ROUTES`: driving the loop off the table is what audits a NEW page
 *  automatically, and it is also what would let a renamed page rename its own expectation. */
const PINNED_CONSOLE: Readonly<Record<string, string>> = {
  '/': 'Home',
  '/overview': 'Overview',
  '/ledger': 'Ledger',
  '/chat': 'Chat',
  '/chat/help': 'How to use Talyvor Chat',
  // B28.10 — Earnings became Royalties, under Statements; /earnings redirects to it.
  '/statements/royalties': 'Royalties',
  '/billing': 'Billing',
  '/plans': 'Plans',
  '/billing/success': 'Billing',
  '/billing/cancel': 'Billing',
  '/keys': 'API keys',
  '/agents': 'Agent Wallets',
  // B28.7 — the wallet's own destinations in the sidebar.
  '/approvals': 'Approvals',
  '/statements': 'Statements',
  '/marketplace/*': 'Marketplace',
  '/setup': 'Setup',
  '/spend': 'Spend & routing',
  '/members': 'Members',
  '/operator': 'Operator',
  '/settings': 'Settings',
  '/features': 'Features',
  '/features/try/tare': 'Try Tare',
  '/features/try/conversion': 'Try document conversion',
  '/track/*': 'Track',
  '/docs/*': 'Docs',
}

/** Addresses with no page — the exact set `ConsoleTitle.test.tsx` proved the banner names
 *  truthfully. The tab has to say the same thing. */
const NO_SUCH_PAGE = ['/admin', '/specimen', '/nonesuch', '/keys/extra', '/billingx', '/docs-old']

/** Public addresses and the WHOLE title each must carry. `/marketing` is the front door. */
const PINNED_PUBLIC: ReadonlyArray<readonly [string, string]> = [
  ['/marketing', 'Talyvor — wallets for AI agents'],
  ['/marketing/pricing', 'Talyvor — wallets for AI agents'],
  ['/privacy', 'Privacy | Talyvor'],
  ['/terms', 'Terms | Talyvor'],
  ['/signup', 'Create a workspace | Talyvor'],
  ['/signin', 'Sign in | Talyvor'],
]

describe('the format, and the brand it ends in', () => {
  it('is "<page> | Talyvor", and the front door is the wallet line', () => {
    // Hardcoded on both sides. A guard that builds its expectation from the constant it is
    // checking passes for every value of that constant.
    expect(documentTitle('Ledger')).toBe('Ledger | Talyvor')
    expect(documentTitle(null)).toBe('Talyvor — wallets for AI agents')
    expect(BRAND).toBe('Talyvor')
  })

  it('is the same brand the cold load already ships, read from index.html', () => {
    // The SPA writes this property; the first paint of a full page load gets the file. If these
    // two ever disagree, a hard refresh renames the product for one frame.
    const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8')
    const m = /<title>([^<]*)<\/title>/.exec(html)
    expect(m, 'index.html has no <title> to compare against').not.toBeNull()
    expect(m?.[1]).toBe(HOME_TITLE)
  })

  it('ships a description and a social preview that name the same product (B28.1)', () => {
    // A crawler and a link unfurler read index.html's bytes and never run the script, so these
    // tags are the whole of what a search result or a shared link shows.
    const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8')
    const tag = (attr: 'name' | 'property', key: string) =>
      new RegExp(`<meta\\s+${attr}="${key}"\\s+content="([^"]*)"`).exec(html)?.[1]
    const description =
      'Give every AI agent a wallet: a budget, spending rules, approvals, a card and a live statement, enforced before the model call or payment.'
    expect(tag('name', 'description')).toBe(description)
    expect(tag('property', 'og:title')).toBe('Talyvor — wallets for AI agents')
    expect(tag('property', 'og:description')).toBe(description)
    expect(tag('property', 'og:image')).toBe('https://app.talyvor.com/og-image.png')
    expect(tag('name', 'twitter:card')).toBe('summary_large_image')
    expect(tag('name', 'twitter:image')).toBe('https://app.talyvor.com/og-image.png')
    // The image the tags name is in the build: public/ is copied to the root as it is.
    const png = readFileSync(resolve(__dirname, '../public/og-image.png'))
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG')
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630])
  })

  it('ships the brand icons the tab, the Home Screen and an install name (B29.1)', () => {
    const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8')
    const link = (rel: string, href: string) => new RegExp(`<link rel="${rel}" href="${href}"`).test(html)
    expect(link('icon', '/favicon.ico')).toBe(true)
    expect(link('icon', '/favicon.svg')).toBe(true)
    expect(link('apple-touch-icon', '/apple-touch-icon.png')).toBe(true)
    expect(/<meta name="theme-color" content="#060A12"/.test(html)).toBe(true)

    const pub = (name: string) => readFileSync(resolve(__dirname, '../public', name))
    // An .ico starts 00 00 01 00; served as anything else, the tab shows a blank page icon.
    expect([...pub('favicon.ico').subarray(0, 4)]).toEqual([0, 0, 1, 0])
    expect(pub('favicon.svg').toString('utf8')).toContain('<svg')
    const side = (name: string) => [pub(name).readUInt32BE(16), pub(name).readUInt32BE(20)]
    expect(side('apple-touch-icon.png')).toEqual([180, 180])

    const manifest = JSON.parse(pub('manifest.webmanifest').toString('utf8'))
    expect(manifest.name).toBe('Talyvor')
    expect(manifest.background_color).toBe('#060A12')
    expect(manifest.theme_color).toBe('#060A12')
    expect(manifest.icons).toEqual([
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ])
    // Each icon the manifest names is in the build, at the size it claims.
    for (const icon of manifest.icons as { src: string; sizes: string }[]) {
      const n = Number(icon.sizes.split('x')[0])
      expect(side(icon.src.slice(1)), icon.src).toEqual([n, n])
    }
  })
})

describe('every console address names itself to the browser', () => {
  beforeEach(() => mockBff(PASSES_THROUGH))

  it('the pinned names and CONSOLE_ROUTES agree, in both directions', () => {
    expect(Object.fromEntries(CONSOLE_ROUTES.map((r) => [r.path, r.title]))).toEqual(PINNED_CONSOLE)
  })

  it('no loop below can pass by having nothing to drive', () => {
    expect(CONSOLE_ROUTES.length).toBeGreaterThanOrEqual(12)
    expect(NO_SUCH_PAGE.length).toBeGreaterThanOrEqual(6)
    expect(PINNED_PUBLIC.length).toBeGreaterThanOrEqual(6)
  })

  it.each(CONSOLE_ROUTES.map((r) => [addressOf(r.path), r.title] as const))(
    '%s is titled "%s | Talyvor"',
    async (address, name) => {
      await at(address)
      await waitFor(() => expect(document.title).not.toBe(SENTINEL))
      expect(document.title).toBe(`${name} | ${BRAND}`)
    },
  )

  it.each([
    ['/track/issues/ISSUE-1', 'Track'],
    ['/docs/spaces/sp_1', 'Docs'],
  ])('%s keeps its area name in the tab', async (address, name) => {
    await at(address)
    await waitFor(() => expect(document.title).not.toBe(SENTINEL))
    expect(document.title).toBe(`${name} | ${BRAND}`)
  })

  it.each(NO_SUCH_PAGE)('%s is titled as no page, not as a page', async (address) => {
    await at(address)
    await waitFor(() => expect(document.title).not.toBe(SENTINEL))
    // Prove the address really has no page first, or the title assertion is checking a route
    // that quietly started existing.
    expect(document.body.textContent ?? '').toContain('pick a section from the sidebar')
    expect(document.title).toBe(`Not found | ${BRAND}`)
  })

  it('follows an in-app navigation, which is the only kind this app has', async () => {
    // A single-page app never re-reads <title>. A title set once at mount is a title that is
    // correct for exactly one route and wrong for every route the user walks to afterwards.
    await at('/')
    await waitFor(() => expect(document.title).toBe(`Home | ${BRAND}`))
    fireEvent.click(screen.getByRole('link', { name: 'Statements' }))
    await waitFor(() => expect(document.title).toBe(`Statements | ${BRAND}`))
  })
})

describe('a screen you are gated out of does not take the name of the page behind it', () => {
  it('the sign-in card is titled Sign in, not the page that was asked for', async () => {
    // This is the defect ConsoleTitle.test.tsx fixed for the banner, arriving through the gate:
    // naming a page the reader is not on, and the name is the only one on the screen.
    mockBff(SIGNED_OUT)
    await at('/ledger')
    await waitFor(() => expect(document.title).not.toBe(SENTINEL))
    expect(document.title).toBe(`Sign in | ${BRAND}`)
    expect(document.title).not.toContain('Ledger')
  })

  /**
   * ⚠ THESE TWO ALSO PIN THE UPDATE, WHICH THE CONTROL RUN IS WHAT REVEALED. `authenticated`
   * starts false and becomes true when the probe answers, so this screen's name is not known at
   * mount — C3 (the effect's dependency list emptied, i.e. "set the title once") reds these two
   * as well as the navigation case, which it was not predicted to. A title written only at mount
   * is wrong for every state a surface reaches afterwards, not only for the next route.
   */
  it.each(['/signup', '/signin'])(
    '%s titles the already-signed-in card by ITS heading, not the door',
    async (address) => {
      // Same address, different screen: `AlreadyIn` renders when the browser has a session, and
      // it is not the page the route is named after.
      mockBff({ mode: 'oidc', authenticated: true, user: { email: 'a@b.c' } })
      await at(address)
      await waitFor(() => expect(document.title).not.toBe(SENTINEL))
      expect(document.title).toBe(`You’re signed in | ${BRAND}`)
    },
  )

  it('a new workspace opens Home, titled Home — no consent screen stands in front of it (B28.8)', async () => {
    mockBff(NEEDS_POOLING)
    await at('/')
    await waitFor(() => expect(document.title).not.toBe(SENTINEL))
    expect(document.title).toBe(`Home | ${BRAND}`)
  })
})

describe('every public address names itself to the browser', () => {
  beforeEach(() => mockBff(PASSES_THROUGH))

  it.each(PINNED_PUBLIC)('%s is titled "%s"', async (address, title) => {
    await at(address)
    await waitFor(() => expect(document.title).not.toBe(SENTINEL))
    expect(document.title).toBe(title)
  })
})
