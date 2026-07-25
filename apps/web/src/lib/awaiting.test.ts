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
