// B34.5 — every screen and BFF route has a tester. On the 5 Oct self-test the public board screen and 27 BFF routes read
// "not covered": sign out, the version, the workspace list and provider keys; a Track workspace's delete and restore,
// Track's issue search, cycle progress, boards and the public board; Docs' search, write, rewrite, suggest-title,
// changelog, spaces and pin; Chat's wrong-answer feedback and tool calls, and deleting an API key; the pattern-mining
// and stored-answers switches; FX and currency conversion. Each is reached here from the screen a person uses, and
// each oracle is what Lens, Track or Docs stored, read back afterwards — never the status the screen was given.

import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'
import type { AppUser } from './app.ts'
import type { Answered, LedgerRow, LensClient, SyntheticUser } from './lens.ts'
import { refusalOf } from './lens.ts'
import { ACTION_TIMEOUT_MS, agentIn, bookOf, card, fail, openAgent, usdShown, withBank } from './bank.ts'
import { bff } from './routes.ts'
import { RUN_SALT, freshWord, parseFooter } from './oracles.ts'
import { CannotTest, eventually, metered } from './scenarios.ts'
import { DocsPage, FeaturesScreen, TrackScreen, payCheckout, subscribeWithTestCard } from './screens.ts'
import type { Scenario } from './scenarios.ts'
import { until } from './trade.ts'

/** A request from `page`, as its own script makes one: the status and the body as text. */
async function from(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; text: string; type: string }> {
  return page.evaluate(async ({ m, p, b }) => {
    const res = await fetch(p, {
      method: m,
      credentials: 'same-origin',
      headers: b === null ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: b === null ? undefined : JSON.stringify(b),
    })
    return { status: res.status, text: await res.text(), type: res.headers.get('content-type') ?? '' }
  }, { m: method, p: path, b: body === undefined ? null : body })
}

const parsed = <T>(text: string): T | undefined => {
  try {
    return JSON.parse(text) as T
  } catch {
    return undefined
  }
}

// ─── the session: who is signed in, what is running, and signing out ─────────

interface VersionAnswer { service?: string; commit?: string; stamped?: boolean; agree?: boolean; verdict?: string; bundle?: { commit?: string; stamped?: boolean } }

/**
 * The app's own reads of the session: /api/version names the build the BFF and the bundle came from, and they agree;
 * /healthz answers {"status":"ok"}; an app page carries a CSP whose script-src has no 'unsafe-inline',
 * X-Frame-Options: DENY and Referrer-Policy;
 * /api/workspaces lists exactly the workspace Lens gives this user's token; an /api/ path the BFF does not have answers
 * a JSON 404, never the app's page. Then the person signs in again in a second browser and presses Sign out there: that
 * browser is signed out (its /auth/me, its workspaces refused, an unknown path 401), and the first one still is not.
 */
export function sessionSignOut(seed: number): Scenario {
  return {
    id: 'session-sign-out',
    owner: 'talyvor-suite',
    items: ['B28.247', 'B28.454'],
    title: "the app's version, its workspace list and an unknown /api/ path read as the BFF and Lens hold them; Sign out in a second browser ends that session and only that one",
    run: async (ctx) => {
      const { app, env } = ctx
      const failures: string[] = []

      const v = await from(app.page, 'GET', '/api/version')
      const version = parsed<VersionAnswer>(v.text)
      ctx.evidence.push({ note: `/api/version: ${v.status} ${v.text.slice(0, 400)}` })
      if (v.status !== 200 || version?.service !== 'bff') failures.push(`/api/version answered ${v.status} ${v.text.slice(0, 200)}`)
      // An unstamped BFF is a development build (the self-test's): nothing names a commit to compare.
      else if (version.stamped === true && version.agree !== true) failures.push(`/api/version: ${version.verdict ?? 'no verdict'}`)

      // B28.211 — the probe a cluster restarts the app on: its own JSON, never the app's page.
      const h = await from(app.page, 'GET', '/healthz')
      ctx.evidence.push({ note: `/healthz: ${h.status} ${h.text.slice(0, 100)}` })
      if (h.status !== 200 || parsed<{ status?: string }>(h.text)?.status !== 'ok') failures.push(`/healthz answered ${h.status} ${h.text.slice(0, 200)}`)

      // B28.247 — an app page names its CSP, refuses every frame, and sends no address in a Referer to another site.
      const sec = await app.page.evaluate(async () => {
        const res = await fetch('/ledger', { credentials: 'same-origin' })
        return { csp: res.headers.get('content-security-policy') ?? '', frame: res.headers.get('x-frame-options') ?? '', referrer: res.headers.get('referrer-policy') ?? '' }
      })
      ctx.evidence.push({ note: `/ledger headers: CSP "${sec.csp}"; X-Frame-Options "${sec.frame}"; Referrer-Policy "${sec.referrer}"` })
      if (!sec.csp.includes("frame-ancestors 'none'") || sec.frame !== 'DENY' || sec.referrer !== 'same-origin') {
        failures.push(`/ledger: CSP "${sec.csp}", X-Frame-Options "${sec.frame}", Referrer-Policy "${sec.referrer}"`)
      }
      // B28.454 — and a script injected into it does not run: its script-src has no 'unsafe-inline'.
      const scripts = sec.csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src '))
      if (scripts === undefined || scripts.includes("'unsafe-inline'")) failures.push(`/ledger: CSP "${sec.csp}" lets any inline script run`)

      const mine = await bff<{ id: string }[]>(ctx, 'GET', '/api/workspaces')
      const lens = await env.lens.act<{ id: string }[]>(app.user, 'GET', '/v1/workspaces')
      const ids = (a: typeof mine) => a.ok ? (a.value ?? []).map((w) => w.id).sort().join(', ') : `refused ${a.status}: ${a.error}`
      ctx.evidence.push({ note: `/api/workspaces: ${ids(mine)}; Lens's /v1/workspaces for this token: ${ids(lens)}` })
      if (!mine.ok || !lens.ok) failures.push(`the workspace list: the app reads ${ids(mine)}, Lens ${ids(lens)}`)
      else if (ids(mine) !== app.user.workspaceID || ids(lens) !== app.user.workspaceID) {
        failures.push(`the app lists ${ids(mine)} and Lens ${ids(lens)}, not this user's workspace ${app.user.workspaceID} alone`)
      }

      const unknown = `/api/no-such-route-${seed}`
      const nf = await from(app.page, 'GET', unknown)
      ctx.evidence.push({ note: `${unknown} signed in: ${nf.status} ${nf.type} ${nf.text.slice(0, 200)}` })
      if (nf.status !== 404 || !nf.type.includes('application/json')) failures.push(`${unknown} answered ${nf.status} ${nf.type}, not a JSON 404`)

      // A second browser, signed in as the same person, signs out with the button in the top bar.
      const other: AppUser = await env.signInUser(app.user.index)
      try {
        await other.page.getByRole('button', { name: 'Sign out', exact: true }).click()
        await other.page.getByRole('button', { name: 'Sign out', exact: true }).waitFor({ state: 'detached', timeout: 15_000 }).catch(() => undefined)
        const me = parsed<{ authenticated?: boolean }>((await from(other.page, 'GET', '/auth/me')).text)
        const gone = await from(other.page, 'GET', '/api/workspaces')
        const lost = await from(other.page, 'GET', unknown)
        const still = await bff<{ id: string }[]>(ctx, 'GET', '/api/workspaces')
        ctx.evidence.push({ note: `signed out in the second browser: /auth/me authenticated ${me?.authenticated}; its /api/workspaces ${gone.status}, ${unknown} ${lost.status}; ` +
          `the first browser's /api/workspaces ${still.ok ? `${still.status} ${ids(still)}` : `refused ${still.status}`}` })
        if (me?.authenticated !== false) failures.push(`after Sign out, /auth/me still reads authenticated ${me?.authenticated}`)
        if (gone.status !== 401) failures.push(`after Sign out, the workspace list answered ${gone.status} ${refusalOf(gone.text)}, not 401`)
        if (lost.status !== 401) failures.push(`after Sign out, ${unknown} answered ${lost.status}, not 401`)
        if (!still.ok || ids(still) !== app.user.workspaceID) failures.push(`signing out the second browser also signed out the first: ${ids(still)}`)
      } finally {
        await other.close()
      }

      return failures.length === 0
        ? { pass: true, detail: `version ${version?.commit ?? '(unstamped)'}${version?.agree === true ? ', the BFF and the bundle agree' : ''}; the app and Lens list ${app.user.workspaceID} alone; ${unknown} a JSON 404; Sign out ended the second browser's session (401 after) and left the first signed in` }
        : fail(failures.join('; '))
    },
  }
}

// ─── money in pounds and euros, and LENS converted to LXC ─────────────────────

/** The ECB's daily euro reference rates, read from the file the BFF and Lens read (fx.go, Lens internal/ecbrate). */
const ECB_DAILY = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'

interface Rates { rate_date: string; usd_per_eur: number; gbp_per_eur: number }

async function ecbRates(): Promise<Rates | string> {
  try {
    const res = await fetch(ECB_DAILY, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return `the ECB's daily file answered ${res.status}`
    const xml = await res.text()
    const rate = (c: string) => Number(new RegExp(`currency=['"]${c}['"]\\s+rate=['"]([0-9.]+)['"]`).exec(xml)?.[1] ?? NaN)
    const day = /time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1]
    if (day === undefined || !(rate('USD') > 0) || !(rate('GBP') > 0)) return 'the ECB\'s daily file holds no USD and GBP rate'
    return { rate_date: day, usd_per_eur: rate('USD'), gbp_per_eur: rate('GBP') }
  } catch (e) {
    return `the ECB's daily file could not be read: ${e instanceof Error ? e.message : String(e)}`
  }
}

