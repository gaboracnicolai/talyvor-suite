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
// B34.9 — Track and Docs too: every route talyvor-track and talyvor-docs register (their cmd/<name> and
// internal/, from checkouts kept up to main like Lens's). Neither is reachable but through the BFF, so a
// Track or Docs route is counted through the BFF route that sends a request to it — read from the BFF's
// own Go: each call it makes to Track or Docs, the path it builds there and the method it sends.
//
// Each entry ends in one state: covered (by the scenarios named), seen by the explorers only (no oracle
// checked it), cannot be tested yet (and why), or not covered.

import { execFile } from 'node:child_process'
import { access, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

export type Product = 'track' | 'docs'
export type Kind = 'screen' | 'bff' | 'lens' | Product

/** B34.9 — one request a BFF route sends to Track or Docs. */
export interface Upstream {
  product: Product
  /** The method it sends, or SAME when it sends the one it was called with. */
  method: string
  /** The path it builds, `{}` where a value goes. */
  path: string
}

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
  /** BFF only: what it sends to Track and Docs, which links it to their routes. */
  upstreams?: Upstream[]
}

export interface Inventory {
  screens: Entry[]
  bff: Entry[]
  lens: Entry[]
  /** Why Lens's routes are not listed, when they are not. */
  lensMissing?: string
  track: Entry[]
  docs: Entry[]
  trackMissing?: string
  docsMissing?: string
  /**
   * B34.9 — why a Track or Docs route no BFF route sends a request to cannot be tested, when that is
   * true of this checkout: the deploy files publish both only to the BFF, and every call the BFF makes
   * to them was read. Undefined when it is not, and then such a route reads not covered.
   */
  productsBehindBFF?: string
  /** Why the deploy files do not show that, when they do not. */
  productsNotBehind?: string
  /** Calls the BFF makes to Track or Docs whose path could not be read (each `file: the call`). */
  unreadCalls: string[]
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
  return bffRegistrations(lensGo).map((r) => r.entry)
}

/** Each BFF route with the text of the call that registers it: its handler, which upstreamsOf reads. */
function bffRegistrations(lensGo: string): { entry: Entry; handler: string }[] {
  const out: { entry: Entry; handler: string }[] = []
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
    out.push({ entry: { kind: 'bff', path, method, feature: '', names }, handler: rest })
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
 * Brings the run's own shallow checkout of Lens (or Track, or Docs — `name`) at `dir` up to its main,
 * cloning it from `repoURL` the first time. Answers why it could not, or undefined. The run does this
 * itself rather than leave it to whatever started it: a nightly loop started before this existed runs
 * the new harness with its old script, and would list no Lens route at all.
 */
export async function refreshLensCheckout(dir: string, repoURL: string, name = 'Lens'): Promise<string | undefined> {
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
    return `could not bring ${dir} up to ${name}'s main from ${repoURL}: ${(e instanceof Error ? e.message : String(e)).split('\n')[0]}`
  }
}

// ── TRACK AND DOCS ROUTES (B34.9) ───────────────────────────────────────────────────────────────────

/**
 * Go source with its comments blanked, every offset kept; with `strings`, the insides of its string and
 * rune literals too, so that what is left can be counted for braces and parentheses.
 */
function goMask(src: string, strings: boolean): string {
  let out = ''
  for (let i = 0; i < src.length;) {
    const c = src[i]
    if (c === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) {
      const block = src[i + 1] === '*'
      const stop = block ? src.indexOf('*/', i + 2) : src.indexOf('\n', i)
      const end = stop === -1 ? src.length : block ? stop + 2 : stop
      out += src.slice(i, end).replace(/[^\n]/g, ' ')
      i = end
      continue
    }
    if (c === '"' || c === '\'' || c === '`') {
      let j = i + 1
      while (j < src.length && src[j] !== c && !(c !== '`' && src[j] === '\n')) j += c !== '`' && src[j] === '\\' ? 2 : 1
      const end = Math.min(src.length, j + 1)
      out += strings ? c + src.slice(i + 1, end - 1).replace(/[^\n]/g, ' ') + src.slice(Math.max(i + 1, end - 1), end) : src.slice(i, end)
      i = end
      continue
    }
    out += c
    i++
  }
  return out
}

