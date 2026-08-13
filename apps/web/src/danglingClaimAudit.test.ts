import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * A DELETION LEAVES ITS DOCUMENTATION BEHIND, AND FOUR SURVIVORS OF ONE DELETION WERE LIVE.
 *
 * Suite #59 (`030ea53`) removed the `docs_shared` key from `/auth/me` — the BFF stopped serving
 * it and the client interface stopped declaring it. What the commit did NOT remove was the prose
 * describing it. Measured at `8ba994f`, four claims about that field were still in the source,
 * and each had attached itself to something else:
 *
 *   apps/bff/auth.go        five comment lines about the removed key, the last one CUT OFF
 *                           MID-SENTENCE by the same commit, sitting directly above the
 *                           `signup_open` entry so they read as ITS documentation — and naming
 *                           `docsWorkspaceID` as "the pin", a config field `track_tenant_test.go`
 *                           asserts can never come back.
 *   apps/web/src/lib/api.ts the removed member's doc block orphaned in front of the NEXT member's
 *                           own doc block. Its sentence "Absent (older BFF) is treated as false:
 *                           silence must not manufacture a warning" thereby became policy for a
 *                           CONSENT field whose absent-handling is the opposite.
 *   PoolingConsent.tsx      a `See …` sending the reader to a module deleted by the same commit —
 *                           twelve lines above a paragraph in the same file saying that module's
 *                           subject is gone.
 *   Entry.test.tsx          a fixture comment announcing the key was about to follow. It did not.
 *
 * ⚠ THIS REPOSITORY'S OWN REGISTER SAID THE OPPOSITE. `apps/bff/cited_guard_test.go` recorded, as
 * the documented reason a deleted test may still be cited, that "/auth/me no longer serves
 * docs_shared, so the disclosure cannot outlive the pin it described". It outlived it four times.
 * A register entry is a claim like any other and that one was checked by nothing.
 *
 * ── WHY NOT THE OBVIOUS GUARD ────────────────────────────────────────────────────────────────
 *
 * Two blanket rules were measured first and both are dead, so they are written down here rather
 * than re-derived by whoever reads this next.
 *
 *   "every bare path named in a comment must resolve" — 2795 mentions across the repo, 203
 *   distinct unresolved, and MOST ARE HONEST: cross-repo basenames, shell variables, and files
 *   named precisely BECAUSE they are gone ("it used to render seven fabricated pages from
 *   ./fixtures.ts", "replaces the deleted shared scaffold test"). A rule needing a 200-entry
 *   allowlist is prose wearing an assertion's clothes.
 *
 *   "a comment naming a camelCase identifier must name one declared in the package" — 297 in
 *   `apps/bff`, 32 unresolved, most of them legitimate references to Lens and web symbols. Also
 *   dead.
 *
 * The two rules below were chosen because each is mechanically exact, needs NO allowlist, and
 * measured EXACTLY ONE red on the source it was written against. An allowlist was not omitted
 * for tidiness — neither rule has one because neither rule needs one, and if either ever does,
 * that is the signal the rule was wrong rather than the source.
 *
 * ── THE LIMIT, STATED RATHER THAN IMPLIED ────────────────────────────────────────────────────
 *
 * Neither rule reads intent. RULE A does not know whether the orphaned block is about a removed
 * member or is a second thought about the live one; it knows only that a member carries two, and
 * that a member documented twice is documented by nobody. RULE B does not know whether the
 * sentence describes the file correctly; it knows only that you cannot go and read a file that is
 * not there. Both pin STRUCTURE, and both were measured against the state that produced the four
 * defects above rather than argued for.
 *
 * ⚠ AND THIS FILE OBEYS RULE B, which is why the deleted module above is described rather than
 * cited. Writing `See <that path>` here would make this header the guard's own first offender —
 * the same reason `cited_guard_test.go` describes its ten dangling test names instead of spelling
 * them. That is not a limitation worked around; it is the rule working on the file that adds it.
 *
 * ⚠ WHAT IS STILL OUT OF SCOPE, SAID OUT LOUD: the `apps/bff` half. The Go comment was found by
 * the same reading, and the mechanical tell it shares — a comment block whose final line ends
 * mid-sentence — measures 872 blocks in that package with 31 flagged, of which 27 are section
 * banners ending in a box-drawing rule. That rule is plausible and cheap but it needs its own
 * allowlist and its own controls in a different language, so it is priced here and not smuggled
 * into a TypeScript guard that cannot run it.
 */

const WEB_SRC = resolve(import.meta.dirname)
const UI_SRC = resolve(import.meta.dirname, '../../../packages/ui/src')
const REPO = resolve(import.meta.dirname, '../../..')

/** Every `.ts`/`.tsx` under a root, `node_modules` and build output excluded. */
function sourceFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist') continue
      const p = resolve(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.tsx?$/.test(name)) out.push(p)
    }
  }
  walk(root)
  return out
}

