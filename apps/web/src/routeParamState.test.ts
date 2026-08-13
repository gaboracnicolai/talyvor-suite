import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { stripComments } from '../../../packages/ui/src/lib/sourceText'

// routeParamState.test.ts — STATE THAT BELONGS TO A ROUTE PARAM MUST BE THROWN AWAY WHEN THE
// PARAM CHANGES.
//
// ── THE DEFECT, THREE TIMES, IN THREE FILES WRITTEN MONTHS APART ─────────────────────────────
//
// React Router matches every value of a param to ONE <Route> element, so A → B changes the param
// underneath the element and does NOT remount it: every `useState` survives. Three screens grew
// this independently and each was found by hand, by whoever happened to be reading the file:
//
//   `f4c1e97` (#190)  areas/docs/PageView.tsx    page A's text saved INTO page B
//   `d82bcfb` (#192)  areas/track/IssueDetail.tsx issue A's words PATCHed onto issue B
//   `ef6ee03` (#193)  areas/docs/SpaceView.tsx    a page created in space B titled for space A
//
// The third was found by a census rather than a reader. This file is that census, kept.
//
// ⚠ WHY A SWEEP AND NOT THREE TESTS. Each of the three HAS a behavioural test that navigates
// A → B and reads the screen, and those tests are the real instruments — they pin what the words
// do, which no text rule can. What they cannot do is speak for a FOURTH screen that does not
// exist yet. The class is closed today at exactly three; the next `useParams` component is one
// file away, and its author has no reason to read any of the three.
//
// ── THE RULE, AND WHAT IT IS NOT ─────────────────────────────────────────────────────────────
//
// A component that calls `useParams()` and holds `useState` must, for EACH param it destructures,
// compare a state variable against that param (or against a local const derived from it — which
// is how PageView does it, since its draft belongs to the PAIR `${spaceId}/${pageId}`).
//
// ⚠ IT IS A FLOOR, AND THE LIMIT IS NAMED RATHER THAN LEFT TO BE DISCOVERED. It asks whether the
// component KNOWS which param its state belongs to. It cannot ask whether the reset then clears
// the right variables — C2 and C3 in ~/talyvor-queue/w11-spacestate-controls-8b47.py delete one
// `setX` from inside a reset and this rule stays green on both, because the comparison is still
// there. Only the behavioural cases catch those. A guard that claimed otherwise would be worse
// than none.
//
// ⚠ AND `enabled: spaceId !== ''` IS NOT A RESET, WHICH IS THE WHOLE REASON THE COMPARISON MUST
// NAME A STATE VARIABLE. All three files carry param-vs-literal comparisons in their query
// options; a rule that accepted any `!==` touching the param would have passed SpaceView while it
// was creating pages in the wrong space.

const SRC = join(__dirname)
const UI_SRC = join(__dirname, '../../../packages/ui/src')
const ROOTS = [SRC, UI_SRC]

const rel = (p: string) => relative(join(__dirname, '../../..'), p)

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name !== 'node_modules') out.push(...walk(p))
    } else if (p.endsWith('.tsx') && !p.endsWith('.test.tsx')) out.push(p)
  }
  return out
}

/** Every production surface both packages ship. No directory exclusions: see the note above. */
function surfaces(): string[] {
  return ROOTS.flatMap(walk)
}

const PARAMS_CALL = /useParams\s*[(<]/
const DESTRUCTURE = /const\s*\{([^}]*)\}\s*=\s*useParams/
const STATE_DECL = /const\s*\[\s*([A-Za-z0-9_$]+)\s*,\s*set[A-Za-z0-9_$]*\s*\]\s*=\s*useState/g
const DERIVED = /const\s+([A-Za-z0-9_$]+)\s*=\s*([^\n]*)/g

/** `{ spaceId = '', pageId }` → ['spaceId', 'pageId'] */
function paramNames(text: string): string[] {
  const m = DESTRUCTURE.exec(text)
  if (!m) return []
  return m[1]
    .split(',')
    .map((s) => s.split(/[=:]/)[0].trim())
    .filter((s) => /^[A-Za-z0-9_$]+$/.test(s))
}