/** The index of the bracket that closes the one at `open`, in masked source. */
function closing(shape: string, open: number): number {
  let depth = 0
  for (let i = open; i < shape.length; i++) {
    if ('([{'.includes(shape[i])) depth++
    else if (')]}'.includes(shape[i]) && --depth === 0) return i
  }
  return shape.length
}

/** `a, f(b, c), "d,e"` → ['a', 'f(b, c)', '"d,e"']: split at `sep` where no bracket or string is open. */
function splitTop(code: string, sep: string): string[] {
  const shape = goMask(code, true)
  const out: string[] = []
  let depth = 0
  let from = 0
  for (let i = 0; i < shape.length; i++) {
    if ('([{'.includes(shape[i])) depth++
    else if (')]}'.includes(shape[i])) depth--
    else if (shape[i] === sep && depth === 0) {
      out.push(code.slice(from, i).trim())
      from = i + 1
    }
  }
  const last = code.slice(from).trim()
  return out.length === 0 && last === '' ? [] : [...out, last]
}

const joinPath = (prefix: string, p: string): string => (p === '/' || p === '' ? prefix || '/' : prefix + p)

/**
 * The routes one Go file of a chi service registers, each with the prefix of every
 * r.Route("/p", func(r chi.Router) { … }) it sits in and the function it is registered in; and the
 * prefix in force wherever the file hands its router to a handler's Mount(r), MountService(r) or
 * MountPublic(r).
 */
export function chiRoutesFromGo(src: string): { routes: { method: string; path: string; fn: string }[]; mounts: string[] } {
  const code = goMask(src, false)
  const shape = goMask(src, true)
  const opens = new Map<number, string>()
  for (const m of code.matchAll(/\.Route\(\s*"([^"]*)"\s*,\s*func\s*\(/g)) {
    const brace = shape.indexOf('{', m.index + m[0].length)
    if (brace !== -1) opens.set(brace, m[1])
  }
  // chi's own registrations only — Lens's lower-case registrars and an identifier before the path are
  // not, so a client's c.get(ctx, "/v1/…") to another service is not read as a route of this one.
  const call = /\.(Get|Post|Put|Patch|Delete|Head|Options|Handle|HandleFunc|Method|MethodFunc)\(\s*(?:"([A-Z]+)"\s*,\s*)?"(\/[^"]*)"/g
  const events: { at: number; route?: { method: string; path: string } }[] = [
    ...[...code.matchAll(call)].flatMap((m) => {
      const method = m[2] ?? VERB[m[1]]
      return method === undefined ? [] : [{ at: m.index, route: { method, path: m[3] } }]
    }),
    ...[...code.matchAll(/\.Mount\w*\(\s*\w+\s*\)/g)].map((m) => ({ at: m.index })),
  ].sort((a, b) => a.at - b.at)
  const funcs = [...code.matchAll(/^func\s+(?:\([^)]*\)\s*)?(\w+)/gm)].map((m) => ({ at: m.index, name: m[1] }))
  const fnAt = (at: number) => funcs.filter((f) => f.at < at).pop()?.name ?? ''
  const routes: { method: string; path: string; fn: string }[] = []
  const mounts: string[] = []
  const stack: { depth: number; prefix: string }[] = []
  const prefix = () => stack[stack.length - 1]?.prefix ?? ''
  let depth = 0
  let next = 0
  for (let i = 0; i <= shape.length && next < events.length; i++) {
    for (; next < events.length && events[next].at === i; next++) {
      const r = events[next].route
      if (r === undefined) mounts.push(prefix())
      else routes.push({ method: r.method, path: joinPath(prefix(), r.path), fn: fnAt(i) })
    }
    if (shape[i] === '{') {
      depth++
      const p = opens.get(i)
      if (p !== undefined) stack.push({ depth, prefix: joinPath(prefix(), p) })
    } else if (shape[i] === '}') {
      if (stack[stack.length - 1]?.depth === depth) stack.pop()
      depth--
    }
  }
  return { routes, mounts }
}

