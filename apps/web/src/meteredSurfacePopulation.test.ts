import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { stripComments } from '../../../packages/ui/src/lib/sourceText'

// meteredSurfacePopulation.test.ts — THE POPULATION THE TWO METERED CENSUSES RUN OVER MUST COME
// FROM THE SOURCE, NOT FROM A LIST SOMEBODY REMEMBERED TO EXTEND.
//
// ── THE DEFECT, MEASURED RATHER THAN REVIEWED ────────────────────────────────
//
// areas/docs/meteredCostCensus.test.tsx and areas/track/meteredCostCensus.test.tsx are two of the
// best-controlled files in this repo — nine, six and eight positive controls between them, each
// naming its predicted catcher first. Both open by arguing that a census is the right SHAPE
// because "a test per card is exactly what leaves the fifth card unwritten": Docs missed
// SearchDocs, Track missed SearchIssues, and both misses were a spending surface that nobody had
// written a test for.
//
// ⚠⚠ AND BOTH CENSUSES ARE KEYED ON A HAND-WRITTEN ARRAY OF COMPONENT NAMES. `METERED` is five
// literal rows in Docs and four in Track. Every control they carry mutates a row that is already
// there. Not one of them can see a surface that was never added — which is the exact failure both
// files were written to end, still open in the direction that produced it.
//
// MEASURED at main `34cf1270`, not reasoned about: a new card `areas/docs/PageDigest.tsx` calling
// `docsApi.summarizePage` — the same billed route PageSummary calls, feature tag
// `docs-ai-summarize` — mounted in PageView.tsx beside its four siblings, printing NO price at
// mount and NO receipt beside the answer. The whole web gauntlet stayed green: typecheck (after
// the card compiled), lint, apps/web 1897 tests, both metered censuses, audit-gate and
// audit-reach. The ONLY line that moved was `packages/ui`'s test-manifest — `invariant.test.ts:
// 128 -> 129 tests`, because that colour sweep generates one test per apps/web source file — and
// its documented remedy is `pnpm test:accept`. A count that a developer is told to accept is not
// a guard against an undisclosed charge.
//
// ── WHAT THIS FILE ASSERTS, AND WHY IT IS ONE FILE AND NOT TWO ───────────────
//
// A surface is metered if its CODE names a route that bills Lens. That is derivable here: the
// marker per route is below, the file scan is below it, and the answer is compared against the
// census that is supposed to be holding that surface to a cost sentence.
//
// It is ONE file covering BOTH areas deliberately. The finding is that a per-area guard cannot
// see the next area, and this repo has paid for that twice already — W1.1.9a records "the fix
// applied where the defect was reported and the identical shape one element over never swept
// for". Docs' own census header says Track's guard "is a good guard and it cannot see this
// directory at all". Writing this twice would reproduce the defect it closes.
//
// ── THE TWO POPULATIONS ARE RESTATED ON PURPOSE, WHICH IS NORMALLY A DEFECT ──
//
// This repo's standing rule is that a derived value beats a restated one. It does not apply here
// and the reason is the whole point: the census's list is DECLARED and this file's list is
// DERIVED FROM SOURCE, so they are two independent measurements of one set. Deriving this one
// from the census would make the comparison a tautology and close nothing.
//
// ── WHY COMMENTS ARE STRIPPED ────────────────────────────────────────────────
//
// FindDuplicates.tsx names `/api/track/issues/{id}/find-duplicates` in a docstring one line above
// the code that builds it, and PageChangelog.tsx's header names the metered siblings it is NOT
// one of. A detector that reads prose enrols whatever a file talks about. `decision-expiry.sh`
// §D7 records the same trap costing this repo a guard that matched `member-sync` in its own
// comments. The detector is positive-controlled in both directions below before it reads a file.
//
// ── WHAT IS DELIBERATELY NOT IN THE POPULATION ───────────────────────────────
//
// `docsApi.generateChangelog` (PageChangelog.tsx) has NO marker because it is not a metered route.
// That is not an omission and it is not this file's judgement: PageChangelog.tsx:15 records the
// measurement — "GenerateFromIssues reaches Lens never", no `own_ai_cost_usd` moves — which is why
// Docs' census names it as its one excluded surface. A route that does not spend has no marker, so
// no exclusion list is needed here, and there is no dead escape hatch for a later surface to hide
// in.
//
// areas/chat is out for the same kind of reason, also measured upstream rather than assumed:
// Chat.tsx:37 records that in the default configuration a session-key request moves no LXC at all
// (talyvor-lens `dd1bb44`), which is why that screen shows a catalog LIST PRICE and refuses to
// claim a bill.

