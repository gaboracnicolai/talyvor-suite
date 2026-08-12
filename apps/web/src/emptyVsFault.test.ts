import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// emptyVsFault.test.ts — AN EMPTY-COLLECTION BRANCH MUST NOT BE REACHABLE ON A REFUSED READ.
//
// THE DEFECT THIS WAS WRITTEN FROM. `IssueDetail.tsx`'s comment thread branched `isLoading` →
// `(comments.data ?? []).length === 0` with nothing in between. A refused read leaves `data`
// undefined, so the panel printed "No comments yet. Add the first one below." — the sentence a
// genuinely empty thread gets — on 500, on 403 and on 401 alike. Measured on the real component
// with only /comments refused, the panel's entire text was identical at all three codes:
// "CommentsNo comments yet. Add the first one below.Add a commentComment".
//
// ⚠ THE PRODUCT ALREADY KNEW THE RULE AND SAID SO TWICE, WHICH IS WHY THIS IS A SWEEP AND NOT A
// TEST. `IssueList.tsx`: "A fault must not read as an empty tracker: those are different states
// and conflating them tells a tester their work vanished." `SpaceView.tsx`: "Couldn't reach Docs,
// so no pages can be shown. This is a fault, not an empty space." Twelve of the product's
// thirteen empty branches were written correctly by hand and the thirteenth was not — a rule
// held in prose in two files is a rule the fourteenth panel will not inherit.
//
// ⚠ AND THE SWEEP THAT ALREADY ENUMERATES THESE SENTENCES CANNOT SEE IT. `EmptyStates.test.tsx`
// finds every empty state in the product and asks whether each NAMES A NEXT ACTION. "No comments
// yet. Add the first one below." names one, so it passes there — and passed while it was being
// printed over a thread the screen had failed to read. The two rules are orthogonal: one asks
// whether the sentence is useful, this one asks whether it is true.
//
// ⚠ STATED LIMIT, AND IT IS MEASURED, NOT GUESSED. This asks "is SOME failure state tested,
// on the path to this branch". It does not ask whose failure, and it does not ask whether the
// test is exhaustive. Both halves were driven, not reasoned about
// (`~/talyvor-queue/w11-emptyfault-controls-b8d5.py`, 8 real mutations, catcher named first):
//
//   · WHOSE. `Spend.tsx` shipped a chain guarded on `ledger.isError` that handed `PanelFailure`
//     the OTHER query's `lxc.error`, so a dead credential got the wrong diagnosis. This file
//     would have passed it.
//   · EXHAUSTIVE. Control C4 deleted BOTH error arms from IssueList's issues panel and this
//     sweep stayed GREEN: the component also opens with `if (isUnconfigured(issues.error))`, a
//     statement-level gate that satisfies the rule while the generic-fault arm is gone. The
//     defect was caught — by IssueList's own behavioural test, "a real failure stays a failure".
//
// So this is a FLOOR for a panel that handles no failure at all, which is the shape the defect
// above had, and it is measured to catch exactly that (C1, C5, C6, C7, C8 all red it). It is not
// a substitute for a test that refuses the read and reads the screen.

const SRC = join(__dirname)

// Surfaces only, same boundary EmptyStates.test.tsx draws and for the same reason: routes/ is
// legal copy and lib/ has no JSX.
const SCANNED = ['areas', 'components']

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (p.endsWith('.tsx') && !p.endsWith('.test.tsx')) out.push(p)
  }
  return out
}

