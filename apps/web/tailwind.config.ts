import { resolve } from 'node:path'
import type { Config } from 'tailwindcss'
import preset from '@talyvor/ui/preset'
// Deep relative import on purpose, the same one deadClasses/motion take: ONE comment stripper
// with ONE set of positive controls. Two copies is two chances for only one to be right.
import { stripComments } from '../../packages/ui/src/lib/sourceText'

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
  // ⚠ THAT WAS HALF THE HOLE, AND THE OTHER HALF IS CLOSED BELOW BY `contentTransform`.
  // COMMENTS in ordinary source were still extracted: preset.ts's sentence "arbitrary values
  // (text-[#…], p-[13px]) are forbidden" shipped `.p-\[13px\]` and `.text-\[\#…\]` as real
  // rules, and the display-scale comment quoting the site's markup shipped `leading-[1.04]`
  // and `tracking-[-0.03em]`. Twenty classes in this sheet existed only because prose
  // mentioned them; src/proseClasses.test.ts is the guard and holds the measurement.
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

/**
 * COMMENTS ARE NOT CONTENT — the second half of the hole the block above documents.
 *
 * `transform` runs on each file's text BEFORE Tailwind's extractor sees it, so this strips the
 * prose and lets the generator's own candidate scanner do the rest. That is deliberate: writing
 * a custom `extract` would mean reimplementing Tailwind's candidate rules, and a scanner that
 * disagrees with the generator is the failure this whole family of guards exists to catch.
 *
 * ⚠ MEASURED ON THIS TREE, base+components+utilities over the same file set:
 *     raw            363 names, 28,452 bytes
 *     stripped       343 names, 26,226 bytes   (nothing NEW appears — the diff is one-way)
 * The twenty include `p-[13px]` and `text-[#…]`, shipped by preset.ts's own sentence about the
 * arbitrary values `local/no-arbitrary-value` forbids, and `bg-accent-hover`, which reads in the
 * sheet exactly like a live token and which nothing renders. src/proseClasses.test.ts is the
 * guard, and it is positive-controlled in both directions: a class in a comment must stop being
 * emitted AND the same class in code must still be emitted, because a stripper that returned ''
 * would satisfy the first alone.
 *
 * ⚠ ONE STRIPPER. `stripComments` is imported, never copied — packages/ui/src/__tests__/
 * typeface.test.tsx holds its positive controls, and deadClasses/motion already depend on it.
 * `html` has NO transformer and that is a measured decision, not an oversight: see the EXEMPT
 * block in proseClasses.test.ts, which fails the day the content set grows a type nothing strips.
 */
export const contentTransform: Record<string, (src: string) => string> = {
  ts: stripComments,
  tsx: stripComments,
}

type RawFile = { raw: string; extension: string }

/**
 * THE BUILD'S CONTENT, IN ONE PLACE — files AND transformers.
 *
 * Three tests re-run the generator to ask what the browser downloads (deadClasses, tokenDoor,
 * motion). Each built its own content argument, so `absoluteContent` alone was the shared part
 * and anything ELSE the build does to its input was a fourth thing to remember. That is how the
 * `resolve()`-destroys-negations bug reached three files. One composer, used by the build and by
 * every instrument that claims to speak for it.
 */
export function buildContent(root: string, extra: RawFile[] = []) {
  return { files: [...absoluteContent(root), ...extra], transform: contentTransform }
}

export default {
  presets: [preset],
  content: { files: content, transform: contentTransform },
} satisfies Config
