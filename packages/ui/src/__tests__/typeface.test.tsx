import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MuNumeral } from '../components/MuNumeral'
import preset from '../preset'

/**
 * THE TYPEFACE, AND THE NUMERAL FACE.
 *
 * The public site is set in Space Grotesk with IBM Plex Mono, and its `.font-instrument`
 * utility — the one it puts on every eyebrow label AND every quoted figure — is literally
 * `font-family: var(--font-mono); font-feature-settings: "tnum" 1`. Porting the language
 * without porting the faces would leave the most visible half of it undone.
 *
 * ⚠ A WEBFONT IS THE `text/html` 200 OF TYPOGRAPHY. An @font-face whose file 404s does
 * not error, does not warn, and does not look broken — the browser silently falls back to
 * the system stack and the page renders in the wrong typeface forever. So this asserts the
 * FILES, not the declaration: every url() in theme.css must resolve to something on disk
 * whose first four bytes are `wOF2`.
 */

const uiSrc = resolve(import.meta.dirname, '..')
const themeCssPath = resolve(uiSrc, 'theme.css')
const css = readFileSync(themeCssPath, 'utf8')

describe('the faces are declared', () => {
  it('--sans leads with Space Grotesk', () => {
    const m = /--sans:\s*([^;]+);/.exec(css)
    expect(m?.[1].trim().startsWith('"Space Grotesk"'), `--sans is ${m?.[1]}`).toBe(true)
  })
  it('--mono leads with IBM Plex Mono', () => {
    const m = /--mono:\s*([^;]+);/.exec(css)
    expect(m?.[1].trim().startsWith('"IBM Plex Mono"'), `--mono is ${m?.[1]}`).toBe(true)
  })
  it('both keep a system fallback — a font that fails to load must not take the text with it', () => {
    expect(/--sans:[^;]*system-ui[^;]*;/.test(css)).toBe(true)
    expect(/--mono:[^;]*ui-monospace[^;]*;/.test(css)).toBe(true)
  })
  it('every face is served locally — no third-party font host on an authenticated console', () => {
    expect(/fonts\.googleapis\.com|fonts\.gstatic\.com|https?:\/\//.test(css), 'theme.css reaches off-origin').toBe(
      false,
    )
  })
})

describe('the font files exist and are fonts', () => {
  const urls = [...css.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)].map((m) => m[1])

  it('theme.css declares @font-face for both families', () => {
    expect((css.match(/@font-face/g) ?? []).length).toBeGreaterThanOrEqual(2)
    expect(css).toContain("font-family: 'Space Grotesk'")
    expect(css).toContain("font-family: 'IBM Plex Mono'")
  })

  it('there is at least one url() to check — the check must not pass by finding nothing', () => {
    expect(urls.length).toBeGreaterThan(0)
  })

  for (const url of urls) {
    it(`${url} resolves to a real woff2`, () => {
      const file = resolve(dirname(themeCssPath), url)
      expect(existsSync(file), `${url} → ${file} does not exist; the browser would silently fall back`).toBe(true)
      const head = readFileSync(file).subarray(0, 4).toString('latin1')
      expect(head, `${url} is not a woff2 (magic bytes were "${head}")`).toBe('wOF2')
    })
  }

  it('no font file ships without its licence beside it', () => {
    const fontsDir = resolve(uiSrc, 'fonts')
    const files = readdirSync(fontsDir)
    expect(files.some((f) => /^LICENCE|^LICENSE/i.test(f) && /grotesk/i.test(f))).toBe(true)
    expect(files.some((f) => /^LICENCE|^LICENSE/i.test(f) && /plex/i.test(f))).toBe(true)
  })
})