/**
 * Comments are stripped before anything is matched, because this repo's comments necessarily
 * QUOTE the code they explain — `Spend.tsx`'s error arm is explained in a note that says
 * "`ledger.error`, NOT `lxc.error`", and a panel could be handed a passing grade by a sentence
 * about a bug. Newlines are preserved one-for-one so reported line numbers stay real.
 *
 * ⚠ THERE IS NO SEPARATE JSX-COMMENT RULE HERE, AND ITS ABSENCE IS THE POINT. The obvious first
 * pass is `\{\s*\/\*[\s\S]*?\*\/\s*\}` for `{​/* … *​/}`. MEASURED on IssueList.tsx: that pattern
 * opens on ANY `{` whose next non-space is `/*` — an interface brace followed by a JSDoc line —
 * and then, non-greedy or not, it cannot close until it finds a `*​/` that IS followed by `}`,
 * which is the next JSX comment hundreds of lines later. It swallowed lines 176–333 of
 * IssueList.tsx, taking `export function IssueList()` and `create.isError` with them: the
 * detector then read one declaration in the whole file and scoped every branch to `const PAGE`.
 * A `{​/* … *​/}` is just a block comment inside braces, so the block rule already removes its
 * body; the leftover `{}` is inert for every pattern below. C8 pins this.
 *
 * ⚠ AND THE LINE RULE RUNS FIRST, WHICH IS NOT A STYLE CHOICE. `TrackArea.tsx` opens on a line
 * comment reading "App.tsx mounts this under /track/* (wildcard)". With the block rule first,
 * that `/​*` is a block-comment OPENER: it ran to the `*​/` of the JSX comment on line 107 and
 * blanked ninety-seven lines, taking `if (q.data.length === 0)` with them. The sweep then
 * reported twelve branches instead of thirteen and was green about a file it had not read.
 * C11 pins it, and `the stripper never removes an empty branch` re-measures it over the whole
 * corpus so the next path-shaped comment cannot repeat it silently.
 */
export function stripComments(src: string): string {
  return src
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => '\n'.repeat((m.match(/\n/g) ?? []).length))
}

/**
 * The window's SPINE: the same text with every balanced `{…}` group removed, so only the levels
 * that are still open at the branch survive.
 *
 * ⚠ WITHOUT THIS THE RULE IS SATISFIED BY A SIBLING. `IssueList.tsx` reads `create.isError` in
 * the create form — a JSX container that opens and closes long before the issues list — and that
 * one appearance would clear the list panel of a rule about the list panel. MEASURED: with both
 * of the issues panel's error arms deleted, the flat window still contained `.isError` and the
 * sweep passed. A group that closes before the branch cannot guard it; a group still open at the
 * branch is an ancestor and can. C9/C10 pin both directions.
 */
export function spine(text: string): string {
  const stack: string[] = []
  let cur = ''
  for (const ch of text) {
    if (ch === '{') {
      stack.push(cur)
      cur = ''
    } else if (ch === '}' && stack.length > 0) {
      cur = stack.pop() as string
    } else {
      cur += ch
    }
  }
  return stack.join('') + cur
}

/** An empty-collection render branch. `.length === 0` is the shape all thirteen are written in. */
const EMPTY_BRANCH = /\.length\s*===\s*0/g

/**
 * The enclosing top-level declaration. NOT the innermost `{`: the first version of this scoped
 * the window that way and `Spend.tsx` refuted it — its empty branch sits in a NESTED JSX
 * container inside the chain that guards it, so the innermost brace cut the error arm out of
 * view and reported two panels as unguarded that are guarded. The false positives are the reason
 * the window is this wide, and a control below pins that shape.
 */
const DECL = /^(?:export\s+)?(?:default\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*[:=])/gm

/** A failure state being read. `PanelFailure`/`Failed` are handed `q.error`, so both are covered. */
const ERROR_TESTED = /\.isError\b|\.error\b/

export type Branch = { file: string; line: number; scope: string; guarded: boolean }

export function findEmptyBranches(src: string, file = '<memory>'): Branch[] {
  const clean = stripComments(src)
  const decls: [number, string][] = []
  for (const m of clean.matchAll(DECL)) decls.push([m.index, m[1] ?? m[2]])
  const out: Branch[] = []
  for (const m of clean.matchAll(EMPTY_BRANCH)) {
    let start = 0
    let scope = '<module>'
    for (const [pos, name] of decls) {
      if (pos > m.index) break
      start = pos
      scope = name
    }
    // Up to the branch, never past it: an error arm written AFTER the empty one is not reachable
    // from it, and counting it would pass the exact ordering this rule is about.
    out.push({
      file,
      line: clean.slice(0, m.index).split('\n').length,
      scope,
      guarded: ERROR_TESTED.test(spine(clean.slice(start, m.index))),
    })
  }
  return out
}

function surfaces(): string[] {
  return SCANNED.flatMap((dir) => walk(join(SRC, dir)))
}

function sweep(): Branch[] {
  return surfaces().flatMap((file) =>
    findEmptyBranches(readFileSync(file, 'utf8'), relative(SRC, file)),
  )
}