/**
 * Params a component holds state ON BEHALF OF but has not tied that state to.
 *
 * Exported so the armed fixtures below run the SAME function the sweep does — a self-check that
 * asserts a clean fixture rather than the real rule is the shape this repo has been bitten by.
 */
export function unguardedParams(source: string): string[] {
  const text = stripComments(source)
  if (!PARAMS_CALL.test(text)) return []
  const states = [...text.matchAll(STATE_DECL)].map((m) => m[1])
  if (states.length === 0) return []
  const params = paramNames(text)

  return params.filter((p) => {
    // One hop of derivation: `const pageIdentity = `${spaceId}/${pageId}`` stands for both.
    const identities = new Set([p])
    for (const [, name, init] of text.matchAll(DERIVED)) {
      if (new RegExp(`\\b${p}\\b`).test(init) && !init.includes('useState')) identities.add(name)
    }
    return !states.some((s) =>
      [...identities].some(
        (e) =>
          new RegExp(`\\b${s}\\b\\s*!==?\\s*${e}\\b`).test(text) ||
          new RegExp(`\\b${e}\\b\\s*!==?\\s*${s}\\b`).test(text),
      ),
    )
  })
}

describe('state that belongs to a route param is reset when the param changes', () => {
  const subjects = surfaces()
    .map((p) => ({ path: p, src: readFileSync(p, 'utf8') }))
    .filter(({ src }) => PARAMS_CALL.test(stripComments(src)))

  // ⚠ THE ANCHOR THAT STOPS THIS PASSING BY FINDING NOTHING. A sweep whose subject list is empty
  // reports no offenders and reads exactly like a clean product — the failure mode three separate
  // sessions in this queue shipped. Every param-reading screen in this app is a route element
  // holding state, so zero subjects means the walk, the extension filter or the stripper broke,
  // not that the product got simpler.
  it('finds the param-reading screens at all', () => {
    expect(
      subjects.map((s) => rel(s.path)).sort(),
      'no component in either package reads useParams. That is not what a clean product looks ' +
        'like here — it is a walk that stopped, a filter that changed, or a stripper that ate ' +
        'the call.',
    ).not.toEqual([])
  })

  it('every param-reading screen ties its state to the param it belongs to', () => {
    const offenders = subjects
      .map(({ path, src }) => ({ path: rel(path), params: unguardedParams(src) }))
      .filter((o) => o.params.length > 0)

    expect(
      offenders,
      'this component reads a route param and holds useState, and nothing in it compares that ' +
        'state to the param. React Router does NOT remount an element when only the param ' +
        'changes, so the previous subject’s state survives underneath the new one — three ' +
        'screens in this app shipped that bug (#190, #192, #193). Tie the state to the param:\n' +
        "  const [stateOf, setStateOf] = useState(id)\n" +
        '  if (stateOf !== id) { setStateOf(id); /* clear what belongs to it */ }\n' +
        'and add a case that navigates A → B and reads the screen — this rule is a floor and ' +
        'cannot check that the reset clears the right variables.',
    ).toEqual([])
  })

  // ⚠ THE ARMED PROBE. The rule above is green today because the product is clean; that is
  // indistinguishable from a rule that cannot fire. These run the SAME exported function over
  // sources written to be wrong, and over sources written to be right, so both directions of the
  // detector are pinned by the file that depends on it.
  describe('the detector fires, and does not fire on the guarded shape', () => {
    const UNGUARDED = `
      export function Screen() {
        const { id = '' } = useParams()
        const [draft, setDraft] = useState('')
        return <textarea value={draft} onChange={(e) => setDraft(e.target.value)} />
      }`

    it('flags a component whose state is not tied to its param', () => {
      expect(unguardedParams(UNGUARDED)).toEqual(['id'])
    })

    it('a param-vs-literal comparison is NOT accepted as a reset', () => {
      const NEARLY = UNGUARDED.replace(
        "const [draft, setDraft] = useState('')",
        "const [draft, setDraft] = useState('')\n        const q = useQuery({ enabled: id !== '' })",
      )
      expect(unguardedParams(NEARLY)).toEqual(['id'])
    })

    it('accepts the reset the three fixed screens use', () => {
      const GUARDED = UNGUARDED.replace(
        "const [draft, setDraft] = useState('')",
        "const [draft, setDraft] = useState('')\n" +
          '        const [stateOf, setStateOf] = useState(id)\n' +
          "        if (stateOf !== id) { setStateOf(id); setDraft('') }",
      )
      expect(unguardedParams(GUARDED)).toEqual([])
    })

    it('accepts a reset keyed to a const derived from the params, as PageView’s is', () => {
      const DERIVED_SHAPE = `
        export function Screen() {
          const { spaceId = '', pageId = '' } = useParams()
          const [draft, setDraft] = useState(null)
          const pageIdentity = \`\${spaceId}/\${pageId}\`
          const [draftOf, setDraftOf] = useState(pageIdentity)
          if (draftOf !== pageIdentity) { setDraftOf(pageIdentity); setDraft(null) }
        }`
      expect(unguardedParams(DERIVED_SHAPE)).toEqual([])
    })

    it('a component that reads a param and holds no state is not a subject', () => {
      expect(
        unguardedParams(`export function Crumb() { const { id } = useParams(); return <b>{id}</b> }`),
      ).toEqual([])
    })

    // The stripper matters: every one of the three screens explains this exact defect in a
    // comment that QUOTES the reset it added. A rule reading raw text would grade a broken
    // component on the strength of the note describing the bug.
    it('a reset that exists only inside a comment does not count', () => {
      const COMMENTED = UNGUARDED.replace(
        "const [draft, setDraft] = useState('')",
        "const [draft, setDraft] = useState('')\n        // if (stateOf !== id) { setDraft('') }",
      )
      expect(unguardedParams(COMMENTED)).toEqual(['id'])
    })
  })
})

