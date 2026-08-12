import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A CLASSIFIED FORMATTER THAT NOTHING CALLS — the half of figureFace.test.ts's rule B that
 * rule B cannot state about itself.
 *
 * figureFace.test.ts rule B asks "is every exported `format*` CLASSIFIED as a figure or not?".
 * It never asks whether anything RENDERS it. Its own table says so in a comment against
 * `areas/track/format.ts#formatUSD`: "A FIGURE BY ITS OUTPUT, AND NOTHING RENDERS IT — so this
 * entry is classified honestly and enforced by nothing." A classification nothing can falsify is
 * a sentence, not a guard, and this file is the instrument that makes the reach half checkable.
 *
 * ⚠ MEASURED 2026-08-10 at `2bee9fc`, whole suite green (1020 tests): THREE of the SIX exported
 * `format*` in the product had ZERO production call sites. The handover named one of them.
 *
 *     apps/web/src/areas/lens/format.ts#formatUSD      3   BillingReturn, Overview, TopUp
 *     apps/web/src/areas/lens/format.ts#formatWhen     3   Keys, Ledger, Overview
 *     apps/web/src/areas/lens/topupApi.ts#formatCents  2   BillingReturn, TopUp
 *     apps/web/src/areas/track/format.ts#formatUSD     0   ← a money rule nobody calls
 *     apps/web/src/areas/track/format.ts#formatWhen    0
 *     packages/ui/src/lib/format.ts#formatDay          0   ← and it is public API
 *
 * ⚠ WHY THE MONEY ONE WAS A DEFECT AND NOT MERELY DEAD. `areas/track/format.ts` exported,
 * documented ("Track's reconciled per-issue AI cost") and unit-TESTED a `formatUSD` that rounds
 * to cents, while the one screen rendering `ai_cost_usd` used a LOCAL `costLabel` that does not.
 * They disagree on every value below half a cent ($0.00 vs $0.0004) and at zero ($0.00 vs "No AI
 * spend recorded"). The exported, documented, tested one is the one the next developer finds.
 * It is now `formatCost` — the SHIPPED rule, exported, with the dead namesake deleted.
 *
 * ⚠ A NAME-KEYED INSTRUMENT CANNOT MEASURE THIS, AND MINE DID IT WRONG FIRST. A grep for
 * `formatUSD` credits track's dead export with lens's three call sites — the very collision that
 * defeated rule B's census before it was re-keyed to `module#name`. Reach here is resolved
 * through the IMPORT GRAPH, and `LIVE_FLOOR` below is the hardcoded proof that the two
 * same-named `formatUSD` do not answer for each other.
 *
 * ⚠ WHAT "REACHED" MEANS HERE, STATED RATHER THAN IMPLIED. A named import (`import { x } from`)
 * from a non-test module other than the declaring one. Deliberately NOT counted:
 *   · a bare re-export — `packages/ui/src/index.ts` re-exports `formatDay` and calls nothing;
 *     counting it would make every public export permanently "reached".
 *   · a namespace import — `reachRegistry.ts` does `import * as UI from '@talyvor/ui'` to
 *     ENUMERATE exports for the reach audit. Counting it would mark every `@talyvor/ui` export
 *     reached by the audit harness that exists to measure reach. Rule C pins the namespace
 *     importers so a real component adopting that form fails here rather than hiding a caller.
 * An import THROUGH the barrel IS counted against the declaring module — see `resolveBarrel`.
 */

const appRoot = resolve(import.meta.dirname, '..')
const roots = [resolve(appRoot, 'src'), resolve(appRoot, '../../packages/ui/src')]
const UI_PACKAGE = '@talyvor/ui'
const UI_SRC = resolve(appRoot, '../../packages/ui/src')

function relOf(p: string): string {
  return p.slice(p.indexOf('/apps/') >= 0 ? p.indexOf('/apps/') + 1 : p.indexOf('/packages/') + 1)
}

/** A test, a fixture or a harness — never a production call site. */
function isTestFile(rel: string): boolean {
  return /\.test\.tsx?$/.test(rel) || /(^|\/)__tests__\//.test(rel) || /test-setup\.tsx?$/.test(rel)
}

interface Source {
  abs: string
  path: string
  text: string
  test: boolean
}

function allSources(): Source[] {
  const out: Source[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.tsx?$/.test(e.name)) {
        const path = relOf(p)
        out.push({ abs: p, path, text: readFileSync(p, 'utf8'), test: isTestFile(path) })
      }
    }
  }
  for (const r of roots) walk(r)
  return out
}