/** An amount as the wallet screens write it (money.tsx fiatText). */
function fiatShown(amount: number, fiat: 'USD' | 'GBP' | 'EUR'): string {
  const fmt = new Intl.NumberFormat(fiat === 'USD' ? 'en-US' : 'en-GB', { style: 'currency', currency: fiat, minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return amount > 0 && amount < 0.005 ? `<${fmt.format(0.01)}` : fmt.format(amount)
}

/**
 * An agent funded 12.5 LXC, shown in pounds and then in euros with "Show amounts in" on Agent Wallets: each figure is
 * its dollar value at Lens's peg, turned into pounds or euros at the rates the European Central Bank published today —
 * read by the harness from the ECB's own file, and the same rates the app's /api/fx states. Then back to dollars.
 */
export function walletFX(seed: number): Scenario {
  const amount = 12_500_000
  return {
    id: 'wallet-fx',
    owner: 'talyvor-suite',
    agents: 1,
    title: "an agent's 12.5 LXC shown in pounds and in euros on Agent Wallets: its dollar value at Lens's peg at the ECB's rates of the day",
    run: (ctx) => withBank(ctx, async (bank) => {
      const ecb = await ecbRates()
      if (typeof ecb === 'string') throw new CannotTest(ecb)
      const a = await openAgent(ctx, bank, `Abroad ${seed}`)
      if (typeof a === 'string') return fail(a)
      const err = await bank.move(a, amount, 'Fund')
      if (err !== undefined) return fail(`funding 12.5 LXC was refused: ${err}`)
      const held = agentIn(await bookOf(ctx), a.id)?.balance_ulxc
      if (held !== amount) return fail(`funded ${amount} µLXC; Lens's book has ${a.name} holding ${held}`)

      const fx = await from(bank.page, 'GET', '/api/fx')
      const served = parsed<Rates>(fx.text)
      ctx.evidence.push({ note: `the ECB's file: ${JSON.stringify(ecb)}; the app's /api/fx: ${fx.status} ${fx.text.slice(0, 200)}` })
      const failures: string[] = []
      if (fx.status !== 200 || served === undefined) failures.push(`/api/fx answered ${fx.status} ${refusalOf(fx.text)}`)
      else if (served.rate_date !== ecb.rate_date || served.usd_per_eur !== ecb.usd_per_eur || served.gbp_per_eur !== ecb.gbp_per_eur) {
        // The BFF keeps a read for an hour: across the ECB's afternoon publication it may still hold the day before's.
        if (served.rate_date >= ecb.rate_date) failures.push(`/api/fx states ${JSON.stringify(served)}; the ECB published ${JSON.stringify(ecb)}`)
      }
      const rates = served !== undefined && served.rate_date < ecb.rate_date ? served : ecb
      const usd = (amount / 1e6) * ctx.env.usdPerLXC
      const picker = bank.page.getByLabel('Show amounts in')
      const balance = bank.page.getByTestId(`agent-balance-${a.id}`)
      try {
        for (const [fiat, symbol, value] of [['GBP', '£', (usd / rates.usd_per_eur) * rates.gbp_per_eur], ['EUR', '€', usd / rates.usd_per_eur]] as const) {
          await picker.selectOption(fiat)
          await balance.filter({ hasText: symbol }).waitFor({ timeout: 15_000 }).catch(() => undefined)
          const shown = (await balance.innerText()).replace(/\s+/g, ' ').trim()
          const want = `12.5 LXC (${fiatShown(value, fiat)})`
          ctx.evidence.push({ note: `in ${fiat}: "${shown}"` })
          if (shown !== want) failures.push(`in ${fiat} ${a.name} reads "${shown}"; $${usd.toFixed(4)} at ${rates.usd_per_eur} USD and ${rates.gbp_per_eur} GBP per euro (${rates.rate_date}) is "${want}"`)
        }
      } finally {
        await picker.selectOption('USD').catch(() => undefined)
      }
      const back = (await bank.balanceShown(a))
      if (back !== `12.5 LXC ${usdShown(amount, ctx.env.usdPerLXC)}`) failures.push(`back in dollars ${a.name} reads "${back}"`)
      return failures.length === 0
        ? { pass: true, detail: `12.5 LXC read in pounds and euros at the ECB's ${rates.rate_date} rates (${rates.usd_per_eur} USD, ${rates.gbp_per_eur} GBP per euro), as /api/fx states them; back in dollars "${back}"` }
        : fail(failures.join('; '))
    }),
  }
}

interface LensBalance { balance_ulens: number; held_balance_ulens?: number }

/**
 * LENS converted to LXC from Royalties. The quote the app reads is Lens's rate, and the minimum. A workspace whose LENS
 * is all still held (or none) is offered no conversion, and one asked for anyway — as the panel's own request — is
 * refused by Lens with nothing moved: the LXC ledger, the LXC balance and the LENS balance all as they were. Below the
 * minimum it is refused before Lens is asked. A workspace with spendable LENS converts the minimum: one LXC posting of
 * exactly that amount, and its LENS balance down by the quoted cost.
 */
export function lensConvert(): Scenario {
  return {
    id: 'lens-convert',
    owner: 'talyvor-lens',
    title: 'LENS to LXC from Royalties: the quote is Lens\'s rate; with nothing spendable the conversion is refused and nothing moves; with LENS, one LXC posting of the amount',
    run: async (ctx) => {
      const { app, env } = ctx
      const page = await app.tab('/statements/royalties')
      const failures: string[] = []
      try {
        await page.getByRole('heading', { name: 'Convert to LXC' }).or(page.getByText('Convert to LXC', { exact: true })).first().waitFor({ timeout: 15_000 }).catch(() => undefined)
        const quote = await from(page, 'GET', '/api/lens/convert-quote')
        const q = parsed<{ lens_per_lxc: number; usd_per_lxc: number; min_lxc_ulxc: number; reversible: boolean }>(quote.text)
        const rate = await env.lens.act<{ lens_per_lxc: number; usd_per_lxc: number }>(app.user, 'GET', '/v1/economy/conversion-rate')
        ctx.evidence.push({ note: `the quote: ${quote.status} ${quote.text.slice(0, 300)}; Lens's rate: ${rate.ok ? JSON.stringify(rate.value) : `refused ${rate.status}`}` })
        if (quote.status !== 200 || q === undefined) return fail(`the conversion quote answered ${quote.status} ${refusalOf(quote.text)}`)
        if (!rate.ok) return fail(`Lens answered ${rate.status} for its conversion rate: ${rate.error}`)
        if (q.lens_per_lxc !== rate.value.lens_per_lxc || q.usd_per_lxc !== rate.value.usd_per_lxc) {
          failures.push(`the quote states ${q.lens_per_lxc} LENS and $${q.usd_per_lxc} per LXC; Lens's rate is ${rate.value.lens_per_lxc} and $${rate.value.usd_per_lxc}`)
        }
        if (q.reversible !== false) failures.push('the quote calls the conversion reversible')

        const state = async () => {
          const lens = await env.lens.act<LensBalance>(app.user, 'GET', '/v1/workspaces/{ws}/tokens/balance')
          const lxc = await env.lens.act<{ balance_ulxc: number }>(app.user, 'GET', '/v1/workspaces/{ws}/lxc/balance')
          return { lens: lens.ok ? lens.value.balance_ulens : NaN, lxc: lxc.ok ? lxc.value.balance_ulxc : NaN, rows: await env.lens.ledger(app.user) }
        }
        const before = await state()
        const min = q.min_lxc_ulxc

        const low = await from(page, 'POST', '/api/lens/convert', { lxc_amount_ulxc: min - 1 })
        ctx.evidence.push({ note: `${min - 1} µLXC, under the minimum: ${low.status} ${low.text.slice(0, 200)}` })
        if (low.status !== 400) failures.push(`${min - 1} µLXC, under the ${min} µLXC minimum, answered ${low.status}`)

        if (before.lens > 0) {
          // Spendable LENS: the panel converts the minimum.
          await page.getByRole('button', { name: 'Convert to LXC…' }).click()
          await page.getByLabel('LXC to receive').fill(String(min / 1e6))
          await page.getByRole('button', { name: 'Convert', exact: true }).click()
          const after = await until(state, (s) => s.lxc !== before.lxc, 20_000)
          const fresh = after.rows.filter((r) => !before.rows.some((o) => o.id === r.id))
          const cost = Math.ceil(min * q.lens_per_lxc)
          ctx.evidence.push({ note: `converted ${min} µLXC: LXC ${before.lxc} → ${after.lxc}, LENS ${before.lens} → ${after.lens}; new rows ${fresh.map((r) => `${r.type} ${r.amount_ulxc}`).join(', ') || 'none'}` })
          if (fresh.length !== 1 || fresh[0].amount_ulxc !== min || after.lxc !== before.lxc + min) failures.push(`converting ${min} µLXC posted ${fresh.map((r) => `${r.type} ${r.amount_ulxc}`).join(', ') || 'nothing'} and moved LXC ${before.lxc} → ${after.lxc}`)
          if (after.lens !== before.lens - cost) failures.push(`LENS moved ${before.lens} → ${after.lens}, not down by the quoted ${cost}`)
        } else {
          const offered = await page.getByRole('button', { name: 'Convert to LXC…' }).count()
          if (offered > 0) failures.push('Royalties offers a conversion to a workspace with no spendable LENS')
          const asked = await from(page, 'POST', '/api/lens/convert', { lxc_amount_ulxc: min })
          const after = await state()
          const fresh = after.rows.filter((r) => !before.rows.some((o) => o.id === r.id))
          ctx.evidence.push({ note: `${min} µLXC with ${before.lens} spendable LENS: ${asked.status} ${asked.text.slice(0, 200)}; LXC ${before.lxc} → ${after.lxc}, LENS ${before.lens} → ${after.lens}, ${fresh.length} new ledger row(s)` })
          if (asked.status !== 402) failures.push(`converting with no spendable LENS answered ${asked.status} ${refusalOf(asked.text)}, not Lens's 402`)
          if (fresh.length !== 0 || after.lxc !== before.lxc || after.lens !== before.lens) failures.push(`the refused conversion moved something: LXC ${before.lxc} → ${after.lxc}, LENS ${before.lens} → ${after.lens}, ${fresh.length} new ledger row(s)`)
        }
      } finally {
        await page.close()
      }
      return failures.length === 0
        ? { pass: true, detail: 'the quote is Lens\'s rate and minimum; under the minimum refused; the conversion did exactly what the LENS held allowed, on the ledger' }
        : fail(failures.join('; '))
    },
  }
}

// ─── Track: a workspace deleted and restored; search, a cycle's progress, a published board ───

/** A product read from the signed-in page: its JSON, or why not. */
async function readFrom<T>(page: Page, path: string): Promise<T | string> {
  const r = await from(page, 'GET', path)
  const v = parsed<T>(r.text)
  return r.status === 200 && v !== undefined ? v : `${path} answered ${r.status} ${refusalOf(r.text)}`
}

interface TrackWS { id: string; name: string; slug: string; deleted_at?: string; restorable_until?: string }

/**
 * Track's workspace settings: the person deletes their Track workspace by typing its slug, and Track holds it among the
 * deleted ones, with the day it goes for good, and no longer among the live ones; Restore brings it back, and Track
 * lists it live again with every issue it had.
 */
export function trackWorkspaceRestore(seed: number): Scenario {
  const title = `Kept through a delete ${seed}`
  return {
    id: 'track-workspace-restore',
    owner: 'talyvor-track',
    title: 'Track: a workspace deleted on Workspace settings is held among the deleted ones and not the live; Restore brings it back with its issues',
    run: async (ctx) => {
      const track = await TrackScreen.open(ctx.app)
      await track.create(title)
      await track.close()
      const page = await ctx.app.tab('/track/settings')
      let deletedID: string | undefined
      const failures: string[] = []
      try {
        const live = await readFrom<TrackWS[]>(page, '/api/track/workspaces')
        if (typeof live === 'string') return fail(live)
        const ws = live[0]
        if (ws === undefined) return fail('Track lists this person in no workspace')
        ctx.evidence.push({ note: `Track's workspaces before: ${live.map((w) => `${w.name} (${w.slug})`).join(', ')}` })

        await page.getByRole('button', { name: 'Delete…' }).first().click()
        await page.getByLabel(`Type ${ws.slug} to confirm`).fill(ws.slug)
        const [answered] = await Promise.all([
          page.waitForResponse((r) => r.request().method() === 'DELETE' && r.url().includes(`/api/track/workspaces/${encodeURIComponent(ws.id)}`), { timeout: 30_000 }).catch(() => undefined),
          page.getByRole('button', { name: 'Delete workspace' }).click(),
        ])
        const said = answered === undefined ? 'no request was sent' : `${answered.status()} ${(await answered.text().catch(() => '')).slice(0, 200)}`
        await page.getByRole('button', { name: 'Restore' }).first().or(page.getByRole('alert')).first().waitFor({ timeout: 15_000 }).catch(() => undefined)
        const alert = (await page.getByRole('alert').allInnerTexts()).join(' ').trim()
        ctx.evidence.push({ note: `Delete workspace: Track answered ${said}${alert === '' ? '' : `; the screen says "${alert}"`}` })
        const gone = await readFrom<TrackWS[]>(page, '/api/track/workspaces/deleted')
        const left = await readFrom<TrackWS[]>(page, '/api/track/workspaces')
        const held = typeof gone === 'string' ? undefined : gone.find((w) => w.id === ws.id)
        if (held !== undefined) deletedID = ws.id
        ctx.evidence.push({ note: `deleted: Track's deleted list ${typeof gone === 'string' ? gone : gone.map((w) => `${w.id} deleted ${w.deleted_at} until ${w.restorable_until}`).join(', ') || 'empty'}; ` +
          `its live list ${typeof left === 'string' ? left : left.map((w) => w.id).join(', ') || 'empty'}` })
        if (held === undefined) {
          // The restore route is still asked, as the screen would after a delete: Track has nothing to restore.
          const back = await from(page, 'POST', `/api/track/workspaces/${encodeURIComponent(ws.id)}/restore`)
          ctx.evidence.push({ note: `Restore asked anyway: ${back.status} ${back.text.slice(0, 200)}` })
          return fail(`Delete workspace (its slug typed) was answered ${said}${alert === '' ? '' : ` ("${alert}")`}, and Track's deleted workspaces do not hold ${ws.id}`)
        }
        if (!held.deleted_at || !held.restorable_until || Date.parse(held.restorable_until) <= Date.parse(held.deleted_at)) {
          failures.push(`Track holds ${ws.id} deleted at ${held.deleted_at}, restorable until ${held.restorable_until}`)
        }
        if (typeof left !== 'string' && left.some((w) => w.id === ws.id)) failures.push(`Track still lists ${ws.id} among the live workspaces after its delete`)

        await page.getByRole('button', { name: 'Restore' }).first().click()
        await page.getByText('No deleted workspaces you own are waiting to be restored.').waitFor({ timeout: 15_000 }).catch(() => undefined)
        const back = await readFrom<TrackWS[]>(page, '/api/track/workspaces')
        const still = await readFrom<TrackWS[]>(page, '/api/track/workspaces/deleted')
        if (typeof still !== 'string' && !still.some((w) => w.id === ws.id)) deletedID = undefined
        const issues = await readFrom<{ title: string }[]>(page, '/api/track/issues?limit=100')
        ctx.evidence.push({ note: `restored: live ${typeof back === 'string' ? back : back.map((w) => w.id).join(', ')}; deleted ${typeof still === 'string' ? still : still.map((w) => w.id).join(', ') || 'none'}; ` +
          `issues ${typeof issues === 'string' ? issues : issues.length}` })
        if (typeof back === 'string' || !back.some((w) => w.id === ws.id)) failures.push(`after Restore Track does not list ${ws.id} live: ${typeof back === 'string' ? back : back.map((w) => w.id).join(', ')}`)
        if (deletedID !== undefined) failures.push(`after Restore Track still holds ${ws.id} among the deleted`)
        if (typeof issues === 'string' || !issues.some((i) => i.title === title)) failures.push(`after Restore the issue "${title}" is not listed`)
      } finally {
        if (deletedID !== undefined) await from(page, 'POST', `/api/track/workspaces/${encodeURIComponent(deletedID)}/restore`).catch(() => undefined)
        await page.close()
      }
      return failures.length === 0
        ? { pass: true, detail: `deleted on Workspace settings: held deleted, restorable, not live; restored: live again with "${title}"` }
        : fail(failures.join('; '))
    },
  }
}

interface TrackIssue { id: string; title: string; status: string; cycle_id?: string | null }
interface PublicBoard { workspace: string; project?: string; issues: { identifier: string; title: string; status: string }[]; truncated: boolean }

/**
 * Track's own tools on issues it holds: Search issues finds the issue by its words and not its neighbour; a cycle
 * started on Cycles takes the issue with Add to cycle, and its progress line counts exactly the issues Track lists in
 * that cycle; a board published read-only opens at its link, signed out, with the issues Track holds; turned off, the
 * link reads "This board isn't available" and Track's list of links no longer has it.
 */
export function trackSearchCycleBoard(seed: number): Scenario {
  const word = `zephyrine${seed}${RUN_SALT}`
  const found = `Payment retries ${word} stall after the third attempt`
  const other = `Onboarding email for tester ${seed} lands in spam`
  const cycle = `Sprint ${seed}-${RUN_SALT % 10000}`
  return {
    id: 'track-search-cycle-board',
    owner: 'talyvor-track',
    title: 'Track: Search issues finds the issue by its words; a cycle\'s progress counts what Track holds in it; a published board opens signed out with Track\'s issues, and is gone once turned off',
    run: async (ctx) => {
      const failures: string[] = []
      const track = await TrackScreen.open(ctx.app)
      try {
        await track.create(other)
        await track.create(found)
        const p = track.page

        // Search issues.
        const hits = await eventually(ctx, 3, async () => {
          await p.locator('#track-search').fill(word)
          await p.getByRole('button', { name: 'Search', exact: true }).click()
          const c = card(p, 'Search issues')
          await c.getByRole('button', { name: 'Search', exact: true }).waitFor({ timeout: 30_000 }).catch(() => undefined)
          await c.locator('li').or(c.getByText(/^Track returned no issues|^Couldn’t search|^Track answered in a shape/)).first().waitFor({ timeout: 30_000 }).catch(() => undefined)
          return (await c.innerText()).replace(/\s+/g, ' ')
        }, (t) => t.includes(found))
        ctx.evidence.push({ note: `Search issues "${word}": ${hits.slice(0, 400)}` })
        if (!hits.includes(found)) failures.push(`searching "${word}" did not list "${found}"`)
        if (hits.includes(other)) failures.push(`searching "${word}" also listed "${other}"`)

        // A cycle, and its progress.
        await p.goto(new URL('/track/cycles', p.url()).toString())
        await p.locator('#cycle-name').fill(cycle)
        const [started] = await Promise.all([
          p.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/track\/teams\/[^/]+\/cycles$/.test(new URL(r.url()).pathname), { timeout: 30_000 }).catch(() => undefined),
          p.getByRole('button', { name: 'Start cycle' }).click(),
        ])
        const cycleCard = p.locator('div.rounded-card').filter({ hasText: cycle }).first()
        const shownCard = await cycleCard.waitFor({ timeout: 30_000 }).then(() => true, () => false)
        let issues = await readFrom<TrackIssue[]>(p, '/api/track/issues?limit=100')
        if (!shownCard) {
          const alert = (await p.getByRole('alert').allInnerTexts()).join(' ').trim()
          failures.push(`Start cycle was answered ${started === undefined ? 'by no request' : `${started.status()} ${(await started.text().catch(() => '')).slice(0, 200)}`}` +
            `${alert === '' ? '' : ` ("${alert}")`}, and no card for "${cycle}" was shown`)
        } else {
        await cycleCard.getByRole('button', { name: 'Open', exact: true }).click()
        await cycleCard.locator('li').filter({ hasText: found }).getByRole('button', { name: 'Add to cycle' }).click()
        const line = cycleCard.getByTestId('cycle-progress').locator('p').filter({ hasText: / done · / })
        await line.waitFor({ timeout: 15_000 }).catch(() => undefined)
        const shown = (await line.count()) > 0 ? (await line.first().innerText()).trim() : (await cycleCard.getByTestId('cycle-progress').innerText()).trim()
        issues = await readFrom<TrackIssue[]>(p, '/api/track/issues?limit=100')
        const cycleID = typeof issues === 'string' ? undefined : issues.find((i) => i.title === found)?.cycle_id ?? undefined
        const inCycle = cycleID === undefined ? 'no cycle' : await readFrom<TrackIssue[]>(p, `/api/track/issues?cycle_id=${encodeURIComponent(cycleID)}&limit=100`)
        ctx.evidence.push({ note: `cycle "${cycle}": the card reads "${shown}"; Track holds ${typeof inCycle === 'string' ? inCycle : inCycle.map((i) => `${i.title} (${i.status})`).join(', ')}` })
        if (typeof inCycle === 'string') failures.push(`after Add to cycle, Track holds "${found}" in ${inCycle}`)
        else {
          const done = inCycle.filter((i) => i.status === 'done').length
          if (!inCycle.some((i) => i.title === found)) failures.push(`Track's cycle does not hold "${found}"`)
          if (!shown.startsWith(`${done} of ${inCycle.length} done`)) failures.push(`the cycle reads "${shown}"; Track holds ${inCycle.length} issue(s) in it, ${done} done`)
        }
        }

        // A board, published and opened at its link.
        await p.goto(new URL('/track/board', p.url()).toString())
        const before = await readFrom<{ id: string; token: string }[]>(p, '/api/track/boards')
        await p.getByRole('button', { name: 'Publish a board link' }).click()
        const field = p.getByLabel('Board link for Every issue').last()
        await field.waitFor({ timeout: 15_000 })
        const link = await field.inputValue()
        const token = /\/board\/([A-Za-z0-9_-]+)$/.exec(link)?.[1]
        const links = await readFrom<{ id: string; token: string }[]>(p, '/api/track/boards')
        const made = typeof links === 'string' ? undefined : links.find((l) => l.token === token)
        ctx.evidence.push({ note: `published "${link}"; Track's links ${typeof links === 'string' ? links : links.map((l) => l.token.slice(0, 6) + '…').join(', ')} (${typeof before === 'string' ? '?' : before.length} before)` })
        if (token === undefined || made === undefined) return fail(`published a board, and Track's links do not hold the one the screen shows (${link})`)
        const listed = typeof issues === 'string' ? [] : issues.map((i) => i.title)
        const board = await ctx.app.tab(`/board/${token}`)
        try {
          await board.getByText('Read-only board').waitFor({ timeout: 15_000 }).catch(() => undefined)
          const text = (await board.locator('main').innerText()).replace(/\s+/g, ' ')
          const asStranger = await fetch(new URL(`/api/public/boards/${token}`, board.url())).then(async (r) => ({ status: r.status, body: parsed<PublicBoard>(await r.text()) }))
          ctx.evidence.push({ note: `/board/${token.slice(0, 6)}…: ${text.slice(0, 300)}; signed out, the board answers ${asStranger.status} with ${asStranger.body?.issues.length ?? 0} issue(s)` })
          for (const t of [found, other]) if (!text.includes(t)) failures.push(`the published board does not show "${t}", which Track holds`)
          if (asStranger.status !== 200 || asStranger.body === undefined) failures.push(`signed out, the board's link answers ${asStranger.status}`)
          else if (asStranger.body.issues.some((i) => !listed.includes(i.title))) failures.push(`the board shows issues Track does not list: ${asStranger.body.issues.map((i) => i.title).filter((t) => !listed.includes(t)).join(', ')}`)

          // Turned off.
          await p.getByRole('button', { name: 'Turn off' }).last().click()
          await field.waitFor({ state: 'detached', timeout: 15_000 }).catch(() => undefined)
          const after = await readFrom<{ token: string }[]>(p, '/api/track/boards')
          await board.reload()
          await board.getByRole('heading', { level: 1 }).waitFor({ timeout: 15_000 }).catch(() => undefined)
          const h1 = (await board.getByRole('heading', { level: 1 }).first().innerText().catch(() => '')).trim()
          ctx.evidence.push({ note: `turned off: Track's links ${typeof after === 'string' ? after : after.length}; the link now reads "${h1}"` })
          if (typeof after === 'string' || after.some((l) => l.token === token)) failures.push(`turned off, Track still holds the link: ${typeof after === 'string' ? after : 'listed'}`)
          if (h1 !== 'This board isn’t available') failures.push(`turned off, the board's link reads "${h1}"`)
        } finally {
          await board.close()
        }
      } finally {
        await track.close()
      }
      return failures.length === 0
        ? { pass: true, detail: `search found "${found}" alone; "${cycle}" counts what Track holds in it; the board opened signed out with Track's issues and was gone once turned off` }
        : fail(failures.join('; '))
    },
  }
}

interface TrackProjectRead { id: string; name: string; identifier: string; description: string; team_id: string }

/**
 * B34.9 — Track's Projects: the person names a project and presses Start project, and Track holds it with that name,
 * identifier and description, under the workspace's team, and the screen lists it. The last Track route the app sends a
 * request to that no scenario reached (POST /v1/workspaces/{wsID}/projects, through POST /api/track/projects).
 */
export function trackProject(seed: number): Scenario {
  const name = `Billing retries ${seed}-${RUN_SALT % 10000}`
  const identifier = `P${seed}${RUN_SALT % 1000}`
  const description = `Started by tester ${seed}`
  return {
    id: 'track-project',
    owner: 'talyvor-track',
    title: 'Track: Start project on Projects makes a project Track holds with its name, identifier and description, and the screen lists it',
    run: async (ctx) => {
      const page = await ctx.app.tab('/track/projects')
      try {
        await page.locator('#project-name').waitFor({ timeout: 30_000 })
        await page.locator('#project-name').fill(name)
        await page.getByLabel('Identifier').fill(identifier)
        await page.getByLabel('Description (optional)').fill(description)
        const [started] = await Promise.all([
          page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/track/projects', { timeout: 30_000 }).catch(() => undefined),
          page.getByRole('button', { name: 'Start project' }).click(),
        ])
        const row = page.locator('li').filter({ hasText: name })
        const listed = await row.first().waitFor({ timeout: 30_000 }).then(() => true, () => false)
        const held = await readFrom<TrackProjectRead[]>(page, '/api/track/projects')
        const project = typeof held === 'string' ? undefined : held.find((p) => p.name === name)
        const teams = await readFrom<{ id: string }[]>(page, '/api/track/teams')
        ctx.evidence.push({ note: `Start project "${name}" (${identifier}) was answered ${started === undefined ? 'by no request' : started.status()}; ` +
          `Track holds ${typeof held === 'string' ? held : project === undefined ? `${held.length} project(s), not this one` : JSON.stringify(project)}; ` +
          `the screen ${listed ? 'lists it' : 'does not list it'}` })
        if (project === undefined) {
          const alert = (await page.getByRole('alert').allInnerTexts()).join(' ').trim()
          return fail(`after Start project, Track holds no project named "${name}"${alert === '' ? '' : ` ("${alert}")`}`)
        }
        const failures: string[] = []
        if (project.identifier !== identifier) failures.push(`Track holds identifier "${project.identifier}", not "${identifier}"`)
        if (project.description !== description) failures.push(`Track holds description "${project.description}", not "${description}"`)
        if (typeof teams === 'string' || !teams.some((t) => t.id === project.team_id)) failures.push(`Track holds it under team ${project.team_id}, not one of this workspace's`)
        if (!listed) failures.push(`Projects does not list "${name}", which Track holds`)
        return failures.length === 0 ? { pass: true, detail: `Track holds "${name}" (${identifier}) under the workspace's team, and Projects lists it` } : fail(failures.join('; '))
      } finally {
        await page.close()
      }
    },
  }
}

// ─── Docs: search, a space, pin, and the AI tools on a page ───────────────────

interface DocsPageRead { id: string; title: string; content_text: string }

/**
 * Docs' tools on a page this person wrote: Search the documentation finds it by a word only it holds; its space reads
 * as Docs holds it; Pin puts it among Docs' pins and Unpin takes it out; Fix grammar on the whole text, replaced and
 * saved, is the page Docs then holds; Write with AI, inserted and saved, is in it; a suggested title, used, is the
 * title Docs holds; a changelog entry generated for a Track issue is the entry Docs answered, for that version.
 */
export function docsTools(seed: number): Scenario {
  const word = `quillmark${seed}${RUN_SALT}`
  const space = `Handbook ${seed}`
  const title = `Release checklist ${seed}`
  const text = `the release team meet in room ${word} on thursday. they checks the rollback plan before every launch and writes down who approved it.`
  const version = `v${seed}.${Date.now() % 1000}.0`
  return {
    id: 'docs-tools',
    owner: 'talyvor-docs',
    title: 'Docs: search finds a page by its words; its space reads as Docs holds it; pin and unpin; grammar fixed, AI writing and a suggested title saved are what Docs holds; a changelog entry for a Track issue',
    run: async (ctx) => {
      const failures: string[] = []
      const track = await TrackScreen.open(ctx.app)
      const issueTitle = `Rollback plan sign-off ${seed}`
      await track.create(issueTitle)
      const issues = await readFrom<{ identifier: string; title: string }[]>(track.page, '/api/track/issues?limit=100')
      await track.close()
      const identifier = typeof issues === 'string' ? undefined : issues.find((i) => i.title === issueTitle)?.identifier
      if (identifier === undefined) return fail(`the Track issue "${issueTitle}" was filed, and Track does not list it: ${typeof issues === 'string' ? issues : 'missing'}`)

      const doc = await DocsPage.write(ctx.app, space, title, text)
      const p = doc.page
      try {
        const ids = /\/docs\/spaces\/([^/]+)\/pages\/([^/?#]+)/.exec(p.url())
        if (ids === null) return fail(`the page opened at ${p.url()}, which names no space and page`)
        const [, spaceID, pageID] = ids
        const stored = async () => readFrom<DocsPageRead>(p, `/api/docs/spaces/${spaceID}/pages/${pageID}`)

        // The space, as Docs holds it.
        const sp = await readFrom<{ id: string; name: string }>(p, `/api/docs/spaces/${spaceID}`)
        ctx.evidence.push({ note: `the space: ${typeof sp === 'string' ? sp : JSON.stringify(sp).slice(0, 200)}` })
        if (typeof sp === 'string' || sp.id !== spaceID || sp.name !== space) failures.push(`the space reads ${typeof sp === 'string' ? sp : `"${sp.name}" (${sp.id})`}, not "${space}" (${spaceID})`)

        // Pin, then unpin.
        const pins = async () => readFrom<{ page_id: string }[]>(p, '/api/docs/pins')
        await p.getByRole('button', { name: `Pin ${title}` }).first().click()
        const pinned = await until(pins, (x) => typeof x !== 'string' && x.some((q) => q.page_id === pageID), 15_000)
        await p.getByRole('button', { name: `Unpin ${title}` }).first().click()
        const unpinned = await until(pins, (x) => typeof x !== 'string' && !x.some((q) => q.page_id === pageID), 15_000)
        ctx.evidence.push({ note: `pinned: Docs' pins ${typeof pinned === 'string' ? pinned : pinned.map((q) => q.page_id).join(', ') || 'none'}; unpinned: ${typeof unpinned === 'string' ? unpinned : unpinned.map((q) => q.page_id).join(', ') || 'none'}` })
        if (typeof pinned === 'string' || !pinned.some((q) => q.page_id === pageID)) failures.push(`pinned on the page, and Docs' pins do not hold it: ${typeof pinned === 'string' ? pinned : 'missing'}`)
        if (typeof unpinned === 'string' || unpinned.some((q) => q.page_id === pageID)) failures.push('unpinned on the page, and Docs still holds it pinned')

        // Fix grammar on the whole text, replaced and saved.
        const editor = p.getByRole('textbox', { name: 'Content' })
        await editor.click()
        await p.keyboard.press('ControlOrMeta+a')
        const fixed = await metered(ctx, 'docs', text.length, async () => {
          await p.getByRole('group', { name: 'AI on the selection' }).getByRole('button', { name: 'Fix grammar' }).click()
          const s = p.getByTestId('ai-suggestion')
          await s.waitFor({ timeout: 120_000 }).catch(() => undefined)
          return (await s.count()) > 0 ? (await s.innerText()).trim() : (await p.getByRole('alert').allInnerTexts()).join(' ') || 'no suggestion'
        })
        await p.getByRole('button', { name: 'Replace selection' }).click().catch(() => undefined)
        await saved(p)
        const flat = (s: string) => s.replace(/\s+/g, ' ').trim()
        const afterFix = await until(stored, (x) => typeof x !== 'string' && flat(x.content_text) === flat(fixed), 15_000)
        ctx.evidence.push({ note: 'Fix grammar on the whole page', answer: fixed })
        if (typeof afterFix === 'string') failures.push(afterFix)
        else if (flat(afterFix.content_text) !== flat(fixed)) failures.push(`grammar fixed and saved, Docs holds "${flat(afterFix.content_text).slice(0, 160)}", not the suggestion "${flat(fixed).slice(0, 160)}"`)
        else if (!afterFix.content_text.toLowerCase().includes(word)) failures.push(`the fixed text lost "${word}"`)

        // Write with AI at the end, inserted and saved.
        await editor.click()
        await p.keyboard.press('ControlOrMeta+End')
        const prompt = `One sentence saying the checklist lives in room ${word}.`
        const written = await metered(ctx, 'docs', text.length + prompt.length, async () => {
          await p.getByLabel('What to write').fill(prompt)
          await p.getByRole('button', { name: 'Write', exact: true }).click()
          const s = p.getByTestId('ai-suggestion')
          await s.waitFor({ timeout: 120_000 }).catch(() => undefined)
          return (await s.count()) > 0 ? (await s.innerText()).trim() : 'no suggestion'
        })
        await p.getByRole('button', { name: 'Insert below' }).click().catch(() => undefined)
        await saved(p)
        const afterWrite = await until(stored, (x) => typeof x !== 'string' && flat(x.content_text).includes(flat(written)), 15_000)
        ctx.evidence.push({ note: `Write with AI: "${prompt}"`, answer: written })
        if (typeof afterWrite === 'string') failures.push(afterWrite)
        else if (written === 'no suggestion' || !flat(afterWrite.content_text).includes(flat(written))) failures.push(`AI's writing "${written.slice(0, 120)}" was inserted and saved, and Docs holds "${flat(afterWrite.content_text).slice(0, 200)}"`)

        // A suggested title, used.
        const t = card(p, 'Title')
        const suggested = await metered(ctx, 'docs', text.length, async () => {
          await t.getByRole('button', { name: 'Suggest a title' }).click()
          await t.getByRole('button', { name: 'Use this title' }).or(t.getByText(/^The model returned no title|^Couldn’t suggest/)).first().waitFor({ timeout: 120_000 }).catch(() => undefined)
          return (await t.getByRole('button', { name: 'Use this title' }).count()) > 0 ? (await t.locator('p.text-body.text-ink').first().innerText()).trim() : ''
        })
        if (suggested === '') failures.push(`no title was suggested: ${(await t.innerText()).replace(/\s+/g, ' ').slice(0, 200)}`)
        else {
          await t.getByRole('button', { name: 'Use this title' }).click()
          await t.getByText('Renamed.').waitFor({ timeout: 15_000 }).catch(() => undefined)
          const renamed = await until(stored, (x) => typeof x !== 'string' && x.title === suggested, 15_000)
          ctx.evidence.push({ note: `Suggest a title: "${suggested}"; Docs holds the title "${typeof renamed === 'string' ? renamed : renamed.title}"` })
          if (typeof renamed === 'string' || renamed.title !== suggested) failures.push(`"${suggested}" was used, and Docs holds the title ${typeof renamed === 'string' ? renamed : `"${renamed.title}"`}`)
        }

        // A changelog entry for the Track issue.
        const c = card(p, 'Changelog entry')
        await p.locator('#changelog-version').fill(version)
        await p.locator('#changelog-issues').fill(identifier)
        const [answer] = await Promise.all([
          p.waitForResponse((r) => r.url().includes('/changelog/generate') && r.request().method() === 'POST', { timeout: 30_000 }).catch(() => undefined),
          c.getByRole('button', { name: 'Generate entry' }).click(),
        ])
        const entry = answer === undefined ? undefined : parsed<{ version: string; title: string; summary: string; issue_ids: string[] }>(await answer.text().catch(() => ''))
        await c.getByText(/ — /).first().waitFor({ timeout: 15_000 }).catch(() => undefined)
        const line = (await c.innerText()).replace(/\s+/g, ' ')
        ctx.evidence.push({ note: `changelog ${version} for ${identifier}: Docs answered ${answer?.status() ?? 'nothing'} ${JSON.stringify(entry ?? {}).slice(0, 300)}` })
        if (answer?.status() !== 201 || entry === undefined) failures.push(`generating the changelog entry answered ${answer?.status() ?? 'nothing'}`)
        else {
          if (entry.version !== version || entry.issue_ids?.join(',') !== identifier) failures.push(`Docs wrote the entry for ${entry.version} with ${entry.issue_ids?.join(', ')}, not ${version} with ${identifier}`)
          if (!line.includes(`${entry.title} — ${entry.summary}`.replace(/\s+/g, ' '))) failures.push(`the card does not show the entry Docs wrote ("${entry.title} — ${entry.summary}")`)
        }

        // Search the documentation, by the word only this page holds.
        const search = await ctx.app.tab('/docs')
        try {
          const s = card(search, 'Search the documentation')
          const results = await eventually(ctx, 3, async () => {
            await s.getByLabel('Search').fill(word)
            await s.getByRole('button', { name: 'Search', exact: true }).click()
            await s.locator('li').or(s.getByText(/no pages|No pages|Couldn’t search|nothing/i)).first().waitFor({ timeout: 30_000 }).catch(() => undefined)
            return (await s.innerText()).replace(/\s+/g, ' ')
          }, (r) => r.includes(suggested || title))
          const now = await stored()
          const held = typeof now === 'string' ? title : now.title
          ctx.evidence.push({ note: `Search the documentation "${word}": ${results.slice(0, 300)}` })
          if (!results.includes(held)) failures.push(`searching "${word}" did not list "${held}", the one page that holds it`)
        } finally {
          await search.close()
        }
      } finally {
        await doc.close()
      }
      return failures.length === 0
        ? { pass: true, detail: `found by "${word}"; the space as Docs holds it; pinned and unpinned; grammar fixed, AI writing and the title "${title}" → suggested, each saved as Docs holds it; changelog ${version} for ${identifier}` }
        : fail(failures.join('; '))
    },
  }
}

/** Presses the page's Save and waits for Docs to say it is saved. */
/**
 * B28.447 — what B28.249 shipped in talyvor-docs, through the app. Share on a page this person wrote makes a link a
 * stranger opens signed out; the same link with one character of its signature changed answers 404, exactly as a link
 * Docs never made does; and an edit sent over the page's live-edit socket, closed straight after Docs acknowledged it
 * (well inside Docs' 5-second autosave tick), is in the page read back — Docs saves it when the last socket leaves.
 */
export function docsShareCollab(seed: number): Scenario {
  const word = `ferrule${seed}${RUN_SALT}`
  const edit = `kestrel${seed}${RUN_SALT}`
  const space = `Field notes ${seed}`
  const title = `Shared runbook ${seed}`
  const text = `the night shift checks valve ${word} before handover.`
  return {
    id: 'docs-share-collab',
    owner: 'talyvor-docs',
    items: ['B28.249', 'B28.447'],
    title: 'Docs: a share link is read signed out, the same link with one signature character changed is 404 like an unknown link, and an edit on the live-edit socket closed before the autosave tick is saved',
    run: async (ctx) => {
      const browser = ctx.app.context.browser()
      if (browser === null) throw new CannotTest('no browser to open a signed-out context in')
      const doc = await DocsPage.write(ctx.app, space, title, text)
      const p = doc.page
      const stranger = await browser.newContext()
      const shots: string[] = []
      const shoot = async (on: Page, name: string): Promise<void> => {
        await mkdir(ctx.env.outDir, { recursive: true })
        const was = on.viewportSize()
        for (const [width, height] of [[1440, 900], [390, 844]]) {
          await on.setViewportSize({ width, height })
          const file = join(ctx.env.outDir, `docs-share-${name}-${width}px-user${ctx.app.user.index}.png`)
          await on.screenshot({ path: file, fullPage: true })
          shots.push(file)
        }
        if (was !== null) await on.setViewportSize(was)
      }
      try {
        const ids = /\/docs\/spaces\/([^/]+)\/pages\/([^/?#]+)/.exec(p.url())
        if (ids === null) return fail(`the page opened at ${p.url()}, which names no space and page`)
        const [, spaceID, pageID] = ids

        // Share, and read the link signed out.
        await p.getByRole('button', { name: 'Share', exact: true }).click({ timeout: ACTION_TIMEOUT_MS })
        const box = p.getByRole('textbox', { name: 'Link to this page' })
        if (!(await box.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS }).then(() => true, () => false))) {
          return fail(`Share showed no link: ${(await p.getByRole('alert').allInnerTexts().catch(() => [])).join(' ') || 'nothing said'}`)
        }
        const link = await box.inputValue()
        const signed = /\/docs\/s\/([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(link)
        if (signed === null) return fail(`the link ${JSON.stringify(link)} is not a signed token (nonce.signature) under /docs/s/`)
        const [, nonce, sig] = signed
        const origin = new URL(link).origin
        const tampered = `${nonce}.${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}`
        const unknown = `s1_${createHash('sha256').update(`${seed}${RUN_SALT}${Date.now()}`).digest('hex').slice(0, 32)}.${sig}`
        ctx.evidence.push({ note: `Share gave ${link}; one signature character changed: ${tampered}; a link Docs never made: ${unknown}` })
        await shoot(p, 'link')

        const reader = await stranger.newPage()
        const live = await reader.goto(link)
        await reader.getByRole('heading', { level: 1, name: title }).waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS }).catch(() => undefined)
        const read = (await reader.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ')
        await shoot(reader, 'page')
        ctx.evidence.push({ note: `signed out, ${link} answered ${live?.status()}: "${read.slice(0, 200)}"` })
        if (live?.status() !== 200) return fail(`a stranger opening the share link got ${live?.status()}, not 200`)
        if (!read.includes(word)) return fail(`the shared page does not hold the page's word ${word}: "${read.slice(0, 200)}"`)

        const changed = await reader.goto(`${origin}/docs/s/${tampered}`)
        const gone = await reader.getByRole('heading', { level: 1, name: 'This page isn’t available' }).waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS }).then(() => true, () => false)
        const shown = (await reader.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ')
        await shoot(reader, 'refused')
        const apiChanged = await from(reader, 'GET', `/api/public/docs/${tampered}`)
        const apiUnknown = await from(reader, 'GET', `/api/public/docs/${unknown}`)
        ctx.evidence.push({ note: `the changed link answered ${changed?.status()} (its read ${apiChanged.status} ${apiChanged.text.trim()}); the unknown one's read ${apiUnknown.status} ${apiUnknown.text.trim()}; the page ${gone ? 'says it is not there' : `shows "${shown.slice(0, 160)}"`}` })
        if (changed?.status() !== 404) return fail(`the link with one signature character changed answered ${changed?.status()}, not 404`)
        if (apiChanged.status !== 404 || apiUnknown.status !== 404) return fail(`Docs read the changed link as ${apiChanged.status} and an unknown one as ${apiUnknown.status}; both must be 404`)
        if (apiChanged.text !== apiUnknown.text) return fail(`the changed link's 404 (${apiChanged.text.trim()}) differs from an unknown link's (${apiUnknown.text.trim()}), so the refusal tells the two apart`)
        if (!gone || shown.includes(word)) return fail(`the changed link's page ${shown.includes(word) ? `still shows the page's word ${word}` : 'does not say the page is not there'}`)

        // An edit on the live-edit socket, closed straight after Docs acknowledged it.
        const content = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `${text} then logs ${edit}.` }] }] })
        const sent = await p.evaluate(async ({ pageID, content }) => new Promise<string>((resolve) => {
          const ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/api/docs/collab/${encodeURIComponent(pageID)}/ws?client_id=e2e-${Date.now()}&member_name=Tester`)
          const timer = setTimeout(() => { ws.close(); resolve('no answer from Docs in 15 s') }, 15_000)
          ws.onopen = () => ws.send(JSON.stringify({ type: 'change', change: { version: 0, ops: [], snapshot: content } }))
          ws.onmessage = (e) => {
            const m = JSON.parse(String(e.data)) as { type: string; reason?: string }
            if (m.type !== 'ack' && m.type !== 'change_rejected') return
            clearTimeout(timer)
            ws.close()
            resolve(m.type === 'ack' ? 'ack' : `refused: ${m.reason ?? ''}`)
          }
          ws.onerror = () => { clearTimeout(timer); resolve('the socket did not open') }
        }), { pageID, content })
        const closed = Date.now()
        if (sent !== 'ack') return fail(`the edit on the live-edit socket was not acknowledged: ${sent}`)
        const stored = async () => readFrom<DocsPageRead>(p, `/api/docs/spaces/${spaceID}/pages/${pageID}`)
        const back = await until(stored, (x) => typeof x !== 'string' && x.content_text.includes(edit), 15_000)
        ctx.evidence.push({ note: `the socket closed on Docs' ack; ${Date.now() - closed} ms later the page reads: ${typeof back === 'string' ? back : `"${back.content_text.slice(0, 200)}"`}` })
        if (typeof back === 'string') return fail(back)
        if (!back.content_text.includes(edit)) return fail(`the edit acknowledged on the socket and closed before the autosave tick is not in the page: "${back.content_text.slice(0, 200)}"`)
        ctx.evidence.push({ note: `screenshots ${shots.join(', ')}` })
        return { pass: true, detail: `a stranger read the shared page (it holds ${word}); one signature character changed was 404, the same 404 as a link Docs never made; the edit holding ${edit}, closed on its ack, was in the page read back` }
      } finally {
        await stranger.close()
        await doc.close()
      }
    },
  }
}

/** The address a synthetic user signs in with (apps/bff/synthetic.go): Docs and Track know them by it. */
const syntheticEmail = (u: SyntheticUser): string => `${u.workspaceID}@synthetic.talyvor.invalid`

/**
 * B28.450 — what B28.446 shipped in talyvor-docs, through the app. Alice puts Bob and Carol on her workspace's roster,
 * makes a private space and page, and on the page's Share with a team makes a team, puts Bob on it and gives it edit.
 * Bob's edit of the page is saved and reads back; Carol, in the workspace but not on the team, is refused, and cannot
 * put herself on Alice's team; and once Alice takes Bob off the team, his next edit is refused too.
 */
export function docsTeamGrant(seed: number): Scenario {
  const space = `Private plans ${seed}${RUN_SALT}`
  const title = `Launch checklist ${seed}`
  const team = `Reviewers ${seed}${RUN_SALT}`
  const edited = `Checked by Bob ${seed}${RUN_SALT}`
  return {
    id: 'docs-team-grant',
    owner: 'talyvor-docs',
    items: ['B28.446', 'B28.450'],
    // Bob and Carol take two of Team's five seats; Free holds one.
    plan: 'team',
    title: 'Docs: a team given edit on a private page lets its member edit it, a workspace member off the team is refused and cannot join it, and taking the member off takes the access away',
    run: async (ctx) => {
      const { env, app } = ctx
      if (env.userCount < 3) throw new CannotTest(`needs two other users for Bob and Carol; the run has ${env.userCount}`)
      const [bobAt, carolAt] = [(app.user.index + 1) % env.userCount, (app.user.index + 2) % env.userCount]
      const [bobEmail, carolEmail] = [syntheticEmail(env.userAt(bobAt)), syntheticEmail(env.userAt(carolAt))]
      const p = await app.tab('/docs')
      const shots: string[] = []
      const shoot = async (name: string): Promise<void> => {
        await mkdir(ctx.env.outDir, { recursive: true })
        const was = p.viewportSize()
        for (const [width, height] of [[1440, 900], [390, 844]]) {
          await p.setViewportSize({ width, height })
          const file = join(ctx.env.outDir, `docs-team-${name}-${width}px-user${app.user.index}.png`)
          await p.screenshot({ path: file, fullPage: true })
          shots.push(file)
        }
        if (was !== null) await p.setViewportSize(was)
      }
      const bob = await env.signInUser(bobAt)
      const carol = await env.signInUser(carolAt).catch(async (e: unknown) => {
        await bob.close()
        throw e
      })
      try {
        // Bob and Carol join Alice's workspace, as Members adds people.
        for (const email of [bobEmail, carolEmail]) {
          const added = await from(p, 'POST', '/api/members', { email, role: 'member' })
          ctx.evidence.push({ note: `Alice adds ${email} on Members: ${added.status} ${added.text.slice(0, 160)}` })
          if (added.status !== 201 && added.status !== 409) throw new Error(`adding ${email} to Alice's roster answered ${added.status} ${added.text.slice(0, 200)}`)
        }
        const roster = await readFrom<{ id: string; email: string }[]>(p, '/api/members')
        if (typeof roster === 'string') throw new Error(roster)
        const carolID = roster.find((m) => m.email === carolEmail)?.id
        if (carolID === undefined) throw new Error(`Alice's roster does not list Carol (${carolEmail}): ${roster.map((m) => m.email).join(', ')}`)

        // A private space and a page in it.
        await p.getByLabel('Space name').fill(space)
        await p.getByLabel(/^Private/).check()
        await p.getByRole('button', { name: 'Create space' }).click()
        await p.getByRole('link', { name: `Open space ${space}` }).click({ timeout: ACTION_TIMEOUT_MS })
        await p.getByLabel('Page title').fill(title)
        await p.getByRole('button', { name: 'Create page' }).click()
        await p.getByRole('link', { name: title, exact: true }).first().click({ timeout: ACTION_TIMEOUT_MS })
        await p.waitForURL(/\/docs\/spaces\/[^/]+\/pages\/[^/?#]+/, { timeout: ACTION_TIMEOUT_MS })
        const ids = /\/docs\/spaces\/([^/]+)\/pages\/([^/?#]+)/.exec(p.url())
        if (ids === null) return fail(`the page opened at ${p.url()}, which names no space and page`)
        const [, spaceID, pageID] = ids
        const pagePath = `/api/docs/spaces/${spaceID}/pages/${pageID}`
        const titleNow = async (): Promise<string> => {
          const r = await readFrom<DocsPageRead>(p, pagePath)
          if (typeof r === 'string') throw new Error(r)
          return r.title
        }
        const edit = async (who: AppUser, to: string) => (await from(who.page, 'PATCH', pagePath, { title: to })).status

        // Share with a team: make it, put Bob on it, give it edit.
        await p.getByRole('button', { name: 'Share with a team' }).click({ timeout: ACTION_TIMEOUT_MS })
        await p.getByLabel('Team name').fill(team)
        await p.getByRole('button', { name: 'Create team' }).click()
        const pick = p.getByRole('combobox', { name: `Add a member to ${team}` })
        await pick.waitFor({ timeout: ACTION_TIMEOUT_MS })
        await p.getByRole('option', { name: bobEmail }).waitFor({ state: 'attached', timeout: ACTION_TIMEOUT_MS })
        await pick.selectOption({ label: bobEmail })
        await p.getByRole('button', { name: `Add to ${team}` }).click()
        const removeBob = p.getByRole('button', { name: `Remove ${bobEmail} from ${team}` })
        const onTeam = await removeBob.waitFor({ timeout: ACTION_TIMEOUT_MS }).then(() => true, () => false)
        if (!onTeam) return fail(`Bob was not put on ${team}: ${(await p.getByRole('alert').allInnerTexts().catch(() => [])).join(' ') || 'nothing said'}`)
        await p.getByRole('combobox', { name: `Access for ${team}` }).selectOption('edit')
        await p.getByRole('button', { name: `Give access to ${team}` }).click()
        const granted = await p.getByText('can edit this page').waitFor({ timeout: ACTION_TIMEOUT_MS }).then(() => true, () => false)
        await shoot('granted')
        if (!granted) return fail(`giving ${team} edit was not shown as given: ${(await p.getByRole('alert').allInnerTexts().catch(() => [])).join(' ') || 'nothing said'}`)
        const teams = await readFrom<{ id: string; name: string; members: string[] }[]>(p, '/api/docs/teams')
        if (typeof teams === 'string') throw new Error(teams)
        const made = teams.find((t) => t.name === team)
        if (made === undefined) return fail(`Docs lists no team ${team} after Create team: ${teams.map((t) => t.name).join(', ')}`)

        // Bob, on the team, edits the page; Carol, off it, cannot, and cannot put herself on it.
        await bob.page.goto(`${new URL(p.url()).origin}/docs`)
        await carol.page.goto(`${new URL(p.url()).origin}/docs`)
        const bobs = await edit(bob, edited)
        const read = await titleNow()
        ctx.evidence.push({ note: `on ${team} with edit, Bob's PATCH of ${pagePath}: ${bobs}; the title reads "${read}"` })
        if (bobs !== 200) return fail(`Bob, on a team given edit, could not edit the page: PATCH answered ${bobs}`)
        if (read !== edited) return fail(`Bob's edit was answered 200 and the title reads "${read}", not "${edited}"`)
        const carols = await edit(carol, `Changed by Carol ${seed}`)
        const join = await from(carol.page, 'PUT', `/api/docs/teams/${encodeURIComponent(made.id)}/members/${encodeURIComponent(carolID)}`)
        const after = await readFrom<{ id: string; members: string[] }[]>(p, '/api/docs/teams')
        const still = typeof after === 'string' ? after : after.find((t) => t.id === made.id)?.members ?? []
        ctx.evidence.push({ note: `Carol, in the workspace and off the team: PATCH ${carols}; putting herself on ${team}: ${join.status} ${join.text.slice(0, 160)}; on the team now: ${JSON.stringify(still)}` })
        if (carols !== 403) return fail(`Carol, not on the team, editing the private page answered ${carols}, not 403`)
        if (join.status !== 403 && join.status !== 404) return fail(`Carol putting herself on Alice's team answered ${join.status}, not a refusal`)
        if (typeof still === 'string' || still.includes(carolID)) return fail(`Carol's own add was refused, yet ${team} reads ${JSON.stringify(still)}`)
        if (await titleNow() !== edited) return fail(`Carol's refused edit changed the title to "${await titleNow()}"`)

        // Alice takes Bob off the team, and his access goes with it.
        await removeBob.click()
        const off = await removeBob.waitFor({ state: 'detached', timeout: ACTION_TIMEOUT_MS }).then(() => true, () => false)
        if (!off) return fail(`Remove did not take Bob off ${team}: ${(await p.getByRole('alert').allInnerTexts().catch(() => [])).join(' ') || 'nothing said'}`)
        await shoot('removed')
        const again = await edit(bob, `Edited again by Bob ${seed}`)
        const last = await titleNow()
        ctx.evidence.push({ note: `Bob taken off ${team}: his PATCH ${again}; the title reads "${last}"; screenshots ${shots.join(', ')}` })
        if (again !== 403) return fail(`Bob, taken off the team, could still edit the page: PATCH answered ${again}, not 403`)
        if (last !== edited) return fail(`Bob's refused edit changed the title to "${last}"`)
        return { pass: true, detail: `Bob on ${team} (edit) edited the private page and it reads "${edited}"; Carol off the team was refused (403) and her own add to it was refused (${join.status}); off the team, Bob was refused (403)` }
      } finally {
        await carol.close().catch(() => undefined)
        await bob.close().catch(() => undefined)
        await p.close().catch(() => undefined)
      }
    },
  }
}

async function saved(p: Page): Promise<void> {
  await p.getByRole('button', { name: 'Save', exact: true }).click()
  await p.getByRole('status').filter({ hasText: 'Saved.' }).last().waitFor({ timeout: 15_000 }).catch(() => undefined)
}

// ─── Lens, through the app: Chat's feedback and tools, stored answers, switches and keys ───

/** One of Lens's answers to the person's own token: `GET /v1/workspaces/{ws}…` read straight from Lens. */
async function lensRead<T>(ctx: { env: { lens: LensClient }; app: { user: SyntheticUser } }, path: string): Promise<Answered<T>> {
  return ctx.env.lens.act<T>(ctx.app.user, 'GET', path)
}

interface StoredCounts { shared_answers: number; private_answers: number; shared_conversions: number; private_conversions: number; cached_copies?: number; confirm_with?: string }

/**
 * Chat's Wrong answer, and deleting what Lens stored. A question asked twice is served the second time from the earlier
 * answer; marked wrong there, Lens no longer serves it: asked again in a new chat it goes to the model and is charged
 * (one spend row). Then Features' "Delete everything stored…", confirmed with the workspace's name: Lens holds no
 * answer and no conversion for this workspace.
 */
export function wrongAnswerStored(seed: number): Scenario {
  const a = 101 + (seed * 37 + RUN_SALT) % 800
  const b = 101 + (seed * 53 + RUN_SALT) % 800
  const q = `What is ${a} plus ${b}? Reply with the number only.`
  return {
    id: 'wrong-answer-stored',
    owner: 'talyvor-lens',
    title: 'an answer marked Wrong answer in Chat is not served again (asked again, it is charged); Delete everything stored leaves Lens holding nothing for the workspace',
    run: async (ctx) => {
      const { app } = ctx
      const failures: string[] = []
      const first = await app.ask(q)
      ctx.evidence.push({ question: q, answer: first.answer.slice(0, 200), footer: first.footerText, note: 'first time' })
      await app.newChat()
      const again = await app.ask(q)
      ctx.evidence.push({ question: q, answer: again.answer.slice(0, 200), footer: again.footerText, note: 'again, in a new chat' })
      if (again.footer.kind !== 'cache') return fail(`asked again in a new chat, the answer was not served from the earlier one (${again.footerText}), so there is nothing to mark wrong`)

      const turn = app.page.locator('[data-testid="turn-assistant"]').last()
      await turn.getByRole('button', { name: 'Wrong answer' }).click()
      const marked = await turn.getByTestId('turn-marked').waitFor({ timeout: 15_000 }).then(() => true, () => false)
      if (!marked) return fail(`pressed Wrong answer under the served answer, and Chat never said it was marked: ${(await turn.innerText()).replace(/\s+/g, ' ').slice(0, 200)}`)
      const before = await ctx.env.lens.ledger(app.user)
      await app.newChat()
      const third = await app.ask(q)
      const after = await until(() => ctx.env.lens.ledger(app.user), (rows) => rows.length > before.length, 20_000)
      const fresh = after.filter((r) => !before.some((o) => o.id === r.id))
      ctx.evidence.push({ question: q, answer: third.answer.slice(0, 200), footer: third.footerText, note: `after Wrong answer, in a new chat; new ledger rows ${fresh.map((r) => `${r.type} ${r.amount_ulxc}`).join(', ') || 'none'}` })
      if (third.footer.kind === 'cache' || third.footer.kind === 'pool') failures.push(`marked wrong, the answer was served again (${third.footerText})`)
      else if (!fresh.some((r) => r.type === 'spend')) failures.push(`asked again after Wrong answer, the model's answer (${third.footerText}) has no spend row on the ledger`)

      // Delete everything stored, on Features.
      const f = await FeaturesScreen.open(app)
      try {
        const counts = await readFrom<StoredCounts>(f.page, '/api/features/stored-answers')
        const confirmWith = typeof counts === 'string' ? undefined : counts.confirm_with
        ctx.evidence.push({ note: `stored before: ${typeof counts === 'string' ? counts : JSON.stringify(counts)}` })
        if (confirmWith === undefined) return fail(`the stored answers read names nothing to confirm with: ${typeof counts === 'string' ? counts : JSON.stringify(counts)}`)
        await f.page.getByRole('button', { name: 'Delete everything stored…' }).click()
        await f.page.getByLabel(`Type ${confirmWith} to confirm`).fill(confirmWith)
        await f.page.getByRole('button', { name: 'Delete everything stored', exact: true }).click()
        const said = f.page.getByRole('status').filter({ hasText: /^Deleted \d/ })
        await said.first().waitFor({ timeout: 15_000 }).catch(() => undefined)
        const shown = (await said.count()) > 0 ? (await said.first().innerText()).trim() : 'nothing'
        const left = await lensRead<StoredCounts>(ctx, '/v1/workspaces/{ws}/stored-answers')
        ctx.evidence.push({ note: `Delete everything stored: Features says "${shown}"; Lens holds ${left.ok ? JSON.stringify(left.value) : `refused ${left.status}: ${left.error}`}` })
        if (!left.ok) failures.push(`after the delete Lens answers ${left.status} for what it stores: ${left.error}`)
        else {
          const v = left.value
          if (v.shared_answers + v.private_answers + v.shared_conversions + v.private_conversions !== 0 || (v.cached_copies ?? 0) !== 0) {
            failures.push(`Features says "${shown}", and Lens still holds ${JSON.stringify(v)}`)
          }
        }
      } finally {
        await f.close()
      }
      return failures.length === 0
        ? { pass: true, detail: 'served from the earlier answer, marked wrong, then asked afresh and charged; after Delete everything stored Lens holds nothing for the workspace' }
        : fail(failures.join('; '))
    },
  }
}

/**
 * Chat's tool route takes only the read-only tools Lens offers Chat: the tools it lists are Lens's own wallet reads, a
 * tool that moves money (wallet_send) is refused before Lens is asked, and a read Lens does not offer says so — and the
 * ledger has moved by nothing.
 */
export function chatToolGuard(): Scenario {
  const READ_ONLY = ['wallet_agents_spend', 'get_spend_summary', 'get_cache_stats']
  // B28.374 — Track's and Docs' own tools, which read; and the one that changes something, offered as such and run only
  // on the person's yes (chat-file-bug).
  const PRODUCT_READS = ['search_issues', 'list_issues', 'get_issue', 'search_docs', 'get_page']
  const ON_A_YES = ['create_issue']
  return {
    id: 'chat-tool-guard',
    owner: 'talyvor-suite',
    title: "Chat's tools: only read-only ones are offered, and filing a Track issue only on a yes; one that moves money is refused, and a read Lens lacks says so; nothing moved",
    run: async (ctx) => {
      const { app, env } = ctx
      const failures: string[] = []
      const page = app.page
      const before = await env.lens.ledger(app.user)
      const listed = await readFrom<{ tools: { name: string; writes?: boolean }[] }>(page, '/api/chat/tools')
      if (typeof listed === 'string') return fail(listed)
      const names = listed.tools.map((t) => t.name)
      const lensTools = await env.lens.act<{ result?: { tools?: { name: string }[] } }>(app.user, 'POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
      const lensNames = lensTools.ok ? (lensTools.value.result?.tools ?? []).map((t) => t.name) : []
      ctx.evidence.push({ note: `Chat is offered ${names.join(', ') || 'no tool'}; Lens's MCP lists ${lensTools.ok ? lensNames.length : `refused ${lensTools.status}`} tool(s)` })
      for (const t of listed.tools) {
        if (ON_A_YES.includes(t.name)) {
          if (t.writes !== true) failures.push(`Chat is offered ${t.name} without saying it changes something, so it would run without the person's yes`)
        } else if (!READ_ONLY.includes(t.name) && !PRODUCT_READS.includes(t.name)) failures.push(`Chat is offered ${t.name}, which is not a read-only tool`)
      }
      if (names.includes('create_issue')) {
        const unasked = await from(page, 'POST', '/api/chat/tools/call', { name: 'create_issue', arguments: { title: 'should never be filed' } })
        ctx.evidence.push({ note: `create_issue without the person's yes: ${unasked.status} ${unasked.text.slice(0, 200)}` })
        if (unasked.status !== 409) failures.push(`create_issue without the person's yes answered ${unasked.status} ${refusalOf(unasked.text)}, not refused`)
      }
      for (const n of READ_ONLY) if (lensNames.includes(n) !== names.includes(n)) failures.push(`Lens ${lensNames.includes(n) ? 'offers' : 'does not offer'} ${n}, and Chat ${names.includes(n) ? 'is' : 'is not'} offered it`)

      const send = await from(page, 'POST', '/api/chat/tools/call', { name: 'wallet_send', arguments: { to: '@nobody', amount_ulxc: 1_000_000, memo: 'should never move' } })
      ctx.evidence.push({ note: `wallet_send through Chat's tool route: ${send.status} ${send.text.slice(0, 200)}` })
      if (send.status !== 400) failures.push(`wallet_send through Chat's tool route answered ${send.status} ${refusalOf(send.text)}, not refused`)

      const spend = await from(page, 'POST', '/api/chat/tools/call', { name: 'wallet_agents_spend', arguments: {} })
      const read = parsed<{ text: string; is_error: boolean }>(spend.text)
      ctx.evidence.push({ note: `wallet_agents_spend through Chat's tool route: ${spend.status} ${spend.text.slice(0, 300)}` })
      if (names.includes('wallet_agents_spend')) {
        if (spend.status !== 200 || read === undefined || read.is_error) failures.push(`wallet_agents_spend is offered and answered ${spend.status} ${spend.text.slice(0, 200)}`)
      } else if (spend.status === 200 && read !== undefined && !read.is_error) {
        failures.push(`wallet_agents_spend is not offered, and the route answered it as if it were: ${read.text.slice(0, 200)}`)
      }

      const after = await env.lens.ledger(app.user)
      const moved = after.filter((r) => !before.some((o) => o.id === r.id))
      if (moved.length > 0) failures.push(`the ledger moved during tool calls that move nothing: ${moved.map((r) => `${r.type} ${r.amount_ulxc}`).join(', ')}`)
      return failures.length === 0
        ? { pass: true, detail: `offered ${names.join(', ') || 'no tool'}, as Lens lists them; wallet_send refused; wallet_agents_spend ${spend.status === 200 ? 'answered' : `refused (${spend.status})`}; nothing moved` }
        : fail(failures.join('; '))
    },
  }
}

/**
 * B28.374 — Talyvor's own tools in Chat: "file this as a bug" files a Track issue. Told about a bug and asked to file
 * it, the model drafts a Track issue; Chat asks first, and on File it the issue is filed. The answer links it, Track
 * holds it — read back through /api/track/issues as the Track screen reads it — with the bug's own words, and the link
 * opens it in Track.
 */
export function chatFileBug(seed: number): Scenario {
  return {
    id: 'chat-file-bug',
    owner: 'talyvor-suite',
    items: ['B28.121', 'B28.374'],
    title: '"file this as a bug" in Chat files a Track issue, once the person says yes, and the answer links it',
    run: async (ctx) => {
      const { app, env } = ctx
      const { page } = app
      const word = freshWord(seed * 10 + 7, 1 + Math.floor(Math.random() * 999_999))
      const before = await readFrom<{ id: string }[]>(page, '/api/track/issues?limit=100')
      if (typeof before === 'string') return fail(`Track could not be read before filing: ${before}`)
      await app.newChat()
      // The card comes up while the answer waits for it; File it is pressed as soon as it does.
      const card = page.getByTestId('tool-confirm')
      let drafted: string | undefined
      const asking = [1440, 390].map((w) => join(env.outDir, `chat-file-bug-asks-${w}px-user${app.user.index}.png`))
      const pressed = card.waitFor({ state: 'visible', timeout: 120_000 }).then(async () => {
        drafted = (await card.getByTestId('tool-confirm-title').innerText().catch(() => '')).trim()
        const was = page.viewportSize()
        await mkdir(env.outDir, { recursive: true })
        for (const [i, [width, height]] of [[1440, 900], [390, 844]].entries()) {
          await page.setViewportSize({ width, height })
          await card.scrollIntoViewIfNeeded()
          await page.screenshot({ path: asking[i] })
        }
        if (was !== null) await page.setViewportSize(was)
        await card.getByRole('button', { name: 'File it' }).click()
      }).catch(() => undefined)
      const t = await app.ask(`The CSV export of the ${word} report on Spend downloads an empty file. File this as a bug.`)
      ctx.evidence.push({ question: t.question, answer: t.answer.slice(0, 500), footer: t.footerText, error: t.error })
      if (t.error !== undefined) return fail(`refused: ${t.error}`)
      if (drafted === undefined) {
        void pressed
        return fail(`Chat never asked to file anything: the model did not call Track's create_issue, or it was not offered (answer "${t.answer.slice(0, 160)}")`)
      }
      ctx.evidence.push({ note: `the card asked to file "${drafted}"; at 1440px: ${asking[0]}; at 390px: ${asking[1]}` })
      const turn = page.locator('[data-testid="turn-assistant"]').last()
      const link = turn.getByTestId('turn-filed-issue').first()
      if (!(await link.isVisible().catch(() => false))) return fail(`File it was pressed, and the answer links no issue: "${t.answer.slice(0, 200)}"`)
      const href = (await link.getAttribute('href')) ?? ''
      const id = decodeURIComponent(/^\/track\/issues\/([^/?#]+)$/.exec(href)?.[1] ?? '')
      const shown = (await link.innerText()).trim()
      ctx.evidence.push({ note: `the answer links ${JSON.stringify(shown)} → ${href}` })
      if (id === '') return fail(`the filed issue links to ${JSON.stringify(href)}, not to an issue in Track`)

      const viewport = page.viewportSize()
      await mkdir(env.outDir, { recursive: true })
      const wide = join(env.outDir, `chat-file-bug-1440px-user${app.user.index}.png`)
      const narrow = join(env.outDir, `chat-file-bug-390px-user${app.user.index}.png`)
      await page.setViewportSize({ width: 1440, height: 900 })
      await link.scrollIntoViewIfNeeded()
      await page.screenshot({ path: wide })
      await page.setViewportSize({ width: 390, height: 844 })
      await link.scrollIntoViewIfNeeded()
      await page.screenshot({ path: narrow })
      if (viewport !== null) await page.setViewportSize(viewport)
      ctx.evidence.push({ note: `the filed issue at 1440px: ${wide}; at 390px: ${narrow}` })

      // Track's own record of it, read as the Track screen reads it.
      const after = await readFrom<{ id: string; identifier: string; title: string; description?: string }[]>(page, '/api/track/issues?limit=100')
      if (typeof after === 'string') return fail(`Track could not be read after filing: ${after}`)
      const issue = after.find((i) => i.id === id)
      if (issue === undefined || before.some((i) => i.id === id)) {
        return fail(`the answer links ${shown}, and Track's issues hold ${issue === undefined ? 'no issue with that id' : 'it from before this question'} (${after.length} issue(s))`)
      }
      const words = `${issue.title} ${issue.description ?? ''}`
      ctx.evidence.push({ note: `Track holds ${issue.identifier}: ${JSON.stringify(words.slice(0, 300))}` })
      if (!words.toLowerCase().includes(word)) return fail(`Track holds ${issue.identifier}, but neither its title nor its description names the ${word} report: ${JSON.stringify(words.slice(0, 200))}`)
      if (!shown.includes(issue.identifier)) return fail(`the answer links ${JSON.stringify(shown)}, and Track filed it as ${issue.identifier}`)

      // The link's own address, in a tab of its own: the conversation stays open for the questions after this one.
      const tab = await page.context().newPage()
      let opened = false
      try {
        await tab.goto(new URL(href, page.url()).toString())
        opened = await tab.getByText(issue.title, { exact: false }).first().waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false)
        ctx.evidence.push({ note: `the link opened ${tab.url()}${opened ? ', showing the issue' : ', without the issue on it'}` })
      } finally {
        await tab.close().catch(() => undefined)
      }
      if (!opened) return fail(`the link to ${issue.identifier} opened ${href} without the issue's title on it`)
      return { pass: true, detail: `asked first, then filed as ${issue.identifier} ("${issue.title.slice(0, 80)}") in Track, linked under the answer, and the link opens it` }
    },
  }
}

/**
 * B28.122 — external MCP connectors: Talyvor test tools added on Connectors, and asked for the fingerprint of a fresh
 * word, the model calls the connector's fingerprint tool; Chat asks first, and on Allow it runs through the BFF. The
 * answer gives the fingerprint — the first
 * 12 hex digits of the word's SHA-256, which no model can work out — and under it the call is listed on its connector
 * with what it cost: the request that read the tool's answer, a spend row in the ledger. The connector is removed after.
 */
export function chatConnectors(seed: number): Scenario {
  const CONNECTOR = 'Talyvor test tools'
  return {
    id: 'chat-connectors',
    owner: 'talyvor-suite',
    items: ['B28.122'],
    title: "a connector's test tool is called in Chat, and under the answer the call's cost is shown: a spend row in the ledger",
    run: async (ctx) => {
      const { app, env } = ctx
      const { page } = app
      const word = freshWord(seed * 10 + 3, 1 + Math.floor(Math.random() * 999_999))
      const expected = createHash('sha256').update(word).digest('hex').slice(0, 12)
      let added = false
      try {
        if (new URL(page.url()).pathname !== '/chat') await app.openChat()
        await page.getByRole('link', { name: 'Connectors' }).first().click()
        const connector = page.getByTestId('connector-card').filter({ hasText: CONNECTOR })
        const add = page.getByRole('button', { name: `Add ${CONNECTOR}` })
        await connector.or(add).first().waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS })
        if (await add.isVisible()) {
          await add.click()
          added = true
        }
        await connector.or(page.getByTestId('connectors-said')).first().waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS }).catch(() => undefined)
        const tools = (await connector.getByTestId('connector-tools').innerText({ timeout: ACTION_TIMEOUT_MS }).catch(() => '')).trim()
        const said = (await page.getByTestId('connectors-said').innerText().catch(() => '')).trim()
        ctx.evidence.push({ note: `Connectors: "${said.slice(0, 200)}"; ${CONNECTOR} lists "${tools.slice(0, 200)}"` })
        if (!tools.includes('fingerprint')) return fail(`${CONNECTOR} was not added with its fingerprint tool: "${(said || tools).slice(0, 200)}"`)
        const was = page.viewportSize()
        await mkdir(env.outDir, { recursive: true })
        const pageShots = [1440, 390].map((w) => join(env.outDir, `chat-connectors-page-${w}px-user${app.user.index}.png`))
        for (const [i, [width, height]] of [[1440, 900], [390, 844]].entries()) {
          await page.setViewportSize({ width, height })
          await page.screenshot({ path: pageShots[i], fullPage: true })
        }
        if (was !== null) await page.setViewportSize(was)
        ctx.evidence.push({ note: `Connectors with ${CONNECTOR} at 1440px: ${pageShots[0]}; at 390px: ${pageShots[1]}` })
        await page.getByRole('link', { name: 'Back to Chat' }).click()
        await page.locator('#chat-message').waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS })
        await app.newChat()

        const seen = new Set((await env.lens.ledger(app.user)).map((r) => r.id))
        // Every connector call is put to the person first; Allow is pressed as soon as the card asks.
        const asking = page.getByTestId('tool-confirm')
        let asked: string | undefined
        const allowed = asking.waitFor({ state: 'visible', timeout: 120_000 }).then(async () => {
          asked = (await asking.getByRole('heading').innerText().catch(() => '')).trim()
          await asking.getByRole('button', { name: 'Allow', exact: true }).click()
        }).catch(() => undefined)
        const t = await app.ask(`What is the fingerprint of the text "${word}"? Use the fingerprint tool from ${CONNECTOR} and give me exactly what it returns.`)
        ctx.evidence.push({ question: t.question, answer: t.answer.slice(0, 400), footer: t.footerText, error: t.error, note: `the card asked "${asked ?? 'nothing'}"` })
        if (t.error !== undefined) return fail(`refused: ${t.error}`)
        if (asked === undefined) {
          void allowed
          return fail(`Chat never asked before a connector call: the model did not call ${CONNECTOR}' fingerprint, it was not offered, or it ran unasked ("${t.answer.slice(0, 160)}")`)
        }
        if (asked !== `Let Chat use fingerprint in ${CONNECTOR}?`) return fail(`the card asked "${asked}", not to use fingerprint in ${CONNECTOR}`)
        const call = page.locator('[data-testid="turn-assistant"]').last().getByTestId('turn-connector-call').first()
        if (!(await call.isVisible().catch(() => false))) {
          return fail(`the answer lists no connector call: the model did not call ${CONNECTOR}' fingerprint, or it was not offered ("${t.answer.slice(0, 160)}")`)
        }
        const listed = (await call.innerText()).trim()
        const cost = (await call.getByTestId('turn-connector-cost').innerText()).trim()
        ctx.evidence.push({ note: `under the answer: "${listed}"` })
        if (!listed.includes(`fingerprint on ${CONNECTOR}`) || listed.includes('did not answer')) return fail(`the call under the answer reads "${listed}"`)
        if (!t.answer.toLowerCase().includes(expected)) return fail(`the answer does not give ${expected}, the fingerprint of ${word}: "${t.answer.slice(0, 200)}"`)

        // The money: each request the question took wrote a spend row, and the call's cost is the row of the one that
        // read the tool's answer — or, while Lens does not say what it charged (talyvor-lens B28.102), its estimate.
        let fresh: LedgerRow[] = []
        for (let tries = 0; tries < 10 && fresh.length < 2; tries++) {
          if (tries > 0) await page.waitForTimeout(1_000)
          fresh = (await env.lens.ledger(app.user)).filter((r) => !seen.has(r.id) && r.type === 'spend')
        }
        ctx.evidence.push({ note: `the call's cost: ${cost}; the spend rows the question wrote`, ledger: fresh.map((r) => ({ type: r.type, amount_ulxc: r.amount_ulxc, created_at: r.created_at })) })
        if (fresh.length < 2) return fail(`the question took a request that called the tool and one that read its answer, and wrote ${fresh.length} spend row(s)`)
        const charged = /^([\d,.]+) LXC charged$/.exec(cost)
        if (charged !== null) {
          const ulxc = Math.round(Number(charged[1].replace(/,/g, '')) * 1e6)
          if (!fresh.some((r) => -r.amount_ulxc === ulxc)) {
            return fail(`the call's cost is shown as ${cost}, and no spend row the question wrote is ${ulxc} µLXC: ${fresh.map((r) => r.amount_ulxc).join(', ')}`)
          }
        } else if (!/^≈ \$?[\d,.]+( LXC)?$/.test(cost) || /^≈ \$?0( LXC)?$/.test(cost)) {
          return fail(`the call's cost reads "${cost}", not a figure`)
        }

        const viewport = page.viewportSize()
        await mkdir(env.outDir, { recursive: true })
        const shots = [1440, 390].map((w) => join(env.outDir, `chat-connectors-${w}px-user${app.user.index}.png`))
        for (const [i, [width, height]] of [[1440, 900], [390, 844]].entries()) {
          await page.setViewportSize({ width, height })
          await call.scrollIntoViewIfNeeded()
          await page.screenshot({ path: shots[i] })
        }
        if (viewport !== null) await page.setViewportSize(viewport)
        ctx.evidence.push({ note: `the answer and its connector call at 1440px: ${shots[0]}; at 390px: ${shots[1]}` })
        return {
          pass: true,
          detail: `${CONNECTOR}' fingerprint called for ${word}: ${expected}, in the answer; the call's cost shown as ${cost}, ` +
            (charged !== null ? `a spend row of that amount among the ${fresh.length} the question wrote` : `the estimate, while Lens does not say its charge; the question wrote ${fresh.length} spend rows`),
        }
      } finally {
        // Out of this browser again: a connector this scenario added is removed, so the next question is not offered it.
        if (added) {
          await page.getByRole('link', { name: 'Connectors' }).first().click().catch(() => undefined)
          const connector = page.getByTestId('connector-card').filter({ hasText: CONNECTOR })
          await connector.getByRole('button', { name: 'Remove' }).click({ timeout: ACTION_TIMEOUT_MS }).catch(() => undefined)
          await connector.waitFor({ state: 'detached', timeout: ACTION_TIMEOUT_MS }).catch(() => undefined)
          await page.getByRole('link', { name: 'Back to Chat' }).click().catch(() => undefined)
        }
        await page.locator('#chat-message').waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS }).catch(() => undefined)
        await app.newChat().catch(() => undefined)
      }
    },
  }
}

