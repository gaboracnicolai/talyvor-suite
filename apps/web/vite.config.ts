import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // @talyvor/ui is consumed as workspace SOURCE (TS/TSX); don't pre-bundle it.
  optimizeDeps: { exclude: ['@talyvor/ui'] },
})
