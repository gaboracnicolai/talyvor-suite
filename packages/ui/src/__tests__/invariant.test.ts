import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stripComments } from '../lib/sourceText'

// THE INVARIANT, enforced statically: the mined/pegged/status hues (lens, lxc, the
// tiers, settled/held/slashed) NEVER colour text — they appear only as bg/dot/
// tick/bar affordances. If anything ever writes `text-lens` (etc.), this fails.
// (accent lives on icons + accent-ink on the primary button; those are affordance
// ink, not hued words — see README §The invariant.)
//
// ⚠ ITS SCOPE WAS packages/ui/src/components ALONE, AND THAT WAS THE HOLE.
// The rule is stated as a property of the whole product, and it was checked on one
// directory. Four screens outside it had reached for a hue on text — `text-danger` in
// Documents, Sharing and IssueDetail, `text-warn` in the legal notice, `text-negative`
// in Setup — and the ONLY reason none of them broke the invariant visibly is that all
// five names were dead classes that generated no CSS. The guard was not holding the
// line; a typo was. Both are fixed, in the same change that widened this.
//
// Widening cost nothing at the time it was widened — there were zero live violations
// outside the components directory once the dead names were corrected. A guard whose
// scope is smaller than its claim is a guard that will be right until it matters.
const roots = [
  resolve(import.meta.dirname, '../components'),
  resolve(import.meta.dirname, '..'),
  resolve(import.meta.dirname, '../../../../apps/web/src'),
]
const forbidden = /\btext-(lens|lxc|tier[1-4]|settled|held|slashed)\b/

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(p))
    // Non-test source only: a test may legitimately NAME a forbidden class in an
    // assertion that it is absent, and a test renders nothing anyone sees.
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(p)
  }
  return out
}

const files = [...new Set(roots.flatMap(sourceFiles))].sort()

describe('text is never a hue', () => {
  it('the sweep reaches both packages — it must not pass by looking at nothing', () => {
    expect(files.length).toBeGreaterThan(40)
    expect(files.some((f) => f.includes('/packages/ui/src/components/'))).toBe(true)
    expect(files.some((f) => f.includes('/apps/web/src/areas/'))).toBe(true)
  })

  it('the detector fires on the thing it forbids, and not on prose about it', () => {
    // Positive control, both directions — the same trap decision-expiry.sh §D7 records.
    expect(forbidden.test(stripComments('<span className="text-slashed" />'))).toBe(true)
    expect(forbidden.test(stripComments('// never write text-slashed here'))).toBe(false)
    // and it must not fire on the SANCTIONED affordance forms
    expect(forbidden.test(stripComments('<i className="border-l-slashed bg-held" />'))).toBe(false)
  })

  for (const f of files) {
    const label = f.slice(f.indexOf('/packages/') >= 0 ? f.indexOf('/packages/') + 1 : f.indexOf('/apps/') + 1)
    it(`${label} puts no economy/status hue on a text node`, () => {
      const m = stripComments(readFileSync(f, 'utf8')).match(forbidden)
      expect(m, m ? `found ${m[0]} in ${label}` : '').toBeNull()
    })
  }
})
