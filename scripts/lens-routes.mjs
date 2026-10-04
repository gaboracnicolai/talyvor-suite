#!/usr/bin/env node
// B27.31 — the Lens routes the public documentation (/documentation) lists, read out of Lens's own
// source rather than typed from memory.
//
//   node scripts/lens-routes.mjs <talyvor-lens checkout>          print every non-admin route
//   node scripts/lens-routes.mjs <talyvor-lens checkout> --check  fail if a DOCUMENTED route is gone
//
// The documented list is apps/web/src/areas/documentation/lens-routes.json. CI checks out
// talyvor-lens main and runs --check, so a route Lens stops registering fails this repo's build
// instead of leaving the documentation promising a 404.
//
// Lens registers routes four ways, all in cmd/lens/*.go: `r.Get("/x", …)`,
// `authed.With(scope).Post("/x", …)`, the gated helpers `econ.get(authed, "/x", …)`, and two loops
// that append a suffix (`"/…/pots/{potID}/"+dir` over in/out, `"/…/"+answer` over accept/decline).
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIRECT = /\b\w+\.(?:With\([^)]*\)\.)?(Get|Post|Put|Delete|Patch)\("(\/[^"]*)"(\+(\w+))?/
const HELPER = /\b\w+\.(get|post|put|patch|delete)\(\s*\w+,\s*"(\/[^"]*)"(\+(\w+))?/
// The suffix loops, read from the source too, so a third value added upstream is not missed.
const LOOP = /for _, (\w+) := range \[\]string\{([^}]*)\}/

export function extract(lensRoot) {
  const dir = join(lensRoot, 'cmd', 'lens')
  const routes = []
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.go') && !f.endsWith('_test.go'))) {
    const lines = readFileSync(join(dir, file), 'utf8').split('\n')
    const loops = new Map()
    lines.forEach((line, i) => {
      const loop = LOOP.exec(line)
      if (loop) loops.set(loop[1], loop[2].split(',').map((s) => s.trim().replace(/"/g, '')))
      const m = DIRECT.exec(line) ?? HELPER.exec(line)
      if (!m) return
      const method = m[1].toUpperCase()
      // Admin, operator and moderator routes are not the customer's API. The gate is named on the
      // registration line, or on the next one when the call continues there (a line ending in a
      // comma) — never on a sibling registration that merely follows it.
      const near = line.trimEnd().endsWith(',') ? `${line} ${lines[i + 1] ?? ''}` : line
      const admin = m[2].startsWith('/v1/admin/') || /requireAdmin/.test(near)
      const suffixes = m[4] ? (loops.get(m[4]) ?? [`{${m[4]}}`]) : ['']
      for (const s of suffixes) routes.push({ method, path: m[2] + s, admin, file, line: i + 1 })
    })
  }
  return routes
}

/** chi's `/*` and OpenAPI's `{path}` are one thing; parameter NAMES are not part of a route. */
export function normalise(path) {
  return path.replace(/\/\*$/, '/{}').replace(/\{[^}]*\}/g, '{}')
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const lensRoot = process.argv[2]
  if (!lensRoot) {
    console.error('usage: lens-routes.mjs <talyvor-lens checkout> [--check]')
    process.exit(2)
  }
  const registered = extract(lensRoot).filter((r) => !r.admin)
  if (!process.argv.includes('--check')) {
    for (const r of registered) console.log(`${r.method}\t${r.path}\t${r.file}:${r.line}`)
    process.exit(0)
  }
  const here = dirname(fileURLToPath(import.meta.url))
  const doc = JSON.parse(
    readFileSync(join(here, '..', 'apps/web/src/areas/documentation/lens-routes.json'), 'utf8'),
  )
  const have = new Set(registered.map((r) => `${r.method} ${normalise(r.path)}`))
  const documented = doc.groups.flatMap((g) => g.routes)
  const gone = documented.filter((r) => !have.has(`${r.method} ${normalise(r.path)}`))
  if (gone.length > 0) {
    console.error(`/documentation lists ${gone.length} Lens route(s) that Lens no longer registers:`)
    for (const r of gone) console.error(`  ${r.method} ${r.path}`)
    process.exit(1)
  }
  console.log(`all ${documented.length} documented Lens routes are registered in ${lensRoot}`)
}
