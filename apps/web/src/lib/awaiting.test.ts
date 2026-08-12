import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { awaitedRoutes, awaitingRoute, registeredBffRoutes } from './awaiting'

// THE GUARD. A caption may say "route X does not exist yet" only while that is true of the
// BFF in this repo. The day the route is registered, this test fails and the build stops —
// the screen must then be wired or re-captioned. This is the check that was missing when the
// #339 caption survived its own obsolescence with every gate green.

// import.meta.dirname, not new URL(...).pathname — under Vite the module URL carries a
// /@fs prefix and every read ENOENTs. Same convention as packages/ui's no-arbitrary-value test.
const webSrc = resolve(import.meta.dirname, '..')
const bffLens = resolve(import.meta.dirname, '../../../..', 'apps/bff/lens.go')

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return tsFiles(full)
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : []
  })
}

describe('the awaitingRoute extractors', () => {
  // POSITIVE CONTROL. A matcher that quietly stops matching turns the guard below into a
  // vacuous pass — the exact failure mode being guarded against. So prove both matchers
  // still find things in hand-written samples before trusting them on real files.
  it('finds routes in BFF-shaped Go source', () => {
    const sample = `
      a.mux.HandleFunc("/api/members", a.requireSession(a.proxyProduct(
        "track", cfg.trackBaseURL, cfg.trackGatewaySecret, "/v1/workspaces/"+id+"/members")))
      a.mux.HandleFunc("/api/docs/spaces/{spaceID}/pages", a.requireSession(a.docsPageList()))
      a.mux.Handle("/", a.spaHandler())
    `
    expect(registeredBffRoutes(sample).sort()).toEqual([
      '/',
      '/api/docs/spaces/{spaceID}/pages',
      '/api/members',
    ])
    // Only the FIRST string argument is the route — the upstream path must not be picked up.
    expect(registeredBffRoutes(sample)).not.toContain('track')
  })

  it('finds awaited routes in every quote style', () => {
    const sample = `
      awaitingRoute('/api/a')
      awaitingRoute("/api/b", 'why')
      awaitingRoute(\`/api/c\`)
      // not a call: awaitingRoute is mentioned in prose here
    `
    expect(awaitedRoutes(sample).sort()).toEqual(['/api/a', '/api/b', '/api/c'])
  })

  it('reads the real BFF file and finds a substantial route table', () => {
    // If this ever drops to a handful, the matcher or the file moved — fail loudly rather
    // than let the guard pass by finding nothing to compare against.
    expect(registeredBffRoutes(readFileSync(bffLens, 'utf8')).length).toBeGreaterThan(15)
  })

  it('composes a caption that names the route', () => {
    expect(awaitingRoute('/api/x')).toBe('awaiting /api/x')
    expect(awaitingRoute('/api/x', 'because')).toBe('awaiting /api/x — because')
  })
})

describe('the guard has teeth', () => {
  // A guard that only ever passes is indistinguishable from no guard. The real-file check
  // below is green because no screen currently claims a served route — so prove the
  // COMPARISON fires, by running it over a caption that names a route the BFF really does
  // register. Without this, deleting the comparison would go unnoticed.
  it('flags a caption naming a route the real BFF registers', () => {
    const registered = new Set(registeredBffRoutes(readFileSync(bffLens, 'utf8')))
    expect(registered.has('/api/members')).toBe(true) // the route the audit found unused

    const offendingSource = `FixtureNotice awaiting={awaitingRoute('/api/members')}`
    const offenders = awaitedRoutes(offendingSource).filter((r) => registered.has(r))
    expect(offenders).toEqual(['/api/members'])
  })

  it('does not flag a route that genuinely does not exist', () => {
    const registered = new Set(registeredBffRoutes(readFileSync(bffLens, 'utf8')))
    const source = `awaitingRoute('/api/admin/topology')` // no BFF proxy for edge-infra
    expect(awaitedRoutes(source).filter((r) => registered.has(r))).toEqual([])
  })
})