/**
 * B28.375 — a Docs page attached as context. A page written in Docs holds a sentence with a fresh word in it; in Chat,
 * Docs page lists it, and picked, it goes with the question. Asked to quote the sentence that mentions the word, the
 * answer quotes the page — words the model can only have read there — and under the question the page is named and
 * linked to itself in Docs.
 */
export function chatDocsPage(seed: number): Scenario {
  return {
    id: 'chat-docs-page',
    owner: 'talyvor-suite',
    items: ['B28.123', 'B28.375'],
    title: 'a Docs page attached in Chat goes with the question, and the answer quotes it',
    run: async (ctx) => {
      const { app, env } = ctx
      const { page } = app
      const word = freshWord(seed * 10 + 5, 1 + Math.floor(Math.random() * 999_999))
      // Named for this attempt's word, so a second attempt's space and page are not taken for the first's.
      const space = `Runbooks ${word}`
      const title = `Deploy freeze ${word}`
      const sentence = `Deploys freeze at four on the afternoon of the ${word} review`
      const doc = await DocsPage.write(app, space, title, `${sentence}. Ask the release lead before then.`)
      const ids = /\/docs\/spaces\/([^/]+)\/pages\/([^/?#]+)/.exec(doc.page.url())
      await doc.page.close()
      if (ids === null) return fail(`the page was written at ${doc.page.url()}, which names no space and page`)
      const [, spaceID, pageID] = ids
      try {
        if (new URL(page.url()).pathname !== '/chat') await app.openChat()
        await app.newChat()
        await page.getByRole('button', { name: 'Docs page' }).click()
        const panel = page.getByRole('dialog', { name: 'Attach a Docs page' })
        const spaces = panel.getByRole('group', { name: 'Docs spaces' })
        await panel.getByRole('list', { name: 'Docs pages' }).or(panel.getByRole('alert')).or(spaces).first().waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS })
        if (await spaces.isVisible()) await spaces.getByRole('button', { name: space, exact: true }).click()
        await panel.getByRole('textbox', { name: 'Filter pages' }).fill(title)
        const listed = panel.getByRole('list', { name: 'Docs pages' }).getByRole('button', { name: title, exact: true })
        if (!(await listed.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS }).then(() => true, () => false))) {
          return fail(`Docs page does not list "${title}" in ${space}: "${(await panel.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200)}"`)
        }
        const was = page.viewportSize()
        await mkdir(env.outDir, { recursive: true })
        const picking = [1440, 390].map((w) => join(env.outDir, `chat-docs-page-picker-${w}px-user${app.user.index}.png`))
        for (const [i, [width, height]] of [[1440, 900], [390, 844]].entries()) {
          await page.setViewportSize({ width, height })
          await page.screenshot({ path: picking[i] })
        }
        if (was !== null) await page.setViewportSize(was)
        ctx.evidence.push({ note: `Docs page listing "${title}" at 1440px: ${picking[0]}; at 390px: ${picking[1]}` })
        await listed.click()
        const chip = page.getByRole('list', { name: 'Attached documents' }).getByText(title, { exact: true })
        const attached = await chip.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS }).then(() => true, () => false)
        if (!attached) return fail(`"${title}" was picked, and it is not attached: ${(await page.getByRole('alert').allInnerTexts()).join(' ') || 'nothing said'}`)

        const t = await app.ask(`Quote the sentence in the attached page that mentions ${word}.`)
        ctx.evidence.push({ question: t.question, answer: t.answer.slice(0, 500), footer: t.footerText, error: t.error, note: `attached the Docs page "${title}"` })
        if (t.error !== undefined) return fail(`refused: ${t.error}`)
        const link = page.locator('[data-testid="turn-user"]').last().getByTestId('sent-docs-page')
        const href = (await link.getAttribute('href').catch(() => null)) ?? ''
        ctx.evidence.push({ note: `under the question: ${JSON.stringify((await link.innerText().catch(() => '')).trim())} → ${href}` })
        if (href !== `/docs/spaces/${spaceID}/pages/${pageID}`) return fail(`the question does not link the page it carried: ${JSON.stringify(href)}`)
        const flat = (x: string) => x.replace(/\s+/g, ' ').toLowerCase()
        if (!flat(t.answer).includes(flat(sentence))) return fail(`the answer does not quote the page's sentence "${sentence}": "${t.answer.slice(0, 200)}"`)

        const viewport = page.viewportSize()
        await mkdir(env.outDir, { recursive: true })
        const shots = [1440, 390].map((w) => join(env.outDir, `chat-docs-page-${w}px-user${app.user.index}.png`))
        for (const [i, [width, height]] of [[1440, 900], [390, 844]].entries()) {
          await page.setViewportSize({ width, height })
          await link.scrollIntoViewIfNeeded()
          await page.screenshot({ path: shots[i] })
        }
        if (viewport !== null) await page.setViewportSize(viewport)
        ctx.evidence.push({ note: `the question with its page, and the answer, at 1440px: ${shots[0]}; at 390px: ${shots[1]}` })
        return { pass: true, detail: `"${title}" attached from Docs; the answer quotes "${sentence}", and the question links the page` }
      } finally {
        await app.newChat().catch(() => undefined)
      }
    },
  }
}