const sources = allSources()
const byAbs = new Map(sources.map((s) => [s.abs, s]))

/**
 * THE MODULES WHOSE WHOLE EXPORTED SURFACE EXISTS TO BE CALLED BY A SCREEN.
 *
 * ⚠ IT IS NOT `FORMATTER_MODULES` ANY MORE, AND THE RENAME IS THE FINDING. Three of these are
 * presentation vocabulary; `areas/track/data.ts` is QUERY SEMANTICS, and calling it a formatter
 * module to get it in scope would have been a lie in a constant name. What the four share is the
 * only property this file needs: a human already declared that the module exists to be called
 * from somewhere else, so every export of it is in scope whatever it is called.
 *
 * ⚠ MEASURED AT `7474125`, EVERY GATE GREEN — the Track data layer had THREE exports with zero
 * production importers, and this file could not see one of them:
 *
 *     areas/track/data.ts#filterIssues    imported ONLY by data.test.ts, which carries 5 tests
 *                                         for it — and the screen that finally shipped the live
 *                                         list REFUSED client-side filtering in writing
 *                                         ("a control that narrowed only the rows already
 *                                         fetched would be a filter that lies about what it
 *                                         searched"), so the caller it was kept for was written
 *                                         and chose not to call it
 *     areas/track/data.ts#IssueFilters    its parameter type, and INVISIBLE to this file — see
 *                                         the stated limit on `declaredFormatters`
 *     areas/track/data.ts#useTrackProbe   imported by NOTHING, in any file, test or not
 *
 * ⚠ AND `export class` WAS INVISIBLE TOO, WHICH IS HOW A FIFTH DEFECT SAT AT THE TOP OF THAT
 * MODULE. `TrackApiError extends Error` was exported, area-named and constructed by nothing
 * (#172). The declaration matchers below read `export function` and `export const` only, so a
 * whole KIND of export was outside a rule whose whole subject is exports. It reads classes now.
 *
 * WHAT THIS FILE STILL CANNOT SEE, stated rather than implied: `export interface` and
 * `export type`. A dead type is a weaker hazard than a dead value — nothing can call it and it
 * emits no code — but it is not zero, and `IssueFilters` above is the instance.
 *
 * ⚠ THE `format*` NAME SHAPE WATCHED A DEFECT HAPPEN AND COULD NOT SEE IT. Until `63534de`,
 * `areas/track/format.ts#priorityLabel` was exported, documented and unit-tested against
 * model.IssuePriority with ZERO production call sites, while IssueDetail hand-rolled a second
 * copy of the same five labels for the control that ships — and the Status control beside it
 * rendered the RAW enum while the pill rendered `statusLabel`. Every name in that sentence is a
 * `*Label`, so this file was structurally blind to all of it.
 *
 * ⚠ THE HANDOVER SAID WIDENING THIS NEEDED "A RULE FOR WHAT COUNTS AS A FORMATTER". MEASURED,
 * IT DOES NOT — that framing is what kept the hole open for four sessions. A MODULE is a
 * declaration a human already made: three of these files exist to turn stored values into words
 * and the fourth exists to shape a query, so every export of them is in scope whatever it is
 * called, and no general definition of "formatter" has to be invented. The name rule is kept
 * alongside rather than replaced, so `topupApi.ts#formatCents` — a formatter that lives outside
 * the audited modules — keeps its coverage.
 *
 * Widening added ZERO pins: measured at `63534de`, all five newly-visible exports
 * (`statusLabel`, `priorityLabel`, `PRIORITY_VALUES`, `ledgerStatus`, `humanizeType`) have
 * production call sites. That is not an assumption — rule B proves they are DECLARED in scope and
 * rule A proves the zero-reach set is still exactly the two pins, so all five are reached.
 *
 * ⚠ THE WIDENED RULE PASSED ON ITS FIRST RUN, SO IT WAS CONTROLLED BOTH WAYS.
 *   W1  re-inline the priority vocabulary in IssueDetail, so `priorityLabel` and
 *       `PRIORITY_VALUES` lose their ONLY call sites -> rule A reds, naming both by
 *       `module#name`, and it is the ONLY failure in 1052: `issueVocabulary.test.tsx` stays
 *       green because the re-inlined labels still AGREE. Nothing else in this repo can see a
 *       vocabulary export go dead.
 *   W2  drop one path from AUDITED_MODULES -> rule B reds and RULE A STAYS GREEN. That is the
 *       measured blindness B exists for: A compares two sets that both shrink together.
 */
const AUDITED_MODULES = [
  'apps/web/src/areas/lens/format.ts',
  'apps/web/src/areas/track/format.ts',
  'apps/web/src/areas/track/data.ts',
  'packages/ui/src/lib/format.ts',
]

