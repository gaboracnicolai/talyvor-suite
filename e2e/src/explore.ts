// B17.5 — the EXPLORERS. Each is a synthetic user in a headless browser whose next move is chosen by a
// cheap model, asked through Lens on the explorer's own account: it reads the screen, clicks, types and
// navigates as a curious customer would, for up to --explore-minutes. Anything that looks wrong to it —
// and every page error or 5xx the browser saw — is written down as a FINDING TO CHECK. Findings go into
// the report and never become build items: an explorer can be mistaken.
//
// Every step reserves its worst case against the run's one SpendCap before the model is asked, so the
// explorers stop at the cap with everything else.

import type { Page } from 'playwright'
import type { AppUser } from './app.ts'
import { CapReached, type SpendCap, worstInputTokens } from './budget.ts'
import type { LensClient } from './lens.ts'
import { type CatalogModel, listPriceUSD } from './oracles.ts'

export interface Finding {
  explorer: number
  /** Written by the explorer, or seen by the browser (a page error or a 5xx). */
  source: 'explorer' | 'browser'
  severity: string
  where: string
  note: string
  /** The explorer's last moves before it, oldest first. */
  trail: string[]
  at: string
  /** B25.5 — the feature `where` belongs to; run.ts fills it in once the run is over. */
  feature?: string
}

export interface ExplorerSummary {
  explorer: number
  steps: number
  stopped: 'time' | 'done' | 'cap' | 'steps' | 'error'
  detail: string
  /** B25.5 — the feature it was sent to first. */
  start?: string
}

const MAX_OUTPUT_TOKENS = 300
const MAX_STEPS = 200
const TEXT_CHARS = 3500
const CONTROLS = 70

interface Control { i: number; tag: string; role: string; type: string; name: string }
interface Screen { url: string; title: string; text: string; controls: Control[] }

/** What the explorer can see: the page's text and its visible controls, each numbered for its reply. */
async function observe(page: Page): Promise<Screen> {
  return page.evaluate(({ textChars, max }) => {
    const sel = 'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="switch"], [role="tab"], [role="menuitem"], [role="textbox"]'
    document.querySelectorAll('[data-explore]').forEach((el) => el.removeAttribute('data-explore'))
    const shown = Array.from(document.querySelectorAll(sel)).filter((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && !(el as HTMLButtonElement).disabled && el.getAttribute('aria-hidden') !== 'true'
    }).slice(0, max)
    const controls = shown.map((el, i) => {
      el.setAttribute('data-explore', String(i))
      const name = el.getAttribute('aria-label') ?? ((el as HTMLElement).innerText || el.getAttribute('placeholder') || el.getAttribute('name') || '')
      return { i, tag: el.tagName.toLowerCase(), role: el.getAttribute('role') ?? '', type: el.getAttribute('type') ?? '', name: name.replace(/\s+/g, ' ').trim().slice(0, 60) }
    })
    return { url: location.pathname + location.search, title: document.title, text: document.body.innerText.replace(/\n{2,}/g, '\n').slice(0, textChars), controls }
  }, { textChars: TEXT_CHARS, max: CONTROLS })
}

export type Move =
  | { action: 'click'; target: number }
  | { action: 'fill'; target: number; text: string }
  | { action: 'press'; key: string }
  | { action: 'goto'; path: string }
  | { action: 'finding'; note: string; severity?: string }
  | { action: 'done' }

/** The model's reply as one move, or undefined when it is not one. */
export function parseMove(reply: string): Move | undefined {
  const m = /\{[\s\S]*\}/.exec(reply)
  if (m === null) return undefined
  let v: Record<string, unknown>
  try {
    v = JSON.parse(m[0]) as Record<string, unknown>
  } catch {
    return undefined
  }
  const n = (x: unknown) => (typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : undefined)
  const s = (x: unknown) => (typeof x === 'string' && x.trim() !== '' ? x : undefined)
  switch (v.action) {
    case 'click': return n(v.target) === undefined ? undefined : { action: 'click', target: n(v.target) as number }
    case 'fill': return n(v.target) === undefined || typeof v.text !== 'string' ? undefined : { action: 'fill', target: n(v.target) as number, text: v.text }
    case 'press': return s(v.key) === undefined ? undefined : { action: 'press', key: v.key as string }
    // Only a path of this app: an explorer never leaves it, and never signs itself out.
    case 'goto': return typeof v.path === 'string' && /^\/(?!\/)/.test(v.path) && !/^\/auth\//.test(v.path) ? { action: 'goto', path: v.path } : undefined
    case 'finding': return s(v.note) === undefined ? undefined : { action: 'finding', note: v.note as string, severity: s(v.severity) }
    case 'done': return { action: 'done' }
    default: return undefined
  }
}

/** B25.5 — a feature of the app and the address it opens at. */
export interface Area {
  feature: string
  path: string
}