/**
 * B28.127 — a revocable share link. A question asked afresh in a new chat, then Share and Create link beside the chat's
 * name: a stranger with no session opens the link and reads the question and its answer (HTTP 200), and the person's
 * Turn off link takes it away — the stranger's next visit to the same link is answered 404 at the door, the page says the
 * chat is not there, and the read behind it is 404 too.
 */
export function chatShareLink(seed: number): Scenario {
  return {
    id: 'chat-share-link',
    owner: 'talyvor-suite',
    items: ['B28.127'],
    title: 'a chat shared as a link is read signed out, and returns 404 once the link is turned off',
    run: async (ctx) => {
      const { app, env } = ctx
      const { page } = app
      const browser = app.context.browser()
      if (browser === null) throw new CannotTest('no browser to open a signed-out context in')
      const word = freshWord(seed * 10 + 7, 1 + Math.floor(Math.random() * 999_999))
      if (new URL(page.url()).pathname !== '/chat') await app.openChat()
      await app.newChat()
      const t = await app.ask(`Reply with the word ${word} and nothing else.`)
      ctx.evidence.push({ question: t.question, answer: t.answer.slice(0, 200), footer: t.footerText, error: t.error })
      if (t.error !== undefined) return fail(`refused: ${t.error}`)
      const stranger = await browser.newContext()
      try {
        await page.getByRole('button', { name: 'Share', exact: true }).click({ timeout: ACTION_TIMEOUT_MS })
        const panel = page.getByRole('region', { name: 'Share this chat' })
        await panel.getByRole('button', { name: 'Create link' }).or(panel.getByRole('alert')).first().waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS })
        if (await panel.getByRole('alert').isVisible()) return fail(`Share says: ${(await panel.getByRole('alert').innerText()).trim()}`)
        await panel.getByRole('button', { name: 'Create link' }).click()
        const box = panel.getByRole('textbox', { name: 'Link to this chat' })
        if (!(await box.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS }).then(() => true, () => false))) {
          return fail(`Create link showed no link: ${(await panel.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200)}`)
        }
        const link = await box.inputValue()
        const token = /\/share\/([A-Za-z0-9_-]+)$/.exec(link)?.[1]
        if (token === undefined) return fail(`the link ${JSON.stringify(link)} is not an address under /share/`)
        ctx.evidence.push({ note: `Create link gave ${link}` })
        await mkdir(env.outDir, { recursive: true })
        const shots: string[] = []
        const was = page.viewportSize()
        for (const [width, height] of [[1440, 900], [390, 844]]) {
          await page.setViewportSize({ width, height })
          await panel.scrollIntoViewIfNeeded()
          const file = join(env.outDir, `chat-share-link-panel-${width}px-user${app.user.index}.png`)
          await page.screenshot({ path: file })
          shots.push(file)
        }
        if (was !== null) await page.setViewportSize(was)

        const reader = await stranger.newPage()
        const first = await reader.goto(link)
        const opened = await reader.getByTestId('shared-turn-assistant').first().waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS }).then(() => true, () => false)
        const read = (await reader.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ')
        for (const [width, height] of [[1440, 900], [390, 844]]) {
          await reader.setViewportSize({ width, height })
          const file = join(env.outDir, `chat-share-link-page-${width}px-user${app.user.index}.png`)
          await reader.screenshot({ path: file, fullPage: true })
          shots.push(file)
        }
        ctx.evidence.push({ note: `signed out, ${link} answered ${first?.status()}: "${read.slice(0, 200)}"; screenshots ${shots.join(', ')}` })
        if (first?.status() !== 200 || !opened) return fail(`a stranger opening the live link got ${first?.status()} and ${opened ? 'the chat' : 'no answer on the page'}`)
        if (!read.includes(word)) return fail(`the shared page does not hold the question's word ${word}: "${read.slice(0, 200)}"`)

        await panel.getByRole('button', { name: 'Turn off link' }).click({ timeout: ACTION_TIMEOUT_MS })
        const off = await panel.getByRole('status').filter({ hasText: 'The link is off.' }).waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS }).then(() => true, () => false)
        if (!off) return fail(`Turn off link did not say the link is off: ${(await panel.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200)}`)
        const again = await reader.goto(link)
        const gone = await reader.getByRole('heading', { level: 1, name: 'This chat isn’t available' }).waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS }).then(() => true, () => false)
        const api = await reader.evaluate(async (tk) => (await fetch(`/api/public/chats/${tk}`, { headers: { Accept: 'application/json' } })).status, token)
        ctx.evidence.push({ note: `after Turn off link: ${link} answered ${again?.status()}, /api/public/chats/… ${api}; the page ${gone ? 'says the chat is not there' : 'does not say so'}` })
        if (again?.status() !== 404) return fail(`the turned-off link answered ${again?.status()}, not 404`)
        if (api !== 404) return fail(`the turned-off link's chat is still read: /api/public/chats/… answered ${api}`)
        if (!gone) return fail('the turned-off link answered 404, and the page does not say the chat is not there')
        return { pass: true, detail: `a stranger read the shared chat (its answer holds ${word}) at 200; after Turn off link the same link answered 404` }
      } finally {
        await stranger.close()
        await app.newChat().catch(() => undefined)
      }
    },
  }
}

