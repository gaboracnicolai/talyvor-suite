// B17.5 — the EXPLORERS. Each is a synthetic user in a headless browser whose next move is chosen by a
// cheap model, asked through Lens on the explorer's own account: it reads the screen, clicks, types and
// navigates as a curious customer would, for up to --explore-minutes. Anything that looks wrong to it —
// and every page error or 5xx the browser saw — is written down as a FINDING TO CHECK. Findings go into
// the report and never become build items: an explorer can be mistaken.
//
// Every step reserves its worst case against the run's one SpendCap before the model is asked, so the
// explorers stop at the cap with everything else.
//
// B26.19 — the explorers share one NOTEBOOK. Each is shown what it and the others have already noted on
// the screen it is on, and says "same" rather than writing it again in new words. One explorer makes at
// most NOTES_PER_SCREEN notes on a screen; after the last, or after DWELL_STEPS steps there, it is moved
// to the screen the explorers have seen least. Each distinct lead is reported once, with who saw it.

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
  /** B26.19 — the screen it was made on (its route, e.g. /track/issues/:id), and the lead it is part of. */
  screen?: string
  lead?: number
}

/** B26.19 — one distinct thing noted, and every explorer who saw it, first first. */
export interface Lead {
  id: number
  source: Finding['source']
  severity: string
  screen: string
  note: string
  by: number[]
}

export const NOTES_PER_SCREEN = 3
const DWELL_STEPS = 20

const sameWords = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** What every explorer has noted so far, and where they have been — shared by all of a run's explorers. */
export class Notebook {
  /** Where each note is pushed, as it is made. */
  readonly findings: Finding[]
  /** The screens an explorer can be sent to, in the app's order. */
  readonly screens: readonly string[]
  /** The screen a path is on (its route), or the path itself when it is on none. */
  private readonly screenOf: (path: string) => string
  private readonly leads: Lead[] = []
  private readonly arrivals = new Map<string, number>()

  constructor(findings: Finding[], screens: readonly string[], screenOf: (path: string) => string) {
    this.findings = findings
    this.screens = screens
    this.screenOf = screenOf
  }

