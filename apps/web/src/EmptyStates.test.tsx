import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// EmptyStates.test.tsx — EVERY EMPTY STATE IS ENUMERATED FROM THE SOURCE AND MUST NAME A NEXT ACTION.
//
// THE DEFECT. A new signup sees empty states before it sees anything else, and this product's
// empty states describe an ABSENCE: "No members in this workspace yet." True on every new
// workspace, and it leaves the reader unable to tell working from broken from waiting-on-me.
// Two of them were fixed by hand (Overview's earnings and activity rows) and pinned in
// ClaimsAudit.test.tsx — as TWO NAMED STRINGS.
//
// ⚠ WHY THAT PINNING WAS NOT ENOUGH, AND WHY THIS FILE ENUMERATES INSTEAD. A curated list of
// strings guards the strings someone thought of. It said nothing about the seven other empty
// states shipping in the same app, and it would say nothing about the eighth. The same trap was
// closed twice already in this project by making the CODE the input rather than a list: the
// dead-class sweep asks Tailwind which classes are real, and the compose reach guard enumerates
// variables from config instead of from a curated array. This does that for copy — it finds the
// empty states itself and refuses to pass on one nobody classified.
//
// ⚠ WHAT AN EMPTY STATE OWES THE READER, which is the rule applied below: it must say what would
// PUT something here, and where that is done. "Correct and unhelpful" is the failure mode; a
// sentence that only restates the emptiness is a sentence the user cannot act on.

const SRC = join(__dirname)

// Surfaces only. routes/ is legal copy (Terms has a section literally titled "No uptime
// promise") and lib/ has no JSX — including them would add noise, and noise is how a guard
// gets deleted.
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