/**
 * ⚠⚠ AN EXCLUSION IS A CLAIM, AND IT IS THE CLAIM IN THIS FILE DOING THE MOST WORK — SO IT IS DATA
 * HERE RATHER THAN THE PROSE IT WAS.
 *
 * Docs' census already states the rule: *"A surface excluded silently is indistinguishable from one
 * forgotten, which is how SearchDocs was missed; excluded surfaces are therefore named here."* They
 * WERE named — in the paragraph above — and naming was as far as it went. Nothing joined an
 * exclusion to anything, and the difference matters most for the one whose premise is not in this
 * repository.
 *
 * ⚠ R8 IN settleCommands.test.ts IS THE RULE THAT EXISTS FOR EXACTLY THIS AND IT CANNOT SEE AN
 * EXCLUSION. It iterates the `upstream:` FIELDS OF CENSUS ROWS, so every INCLUDED surface's
 * upstream call site must be a declared subject of a `cannot` entry — and an excluded area has no
 * row, no field, and therefore no obligation. MEASURED, not inferred: `grep -c` for
 * session-key / SESSION_KEYS / tlv_sk_ / LXCShadow / shadowSpend / agentKeyID across
 * deploy/decision-expiry.sh returns **0** over its 48 uncheckable entries. The newest cross-repo
 * surface in this app is the one the register has never heard of, and the reason is structural: a
 * rule that iterates rows is blind to the rows that were removed.
 *
 * ⚠ THE REPO IS IN THE ROW, WHICH IS THE ONE PLACE THIS DIFFERS FROM THE CENSUSES' OWN `upstream:`
 * SHAPE, AND IT IS NOT AN INCONSISTENCY. settleCommands.test.ts derives a census's repository from
 * the DIRECTORY it lives in (`areas/docs` → talyvor-docs) precisely because a bare path joined
 * across repos scored GREEN with half the register deleted — both repos declare
 * `internal/ai/engine.go`. This file is not inside an area and covers three of them, so no
 * directory names its repository and the row has to.
 */
type Exclusion = {
  /** What is out of the population. */
  readonly subject: string
  /** Why, in the words of whatever measured it. */
  readonly why: string
  /**
   * Where the premise lives.
   *
   * ⚠ THERE IS NO THIRD STATE, DELIBERATELY. "local" means a reader can settle it in this
   * checkout; "upstream" means they cannot and the register must carry it. An exclusion that
   * declared neither would be the #274 defect again — a population that silently excuses what it
   * cannot resolve — so the type does not allow one and the rules below refuse it anyway.
   */
  readonly premise:
    | { readonly kind: 'local'; readonly at: string; readonly symbol: string }
    | { readonly kind: 'upstream'; readonly repo: string; readonly upstream: string }
}

/**
 * ⚠ A LITERAL, never `EXCLUDED.length`. A floor measured from the thing it protects passes at
 * zero — this repo's most-repeated finding, and the same reason `expectedRoutes` below is typed
 * out. TWO measured at `d2f11a3`.
 */
const EXPECTED_EXCLUSIONS = 2

const EXCLUDED: readonly Exclusion[] = [
  {
    subject: 'docsApi.generateChangelog (areas/docs/PageChangelog.tsx)',
    why: 'not a metered route at all — "GenerateFromIssues reaches Lens never", no own_ai_cost_usd moves.',
    // Settleable HERE: the measurement is in this repo, in the file it is about.
    premise: { kind: 'local', at: 'areas/docs/PageChangelog.tsx', symbol: 'GenerateFromIssues' },
  },
  {
    subject: 'areas/chat (Chat.tsx)',
    why:
      'in the DEFAULT configuration a session-key request moves no LXC at all, so the screen shows ' +
      'a catalog LIST PRICE and refuses to claim a bill (talyvor-lens dd1bb44, W4.6.1 step 4b).',
    // ⚠ NOT SETTLEABLE HERE, AND THAT IS THE WHOLE POINT. Three upstream facts hold this up and
    // every one of them is a talyvor-lens flag or branch: LXCShadowSpendEnabled defaults FALSE,
    // the agent movers are confined to a file reached only under a non-empty agentKeyID, and
    // internal/auth sets APIKeyID on the workspace-key branch alone. The register carries them.
    premise: {
      kind: 'upstream',
      repo: 'talyvor-lens',
      upstream: 'internal/proxy/shadow_lxc.go#shadowSpendLXC',
    },
  },
]