/**
 * Every export in scope, as `module#name`: anything named `format*` in any non-test module, plus
 * EVERY export of an audited module whatever it is called.
 *
 * ⚠ VALUES ONLY — functions, consts and classes. `export interface` / `export type` are outside
 * it, and that limit is measured rather than assumed: `areas/track/data.ts#IssueFilters` is a
 * dead exported interface this rule cannot name.
 */
function declaredFormatters(): string[] {
  const out = new Set<string>()
  for (const f of sources) {
    if (f.test) continue
    const wholeModule = AUDITED_MODULES.includes(f.path)
    const inScope = (name: string) => wholeModule || name.startsWith('format')
    for (const m of f.text.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g)) {
      if (inScope(m[1])) out.add(`${f.path}#${m[1]}`)
    }
    for (const m of f.text.matchAll(/export\s+const\s+([A-Za-z0-9_]+)\s*[:=]/g)) {
      if (inScope(m[1])) out.add(`${f.path}#${m[1]}`)
    }
    for (const m of f.text.matchAll(/export\s+(?:abstract\s+)?class\s+([A-Za-z0-9_]+)/g)) {
      if (inScope(m[1])) out.add(`${f.path}#${m[1]}`)
    }
  }
  return [...out].sort()
}

/** A relative specifier to the file it names, through the extensions this repo uses. */
function resolveRelative(fromAbs: string, spec: string): Source | undefined {
  const base = resolve(dirname(fromAbs), spec)
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    const hit = byAbs.get(c)
    if (hit) return hit
  }
  return undefined
}

/**
 * `@talyvor/ui` names a barrel, and the barrel calls nothing. A name imported from it belongs to
 * whichever module under `packages/ui/src` DECLARES it — which is what makes an import through
 * the barrel count against `lib/format.ts` rather than against `index.ts`.
 *
 * Resolving by DECLARATION rather than by reading index.ts's re-export lines is deliberate: the
 * barrel also does `export * from './components'`, and a star has no name in it to read.
 */
function resolveBarrel(name: string): Source | undefined {
  const decl = new RegExp(`export\\s+(?:async\\s+)?(?:function|const|class)\\s+${name}\\b|export\\s+\\{[^}]*\\b${name}\\b[^}]*\\}\\s*(?!from)`)
  return sources.find((s) => !s.test && s.abs.startsWith(UI_SRC) && s.abs !== resolve(UI_SRC, 'index.ts') && decl.test(s.text))
}

/** `module#name` -> the non-test modules that named-import it. */
function namedImporters(): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const f of sources) {
    for (const m of f.text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g)) {
      const spec = m[2]
      const names = m[1]
        .split(',')
        .map((s) => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim())
        .filter(Boolean)
      for (const name of names) {
        const target = spec.startsWith('.') ? resolveRelative(f.abs, spec) : spec === UI_PACKAGE ? resolveBarrel(name) : undefined
        if (!target || target.path === f.path) continue
        const key = `${target.path}#${name}`
        if (!out.has(key)) out.set(key, [])
        if (!f.test) out.get(key)!.push(f.path)
      }
    }
  }
  return out
}

/** Files that namespace-import the design system — see rule C. */
function namespaceImportersOfUI(): string[] {
  return sources
    .filter((s) => !s.test && new RegExp(`import\\s+\\*\\s+as\\s+\\w+\\s+from\\s+['"]${UI_PACKAGE}['"]`).test(s.text))
    .map((s) => s.path)
    .sort()
}

/**
 * THE PINNED DEAD SET — every exported `format*` with no production call site, and WHY it is
 * allowed to have none. A source-derived guard alone cannot see a deletion; the pin is what
 * makes this checkable in both directions.
 *
 * Do not add an entry to make this file pass. An exported formatter nobody calls is either a
 * caller waiting to be written or an export waiting to be deleted; say which.
 */
const DEAD: Record<string, string> = {
  // No surface in the product renders a Track timestamp: IssueDetail and IssueList show none
  // (measured — zero `toLocale*`/`Intl` calls and zero `created_at`/`updated_at` renders in
  // areas/track outside this module). Lens's namesake is the one that ships. Kept rather than
  // deleted here because deleting it is not this merge's finding; it is recorded so that the
  // next reader sees a measurement instead of assuming a caller exists.
  'apps/web/src/areas/track/format.ts#formatWhen':
    'no Track surface renders a timestamp; lens/format.ts#formatWhen is the one with call sites',
  // Public API of @talyvor/ui, promoted out of areas/docs ("Promoted verbatim from areas/docs")
  // — and the promotion left no caller behind: measured, the product renders no date-only value
  // anywhere. Deleting a shared package's published export is a wider decision than this merge.
  'packages/ui/src/lib/format.ts#formatDay':
    'promoted to the design system out of areas/docs and the last caller went with the promotion; no surface renders a date-only value',
}

