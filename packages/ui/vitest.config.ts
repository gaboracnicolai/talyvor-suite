import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    globalSetup: ['./src/__tests__/reach-global-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