// Comments are stripped FIRST, for the reason ClaimsAudit documents: the corrections below are
// explained in comments that necessarily quote the wording they replaced, so a naive match finds
// the old copy in the note about removing it. Only what can reach a user is matched.
function flat(src: string): string {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ') // {/* JSX comment */}
    .replace(/\/\*[\s\S]*?\*\//g, ' ') //             /* block comment */
    .replace(/^\s*\/\/.*$/gm, ' ') //                    // line comment
    .replace(/\s+/g, ' ')
}

// ⚠ THE DETECTOR, AND ITS ONE DISCRIMINATOR. An empty state is a JSX TEXT NODE that opens by
// naming an absence. The leading `>` is what makes this a text node rather than an attribute —
// without it this also matches `<Section title="No uptime promise">`, which is a heading, not an
// empty state. Both directions are controlled at the bottom of this file.
const EMPTY_STATE = /> ?(No(?:thing)? [^<>{}]*?\.)/g

// A next action is either somewhere to GO (an in-app link or a control) or something to DO,
// stated as an imperative. Prose alone does not qualify: "No members yet, and that is expected"
// explains the absence without telling anyone what changes it.
const GOES_SOMEWHERE = /to="\/|<Link\b|<button\b|onClick=/
const TELLS_YOU_WHAT_TO_DO =
  /\b(create|point|invite|add|ask|connect|choose|send|open|start|widen|pick|turn it on|turn on|appears? (?:here )?when|appears the moment|lands? in)\b/i

// ⚠ EXEMPTIONS, IN TWO KINDS, BECAUSE THEY ARE TWO DIFFERENT CLAIMS. Collapsing them into one
// "ignore this" list would hide which sentences the rule was applied to and lost, and which the
// detector simply mis-identified. Both are keyed by the sentence itself, so rewording retires the
// exemption and forces the decision to be made again rather than inheriting it.

// (a) The detector was WRONG — this is not an empty state at all. Every entry here is a known
// limit of a text-shape heuristic, recorded rather than tuned away: narrowing the pattern until
// these disappear is how a detector stops finding the real ones too.
const NOT_AN_EMPTY_STATE: Record<string, string> = {
  'Nothing produced here is served to anyone else.':
    'A bullet in Sharing’s “If sharing is off” list — it describes the consequence of a setting, not an absent collection. It opens with “Nothing”, which is the shape the detector keys on.',
}

// (b) It IS an empty state and it genuinely has no next action to name.
const NO_NEXT_ACTION: Record<string, string> = {
  'No description.':
    'A field placeholder on an issue, not an empty collection. The action that would fill it (edit the description) needs the editor W2.3 has not built; offering it here would be a control that does nothing.',
}

const EXEMPT: Record<string, string> = { ...NOT_AN_EMPTY_STATE, ...NO_NEXT_ACTION }

type Found = { file: string; text: string; actioned: boolean; why: string }

function findEmptyStates(): Found[] {
  const out: Found[] = []
  for (const dir of SCANNED) {
    for (const file of walk(join(SRC, dir))) {
      const src = flat(readFileSync(file, 'utf8'))
      for (const m of src.matchAll(EMPTY_STATE)) {
        const text = m[1].trim()
        // The window is the copy plus the markup immediately around it — a link sits inside the
        // same element, and an imperative sits inside the same sentence or the next one.
        const from = Math.max(0, m.index - 200)
        const window = src.slice(from, m.index + text.length + 400)
        const actioned =
          GOES_SOMEWHERE.test(window) || TELLS_YOU_WHAT_TO_DO.test(window)
        out.push({
          file: relative(SRC, file),
          text,
          actioned,
          why: EXEMPT[text] ?? '',
        })
      }
    }
  }
  return out
}

describe('empty states — a correct system that explains nothing reads as broken', () => {
  const found = findEmptyStates()

  // NON-VACUITY. A detector that finds nothing passes everything, which is the failure this
  // project has shipped three times. The count at the time of writing was 10 across 8 files;
  // a floor well under that catches a broken detector without breaking on every new screen.
  it('the detector actually finds the empty states', () => {
    expect(found.length).toBeGreaterThanOrEqual(8)
  })

  it('every empty state names a next action, or is exempt with a reason', () => {
    const unexplained = found.filter((f) => !f.actioned && !f.why)
    expect(
      unexplained.map((f) => `${f.file}: ${JSON.stringify(f.text)}`),
      'An empty state must say what would put something here, and where that is done. Add the ' +
        'next action to the copy, or add the sentence to EXEMPT with the reason it has none. ' +
        'Leaving it out is not neutral: this is the first screen a new signup reads.',
    ).toEqual([])
  })

  it('no exemption is stale', () => {
    const live = new Set(found.map((f) => f.text))
    for (const sentence of Object.keys(EXEMPT)) {
      expect(
        live.has(sentence),
        `EXEMPT names ${JSON.stringify(sentence)}, which no longer appears in any surface. ` +
          'A stale exemption guards nothing and reads as though it does.',
      ).toBe(true)
    }
  })

  it('every exemption carries a reason', () => {
    for (const [sentence, why] of Object.entries(EXEMPT)) {
      expect(why.trim().length, `EXEMPT[${sentence}] has no reason`).toBeGreaterThan(20)
    }
  })
})

// ⚠ POSITIVE CONTROLS. Same discipline as ClaimsAudit: a detector nobody tried to break is a
// detector nobody knows the shape of. These drive the real functions with synthetic sources.
describe('controls — the detector and the rule can both actually fail', () => {
  const scan = (src: string) => [...flat(src).matchAll(EMPTY_STATE)].map((m) => m[1].trim())

  it('finds a bare absence in a text node', () => {
    expect(scan('<div className="x">No widgets yet.</div>')).toEqual(['No widgets yet.'])
  })

  it('finds copy authored across several JSX lines', () => {
    expect(
      scan('<div>\n  No spaces in this workspace yet.\n</div>'),
    ).toEqual(['No spaces in this workspace yet.'])
  })

  it('does NOT fire on an attribute — the heading trap', () => {
    // routes/Terms.tsx really does have <Section title="No uptime promise">.
    expect(scan('<Section title="No uptime promise.">body</Section>')).toEqual([])
  })

  it('does NOT fire on a comment explaining copy that was removed', () => {
    expect(scan('{/* was: >No ledger entries yet. */}<div>fine</div>')).toEqual([])
  })

  it('an unactioned empty state is judged unactioned', () => {
    const src = '<div className="px-gutter">No members in this workspace yet.</div>'
    const m = [...flat(src).matchAll(EMPTY_STATE)][0]
    const w = flat(src).slice(0, m.index + 400)
    expect(GOES_SOMEWHERE.test(w) || TELLS_YOU_WHAT_TO_DO.test(w)).toBe(false)
  })

  it('an actioned empty state is judged actioned — by a link', () => {
    const src = '<div>No activity yet. <Link to="/setup">point a tool at it</Link></div>'
    expect(GOES_SOMEWHERE.test(flat(src))).toBe(true)
  })

  it('an actioned empty state is judged actioned — by an imperative', () => {
    const src = '<div>No keys yet. Create one above.</div>'
    expect(TELLS_YOU_WHAT_TO_DO.test(flat(src))).toBe(true)
  })

  it('explaining the absence without naming an action does NOT count as actioned', () => {
    const src = '<div>No members in this workspace yet, which is expected on a new workspace.</div>'
    expect(
      GOES_SOMEWHERE.test(flat(src)) || TELLS_YOU_WHAT_TO_DO.test(flat(src)),
    ).toBe(false)
  })
})
