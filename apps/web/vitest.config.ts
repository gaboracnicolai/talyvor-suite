import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['../../packages/ui/src/__tests__/storage-env.ts', './src/test-setup.ts'],
    globalSetup: ['./scripts/reach-global-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