function prompt(step: number, screen: Screen, trail: string[], seen: string[], features: Area[], start: Area | undefined): string {
  return [
    'You are an explorer testing Talyvor, a web app for working with AI models (Chat, Features, Docs, Track, Wallets, Billing and more).',
    'You are signed in as a test user with test credits. Use it the way a curious new customer would: open its screens, try its',
    'features with small realistic inputs, and look for anything that seems wrong — an error, a broken or empty screen that should',
    'have content, figures that do not add up, text that contradicts itself or the screen, a control that does nothing.',
    'Do not sign out. Keep chat questions short.',
    ...(features.length > 0 ? ['', `Talyvor's features, each at its address: ${features.map((f) => `${f.feature} (${f.path})`).join(', ')}.`] : []),
    ...(start !== undefined ? [`Start with ${start.feature} (${start.path}): the scripted testers covered it least. Try everything it offers, then go on to the others.`] : []),
    '',
    `Step ${step} of at most ${MAX_STEPS}. You are at ${screen.url} ("${screen.title}").`,
    `Your last moves: ${trail.length > 0 ? trail.slice(-6).join(' → ') : 'none yet'}`,
    `Seen by the browser since your last move: ${seen.length > 0 ? seen.join('; ') : 'nothing wrong'}`,
    '',
    'The screen\'s text (cut short):',
    screen.text,
    '',
    'Its controls, by number:',
    ...screen.controls.map((c) => `[${c.i}] ${c.tag}${c.role !== '' ? ` role=${c.role}` : ''}${c.type !== '' ? ` type=${c.type}` : ''} "${c.name}"`),
    '',
    'Reply with ONE JSON object and nothing else, one of:',
    '{"action":"click","target":N} {"action":"fill","target":N,"text":"..."} {"action":"press","key":"Enter"}',
    '{"action":"goto","path":"/features"} {"action":"finding","note":"what looks wrong, and where","severity":"high|medium|low"} {"action":"done"}',
  ].join('\n')
}

export interface ExploreOptions {
  lens: LensClient
  cap: SpendCap
  catalog: CatalogModel[]
  usdPerLXC: number
  provider: string
  model: string
  minutes: number
  /** B25.5 — every feature, least covered first; this explorer starts at `start`. */
  features: Area[]
  start?: Area
}

/** One explorer's session. Its findings are pushed into `findings` as they are made. */
export async function explore(n: number, app: AppUser, opts: ExploreOptions, findings: Finding[]): Promise<ExplorerSummary> {
  const page = app.page
  const model = opts.catalog.find((m) => m.id === opts.model)
  if (model === undefined) return { explorer: n, steps: 0, stopped: 'error', detail: `the catalog has no model ${opts.model}` }
  const seen: string[] = []
  const trail: string[] = []
  const note = (source: Finding['source'], severity: string, text: string, where: string) =>
    findings.push({ explorer: n, source, severity, where, note: text, trail: trail.slice(-5), at: new Date().toISOString() })
  page.on('pageerror', (e) => {
    seen.push(`page error: ${e.message.slice(0, 160)}`)
    note('browser', 'auto', `page error: ${e.message.slice(0, 300)}`, new URL(page.url()).pathname)
  })
  page.on('response', (r) => {
    if (r.status() >= 500) {
      const path = new URL(r.url()).pathname
      seen.push(`${r.status()} from ${path}`)
      note('browser', 'auto', `${r.request().method()} ${path} answered ${r.status()}`, new URL(page.url()).pathname)
    }
  })

  if (opts.start !== undefined) {
    await page.goto(new URL(opts.start.path, page.url()).toString()).catch(() => undefined)
    trail.push(`goto ${opts.start.path} (its starting feature, ${opts.start.feature})`)
  }
  const deadline = Date.now() + opts.minutes * 60_000
  let step = 0
  while (step < MAX_STEPS) {
    if (Date.now() >= deadline) return { explorer: n, steps: step, stopped: 'time', detail: `${opts.minutes} minutes up` }
    step++
    const screen = await observe(page)
    const ask = prompt(step, screen, trail, seen.splice(0), opts.features, opts.start)
    let reply
    try {
      const hold = opts.cap.reserve(listPriceUSD(model, worstInputTokens(ask.length), MAX_OUTPUT_TOKENS))
      try {
        reply = await opts.lens.complete(app.user, opts.provider, opts.model, ask, MAX_OUTPUT_TOKENS, 'explorer')
      } catch (e) {
        opts.cap.settle(hold, undefined)
        throw e
      }
      opts.cap.settle(hold, reply.replayed ? 0 : reply.pooledULXC !== undefined ? (reply.pooledULXC / 1e6) * opts.usdPerLXC
        : listPriceUSD(model, reply.inputTokens, reply.outputTokens))
    } catch (e) {
      if (e instanceof CapReached) return { explorer: n, steps: step - 1, stopped: 'cap', detail: e.message }
      return { explorer: n, steps: step - 1, stopped: 'error', detail: e instanceof Error ? e.message : String(e) }
    }
    const move = parseMove(reply.text)
    if (move === undefined) {
      trail.push(`(an unreadable reply: ${reply.text.slice(0, 60)})`)
      continue
    }
    if (move.action === 'done') return { explorer: n, steps: step, stopped: 'done', detail: 'the explorer said it was done' }
    if (move.action === 'finding') {
      note('explorer', move.severity ?? 'medium', move.note, screen.url)
      trail.push(`noted a finding on ${screen.url}`)
      continue
    }
    const target = 'target' in move ? screen.controls[move.target] : undefined
    const label = target !== undefined ? `${move.action} [${target.i}] "${target.name}"`
      : move.action === 'goto' ? `goto ${move.path}` : move.action === 'press' ? `press ${move.key}` : JSON.stringify(move)
    try {
      if (move.action === 'goto') await page.goto(new URL(move.path, page.url()).toString())
      else if (move.action === 'press') await page.keyboard.press(move.key)
      else if (target === undefined) throw new Error(`there is no control ${move.target}`)
      else if (move.action === 'click') await page.locator(`[data-explore="${move.target}"]`).click({ timeout: 5_000 })
      else await page.locator(`[data-explore="${move.target}"]`).fill(move.text, { timeout: 5_000 })
      trail.push(`${label} on ${screen.url}`)
    } catch (e) {
      trail.push(`${label} on ${screen.url} FAILED: ${(e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 100)}`)
    }
    await page.waitForLoadState('domcontentloaded').catch(() => undefined)
    await page.waitForTimeout(1_000)
  }
  return { explorer: n, steps: step, stopped: 'steps', detail: `${MAX_STEPS} steps taken` }
}