/**
 * B28.128 — a chat exported from one browser and imported into another keeps its turns and their costs. Two questions
 * asked afresh in a new chat, then Share → Download this chat; a second, fresh browser signed in as the same person,
 * whose list does not hold the chat, takes the file with Import under its conversations. The chat it then opens shows
 * the same questions, the same answers, the same price under each answer and the same running total, and importing it
 * asked no model anything.
 */
export function chatExportImport(seed: number): Scenario {
  return {
    id: 'chat-export-import',
    owner: 'talyvor-suite',
    items: ['B28.128'],
    title: 'a chat exported from one browser and imported into another keeps its turns and their costs',
    run: async (ctx) => {
      const { app, env } = ctx
      const { page } = app
      const attempt = 1 + Math.floor(Math.random() * 999_999)
      const words = [freshWord(seed * 10 + 8, attempt), freshWord(seed * 10 + 9, attempt)]
      if (new URL(page.url()).pathname !== '/chat') await app.openChat()
      await app.newChat()
      const answers: string[] = []
      for (const w of words) {
        const t = await app.ask(`Reply with the word ${w} and nothing else.`)
        ctx.evidence.push({ question: t.question, answer: t.answer.slice(0, 200), footer: t.footerText, error: t.error })
        if (t.error !== undefined) return fail(`refused: ${t.error}`)
        answers.push(t.answer.trim())
      }
      const squash = (t: string) => t.replace(/\s+/g, ' ').trim()
      const read = async (p: Page) => ({
        questions: (await p.locator('[data-testid="turn-user"]').allInnerTexts()).map(squash),
        answers: (await p.locator('[data-testid="turn-assistant"]').allInnerTexts()).map(squash),
        costs: (await p.locator('[data-testid="turn-cost"]').allInnerTexts()).map(squash),
        total: squash(await p.getByTestId('chat-total').innerText({ timeout: ACTION_TIMEOUT_MS }).catch(() => '')),
      })
      const before = await read(page)
      ctx.evidence.push({ note: `exported: ${JSON.stringify(before.costs)}; total "${before.total}"` })
      if (before.costs.length !== 2 || before.total === '') return fail(`the chat shows ${before.costs.length} prices and the total "${before.total}" before it is exported`)

      await page.getByRole('button', { name: 'Share', exact: true }).click({ timeout: ACTION_TIMEOUT_MS })
      const panel = page.getByRole('region', { name: 'Share this chat' })
      await mkdir(env.outDir, { recursive: true })
      const was = page.viewportSize()
      for (const [width, height] of [[1440, 900], [390, 844]]) {
        await page.setViewportSize({ width, height })
        await panel.getByRole('button', { name: 'Download this chat' }).scrollIntoViewIfNeeded()
        await page.screenshot({ path: join(env.outDir, `chat-export-import-download-${width}px-user${app.user.index}.png`) })
      }
      if (was !== null) await page.setViewportSize(was)
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: ACTION_TIMEOUT_MS }),
        panel.getByRole('button', { name: 'Download this chat' }).click({ timeout: ACTION_TIMEOUT_MS }),
      ])
      const file = await download.path()
      ctx.evidence.push({ note: `Download this chat saved ${download.suggestedFilename()}` })
      await panel.getByRole('button', { name: 'Done' }).click()

      const phone = await env.signInUser(app.user.index)
      try {
        await phone.openChat()
        const listed = phone.page.getByRole('list', { name: 'Saved conversations' }).getByRole('button', { name: words[0] })
        if (await listed.isVisible()) throw new CannotTest('the second browser already lists the chat, so an import cannot be told from it')
        const asked: string[] = []
        phone.page.on('request', (r) => {
          if (new URL(r.url()).pathname.startsWith('/api/ai/') && r.method() !== 'GET') asked.push(`${r.method()} ${new URL(r.url()).pathname}`)
        })
        const [chooser] = await Promise.all([
          phone.page.waitForEvent('filechooser', { timeout: ACTION_TIMEOUT_MS }),
          phone.page.getByTestId('history-transfer').getByRole('button', { name: 'Import', exact: true }).click({ timeout: ACTION_TIMEOUT_MS }),
        ])
        await chooser.setFiles(file)
        const said = phone.page.getByTestId('history-transfer').getByRole('status').or(phone.page.getByTestId('history-transfer').getByRole('alert'))
        await said.first().waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS })
        const sentence = squash(await said.first().innerText())
        if (sentence !== 'Imported 1 conversation.') return fail(`Import says "${sentence}"`)
        await listed.click({ timeout: ACTION_TIMEOUT_MS })
        await phone.page.locator('[data-testid="turn-cost"]').nth(before.costs.length - 1).waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS })
        const after = await read(phone.page)
        ctx.evidence.push({ note: `imported: "${sentence}"; ${JSON.stringify(after.costs)}; total "${after.total}"; requests to a model while importing: ${asked.length}` })

        const wide = join(env.outDir, `chat-export-import-1440px-user${app.user.index}.png`)
        const narrow = join(env.outDir, `chat-export-import-390px-user${app.user.index}.png`)
        await phone.page.setViewportSize({ width: 1440, height: 900 })
        await phone.page.waitForTimeout(400)
        await phone.page.screenshot({ path: wide })
        await phone.page.setViewportSize({ width: 390, height: 844 })
        await phone.page.getByRole('button', { name: 'Conversations' }).click()
        await phone.page.getByTestId('history-transfer').last().waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS })
        await phone.page.waitForTimeout(400)
        await phone.page.screenshot({ path: narrow })
        await phone.page.keyboard.press('Escape')
        ctx.evidence.push({ note: `the imported chat at 1440px: ${wide}; the list with Import at 390px: ${narrow}` })

        if (JSON.stringify(after.questions) !== JSON.stringify(before.questions)) return fail(`the questions were ${JSON.stringify(before.questions)} and imported are ${JSON.stringify(after.questions)}`)
        const lost = answers.filter((a) => !after.answers.some((t) => t.includes(squash(a))))
        if (lost.length > 0) return fail(`the imported chat lacks the answers ${JSON.stringify(lost)}`)
        if (JSON.stringify(after.costs) !== JSON.stringify(before.costs)) return fail(`the prices were ${JSON.stringify(before.costs)} and imported are ${JSON.stringify(after.costs)}`)
        if (after.total !== before.total) return fail(`the running total was "${before.total}" and imported is "${after.total}"`)
        if (asked.length > 0) return fail(`importing asked a model: ${asked.join(', ')}`)
        return { pass: true, detail: `imported into a second browser, the chat holds both turns, the prices ${JSON.stringify(after.costs)} and "${after.total}", as exported` }
      } finally {
        await phone.close()
        await app.newChat().catch(() => undefined)
      }
    },
  }
}

