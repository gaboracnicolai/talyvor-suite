import { resolve } from 'node:path'
import type { Config } from 'tailwindcss'
import preset from '@talyvor/ui/preset'

const content = [
  './index.html',
  './src/**/*.{ts,tsx}',
  // scan the design system's source so its classes are generated
  '../../packages/ui/src/**/*.{ts,tsx}',
  // ⚠ TEST FILES ARE NOT CONTENT. Tailwind's extractor reads raw text, so a class named in a
  // FIXTURE — `no-arbitrary-value.test.ts` naming `text-[#fff]`, motion.test.tsx naming
  // `motion-reduce:transition-none` in a string it feeds its own scanner — was compiled into
  // the stylesheet the browser downloads. Measured on this tree: 18 classes reached the sheet
  // from test files and from nowhere else, `scale-[0.98]` and `text-[#fff]` among them — the
  // production bundle carrying the exact arbitrary values `local/no-arbitrary-value` exists to
  // forbid, supplied by the tests that prove they are forbidden.
  //
  // ⚠ THIS DOES NOT CLOSE THE WHOLE HOLE AND IS NOT MEANT TO. COMMENTS in ordinary source are
  // still extracted: preset.ts's sentence "arbitrary values (text-[#…], p-[13px]) are forbidden"
  // ships `.p-\[13px\]` and `.text-\[\#…\]` as real rules, and the display-scale comment quoting
  // the site's markup ships `leading-[1.04]` and `tracking-[-0.03em]`. Twenty classes in this
  // sheet exist only because prose mentions them. Closing that means a custom `extract` that
  // strips comments first, which moves the emitted set deadClasses.test.ts reasons about — its
  // own change, with its own positive controls. Reported on the queue, not folded in here.
  '!./src/**/*.test.{ts,tsx}',
  '!../../packages/ui/src/**/*.test.{ts,tsx}',
]

/**
 * THE GLOBS, MADE ABSOLUTE, WITH THE NEGATIONS INTACT.
 *
 * The build reads `content` relative to this file and needs no help. A TEST that re-runs the
 * generator to ask what is emitted does — and the obvious `content.map((g) => resolve(root, g))`
 * SILENTLY DESTROYS EVERY NEGATION:
 *
 *   '!./src/(**)/*.test.{ts,tsx}'          ->  '<root>/!./src/(**)/*.test.{ts,tsx}'
 *        the `!` becomes a literal DIRECTORY NAME, so the exclusion never matches anything
 *   '!../../packages/ui/src/(**)/*.test…'  ->  '<root>/packages/ui/src/(**)/*.test…'
 *        worse — the `!` is eaten as a path segment that `../..` then walks away, turning an
 *        EXCLUSION into a POSITIVE include (of a directory that does not exist)
 *
 * ⚠ THAT IS NOT HYPOTHETICAL AND IT WAS SHIPPING. deadClasses.test.ts mapped the globs exactly
 * that way, so the set it calls "what Tailwind emits" was generated over a content set
 * INCLUDING every test file — 369 names where the browser downloads 345. The 24 extra come
 * only from fixtures, `scale-[0.98]` and `text-[#fff]` among them: the very classes `5d65b3e`
 * took OUT of the bundle were still present in the set the GUARD reasons from. The build was
 * right and its instrument had quietly stopped agreeing with it.
 *
 * One implementation, here, beside the globs it is about — the same argument that keeps exactly
 * one comment stripper: two copies of a resolver is two chances for only one to be right.
 */
export function absoluteContent(root: string): string[] {
  return content.map((g) => (g.startsWith('!') ? `!${resolve(root, g.slice(1))}` : resolve(root, g)))
}

export default {
  presets: [preset],
  content,
} satisfies Config
