import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'

import { ApiError, getJSON, getJSONArray } from '../../lib/api'
import { useAuthMeReader } from '../../lib/authMe'

// B10.6 — the Docs pages a person pinned, and the ones they opened last, for the sidebar.
//
// PINS ARE KEPT BY DOCS (B18.27, on talyvor-docs' B18.41), so a page pinned in one browser is pinned
// in every other one after sign-in: GET /api/docs/pins, and PUT/DELETE on a page's /pin. Docs lists
// only pages the person can still open. A pin this browser still holds from before is sent to Docs
// once and then dropped here, so nobody loses a pin to the move.
//
// RECENT PAGES STAY IN THIS BROWSER, per signed-in account, scoped the way chat history is
// (areas/chat/history.ts): Docs' own recent-pages list is built from page views, and this app does
// not record page views in Docs.

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

/** A pin as Docs lists it (GET /v1/workspaces/{ws}/pins), newest first. */
interface ServerPin {
  page_id: string
  space_id: string
  title: string
  at: string
}

const PINS_KEY = ['docs', 'pins']

/** B27.15 — whether Docs knows this person yet, shared by the sidebar and the Docs screen. */
export const DOCS_MEMBERSHIP_KEY = ['docs', 'membership']

/** GET /api/docs/membership — 200 either way, so asking never logs a failed request. Docs learns its
 *  members from Track, and a person who has just joined is refused until that roster arrives; anything
 *  but an explicit `true` means "do not ask Docs for this person's things yet". */
export async function readDocsMembership(): Promise<boolean> {
  const v: unknown = await getJSON<unknown>('/api/docs/membership')
  return (v as { member?: unknown } | null)?.member === true
}

const toRef = (p: ServerPin): DocRef => ({ spaceId: p.space_id, pageId: p.page_id, title: p.title })

function isServerPin(v: unknown): v is ServerPin {
  const p = v as ServerPin
  return typeof p?.page_id === 'string' && typeof p.space_id === 'string' && typeof p.title === 'string'
}

/** Docs' list, kept to well-formed entries: the sidebar is on every screen, so a reply that is not a
 *  list must leave it without pins rather than take the page down. A refusal — membership lost after
 *  the check above said yes — is no pins, not a failure. */
async function readPins(): Promise<ServerPin[]> {
  let v: unknown
  try {
    v = await getJSONArray<ServerPin>('/api/docs/pins')
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) return []
    throw err
  }
  return Array.isArray(v) ? v.filter(isServerPin) : []
}

async function sendPin(ref: Pick<DocRef, 'spaceId' | 'pageId'>, on: boolean): Promise<void> {
  const path = `/api/docs/spaces/${encodeURIComponent(ref.spaceId)}/pages/${encodeURIComponent(ref.pageId)}/pin`
  const res = await fetch(path, { method: on ? 'PUT' : 'DELETE', headers: { Accept: 'application/json' } })
  if (!res.ok) throw new ApiError(res.status, path)
}

/** Pinned pages, the last pages opened, and the two things that change them. */
export function useDocsNav() {
  const me = useAuthMeReader()
  const qc = useQueryClient()
  const scope =
    me.data?.user?.sub ?? me.data?.workspace_id ?? (me.data?.mode === 'disabled' ? 'local' : null)
  const raw = useSyncExternalStore(subscribe, () => (scope === null ? null : readRaw(scope)))
  const stored = useMemo(() => parse(raw), [raw])
  // B27.15 — pins are asked for only once Docs counts this person as a member. The sidebar is on every
  // screen, and asking a Docs that has not been told about someone logged a 403 on every page load.
  const membership = useQuery({
    queryKey: DOCS_MEMBERSHIP_KEY,
    queryFn: readDocsMembership,
    enabled: scope !== null,
    staleTime: 60_000,
  })
  const pins = useQuery({
    queryKey: PINS_KEY,
    queryFn: readPins,
    enabled: scope !== null && membership.data === true,
    staleTime: 60_000,
  })
  const pinned = useMemo(() => (pins.data ?? []).map(toRef), [pins.data])

  // A pin this browser kept before pins moved to Docs goes to Docs once, then leaves this browser.
  useEffect(() => {
    if (scope === null || !pins.isSuccess || stored.pinned.length === 0) return
    const local = stored.pinned
    write(scope, { ...parse(readRaw(scope)), pinned: [] })
    void Promise.allSettled(local.map((ref) => sendPin(ref, true))).then(() =>
      qc.invalidateQueries({ queryKey: PINS_KEY }),
    )
  }, [scope, pins.isSuccess, stored.pinned, qc])

  const opened = useCallback(
    (ref: DocRef) => {
      if (scope === null) return
      const cur = parse(readRaw(scope))
      write(scope, { ...cur, recent: [ref, ...cur.recent.filter((r) => !same(r, ref))].slice(0, RECENT_KEPT) })
    },
    [scope],
  )

  const setPinned = useCallback(
    (ref: DocRef, on: boolean) => {
      // Shown at once; then Docs is told, and its list read back — a refused pin disappears again.
      qc.setQueryData<ServerPin[]>(PINS_KEY, (cur = []) => {
        const rest = cur.filter((p) => !(p.space_id === ref.spaceId && p.page_id === ref.pageId))
        const mine = { page_id: ref.pageId, space_id: ref.spaceId, title: ref.title, at: new Date().toISOString() }
        return on ? [mine, ...rest] : rest
      })
      void sendPin(ref, on)
        .catch(() => undefined)
        .then(() => qc.invalidateQueries({ queryKey: PINS_KEY }))
    },
    [qc],
  )

  return {
    /** False until the browser knows who is signed in — nothing can be pinned before then. */
    ready: scope !== null,
    pinned,
    /** The last pages opened that are not pinned, newest first — never more than RECENT_SHOWN. */
    recent: stored.recent.filter((r) => !pinned.some((p) => same(p, r))).slice(0, RECENT_SHOWN),
    isPinned: (ref: Pick<DocRef, 'spaceId' | 'pageId'>) =>
      pinned.some((p) => p.spaceId === ref.spaceId && p.pageId === ref.pageId),
    opened,
    setPinned,
  }
}

export function pageHref(ref: Pick<DocRef, 'spaceId' | 'pageId'>): string {
  return `/docs/spaces/${encodeURIComponent(ref.spaceId)}/pages/${encodeURIComponent(ref.pageId)}`
}
