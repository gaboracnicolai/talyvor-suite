import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// THE INVARIANT, enforced statically: the mined/pegged/status hues (lens, lxc, the
// four tiers, settled/held/slashed) NEVER colour text — they appear only as bg/dot/
// tick/bar affordances. If a component ever writes `text-lens` (etc.), this fails.
// (accent lives on icons + accent-ink on the primary button; those are affordance
// ink, not hued words — see README §The invariant.)
const dir = resolve(import.meta.dirname, '../components')
const files = readdirSync(dir).filter((f) => f.endsWith('.tsx'))
const forbidden = /\btext-(lens|lxc|tier[1-4]|settled|held|slashed)\b/

describe('text is never a hue', () => {
  for (const f of files) {
    it(`${f} puts no economy/status hue on a text node`, () => {
      const src = readFileSync(resolve(dir, f), 'utf8')
      const m = src.match(forbidden)
      expect(m, m ? `found ${m[0]} in ${f}` : '').toBeNull()
    })
  }
})
