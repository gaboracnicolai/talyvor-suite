import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { queryClient } from './App'
import { ApiError } from './lib/api'
import { isSessionExpired, isUnconfigured } from './lib/productState'

/**
 * AN ERROR TYPE THAT EXTENDS BARE `Error` TURNS EVERY SHARED MECHANISM OFF WITHOUT TOUCHING ONE
 * LINE OF ANY OF THEM — and this repo has repaired that four times, one instance at a time,
 * without ever asking how many instances there were.
 *
 * The four, in the source that records them:
 *   · #136  `readDistill` threw a bare `Error` — "all three mechanisms went silent at once"
 *   · #140  the Track create's refusal, same shape (IssueList.tsx: `CreateRefusal extends ApiError`,
 *           "it used to extend the bare `Error`")
 *   · the third site, the Track status change (IssueList.tsx:282 names it: "a hand-rolled error type
 *           turns the shared predicate off without one line of the predicate changing — #136 for a
 *           read, #140 for the create four lines above, and this was the third site")
 *   · the fourth, `ConvertError` (convertRefusal.test.tsx), which MEASURED the four consequences
 *
 * Every one of those is a fix at the INSTANCE. The class was never censused, so this file does it.
 *
 * ⚠ WHAT IT FOUND AT `ab51d52`, WITH EVERY GATE GREEN — TWO MORE, and neither is visible to any
 * instrument in the tree:
 *
 *     apps/web/src/areas/lens/topupApi.ts#CheckoutError   extends Error   ← the top-up money path
 *     apps/web/src/areas/track/data.ts#TrackApiError      extends Error   ← zero call sites
 *
 * `CheckoutError` is LATENT rather than live, and that is stated rather than implied: its only
 * producer is `topupApi.checkout`, which is called from a useMutation, and a mutation's error never
 * enters the query cache the bar and `QueryCache.onError` read. Its own `kind` vocabulary gives
 * TopUp.tsx the right sentence for a 401 today. What it does NOT survive is being read by anything
 * shared — the same thing that was true of `ConvertError`'s write half, while its READ half (a
 * useQuery) was the live defect. One `useQuery` over `topupApi.checkout`, or one caller reaching for
 * the type at a second site, and the latency ends. `TrackApiError` is worse in a quieter way: it is
 * exported, area-named, sits at the top of the Track data layer, and nothing anywhere constructs it
 * — so it is not a hazard that shipped, it is a hazard waiting for the next reader who wants an
 * error type in that area and finds one already named after it.
 *
 * ⚠ THE PREMISE IS PINNED, NOT ASSERTED — see rule C. Every mechanism keys on `instanceof ApiError`,
 * so a look-alike that carries `status` and extends `Error` is invisible to all of them. Rule C
 * measures that on the real predicates and on the app's REAL retry option rather than restating it
 * in a comment, so a change that made the predicates duck-type would red here and this rule would
 * be re-argued instead of quietly kept.
 */

const roots = [
  resolve(import.meta.dirname, '.'),
  resolve(import.meta.dirname, '../../../packages/ui/src'),
]

function relOf(p: string): string {
  return p.slice(p.indexOf('/apps/') >= 0 ? p.indexOf('/apps/') + 1 : p.indexOf('/packages/') + 1)
}

/** A test, a fixture or a harness — a class declared there is never a production error type. */
function isTestFile(rel: string): boolean {
  return /\.test\.tsx?$/.test(rel) || /(^|\/)__tests__\//.test(rel) || /test-setup\.tsx?$/.test(rel)
}

interface Decl {
  /** `module#Name`. */
  key: string
  name: string
  base: string
}

/**
 * Every `class X extends Y` in the two source trees, as `module#X extends Y`.
 *
 * ⚠ IT MATCHES DECLARATIONS, NOT THROWS — and the reason this file gave for that was WRONG ABOUT
 * THE POPULATION. It read "a thrown object literal or a `new Error()` with fields bolted on would
 * not be seen — that shape is not what any of the five instances looked like". Measured at
 * `d7652cf` with all 1134 tests green, a SIXTH and SEVENTH instance were exactly that shape:
 *
 *     apps/web/src/areas/track/IssueDetail.tsx:98   throw new Error(String(res.status))   PATCH
 *     apps/web/src/areas/track/IssueDetail.tsx:120  throw new Error(String(res.status))   POST
 *
 * A bare Error carrying the status — in its MESSAGE, where nothing reads it — on the two write
 * paths of the same area as three of the five, in a file that imports `isSessionExpired` and uses
 * it 200 lines below for a read. The declaration rule is still the right shape for a TYPE, so it
 * is unchanged; the gap it left is now covered by rule D rather than excused in this comment.
 */
