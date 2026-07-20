import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tokens } from '../tokens'

const css = readFileSync(resolve(import.meta.dirname, '../theme.css'), 'utf8')
const strip = (s: string) => s.replace(/\s+/g, '')

function block(name: string): string {
  const start = css.indexOf(name)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  return strip(css.slice(open + 1, close))
}

// The tokens are the source of truth; theme.css mirrors them. This asserts every
// token value from tokens.ts is present, verbatim, in the correct :root block — so
// the two can never silently drift.
describe('tokens ↔ theme.css do not drift', () => {
  const lightBlock = block("[data-theme='light']")
  const darkBlock = block("[data-theme='dark']")

  for (const [name, value] of Object.entries(tokens.light)) {
    it(`light --${name} = ${value}`, () => {
      expect(lightBlock).toContain(strip(`--${name}:${value}`))
    })
  }
  for (const [name, value] of Object.entries(tokens.dark)) {
    it(`dark --${name} = ${value}`, () => {
      expect(darkBlock).toContain(strip(`--${name}:${value}`))
    })
  }
})