describe('an empty state must not be what a refused read looks like', () => {
  const found = sweep()

  // NON-VACUITY. A detector that finds nothing passes everything — three guards in this repo have
  // shipped that way. The corpus held 13 branches across 9 files when this was written; the floor
  // sits under that so a normal deletion does not red it and a broken detector does.
  it('the detector actually finds the empty branches', () => {
    expect(found.length).toBeGreaterThanOrEqual(12)
  })

  // ⚠ THE INSTRUMENT'S OWN CONTROL, AND IT IS HERE BECAUSE THE INSTRUMENT FAILED THIS ONCE. A
  // floor on the count cannot see one site disappear — thirteen became twelve when the stripper
  // ate TrackArea.tsx and every remaining assertion was green. This compares the branches present
  // in the RAW file against the branches the detector saw, per file, so a stripper that swallows
  // live code reds here instead of reporting a smaller corpus. It is one-directional on purpose:
  // clean may legitimately hold FEWER only if a branch is genuinely inside a comment, and today
  // no file in the corpus has one, so the counts are equal everywhere.
  it('the stripper never removes an empty branch', () => {
    const eaten = surfaces()
      .map((file) => {
        const raw = readFileSync(file, 'utf8')
        const count = (s: string) => (s.match(/\.length\s*===\s*0/g) ?? []).length
        return { file: relative(SRC, file), raw: count(raw), seen: count(stripComments(raw)) }
      })
      .filter((f) => f.raw !== f.seen)
    expect(eaten, 'the comment stripper blanked a live empty branch').toEqual([])
  })

  it('every empty-collection branch has a failure state tested before it', () => {
    const unguarded = found.filter((b) => !b.guarded).map((b) => `${b.file}:${b.line} (${b.scope})`)
    expect(
      unguarded,
      'A component that renders "nothing here yet" without first branching on the read having ' +
        'FAILED tells the reader their data is absent when it is unreadable. Those are different ' +
        'states. Add the error arm above the empty one — IssueList.tsx and SpaceView.tsx are the ' +
        'shape, and PanelFailure is the shared one for the Lens panels.',
    ).toEqual([])
  })
})

