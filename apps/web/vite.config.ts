import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

import { bundleVersionPayload, COMMIT_ENV_VAR, UNSTAMPED } from './src/buildIdentity'

/**
 * stampBuild writes the commit this bundle was built from into the build output, so the deployed
 * web artifact can be identified WITHOUT asking the BFF. The two ship as separate operations
 * against the same host (deploy/README.md step 3b), so the BFF's version is not evidence about
 * the bundle's.
 *
 * It emits the same value twice, on purpose, because the two get read in different situations:
 *
 *   · dist/version.json — the operator surface. `curl $APP/version.json | jq` during a deploy,
 *     and the file the BFF reads off disk to report which bundle it is serving.
 *
 *     ⚠ ON A BUNDLE THAT PREDATES THIS, THAT PATH RETURNS 404. It used to return index.html with
 *     STATUS 200, because the BFF's spaHandler fell back to index.html for any path that is not a
 *     real file — so `curl -f`, and anything else that tests the status code, passed against a
 *     bundle carrying no version at all. `/version.json` and `/assets/…` are now excluded from
 *     that fallback (apps/bff/lens.go, isBuildOwnedPath). A check should still require the
 *     response to PARSE AS JSON: that proves it is a version payload rather than merely present,
 *     and it stays true through a proxy or static host with a fallback of its own.
 *
 *     ⚠ THE BFF's EXCLUSION IS A PREFIX ON `assets/` — VITE'S DEFAULT assetsDir, WHICH THIS FILE
 *     DOES NOT OVERRIDE. Setting `build.assetsDir` here would move the emitted files out from
 *     under it and silently restore the 200-with-HTML answer for every missing asset.
 *     deploy/decision-expiry.sh holds that premise.
 *
 *   · a <meta name="talyvor-build"> in index.html — immune to that ambiguity, because index.html
 *     IS the fallback: the tag is either there or it is not. Also readable from the DOM with no
 *     network call at all, if a UI surface ever wants to show it.
 *
 * Both come from one `payload` computed once here, so they cannot disagree within a build.
 *
 * ⚠ NO GIT FALLBACK, DELIBERATELY. It is tempting to shell out to `git rev-parse` when
 * SUITE_COMMIT is unset so that local builds are "stamped too". That would be a different lie: it
 * names a commit while the working tree may hold uncommitted changes, and it would make an
 * unstamped build indistinguishable from a real one. Unset stays unstamped and says so.
 */
function stampBuild(): Plugin {
  const payload = bundleVersionPayload(process.env[COMMIT_ENV_VAR])
  const json = `${JSON.stringify(payload, null, 2)}\n`

  return {
    name: 'talyvor:stamp-build',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: json })
    },
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { name: 'talyvor-build', content: payload.commit ?? UNSTAMPED },
          injectTo: 'head',
        },
      ]
    },
  }
}

export default defineConfig({
  plugins: [react(), stampBuild()],
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