  screen(where: string): string {
    return this.screenOf(where.split(/[?#]/)[0])
  }

  /** How many notes explorer `n` has made on `screen`. */
  notesBy(n: number, screen: string): number {
    return this.findings.filter((f) => f.explorer === n && f.screen === screen).length
  }

  /** Every lead on `screen`, the most seen first. */
  on(screen: string): Lead[] {
    return this.leads.filter((l) => l.screen === screen).sort((a, b) => b.by.length - a.by.length || a.id - b.id)
  }

  /** The leads explorer `n` wrote or saw, in the order it did. */
  of(n: number): Lead[] {
    return this.leads.filter((l) => l.by.includes(n))
  }

  /**
   * Explorer `n` notes something at `where`. The same words on the same screen are the lead already
   * there; a note it has made before, or one past its last on this screen, is not written.
   */
  write(n: number, source: Finding['source'], severity: string, where: string, note: string, trail: string[]): Lead | 'again' | 'full' {
    const screen = this.screen(where)
    const words = sameWords(note)
    const lead = this.leads.find((l) => l.source === source && l.screen === screen && sameWords(l.note) === words)
    if (lead !== undefined) return this.saw(n, lead, where, trail)
    if (this.notesBy(n, screen) >= NOTES_PER_SCREEN) return 'full'
    const made: Lead = { id: this.leads.length + 1, source, severity, screen, note, by: [] }
    this.leads.push(made)
    return this.saw(n, made, where, trail)
  }

  /** Explorer `n` saw lead `id` too. */
  same(n: number, id: number, where: string, trail: string[]): Lead | 'again' | 'full' | 'unknown' {
    const lead = this.leads.find((l) => l.id === id)
    return lead === undefined ? 'unknown' : this.saw(n, lead, where, trail)
  }

  private saw(n: number, lead: Lead, where: string, trail: string[]): Lead | 'again' | 'full' {
    if (lead.by.includes(n)) return 'again'
    const screen = this.screen(where)
    if (this.notesBy(n, screen) >= NOTES_PER_SCREEN) return 'full'
    lead.by.push(n)
    this.findings.push({ explorer: n, source: lead.source, severity: lead.severity, where, note: lead.note, trail: trail.slice(-5),
      at: new Date().toISOString(), screen, lead: lead.id })
    return lead
  }

  /** An explorer arrived at `screen`. */
  arrived(screen: string): void {
    this.arrivals.set(screen, (this.arrivals.get(screen) ?? 0) + 1)
  }

  /** The screens no explorer has opened yet. */
  unseen(): string[] {
    return this.screens.filter((s) => !this.arrivals.has(s))
  }

  /**
   * The screen the explorers have seen least, other than `from`: the fewest arrivals, then the fewest
   * leads. It is counted as arrived at straight away, so two explorers moved at once go different ways.
   */
  leastSeen(from: string): string | undefined {
    const pick = this.screens.filter((s) => s !== from)
      .map((s, i) => ({ s, i, a: this.arrivals.get(s) ?? 0, l: this.leads.filter((x) => x.screen === s).length }))
      .sort((x, y) => x.a - y.a || x.l - y.l || x.i - y.i)[0]?.s
    if (pick !== undefined) this.arrived(pick)
    return pick
  }
}

export interface ExplorerSummary {
  explorer: number
  steps: number
  stopped: 'time' | 'done' | 'cap' | 'steps' | 'error'
  detail: string
  /** B25.5 — the feature it was sent to first. */
  start?: string
  /** B26.19 — how many screens it opened, and how many notes it made. */
  screens?: number
  notes?: number
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
  | { action: 'same'; lead: number }
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
    case 'same': {
      const id = n(v.lead) ?? (typeof v.lead === 'string' && /^L?\d+$/i.test(v.lead.trim()) ? Number(v.lead.trim().replace(/^L/i, '')) : undefined)
      return id === undefined ? undefined : { action: 'same', lead: id }
    }
    case 'done': return { action: 'done' }
    default: return undefined
  }
}

/** B25.5 — a feature of the app and the address it opens at. */
export interface Area {
  feature: string
  path: string
}

const short = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s).replace(/\s+/g, ' ')

/** B26.19 — what has been noted already, here and by this explorer elsewhere, and where nobody has been. */
function notesSoFar(n: number, book: Notebook, here: string): string[] {
  const there = book.on(here).slice(0, 15)
  const mine = book.of(n).filter((l) => l.screen !== here).slice(-10)
  const unseen = book.unseen()
  return [
    `Already noted on this screen (${here}), by you and the other explorers — never note one of these again, in any words;`,
    'if you see the same thing, say so with {"action":"same","lead":N}, N the number after its L:',
    ...(there.length > 0 ? there.map((l) => `  L${l.id}, seen by ${l.by.length === 1 ? `explorer ${l.by[0]}` : `explorers ${l.by.join(', ')}`}: ${short(l.note, 160)}`) : ['  nothing yet']),
    `You have made ${book.notesBy(n, here)} of at most ${NOTES_PER_SCREEN} notes on this screen; after the last you are moved to the screen the explorers have seen least.`,
    `Your notes elsewhere: ${mine.length > 0 ? mine.map((l) => `${l.screen}: ${short(l.note, 90)}`).join('; ') : 'none'}`,
    ...(unseen.length > 0 ? [`Screens no explorer has opened yet: ${unseen.join(', ')}`] : []),
  ]
}

function prompt(step: number, screen: Screen, trail: string[], seen: string[], features: Area[], start: Area | undefined, notes: string[]): string {
  return [
    'You are an explorer testing Talyvor, a web app for working with AI models (Chat, Features, Docs, Track, Wallets, Billing and more).',
    'You are signed in as a test user with test credits. Use it the way a curious new customer would: open its screens, try its',
    'features with small realistic inputs, and look for anything that seems wrong — an error, a broken or empty screen that should',
    'have content, figures that do not add up, text that contradicts itself or the screen, a control that does nothing.',
    'Do not sign out, and do not sign up a new account. Keep chat questions short.',
    ...(features.length > 0 ? ['', `Talyvor's features, each at its address: ${features.map((f) => `${f.feature} (${f.path})`).join(', ')}.`] : []),
    ...(start !== undefined ? [`Start with ${start.feature} (${start.path}): the scripted testers covered it least. Try everything it offers, then go on to the others.`] : []),
    '',
    `Step ${step} of at most ${MAX_STEPS}. You are at ${screen.url} ("${screen.title}").`,
    `Your last moves: ${trail.length > 0 ? trail.slice(-6).join(' → ') : 'none yet'}`,
    `Seen by the browser since your last move: ${seen.length > 0 ? seen.join('; ') : 'nothing wrong'}`,
    '',
    ...notes,
    '',
    'The screen\'s text (cut short):',
    screen.text,
    '',
    'Its controls, by number:',
    ...screen.controls.map((c) => `[${c.i}] ${c.tag}${c.role !== '' ? ` role=${c.role}` : ''}${c.type !== '' ? ` type=${c.type}` : ''} "${c.name}"`),
    '',
    'Reply with ONE JSON object and nothing else, one of:',
    '{"action":"click","target":N} {"action":"fill","target":N,"text":"..."} {"action":"press","key":"Enter"}',
    '{"action":"goto","path":"/features"} {"action":"finding","note":"what looks wrong, and where","severity":"high|medium|low"}',
    '{"action":"same","lead":N} {"action":"done"}',
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
  /** B26.19 — the run's one notebook, shared by all its explorers. */
  notebook: Notebook
}

const NOT_WRITTEN = { again: 'it had noted that already', full: `its ${NOTES_PER_SCREEN} notes on this screen were made`, unknown: 'there is no such lead' }

/** One explorer's session. Its notes go into the shared notebook as they are made. */
export async function explore(n: number, app: AppUser, opts: ExploreOptions): Promise<ExplorerSummary> {
  const page = app.page
  const book = opts.notebook
  const model = opts.catalog.find((m) => m.id === opts.model)
  if (model === undefined) return { explorer: n, steps: 0, stopped: 'error', detail: `the catalog has no model ${opts.model}` }
  const seen: string[] = []
  const trail: string[] = []
  const opened = new Set<string>()
  const end = (steps: number, stopped: ExplorerSummary['stopped'], detail: string): ExplorerSummary =>
    ({ explorer: n, steps, stopped, detail, screens: opened.size, notes: book.findings.filter((f) => f.explorer === n).length })
  page.on('pageerror', (e) => {
    seen.push(`page error: ${e.message.slice(0, 160)}`)
    book.write(n, 'browser', 'auto', new URL(page.url()).pathname, `page error: ${e.message.slice(0, 300)}`, trail)
  })
  page.on('response', (r) => {
    if (r.status() >= 500) {
      const path = new URL(r.url()).pathname
      seen.push(`${r.status()} from ${path}`)
      book.write(n, 'browser', 'auto', new URL(page.url()).pathname, `${r.request().method()} ${path} answered ${r.status()}`, trail)
    }
  })

  // The screen it is on, and for how many steps in a row it has been there.
  let here: string | undefined
  let dwell = 0
  const moveOn = async (why: string): Promise<void> => {
    const to = book.leastSeen(here ?? '')
    if (to === undefined) return
    trail.push(`moved to ${to}, the screen the explorers have seen least: ${why}`)
    here = to
    dwell = 0
    await page.goto(new URL(to, page.url()).toString()).catch(() => undefined)
    await page.waitForTimeout(1_000)
  }

  if (opts.start !== undefined) {
    await page.goto(new URL(opts.start.path, page.url()).toString()).catch(() => undefined)
    trail.push(`goto ${opts.start.path} (its starting feature, ${opts.start.feature})`)
  }
  const deadline = Date.now() + opts.minutes * 60_000
  let step = 0
  while (step < MAX_STEPS) {
    if (Date.now() >= deadline) return end(step, 'time', `${opts.minutes} minutes up`)
    step++
    const screen = await observe(page)
    const at = book.screen(screen.url)
    opened.add(at)
    if (at !== here) {
      book.arrived(at)
      here = at
      dwell = 0
    }
    const ask = prompt(step, screen, trail, seen.splice(0), opts.features, opts.start, notesSoFar(n, book, at))
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
      if (e instanceof CapReached) return end(step - 1, 'cap', e.message)
      return end(step - 1, 'error', e instanceof Error ? e.message : String(e))
    }
    const move = parseMove(reply.text)
    if (move === undefined) {
      trail.push(`(an unreadable reply: ${reply.text.slice(0, 60)})`)
    } else if (move.action === 'done') {
      return end(step, 'done', 'the explorer said it was done')
    } else if (move.action === 'finding' || move.action === 'same') {
      const r = move.action === 'finding' ? book.write(n, 'explorer', move.severity ?? 'medium', screen.url, move.note, trail)
        : book.same(n, move.lead, screen.url, trail)
      trail.push(typeof r === 'string' ? `${move.action === 'same' ? `"same as L${move.lead}"` : 'a note'} on ${screen.url} NOT WRITTEN: ${NOT_WRITTEN[r]}`
        : r.by.length > 1 ? `saw lead L${r.id} on ${screen.url} too` : `noted lead L${r.id} on ${screen.url}`)
      if (r !== 'again' && r !== 'unknown' && book.notesBy(n, at) >= NOTES_PER_SCREEN) {
        await moveOn(`its ${NOTES_PER_SCREEN} notes on ${at} are made`)
        continue
      }
    } else {
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
    if (++dwell >= DWELL_STEPS) await moveOn(`${DWELL_STEPS} steps in a row on ${at}`)
  }
  return end(step, 'steps', `${MAX_STEPS} steps taken`)
}