// THE WALK IS THE GUARD'S OTHER INPUT, AND IT WAS THE UNCONTROLLED ONE.
//
// awaiting.ts exports both matchers so they can be positive-controlled, and says why: "a matcher
// that silently stops matching would make the guard vacuously green". The sweep below has a
// SECOND input the matchers cannot speak for — tsFiles(webSrc), which decides WHICH files are
// read. Nothing asserted it read anything, and the guard's output for "read nothing" is
// byte-identical to its output for "read everything and found nothing wrong".
//
// MEASURED, not reasoned about (~/talyvor-queue/w11-awaitingwalk-controls-2b8f.py, each mutation
// restored in a `finally` and verified back by sha256), 3/3 as predicted:
//   C1  a caption in areas/lens/Overview.tsx naming `/api/members` — a route lens.go:214 really
//       registers, i.e. the exact #339 rot this module exists to close — REDS the guard. The
//       comparison is armed on real production files.
//   C2  THE HOLE: the same caption, with one line added to tsFiles so it does not descend into
//       `areas` — rc=0, GREEN. 43 of the 70 production files live there, including every screen.
//   C3  the skip ALONE, no caption — GREEN. Nothing anywhere notices the population shrank.
//
// ⚠ AND THE POPULATION IS CURRENTLY ZERO. No production file calls awaitingRoute() at all (the
// only occurrences repo-wide are this file's samples and awaiting.ts's own doc comments), so the
// real-file guard has never had a subject to read. That is a fine state for the PRODUCT — no
// screen is making an unverifiable claim — but it means C3's invisibility is not a latent risk,
// it is the permanent condition: the sweep could have been broken at any point in this file's
// life and every run would have looked exactly the same.
//
// So the walk gets an INDEPENDENT ENUMERATION rather than a bigger comment. import.meta.glob is
// resolved by Vite at transform time and touches node:fs not at all, so a skip map, a changed
// extension filter or a wrong `webSrc` in the fs walk cannot move both instruments the same way.
// The floor is there for the one failure that CAN: an anchor that resolves to an empty tree
// leaves both enumerations agreeing on nothing.
//
// ⚠ A CONTROL FOUND A COUPLING NOBODY HAD WRITTEN DOWN, and it belongs here rather than in a
// commit message. Widening tsFiles' filter to keep `.test.ts` reds the set comparison AS
// EXPECTED — and it also reds the ORIGINAL guard, because the sweep then reads THIS FILE, whose
// own positive-control fixture on line 75 names `/api/members`, a route lens.go:214 registers.
// Verified as the sole cause: it is the only awaitingRoute() sample in any test file naming a
// registered route. So the guard below is kept off its own fixtures by the walk's test-file
// exclusion and by nothing else — if a sample ever moves into production source, it will be
// reported as a rotting caption, which is the correct answer for the wrong reason.
describe('the sweep reads the whole tree', () => {
  // Keys only — the glob is lazy, so nothing here imports a module or runs a side effect.
  const globbed = Object.keys(import.meta.glob('../**/*.{ts,tsx}'))
    .filter((k) => !/\.test\.tsx?$/.test(k))
    .map((k) => resolve(import.meta.dirname, k))

  it('finds a substantial production tree, so an empty anchor cannot pass', () => {
    // Deliberately far below the 70 counted at 4a1c138: this catches an anchor that resolves to
    // nothing, not a refactor that moves files. The set comparison below is what catches a skip.
    expect(globbed.length).toBeGreaterThan(40)
  })

  it('the fs walk and Vite’s glob agree on the file set, both directions', () => {
    const walked = new Set(tsFiles(webSrc))
    const glob = new Set(globbed)
    const rel = (p: string) => p.slice(webSrc.length + 1)
    expect(
      [...glob].filter((f) => !walked.has(f)).map(rel).sort(),
      'Vite sees production files that tsFiles() does not. The sweep below reads whatever this ' +
        'walk returns, so anything missing here is a file no caption guard has ever looked at.',
    ).toEqual([])
    expect(
      [...walked].filter((f) => !glob.has(f)).map(rel).sort(),
      'tsFiles() returns files Vite does not see. Either the walk picked up something outside ' +
        'apps/web/src, or the two disagree about what a production source file is.',
    ).toEqual([])
  })
})

describe('no caption claims a route the BFF already serves', () => {
  it('every awaitingRoute() names a route that is genuinely absent', () => {
    const registered = new Set(registeredBffRoutes(readFileSync(bffLens, 'utf8')))
    const offenders: string[] = []
    for (const file of tsFiles(webSrc)) {
      for (const route of awaitedRoutes(readFileSync(file, 'utf8'))) {
        if (registered.has(route)) offenders.push(`${file.slice(webSrc.length + 1)} claims ${route} is absent`)
      }
    }
    // The message matters: whoever trips this needs to know the fix is to WIRE the screen
    // or change the caption — not to relax the guard.
    expect(
      offenders,
      `These captions claim a BFF route does not exist, but apps/bff/lens.go registers it. ` +
        `Wire the screen to the route, or stop claiming the route is missing:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})
