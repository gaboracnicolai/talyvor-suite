import { readFileSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * A `File.tsx:NN` POINTER IS A CLAIM ABOUT A LINE, AND NOTHING IN THIS REPO CHECKED ONE.
 *
 * This item has now paid for the same lesson three times. `47486d3` wrote it down after its own
 * first draft reported an offender at the wrong line:
 *
 *     a wrong line number in a failure message sends the next reader to the wrong place
 *
 * and then `319335c` regressed it in a different file. The pointers do not rot because anyone
 * edits them — they rot because somebody inserts a line ABOVE the thing they name. Every fix this
 * item ships moves code down, so every merge is an opportunity for silent drift, and a stale
 * pointer is invisible to every instrument here: it is prose to the type checker, prose to eslint,
 * and prose to all seven audits.
 *
 * ── WHAT WAS MEASURED, AND WHY THE SWEEP IS THE POINT ────────────────────────────────────────
 *
 * `319335c` handed over TWO stale pointers, both naming `MuNumeral.tsx:19`. A census of both
 * packages at that SHA finds ELEVEN pointers, and THREE of them are stale — the third,
 * `caseAudit.ts:42`, is stale on BOTH axes and nobody had looked at it:
 *
 *     caseAudit.ts:42  "Landing.tsx:72 is `<span className="font-figure text-eyebrow uppercase
 *                       text-faint">{unit}</span>`"
 *     Landing.tsx:72    <span className="inline-flex items-baseline gap-1.5">      ← the wrapper
 *     Landing.tsx:78    <span className="font-figure text-eyebrow uppercase text-faint">
 *     Landing.tsx:79      <CaseSafe>{unit}</CaseSafe>            ← and it no longer says {unit}
 *
 * That sentence is the load-bearing argument for why the case rule cannot be a source rule, and
 * the code it quotes to prove it had already been changed BY THE FIX THAT RULE EXISTS TO DESCRIBE.
 * Fixing the two that were handed over and not sweeping for the third is this item's own recurring
 * finding — "the fix was applied where the defect was found and the same shape one directory over
 * was never swept for" — which is why this is a census and a pin rather than two edits.
 *
 * ── LIVE vs HISTORICAL IS A CLASSIFICATION, NOT AN EXEMPTION ─────────────────────────────────
 *
 * Three of the eleven name a line as it stood at a NAMED PAST SHA (`1351de9`, `c71ca9c`) and are
 * correct as written — a reader is told they are reading history. They cannot be checked the same
 * way, and skipping them would leave a hole an author could park anything in. So they assert the
 * OPPOSITE: a HISTORICAL pointer's target must NOT contain the fragment. An entry filed as history
 * that has quietly become true again fails as MISFILED and has to be re-read, and an entry filed
 * as LIVE that drifts fails as STALE. Neither direction is a free pass.
 *
 * ── THE FLOOR ────────────────────────────────────────────────────────────────────────────────
 *
 * The table is compared to the census as a SET, both directions. A pointer added anywhere in
 * either package is unclassified and fails; a pointer deleted leaves a stale entry and fails. A
 * source-derived guard cannot see a deletion and a pinned list cannot see an addition, so this
 * repo's answer is to hold both and require them to agree — the failure mode that keeps recurring
 * here is a sweep whose closure quietly went empty while its assertion stayed true.
 *
 * ── THE LIMIT, STATED RATHER THAN IMPLIED ────────────────────────────────────────────────────
 *
 * A pointer is checked against ONE LINE. A sentence that names the right line while describing it
 * wrongly still passes — this pins WHERE, not WHAT. It also reads raw source including comments,
 * deliberately: a pointer inside a comment is exactly the thing being checked, so blanking
 * comments here would empty the closure entirely.
 */

const WEB_SRC = resolve(import.meta.dirname)
const UI_SRC = resolve(import.meta.dirname, '../../../packages/ui/src')
const REPO = resolve(import.meta.dirname, '../../..')

/**
 * ⚠ THIS FILE EXCLUDES ITSELF, AND THAT EXCLUSION IS ASSERTED RATHER THAN ASSUMED.
 *
 * The table below quotes all eleven pointers verbatim, so a census that read this file would find
 * every pointer twice and score its own source as product — a guard reading itself back is a
 * failure this repo has already met once. The exclusion is by exact repo-relative path and the
 * test below asserts that path really is on disk, so renaming this file cannot turn the exclusion
 * into a filter that matches nothing.
 */
const SELF = 'apps/web/src/pointerAudit.test.ts'

/** `Some/Path.tsx:123` or `Name.ts:12` — the shape a human writes when citing a line. */
const POINTER = /\b([A-Za-z0-9_.\-/]+\.(?:tsx|ts|css|mjs|js)):(\d+)\b/g

type Kind = 'LIVE' | 'HISTORICAL'
interface Pin {
  kind: Kind
  /** LIVE: the target line must CONTAIN this. HISTORICAL: it must NOT. */
  fragment: string
  why: string
}

/**
 * Every `file:line` pointer in both packages, keyed by `<source>:<line>|<target>:<line>`.
 *
 * The fragment is the thing the quoting sentence promises is there, copied from that sentence
 * rather than from the target — a fragment read off the target would be true by construction.
 */
const PINS: Record<string, Pin> = {
  'apps/web/src/eyebrowAudit.ts:25|apps/web/src/areas/lens/Overview.tsx:191': {
    kind: 'LIVE',
    fragment: 'text-eyebrow uppercase',
    why: "the console's densest eyebrow, the surface `319335c` dropped `uppercase` from to prove 678 tests could not see it",
  },
  'apps/web/src/eyebrowAudit.ts:49|packages/ui/src/components/MuNumeral.tsx:23': {
    kind: 'LIVE',
    fragment: 'text-eyebrow uppercase',
    why: 'the element that OPENS the eyebrow, quoted to show CaseSafe sits inside it rather than on it',
  },
  'apps/web/src/placeholderAudit.ts:34|apps/web/src/areas/lens/Keys.tsx:97': {
    kind: 'LIVE',
    fragment: 'placeholder={k.key_prefix}',
    why: 'the site that passes a placeholder THROUGH a component, the whole argument for reading the DOM',
  },
  'apps/web/src/motion.test.tsx:154|packages/ui/src/preset.ts:149': {
    kind: 'LIVE',
    fragment: 'active:scale-[0.98]',
    why: 'the comment that writes the press one way, half of the pair the motion lock exists to keep apart',
  },
  'apps/web/src/motion.test.tsx:155|packages/ui/src/components/Button.tsx:37': {
    kind: 'LIVE',
    fragment: 'active:scale-98',
    why: 'the comment that writes the press the OTHER way — the two spellings are the point',
  },
  'apps/web/src/PanelReportsItsOwnQuery.test.tsx:28|apps/web/src/areas/lens/Overview.tsx:291': {
    kind: 'LIVE',
    fragment: 'error={ledger.error}',
    why: 'the CORRECT copy of the seam Spend.tsx had backwards — the whole positive control for that finding is that this line reads `ledger.error` while its guard is `ledger.isError`',
  },
  'apps/web/src/PanelReportsItsOwnQuery.test.tsx:303|apps/web/src/areas/lens/Overview.tsx:291': {
    kind: 'LIVE',
    fragment: '<Failed what="the mint ledger" error={ledger.error} />',
    why: 'the same line quoted VERBATIM beside the must-stay-green control that asserts its wording, so the quote and the assertion cannot drift apart',
  },
  'apps/web/src/caseAudit.ts:11|packages/ui/src/components/CaseSafe.tsx:85': {
    kind: 'LIVE',
    fragment: 'normal-case',
    why: 'the ONE applied `normal-case` in the product; the sentence says "exactly ONE ... in the product" in the present tense',
  },
  'apps/web/src/caseAudit.ts:42|apps/web/src/areas/marketing/Landing.tsx:79': {
    kind: 'LIVE',
    fragment: 'font-figure text-eyebrow uppercase text-faint',
    why: 'the uppercase label whose µ arrives as a prop from 130 lines away — the reason the rule cannot be a source rule',
  },
  'apps/web/src/test-setup.ts:202|packages/ui/src/components/CaseSafe.tsx:85': {
    kind: 'LIVE',
    fragment: 'normal-case',
    why: 'a DEVELOPER-FACING FAILURE MESSAGE naming the shape to copy — read exactly when somebody is already confused',
  },

  'apps/web/src/restingAffordance.test.ts:26|apps/web/src/areas/track/IssueList.tsx:357': {
    kind: 'HISTORICAL',
    fragment: 'hover:underline',
    why: 'the offender AS IT STOOD AT `1351de9`, quoted with that SHA; `47486d3` fixed it to `underline underline-offset-2`',
  },
  'apps/web/src/restingAffordance.test.ts:50|apps/web/src/areas/track/IssueList.tsx:325': {
    kind: 'HISTORICAL',
    fragment: 'hover:underline',
    why: "the line that file's own first draft wrongly reported — the sentence exists to say it holds something else",
  },
  'apps/web/src/displayScale.test.ts:20|apps/web/src/areas/track/IssueDetail.tsx:154': {
    kind: 'HISTORICAL',
    fragment: 'text-display-3',
    why: 'the console surface that reached for display type AS AT `c71ca9c`, quoted with that SHA',
  },

  // The four pointers packages/ui's setup writes when it explains why the audits are installed
  // there. The first two are the evidence that check-audit-reach.mjs's "NO test renders it" was
  // a claim about ONE of two projects; the second two are the precedent for importing upward.
  'packages/ui/src/__tests__/setup.ts:21|packages/ui/src/__tests__/components.test.tsx:46': {
    kind: 'LIVE',
    fragment: '<HoldBar elapsed={3} total={4}',
    why: "the hold-window fixture the reach table said nobody would write — HoldBar's only render anywhere",
  },
  'packages/ui/src/__tests__/setup.ts:22|packages/ui/src/__tests__/promotions.test.tsx:34': {
    kind: 'LIVE',
    fragment: '<FixtureNotice awaiting=',
    why: 'the second component the reach table classified as rendered by no test, rendered by a test',
  },
  'packages/ui/src/__tests__/setup.ts:41|packages/ui/src/__tests__/invariant.test.ts:26': {
    kind: 'LIVE',
    fragment: "'../../../../apps/web/src'",
    why: 'the precedent: this project already reaches up into apps/web from its own tests',
  },
  'packages/ui/src/__tests__/setup.ts:41|packages/ui/src/__tests__/selection.test.ts:255': {
    kind: 'LIVE',
    fragment: "'../../../../apps/web/src'",
    why: 'the second instance of that precedent, so the direction is a habit rather than one file',
  },
  // The four pointers the numeric-field audit and its tests write. Both sites they quote are the
  // MEASUREMENT that rule is built on: one is the offender it was written for, the other is the
  // exemption — a field whose value IS a figure and correctly is not on the face.
  'apps/web/src/fieldFaceAudit.ts:18|apps/web/src/areas/lens/ConvertLens.tsx:129': {
    kind: 'LIVE',
    fragment: 'inputMode="decimal"',
    why: 'the one field in the product that declares itself numeric — the defect this audit was written for',
  },
  'apps/web/src/fieldFaceAudit.ts:68|apps/web/src/areas/lens/ConvertLens.tsx:129': {
    kind: 'LIVE',
    fragment: 'inputMode="decimal"',
    why: 'the same site quoted where the rule argues the declaration is written in a DIFFERENT FILE from the class list',
  },
  'apps/web/src/fieldFaceAudit.ts:20|apps/web/src/areas/marketing/Landing.tsx:292': {
    kind: 'LIVE',
    fragment: 'type="range"',
    why: 'the live slider whose value is a figure OFF the face, and correctly so — the exemption, not a hypothetical',
  },
  'apps/web/src/fieldFaceAudit.ts:104|apps/web/src/areas/marketing/Landing.tsx:292': {
    kind: 'LIVE',
    fragment: 'type="range"',
    why: 'the same slider quoted beside the exemption set itself, so the set cannot be widened without meeting it',
  },
  'apps/web/src/fieldFaceAudit.test.tsx:31|apps/web/src/areas/lens/ConvertLens.tsx:129': {
    kind: 'LIVE',
    fragment: 'inputMode="decimal"',
    why: 'the unit case that pins the predicate to the real call site rather than to an invented fixture',
  },
  'apps/web/src/fieldFaceAudit.test.tsx:51|apps/web/src/areas/marketing/Landing.tsx:292': {
    kind: 'LIVE',
    fragment: 'type="range"',
    why: 'the unit case for the exemption, naming the render it exists to keep quiet',
  },
}

/** Every .ts/.tsx in both packages, TESTS INCLUDED — a failure message is developer-facing text. */
function sourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue
      const p = resolve(dir, name)
      if (statSync(p).isDirectory()) {
        walk(p)
        continue
      }
      if (!/\.tsx?$/.test(name)) continue
      if (relative(REPO, p) === SELF) continue
      out.push(p)
    }
  }
  walk(WEB_SRC)
  walk(UI_SRC)
  return out.sort()
}