/** B28.376 — how long Track is given to add an answer's cost to an issue: its syncer reads Lens every 15 minutes. */
const TRACK_SYNC_MS = 16 * 60_000

/**
 * B28.376 — a Track issue attached in Chat, its cost attributed to it. A fresh issue made in Track, then in Chat attached
 * with Track issue, and a question asked afresh: the question links the issue, Lens holds the answer's charge under the
 * issue's identifier (its per-issue read), and the issue's AI cost in Track rises by exactly that charge — the spend
 * rows Lens wrote for the answer, one for each request it took, in dollars. Track adds it when its syncer next reads Lens, so that wait is long.
 */
export function chatTrackIssue(seed: number): Scenario {
  return {
    id: 'chat-track-issue',
    owner: 'talyvor-suite',
    items: ['B28.124', 'B28.376'],
    title: "a Track issue attached in Chat: the answer's charge is added to the issue's AI cost",
    run: async (ctx) => {
      const { app, env } = ctx
      const { page } = app
      const word = freshWord(seed * 10 + 6, 1 + Math.floor(Math.random() * 999_999))
      const title = `Export stalls ${word}`
      const track = await TrackScreen.open(app)
      await track.create(title)
      await track.page.close()
      const listed = await readFrom<(TrackIssue & { identifier: string; ai_cost_usd: number })[]>(page, '/api/track/issues?limit=100')
      if (typeof listed === 'string') return fail(`Track's issues could not be read: ${listed}`)
      const made = listed.find((i) => i.title === title)
      if (made === undefined) return fail(`"${title}" was made in Track, and Track does not list it`)
      const before = made.ai_cost_usd
      try {
        if (new URL(page.url()).pathname !== '/chat') await app.openChat()
        await app.newChat()
        await page.getByRole('button', { name: 'Track issue' }).click()
        const panel = page.getByRole('dialog', { name: 'Attach a Track issue' })
        await panel.getByRole('textbox', { name: 'Filter issues' }).fill(made.identifier)
        const offered = panel.getByRole('list', { name: 'Track issues' }).getByRole('button', { name: `${made.identifier} ${title}`, exact: true })
        if (!(await offered.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS }).then(() => true, () => false))) {
          return fail(`Track issue does not list ${made.identifier} "${title}": "${(await panel.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200)}"`)
        }
        const was = page.viewportSize()
        await mkdir(env.outDir, { recursive: true })
        const picking = [1440, 390].map((w) => join(env.outDir, `chat-track-issue-picker-${w}px-user${app.user.index}.png`))
        for (const [i, [width, height]] of [[1440, 900], [390, 844]].entries()) {
          await page.setViewportSize({ width, height })
          await page.screenshot({ path: picking[i] })
        }
        if (was !== null) await page.setViewportSize(was)
        ctx.evidence.push({ note: `Track issue listing ${made.identifier} at 1440px: ${picking[0]}; at 390px: ${picking[1]}` })
        await offered.click()
        const chip = page.getByRole('list', { name: 'Attached documents' }).getByText(title, { exact: true })
        if (!(await chip.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS }).then(() => true, () => false))) {
          return fail(`${made.identifier} was picked, and it is not attached: ${(await page.getByRole('alert').allInnerTexts()).join(' ') || 'nothing said'}`)
        }

        const seen = new Set((await env.lens.ledger(app.user)).map((r) => r.id))
        const t = await app.ask(`In one sentence, what does the attached issue ask for? (${word})`)
        ctx.evidence.push({ question: t.question, answer: t.answer.slice(0, 300), footer: t.footerText, error: t.error, note: `attached ${made.identifier} "${title}"` })
        if (t.error !== undefined) return fail(`refused: ${t.error}`)
        const link = page.locator('[data-testid="turn-user"]').last().getByTestId('sent-track-issue')
        const href = (await link.getAttribute('href').catch(() => null)) ?? ''
        if (href !== `/track/issues/${made.id}`) return fail(`the question does not link the issue it carried: ${JSON.stringify(href)}`)
        const asked = [1440, 390].map((w) => join(env.outDir, `chat-track-issue-question-${w}px-user${app.user.index}.png`))
        for (const [i, [width, height]] of [[1440, 900], [390, 844]].entries()) {
          await page.setViewportSize({ width, height })
          await link.scrollIntoViewIfNeeded()
          await page.screenshot({ path: asked[i] })
        }
        if (was !== null) await page.setViewportSize(was)
        ctx.evidence.push({ note: `the question with ${made.identifier} linked, and the answer, at 1440px: ${asked[0]}; at 390px: ${asked[1]}` })
        // B17.160 — the model may look the issue up in Track before it answers; every request the answer took names the
        // issue, so its charge is its spend rows together, one a request, as many as its footer counts.
        const footer = parseFooter(t.footerText)
        const requests = footer.kind === 'priced' ? footer.requests ?? 1 : 1
        let spend: LedgerRow[] = []
        for (let tries = 0; tries < 10 && spend.length < requests; tries++) {
          if (tries > 0) await page.waitForTimeout(1_000)
          spend = (await env.lens.ledger(app.user)).filter((r) => !seen.has(r.id) && r.type === 'spend')
        }
        ctx.evidence.push({ note: 'the spend rows Lens wrote for the answer', ledger: spend.map((r) => ({ type: r.type, amount_ulxc: r.amount_ulxc, created_at: r.created_at })) })
        if (spend.length !== requests) return fail(`the answer [${t.footerText}] took ${requests} request${requests === 1 ? '' : 's'} and wrote ${spend.length} spend rows`)
        const ulxc = spend.reduce((n, r) => n - r.amount_ulxc, 0)
        const charged = (ulxc / 1e6) * env.usdPerLXC
        // Lens and Track keep dollars, the ledger µLXC: each row's reading is within a µLXC, and Track's six places.
        const near = (usd: number) => Math.abs(usd - charged) <= spend.length * (env.usdPerLXC / 1e6 + 5e-7) + 1e-9

        // Lens holds the answer's charge under the issue (talyvor-lens B28.124), or Track has nothing to add.
        const held = await until(async () => {
          const r = await env.lens.as(app.user.token, 'GET', `/v1/workspaces/${app.user.workspaceID}/anomalies/issue/${encodeURIComponent(made.identifier)}`)
          return { status: r.status, cost: parsed<{ cost_usd: number }>(r.text)?.cost_usd ?? 0, text: r.text.slice(0, 200) }
        }, (r) => near(r.cost), 15_000)
        ctx.evidence.push({ note: `Lens's read of ${made.identifier}: ${held.status} ${held.text}; the answer was charged $${charged}` })
        if (!near(held.cost)) return fail(`Lens holds $${held.cost} under ${made.identifier}; the answer that named it was charged $${charged} (${ulxc} µLXC)`)

        // And Track adds it to the issue's AI cost when its syncer next reads Lens.
        const after = await until(async () => {
          const r = await readFrom<{ ai_cost_usd: number }>(page, `/api/track/issues/${encodeURIComponent(made.id)}`)
          return typeof r === 'string' ? before : r.ai_cost_usd
        }, (usd) => near(usd - before), TRACK_SYNC_MS)
        const rose = after - before
        ctx.evidence.push({ note: `${made.identifier}'s AI cost in Track: $${before} before, $${after} after` })
        if (!near(rose)) return fail(`${made.identifier}'s AI cost in Track rose by $${rose} ($${before} → $${after}); the answer was charged $${charged}`)

        const issuePage = await app.tab(`/track/issues/${encodeURIComponent(made.id)}`)
        try {
          const cost = issuePage.getByRole('region', { name: /What it has cost so far/ })
          await cost.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS })
          const shots = [1440, 390].map((w) => join(env.outDir, `chat-track-issue-${w}px-user${app.user.index}.png`))
          for (const [i, [width, height]] of [[1440, 900], [390, 844]].entries()) {
            await issuePage.setViewportSize({ width, height })
            await cost.scrollIntoViewIfNeeded()
            await issuePage.screenshot({ path: shots[i] })
          }
          ctx.evidence.push({ note: `${made.identifier} in Track with its AI cost, ${JSON.stringify((await cost.innerText()).replace(/\s+/g, ' ').slice(0, 120))}, at 1440px: ${shots[0]}; at 390px: ${shots[1]}` })
        } finally {
          await issuePage.close()
        }
        return { pass: true, detail: `${made.identifier} attached in Chat; the answer's ${requests} request${requests === 1 ? '' : 's'}, ${ulxc} µLXC ($${charged}), is held under it in Lens, and its AI cost in Track rose by $${rose}` }
      } finally {
        await app.newChat().catch(() => undefined)
      }
    },
  }
}