/** A route whose use bills Lens, and the token its callers must write to reach it.
 *
 *  ⚠ THE MARKER IS THE CODE TOKEN, NOT THE URL, for the two areas that spell the same fact
 *  differently: Docs goes through the `docsApi` object, Track builds paths inline. Matching what
 *  a caller actually types is what makes the scan a measurement of this repo rather than of a
 *  convention.
 */
type MeteredRoute = { readonly marker: RegExp; readonly route: string; readonly upstream: string }

type AreaSpec = {
  readonly area: string
  readonly dir: string
  readonly census: string
  readonly routes: readonly MeteredRoute[]
  /** ⚠ LITERALS, never `.length` of anything derived here. A floor measured from the thing it
   *  protects passes at zero — this repo's most-repeated finding, and the reason Docs' own census
   *  types `EXPECTED_METERED` out. */
  readonly expectedRoutes: number
  readonly expectedSurfaces: number
}

const WEB_SRC = resolve(import.meta.dirname)

const AREAS: readonly AreaSpec[] = [
  {
    area: 'docs',
    dir: resolve(WEB_SRC, 'areas/docs'),
    census: resolve(WEB_SRC, 'areas/docs/meteredCostCensus.test.tsx'),
    routes: [
      {
        marker: /\bdocsApi\.ask\b/,
        route: 'POST /api/docs/ai/ask',
        upstream: 'internal/ai/engine.go#Engine.Ask (docs-ai-ask)',
      },
      {
        marker: /\bdocsApi\.search\b/,
        route: 'GET /api/docs/search',
        upstream: 'internal/search/semantic.go#embed (docs-search)',
      },
      {
        marker: /\bdocsApi\.summarizePage\b/,
        route: 'POST /api/docs/pages/{id}/summarize',
        upstream: 'internal/ai/engine.go#Engine.Summarize (docs-ai-summarize)',
      },
      {
        marker: /\bdocsApi\.translatePage\b/,
        route: 'POST /api/docs/pages/{id}/translate',
        upstream: 'internal/ai/engine.go#Engine.Translate (docs-ai-translate)',
      },
      {
        marker: /\bdocsApi\.suggestTitle\b/,
        route: 'POST /api/docs/pages/{id}/suggest-title',
        upstream: 'internal/ai/engine.go#Engine.SuggestTitle (docs-ai-title)',
      },
    ],
    expectedRoutes: 5,
    expectedSurfaces: 5,
  },
  {
    area: 'track',
    dir: resolve(WEB_SRC, 'areas/track'),
    census: resolve(WEB_SRC, 'areas/track/meteredCostCensus.test.tsx'),
    routes: [
      {
        marker: /\/api\/track\/issues\/\$\{[^}]*\}\/summary\b/,
        route: 'GET /api/track/issues/{id}/summary',
        upstream: 'internal/ai/engine.go:455#Engine.SummarizeThread',
      },
      {
        marker: /\/api\/track\/issues\/\$\{[^}]*\}\/find-duplicates\b/,
        route: 'POST /api/track/issues/{id}/find-duplicates',
        upstream: 'internal/ai/engine.go:373#Engine.FindDuplicates',
      },
      {
        marker: /\/api\/track\/issues\/\$\{[^}]*\}\/triage\b/,
        route: 'POST /api/track/issues/{id}/triage',
        upstream: 'internal/ai/engine.go:320#Engine.Triage',
      },
      {
        marker: /\/api\/track\/issues\/search\b/,
        route: 'GET /api/track/issues/search',
        upstream: 'internal/ai/engine.go:557#Engine.SemanticSearch',
      },
    ],
    expectedRoutes: 4,
    expectedSurfaces: 4,
  },
]

