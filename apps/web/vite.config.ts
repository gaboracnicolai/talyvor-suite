import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // @talyvor/ui is consumed as workspace SOURCE (TS/TSX); don't pre-bundle it.
  optimizeDeps: { exclude: ['@talyvor/ui'] },
  // In dev, the app and its API must share an origin (no CORS). vite serves the app on
  // 5173 and proxies /api → the BFF on 8787, so the browser only ever talks to 5173.
  // In production the BFF serves the built bundle itself, so this proxy is dev-only.
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      // The auth surface lives on the BFF too. In oidc-mode dev, set the BFF's
      // BFF_PUBLIC_BASE_URL to this vite origin (http://127.0.0.1:5173) so the
      // OIDC redirect comes back through the proxy and the cookie lands on the
      // origin the browser is actually using.
      '/auth': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
})