/**
 * ⚠ THE WALK ITSELF, ASSERTED AGAINST AN INSTRUMENT THAT CANNOT SHARE ITS MISTAKES — the repair
 * `#183` established and five files in this repo now carry. `import.meta.glob` is resolved by
 * Vite at TRANSFORM time and touches `node:fs` not at all, so a wrong root, a changed extension
 * filter or a walk that quietly stops descending cannot move both enumerations together. A floor
 * cannot do this job: `found.length >= 20` is satisfied by whatever survives any of those.
 *
 * ⚠ THE CALL IS LITERAL ON PURPOSE — Vite rewrites `import.meta.glob` by matching the SYNTAX at
 * transform time, so hoisting the patterns into a variable typechecks and then dies at runtime.
 *
 * ⚠ AND `import.meta.glob` NEVER RETURNS THE MODULE THAT CONTAINS THE CALL. This file is a `.ts`
 * and the patterns are `.tsx`, so it cannot be in either set and no subtraction is needed here —
 * unlike formatterReach and caseAudit, whose walks keep test files.
 */
describe('the sweep reads every surface the product ships', () => {
  const globbed = Object.keys(import.meta.glob(['./**/*.tsx', '../../../packages/ui/src/**/*.tsx']))
    .filter((k) => !k.endsWith('.test.tsx'))
    .map((k) => rel(join(SRC, k)))

  it('finds a substantial tree across both roots, so an empty anchor cannot pass', () => {
    expect(globbed.length).toBeGreaterThan(30)
  })

  it('the fs walk and Vite’s glob agree on the surface set, both directions', () => {
    const swept = new Set(surfaces().map(rel))
    const glob = new Set(globbed)
    expect(
      [...glob].filter((f) => !swept.has(f)).sort(),
      'Vite sees surfaces this walk never opens. A screen missing here has never been asked ' +
        'whether its state belongs to a param it does not watch.',
    ).toEqual([])
    expect(
      [...swept].filter((f) => !glob.has(f)).sort(),
      'the walk opened files Vite does not see. Either it left the two roots, or the two ' +
        'disagree about what a surface is.',
    ).toEqual([])
  })
})
