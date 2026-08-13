import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { awaitedRoutes, registeredBffRoutes } from './awaiting'

/**
 * EVERY BFF ADDRESS THIS APP NAMES IS ONE THE BFF ACTUALLY MOUNTS — the positive half of
 * `awaiting.ts`, which only ever guarded the NEGATIVE claim.
 *
 * ── THE HOLE, AND WHY IT IS NOT OBVIOUS ──────────────────────────────────────
 *
 * `awaiting.test.ts` makes "route X does not exist yet" checkable, and says so precisely:
 * "Any screen that wants to say 'this data isn't wired yet because route X doesn't exist'
 * must name X through awaitingRoute()". Nothing makes the OPPOSITE claim checkable — that the
 * ~25 addresses this app actually fetches are addresses `apps/bff/lens.go` registers. The two
 * apps ship from one repository through one CI and had no agreement check between them.
 *
 * ⚠ AND THE OBVIOUS ANSWER — "the tests would catch it" — WAS MEASURED, NOT ASSUMED. Three
 * real fetch paths were mutated in the real tree at `78bff6c`
 * (`~/talyvor-queue/w11-calledroutes-controls-9d2b.py`, sha256-restored in a `finally`):
 * `/api/pooling` → `/api/poooling` REDS FirstRunGaps.test.tsx; `/api/members` → `/api/member`
 * reds PanelReportsItsOwnQuery.test.tsx; `/api/lens/convert-quote` → `…-quotes` reds three
 * files in areas/lens. So the paths in use today ARE pinned — incidentally, by fetch mocks
 * keyed on them, and by
 * `PanelReportsItsOwnQuery.test.tsx#ADDRESS_ROUTES`, which pins the observed request set of ten
 * console addresses.
 *
 * ⚠ WHICH IS EXACTLY WHY THE ARRIVAL CASE IS THE ONE THAT MATTERS, AND IT IS THE ONE A MUTATION
 * OF AN EXISTING PATH CANNOT POSE. A mock is written by the same hand as the fetch it answers:
 * a NEW screen fetching `/api/docs/space/{id}` (singular) with a test mocking that same string
 * agrees with itself perfectly and is green, while production answers the BFF's JSON 404 from
 * the `/api/` catch-all. Control P1 below is that case, and it is caught by nothing else.
 *
 * ── HOW THE POPULATION IS TAKEN ──────────────────────────────────────────────
 *
 * From the SOURCE, both sides. `registeredBffRoutes` (awaiting.ts's own exported matcher, so the
 * two guards cannot drift about what "registered" means) reads lens.go; `calledRoutes` below
 * reads every production `.ts`/`.tsx` under `apps/web/src`.
 *
 * ⚠ IT SCANS LITERALS, INCLUDING ONES IN COMMENTS, AND THAT IS A CHOICE RATHER THAN AN
 * OVERSIGHT. A comment naming `/api/docs/spaces/{spaceID}/pages` is a citation of the same kind
 * `upstreamCitations.test.ts` exists for — one that decays with no local change. Holding prose
 * to the same rule as code costs nothing here because both are checked against the same file.
 *
 * ⚠ AND THE TWO GUARDS PARTITION THE SPACE RATHER THAN OVERLAP. A route named through
 * `awaitingRoute()` is claimed ABSENT and `awaiting.test.ts` asserts it is not mounted; a route
 * named anywhere else is claimed PRESENT and this file asserts it is. Disjointness is asserted
 * below rather than assumed. (The awaited set is EMPTY today — awaiting.test.ts records that no
 * production file calls awaitingRoute() at all — so this is a rule with no subject on that side,
 * which is stated here so nobody reads the disjointness pass as evidence of anything.)
 *
 * ⚠ A WILDCARD MUST MEET A WILDCARD. `/api/${x}` is NOT allowed to satisfy `/api/version`: an
 * interpolated segment matches only a `{param}` segment upstream. Without that rule a template
 * literal would match almost anything and the guard would be decorative.
 *
 * ⚠ PATTERNS ENDING IN `/` ARE NOT MATCHABLE. `/api/` and `/` are Go's prefix catch-alls — the
 * JSON-404 and the SPA fallback. A called path "matching" one of them is precisely the defect,
 * so they are excluded from the mounted set.
 *
 * ⚠ IT PASSED ON ITS FIRST RUN, so every branch has a control
 * (`~/talyvor-queue/w11-calledroutes-controls-9d2b.py`, real-tree mutations, anchors
 * count-asserted, sha256 restore in a `finally`, verdicts read from failing TEST FILES, 10/10):
 *   P1 THE ARRIVAL CASE — a new fetch of an unmounted `/api/docs/space/{id}` added to a real
 *      screen → REDS naming the path. Nothing else in either project reds.
 *   P2 the same defect with this file's rule blinded → GREEN, so P1's catch is this file's.
 *   P3 lens.go's mounts made unreadable to `registeredBffRoutes` (the router untouched, all 40
 *      mount sites still mounting) → the MOUNTED FLOOR reds, not a list of "unmounted" paths
 *      blaming the product. `awaiting.test.ts` reds on the same mutation, which is what a
 *      premise shared by two guards going dark should look like.
 *   P4 the walk stopped from descending into `areas/` → the SET COMPARISON reds naming the
 *      files that vanished, which is #183's repair and the failure this class keeps having.
 *   P5 a wildcard-vs-literal match (`/api/${x}` against `/api/version`) → reds, so the rule
 *      above is armed rather than described.
 *   P6 ordinary growth — a new fetch of a path lens.go DOES mount → GREEN.
 */

