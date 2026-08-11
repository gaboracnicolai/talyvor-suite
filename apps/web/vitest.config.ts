import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['../../packages/ui/src/__tests__/storage-env.ts', './src/test-setup.ts'],
    globalSetup: ['./scripts/reach-global-setup.ts'],
    // THE GATE'S CLOCK, PINNED — and deliberately NOT UTC.
    //
    // The product's timestamp formatters (`areas/lens/format.ts#formatWhen`, `areas/track/…`)
    // carry no `timeZone`, so they render in the READER's zone. Unpinned, every assertion that
    // reads a rendered clock therefore has a different answer per developer: measured at
    // `3b27d13`, `pnpm test` here is green at UTC, Europe/Bucharest, America/Los_Angeles and
    // Pacific/Midway and RED at Pacific/Kiritimati (areas/track/format.test.ts asserted the
    // day `Jul 19` for an instant that is Jul 20 past UTC+9:08). A gate whose verdict depends
    // on where you are standing is not a gate.
    //
    // ⚠ UTC WOULD HAVE BEEN THE WRONG PIN. It is CI's zone, so it makes the gate reproducible
    // AND blind in the same stroke: under UTC a zone-dependent formatter and a `timeZone:'UTC'`
    // one render identically, which is exactly the distinction src/renderedClock.test.ts exists
    // to make. Pacific/Kiritimati is the furthest offset from UTC with no DST, so a rendered
    // day differs from the instant's UTC day for most of the day and the two rules cannot be
    // confused. It is the GATE's clock, never a claim about the product's — see
    // src/renderedClock.test.ts, which asserts both rules side by side.
    env: { TZ: 'Pacific/Kiritimati' },
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
