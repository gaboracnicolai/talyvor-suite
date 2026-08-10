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
})
