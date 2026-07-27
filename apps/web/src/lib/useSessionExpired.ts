import { useQueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { isSessionExpired } from './productState'

// "Is ANY read currently refused for want of a valid credential?" — DERIVED from the query
// cache, never recorded alongside it.
//
// ── WHY NOT A FLAG SET IN onError ────────────────────────────────────────────
//
// The obvious implementation is a module-level `let sessionDead = false` flipped by the query
// client's onError. It would work, and it would be a second source of truth about a fact the
// cache already holds — so it would eventually disagree with the cache. It cannot un-set itself
// when a retry succeeds (nothing calls onError on success), so the banner would outlive the
// problem: sign in again, everything starts working, and the bar still says your session
// expired. A fact stored beside the thing it describes drifts from it.
//
// So this reads the cache and reports what is actually in it. When the credential is fixed, the
// refetches succeed, the errors clear, and the banner disappears on its own — with nothing
// having to remember to remove it.
//
// ── WHY useSyncExternalStore ─────────────────────────────────────────────────
//
// The query cache is exactly an external store: subscribe + read. The snapshot is a BOOLEAN, so
// React's identity comparison is a value comparison and no memoisation is needed — returning
// the array of failing queries here would allocate a new array per render and loop forever.
export function useSessionExpired(): boolean {
  const qc = useQueryClient()
  const cache = qc.getQueryCache()
  return useSyncExternalStore(
    (onChange) => cache.subscribe(onChange),
    () => cache.getAll().some((q) => isSessionExpired(q.state.error)),
    // Server snapshot: no cache has been populated during SSR/prerender, so nothing is failing.
    () => false,
  )
}
