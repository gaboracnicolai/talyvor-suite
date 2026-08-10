import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

/**
 * THE FIRST PAINT ON A BROWSER THAT REFUSES SITE DATA — AND THE PREFERENCE IT THREW AWAY.
 *
 * `index.html`'s no-flash script is the only thing that decides which theme the product paints
 * on a cold load. `lib/theme.ts`'s `initialTheme()` READS THE ATTRIBUTE THAT SCRIPT SET and
 * trusts it — its own comment says the value came "from stored choice or prefers-color-scheme",
 * and its own storage fall-through is therefore unreachable in apps/web. So the script's answer
 * IS the product's answer, and nothing in this repo had ever run it.
 *
 * ⚠ WHAT IT DID, MEASURED IN REAL CHROME ON `dist/index.html` — the built artifact, not a copy,
 * served over http and driven with `prefers-color-scheme` emulated. TWO INDEPENDENT INSTRUMENTS,
 * because the first one lost the stylesheet to CORS and could only report the attribute:
 *
 *   (1) The page in a `sandbox="allow-scripts"` iframe. That is an OPAQUE ORIGIN and Chrome
 *       itself throws from the `localStorage` GETTER there — no stub, no page edit:
 *         SecurityError: Failed to read the 'localStorage' property from 'Window'
 *         prefers-color-scheme: dark  →  data-theme="light"
 *       The control iframe, identical but for `allow-same-origin`, painted `data-theme="dark"`.
 *
 *   (2) The page top-level, with the same SecurityError installed on the `localStorage` getter
 *       before any page script runs, so the stylesheet loads and the PAINT is visible:
 *         storage works  · prefers dark   → data-theme=dark   body #060A12  rgb(6,10,18)
 *         storage refused · prefers dark  → data-theme=light  body #F3F6FA  rgb(243,246,250)
 *         storage refused · prefers light → data-theme=light  body #F3F6FA   (right, by accident)
 *
 * A reader whose OS says dark, on a browser that refuses site data, got the LIGHT canvas on a
 * product whose brief is "#060A12 near-black". Not for a frame — for the whole session, on every
 * load, because the choice they make with the toggle is the one thing that browser cannot keep.
 *
 * ⚠ THE CAUSE IS THE SHAPE, NOT THE VALUE: ONE `try` HELD BOTH READS. The stored choice and
 * `prefers-color-scheme` are two independent questions, and only the first one can be refused —
 * `matchMedia` answers fine on a browser with no storage at all. Wrapping them together meant a
 * refusal on the first discarded the second, and the catch arm fell back to a hard-coded
 * `'light'`. `#120` fixed the WRITE half of this same key in `lib/theme.ts` and left the note
 * that index.html "has always wrapped its read in try/catch" — it had; that was the defect.
 *
 * ⚠ CASE 6 IS NOT DECORATION. Splitting the catch is only correct if the SECOND read is guarded
 * too: `window.matchMedia` is absent on old and embedded engines, and an unguarded call there
 * throws out of the IIFE, sets NO attribute at all, and theme.css defines every token under
 * `[data-theme=…]` — so the page would render with no canvas, no ink and no accent. That failure
 * is strictly worse than the one being fixed, and main does not have it.
 */

/** The real bytes the build ships. `vite build` copies this file; dist carries it verbatim. */
const HTML = readFileSync(resolve(__dirname, '../index.html'), 'utf8')

/**
 * The inline classic script — the one with NO attributes. The module script carries
 * `type="module" src=…`, so this pattern cannot pick it up, and the count is asserted below
 * rather than assumed: a second bare `<script>` would make "the first match" a silent choice.
 */
const INLINE = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])

/**
 * ⚠ THE KEY IS HARD-CODED HERE ON PURPOSE. Reading it back out of index.html would compare the
 * file to itself and pass for every value. `lib/theme.ts` declares the same literal for the WRITE
 * side; a rename in either file alone reds the two stored-choice cases below, which is the only
 * thing holding those two copies together.
 */
const STORAGE_KEY = 'talyvor-theme'

const ORIGINAL_STORAGE = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
const ORIGINAL_MATCH_MEDIA = Object.getOwnPropertyDescriptor(window, 'matchMedia')

/**
 * ⚠ THE WHOLE GLOBAL IS REPLACED THROUGH ITS DESCRIPTOR, never `localStorage.getItem = fn`. Web
 * Storage has named properties, so on a real jsdom Storage that assignment can store an ITEM
 * called "getItem" instead of shadowing the method and the refusal silently would not happen.
 * That is `#120`'s finding, restated here rather than imported: this file needs it for its own
 * reasons and a shared helper would lend evidence it never gathered for these cases.
 */
function useStorage(impl: Storage | undefined): void {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: impl })
}

