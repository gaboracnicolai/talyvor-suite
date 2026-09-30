// B25.5 — THE COVERAGE MAP. What there is to test is read from the code on every run, never kept as a
// list by hand: every screen the web app mounts (apps/web/src/App.tsx and the areas it mounts under a
// splat), every route the BFF registers (apps/bff/lens.go), and every route Lens registers (its
// cmd/lens and internal/api, from a checkout of talyvor-lens). What was tested is recorded while the
// run happens: each screen a tester's browser opened, each BFF request it made and each Lens request
// the harness made, with the scenario that made it, its status and how long it took.
//
// A Lens route the app reaches through the BFF is counted when a BFF route that was exercised leads to
// it, with the same method: the BFF path with /api taken off, or a path its registration names
// (wsProxyFixed("/lxc/balance")), is the Lens path itself, /v1/<it> or /v1/workspaces/{ws}/<it> — the
// ways the BFF's proxies build one. A Lens path the BFF builds any other way is not linked, so the map
// under-counts those; where two Lens routes fit (GET /api/marketplace/listings: the public list and the
// workspace's own) both are linked, and the row names the BFF route it came through.
//
// Each entry ends in one state: covered (by the scenarios named), seen by the explorers only (no oracle
// checked it), cannot be tested yet (and why), or not covered.

import { execFile } from 'node:child_process'
import { access, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

export type Kind = 'screen' | 'bff' | 'lens'

export interface Entry {
  kind: Kind
  /** A screen's path (react-router pattern) or a route's pattern as registered. */
  path: string
  /** GET for a screen; ANY for a route registered for every method. */
  method: string
  /** Screens: the title the console gives it, or the public page's own name. Routes: ''. */
  feature: string
  /** Screens only: the component it renders. */
  component?: string
  /** Screens only: outside the sign-in gate, so the console's heading does not name it. */
  public?: boolean
  /** BFF only: the paths its registration names, which link it to Lens routes. */
  names?: string[]
}

export interface Inventory {
  screens: Entry[]
  bff: Entry[]
  lens: Entry[]
  /** Why Lens's routes are not listed, when they are not. */
  lensMissing?: string
}

/** "IssueDetail" → "Issue Detail". */
const words = (component: string): string => component.replace(/([a-z])([A-Z])/g, '$1 $2')

// ── SCREENS ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The screens apps/web mounts: CONSOLE_ROUTES (behind the sign-in gate, each with its title), the
 * public routes beside the gate, and — for a route ending in /* — the routes its area mounts under it.
 */
export async function screensFrom(webSrc: string): Promise<Entry[]> {
  const app = await readFile(join(webSrc, 'App.tsx'), 'utf8')
  const files = new Map<string, string>()
  for (const m of app.matchAll(/^import \{([^}]+)\} from '\.\/(areas\/[^']+|routes\/[^']+)'/gm)) {
    for (const name of m[1].split(',').map((s) => s.trim()).filter((s) => s !== '')) files.set(name, m[2])
  }
  const mounted: { path: string; feature: string; component: string; public?: boolean }[] = []
  const table = /export const CONSOLE_ROUTES[\s\S]*?\n\]/.exec(app)?.[0] ?? ''
  for (const m of table.matchAll(/\{ path: '([^']+)', title: '([^']+)', element: <(\w+)/g)) {
    mounted.push({ path: m[1], feature: m[2], component: m[3] })
  }
  const outer = /export function App\(\)[\s\S]*$/.exec(app)?.[0] ?? ''
  for (const m of outer.matchAll(/<Route path="([^"]+)" element=\{<(\w+)/g)) {
    mounted.push({ path: m[1], feature: words(m[2]), component: m[2], public: true })
  }
  if (mounted.length === 0) throw new Error(`no routes found in ${join(webSrc, 'App.tsx')}`)

  const out: Entry[] = []
  for (const r of mounted) {
    if (!r.path.endsWith('/*')) {
      out.push({ kind: 'screen', path: r.path, method: 'GET', feature: r.feature, component: r.component, public: r.public })
      continue
    }
    const base = r.path.slice(0, -2)
    const file = files.get(r.component)
    const src = file === undefined ? '' : await readFile(join(webSrc, `${file}.tsx`), 'utf8').catch(() => '')
    let found = 0
    for (const m of src.matchAll(/<Route (index|path="([^"]+)") element=\{<(\w+)/g)) {
      if (m[2] === '*') continue
      out.push({ kind: 'screen', path: m[1] === 'index' ? base : `${base}/${m[2]}`, method: 'GET', feature: r.feature, component: m[3] })
      found++
    }
    if (found === 0) out.push({ kind: 'screen', path: base, method: 'GET', feature: r.feature, component: r.component, public: r.public })
  }
  return out
}

