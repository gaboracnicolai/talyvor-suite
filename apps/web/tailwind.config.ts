import type { Config } from 'tailwindcss'
import preset from '@talyvor/ui/preset'

export default {
  presets: [preset],
  content: [
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
  ],
} satisfies Config