interface Found {
  key: string
  target: string
  line: number
  source: string
}

/** Resolve a written target to a repo-relative path: a bare basename must be UNIQUE. */
function resolveTarget(written: string, all: string[]): string | null {
  if (written.includes('/')) {
    const rel = written.replace(/^\.\//, '')
    return all.some((p) => relative(REPO, p) === rel) ? rel : null
  }
  const hits = all.filter((p) => p.endsWith(`/${written}`))
  return hits.length === 1 ? relative(REPO, hits[0]) : null
}

function census(): { found: Found[]; unresolved: string[] } {
  const all = sourceFiles()
  const found: Found[] = []
  const unresolved: string[] = []
  for (const p of all) {
    const rel = relative(REPO, p)
    const text = readFileSync(p, 'utf8')
    const lines = text.split('\n')
    lines.forEach((line, i) => {
      for (const m of line.matchAll(POINTER)) {
        const target = resolveTarget(m[1], all)
        if (target === null) {
          unresolved.push(`${rel}:${i + 1} -> ${m[1]} (no unique file)`)
          continue
        }
        found.push({ key: `${rel}:${i + 1}|${target}:${m[2]}`, target, line: Number(m[2]), source: rel })
      }
    })
  }
  return { found, unresolved }
}

const { found, unresolved } = census()

describe('every file:line pointer names a line that holds what the sentence promises', () => {
  it('excludes exactly this file, and this file is really there', () => {
    const self = resolve(REPO, SELF)
    expect(statSync(self).isFile()).toBe(true)
    expect(sourceFiles().map((p) => relative(REPO, p))).not.toContain(SELF)
  })

  it('the census is not empty — a sweep over zero pointers asserts nothing', () => {
    expect(found.length).toBeGreaterThan(8)
  })

  it('resolves every written target to exactly one file', () => {
    expect(unresolved).toEqual([])
  })

  it('classifies every pointer found, and finds every pointer classified', () => {
    const seen = found.map((f) => f.key).sort()
    const filed = Object.keys(PINS).sort()
    expect(seen.filter((k) => !filed.includes(k))).toEqual([])
    expect(filed.filter((k) => !seen.includes(k))).toEqual([])
  })

  it('every LIVE pointer names a line that CONTAINS its fragment', () => {
    const stale: string[] = []
    for (const f of found) {
      const pin = PINS[f.key]
      if (!pin || pin.kind !== 'LIVE') continue
      const lines = readFileSync(resolve(REPO, f.target), 'utf8').split('\n')
      const body = lines[f.line - 1]
      if (body === undefined) {
        stale.push(`${f.key} — line ${f.line} is past EOF (${lines.length} lines)`)
        continue
      }
      if (!body.includes(pin.fragment)) {
        stale.push(`${f.key} — expected ${JSON.stringify(pin.fragment)}, line holds ${JSON.stringify(body.trim().slice(0, 80))}`)
      }
    }
    expect(stale).toEqual([])
  })

  it('every HISTORICAL pointer names a line that no longer holds its fragment', () => {
    const misfiled: string[] = []
    for (const f of found) {
      const pin = PINS[f.key]
      if (!pin || pin.kind !== 'HISTORICAL') continue
      const lines = readFileSync(resolve(REPO, f.target), 'utf8').split('\n')
      const body = lines[f.line - 1]
      if (body !== undefined && body.includes(pin.fragment)) {
        misfiled.push(`${f.key} — filed as history but the line holds ${JSON.stringify(pin.fragment)} again`)
      }
    }
    expect(misfiled).toEqual([])
  })
})