/**
 * A storage whose GETTER throws — which is what Chrome with site data blocked actually does,
 * measured above as `Failed to read the 'localStorage' property from 'Window'`. The refusal is on
 * the PROPERTY, not on a method, so it is modelled on the property.
 */
function refusingStorage(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get(): Storage {
      throw new DOMException("Failed to read the 'localStorage' property from 'Window'", 'SecurityError')
    },
  })
}

function storageHolding(entries: Record<string, string>): Storage {
  const m = new Map(Object.entries(entries))
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(String(k), String(v)),
    removeItem: (k: string) => void m.delete(String(k)),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size
    },
  } as Storage
}

/** `prefers-color-scheme: dark` answers `matches`, everything else does not. */
function useMatchMedia(prefersDark: boolean | 'absent'): void {
  if (prefersDark === 'absent') {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: undefined })
    return
  }
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q: string) => ({ matches: prefersDark && /prefers-color-scheme:\s*dark/.test(q), media: q }),
  })
}

/**
 * Run the shipped script exactly as the browser does: in the document's own global scope, where
 * bare `localStorage`, `window` and `document` all resolve the way they do on the page.
 */
function runNoFlashScript(): void {
  document.documentElement.removeAttribute('data-theme')
  // `new Function` is the point, not a shortcut: the alternative is a second copy of the script
  // in this file, and a copy is what the guard exists to disprove. The input is a committed file
  // in this repo read at test time — there is no interpolation and no untrusted string.
  new Function(INLINE[0])()
}

const painted = () => document.documentElement.getAttribute('data-theme')

afterEach(() => {
  if (ORIGINAL_STORAGE) Object.defineProperty(globalThis, 'localStorage', ORIGINAL_STORAGE)
  if (ORIGINAL_MATCH_MEDIA) Object.defineProperty(window, 'matchMedia', ORIGINAL_MATCH_MEDIA)
  document.documentElement.setAttribute('data-theme', 'light')
})

describe('the no-flash script in index.html — the only thing that decides the first paint', () => {
  it('is the one script this file runs: exactly one inline <script>, and it reads the theme key', () => {
    expect(INLINE, 'index.html has no attribute-less <script> — this file is testing nothing').toHaveLength(1)
    expect(INLINE[0], 'the inline script does not mention the theme key — wrong script extracted').toContain(
      STORAGE_KEY,
    )
  })

  it('⚠ honours prefers-color-scheme when the browser REFUSES site data', () => {
    refusingStorage()
    useMatchMedia(true)
    runNoFlashScript()
    expect(
      painted(),
      'a reader whose OS says dark, on a browser that refuses site data, is painted the light ' +
        'canvas #F3F6FA — measured in Chrome on dist/index.html. The storage read and the media ' +
        'query are two independent questions and only the first can be refused.',
    ).toBe('dark')
  })

  it('still answers light when the browser refuses site data and the OS says light', () => {
    refusingStorage()
    useMatchMedia(false)
    runNoFlashScript()
    expect(painted(), 'light is the right answer here — this separates the defect from "always dark"').toBe('light')
  })

  it('lets a stored choice beat the OS preference', () => {
    useStorage(storageHolding({ [STORAGE_KEY]: 'light' }))
    useMatchMedia(true)
    runNoFlashScript()
    expect(painted(), 'a stored light must survive an OS that prefers dark').toBe('light')
  })

  it('reads a stored dark on an OS that prefers light', () => {
    useStorage(storageHolding({ [STORAGE_KEY]: 'dark' }))
    useMatchMedia(false)
    runNoFlashScript()
    expect(painted(), 'a stored dark must survive an OS that prefers light').toBe('dark')
  })

  it('falls to the OS preference when storage works and holds nothing', () => {
    useStorage(storageHolding({}))
    useMatchMedia(true)
    runNoFlashScript()
    expect(painted(), 'the first-ever visit on a dark OS').toBe('dark')
  })

  it('⚠ still sets an attribute when storage is refused AND matchMedia does not exist', () => {
    refusingStorage()
    useMatchMedia('absent')
    expect(() => runNoFlashScript(), 'the script threw — see below').not.toThrow()
    expect(
      painted(),
      'theme.css defines every token under [data-theme=…]. An unguarded second read throws out ' +
        'of the IIFE, leaves NO attribute, and the page renders with no canvas, no ink and no ' +
        'accent — strictly worse than the defect this file exists for.',
    ).toBe('light')
  })

  it('ignores a stored value that is neither light nor dark', () => {
    useStorage(storageHolding({ [STORAGE_KEY]: 'midnight' }))
    useMatchMedia(true)
    runNoFlashScript()
    expect(painted(), 'a corrupted entry must not reach the attribute').toBe('dark')
  })
})