/**
 * BOTH PACKAGES, ALWAYS. This repo has learned three times that a guard scoped to the directory
 * the defect was found in keeps re-finding the same shape one directory over — `check-audit-gate`
 * and `check-audit-reach` were each widened after the fact, and the silent-test-loss guard covered
 * one of two vitest projects for its whole life. The census floor below is measured over the union
 * so a walk that stops after `apps/web` reds instead of quietly shrinking its own population.
 */
function allSourceFiles(): string[] {
  return [...sourceFiles(WEB_SRC), ...sourceFiles(UI_SRC)]
}

// ════════════════════════════════════════════════════════════════════════════════════════
// RULE A — a member documented twice is documented by nobody
// ════════════════════════════════════════════════════════════════════════════════════════

interface OrphanedBlock {
  file: string
  line: number
  member: string
  blocks: number
  firstLine: string
}

/**
 * ⚠ THE COMPILER API, NOT A REGEX, AND THE DIFFERENCE IS THE WHOLE RULE. A regex for two
 * consecutive `/** *` blocks finds 27 across these two packages and 26 are legitimate — a file
 * header followed by the first declaration's own doc is exactly that shape. Asking the parser for
 * an INTERFACE MEMBER's leading comment ranges cannot see a file header, because a file header is
 * not leading trivia of a member. Same intuition, and the scoping is what turns 26 false positives
 * into none.
 */
