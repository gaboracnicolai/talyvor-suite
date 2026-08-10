import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ThemeToggle } from '../components/ThemeToggle'
import { useTheme } from '../lib/theme'
import { PROVENANCE } from './storage-env'

/**
 * THE TOGGLE ON A BROWSER THAT REFUSES SITE DATA.
 *
 * Safari private browsing, Chrome with site data blocked, an embedded WebView, a full quota: in
 * every one, `localStorage` EXISTS and its methods THROW. apps/web/index.html's no-flash script
 * has always wrapped its read in try/catch; `lib/theme.ts`, which owns the write on the same key,
 * did not — and `apply()` paints BEFORE it writes, so the throw split one state change in half.
 *
 * MEASURED BEFORE THE FIX, with the refusing storage below:
 *     THREW=false  PAINTED=dark  STORE=light  OFFERS="Switch to dark theme"
 * The page is dark; the control says it will make it dark. Pressing again recomputes `next` from
 * the stale `light` and paints dark once more, so light is unreachable. Nothing crashes and
 * nothing is logged where a user would look.
 *
 * ⚠ AND ON THE MACHINE THIS WAS WRITTEN ON, NO TEST COULD HAVE SEEN IT. Node 26 defines
 * `localStorage` as a built-in global getter yielding `undefined` unless `--localstorage-file` is
 * passed, shadowing jsdom's — so `apply()`'s old `typeof` guard was false, no write was attempted,
 * and nothing could throw. This file was first written against the UNFIXED module and its three
 * failure cases all passed; the persistence case at the bottom is what exposed the environment
 * instead of the defect. storage-env.ts is the repair, and C3 in
 * scripts/w11-theme-storage-controls.py is the proof that it is load-bearing.
 *
 * ── WHY THE STORAGE IS SWAPPED WHOLE, NOT PATCHED ────────────────────────────────────────────
 *
 * The obvious `localStorage.setItem = throwingFn` is wrong on a REAL Storage: Web Storage
 * supports named properties, so on jsdom that assignment can store an ITEM called "setItem"
 * rather than shadow the method — and the refusal would silently not happen. CI pins Node 22,
 * where the ambient storage is expected to be jsdom's rather than this repo's shim, so a patch
 * that only works on the shim would be a guard that cannot fail on the runtime that gates
 * merges. Every case below replaces the whole global through its property descriptor and
 * restores the original descriptor afterwards.
 */

const ORIGINAL = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

function useStorage(impl: Storage): void {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: impl })
}

function restoreStorage(): void {
  if (ORIGINAL) Object.defineProperty(globalThis, 'localStorage', ORIGINAL)
}

function workingStorage(): Storage {
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

/** A storage that refuses every WRITE, the way a blocked or full one does. */
function refusingStorage(): Storage {
  return {
    ...workingStorage(),
    setItem: () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    },
  } as Storage
}

/** A storage that refuses every READ — what a SecurityError browser does on first touch. */
function unreadableStorage(): Storage {
  return {
    ...workingStorage(),
    getItem: () => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    },
  } as Storage
}

/** The theme the page is actually painting. */
const painted = () => document.documentElement.getAttribute('data-theme')

/** What the control announces it will do next — its accessible name is its whole state. */
const offers = () => screen.getByRole('button').getAttribute('aria-label') ?? ''

beforeEach(() => {
  document.documentElement.setAttribute('data-theme', 'light')
  act(() => useTheme.setState({ theme: 'light' }))
})

afterEach(() => {
  restoreStorage()
  document.documentElement.setAttribute('data-theme', 'light')
  act(() => useTheme.setState({ theme: 'light' }))
})

describe('the instrument', () => {
  it('the AMBIENT storage works — without this the whole repo tests a dead branch', () => {
    // Not "was it shimmed": that would pin a Node version, and the runtime moving under this
    // repo unnoticed is the entire finding. What must hold either way is that a test here sees
    // the storage a browser would. PROVENANCE says which supplied it and is printed, so a CI log
    // answers that for Node 22 rather than leaving it argued.
    expect(['runtime', 'shim']).toContain(PROVENANCE)
    console.log(`localStorage provenance: ${PROVENANCE} (node ${process.version})`)
    expect(typeof localStorage).toBe('object')
    localStorage.setItem('probe', 'value')
    expect(localStorage.getItem('probe')).toBe('value')
    expect(localStorage.getItem('never-written')).toBeNull()
    localStorage.removeItem('probe')
  })

  it('the refusal is real, and swapping the global is what makes it real', () => {
    useStorage(refusingStorage())
    expect(() => localStorage.setItem('k', 'v')).toThrow()
    useStorage(unreadableStorage())
    expect(() => localStorage.getItem('k')).toThrow()
  })
})

describe('the theme toggle when the browser refuses site data', () => {
  it('still records the change — the store agrees with the paint', () => {
    useStorage(refusingStorage())
    render(<ThemeToggle />)
    fireEvent.click(screen.getByRole('button'))
    expect({ painted: painted(), store: useTheme.getState().theme }).toEqual({
      painted: 'dark',
      store: 'dark',
    })
  })

  it('does not lie about which way it goes next', () => {
    useStorage(refusingStorage())
    render(<ThemeToggle />)
    fireEvent.click(screen.getByRole('button'))
    // Painted dark, so the only honest offer is a way back to light.
    expect(offers()).toBe('Switch to light theme')
  })

  it('is not stuck — a second press returns to light', () => {
    useStorage(refusingStorage())
    render(<ThemeToggle />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByRole('button'))
    expect(painted()).toBe('light')
  })
})

describe('first load on a refusing browser — the READ half of the same guard', () => {
  // `initialTheme()` runs during module init. In apps/web the no-flash script has already set
  // data-theme so the read is unreachable — but @talyvor/ui is a shared design system and a
  // consumer without that script reaches it on first import. A throw there takes the whole store
  // down with it, which is a blank page rather than a wrong colour.
  it('falls back instead of throwing out of module initialisation', async () => {
    document.documentElement.removeAttribute('data-theme')
    useStorage(unreadableStorage())
    vi.resetModules()
    const fresh = await import('../lib/theme')
    expect(fresh.useTheme.getState().theme).toBe('light')
  })

  it('honours a stored choice when the read DOES work', async () => {
    document.documentElement.removeAttribute('data-theme')
    const s = workingStorage()
    s.setItem('talyvor-theme', 'dark')
    useStorage(s)
    vi.resetModules()
    const fresh = await import('../lib/theme')
    expect(fresh.useTheme.getState().theme).toBe('dark')
  })
})

describe('and when storage works, it still remembers — the must-stay-green half', () => {
  // Deliberately on the AMBIENT storage, not a swapped one: this is the case that fails if the
  // environment stops supplying a working localStorage, which is how C3 and C4 are caught.
  it('paints, persists and re-labels on each press', () => {
    localStorage.removeItem('talyvor-theme')
    render(<ThemeToggle />)

    fireEvent.click(screen.getByRole('button'))
    expect(painted()).toBe('dark')
    expect(localStorage.getItem('talyvor-theme')).toBe('dark')
    expect(offers()).toBe('Switch to light theme')

    fireEvent.click(screen.getByRole('button'))
    expect(painted()).toBe('light')
    expect(localStorage.getItem('talyvor-theme')).toBe('light')
    expect(offers()).toBe('Switch to dark theme')

    localStorage.removeItem('talyvor-theme')
  })
})
