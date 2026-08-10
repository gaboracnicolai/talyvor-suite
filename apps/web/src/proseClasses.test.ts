import postcss from 'postcss'
import tailwind from 'tailwindcss'
import { describe, expect, it } from 'vitest'
import tailwindConfig, { absoluteContent, buildContent, contentTransform } from '../tailwind.config'
import { resolve } from 'node:path'

/**
 * A CLASS THAT EXISTS BECAUSE A SENTENCE MENTIONS IT.
 *
 * Tailwind's extractor reads RAW TEXT. It cannot tell a class from a paragraph about a class,
 * so the comment explaining why a utility is banned COMPILES THAT UTILITY INTO PRODUCTION CSS.
 * `5d65b3e` took test files out of the content set and `dc0bd07` stopped the instruments from
 * silently putting them back; neither touched comments in ordinary source, and tailwind.config.ts
 * said so in writing rather than fixing it. This is that fix and this is its guard.
 *
 * ⚠ MEASURED ON THIS TREE before the fix, by generating base+components+utilities twice over the
 * SAME file set — once raw, once with comments stripped before extraction — and diffing the
 * emitted class names:
 *
 *     shipped class names, raw:        363     28,452 bytes
 *     with comments stripped:          343     26,226 bytes
 *     supplied ONLY by prose:           20      2,226 bytes
 *
 * The twenty: `p-[13px]`, `text-[#2026]`, `leading-[1.04]`, `tracking-[-0.03em]`,
 * `active:scale-[0.98]`, `scale-95`, `tabular-nums`, `tracking-wide`, `transition`, `inline`,
 * `fixed`, `grow`, `invisible`, `outline`, `shadow`, `collapse`, `container`, `bg-accent-hover`,
 * and the junk fragments `025em;` and `95;`. `p-[13px]` is preset.ts's own opening sentence —
 * "arbitrary values (text-[#…], p-[13px]) are forbidden by local/no-arbitrary-value" — shipping
 * the exact arbitrary value the lint rule exists to forbid, supplied by the rule's own
 * documentation.
 *
 * ⚠ AND MEASURED ON THE ARTEFACT, not only on the generator — `vite build` run both ways:
 *     dist/assets/index-*.css   24,098 -> 22,420 bytes   (gzipped 5,760 -> 5,449)
 *
 * ⚠ THIS IS A CORRECTNESS ARGUMENT, NOT A PERFORMANCE ONE. 311 bytes off a gzipped stylesheet
 * is not a saving anyone can measure. What matters is that the stylesheet should describe the
 * PRODUCT, and a rule nothing renders is a rule review cannot distinguish from one something
 * renders — `.bg-accent-hover` reads in the sheet exactly like a live token, and no element in
 * this repo asks for it.
 *
 * ⚠ WHAT MOVED FOR deadClasses.test.ts, which reasons from this same emitted set (utilities
 * only, its own scope): emitted 346 -> 325, and the tokens it harvests 282 -> 281. The one it
 * lost is `04` — a junk fragment that was emitted from a comment, which made rule B (a literal
 * is a class list if any of its tokens is a real class) read one more literal as classes. Its
 * dead list is unchanged: `tal-range`, `tal-rise`, `tal-stagger`, all hand-written CSS and all
 * filtered. No class the source writes stopped being emitted.
 *
 * ⚠ WHAT THIS DOES NOT CLOSE, MEASURED RATHER THAN ASSUMED. `index.html` is in the content set
 * and HTML comments are NOT stripped: `stripComments` is a JavaScript scanner (it protects
 * string and template literals so `https://…` is not read as a comment opener) and pointing it
 * at HTML would be a second stripper with a different syntax. Measured on this tree, adding an
 * HTML-comment transformer changes the emitted set by NOTHING — 343 names, 26,226 bytes, byte
 * identical — because the one comment index.html carries ("No-flash theme: set data-theme before
 * first paint…") holds no token Tailwind recognises. So the hole is real, currently empty, and
 * unguarded; `html` is listed in EXEMPT below with that reason, and the coverage test will name
 * it again the day a second HTML file joins the content set.
 */

const appRoot = resolve(import.meta.dirname, '..')