// ── BFF ROUTES ──────────────────────────────────────────────────────────────────────────────────────

/** The BFF's routes: every mux.HandleFunc / mux.Handle in apps/bff/lens.go, with the paths each names. */
export function bffRoutesFrom(lensGo: string): Entry[] {
  const out: Entry[] = []
  for (const m of lensGo.matchAll(/\bmux\.Handle(?:Func)?\(\s*"([^"]+)"/g)) {
    // The statement runs to the parenthesis that closes this call.
    let depth = 0
    let end = m.index + m[0].indexOf('(')
    for (; end < lensGo.length; end++) {
      if (lensGo[end] === '(') depth++
      else if (lensGo[end] === ')' && --depth === 0) break
    }
    const rest = lensGo.slice(m.index + m[0].length, end)
    const names = [...rest.matchAll(/"(\/[^"]*)"/g)].map((n) => n[1])
    const [method, path] = /^[A-Z]+ /.test(m[1]) ? m[1].split(' ', 2) : ['ANY', m[1]]
    out.push({ kind: 'bff', path, method, feature: '', names })
  }
  if (out.length === 0) throw new Error('no routes found in the BFF\'s lens.go')
  return out
}

// ── LENS ROUTES ─────────────────────────────────────────────────────────────────────────────────────

const VERB: Record<string, string> = {
  Get: 'GET', Post: 'POST', Put: 'PUT', Patch: 'PATCH', Delete: 'DELETE', Head: 'HEAD', Options: 'OPTIONS',
  get: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH', del: 'DELETE', delete: 'DELETE',
  Handle: 'ANY', HandleFunc: 'ANY',
}

/**
 * The routes one Go file of Lens registers on its chi router: r.Get("/p", …), r.Handle("/p", …),
 * r.Method("GET", "/p", …), and Lens's own registrars (econ.post(authed, "/p", …)). A path built in a
 * loop — "/v1/admin/held-mints/"+mt+"/adjudicate" over `for _, mt := range []string{…}` — is expanded.
 */
export function lensRoutesFromGo(src: string): Entry[] {
  const out: Entry[] = []
  const call = /\.(Get|Post|Put|Patch|Delete|Head|Options|Handle|HandleFunc|Method|MethodFunc|get|post|put|patch|del|delete)\(\s*(?:"([A-Z]+)"\s*,\s*)?(?:[A-Za-z_][\w.]*\s*,\s*)?"(\/[^"]*)"(?:\s*\+\s*(\w+)(?:\s*\+\s*"([^"]*)")?)?/g
  for (const m of src.matchAll(call)) {
    const method = m[2] ?? VERB[m[1]]
    if (method === undefined) continue
    if (m[4] === undefined) {
      out.push({ kind: 'lens', path: m[3], method, feature: '' })
      continue
    }
    const loops = [...src.slice(0, m.index).matchAll(new RegExp(`for _, ${m[4]} := range \\[\\]string\\{([^}]*)\\}`, 'g'))]
    const values = loops.length === 0 ? [] : [...loops[loops.length - 1][1].matchAll(/"([^"]*)"/g)].map((v) => v[1])
    const tail = m[5] ?? ''
    if (values.length === 0) out.push({ kind: 'lens', path: `${m[3]}{${m[4]}}${tail}`, method, feature: '' })
    for (const v of values) out.push({ kind: 'lens', path: m[3] + v + tail, method, feature: '' })
  }
  return out
}

/** Every route the Lens binary registers, from a checkout: cmd/lens and internal/api, tests left out. */
export async function lensRoutesFrom(lensSrc: string): Promise<Entry[]> {
  const seen = new Map<string, Entry>()
  for (const dir of ['cmd/lens', 'internal/api']) {
    const names = (await readdir(join(lensSrc, dir))).filter((f) => f.endsWith('.go') && !f.endsWith('_test.go')).sort()
    for (const f of names) {
      for (const e of lensRoutesFromGo(await readFile(join(lensSrc, dir, f), 'utf8'))) seen.set(`${e.method} ${e.path}`, e)
    }
  }
  if (seen.size === 0) throw new Error(`no routes found under ${lensSrc}/cmd/lens`)
  return [...seen.values()]
}

