import { readdirSync, readFileSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A MOCK ARM THAT NEVER MATCHES IS A SETUP THAT LIES ABOUT THE STATE UNDER TEST.
 *
 * ── THE FINDING THIS EXISTS FOR ──────────────────────────────────────────────
 *
 * `areas/marketing/Journey.test.tsx` mocked `fetch` with an arm for `/api/signup-open`
 * returning `{signup_open: true}`. There is no such route. `signup_open` is a FIELD on
 * `/auth/me` (apps/bff/auth.go), and `lib/signupOpen.ts#useSignupProbe` fetches `/auth/me`
 * and nothing else — so that arm was never requested, in any test, ever.
 *
 * The arm being dead is not the harm. The harm is what the OTHER arm then delivered: the
 * fixture's `/auth/me` answer carried no `signup_open` at all, and `signupStateOf` maps an
 * absent field to `unknown` — deliberately, that mapping is its own documented rule. So every
 * test in that file drove the app through the signup journey in the `unknown` state while the
 * fixture's own dead arm declared the state was `open`.
 *
 * ⚠ MEASURED, NOT ARGUED. `AccessLine`'s `open` branch (areas/auth/Entry.tsx) was replaced with
 * `return null` and the two files run: `Entry.test.tsx` went RED on "OPEN: says a stranger can
 * start, with no invitation", and all four of `Journey.test.tsx` stayed GREEN. The product
 * promise is guarded — by the neighbour, not by the journey. Journey could not see it, because
 * Journey was never in that state.
 *
 * ── WHY A RULE AND NOT JUST A FIXED FIXTURE ──────────────────────────────────
 *
 * Nothing could have noticed. A `fetch` mock is a function; an arm that never matches has no
 * failing assertion attached to it, and a URL that no longer exists looks exactly like a URL
 * that does. The census below is the only thing in this repo that compares the two halves.
 *
 * ── THE POPULATION BOUNDARY, STATED RATHER THAN LEFT TO BE DISCOVERED ────────
 *
 * The fixture half is exactly the literals a test BRANCHES on via `url.startsWith(...)` or
 * `url.includes(...)` — the shape every `fetch` mock in this repo uses to route an answer.
 * Fixtures that dispatch some other way (an `===` on the whole input, a switch on a parsed
 * pathname) are OUTSIDE this population and this rule does not see them. That is a real limit,
 * written down here rather than implied by a passing test: if such a fixture is added, this
 * census will not grow to cover it and someone must widen the extractor deliberately.
 *
 * The route half is every `a.mux.HandleFunc("…")` in apps/bff/lens.go — the router itself, so a
 * route added or renamed tomorrow moves this rule with it and no list here can go stale.
 */

const REPO = resolve(__dirname, '../../..')
const LENS_GO = resolve(REPO, 'apps/bff/lens.go')

/** Literals a fixture may branch on that are deliberately NOT routes.
 *
 *  EMPTY TODAY, and that is a measurement rather than an oversight: all 24 literals in this
 *  repo's fixtures resolve to a mounted route except the one this file was written for. It is
 *  the declared escape hatch for a real case — a fixture asserting that an UNMOUNTED path
 *  refuses (apps/bff/auth_test.go does exactly that with `/api/anything-unknown`, on the Go
 *  side), or a mock for an origin this BFF does not serve. Each entry must carry its reason,
 *  and an entry that stops being needed is itself a failure below, so this cannot silently
 *  accumulate excuses. */
const NOT_A_ROUTE: Record<string, string> = {}

/** Every path mounted on the BFF's mux, in the router's own spelling ({id} placeholders kept). */
export function mountedRoutes(): string[] {
  const src = readFileSync(LENS_GO, 'utf8')
  return [...src.matchAll(/a\.mux\.HandleFunc\("([^"]*)"/g)].map((m) => m[1])
}

/** Every test file under apps/web/src, walked the way this repo's other source audits walk
 *  (pointerAudit.test.ts, formatterReach.test.ts) rather than with `fs.globSync`: that helper is
 *  still experimental on the Node 22 CI pins and this checkout runs a much later Node, and a
 *  file-discovery difference between host and CI is exactly how a census silently shrinks on one
 *  of them. THIS FILE IS EXCLUDED — the regex below appears in its own prose, and a rule that
 *  reads itself invents members. */
function testFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue
      const p = resolve(dir, name)
      if (statSync(p).isDirectory()) {
        walk(p)
        continue
      }
      if (!/\.test\.tsx?$/.test(name)) continue
      if (p === resolve(__dirname, 'fixtureRouteReality.test.ts')) continue
      out.push(p)
    }
  }
  walk(__dirname)
  return out.sort()
}