/**
 * Every route Track or Docs registers, from a checkout: cmd/<product>, where the router is built, and
 * internal/, whose handlers' Mount functions it calls — under the one prefix (/v1) every Mount(r) in
 * cmd/<product> sits in. Mounted under more than one, which handler is under which cannot be read here,
 * and it says so. A route internal/ registers outside a Mount function is on a router of its own (Docs'
 * custom-domain pages) and is listed as registered.
 */
export async function productRoutesFrom(src: string, product: Product): Promise<Entry[]> {
  const goFiles = async (dir: string, deep: boolean) => (await readdir(join(src, dir), { recursive: deep }))
    .map(String).filter((f) => f.endsWith('.go') && !f.endsWith('_test.go')).sort().map((f) => join(src, dir, f))
  const seen = new Map<string, Entry>()
  const add = (path: string, method: string) => seen.set(`${method} ${path}`, { kind: product, path, method, feature: '' })
  const prefixes = new Set<string>()
  for (const f of await goFiles(join('cmd', product), false)) {
    const { routes, mounts } = chiRoutesFromGo(await readFile(f, 'utf8'))
    for (const r of routes) add(r.path, r.method)
    for (const m of mounts) prefixes.add(m)
  }
  if (prefixes.size !== 1) {
    throw new Error(`cmd/${product} mounts its handlers under ${prefixes.size === 0 ? 'no prefix that could be read' : [...prefixes].join(' and ')}`)
  }
  const [base] = prefixes
  for (const f of await goFiles('internal', true)) {
    for (const r of chiRoutesFromGo(await readFile(f, 'utf8')).routes) add(r.fn.startsWith('Mount') ? joinPath(base, r.path) : r.path, r.method)
  }
  if (seen.size === 0) throw new Error(`no routes found under ${src}/cmd/${product}`)
  return [...seen.values()]
}

// ── WHAT THE BFF SENDS TO TRACK AND DOCS (B34.9) ────────────────────────────────────────────────────

interface GoFunc {
  file: string
  params: string[]
  /** Comments blanked, strings kept. */
  body: string
}

interface GoPackage {
  /** Methods on the BFF's *app, by name. */
  methods: Map<string, GoFunc>
  /** Plain functions, by name. */
  funcs: Map<string, GoFunc>
  /** String constants that are paths. */
  consts: Map<string, string>
}

/** The BFF's functions, methods and path constants, from its non-test Go files. */
function goPackage(files: { name: string; src: string }[]): GoPackage {
  const pkg: GoPackage = { methods: new Map(), funcs: new Map(), consts: new Map() }
  for (const { name, src } of files) {
    const code = goMask(src, false)
    const shape = goMask(src, true)
    for (const m of code.matchAll(/^func\s+(\(\s*\w+\s+\*?app\s*\)\s*)?(\w+)\s*\(/gm)) {
      const open = m.index + m[0].length - 1
      const close = closing(shape, open)
      const params = splitTop(code.slice(open + 1, close), ',').map((p) => /^\w+/.exec(p)?.[0] ?? '')
      // The body is the first { after the parameters that does not open a result type's interface{} or struct{…}.
      let brace = shape.indexOf('{', close)
      while (brace !== -1 && /\b(interface|struct)\s*$/.test(shape.slice(close, brace))) brace = shape.indexOf('{', closing(shape, brace) + 1)
      if (brace === -1) continue
      const end = closing(shape, brace)
      ;(m[1] === undefined ? pkg.funcs : pkg.methods).set(m[2], { file: name, params, body: code.slice(brace + 1, end) })
    }
    for (const m of code.matchAll(/^(?:const\s+|\t)(\w+)(?:\s+string)?\s*=\s*"(\/[^"]*)"\s*$/gm)) {
      if (/^const\b/.test(m[0]) || /\bconst \([^)]*$/.test(code.slice(0, m.index))) pkg.consts.set(m[1], m[2])
    }
  }
  return pkg
}