describe('numerals are set in the figure face', () => {
  const families = preset.theme!.extend!.fontFamily as Record<string, unknown[]>

  it('the preset names a figure face, and it is the mono var carrying tabular figures', () => {
    expect(families.figure, 'no `figure` fontFamily in the preset').toBeTruthy()
    expect(families.figure[0]).toBe('var(--mono)')
    expect(JSON.stringify(families.figure[1])).toContain('tnum')
  })

  it('MuNumeral renders in the figure face', () => {
    const { container } = render(<MuNumeral micros={12_340_567} unit="lens" />)
    expect(container.firstElementChild!.className).toContain('font-figure')
  })

  /**
   * `tabular-nums` was how numerals got their column alignment while they were set in the
   * SANS face. Both mono faces are fixed-advance by construction and `font-figure` carries
   * `tnum` besides, so a surviving `tabular-nums` means a call site is still reasoning in
   * the old face — which is exactly how half a system ends up ported.
   *
   * ⚠ SCOPE IS THE WHOLE REPO ON PURPOSE. Narrowing it to packages/ui would have scored
   * green while eight app call sites kept the old face.
   *
   * ⚠ AND IT MATCHED ITS OWN PROSE ON THE FIRST RUN. The naive version searched raw file
   * text, so the paragraph in preset.ts explaining why the class is gone, and the comment
   * in design-fixes.test.tsx recording the reversal, both counted as violations. A detector
   * that fires on the documentation of the thing it forbids has to be narrowed — and the
   * narrowing is where these go quietly blind, so `codeOnly` is positive-controlled below
   * in both directions before it is trusted with a single file.
   */
  const codeOnly = stripComments

  it('the detector reads code and not prose — both directions', () => {
    expect(codeOnly('const a = "tabular-nums"')).toContain('tabular-nums')
    expect(codeOnly('// we removed tabular-nums')).not.toContain('tabular-nums')
    expect(codeOnly('/* tabular-nums, historically */')).not.toContain('tabular-nums')
    expect(codeOnly('/** \n * tabular-nums \n */\nconst x = 1')).not.toContain('tabular-nums')
    // a string that merely LOOKS like a comment opener must survive
    expect(codeOnly('const u = "https://x.test/a"')).toContain('https://x.test/a')
    expect(codeOnly('const t = `a tabular-nums b` // tabular-nums')).toContain('a tabular-nums b')
    expect(codeOnly("const s = 'tabular-nums' /* gone */")).toContain('tabular-nums')
  })

  it('no `tabular-nums` survives in code anywhere — the face carries the figures now', () => {
    const roots = [uiSrc, resolve(uiSrc, '../../../apps/web/src')]
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = resolve(dir, entry.name)
        if (entry.isDirectory()) walk(p)
        // NON-TEST SOURCE ONLY, for the same reason decision-expiry.sh's D7 landed there:
        // a test may legitimately NAME the forbidden class in an assertion that it is
        // absent (design-fixes.test.tsx does exactly that), and a test renders nothing a
        // user sees. Production source is where the class would actually ship.
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          if (/\btabular-nums\b/.test(codeOnly(readFileSync(p, 'utf8')))) {
            offenders.push(p.slice(p.indexOf('/src/') + 1))
          }
        }
      }
    }
    for (const r of roots) walk(r)
    expect(offenders, `still setting numerals in the old face: ${offenders.join(', ')}`).toEqual([])
  })

  it('and it would still SEE one — the sweep is not passing by finding nothing', () => {
    // The positive control for the sweep itself: the same predicate, over a file that
    // does carry the class in code. If this ever stops failing, the sweep above is
    // reporting "clean" for a reason that has nothing to do with the codebase.
    expect(/\btabular-nums\b/.test(codeOnly('<span className="tabular-nums" />'))).toBe(true)
  })
})

/**
 * Blank out `//` and block comments, respecting string and template literals so a URL
 * inside a string is not mistaken for a comment. Returns the same length-ish text with
 * comment bodies removed — enough to ask "does this class appear in CODE".
 */
function stripComments(src: string): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]
    const next = src[i + 1]
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (c === '/' && next === '*') {
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      out += c
      i++
      while (i < src.length) {
        if (src[i] === '\\') {
          out += src[i] + (src[i + 1] ?? '')
          i += 2
          continue
        }
        out += src[i]
        if (src[i] === quote) {
          i++
          break
        }
        i++
      }
      continue
    }
    out += c
    i++
  }
  return out
}
