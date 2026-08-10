/**
 * NODE'S OWN `localStorage` SHADOWED jsdom's, AND EVERY `typeof localStorage` GUARD WENT FALSE.
 *
 * ── WHAT WAS MEASURED, ON THIS TREE, IN BOTH PROJECTS ────────────────────────────────────────
 *
 *     'localStorage' in globalThis        true
 *     typeof localStorage                 "undefined"
 *     Object.getOwnPropertyDescriptor     { get: [Function], configurable: true }   ← a GETTER
 *     typeof sessionStorage               "object"                                 ← jsdom's
 *     process.version                     v26.0.0
 *
 * Node 26 defines `localStorage` as a built-in global getter that yields `undefined` unless the
 * process was started with `--localstorage-file` (the ExperimentalWarning every worker prints —
 * "localStorage is not available because --localstorage-file was not provided" — is this, and it
 * appears sixty-odd times in a full run). It shadows the one jsdom installs. `sessionStorage`,
 * which Node does not define, comes through as jsdom's object untouched. THAT ASYMMETRY IS THE
 * EVIDENCE: two storages from one jsdom window, one present and one not, is not something jsdom
 * does. It is the environment, not the DOM.
 *
 * ⚠ PRESENT-AND-EMPTY IS THE STATE THAT HID IT. A probe asking `'localStorage' in globalThis`
 * says yes. A probe asking `typeof` says no. `lib/theme.ts` asked `typeof`, so its whole
 * persistence half — the stored-choice read AND the write — was skipped in every test in this
 * repo, and a guard on either could not have failed.
 *
 * ⚠ AND THE RUNTIME THAT MATTERS IS NOT ONLY THIS ONE. `.github/workflows/ci.yml` pins
 * `node-version: 22`, where Node's webstorage global is still behind a flag — so jsdom's own
 * localStorage is expected to come through there and this file to be INERT. That expectation is
 * NOT measured here: the machine this was written on has only v26, and no v22 to check against.
 * It is handled by construction instead — nothing below assumes which runtime it is on, the
 * export names which case actually happened, and theme-storage.test.tsx asserts only that the
 * ambient storage WORKS, never that it had to be replaced. The CI log answers the open half.
 *
 * ── WHY A SHIM AND NOT `--localstorage-file` ─────────────────────────────────────────────────
 *
 * Node's implementation persists to a FILE. Vitest runs these projects across parallel workers,
 * so one file is one mutable store shared by every worker — cross-test contamination by
 * construction. A setup file runs once per test FILE, so the Map below is per-file and cannot
 * leak; that isolation is the point and `storage-env.test.ts` pins it.
 *
 * ── ORDERING, WHICH IS LOAD-BEARING ──────────────────────────────────────────────────────────
 *
 * This is `setupFiles[0]` in BOTH projects, ahead of each project's real setup, because
 * `lib/theme.ts` reads storage during MODULE INITIALISATION (the zustand store calls
 * `initialTheme()` at import) and both setups import `@talyvor/ui` transitively.
 *
 * ⚠ IT MUST NOT IMPORT ANYTHING. apps/web/src/reachAudit installs the React DevTools hook and
 * must still be the first thing that touches React — see the ORDER note in reachAudit.ts. This
 * file touches one global and imports nothing, so that constraint is preserved; the reach count
 * staying at 70/70 with this file installed is what checks it.
 *
 * ⚠ AND THE ORDERING IS DEFENSIVE, NOT CHECKED — MEASURED, NOT ASSUMED. Control C5 in
 * scripts/w11-theme-storage-controls.py moves this file to setupFiles[1], BEHIND the setup that
 * pulls in `@talyvor/ui`, and scores NOT CAUGHT: nothing reds. The reason is that the value
 * `initialTheme()` computes with no storage is the SAME value it computes with an empty one
 * ('light', via the attribute then the OS preference), and the two cases that exercise a stored
 * choice re-import the module with `vi.resetModules()` after every setup file has already run.
 * So position 0 is where this belongs the day a module CACHES a storage read at import — it is
 * not something any assertion here would notice today, and this paragraph is what stops the next
 * reader believing it is.
 */

const REAL = (globalThis as { localStorage?: Storage }).localStorage

/** A Web Storage implementation over a Map. Only installed when the global is missing. */
function mapStorage(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => {
      m.set(String(k), String(v))
    },
    removeItem: (k: string) => {
      m.delete(String(k))
    },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size
    },
  } as Storage
}

// Only when it is actually missing: on a runtime that supplies a working one, the real object
// is what the tests should exercise. `configurable: true` is measured on the Node 26 getter.
if (REAL === undefined) {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: mapStorage() })
}

/**
 * WHICH CASE THIS RUN IS IN. Deliberately not a boolean anyone is asked to assert: pinning
 * `true` would pin the runtime, and this file's whole point is that the runtime moved without
 * anyone noticing. theme-storage.test.tsx prints it, so a CI log says which half of the note
 * above is live on Node 22 rather than leaving it argued.
 */
export const PROVENANCE: 'runtime' | 'shim' = REAL === undefined ? 'shim' : 'runtime'
