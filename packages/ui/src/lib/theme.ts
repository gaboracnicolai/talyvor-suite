import { create } from 'zustand'

export type Theme = 'light' | 'dark'
const STORAGE_KEY = 'talyvor-theme'

/**
 * STORAGE HAS THREE STATES, AND `typeof` COULD ONLY SEE TWO.
 *
 * `typeof localStorage !== 'undefined'` asks "is there a storage object". A browser answers YES
 * and then THROWS from `getItem`/`setItem` — Safari private browsing, Chrome with site data
 * blocked, an embedded WebView, or a full quota. apps/web/index.html's no-flash script already
 * knows this and wraps its read in try/catch; this module, which owns the WRITE on the same key,
 * did not.
 *
 * ⚠ WHAT THAT COST, MEASURED (theme-storage.test.tsx is the guard): `apply()` set the DOM
 * attribute BEFORE the write, so a throw landed BETWEEN the two halves of one state change. The
 * page repainted dark, `set({ theme })` never ran, and ThemeToggle — whose icon, `title` and
 * `aria-label` all read the store — went on announcing "Switch to dark theme" on a page that was
 * already dark. The next press recomputed `next` from the stale `light` and painted dark again,
 * so the control could never return. Painted dark, labelled light, stuck.
 *
 * ⚠ AND NO TEST IN THIS REPO COULD HAVE SEEN IT. Under Node 26 `localStorage` is a built-in
 * global GETTER that yields `undefined` unless `--localstorage-file` is passed, and it shadows
 * jsdom's — so `'localStorage' in globalThis` was true while `typeof localStorage` was
 * "undefined", every guard below was false, and the whole persistence half was dead in both
 * vitest projects. `sessionStorage`, which Node does not define, came through as jsdom's object;
 * that asymmetry is what named the cause. __tests__/storage-env.ts restores it and pins the
 * asymmetry, and without that file this module's guard cannot fail.
 *
 * So the access is widened to `Storage | undefined` — which is the honest type for a global that
 * may be absent, present, or present-and-refusing — and every call is wrapped.
 */
function storage(): Storage | undefined {
  return (globalThis as { localStorage?: Storage }).localStorage
}

/** First load: honour the data-theme the no-flash script already set (from stored
 *  choice or prefers-color-scheme), else derive it here. */
function initialTheme(): Theme {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute('data-theme')
    if (attr === 'light' || attr === 'dark') return attr
  }
  try {
    const stored = storage()?.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // Refused. Fall through to the OS preference — the same answer a first-ever visit gets.
  }
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

function apply(theme: Theme): void {
  if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', theme)
  try {
    storage()?.setItem(STORAGE_KEY, theme)
  } catch {
    // Refused. The theme is already painted and the store is about to agree with it; forgetting
    // the choice for next time must not abandon this state change half-done.
  }
}

interface ThemeState {
  theme: Theme
  setTheme: (t: Theme) => void
  toggle: () => void
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: initialTheme(),
  setTheme: (t) => {
    apply(t)
    set({ theme: t })
  },
  toggle: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark'
    apply(next)
    set({ theme: next })
  },
}))