/** Non-test `.ts`/`.tsx` under `dir`, recursively. A test may legitimately name a metered route in
 *  an assertion and a test bills nobody, so tests are not surfaces. */
function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(p))
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(p)
  }
  return out
}

function baseName(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1)
}

/** file basename -> the routes its CODE reaches. */
function meteredSurfaces(spec: AreaSpec): Map<string, MeteredRoute[]> {
  const found = new Map<string, MeteredRoute[]>()
  for (const p of sourceFiles(spec.dir)) {
    const code = stripComments(readFileSync(p, 'utf8'))
    const hits = spec.routes.filter((r) => r.marker.test(code))
    if (hits.length > 0) found.set(baseName(p), hits)
  }
  return found
}

describe('the metered-surface population comes from the source', () => {
  it('the detector reads code and not prose, in both directions', () => {
    // The trap this rule would otherwise walk into, and the sanctioned form it must still see.
    const marker = AREAS[0].routes[2].marker
    expect(marker.test(stripComments('const r = docsApi.summarizePage(id, text)'))).toBe(true)
    expect(marker.test(stripComments('// PageSummary calls docsApi.summarizePage'))).toBe(false)
    expect(marker.test(stripComments('/** …unlike docsApi.summarizePage, this one is free */'))).toBe(
      false,
    )
    // A near-miss must not enrol a file: the boundary is what stops `docsApi.searchAnything`
    // scoring as the metered `docsApi.search`.
    expect(AREAS[0].routes[1].marker.test(stripComments('docsApi.searchArchive(q)'))).toBe(false)
  })

  for (const spec of AREAS) {
    describe(spec.area, () => {
      it('every declared metered route is reached by at least one surface', () => {
        // ⚠ THE ANTI-VACUITY RULE, AND THE ONE #274 PAID FOR ONE LAYER UP. A marker that stops
        // matching — an api method renamed, a path rebuilt a different way — silently SHRINKS the
        // population, and a census that quietly measures less looks exactly like one measuring a
        // healthy product. A route this file cannot resolve is a route it must refuse over.
        expect(spec.routes).toHaveLength(spec.expectedRoutes)
        const surfaces = meteredSurfaces(spec)
        const reached = new Set([...surfaces.values()].flat().map((r) => r.route))
        const unreached = spec.routes.filter((r) => !reached.has(r.route))
        expect(
          unreached.map((r) => `${r.route} (${r.upstream})`),
          `these metered routes are named by NO code in areas/${spec.area}. Either the caller was ` +
            `renamed and this marker no longer finds it — in which case the population this file ` +
            `and areas/${spec.area}/meteredCostCensus.test.tsx run over has silently shrunk — or ` +
            `the surface was deleted and the row belongs deleted too`,
        ).toEqual([])
      })

      it(`every surface that spends is listed in the ${spec.area} census`, () => {
        const surfaces = meteredSurfaces(spec)

        // ⚠ THE MEMBERSHIP CHECK, AND THE WHOLE POINT OF THE FILE. The census's population is a
        // hand-written array; this one is read off the code. A surface in the second and not the
        // first is a screen that spends the workspace's money with nothing holding it to a price
        // at mount or a receipt beside the answer.
        //
        // ⚠ THE CENSUS IS COMMENT-STRIPPED TOO. Its header NAMES surfaces it deliberately does not
        // hold — PageChangelog in Docs — so a prose mention would satisfy this check and the
        // reason the file exists would evaporate. Being written about is not being censused.
        const censusCode = stripComments(readFileSync(spec.census, 'utf8'))
        const missing = [...surfaces.entries()]
          .filter(([base]) => !censusCode.includes(base.replace(/\.tsx?$/, '')))
          .map(([base, hits]) => `${base} -> ${hits.map((h) => h.route).join(' + ')}`)
        expect(
          missing,
          `these areas/${spec.area} surfaces bill Lens and areas/${spec.area}/` +
            `meteredCostCensus.test.tsx does not list them, so nothing asserts they show a price ` +
            `before the reader spends or a receipt after. Add each to that file's METERED array ` +
            `(and bump its literal EXPECTED_METERED), or — if the route does not in fact spend — ` +
            `delete its marker here and record the upstream measurement that says so, the way ` +
            `PageChangelog.tsx does`,
        ).toEqual([])

        // ⚠ THE VACUITY FLOOR, AS A LITERAL, AND IT IS A FLOOR RATHER THAN AN EQUALITY ON
        // PURPOSE. The membership check above passes trivially when the scan reads nothing, so
        // something has to say the scan read a product. It is NOT an equality because the three
        // directions must not mask each other: GROWTH is the membership check's to catch, SHRINK
        // is the route-reached check's, and vacuity is this one's. An equality here would red on
        // growth first and the membership message — the one that names the undisclosed screen —
        // would never be the thing a developer reads.
        expect(
          surfaces.size,
          `the scan of areas/${spec.area} found ${surfaces.size} spending surfaces, below the ` +
            `pinned floor of ${spec.expectedSurfaces}. Found: ` +
            `${[...surfaces.keys()].sort().join(', ') || '(none)'}`,
        ).toBeGreaterThanOrEqual(spec.expectedSurfaces)
      })
    })
  }
})

