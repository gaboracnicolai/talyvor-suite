import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/storage-env.ts', './src/__tests__/setup.ts'],
    globalSetup: ['./src/__tests__/reach-global-setup.ts'],
    // The same pinned gate clock apps/web uses, for the same reason — see that config for the
    // measurement and for why the pin is not UTC. The two projects run one gauntlet; a clock
    // they could set separately is a clock they can drift apart on.
    //
    // ⚠ INERT TODAY, AND SHIPPED SAYING SO. This package's only date rule is `lib/format.ts#
    // formatDay`, which pins `timeZone: 'UTC'` itself, so its answer never depended on the
    // ambient zone: measured at `3b27d13`, `packages/ui` is 350/350 green at UTC, Pacific/Midway
    // AND Pacific/Kiritimati. The pin changes nothing here today and exists so that a clock added
    // to the SHARED package later cannot be born zone-dependent without a test that says so.
    env: { TZ: 'Pacific/Kiritimati' },
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