function declaredClasses(): Decl[] {
  const out: Decl[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, e.name)
      if (e.isDirectory()) {
        walk(p)
        continue
      }
      if (!/\.tsx?$/.test(e.name)) continue
      const path = relOf(p)
      if (isTestFile(path)) continue
      const text = readFileSync(p, 'utf8')
      for (const m of text.matchAll(
        /(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)\s+extends\s+([A-Za-z0-9_$.]+)/g,
      )) {
        out.push({ key: `${path}#${m[1]}`, name: m[1], base: m[2] })
      }
    }
  }
  for (const r of roots) walk(r)
  return out.sort((a, b) => a.key.localeCompare(b.key))
}

/**
 * The bases that make a class an ERROR type. `Error` is the one this repo declares against; the
 * others are the built-ins a hand-rolled type could reach for instead and land in exactly the same
 * blind spot — `instanceof ApiError` is false for every one of them.
 */
const ERROR_ROOTS = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'EvalError',
  'ReferenceError',
  'URIError',
  'AggregateError',
  'DOMException',
])

const CLASSIFIED = 'ApiError'

interface Chain {
  decl: Decl
  /** The bases walked, nearest first, ending at the built-in root. */
  chain: string[]
  /** Does the chain pass through `ApiError`? */
  classified: boolean
}

/**
 * Resolve each declaration's inheritance chain THROUGH the other declarations, so a type extending
 * `CheckoutError` is judged by where CheckoutError ends up rather than by its own one word. A base
 * this repo does not declare and that is not a built-in error (`React.Component`, an imported class)
 * terminates the walk: it is not an error type and this rule says nothing about it.
 */
function errorTypes(decls: Decl[]): Chain[] {
  const byName = new Map(decls.map((d) => [d.name, d]))
  const out: Chain[] = []
  for (const decl of decls) {
    const chain: string[] = []
    let base: string | undefined = decl.base
    const seen = new Set<string>([decl.name])
    while (base && !seen.has(base)) {
      chain.push(base)
      if (ERROR_ROOTS.has(base)) break
      seen.add(base)
      base = byName.get(base)?.base
    }
    const last = chain[chain.length - 1]
    if (!last || !ERROR_ROOTS.has(last)) continue
    out.push({ decl, chain, classified: chain.includes(CLASSIFIED) })
  }
  return out
}

/**
 * Rule D's population: every non-test module that CALLS `fetch`. It is scoped that way rather
 * than to all source because the blind spot is specific — an error about a REFUSED REQUEST is the
 * only kind that gets handed to `isSessionExpired`, `isUnconfigured`, `QueryCache.onError` or the
 * retry predicate, and all four are `instanceof ApiError`. A `throw new Error` elsewhere is a
 * programmer error nobody classifies: `glyphAudit.ts` refusing a malformed woff2 and
 * `packages/ui/src/lib/contrast.ts` refusing an unreadable colour are the ten and three sites
 * this scope deliberately leaves alone, and neither is on a request path.
 */
function fetchingModules(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, e.name)
      if (e.isDirectory()) {
        walk(p)
        continue
      }
      if (!/\.tsx?$/.test(e.name)) continue
      const path = relOf(p)
      if (isTestFile(path)) continue
      const text = readFileSync(p, 'utf8')
      if (text.includes('fetch(')) out.push({ path, text })
    }
  }
  for (const r of roots) walk(r)
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

/** `throw new Error(...)` and the other built-in roots, as `module:line`. */
const THROWN_BUILTIN = new RegExp(`throw\\s+new\\s+(?:${[...ERROR_ROOTS].join('|')})\\s*\\(`, 'g')

function builtinThrows(text: string): number[] {
  const lines: number[] = []
  for (const m of text.matchAll(THROWN_BUILTIN)) {
    lines.push(text.slice(0, m.index).split('\n').length)
  }
  return lines
}

/** A class carrying a status that is NOT an ApiError — the shape every instance had. */
class StatusLookAlike extends Error {
  constructor(readonly status: number) {
    super(`look-alike -> HTTP ${status}`)
    this.name = 'StatusLookAlike'
  }
}