/** One function being read, and what its caller passed for each of its parameters. */
interface Scope {
  fn: GoFunc
  args: Map<string, { expr: string; scope: Scope | undefined }>
}

/** The expression from `at` to the end of its statement. */
function statementAt(code: string, at: number): string {
  const shape = goMask(code, true)
  let depth = 0
  for (let i = at; i < shape.length; i++) {
    if ('([{'.includes(shape[i])) depth++
    else if (')]}'.includes(shape[i])) depth--
    if ((shape[i] === '\n' && depth === 0 && !/[+,(]\s*$/.test(shape.slice(at, i))) || depth < 0) return code.slice(at, i)
  }
  return code.slice(at)
}

/** What a Go expression is, as a path: its literals, and `{}` for each value. Undefined when it cannot be read. */
function pathOf(expr: string, scope: Scope | undefined, pkg: GoPackage, depth = 0): string | undefined {
  if (depth > 12) return undefined
  let out = ''
  for (const piece of splitTop(expr, '+')) {
    const lit = /^"([^"\\]*)"$/.exec(piece)
    if (lit !== null) {
      out += lit[1]
      continue
    }
    const call = /^(\w+)\(([\s\S]*)\)$/.exec(piece)
    const fn = call === null ? undefined : pkg.funcs.get(call[1])
    if (call !== null && fn !== undefined) {
      const returns = [...fn.body.matchAll(/\breturn\s+/g)]
      if (returns.length !== 1) return undefined
      const args = splitTop(call[2], ',')
      const inner: Scope = { fn, args: new Map(fn.params.map((p, i) => [p, { expr: args[i] ?? '', scope }])) }
      const v = pathOf(statementAt(fn.body, returns[0].index + returns[0][0].length), inner, pkg, depth + 1)
      if (v === undefined) return undefined
      out += v
      continue
    }
    if (/^\w+$/.test(piece)) {
      const bound = scope?.args.get(piece)
      if (bound !== undefined) {
        const v = pathOf(bound.expr, bound.scope, pkg, depth + 1)
        if (v === undefined) return undefined
        out += v
        continue
      }
      // A parameter its caller did not bind holds what the caller passes, which is not known here.
      if (scope?.fn.params.includes(piece)) return undefined
      const local = scope === undefined ? null : new RegExp(`(?:^|[;{]|\\n)\\s*${piece}\\s*:?=(?!=)\\s*`).exec(scope.fn.body)
      if (local !== null && scope !== undefined) {
        const v = pathOf(statementAt(scope.fn.body, local.index + local[0].length), scope, pkg, depth + 1)
        if (v === undefined) return undefined
        out += v
        continue
      }
      const c = pkg.consts.get(piece)
      out += c ?? '{}'
      continue
    }
    out += '{}'
  }
  return out
}

/** A method expression's verb: http.MethodPost → POST, r.Method → SAME. */
function methodOf(expr: string, scope: Scope | undefined): string {
  const bound = /^\w+$/.test(expr) ? scope?.args.get(expr) : undefined
  if (bound !== undefined) return methodOf(bound.expr, bound.scope)
  const m = /^http\.Method(\w+)$/.exec(expr) ?? /^"([A-Z]+)"$/.exec(expr)
  return m === null ? 'SAME' : m[1].toUpperCase()
}

/** The product a forwardProduct call names ("track") or a request URL starts at (a.cfg.docsBaseURL). */
function productOf(expr: string, scope: Scope | undefined): Product | undefined {
  const bound = /^\w+$/.test(expr) ? scope?.args.get(expr) : undefined
  if (bound !== undefined) return productOf(bound.expr, bound.scope)
  const m = /^"(track|docs)"$/.exec(expr) ?? /\b(track|docs)BaseURL$/.exec(expr)
  return m === null ? undefined : m[1] as Product
}