// ⚠ POSITIVE CONTROLS. Every one drives the real `findEmptyBranches`, and each names the defect
// it would catch. The corpus is clean by the time this file lands, so without these the whole
// sweep could be a detector that matches nothing.
describe('controls — the detector and the rule can both actually fail', () => {
  const verdicts = (src: string) => findEmptyBranches(src).map((b) => b.guarded)

  it('C1 an empty branch with no error arm is flagged — the defect this was written from', () => {
    const src = [
      'export function Thread() {',
      '  return c.isLoading ? <p>Loading…</p> : (c.data ?? []).length === 0 ? <p>None yet.</p> : <Rows />',
      '}',
    ].join('\n')
    expect(verdicts(src)).toEqual([false])
  })

  it('C2 an error arm before the empty branch clears it', () => {
    const src = [
      'export function Thread() {',
      '  return c.isLoading ? <p>Loading…</p> : c.isError ? <Failed /> : (c.data ?? []).length === 0 ? <p>None yet.</p> : <Rows />',
      '}',
    ].join('\n')
    expect(verdicts(src)).toEqual([true])
  })

  it('C3 an error arm written AFTER the empty branch does NOT clear it', () => {
    const src = [
      'export function Thread() {',
      '  return rows.length === 0 ? <p>None yet.</p> : c.isError ? <Failed /> : <Rows />',
      '}',
    ].join('\n')
    expect(verdicts(src)).toEqual([false])
  })

  // The v1 false positive, kept as a control so the window can never be narrowed back to the
  // innermost brace without this going red. Spend.tsx is exactly this shape.
  it('C4 an empty branch nested inside the guarded chain is NOT flagged', () => {
    const src = [
      'export function Spendish() {',
      '  return q.isLoading ? <Loading /> : q.isError ? <Failed /> : (',
      '    <>',
      '      <div>{rows.map(r => <Row key={r.id} />)}</div>',
      '      {agg.length === 0 ? <p>Nothing to split.</p> : null}',
      '    </>',
      '  )',
      '}',
    ].join('\n')
    expect(verdicts(src)).toEqual([true])
  })

  // ⚠ THE CONTROL ON THE STRIPPER. Every error arm in this product is explained in a comment that
  // names `.error`, so a detector reading comments would clear every panel it looked at —
  // including the one that has no error arm at all.
  it('C5 a comment naming .isError does not clear a branch', () => {
    const src = [
      'export function Thread() {',
      '  // TODO: branch on c.isError here',
      '  /* the arm above used to read c.error */',
      '  return (c.data ?? []).length === 0 ? <p>None yet.</p> : <Rows />',
      '}',
    ].join('\n')
    expect(verdicts(src)).toEqual([false])
  })

  it('C6 a previous component’s error arm does not clear the next component’s branch', () => {
    const src = [
      'export function First() {',
      '  return a.isError ? <Failed /> : <Rows />',
      '}',
      'export function Second() {',
      '  return b.length === 0 ? <p>None yet.</p> : <Rows />',
      '}',
    ].join('\n')
    expect(findEmptyBranches(src).map((b) => [b.scope, b.guarded])).toEqual([['Second', false]])
  })

  it('C7 the reported line survives comment stripping', () => {
    const src = ['/* one', 'two', 'three */', 'export function T() {', '  return x.length === 0', '}'].join('\n')
    expect(findEmptyBranches(src)[0].line).toBe(5)
  })

  // ⚠ C8 IS A CONTROL ON THE STRIPPER THAT ALREADY FAILED ONCE. With a `{/* … */}` rule in front
  // of the block rule, the `{` of `type V = {` opens on the JSDoc under it and closes on the JSX
  // comment far below, blanking everything between — including the component declaration and the
  // error read. The scope reported here is the whole assertion: `T`, not the type alias above it.
  it('C8 a JSDoc under an opening brace does not bridge to a distant {/* … */}', () => {
    const src = [
      'type V = {',
      '  /** a doc comment */',
      '  a: string',
      '}',
      'export function T() {',
      '  return (',
      '    <div>',
      '      {/* a JSX comment, hundreds of lines later in the real file */}',
      '      {q.isError ? <Failed /> : rows.length === 0 ? <p>None yet.</p> : <Rows />}',
      '    </div>',
      '  )',
      '}',
    ].join('\n')
    expect(findEmptyBranches(src)).toEqual([
      { file: '<memory>', line: 9, scope: 'T', guarded: true },
    ])
  })

  // ⚠ C9/C10 ARE THE SPINE, AND C9 IS A DEFECT THIS SWEEP SHIPPED FOR ONE ITERATION. IssueList's
  // create form reads `create.isError`; without the spine that one word cleared the issues list
  // of a rule about the issues list, and deleting both of the list's own error arms passed.
  it('C9 an error read in a sibling container that CLOSED does not clear the branch', () => {
    const src = [
      'export function T() {',
      '  return (',
      '    <div>',
      '      {create.isError ? <p>Could not create.</p> : null}',
      '      {rows.length === 0 ? <p>None yet.</p> : <Rows />}',
      '    </div>',
      '  )',
      '}',
    ].join('\n')
    expect(verdicts(src)).toEqual([false])
  })

  // ⚠ C11 IS THE ONE THAT WAS SHIPPING WRONG. A line comment naming a wildcard route contains
  // `/​*`, and with the block rule ahead of the line rule it opened a comment that ran to the next
  // `*​/` in the file. Everything between was blanked, and the sweep reported a corpus one branch
  // smaller with every assertion green.
  it('C11 a /* inside a line comment does not open a block comment', () => {
    const src = [
      '// App.tsx mounts this under /track/* (wildcard), so ALL Track routing lives here.',
      'export function T() {',
      '  if (q.data.length === 0) return <p>None yet.</p>',
      '  return <Rows />',
      '}',
      '{/* a JSX comment far below, whose */ closes the phantom block comment */}',
    ].join('\n')
    expect(findEmptyBranches(src).map((b) => [b.line, b.scope])).toEqual([[3, 'T']])
  })

  it('C10 an error read in an ANCESTOR container still open at the branch clears it', () => {
    const src = [
      'export function T() {',
      '  return (',
      '    <div>',
      '      {q.isError ? <Failed /> : (',
      '        <>',
      '          {rows.length === 0 ? <p>None yet.</p> : <Rows />}',
      '        </>',
      '      )}',
      '    </div>',
      '  )',
      '}',
    ].join('\n')
    expect(verdicts(src)).toEqual([true])
  })
})