const webSrc = resolve(import.meta.dirname, '..')
const bffLens = resolve(import.meta.dirname, '../../../..', 'apps/bff/lens.go')

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return tsFiles(full)
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : []
  })
}

/**
 * Every `/api/…` or `/auth/…` address named by a string literal in one TS source, normalised to
 * a shape that can be compared with a Go mux pattern: the query is dropped, and an interpolated
 * segment becomes the wildcard `{}`.
 *
 * Exported so the armed probe below can run it over sources written to be wrong AND to be right
 * — a detector nobody has watched fail is a detector nobody has watched.
 */
export function calledRoutes(tsSource: string): string[] {
  const out = new Set<string>()
  const re = /['"`](\/(?:api|auth)\/[^'"`\s]*)['"`]/g
  for (const m of tsSource.matchAll(re)) {
    const path = m[1]
      .split('?')[0]
      .replace(/\$\{[^{}]*\}/g, '{}')
      .replace(/\{[^{}]+\}/g, '{}')
    if (path.length > 1) out.add(path)
  }
  return [...out]
}

/** Go 1.22 mux semantics, narrowed to what this repo mounts: literal segments and `{name}`. */
function matches(called: string, pattern: string): boolean {
  const a = called.split('/')
  const b = pattern.split('/')
  if (a.length !== b.length) return false
  return a.every((seg, i) => {
    const pat = b[i]
    const patIsWild = /^\{[^{}]+\}$/.test(pat)
    // A wildcard in the CALLED path may only meet a wildcard in the pattern.
    if (seg === '{}') return patIsWild
    return patIsWild ? seg.length > 0 : seg === pat
  })
}

describe('every BFF address this app names is one the BFF mounts', () => {
  const files = tsFiles(webSrc)
  const mounted = registeredBffRoutes(readFileSync(bffLens, 'utf8')).filter((p) => !p.endsWith('/'))

  it('reads a substantial route table, so an unreadable lens.go cannot pass', () => {
    // A literal, never derived from the thing it protects: a scan that reads nothing would
    // otherwise report every path this app calls as unmounted and blame the product for it.
    expect(
      mounted.length,
      'registeredBffRoutes read almost nothing out of apps/bff/lens.go — every "unmounted" ' +
        'answer below is unsafe until that is fixed',
    ).toBeGreaterThan(20)
  })

  it('finds a substantial set of called addresses, so an empty scan cannot pass', () => {
    const all = new Set(files.flatMap((f) => calledRoutes(readFileSync(f, 'utf8'))))
    expect(all.size).toBeGreaterThan(20)
  })

  it('names no address lens.go does not register', () => {
    const awaited = new Set(files.flatMap((f) => awaitedRoutes(readFileSync(f, 'utf8'))))
    const unmounted: string[] = []
    for (const file of files) {
      for (const called of calledRoutes(readFileSync(file, 'utf8'))) {
        if (awaited.has(called)) continue // claimed ABSENT — awaiting.test.ts owns that claim
        if (mounted.some((p) => matches(called, p))) continue
        unmounted.push(`${called}  (${file.slice(webSrc.length + 1)})`)
      }
    }
    expect(
      [...new Set(unmounted)].sort(),
      'address(es) this app names that apps/bff/lens.go does not mount. In production these do ' +
        'not 404 in the browser sense — they fall to the BFF’s /api/ catch-all and come ' +
        'back as JSON, which a screen renders as a fault. Fix the path, mount the route, or ' +
        'declare it absent through awaitingRoute().',
    ).toEqual([])
  })

  it('the two guards partition the space: nothing is claimed absent and called at once', () => {
    const awaited = new Set(files.flatMap((f) => awaitedRoutes(readFileSync(f, 'utf8'))))
    // EMPTY TODAY — see the header. Stated so the pass is not read as coverage.
    const both = [...awaited].filter((r) => mounted.some((p) => matches(r, p)))
    expect(both, 'a route cannot be claimed absent here and mounted there').toEqual([])
  })
})

describe('the scan reads the whole tree', () => {
  // Keys only — the glob is lazy, so nothing here imports a module or runs a side effect.
  // ⚠ THE CALL IS LITERAL ON PURPOSE. Vite rewrites `import.meta.glob` by matching the SYNTAX
  // at transform time; a pattern held in a variable leaves a real call at runtime and returns
  // nothing. It is resolved by Vite and touches node:fs not at all, so a changed extension
  // filter or a walk that stops descending cannot move both instruments the same way.
  const globbed = Object.keys(import.meta.glob('../**/*.{ts,tsx}'))
    .filter((k) => !/\.test\.tsx?$/.test(k))
    .map((k) => resolve(import.meta.dirname, k))

  it('finds a substantial production tree, so an empty anchor cannot pass', () => {
    expect(globbed.length).toBeGreaterThan(40)
  })

  it('the fs walk and Vite’s glob agree on the file set, both directions', () => {
    const walked = new Set(tsFiles(webSrc))
    const glob = new Set(globbed)
    const rel = (p: string) => p.slice(webSrc.length + 1)
    expect(
      [...glob].filter((f) => !walked.has(f)).map(rel).sort(),
      'Vite sees production files this walk never read — an address fetched in any of them ' +
        'would be checked against nothing.',
    ).toEqual([])
    expect(
      [...walked].filter((f) => !glob.has(f)).map(rel).sort(),
      'the walk read files Vite does not see.',
    ).toEqual([])
  })
})

describe('the detector, on sources written to be wrong and to be right', () => {
  it('reads a plain literal, a template segment and a query string', () => {
    expect(calledRoutes(`fetch('/api/members')`)).toEqual(['/api/members'])
    expect(calledRoutes('fetch(`/api/track/issues/${encodeURIComponent(id)}`)')).toEqual([
      '/api/track/issues/{}',
    ])
    expect(calledRoutes('fetch(`/api/usage?days=${days}`)')).toEqual(['/api/usage'])
  })

  it('reads a route named in a COMMENT, which is why prose is held to the same rule', () => {
    expect(calledRoutes(`// see '/api/version' for the stamp`)).toEqual(['/api/version'])
  })

  it('does not invent an address out of a bare slash or an upstream path', () => {
    expect(calledRoutes(`fetch('/')`)).toEqual([])
    expect(calledRoutes(`// upstream is '/v1/api/usage'`)).toEqual([])
  })

  it('a wildcard may only meet a wildcard', () => {
    expect(matches('/api/{}', '/api/version')).toBe(false)
    expect(matches('/api/docs/spaces/{}', '/api/docs/spaces/{spaceID}')).toBe(true)
    expect(matches('/api/docs/space/{}', '/api/docs/spaces/{spaceID}')).toBe(false)
  })

  it('a prefix catch-all cannot vouch for a called address', () => {
    expect(matches('/api/docs/space/{}', '/api/')).toBe(false)
  })
})