describe('an error type nothing shared can classify', () => {
  const decls = declaredClasses()
  const errors = errorTypes(decls)

  it('A. every error type in the product reaches Error THROUGH ApiError', () => {
    const unclassified = errors
      .filter((e) => !e.classified && e.decl.name !== CLASSIFIED)
      .map((e) => `${e.decl.key} extends ${e.chain.join(' → ')}`)
      .sort()
    expect(
      unclassified,
      'a hand-rolled error type is invisible to isSessionExpired, isUnconfigured, ' +
        'QueryCache.onError and the retry predicate — all four key on `instanceof ApiError`, ' +
        'and none of them changes when one of these is added. Extend ApiError (ConvertError and ' +
        'CreateRefusal are the shape), or delete the type if nothing constructs it.',
    ).toEqual([])
  })

  /**
   * ⚠ RULE A CANNOT SEE ITS OWN DETECTOR GO BLIND, WHICH IS WHY THIS IS SEPARATE. Break the regex,
   * point a root at a directory that does not exist, or drop `Error` from ERROR_ROOTS, and A
   * reports a clean product over a census of nothing. These three are hardcoded: two live classes
   * that MUST resolve through ApiError, and ApiError itself, which must resolve to the bare root.
   */
  it('B. the census can see the classes it is a census of', () => {
    const seen = new Map(errors.map((e) => [e.decl.key, e.chain.join(' → ')]))
    expect(seen.get('apps/web/src/lib/api.ts#ApiError')).toBe('Error')
    expect(seen.get('apps/web/src/areas/lens/convertApi.ts#ConvertError')).toBe('ApiError → Error')
    expect(seen.get('apps/web/src/areas/track/IssueList.tsx#CreateRefusal')).toBe('ApiError → Error')
  })

  /**
   * ⚠ THE RULE'S PREMISE, MEASURED ON THE REAL MECHANISMS. This is the same measurement
   * convertRefusal.test.tsx recorded for `ConvertError` at `3ba7a63`, made re-runnable: a type that
   * extends Error and carries the status is refused by both predicates and RETRIED by the app,
   * while the identical status as an ApiError is classified and not retried.
   */
  it('C. a status-carrying look-alike is invisible to every mechanism that keys on ApiError', () => {
    const retry = queryClient.getDefaultOptions().queries?.retry as (
      failureCount: number,
      error: unknown,
    ) => boolean

    expect(isSessionExpired(new StatusLookAlike(401))).toBe(false)
    expect(isSessionExpired(new ApiError(401, '/api/x'))).toBe(true)
    expect(isUnconfigured(new StatusLookAlike(503))).toBe(false)
    expect(isUnconfigured(new ApiError(503, '/api/x'))).toBe(true)
    // The app RETRIES the look-alike's 401 and does not retry ApiError's — the one consequence
    // that is not a sentence on a screen.
    expect(retry(0, new StatusLookAlike(401))).toBe(true)
    expect(retry(0, new ApiError(401, '/api/x'))).toBe(false)
    // And QueryCache.onError's re-probe keys on the same instanceof, so it never fires either.
    expect(new StatusLookAlike(401) instanceof ApiError).toBe(false)
  })

  /**
   * ⚠ RULE D — THE HALF RULE A SAYS IT CANNOT SEE. A refusal does not have to be a declared TYPE
   * to be invisible: `throw new Error(String(res.status))` is the same blindness with no class to
   * name, and it shipped twice on IssueDetail's write paths. Scoped to modules that call `fetch`,
   * because that is where an error becomes something a shared HTTP predicate will be asked about.
   */
  it('D. no module that speaks to the network throws an error nothing can classify', () => {
    const offenders = fetchingModules()
      .flatMap((m) => builtinThrows(m.text).map((line) => `${m.path}:${line}`))
      .sort()
    expect(
      offenders,
      'a built-in Error thrown from a request path is refused by isSessionExpired, ' +
        'isUnconfigured, QueryCache.onError and the retry predicate alike — the status ends up in ' +
        'a MESSAGE, which nothing reads. Throw `new ApiError(res.status, path)`.',
    ).toEqual([])
  })

  /**
   * ⚠ RULE D CANNOT SEE ITS OWN DETECTOR GO BLIND EITHER, and its expectation is `[]` — the value
   * a scan of nothing also produces. Two independent things are pinned: the POPULATION contains
   * the request modules by name (not a floor, which a collapsed walk can still clear), and the
   * MATCHER fires on the exact shipped line.
   */
  it('E. rule D reads the request modules, and its matcher sees the shape that shipped', () => {
    const scanned = new Set(fetchingModules().map((m) => m.path))
    for (const m of [
      'apps/web/src/lib/api.ts',
      'apps/web/src/areas/track/IssueDetail.tsx',
      'apps/web/src/areas/track/IssueList.tsx',
      'apps/web/src/areas/lens/topupApi.ts',
      'apps/web/src/areas/docs/api.ts',
    ]) {
      expect(scanned.has(m), `rule D never read ${m}`).toBe(true)
    }
    // The line as it stood at d7652cf, and the replacement — the matcher must part them.
    expect(builtinThrows('      if (!res.ok) throw new Error(String(res.status))\n')).toEqual([1])
    expect(builtinThrows('      if (!res.ok) throw new ApiError(res.status, path)\n')).toEqual([])
  })
})