/**
 * ⚠ HARDCODED, AND IT IS THE POINT. Two modules export a `formatUSD` whose arguments differ by
 * 10^6. If reach were resolved by NAME, the dead one would inherit these three call sites and
 * this file would report a clean product — the exact failure that defeated rule B's census
 * before it was re-keyed. A resolver that breaks makes this floor red, not the pin.
 */
const LIVE_FLOOR = 'apps/web/src/areas/lens/format.ts#formatUSD'

describe('an exported formatter nobody calls', () => {
  const declared = declaredFormatters()
  const importers = namedImporters()
  const reach = (k: string) => (importers.get(k) ?? []).length

  // ⚠ THERE IS NO SEPARATE "every pin still exists" ASSERTION, AND THAT IS DELIBERATE. It was
  // written, it passed on the first run, and no control could make it fail on its own: the
  // measured set is FILTERED FROM `declared`, so a pin naming a formatter that no longer exists
  // is a key A already sees as extra. An invariant held twice cannot be breached by a one-line
  // control, and an assertion no control can claim is decoration. Its message lives in A instead.
  it('A. the formatters with no production call site are exactly the ones pinned, with a reason', () => {
    const measured = declared.filter((k) => reach(k) === 0).sort()
    const stale = Object.keys(DEAD).filter((k) => !declared.includes(k))
    expect(
      measured,
      `pinned but no longer declared: ${stale.join(', ') || 'none'}\n` +
        'an exported formatter nobody calls is a caller waiting to be written or an export waiting to be deleted',
    ).toEqual(Object.keys(DEAD).sort())
  })

  /**
   * ⚠ RULE A CANNOT SEE THIS RULE BEING TURNED OFF, WHICH IS THE WHOLE REASON IT IS SEPARATE.
   * Empty `AUDITED_MODULES` and A still passes: the measured set shrinks back to the `format*`
   * names, and BOTH pins in `DEAD` are `format*` names, so the two sides stay equal and A reports
   * a clean product over a rule that now reads nothing. A source-derived scope needs a pinned
   * claim beside it — the module paths, and hardcoded names that only the widened scope can
   * produce. `priorityLabel` is one of them on purpose: it is the export whose deadness this file
   * was blind to. `memberName` is the newest: it is the only pin that dies if `data.ts` is
   * dropped from the list, so the module that was added to this scope cannot leave it silently.
   */
  it('B. the scope really does reach past the format* name shape, and its modules still exist', () => {
    const present = new Set(sources.filter((s) => !s.test).map((s) => s.path))
    expect(
      AUDITED_MODULES.filter((m) => !present.has(m)),
      'an audited module was renamed or moved; a scope that names a path nobody has silently reads nothing',
    ).toEqual([])
    expect(declared).toContain('apps/web/src/areas/track/format.ts#priorityLabel')
    expect(declared).toContain('apps/web/src/areas/track/format.ts#statusLabel')
    expect(declared).toContain('apps/web/src/areas/lens/format.ts#ledgerStatus')
    expect(declared).toContain('apps/web/src/areas/track/data.ts#memberName')
  })

  it('C. the design system is namespace-imported only by the reach registry', () => {
    expect(namespaceImportersOfUI()).toEqual(['apps/web/src/reachRegistry.ts'])
  })

  it('D. reach is resolved per module, not per name — the live formatUSD keeps its own callers', () => {
    expect(declared).toContain(LIVE_FLOOR)
    expect(importers.get(LIVE_FLOOR) ?? []).toEqual([
      'apps/web/src/areas/lens/BillingReturn.tsx',
      'apps/web/src/areas/lens/Overview.tsx',
      'apps/web/src/areas/lens/TopUp.tsx',
    ])
  })

  it('E. an import through the @talyvor/ui barrel is credited to the module that declares it', () => {
    // Not a formatter: `cn` is re-exported by index.ts from lib/cn and imported by name all over
    // apps/web, so it proves the barrel hop without depending on the state under test.
    expect(resolveBarrel('cn')?.path).toBe('packages/ui/src/lib/cn.ts')
    expect((importers.get('packages/ui/src/lib/cn.ts#cn') ?? []).length).toBeGreaterThan(0)
  })
})
