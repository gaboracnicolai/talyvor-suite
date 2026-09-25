import { useCallback, useMemo, useSyncExternalStore } from 'react'

import { useAuthMeReader } from '../../lib/authMe'

// B10.6 — the Docs pages a person pinned, and the ones they opened last, for the sidebar.
//
// ⚠ KEPT IN THIS BROWSER, PER SIGNED-IN ACCOUNT. Docs stores no favourites or pins (talyvor-docs has
// none) and the BFF holds no storage, so a pin lives in localStorage — it survives a reload, and it
// does not follow the person to another browser (recorded in FOUND.md). Scoped the way chat history
// is (areas/chat/history.ts), so two accounts on one browser never see each other's pins.

export interface DocRef {
  spaceId: string
  pageId: string
  /** The title when last seen — refreshed each time the page is opened. */
  title: string
}

interface Stored {
  pinned: DocRef[]
  recent: DocRef[]
}

/** How many recently opened pages the sidebar lists, beyond the pinned ones. */
export const RECENT_SHOWN = 5
/** How many are remembered, so unpinning one still leaves five to show. */
const RECENT_KEPT = 20

const KEY_PREFIX = 'talyvor.docs.nav.v1:'
const CHANGED = 'talyvor:docs-nav'

export function docsNavKey(scope: string): string {
  return KEY_PREFIX + scope
}

const same = (a: DocRef, b: DocRef) => a.spaceId === b.spaceId && a.pageId === b.pageId

function isRef(v: unknown): v is DocRef {
  const r = v as DocRef
  return typeof r?.spaceId === 'string' && typeof r.pageId === 'string' && typeof r.title === 'string'
}

function parse(raw: string | null): Stored {
  if (raw === null || raw === '') return { pinned: [], recent: [] }
  try {
    const v = JSON.parse(raw) as Partial<Stored>
    return {
      pinned: Array.isArray(v.pinned) ? v.pinned.filter(isRef) : [],
      recent: Array.isArray(v.recent) ? v.recent.filter(isRef) : [],
    }
  } catch {
    return { pinned: [], recent: [] }
  }
}

function readRaw(scope: string): string | null {
  try {
    return window.localStorage.getItem(docsNavKey(scope))
  } catch {
    return null
  }
}

function write(scope: string, next: Stored): void {
  try {
    window.localStorage.setItem(docsNavKey(scope), JSON.stringify(next))
  } catch {
    // A refused write (quota, private mode) leaves the sidebar as it was; nothing else depends on it.
  }
  window.dispatchEvent(new Event(CHANGED))
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange)
  window.addEventListener('storage', onChange) // another tab pinned or opened something
  return () => {
    window.removeEventListener(CHANGED, onChange)
    window.removeEventListener('storage', onChange)
  }
}

/** Pinned pages, the last pages opened, and the two things that change them. */
export function useDocsNav() {
  const me = useAuthMeReader()
  const scope =
    me.data?.user?.sub ?? me.data?.workspace_id ?? (me.data?.mode === 'disabled' ? 'local' : null)
  const raw = useSyncExternalStore(subscribe, () => (scope === null ? null : readRaw(scope)))
  const stored = useMemo(() => parse(raw), [raw])

  const opened = useCallback(
    (ref: DocRef) => {
      if (scope === null) return
      const cur = parse(readRaw(scope))
      write(scope, {
        pinned: cur.pinned.map((p) => (same(p, ref) ? ref : p)),
        recent: [ref, ...cur.recent.filter((r) => !same(r, ref))].slice(0, RECENT_KEPT),
      })
    },
    [scope],
  )

  const setPinned = useCallback(
    (ref: DocRef, on: boolean) => {
      if (scope === null) return
      const cur = parse(readRaw(scope))
      const rest = cur.pinned.filter((p) => !same(p, ref))
      write(scope, { ...cur, pinned: on ? [...rest, ref] : rest })
    },
    [scope],
  )

  return {
    /** False until the browser knows who is signed in — nothing can be pinned before then. */
    ready: scope !== null,
    pinned: stored.pinned,
    /** The last pages opened that are not pinned, newest first — never more than RECENT_SHOWN. */
    recent: stored.recent.filter((r) => !stored.pinned.some((p) => same(p, r))).slice(0, RECENT_SHOWN),
    isPinned: (ref: Pick<DocRef, 'spaceId' | 'pageId'>) =>
      stored.pinned.some((p) => p.spaceId === ref.spaceId && p.pageId === ref.pageId),
    opened,
    setPinned,
  }
}

export function pageHref(ref: Pick<DocRef, 'spaceId' | 'pageId'>): string {
  return `/docs/spaces/${encodeURIComponent(ref.spaceId)}/pages/${encodeURIComponent(ref.pageId)}`
}