/** Class names in a sheet generated over `content`, unescaped. Same reader as deadClasses. */
async function emitted(content: unknown): Promise<Set<string>> {
  const css = await postcss([tailwind({ ...tailwindConfig, content: content as never })]).process(
    '@tailwind base;\n@tailwind components;\n@tailwind utilities;',
    { from: undefined },
  )
  const names = new Set<string>()
  // The escape alternative first — see deadClasses.test.ts. `.w-1\.5` reads as `w-1` otherwise.
  for (const m of css.css.matchAll(/\.((?:\\.|[^\s{,:.>+~()])+)/g)) names.add(m[1].replace(/\\(.)/g, '$1'))
  return names
}

/** The sheet the browser downloads, and the same sheet with the transform step skipped. */
const shipped = emitted(buildContent(appRoot))
const untransformed = emitted({ files: absoluteContent(appRoot) })

/**
 * CLASSES THIS REPO SHIPS ONLY BECAUSE PROSE NAMES THEM — pinned, with their premise checked.
 *
 * Each entry is asserted TWICE: it must still be produced when the transform is skipped (the
 * comment that supplies it still exists — delete the comment and this test says so by name
 * rather than passing quietly), and it must be ABSENT from the sheet the build produces.
 *
 * The split is deliberate and it is what makes a missing transformer visible. `p-[13px]`,
 * `leading-[1.04]`, `tracking-[-0.03em]` and `tabular-nums` come from packages/ui/src/preset.ts,
 * a `.ts` file. `inline` and `transition` come only from `.tsx` comments — measured: register a
 * transformer for `ts` alone and exactly six classes come back, `inline` and `transition` among
 * them. A one-key transform map is therefore red here, and green everywhere else in the repo.
 */
const PROSE_ONLY: Record<string, string> = {
  'p-[13px]': "preset.ts's sentence naming the arbitrary values local/no-arbitrary-value forbids",
  'leading-[1.04]': "preset.ts's display-scale comment quoting the site's markup",
  'tracking-[-0.03em]': "preset.ts's display-scale comment quoting the site's markup",
  'tabular-nums': "preset.ts's comment explaining that the numerals STOPPED using it",
  inline: 'a .tsx comment — the bare word, where the code only ever writes inline-flex/-block',
  transition: 'a .tsx comment — the bare word, where the code only ever writes transition-colors',
}

/**
 * Extensions in the content set with no transformer, and why that is acceptable.
 * Asserted to be non-stale: an exemption for an extension no glob mentions is deleted, not kept.
 */
const EXEMPT: Record<string, string> = {
  html: 'HTML comments need their own stripper; measured to supply zero classes today — see header',
}

describe('the instrument', () => {
  it('reads a real sheet — it must not pass by generating nothing', async () => {
    const names = await shipped
    expect(names.size).toBeGreaterThan(300)
    expect(names.has('bg-canvas'), 'a token every page uses is missing — the sheet is not real').toBe(true)
    expect(names.has('text-body')).toBe(true)
  })

  it('the transform is doing work — an inert map would pass every check below', async () => {
    const [a, b] = [await shipped, await untransformed]
    expect(b.size, 'stripping comments removed nothing: the transform is not registered or not running')
      .toBeGreaterThan(a.size)
  })

  it('the BUILD carries the transform, not just the tests', () => {
    const content = tailwindConfig.content
    expect(Array.isArray(content), 'the config went back to a bare glob list — the build strips nothing').toBe(false)
    const obj = content as { files: string[]; transform?: unknown }
    // identity, not shape: a second transform map is a second thing to keep right
    expect(obj.transform, "the build's transform is not the one buildContent hands the tests").toBe(contentTransform)
    expect(obj.files.filter((g) => g.startsWith('!')).length, 'the test-file exclusions are gone').toBe(2)
  })
})

describe('a class in a comment is not a class', () => {
  /**
   * Both directions, through the config the BUILD uses, over fixtures rather than the repo —
   * so the answer comes from the fixture and nothing else. A stripper that emits nothing would
   * satisfy "the comment class is gone"; the code class is what stops that passing.
   */
  const fixture = (raw: string, extension: string) => emitted({ files: [{ raw, extension }], transform: contentTransform })

  it('.ts — the code class survives and the comment class does not', async () => {
    const names = await fixture("const cls = 'z-40'\n// prose mentions tabular-nums here\n", 'ts')
    expect(names.has('z-40'), 'the stripper ate CODE').toBe(true)
    expect(names.has('tabular-nums'), 'a class named in a // comment reached the stylesheet').toBe(false)
  })

  it('.ts — a block comment is a comment too', async () => {
    const names = await fixture("const cls = 'z-40'\n/* prose mentions tracking-wide */\n", 'ts')
    expect(names.has('z-40')).toBe(true)
    expect(names.has('tracking-wide'), 'a class named in a /* */ comment reached the stylesheet').toBe(false)
  })

  it('.tsx — a JSX comment is a comment too', async () => {
    const names = await fixture('<div className="z-30">{/* prose mentions uppercase */}</div>\n', 'tsx')
    expect(names.has('z-30')).toBe(true)
    expect(names.has('uppercase'), 'a class named in a {/* */} comment reached the stylesheet').toBe(false)
  })

  it('a URL inside a string is not a comment opener', async () => {
    // The trap every naive stripper falls into: `//` in "https://…" swallowing the rest of the
    // line. `stripComments` tracks string and template literals; this is that property, asserted
    // where it would cost a real class rather than only in typeface.test.tsx's unit fixtures.
    const names = await fixture("const u = 'https://talyvor.example/'\nconst cls = 'z-20'\n", 'ts')
    expect(names.has('z-20'), 'a class after a URL string was eaten — the stripper lost the string rule').toBe(true)
  })
})

describe('the shipped stylesheet', () => {
  it('carries no class that only prose asks for', async () => {
    const [a, b] = [await shipped, await untransformed]
    const stillProse: string[] = []
    const fixtureGone: string[] = []
    for (const [cls, why] of Object.entries(PROSE_ONLY)) {
      if (!b.has(cls)) fixtureGone.push(`${cls} (${why})`)
      else if (a.has(cls)) stillProse.push(`${cls} (${why})`)
    }
    expect(
      fixtureGone,
      `PROSE_ONLY names a class the content set no longer produces at all. The comment that\n` +
        `supplied it was edited or deleted — re-measure and update the list rather than trusting\n` +
        `a pass here:\n  ${fixtureGone.join('\n  ')}`,
    ).toEqual([])
    expect(
      stillProse,
      `class(es) in the stylesheet the browser downloads that NO element asks for — a comment\n` +
        `is the only thing that mentions them:\n  ${stillProse.join('\n  ')}`,
    ).toEqual([])
  })

  it('every extension in the content set has a transformer, or a reason', () => {
    // Read BOTH shapes. A bare glob list is a different defect with its own test above, and if
    // this one crashed on `.files` being undefined it would report a missing transformer for a
    // config whose extensions are all covered — a true verdict for a false reason.
    const content = tailwindConfig.content as string[] | { files: string[] }
    const globs = (Array.isArray(content) ? content : content.files).filter((g) => !g.startsWith('!'))
    const extensionsOf = (glob: string): string[] => {
      const brace = glob.match(/\.\{([^}]+)\}$/)
      if (brace) return brace[1].split(',').map((s) => s.trim())
      const dot = glob.lastIndexOf('.')
      return dot >= 0 ? [glob.slice(dot + 1)] : []
    }
    const found = new Set(globs.flatMap(extensionsOf))
    expect(found.size, 'no extension was parsed out of the globs — the parser, not the config, is wrong')
      .toBeGreaterThan(0)
    const uncovered = [...found].filter((e) => !(e in contentTransform) && !(e in EXEMPT)).sort()
    expect(
      uncovered,
      `a content glob brings in file types nothing strips comments from, so a comment in one of\n` +
        `them ships its classes: ${uncovered.join(', ')}. Add a transformer or an EXEMPT reason.`,
    ).toEqual([])
    // and no stale exemption: an EXEMPT entry for an extension no glob mentions is a claim
    // about a content set that no longer exists.
    const stale = Object.keys(EXEMPT).filter((e) => !found.has(e))
    expect(stale, `EXEMPT names extensions the content set does not contain: ${stale.join(', ')}`).toEqual([])
    for (const [, why] of Object.entries(EXEMPT)) expect(why.length).toBeGreaterThan(20)
    for (const [, why] of Object.entries(PROSE_ONLY)) expect(why.length).toBeGreaterThan(20)
  })
})
