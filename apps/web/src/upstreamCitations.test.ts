import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A CROSS-REPO LINE CITATION IS A CLAIM THAT DECAYS WITHOUT ANY LOCAL CHANGE, AND THIS ONE DECAYED
 * INTO THREE CONTRADICTORY ANSWERS.
 *
 * ⚠ MEASURED, NOT SUSPECTED. Eight comments in this repo cited talyvor-track's
 * `internal/model/model.go` by LINE, and they disagreed with each other about where ONE enum
 * lives:
 *
 *     model.go:94-98    IssueList.tsx, IssueList.test.tsx ×2      IssuePriority
 *     model.go:65-73    areas/track/format.ts, types.ts           IssuePriority
 *     model.go:113-120  issueVocabulary.test.tsx                  IssuePriority   ← the only true one
 *     model.go:54-63    areas/track/format.ts, types.ts           IssueStatus
 *
 * Measured against talyvor-track at HEAD: `type IssuePriority` is at 113 with its constants at
 * 116-120, and `type IssueStatus` is at 57 with its constants at 60-65. So SEVEN of the eight were
 * wrong, and the two failure modes are both worse than merely stale:
 *
 *   · `model.go:65-73` now spans `StatusCancelled`, a closing paren and `ImporterCreatorID` — a
 *     reader following the priority citation lands on an UNRELATED constant.
 *   · `model.go:54-63` now ENDS at `StatusInReview`, so a reader following the status citation
 *     sees FOUR of the six values and has every reason to think this repo's six-value list is
 *     wrong.
 *
 * ⚠ AND NOBODY WAS CARELESS — THAT IS THE WHOLE POINT. At `a3bc7b2`, the commit `types.ts` says
 * this repo mirrors, `IssueStatus` WAS at 54-63 and `IssuePriority` WAS at 65-73. Both citations
 * were exactly right when written. Upstream inserted three lines above the status enum and moved
 * priority forty-eight lines down, and every one of these comments became false with no commit in
 * this repo touching them. (`94-98` matches neither commit measured — a third answer from a third
 * moment.) There is no review that catches this and no local test that can fail for it: the
 * premise lives in another repository, so the number is unverifiable from here BY CONSTRUCTION.
 *
 * ⚠ SO THE FIX IS NOT BETTER NUMBERS. Correcting them to today's truth re-arms the same trap on
 * the next upstream insert — the `113-120` citation above is already the correct-today form and
 * will rot exactly like its siblings. A SYMBOL survives edits: `type IssuePriority` is greppable
 * upstream, cannot silently point at a different declaration, and stays true when the file moves.
 *
 * WHAT THIS GUARD CLAIMS, precisely: no comment in the scanned tree cites talyvor-track's
 * `model.go` by line. It does NOT claim the symbol names are right — that premise still lives in
 * another repo and this file cannot check it. It makes the UNVERIFIABLE form impossible for the
 * one file whose decay was root-caused, which is the half that is checkable from here.
 *
 * ⚠ AND THE SCOPE IS NARROWER THAN THE PROBLEM, SAID OUT LOUD SO IT IS NOT READ AS COVERAGE. The
 * same scan, unrestricted, finds 44 Go line citations across 24 distinct upstream paths in at
 * least three repositories (talyvor-lens `internal/proxy/proxy.go`, `internal/alerts/alerts.go`,
 * `internal/economy/*`, `internal/mining/*`, `internal/poolroyalty/*`, `cmd/lens/main.go`, …;
 * talyvor-track `internal/issue/store.go`). Every one of them decays the same way. They are
 * MEASURED AND NOT FIXED HERE: correcting comments in files this session did not read would be a
 * wide diff resting on no measurement. A future session widening `CITED_FILE` should re-measure
 * rather than trust this paragraph's numbers.
 *
 * ⚠ NOT EVERY Go CITATION IS THE SAME CLASS. `apps/bff/lens.go:348` and `apps/bff/billing.go:180`
 * name a file IN THIS REPOSITORY. Those are verifiable from here — a guard could actually check
 * them — so they are deliberately out of this rule's scope rather than swept in with the ones
 * whose premise is unreachable.
 */

const appRoot = resolve(import.meta.dirname, '..')
const ROOTS = [resolve(appRoot, 'src'), resolve(appRoot, '../../packages/ui/src')]