/** The BFF's own helpers that take a product and a path: their calls are read where they are made. */
const FORWARD = new Set(['forwardProduct', 'forwardProductWith'])

/**
 * Every request a stretch of BFF code sends to Track or Docs: each forwardProduct call (product, path,
 * method) and each http.NewRequest to a Track or Docs base URL, in it and in every method of *app it
 * calls, with that method's parameters bound to what was passed. `sites` records, for each such call in
 * the package, whether its path was read.
 */
function upstreamsIn(code: string, scope: Scope | undefined, pkg: GoPackage, sites: Map<string, boolean>,
  visited: Set<string> | undefined, out: Upstream[]): void {
  const shape = goMask(code, true)
  const argsAt = (open: number) => splitTop(code.slice(open + 1, closing(shape, open)), ',')
  const site = (at: number, open: number, read: boolean) => {
    const key = `${scope?.fn.file ?? 'apps/bff/lens.go'}: ${code.slice(at, closing(shape, open) + 1).replace(/\s+/g, ' ')}`
    sites.set(key, (sites.get(key) ?? false) || read)
  }
  const push = (u: Upstream) => {
    if (!out.some((o) => o.product === u.product && o.method === u.method && o.path === u.path)) out.push(u)
  }
  for (const m of code.matchAll(/\ba\.(\w+)\(/g)) {
    const open = m.index + m[0].length - 1
    const args = argsAt(open)
    if (FORWARD.has(m[1])) {
      const product = productOf(args[2] ?? '', scope)
      if (product === undefined) continue
      const path = pathOf(args[5] ?? '', scope, pkg)
      site(m.index, open, path !== undefined)
      if (path !== undefined) push({ product, method: methodOf(args[7] ?? '', scope), path })
      continue
    }
    const fn = pkg.methods.get(m[1])
    // Each method once per argument list: the same call twice sends the same requests.
    const key = `${m[1]}(${args.join(', ')})`
    if (fn === undefined || visited === undefined || visited.has(key)) continue
    visited.add(key)
    upstreamsIn(fn.body, { fn, args: new Map(fn.params.map((p, i) => [p, { expr: args[i] ?? '', scope }])) }, pkg, sites, visited, out)
  }
  for (const m of code.matchAll(/\bhttp\.NewRequest(WithContext)?\(/g)) {
    const open = m.index + m[0].length - 1
    const args = argsAt(open)
    const [method, url] = m[1] === undefined ? args : args.slice(1)
    const [base, ...rest] = splitTop(url ?? '', '+')
    const product = productOf(base ?? '', scope)
    if (product === undefined) continue
    const path = pathOf(rest.join(' + '), scope, pkg)
    site(m.index, open, path !== undefined)
    if (path !== undefined) push({ product, method: methodOf(method ?? '', scope), path })
  }
}

/**
 * What each BFF route sends to Track and Docs, read from apps/bff, with every call the BFF makes to
 * either that could not be read — anywhere in the package, so a call no route was seen to reach is
 * counted too.
 */
export async function bffUpstreams(bffDir: string): Promise<{ routes: { entry: Entry; upstreams: Upstream[] }[]; unread: string[] }> {
  const names = (await readdir(bffDir)).filter((f) => f.endsWith('.go') && !f.endsWith('_test.go')).sort()
  const files = await Promise.all(names.map(async (name) => ({ name: `apps/bff/${name}`, src: await readFile(join(bffDir, name), 'utf8') })))
  const pkg = goPackage(files)
  const sites = new Map<string, boolean>()
  const routes = bffRegistrations(goMask(files.find((f) => f.name === 'apps/bff/lens.go')?.src ?? '', false)).map(({ entry, handler }) => {
    const upstreams: Upstream[] = []
    upstreamsIn(handler, undefined, pkg, sites, new Set(), upstreams)
    return { entry, upstreams }
  })
  // Every such call in the package, reached from a route or not: one no route reached is one the map cannot link.
  for (const [name, fn] of [...pkg.methods, ...pkg.funcs]) {
    if (!FORWARD.has(name)) upstreamsIn(fn.body, { fn, args: new Map() }, pkg, sites, undefined, [])
  }
  return { routes, unread: [...sites].filter(([, read]) => !read).map(([k]) => k) }
}

/**
 * Whether the deploy files serve Track and Docs only to the BFF: each port track-docs.compose.yaml
 * publishes is on 127.0.0.1, and the Caddyfile proxies nothing but the BFF. Answers the reason, or why not.
 */
export async function behindBFF(repo: string): Promise<{ why?: string; not?: string }> {
  const read = async (f: string) => (await readFile(join(repo, 'deploy', f), 'utf8').catch(() => '')).replace(/(^|\s)#.*$/gm, '$1')
  const ports = [...(await read('track-docs.compose.yaml')).matchAll(/^\s*-\s*"?([\d.]*:?\d+:\d+)"?\s*$/gm)].map((m) => m[1])
  const proxies = [...(await read('Caddyfile')).matchAll(/reverse_proxy\s+(\S+)/g)].map((m) => m[1])
  if (ports.length === 0) return { not: 'deploy/track-docs.compose.yaml publishes no port that could be read' }
  const open = ports.filter((p) => !p.startsWith('127.0.0.1:'))
  if (open.length > 0) return { not: `deploy/track-docs.compose.yaml publishes ${open.join(', ')} beyond 127.0.0.1` }
  const bff = proxies.filter((p) => !p.endsWith(':8787'))
  if (proxies.length === 0 || bff.length > 0) return { not: `deploy/Caddyfile proxies ${bff.join(', ') || 'nothing that could be read'}, not only the BFF` }
  return { why: `served only to the BFF (deploy/ publishes ${ports.join(', ')}), and no BFF route sends this request; one that did would make it testable` }
}

/** The whole inventory. A checkout 'none' (or unreadable) leaves that service's routes out and says why. */
export async function inventory(repo: string, lensSrc: string, trackSrc = 'none', docsSrc = 'none'): Promise<Inventory> {
  const screens = await screensFrom(join(repo, 'apps/web/src'))
  const { routes, unread } = await bffUpstreams(join(repo, 'apps/bff'))
  const bff = routes.map(({ entry, upstreams }) => ({ ...entry, upstreams }))
  const product = async (product: Product, src: string, flag: string): Promise<{ routes: Entry[]; missing?: string }> => {
    const name = product === 'track' ? 'Track' : 'Docs'
    if (src === 'none') return { routes: [], missing: `no ${name} checkout was given (--${flag} none)` }
    try {
      return { routes: await productRoutesFrom(src, product) }
    } catch (e) {
      return { routes: [], missing: `${name}'s source could not be read at ${src}: ${e instanceof Error ? e.message : String(e)}` }
    }
  }
  const [track, docs, behind] = await Promise.all([product('track', trackSrc, 'track-src'), product('docs', docsSrc, 'docs-src'), behindBFF(repo)])
  const inv: Inventory = { screens, bff, lens: [], track: track.routes, docs: docs.routes, trackMissing: track.missing, docsMissing: docs.missing,
    productsBehindBFF: unread.length === 0 ? behind.why : undefined, productsNotBehind: behind.not, unreadCalls: unread }
  if (lensSrc === 'none') return { ...inv, lensMissing: 'no Lens checkout was given (--lens-src none)' }
  try {
    return { ...inv, lens: await lensRoutesFrom(lensSrc) }
  } catch (e) {
    return { ...inv, lensMissing: `Lens's source could not be read at ${lensSrc}: ${e instanceof Error ? e.message : String(e)}` }
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
  /** B34.9 — Track's and Docs' routes, each through the BFF routes that send requests to it. */
  track: Row[]
  docs: Row[]
  trackMissing?: string
  docsMissing?: string
  /** Why a Track or Docs route no BFF route sends a request to is not given a reason, when it is not. */
  productsNotBehind?: string
  unreadCalls: string[]
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
  { kind: 'lens', path: /^\/v1\/admin\/|^\/metrics$|^\/v1\/api\/metrics\/prometheus$/, why: 'Lens\'s admin key only: testers never hold it' },
  { kind: 'lens', path: /^\/v1\/billing\/webhook(\/test)?$/, why: 'Stripe\'s webhook (live or test mode), signed with Stripe\'s secret' },
  { kind: 'lens', path: /^\/v1\/agent-cards\/authorizations$/, why: 'the card issuer\'s authorization webhook, signed by the issuer' },
  { kind: 'lens', path: /^\/v1\/provision$/, why: 'the BFF\'s provisioning secret only' },
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

/**
 * B34.9 — the Track and Docs routes a BFF route sends requests to when it is called with `method`: each
 * request it sends with that method, or with the one it was called with, to the route that would serve
 * it there (a literal segment before a value: /issues/semantic-search is not the issue {id}). A request
 * with a method of its own (POST /issues) is counted only when the BFF route is called with that method,
 * because the handler that sends it is the one that method picks (GET lists the issues, POST creates one).
 */
export function productThrough(bff: Entry, method: string, products: Record<Product, Matcher>): Entry[] {
  const out: Entry[] = []
  for (const u of bff.upstreams ?? []) {
    const sent = u.method === 'SAME' ? method : u.method
    if (sent !== method) continue
    const p = products[u.product].match(sent, u.path)
    if (p !== undefined && !out.includes(p)) out.push(p)
  }
  return out
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
  for (const e of [...inv.screens, ...inv.bff, ...inv.lens, ...inv.track, ...inv.docs]) rows.set(e, blank(e))
  const products: Record<Product, Matcher> = { track: new Matcher(inv.track, false), docs: new Matcher(inv.docs, false) }
  const matchers: Record<Kind, Matcher> = { screen: screenMatch, bff: new Matcher(inv.bff, true), lens: new Matcher(inv.lens, false), ...products }

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
  // A Lens, Track or Docs route reached through the app takes the users of the BFF route that led to it.
  for (const b of inv.bff) {
    for (const m of methods.get(b) ?? []) {
      for (const l of [...lensThrough(b, m, inv.lens), ...productThrough(b, m, products)]) {
        const users = who.get(l) ?? new Map<string, Set<number>>()
        for (const [scenario, set] of who.get(b) ?? []) users.set(scenario, new Set([...(users.get(scenario) ?? []), ...set]))
        who.set(l, users)
        const rl = rows.get(l)!
        if (!rl.through.includes(`${m} ${b.path}`)) rl.through.push(`${m} ${b.path}`)
      }
    }
  }
  // A Track or Docs route some BFF route sends a request to, with some method: the rest the app cannot reach.
  const sent = new Set<Entry>()
  for (const b of inv.bff) {
    for (const m of new Set([...inv.track, ...inv.docs].map((p) => p.method))) for (const p of productThrough(b, m, products)) sent.add(p)
  }
  for (const [e, r] of rows) {
    for (const [scenario, set] of who.get(e) ?? []) {
      if (scenario === 'explorer') r.explorers = set.size
      else r.by[scenario] = set.size
    }
    r.timing = timing(ms.get(e) ?? [])
    const why = e.kind === 'track' || e.kind === 'docs' ? (sent.has(e) ? undefined : inv.productsBehindBFF) : cannotTest(e)
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
    track: inv.track.map((e) => rows.get(e)!),
    docs: inv.docs.map((e) => rows.get(e)!),
    trackMissing: inv.trackMissing,
    docsMissing: inv.docsMissing,
    productsNotBehind: inv.productsNotBehind,
    unreadCalls: inv.unreadCalls,
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