/**
 * Features' "Routing pattern sharing": switched on, Lens holds the workspace opted in; off again, opted out. Where Lens
 * runs no pattern mining the switch is not offered, and a request to opt in anyway is refused and stores nothing.
 */
export function patternMiningSwitch(): Scenario {
  const NAME = 'Routing pattern sharing'
  return {
    id: 'pattern-mining-switch',
    owner: 'talyvor-lens',
    title: "Features' routing pattern sharing: switched, Lens holds the opt-in; where Lens runs no pattern mining it is not offered and a request to opt in is refused, nothing stored",
    run: async (ctx) => {
      const read = () => lensRead<{ enabled: boolean; opted_in: boolean }>(ctx, '/v1/workspaces/{ws}/pattern-mining/opt-in')
      const start = await read()
      if (!start.ok) return fail(`Lens answers ${start.status} for the pattern-mining opt-in: ${start.error}`)
      const f = await FeaturesScreen.open(ctx.app)
      try {
        const was = await f.isOn(NAME)
        ctx.evidence.push({ note: `Lens: ${JSON.stringify(start.value)}; Features ${was === undefined ? 'offers no switch' : `shows it ${was ? 'on' : 'off'}`}` })
        if (was === undefined) {
          if (start.value.enabled) return fail(`Lens runs pattern mining for this workspace, and Features offers no "${NAME}" switch`)
          const asked = await from(f.page, 'POST', '/api/features/pattern-mining', { opted_in: true })
          const after = await read()
          ctx.evidence.push({ note: `opting in anyway: ${asked.status} ${asked.text.slice(0, 200)}; Lens: ${after.ok ? JSON.stringify(after.value) : after.status}` })
          if (asked.status >= 200 && asked.status < 300) return fail(`Lens runs no pattern mining, and opting in answered ${asked.status} ${asked.text.slice(0, 200)}`)
          if (!after.ok || after.value.opted_in) return fail(`a refused opt-in left Lens holding ${after.ok ? JSON.stringify(after.value) : after.status}`)
          return { pass: true, detail: `pattern mining is off on this deployment: no switch, and opting in was refused (${asked.status} ${refusalOf(asked.text)}) with nothing stored` }
        }
        if (was !== start.value.opted_in) return fail(`Features shows the switch ${was ? 'on' : 'off'}; Lens holds opted_in ${start.value.opted_in}`)
        const failures: string[] = []
        for (const on of [!was, was]) {
          const err = await f.set(NAME, on)
          const now = await until(read, (x) => x.ok && x.value.opted_in === on, 10_000)
          ctx.evidence.push({ note: `switched ${on ? 'on' : 'off'}: ${err ?? 'shown'}; Lens holds ${now.ok ? JSON.stringify(now.value) : now.status}` })
          if (err !== undefined) failures.push(`switching ${on ? 'on' : 'off'}: ${err}`)
          else if (!now.ok || now.value.opted_in !== on) failures.push(`switched ${on ? 'on' : 'off'}, and Lens holds ${now.ok ? JSON.stringify(now.value) : now.status}`)
        }
        return failures.length === 0 ? { pass: true, detail: `switched ${was ? 'off and on' : 'on and off'}, and Lens held each` } : fail(failures.join('; '))
      } finally {
        await f.close()
      }
    },
  }
}