function membersWithMultipleDocBlocks(): { members: number; documented: number; orphans: OrphanedBlock[] } {
  const orphans: OrphanedBlock[] = []
  let members = 0
  let documented = 0

  for (const file of allSourceFiles()) {
    const text = readFileSync(file, 'utf8')
    const sf = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )

    const visit = (node: ts.Node): void => {
      if (ts.isInterfaceDeclaration(node) || ts.isTypeLiteralNode(node)) {
        for (const member of node.members) {
          members++
          const ranges = ts.getLeadingCommentRanges(text, member.pos) ?? []
          const jsdoc = ranges.filter((r) => text.slice(r.pos, r.pos + 3) === '/**')
          if (jsdoc.length > 0) documented++
          if (jsdoc.length > 1) {
            orphans.push({
              file: relative(REPO, file),
              line: sf.getLineAndCharacterOfPosition(member.getStart(sf)).line + 1,
              member: member.name ? member.name.getText(sf) : '<unnamed>',
              blocks: jsdoc.length,
              firstLine: text.slice(jsdoc[0].pos, jsdoc[0].end).split('\n')[0].trim(),
            })
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return { members, documented, orphans }
}

// ════════════════════════════════════════════════════════════════════════════════════════
// RULE B — you cannot go and read a file that is not there
// ════════════════════════════════════════════════════════════════════════════════════════

/**
 * A path-shaped token with at least one `/` and a source extension. The slash matters: a bare
 * `alerts.go` names a file in another repository and this guard cannot tell which, which is the
 * same cross-repo boundary `upstreamCitations.test.ts` refuses to guess at.
 */
const SEE_POINTER = /\bsee\s+((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:tsx|ts|go|md|mjs|css))\b/gi

/**
 * Comment text only, line and block, with string literals skipped. A path inside a string is code
 * — an import that names a missing module does not typecheck — and sweeping those in would score
 * the module graph, which the compiler already checks.
 */
function commentLines(src: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = []
  let i = 0
  let line = 1
  while (i < src.length) {
    const c = src[i]
    if (c === '\n') {
      line++
      i++
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      i++
      while (i < src.length) {
        if (src[i] === '\\') {
          i += 2
          continue
        }
        if (src[i] === '\n') line++
        if (src[i] === quote) {
          i++
          break
        }
        i++
      }
      continue
    }
    if (c === '/' && src[i + 1] === '/') {
      let end = src.indexOf('\n', i)
      if (end < 0) end = src.length
      out.push({ line, text: src.slice(i, end) })
      i = end
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      let end = src.indexOf('*/', i)
      if (end < 0) end = src.length
      else end += 2
      const segment = src.slice(i, end)
      segment.split('\n').forEach((t, k) => out.push({ line: line + k, text: t }))
      line += (segment.match(/\n/g) ?? []).length
      i = end
      continue
    }
    i++
  }
  return out
}

/**
 * The four places a reader would actually look: beside the citing file, at the repo root, and
 * under either package root — so both `lib/signupOpen.ts` (package-relative) and
 * `apps/web/scripts/reach-global-setup.ts` (repo-relative) resolve, as they are meant to.
 */
function seeTargetResolves(target: string, fromFile: string): boolean {
  const candidates = [
    resolve(dirname(fromFile), target),
    resolve(REPO, target),
    resolve(REPO, 'apps/web', target),
    resolve(REPO, 'packages/ui', target),
    resolve(REPO, 'apps/web/src', target),
    resolve(REPO, 'packages/ui/src', target),
  ]
  return candidates.some((c) => existsSync(c))
}

interface SeePointer {
  file: string
  line: number
  target: string
  text: string
}

function seePointers(): { resolved: SeePointer[]; dangling: SeePointer[]; commentLines: number } {
  const resolved: SeePointer[] = []
  const dangling: SeePointer[] = []
  let scanned = 0

  for (const file of allSourceFiles()) {
    const src = readFileSync(file, 'utf8')
    for (const { line, text } of commentLines(src)) {
      scanned++
      for (const m of text.matchAll(SEE_POINTER)) {
        const p: SeePointer = { file: relative(REPO, file), line, target: m[1], text: text.trim() }
        if (seeTargetResolves(m[1], file)) resolved.push(p)
        else dangling.push(p)
      }
    }
  }
  return { resolved, dangling, commentLines: scanned }
}

// ════════════════════════════════════════════════════════════════════════════════════════

describe('the census finds a population', () => {
  /**
   * ⚠ THE FLOORS ARE LITERALS, NEVER A COUNT COMPARED AGAINST ITSELF. A scan that reads nothing
   * satisfies every rule below it, and this repo has shipped that guard three times. Each number
   * here was measured at `8ba994f` and set well under the measurement, so ordinary growth and
   * ordinary deletion do not touch it and a scanner that breaks does.
   */
  it('parses both packages and finds interface members to check', () => {
    const files = allSourceFiles()
    expect(files.length).toBeGreaterThanOrEqual(150) // measured 212

    const { members, documented } = membersWithMultipleDocBlocks()
    expect(members).toBeGreaterThanOrEqual(500) // measured 764

    // And the comment-range reader genuinely works in the POSITIVE direction. Without this, a
    // `getLeadingCommentRanges` that always returned nothing would pass RULE A forever.
    //
    // ⚠ THIS FLOOR WAS GUESSED AT 100 ON THE FIRST DRAFT AND THE MEASUREMENT IS 96, so the guard
    // failed for a reason that had nothing to do with the repo. Left in the header because it is
    // the same defect one axis over: a number written from expectation rather than from a count.
    expect(documented).toBeGreaterThanOrEqual(60) // measured 96
  })

  it('walks packages/ui, not only apps/web', () => {
    const ui = allSourceFiles().filter((f) => f.startsWith(UI_SRC))
    expect(ui.length).toBeGreaterThanOrEqual(20) // measured 43
  })

  it('reads comments, and most see-pointers resolve', () => {
    const { resolved, dangling, commentLines: scanned } = seePointers()
    expect(scanned).toBeGreaterThanOrEqual(5000) // measured 13434; proves the reader ran

    // The population floor for RULE B specifically. Nine were measured; six is the floor, so a
    // deliberate deletion is allowed and an empty closure is not.
    expect(resolved.length + dangling.length).toBeGreaterThanOrEqual(6)

    // Resolution works: if MOST see-pointers dangled, the resolver is what is broken, not the
    // comments — and the guard would be reporting its own bug as the repo's.
    expect(resolved.length * 2).toBeGreaterThanOrEqual(resolved.length + dangling.length)
  })
})

describe('RULE A — no interface member carries two doc blocks', () => {
  it('every documented member is documented once', () => {
    const { orphans } = membersWithMultipleDocBlocks()
    const report = orphans.map(
      (o) =>
        `${o.file}:${o.line} — member \`${o.member}\` has ${o.blocks} leading doc blocks; the first ` +
        `documents something that is no longer there: ${o.firstLine}`,
    )
    expect(report).toEqual([])
  })
})

describe('RULE B — every `see <path>` names a file that exists', () => {
  it('a comment sending the reader somewhere sends them somewhere real', () => {
    const { dangling } = seePointers()
    const report = dangling.map(
      (d) => `${d.file}:${d.line} — points at ${d.target}, which is not on disk: ${d.text}`,
    )
    expect(report).toEqual([])
  })
})