describe('an exclusion is a claim, and it names where its premise can be settled', () => {
  /**
   * ⚠ THE VACUITY FLOOR, AND IT IS THE ONE THAT MATTERS HERE. Every rule below iterates EXCLUDED,
   * so emptying the table turns this whole block green having read nothing — and an empty
   * exclusion table is exactly what "we forgot to write the area down" looks like. The number is
   * a literal, never `EXCLUDED.length`.
   */
  it('the exclusion table still has the exclusions this file was written about', () => {
    expect(
      EXCLUDED.length,
      'fewer exclusions declared than this file measured. An area dropped OUT of the population ' +
        'without a row here is a surface excluded silently, which is the failure Docs’ census ' +
        'names as how SearchDocs came to be missed.',
    ).toBe(EXPECTED_EXCLUSIONS)
  })

  /**
   * ⚠ A LOCAL PREMISE MUST ACTUALLY BE READABLE HERE, or "settle it in this checkout" is a
   * sentence rather than an instruction. Both halves are asserted — the file resolves AND the
   * symbol is in it — because a pointer that resolves to a file which no longer declares the
   * thing is the stale-anchor shape this repo has repaired eight times.
   */
  it('every local premise resolves to a file that still declares its symbol', () => {
    const broken = EXCLUDED.filter((e) => e.premise.kind === 'local').filter((e) => {
      const p = e.premise as { kind: 'local'; at: string; symbol: string }
      const full = resolve(WEB_SRC, p.at)
      if (!existsSync(full)) return true
      return !readFileSync(full, 'utf8').includes(p.symbol)
    })
    expect(
      broken.map((e) => e.subject),
      'these exclusions say their premise is measurable in this repo and it is not — the file is ' +
        'gone, or it no longer declares the symbol named. Re-anchor it deliberately; do not ' +
        'downgrade it to `upstream`, which would move a premise this checkout CAN settle into the ' +
        'half nobody runs.',
    ).toEqual([])
  })

  /**
   * ⚠ AND AN UPSTREAM PREMISE MUST BE SHAPED SO THE REGISTER CAN JOIN ON IT. R9 in
   * settleCommands.test.ts does the join; this asserts the pointer is well formed BEFORE that
   * rule reads it, so a malformed pointer reds here with a sentence about the pointer rather than
   * there with a sentence about the register.
   *
   * ⚠ THE SYMBOL IS REQUIRED, for R8's own measured reason: joined on the bare path, deleting a
   * settle command scored GREEN because a file of the same name is declared for a different
   * premise in the same repo. A file is not a call site.
   */
  it('every upstream premise names a repo, a path and a symbol', () => {
    const malformed = EXCLUDED.filter((e) => e.premise.kind === 'upstream').filter((e) => {
      const p = e.premise as { kind: 'upstream'; repo: string; upstream: string }
      const [path, symbol] = p.upstream.split('#')
      return p.repo.trim() === '' || !path?.endsWith('.go') || (symbol ?? '').trim() === ''
    })
    expect(
      malformed.map((e) => e.subject),
      'these exclusions rest on a premise in another repository and do not name it as ' +
        '`repo` + `path#Symbol`, so no settle command can be joined to them.',
    ).toEqual([])
  })
})