/** Every .ts/.tsx under the scanned roots, as (repo-relative path, text). */
function sources(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = resolve(dir, e.name)
      if (e.isDirectory()) walk(abs)
      else if (/\.tsx?$/.test(e.name)) {
        const i = abs.indexOf('/apps/')
        const j = abs.indexOf('/packages/')
        out.push({ path: abs.slice((i >= 0 ? i : j) + 1), text: readFileSync(abs, 'utf8') })
      }
    }
  }
  ROOTS.forEach(walk)
  return out
}

/**
 * THE WALK'S OWN POPULATION, ASSERTED AGAINST AN INSTRUMENT THAT DOES NOT SHARE ITS MACHINERY.
 *
 * ⚠ MEASURED, NOT SUSPECTED (`~/talyvor-queue/w11-areasprune-census-3a6d.py`). Rule A is an
 * ABSENCE sweep, and its own floor says so — but the floor names five files, none of them under
 * `areas/lens`. Armed with a real `model.go:54-63` citation planted in a real file there:
 *   A1  the citation with the tree whole          → this file REDS.
 *   A2  the same citation, `areas/lens` unreachable → GREEN. 23 of the 69 production files under
 *       apps/web/src (33%) stopped being read and neither the floor nor rule A noticed.
 * `all.length > 80` is satisfied by the files that survive, and every named anchor is in
 * `areas/track` or `packages/ui`, so ADDING ONE MORE NAMED FILE IS THE WRONG REPAIR: it would
 * arm this rule for `areas/lens` and leave the next area exactly as blind.
 *
 * ⚠ AND NO SECOND INSTRUMENT WAS WATCHING: this file's test count is FIXED at 3, so unlike
 * `packages/ui/src/__tests__/invariant.test.ts` — which generates one `it()` per file and whose
 * 104 → 81 drop test-manifest.json catches — losing a whole product area moved nothing here.
 *
 * THE REPAIR IS #183's AND IT IS THRESHOLD-FREE. `import.meta.glob` is resolved by Vite at
 * transform time and touches `node:fs` not at all, so a wrong root, a changed extension filter or
 * a walk that stops descending cannot move both instruments the same way. Compared BOTH
 * DIRECTIONS. The floor is for the one failure that CAN move both: an anchor resolving to an
 * empty tree leaves the two enumerations agreeing on nothing.
 */
/** This file, as `sources()` spells it. See the self-exclusion note in the comparison below. */
const SELF = 'apps/web/src/upstreamCitations.test.ts'

describe('the sweep reads the whole tree', () => {
  // ⚠ NOT FILTERED TO NON-TEST FILES, because `sources()` is not: this rule deliberately scans
  // test files too — `areas/track/issueVocabulary.test.tsx` is one of its own named anchors, and a
  // rotted citation in a test comment is exactly as unverifiable as one in a component.
  //
  // ⚠ THE CALL IS LITERAL ON PURPOSE. Vite rewrites `import.meta.glob` by matching the SYNTAX at
  // transform time; hoisting it into a variable typechecks and then dies at runtime.
  const globbed = Object.keys(
    import.meta.glob(['./**/*.{ts,tsx}', '../../../packages/ui/src/**/*.{ts,tsx}']),
  ).map((k) => {
    const p = resolve(import.meta.dirname, k)
    return p.slice(p.indexOf('/apps/') >= 0 ? p.indexOf('/apps/') + 1 : p.indexOf('/packages/') + 1)
  })

  it('finds a substantial tree across both roots, so an empty anchor cannot pass', () => {
    // Deliberately far below the count at b940d57: this catches an anchor that resolves to
    // nothing, not a refactor that moves files. The set comparison below is what catches a skip.
    expect(globbed.length).toBeGreaterThan(80)
  })

  it('the fs walk and Vite’s glob agree on the file set, both directions', () => {
    // The REAL sweep, called exactly as rule A calls it — an assertion about the walk under test
    // rather than about a second walk written here, which would be free to drift from it.
    const swept = new Set(sources().map((s) => s.path))
    const glob = new Set(globbed)
    // ⚠ THE ONE LEGITIMATE DIFFERENCE, MEASURED RATHER THAN ASSUMED: Vite's glob never returns the
    // module doing the globbing — a self-import would be a cycle. Probed directly: a throwaway
    // module globbing `./**/*.{ts,tsx}` got 163 keys including 93 `.test.*` files and
    // `upstreamCitations.test.ts` itself, but NOT its own path. The other four sweeps repaired
    // alongside this one filter `.test.*` out, so their own file is gone either way; this rule
    // scans test files DELIBERATELY, so its own file is genuinely in `sources()`'s population.
    // Subtracted BY NAME and asserted present on the walk side, so if the walk ever stops reading
    // it this becomes a red rather than a quietly vacuous exclusion.
    expect(swept.has(SELF), `${SELF} is no longer read by the walk it excludes itself from`).toBe(true)
    swept.delete(SELF)
    expect(
      [...glob].filter((f) => !swept.has(f)).sort(),
      'Vite sees files this walk never read. Rule A checks whatever the walk returns, so anything ' +
        'missing here is a file whose upstream citations have never been looked at.',
    ).toEqual([])
    expect(
      [...swept].filter((f) => !glob.has(f)).sort(),
      'the walk read files Vite does not see. Either it left the two roots, or the two disagree ' +
        'about what a source file is.',
    ).toEqual([])
  })
})

