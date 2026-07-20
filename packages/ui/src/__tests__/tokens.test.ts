import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tokens } from '../tokens'

const css = readFileSync(resolve(import.meta.dirname, '../theme.css'), 'utf8')
const strip = (s: string) => s.replace(/\s+/g, '')

function blockText(marker: string): string {
  const start = css.indexOf(marker)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

// Parse `--name: value;` declarations from a theme block (the base :root block, which
// holds only --sans/--mono, is not one of these — so this sees exactly the colour vars).
function vars(block: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = strip(m[2])
  return out
}

// The tokens are the source of truth; theme.css mirrors them. This guards drift in BOTH
// directions: every token must appear in the block with its exact value, AND the block
// must carry no var without a token — so removing a token (e.g. dropping tier2/tier4)
// without also removing it from theme.css fails here. That is the test doing its job.
describe('tokens ↔ theme.css do not drift', () => {
  const blocks = {
    light: vars(blockText("[data-theme='light']")),
    dark: vars(blockText("[data-theme='dark']")),
  }
  for (const theme of ['light', 'dark'] as const) {
    const tk = tokens[theme]
    const cssVars = blocks[theme]

    for (const [name, value] of Object.entries(tk)) {
      it(`${theme}: --${name} = ${value}`, () => {
        expect(cssVars[name], `--${name} missing/changed in the ${theme} block`).toBe(strip(value))
      })
    }

    it(`${theme}: theme.css carries no var beyond the tokens`, () => {
      const extra = Object.keys(cssVars).filter((name) => !(name in tk))
      expect(extra, `stale vars in ${theme} block: ${extra.join(', ')}`).toEqual([])
    })
  }
})