/** Every URL literal a test fixture routes an answer on, with the files that branch on it. */
export function fixtureLiterals(): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const file of testFiles()) {
    const rel = relative(__dirname, file)
    for (const m of readFileSync(file, 'utf8').matchAll(
      /url\.(?:startsWith|includes)\(\s*['"`](\/[^'"`]*)/g,
    )) {
      const list = out.get(m[1]) ?? []
      if (!list.includes(rel)) list.push(rel)
      out.set(m[1], list)
    }
  }
  return out
}

/** Is `literal` a request some mounted route would actually receive?
 *
 *  Two ways, because fixtures legitimately use both: a FULL address whose path segments fill the
 *  route's `{placeholders}` (`/api/keys/k-1` against `/api/keys/{id}`), and a PREFIX shared by a
 *  family of routes (`/api/docs/` against `/api/docs/spaces`). Anything matching neither names
 *  an address no browser can reach through this BFF. */
export function reachableBy(literal: string, route: string): boolean {
  const path = literal.split('?')[0]
  const rx = new RegExp(
    '^' +
      route
        .split(/(\{[^}]+\})/)
        .filter(Boolean)
        .map((seg) => (seg.startsWith('{') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
        .join('') +
      '$',
  )
  return rx.test(path) || route.startsWith(path)
}

describe('every URL a test fixture answers is a URL the BFF actually mounts', () => {
  // ⚠ VACUITY FIRST, BOTH HALVES. A rule comparing two derived sets passes trivially if either
  // extraction silently returns nothing — the exact defect this repo has already found twice.
  // Each half is held by a COUNT and by a NAMED ANCHOR: a count alone survives a regex that
  // still matches something, and an anchor alone survives a regex that matches only it.
  it('the router half is non-empty and contains a route this app is known to call', () => {
    const routes = mountedRoutes()
    expect(routes.length).toBeGreaterThan(30)
    expect(routes).toContain('/api/usage')
    expect(routes).toContain('/api/docs/spaces')
  })

  it('the fixture half is non-empty and contains a literal this repo is known to branch on', () => {
    const lits = fixtureLiterals()
    expect(lits.size).toBeGreaterThan(15)
    expect([...lits.keys()]).toContain('/auth/me')
  })

  // ⚠ AND THE MATCHER MUST BE ABLE TO SAY NO. A `reachableBy` that drifted permissive would make
  // every assertion below pass while measuring nothing, and it would look exactly like success.
  it('the matcher refuses an address no route serves', () => {
    const routes = mountedRoutes()
    expect(routes.some((r) => reachableBy('/api/signup-open', r))).toBe(false)
    expect(routes.some((r) => reachableBy('/api/not-a-real-route', r))).toBe(false)
    expect(routes.some((r) => reachableBy('/api/keys/k-1', r))).toBe(true)
    expect(routes.some((r) => reachableBy('/api/docs/', r))).toBe(true)
  })

  it('every fixture literal is reachable, or is declared as deliberately not a route', () => {
    const routes = mountedRoutes()
    const unreachable: string[] = []
    for (const [literal, files] of fixtureLiterals()) {
      if (NOT_A_ROUTE[literal] !== undefined) continue
      if (!routes.some((r) => reachableBy(literal, r))) {
        unreachable.push(`${literal}  — branched on in ${files.join(', ')}`)
      }
    }
    expect(
      unreachable,
      'these fixtures answer a URL no BFF route serves, so the arm never fires and the test runs ' +
        'in whatever state the OTHER arms happen to produce:\n  ' + unreachable.join('\n  '),
    ).toEqual([])
  })

  // A declared exemption that is no longer branched on is a stale excuse: it would keep a future
  // literal of the same name silently permitted. The partition must account for every entry.
  it('no declared exemption is stale', () => {
    const lits = fixtureLiterals()
    for (const literal of Object.keys(NOT_A_ROUTE)) {
      expect(lits.has(literal), `${literal} is exempted but no fixture branches on it`).toBe(true)
    }
  })
})