/**
 * The one upstream file in scope: talyvor-track's model.go, however it is spelled — bare
 * `model.go:` or fully qualified `internal/model/model.go:`. Both forms were in the tree.
 */
const CITED_FILE = /\b((?:[A-Za-z0-9_./-]*\/)?model\.go):(\d+(?:-\d+)?)/g

describe('citations of upstream Go source', () => {
  // ⚠ THE FLOOR IS NOT DECORATION. Rule A is an ABSENCE sweep, and an absence sweep is green on a
  // scanner that read nothing — a bad root, a renamed directory or a walk that silently returned
  // [] all report a spotless product. This asserts the instrument reached the tree AND reached the
  // specific files whose citations are the reason the rule exists.
  it('reads the product — a scanner that found nothing must not report a clean tree', () => {
    const all = sources()
    expect(all.length).toBeGreaterThan(80)
    for (const named of [
      'apps/web/src/areas/track/types.ts',
      'apps/web/src/areas/track/format.ts',
      'apps/web/src/areas/track/IssueList.tsx',
      'apps/web/src/areas/track/issueVocabulary.test.tsx',
      'packages/ui/src/index.ts',
    ]) {
      const f = all.find((s) => s.path === named)
      expect(f, `${named} was not scanned — the walk does not cover the tree it claims to`).toBeDefined()
      expect(f!.text.length).toBeGreaterThan(0)
    }
  })

  // RULE A — the unverifiable form is gone, for the file whose decay was root-caused.
  it("cites talyvor-track's model.go by symbol, never by line number", () => {
    const offenders: string[] = []
    for (const s of sources()) {
      if (s.path.endsWith('upstreamCitations.test.ts')) continue // this file quotes the dead form
      for (const m of s.text.matchAll(CITED_FILE)) {
        offenders.push(`${s.path}: ${m[1]}:${m[2]}`)
      }
    }
    expect(
      offenders,
      'a line number in another repository is a claim that decays with no commit here — every one of ' +
        'these was correct when written and false by the time it was read; cite the symbol instead',
    ).toEqual([])
  })

  // RULE B — the citations still SAY something. Rule A is satisfied by deleting every reference to
  // upstream entirely, which would trade a false pointer for no pointer at all; these pin that the
  // four sites that carried the enum citations still name the upstream file AND the symbol. Keyed
  // by path so a file being renamed or emptied reds here rather than quietly passing rule A.
  it('still names the upstream declaration, by symbol', () => {
    const byPath = new Map(sources().map((s) => [s.path, s.text]))
    const REQUIRED: [string, string[]][] = [
      ['apps/web/src/areas/track/types.ts', ['model.go', 'type IssueStatus', 'type IssuePriority']],
      ['apps/web/src/areas/track/format.ts', ['model.go', 'type IssueStatus', 'type IssuePriority']],
      ['apps/web/src/areas/track/IssueList.tsx', ['model.go', 'type IssuePriority']],
      ['apps/web/src/areas/track/issueVocabulary.test.tsx', ['model.go', 'type IssuePriority']],
    ]
    for (const [path, needles] of REQUIRED) {
      const text = byPath.get(path)
      expect(text, `${path} is gone from the scan`).toBeDefined()
      for (const n of needles) {
        expect(text!.includes(n), `${path} no longer names ${n}`).toBe(true)
      }
    }
  })

  /**
   * RULE C — A PER-FILE RATCHET, BECAUSE THE CENSUS THIS FILE DEFERRED CAME BACK BIGGER THAN THE
   * PARAGRAPH THAT DEFERRED IT, AND TWO OF ITS CITATIONS ARE ALREADY FALSE ON THE MONEY PATH.
   *
   * ⚠ RE-MEASURED at suite `91bd1eb`, as this file's header asks a widening session to do rather
   * than trusting its numbers. The unrestricted scan finds **57 Go line citations across 27
   * distinct upstream paths** — the header says 44 across 24. It grew, and it will keep growing.
   *
   * ⚠ AND THE DECAY IS NOT HYPOTHETICAL. Every citation in `areas/lens/spendMath.ts` was resolved
   * against the real talyvor-lens tree at `a04310a`. Nine were true. TWO WERE FALSE, and both are
   * load-bearing on the LXC spend math:
   *
   *   · it cited agent_subbudget.go line 191 for a statement it QUOTES verbatim — "a bound, NOT a
   *     bill … revenue readers MUST exclude it". Line 191 is BLANK; the statement is 45 lines
   *     away, at 236-237. That quote is the entire justification for the allow-list rule that
   *     replaced a sign test, after real rows summed 8,380 where 1,840 was spent. A reader
   *     checking whether Lens still says it lands on nothing and may put the sign rule back.
   *   · it cited dualtoken.go line 432 as one of three writers that "require a positive amount".
   *     432 is a bare closing brace of an unrelated nil-check; the guard is at 427-428. That claim
   *     is why `splitShortfall` is allowed to go negative.
   *
   * ⚠ WHY THIS IS A PER-FILE OPT-IN AND NOT A TREE-WIDE BAN. A tree-wide ban is the right end
   * state and it forces ~50 rewrites at once, including line-RANGE citations that name three
   * adjacent route registrations (`cmd/lens/main.go` lines 1832-1835, 1869-1871, 1878-1879) and
   * have no clean symbol form. Converting comments in files nobody re-measured is the wide diff
   * resting on no measurement this file's header already refused once. So the rule takes the shape
   * this repo chose for the same problem in `formatterReach` — a per-module opt-in — and a file
   * joins the list only when EVERY citation in it has been resolved against the upstream tree.
   *
   * SO A PASS HERE IS NOT COVERAGE, AND THE LIST SAYS SO: one file is enrolled. The other ~26
   * upstream paths are a census handed to the queue, not a swept set.
   *
   * WHAT IT CLAIMS: an enrolled file cites no Go file by line — not upstream, and not this repo's
   * own `apps/bff`, because "verifiable in principle" is not "verified" and nothing verifies them.
   */
  const SYMBOL_ONLY_FILES = ['apps/web/src/areas/lens/spendMath.ts']
  const ANY_GO_LINE = /\b([A-Za-z0-9_./-]+\.go):(\d+(?:-\d+)?)/g

  it('the enrolled files cite Go source by symbol only, never by line', () => {
    const byPath = new Map(sources().map((s) => [s.path, s.text]))
    const offenders: string[] = []
    for (const path of SYMBOL_ONLY_FILES) {
      const text = byPath.get(path)
      // THE FLOOR. This is an ABSENCE rule over a NAMED list, so a file that is renamed, moved or
      // dropped from the walk would satisfy it by not existing — the loudest possible pass. An
      // enrolled file that the walk cannot produce is a red, not a silence.
      expect(
        text,
        `${path} is enrolled in the symbol-only rule but the walk did not produce it — an absence ` +
          'rule over a file that is not there passes for free',
      ).toBeDefined()
      expect(text!.length).toBeGreaterThan(0)
      for (const m of text!.matchAll(ANY_GO_LINE)) offenders.push(`${path}: ${m[1]}:${m[2]}`)
    }
    expect(
      offenders,
      'a Go line citation in an enrolled file. Every citation in these files was resolved against ' +
        'the real upstream tree once; a line number puts that back to unverifiable — cite the symbol.',
    ).toEqual([])
  })
})