/**
 * API keys: a key made on the screen works on Lens; revoked on the screen (its prefix typed to confirm), Lens no longer
 * lists it and refuses it.
 */
export function apiKeyRevoke(seed: number): Scenario {
  return {
    id: 'api-key-revoke',
    owner: 'talyvor-lens',
    title: 'API keys: a key made on the screen works on Lens; revoked there, Lens no longer lists it and refuses it',
    run: async (ctx) => {
      const { app, env } = ctx
      const name = `e2e-revoke-${seed}-${RUN_SALT}`
      const page = await app.tab('/keys')
      try {
        await page.getByLabel('New key name').fill(name)
        await page.getByRole('button', { name: 'Create key' }).click()
        await page.getByRole('button', { name: 'Copy key' }).waitFor({ timeout: 15_000 })
        const secret = (await page.locator('div.select-all').first().innerText()).trim()
        const listed = await lensRead<{ id: string; name: string; key_prefix: string }[] | null>(ctx, '/v1/workspaces/{ws}/api-keys')
        const key = listed.ok ? (listed.value ?? []).find((k) => k.name === name) : undefined
        if (key === undefined) return fail(`made "${name}" on the screen, and Lens does not list it: ${listed.ok ? JSON.stringify(listed.value).slice(0, 200) : listed.status}`)
        const asKey = { ...app.user, token: secret }
        const works = await env.lens.act(asKey, 'GET', '/v1/workspaces/{ws}')
        await page.getByRole('button', { name: /i stored it/i }).click()
        await page.getByRole('button', { name: `Revoke ${key.key_prefix}` }).click()
        await page.getByLabel(`Type ${key.key_prefix} to confirm`).fill(key.key_prefix)
        // The confirm form replaces the row's Revoke button, so its answer is what is waited for.
        const [revoked] = await Promise.all([
          page.waitForResponse((r) => r.request().method() === 'DELETE' && r.url().includes(`/api/keys/${key.id}`), { timeout: 30_000 }).catch(() => undefined),
          page.getByRole('button', { name: 'Revoke key' }).click(),
        ])
        const after = await lensRead<{ id: string }[] | null>(ctx, '/v1/workspaces/{ws}/api-keys')
        // Lens keeps a key it has checked for up to KEY_CACHE_MS (talyvor-lens internal/auth/apikeys.go cacheTTL), as the
        // screen says: "Treat it as revoked in 5 minutes, not immediately."
        const t0 = Date.now()
        const refused = await until(() => env.lens.act(asKey, 'GET', '/v1/workspaces/{ws}'), (a) => a.status === 401, KEY_CACHE_MS)
        const took = Math.round((Date.now() - t0) / 1000)
        ctx.evidence.push({ note: `${key.key_prefix}: before revoking Lens answered it ${works.status}; revoked on the screen (${revoked?.status() ?? 'no answer'}), Lens lists ${after.ok ? (after.value ?? []).length : after.status} key(s) and answers it ${refused.status} after ${took} s` })
        const failures: string[] = []
        if (!works.ok) failures.push(`the new key was refused by Lens before it was revoked: ${works.status} ${works.error}`)
        if (!after.ok || (after.value ?? []).some((k) => k.id === key.id)) failures.push(`revoked on the screen, and Lens still lists ${key.key_prefix}`)
        if (refused.status !== 401) failures.push(`revoked, the key is still answered ${refused.status} by Lens after ${took} s`)
        return failures.length === 0 ? { pass: true, detail: `${key.key_prefix} worked, was revoked on the screen, is gone from Lens's list and refused (401)` } : fail(failures.join('; '))
      } finally {
        await page.close()
      }
    },
  }
}

/**
 * Settings' "Your provider keys": an OpenAI key added there is the one Lens holds (its last four), and removed there,
 * Lens holds none. Where Lens holds no provider keys at all, or the plan allows none, Settings says so and a key sent
 * anyway is refused, with nothing stored.
 */
export function providerKeys(seed: number): Scenario {
  const value = `sk-e2e-${seed}-${RUN_SALT}-wxyz`
  return {
    id: 'provider-keys',
    owner: 'talyvor-lens',
    title: "Settings' provider keys: an OpenAI key added there is the one Lens holds and removed there is gone; where Lens holds none, one sent anyway is refused with nothing stored",
    run: async (ctx) => {
      const page = await ctx.app.tab('/settings')
      const read = () => lensRead<{ keys?: { provider: string; last4: string }[] } | { provider: string; last4: string }[]>(ctx, '/v1/workspaces/{ws}/provider-keys')
      const keysOf = (a: Awaited<ReturnType<typeof read>>) => !a.ok ? undefined : Array.isArray(a.value) ? a.value : a.value.keys ?? []
      try {
        const c = card(page, 'Your provider keys')
        await c.getByText(/^Reading your provider keys/).waitFor({ state: 'detached', timeout: 15_000 }).catch(() => undefined)
        const said = (await c.innerText()).replace(/\s+/g, ' ')
        const add = c.getByRole('button', { name: 'Add OpenAI key' })
        const start = await read()
        ctx.evidence.push({ note: `Settings: ${said.slice(0, 300)}; Lens: ${start.ok ? JSON.stringify(start.value).slice(0, 200) : `${start.status} ${start.error}`}` })
        if ((await add.count()) === 0) {
          const sent = await from(page, 'PUT', '/api/provider-keys/openai', { key: value })
          const after = await read()
          ctx.evidence.push({ note: `an OpenAI key sent anyway: ${sent.status} ${sent.text.slice(0, 200)}; Lens: ${after.ok ? JSON.stringify(after.value).slice(0, 200) : after.status}` })
          if (sent.status >= 200 && sent.status < 300) return fail(`Settings offers no key, and one sent anyway was stored: ${sent.text.slice(0, 200)}`)
          if ((keysOf(after) ?? []).some((k) => k.provider === 'openai')) return fail('a refused key was stored by Lens')
          if (start.ok && !/doesn’t hold provider keys|come with BYOK|BYOK/.test(said)) return fail(`Lens holds keys for this workspace, and Settings offers none to add: ${said.slice(0, 200)}`)
          return { pass: true, detail: `no key offered (${/doesn’t hold provider keys/.test(said) ? 'this deployment holds none' : 'the plan allows none'}); one sent anyway was refused (${sent.status} ${refusalOf(sent.text)}) and nothing stored` }
        }
        await add.click()
        await c.getByLabel('OpenAI API key').fill(value)
        await c.getByRole('button', { name: 'Save key' }).click()
        const held = await until(read, (a) => (keysOf(a) ?? []).some((k) => k.provider === 'openai'), 15_000)
        const shown = await c.getByTestId('provider-key-openai').innerText().catch(() => '')
        const k = (keysOf(held) ?? []).find((x) => x.provider === 'openai')
        ctx.evidence.push({ note: `added: Settings shows "${shown.trim()}"; Lens holds ${JSON.stringify(k)}` })
        const failures: string[] = []
        if (k?.last4 !== value.slice(-4)) failures.push(`an OpenAI key ending ${value.slice(-4)} was added, and Lens holds ${JSON.stringify(k)}`)
        if (!shown.includes(value.slice(-4))) failures.push(`Settings shows "${shown.trim()}" for the key`)
        await c.getByRole('button', { name: 'Remove', exact: true }).first().click()
        await c.getByRole('button', { name: 'Remove OpenAI key' }).click()
        const gone = await until(read, (a) => !(keysOf(a) ?? []).some((x) => x.provider === 'openai'), 15_000)
        if ((keysOf(gone) ?? []).some((x) => x.provider === 'openai')) failures.push('removed on Settings, and Lens still holds the OpenAI key')
        return failures.length === 0 ? { pass: true, detail: `the key ending ${value.slice(-4)} was held by Lens as added on Settings, and gone once removed there` } : fail(failures.join('; '))
      } finally {
        await page.close()
      }
    },
  }
}

/**
 * BYOK, Team's add-on, on a workspace of its own: Team is bought with the test card, then "Add BYOK to Team" on Plans
 * — Lens's subscription and its plan both hold the add-on, and own provider keys are allowed; "Remove BYOK" — neither
 * holds it. The Team subscription is cancelled at the end.
 */
export function byokAddon(seed: number): Scenario {
  return {
    id: 'byok-addon',
    owner: 'talyvor-lens',
    own: true,
    title: 'BYOK on a Team test subscription: added on Plans, Lens\'s subscription and plan hold it and allow own keys; removed there, neither does',
    feature: 'Plans',
    run: async (ctx) => {
      const { env, app } = ctx
      const start = await env.lens.startSubscription(app.user, 'team')
      if (!start.ok || start.value.url === undefined) throw new CannotTest(`Lens opens this test workspace no Team checkout: ${start.status} ${start.ok ? 'without a url' : start.error}`)
      try {
        const paid = await payCheckout(app, start.value.url, `tester-${seed}@example.com`)
        ctx.evidence.push({ note: `Team, paid with the test card on ${paid.checkout}${paid.refused === undefined ? '' : `: ${paid.refused}`}` })
        if (paid.refused !== undefined) return fail(`paying for Team with the test card: ${paid.refused}`)
        const sub = () => lensRead<{ subscribed: boolean; plan?: string; byok?: boolean }>(ctx, '/v1/workspaces/{ws}/billing/subscription')
        const plan = () => lensRead<{ plan: string; byok_add_on: boolean; own_provider_keys_allowed: boolean }>(ctx, '/v1/workspaces/{ws}/plan')
        const onTeam = await until(sub, (s) => s.ok && s.value.subscribed && s.value.plan === 'team', WEBHOOK_WAIT_MS)
        if (!onTeam.ok || !onTeam.value.subscribed) return fail(`paid for Team, and Lens's subscription reads ${onTeam.ok ? JSON.stringify(onTeam.value) : onTeam.status}`)
        const failures: string[] = []
        const page = await app.tab('/plans')
        try {
          for (const on of [true, false]) {
            const button = page.getByRole('button', { name: on ? 'Add BYOK to Team' : 'Remove BYOK', exact: true })
            await button.waitFor({ timeout: 30_000 })
            await button.click()
            const s = await until(sub, (x) => x.ok && x.value.byok === on, WEBHOOK_WAIT_MS)
            const g = await until(plan, (x) => x.ok && x.value.byok_add_on === on, WEBHOOK_WAIT_MS)
            ctx.evidence.push({ note: `${on ? 'Add BYOK to Team' : 'Remove BYOK'}: Lens's subscription ${s.ok ? JSON.stringify(s.value) : s.status}; its plan ${g.ok ? JSON.stringify(g.value) : g.status}` })
            if (!s.ok || s.value.byok !== on) failures.push(`${on ? 'added' : 'removed'} BYOK on Plans, and Lens's subscription holds byok ${s.ok ? s.value.byok : s.status}`)
            if (!g.ok || g.value.byok_add_on !== on || g.value.own_provider_keys_allowed !== on) failures.push(`${on ? 'added' : 'removed'} BYOK on Plans, and Lens's plan reads ${g.ok ? JSON.stringify(g.value) : g.status}`)
          }
        } finally {
          await page.close()
        }
        return failures.length === 0 ? { pass: true, detail: 'on Team by test card; BYOK added on Plans was held by Lens\'s subscription and plan (own keys allowed), and removed, neither held it' } : fail(failures.join('; '))
      } finally {
        await env.lens.cancelSubscription(app.user).catch(() => undefined)
      }
    },
  }
}

const WEBHOOK_WAIT_MS = 60_000
/** How long Lens may keep answering a revoked key: its key cache, five minutes, and a little over. */
const KEY_CACHE_MS = 330_000

/**
 * A plan changed on Plans, on a workspace of its own: Plus is bought with the test card, then "Switch to Pro" and its
 * confirmation — Lens's subscription is on Pro, and the period's allowance is Pro's price, its included usage moved from
 * Plus's toward Pro's by the share of the period left (Lens B18.14), as Lens's own plans read states both. The
 * subscription is cancelled at the end.
 */
export function planChange(seed: number): Scenario {
  return {
    id: 'plan-change',
    owner: 'talyvor-lens',
    own: true,
    title: 'Plus bought with the test card, then moved to Pro on Plans: Lens\'s subscription is on Pro and its allowance is Pro\'s price, its usage moved by the share of the month left',
    feature: 'Plans',
    run: async (ctx) => {
      const { env, app } = ctx
      const plans = await env.lens.plans()
      const plus = plans?.find((p) => p.id === 'plus')
      const pro = plans?.find((p) => p.id === 'pro')
      if (plus === undefined || pro === undefined) throw new CannotTest(`Lens's plans read sells ${plans === null ? 'no plan' : plans.map((p) => p.id).join(', ')} here`)
      try {
        const s = await subscribeWithTestCard(app, 'Plus', `tester-${seed}@example.com`)
        ctx.evidence.push({ note: `Plans → Choose Plus: ${s.checkout === undefined ? 'never reached Stripe' : `paid on ${s.checkout}`}${s.refused === undefined ? '' : `; ${s.refused}`}` })
        if (s.checkout === undefined || s.refused !== undefined) return fail(`buying Plus with the test card: ${s.refused}`)
        const fee = (x: Awaited<ReturnType<typeof env.lens.allowance>>) => (x.ok && x.value !== null ? x.value.fee_usd_cents : undefined)
        const onPlus = await until(() => env.lens.allowance(app.user), (x) => fee(x) === plus.usd_cents, WEBHOOK_WAIT_MS)
        if (fee(onPlus) !== plus.usd_cents) return fail(`paid for Plus, and Lens's allowance is for ${fee(onPlus) ?? 'nothing'} cents, not ${plus.usd_cents}`)

        const page = await app.tab('/plans')
        let moved = ''
        const pressed = Date.now()
        try {
          await page.getByRole('button', { name: 'Switch to Pro', exact: true }).click()
          await page.getByRole('button', { name: 'Move to Pro', exact: true }).click()
          const said = page.getByTestId('plan-moved').or(page.getByRole('alert')).first()
          await said.waitFor({ timeout: 30_000 }).catch(() => undefined)
          moved = (await said.innerText().catch(() => '')).trim()
        } finally {
          await page.close()
        }
        const sub = await until(() => lensRead<{ plan?: string; subscribed: boolean }>(ctx, '/v1/workspaces/{ws}/billing/subscription'), (x) => x.ok && x.value.plan === 'pro', WEBHOOK_WAIT_MS)
        type Period = { allowance: { granted_ulxc: number; fee_usd_cents: number; period_start?: string; period_end?: string } | null }
        const onPro = await until(() => lensRead<Period>(ctx, '/v1/workspaces/{ws}/billing/allowance'), (x) => x.ok && x.value.allowance?.fee_usd_cents === pro.usd_cents, WEBHOOK_WAIT_MS)
        const seen = Date.now()
        const a = onPro.ok ? onPro.value.allowance : null
        ctx.evidence.push({ note: `Move to Pro: Plans says "${moved}"; Lens's subscription ${sub.ok ? JSON.stringify(sub.value) : sub.status}; its allowance ${onPro.ok ? JSON.stringify(a) : onPro.status}` })
        const failures: string[] = []
        if (!sub.ok || sub.value.plan !== 'pro') failures.push(`moved to Pro on Plans ("${moved}"), and Lens's subscription is on ${sub.ok ? sub.value.plan : sub.status}`)
        if (a?.fee_usd_cents !== pro.usd_cents) failures.push(`moved to Pro, and Lens's allowance is for ${a?.fee_usd_cents ?? 'nothing'} cents, not Pro's ${pro.usd_cents}`)
        else {
          // Lens B18.14: the allowance moves by the difference in included usage times the share of the period left
          // when Stripe's update arrived — some moment between the press and the read (a minute's slack each way).
          const [start, end] = [Date.parse(a.period_start ?? ''), Date.parse(a.period_end ?? '')]
          const share = (at: number) => Math.min(1, Math.max(0, (end - at) / (end - start)))
          const [lo, hi] = [share(seen + 60_000), share(pressed - 60_000)].map((left) => plus.included_ulxc + (pro.included_ulxc - plus.included_ulxc) * left)
          if (!(end > start) || a.granted_ulxc < Math.floor(lo) || a.granted_ulxc > Math.ceil(hi)) {
            failures.push(`on Pro Lens grants ${a.granted_ulxc} µLXC for ${a.period_start} – ${a.period_end}; Plus's ${plus.included_ulxc} moved by the share of the period left toward Pro's ${pro.included_ulxc} is ${Math.floor(lo)}–${Math.ceil(hi)}`)
          }
        }
        return failures.length === 0 ? { pass: true, detail: `Plus by test card, moved to Pro on Plans: Lens's subscription on Pro, its allowance Pro's ${pro.usd_cents} cents and ${a?.granted_ulxc} µLXC, Plus's included usage moved toward Pro's by the share of the period left` } : fail(failures.join('; '))
      } finally {
        await env.lens.cancelSubscription(app.user).catch(() => undefined)
      }
    },
  }
}