/**
 * Brings the run's own shallow checkout of Lens at `dir` up to its main, cloning it from `repoURL` the
 * first time. Answers why it could not, or undefined. The run does this itself rather than leave it to
 * whatever started it: a nightly loop started before this existed runs the new harness with its old
 * script, and would list no Lens route at all.
 */
export async function refreshLensCheckout(dir: string, repoURL: string): Promise<string | undefined> {
  const git = (...args: string[]) => promisify(execFile)('git', args, { timeout: 120_000 })
  try {
    if (await access(join(dir, '.git')).then(() => true, () => false)) {
      await git('-C', dir, 'fetch', '-q', '--depth', '1', 'origin', 'main')
      await git('-C', dir, 'reset', '-q', '--hard', 'FETCH_HEAD')
    } else {
      await git('clone', '-q', '--depth', '1', '--branch', 'main', repoURL, dir)
    }
    return undefined
  } catch (e) {
    return `could not bring ${dir} up to Lens's main from ${repoURL}: ${(e instanceof Error ? e.message : String(e)).split('\n')[0]}`
  }
}

/** The whole inventory. `lensSrc` 'none' (or unreadable) leaves Lens's routes out and says why. */
export async function inventory(repo: string, lensSrc: string): Promise<Inventory> {
  const screens = await screensFrom(join(repo, 'apps/web/src'))
  const bff = bffRoutesFrom(await readFile(join(repo, 'apps/bff/lens.go'), 'utf8'))
  if (lensSrc === 'none') return { screens, bff, lens: [], lensMissing: 'no Lens checkout was given (--lens-src none)' }
  try {
    return { screens, bff, lens: await lensRoutesFrom(lensSrc) }
  } catch (e) {
    return { screens, bff, lens: [], lensMissing: `Lens's source could not be read at ${lensSrc}: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ── MATCHING A REQUEST TO WHAT WAS REGISTERED ───────────────────────────────────────────────────────

/** a before b, compared left to right. */
function outranks(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}

const isParam = (seg: string): boolean => /^\{[^}]*\}$/.test(seg) || /^:\w+$/.test(seg) || seg === '*'

/**
 * Matches concrete paths to the entries they reach. A route is a pattern of segments: `{x}`, `{x:re}`
 * and `:x` take one segment, `{x...}` and a final `*` take the rest, and — for the BFF, whose mux is
 * Go's — a pattern ending in `/` takes everything under it. The most specific pattern wins, as it does
 * in both routers: an exact pattern over a subtree, then the one with more literal segments, then
 * a pattern registered for this method over one registered for every method.
 */
export class Matcher {
  private readonly compiled: { entry: Entry; re: RegExp; rank: number[] }[]

  constructor(entries: readonly Entry[], subtree: boolean) {
    this.compiled = entries.map((entry) => {
      const segs = entry.path.split('/').slice(1)
      const rest = segs.length > 0 && (/^\{\w+\.\.\.\}$/.test(segs[segs.length - 1]) || segs[segs.length - 1] === '*')
      const tree = subtree && entry.path.endsWith('/')
      const body = segs.map((s, i) => {
        if (i === segs.length - 1 && rest) return '.*'
        if (isParam(s)) return '[^/]+'
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      }).join('/')
      const re = new RegExp(`^/${body}${tree ? '.*' : ''}$`)
      const literals = segs.filter((s) => s !== '' && !isParam(s) && !/^\{\w+\.\.\.\}$/.test(s)).length
      return { entry, re, rank: [tree || rest ? 0 : 1, literals, segs.length] }
    })
  }

  match(method: string, path: string): Entry | undefined {
    let best: { entry: Entry; rank: number[] } | undefined
    for (const c of this.compiled) {
      if (c.entry.method !== 'ANY' && c.entry.method !== method) continue
      if (!c.re.test(path)) continue
      const rank = [...c.rank, c.entry.method === 'ANY' ? 0 : 1]
      if (best === undefined || outranks(rank, best.rank)) best = { entry: c.entry, rank }
    }
    return best?.entry
  }
}

// ── WHAT A RUN RECORDS ──────────────────────────────────────────────────────────────────────────────

/** Who made a request: the scenario (or 'sign-in', 'explorer') and the user whose outcome it is part of. */
export interface Tag {
  scenario: string
  user: number
}

export interface Hit {
  kind: Kind
  scenario: string
  user: number
  method: string
  /** The concrete path, without its query. */
  path: string
  /** The answer's status; 0 when the request failed without one. A screen opened is 200. */
  status: number
  /** How long it took, in ms, when it was measured. */
  ms?: number
  /** A BFF request: the screen the browser was on when it made it. */
  from?: string
}

export interface PageError {
  scenario: string
  user: number
  where: string
  message: string
}

/** Everything the browsers and the harness did, as it happened. */
export class Recorder {
  readonly hits: Hit[] = []
  readonly errors: PageError[] = []

  hit(tag: Tag, h: Omit<Hit, 'scenario' | 'user'>): void {
    this.hits.push({ ...h, scenario: tag.scenario, user: tag.user })
  }

  pageError(tag: Tag, where: string, message: string): void {
    this.errors.push({ scenario: tag.scenario, user: tag.user, where, message: message.slice(0, 300) })
  }

  /** The screens one scenario of one user opened. */
  screensOf(tag: Tag): string[] {
    return [...new Set(this.hits.filter((h) => h.kind === 'screen' && h.scenario === tag.scenario && h.user === tag.user).map((h) => h.path))]
  }
}

// ── THE MAP ─────────────────────────────────────────────────────────────────────────────────────────

export type State = 'covered' | 'explorers only' | 'cannot be tested yet' | 'not covered'

export interface Timing {
  n: number
  p50: number
  p95: number
  max: number
}

export interface Row {
  kind: Kind
  path: string
  method: string
  /** Screens: their feature. Routes: '' (they are listed with the screens that called them). */
  feature: string
  state: State
  /** The scenarios that reached it, each with how many users' runs of it did. */
  by: Record<string, number>
  /** How many explorers reached it. */
  explorers: number
  why?: string
  /** Each status it answered, and how often. */
  answers: Record<string, number>
  timing?: Timing
  /** BFF routes: the features whose screens called it. */
  from: string[]
  /** Lens routes: the BFF routes that led to it. */
  through: string[]
}

export interface CoverageMap {
  screens: Row[]
  bff: Row[]
  lens: Row[]
  lensMissing?: string
  /** Page errors the browsers saw, one per feature and message. */
  errors: { feature: string; where: string; message: string; count: number; scenarios: string[] }[]
}

/**
 * WHY SOMETHING CANNOT BE TESTED YET — one reason per kind of feature, each naming what would have to
 * change. It is consulted only for an entry nothing reached: an entry a scenario covered is covered.
 */
const CANNOT: { kind: Kind; path: RegExp; method?: RegExp; why: string }[] = [
  { kind: 'screen', path: /^\/(operator|marketplace\/review)$/, why: 'operator only: a tester is never an operator (B17.1)' },
  { kind: 'bff', path: /^\/api\/admin\//, why: 'operator only: a tester is never an operator (B17.1)' },
  { kind: 'bff', path: /^\/auth\/(login|callback)$/, why: 'the identity provider\'s sign-in: testers sign in through /auth/synthetic (B17.2)' },
  { kind: 'bff', path: /^\/api\/(billing\/subscribe|lxc\/checkout|billing\/subscription\/(cancel|resume|plan))$/,
    why: 'pays or changes a plan through Stripe: a synthetic workspace cannot pay (B17.1) until B25.2 (Stripe test cards)' },
  { kind: 'bff', path: /^\/api\/(agents|wallets|marketplace)\//, method: /^(POST|PUT|PATCH|DELETE|ANY)$/,
    why: 'a wallet, bank or marketplace action between test users: waits on B25.3, and B25.4 adds its scenario' },
  { kind: 'lens', path: /^\/v1\/admin\/|^\/metrics$|^\/v1\/api\/metrics\/prometheus$/, why: 'Lens\'s admin key only: testers never hold it' },
  { kind: 'lens', path: /^\/v1\/billing\/webhook$/, why: 'Stripe\'s webhook, signed with Stripe\'s secret' },
  { kind: 'lens', path: /^\/v1\/agent-cards\/authorizations$/, why: 'the card issuer\'s authorization webhook, signed by the issuer' },
  { kind: 'lens', path: /^\/v1\/provision$/, why: 'the BFF\'s provisioning secret only' },
  { kind: 'lens', path: /\/billing\/(checkout|subscribe|subscription\/(plan|cancel|resume))$/,
    why: 'pays or changes a plan through Stripe: a synthetic workspace cannot pay (B17.1) until B25.2 (Stripe test cards)' },
  { kind: 'lens', path: /^\/v1\/workspaces\/\{wsID\}\/(agents|escrows|loans|money-requests|transfers|cash-outs|marketplace)\b|^\/v1\/wallets\//,
    method: /^(POST|PUT|PATCH|DELETE|ANY)$/, why: 'a wallet, bank or marketplace action between test users: waits on B25.3, and B25.4 adds its scenario' },
]

export function cannotTest(e: Entry): string | undefined {
  return CANNOT.find((c) => c.kind === e.kind && c.path.test(e.path) && (c.method === undefined || c.method.test(e.method)))?.why
}

export function timing(ms: number[]): Timing | undefined {
  if (ms.length === 0) return undefined
  const s = [...ms].sort((a, b) => a - b)
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))]
  return { n: s.length, p50: Math.round(at(0.5)), p95: Math.round(at(0.95)), max: Math.round(s[s.length - 1]) }
}

const segsOf = (p: string): string[] => p.split('/').filter((s) => s !== '')
const wild = (s: string): boolean => isParam(s) || /^\{\w+\.\.\.\}$/.test(s)

/**
 * `route` is where the BFF sends `tail`: `tail` itself when it is a whole Lens path (/v1/…), otherwise
 * /v1/<tail> or /v1/workspaces/{ws}/<tail> — the two ways the BFF's proxies build a Lens path.
 */
function leadsTo(route: string[], tail: string[]): boolean {
  if (tail.length === 0 || !tail.some((s) => !wild(s))) return false
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((s, i) => (wild(s) && wild(b[i])) || s === b[i])
  if (tail[0] === 'v1') return same(route, tail)
  return same(route, ['v1', ...tail]) || same(route, ['v1', 'workspaces', '{ws}', ...tail])
}

/** The Lens routes a BFF route leads to, for a method it was called with. */
export function lensThrough(bff: Entry, method: string, lens: readonly Entry[]): Entry[] {
  if (/^\/api\/(track|docs)\/|^\/auth\//.test(bff.path) || !bff.path.startsWith('/api/')) return []
  const tails = [segsOf(bff.path).slice(1), ...(bff.names ?? []).map(segsOf)]
  return lens.filter((l) => (l.method === 'ANY' || method === 'ANY' || l.method === method) && tails.some((t) => leadsTo(segsOf(l.path), t)))
}

const bump = (r: Record<string, number>, k: string, n = 1) => { r[k] = (r[k] ?? 0) + n }

/** The run's map: every entry of the inventory with its state, from what was recorded. */
export function buildMap(inv: Inventory, rec: Recorder): CoverageMap {
  const screenMatch = new Matcher(inv.screens, false)
  const featureOf = (path: string): string => screenMatch.match('GET', path.replace(/(.)\/$/, '$1'))?.feature ?? '(no screen)'
  const blank = (e: Entry): Row => ({ kind: e.kind, path: e.path, method: e.method, feature: e.feature, state: 'not covered',
    by: {}, explorers: 0, answers: {}, from: [], through: [] })
  const rows = new Map<Entry, Row>()
  const ms = new Map<Entry, number[]>()
  const methods = new Map<Entry, Set<string>>()
  const who = new Map<Entry, Map<string, Set<number>>>()
  for (const e of [...inv.screens, ...inv.bff, ...inv.lens]) rows.set(e, blank(e))
  const matchers: Record<Kind, Matcher> = { screen: screenMatch, bff: new Matcher(inv.bff, true), lens: new Matcher(inv.lens, false) }

  for (const h of rec.hits) {
    const e = matchers[h.kind].match(h.kind === 'screen' ? 'GET' : h.method, h.kind === 'screen' ? h.path.replace(/(.)\/$/, '$1') : h.path)
    if (e === undefined) continue
    const r = rows.get(e)!
    const users = who.get(e) ?? new Map<string, Set<number>>()
    users.set(h.scenario, (users.get(h.scenario) ?? new Set()).add(h.user))
    who.set(e, users)
    bump(r.answers, String(h.status))
    if (h.ms !== undefined) ms.set(e, [...(ms.get(e) ?? []), h.ms])
    if (h.from !== undefined && !r.from.includes(featureOf(h.from))) r.from.push(featureOf(h.from))
    methods.set(e, (methods.get(e) ?? new Set()).add(h.method))
  }
  // A Lens route reached through the app takes the users of the BFF route that led to it.
  for (const b of inv.bff) {
    for (const m of methods.get(b) ?? []) {
      for (const l of lensThrough(b, m, inv.lens)) {
        const users = who.get(l) ?? new Map<string, Set<number>>()
        for (const [scenario, set] of who.get(b) ?? []) users.set(scenario, new Set([...(users.get(scenario) ?? []), ...set]))
        who.set(l, users)
        const rl = rows.get(l)!
        if (!rl.through.includes(`${m} ${b.path}`)) rl.through.push(`${m} ${b.path}`)
      }
    }
  }
  for (const [e, r] of rows) {
    for (const [scenario, set] of who.get(e) ?? []) {
      if (scenario === 'explorer') r.explorers = set.size
      else r.by[scenario] = set.size
    }
    r.timing = timing(ms.get(e) ?? [])
    const why = cannotTest(e)
    r.state = Object.keys(r.by).length > 0 ? 'covered' : r.explorers > 0 ? 'explorers only' : why !== undefined ? 'cannot be tested yet' : 'not covered'
    if (r.state === 'cannot be tested yet') r.why = why
  }
  const errors = new Map<string, CoverageMap['errors'][number]>()
  for (const pe of rec.errors) {
    const feature = featureOf(pe.where)
    const key = `${feature}|${pe.message}`
    const agg = errors.get(key) ?? { feature, where: pe.where, message: pe.message, count: 0, scenarios: [] }
    agg.count++
    if (!agg.scenarios.includes(pe.scenario)) agg.scenarios.push(pe.scenario)
    errors.set(key, agg)
  }
  return {
    screens: inv.screens.map((e) => rows.get(e)!),
    bff: inv.bff.map((e) => rows.get(e)!),
    lens: inv.lens.map((e) => rows.get(e)!),
    lensMissing: inv.lensMissing,
    errors: [...errors.values()],
  }
}

/** Each kind's rows by state, for the headline and TESTERS.md. */
export function tally(rows: readonly Row[]): Record<State, number> & { total: number } {
  const t = { covered: 0, 'explorers only': 0, 'cannot be tested yet': 0, 'not covered': 0, total: rows.length }
  for (const r of rows) t[r.state]++
  return t
}

/** "36 of 39 covered, 2 cannot be tested yet, 1 not covered". */
export function tallyLine(rows: readonly Row[]): string {
  const t = tally(rows)
  return [`${t.covered} of ${t.total} covered`,
    ...(['explorers only', 'cannot be tested yet', 'not covered'] as const).filter((s) => t[s] > 0).map((s) => `${t[s]} ${s}`)].join(', ')
}

/** The features a person can open, least covered first — where the explorers start (B25.5 (3)). */
export function leastCovered(map: CoverageMap, outcomesByFeature: Map<string, number>): { feature: string; path: string }[] {
  const first = new Map<string, string>()
  for (const r of map.screens) {
    if (r.state === 'cannot be tested yet' || r.path.includes(':')) continue
    if (!first.has(r.feature)) first.set(r.feature, r.path)
  }
  const hits = (f: string) => map.screens.filter((r) => r.feature === f).reduce((n, r) => n + Object.values(r.by).reduce((a, b) => a + b, 0), 0)
  return [...first.entries()]
    .map(([feature, path]) => ({ feature, path, n: outcomesByFeature.get(feature) ?? 0, h: hits(feature) }))
    .sort((a, b) => a.n - b.n || a.h - b.h || a.feature.localeCompare(b.feature))
    .map(({ feature, path }) => ({ feature, path }))
}
