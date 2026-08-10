import { useQuery } from '@tanstack/react-query'

import { api } from './api'

/**
 * THE GATE OWNS THE `/auth/me` PROBE. EVERYONE ELSE READS IT.
 *
 * `['auth-me']` had FIVE identical `useQuery` call sites in four files. One of them —
 * `AuthGate` — decides whether the product renders at all. The other four are passive: a chip
 * showing who is signed in, two surfaces reading the workspace, the legal pages' back-link. None
 * of them should be able to make the gate re-decide, and by default every one of them could.
 *
 * ⚠ WHAT THAT COST, MEASURED — THE CONSOLE RENDERED NOTHING, FOR AS LONG AS THE BFF WAS DOWN.
 * React Query's `retryOnMount` defaults to TRUE: an observer mounting onto a query in ERROR state
 * starts a fresh fetch. So when `/auth/me` failed, the gate errored, fell through to the shell,
 * the shell mounted `SessionChip`, `SessionChip`'s observer restarted the probe, the gate went
 * back to `isLoading` and returned `null`, and the shell — with `SessionChip` inside it —
 * unmounted. Round again, for ever.
 *
 * MEASURED IN REAL CHROME on the built artifact, `/auth/me` failing three different ways
 * (`net::ERR_CONNECTION_REFUSED`, 502, 500) — `#root` was EMPTY at every sample for 30s, with
 * 39 probe requests in 20s, while the SAME harness answering the probe rendered in 118ms with
 * ONE request. In jsdom against the real `<App/>` and the real exported `queryClient`: 78 fetches
 * in 4 seconds, `status` sampled `pending` and `fetchStatus` `fetching` every time, and the query
 * cache recording 70 `updated:error` events in the same window — it errored seventy times and was
 * restarted seventy times.
 *
 * ⚠ ISOLATED TO ONE COMPONENT, same gate, same production client, one child different:
 *     children = <div>APP CONTENT</div>                  -> 11 chars, status=error, 2 fetches
 *     children = <div>APP CONTENT<SessionChip/></div>    ->  0 chars, status=pending, climbing
 *
 * ⚠ AND THE COMPONENT THAT DOES IT IS THE ONE WHOSE JOB IS TO RENDER NOTHING HERE. `SessionChip`
 * says so itself — "Renders nothing when there is no session to show (disabled mode, or the gate
 * is about to take over anyway)". It returns `null` in this state. Mounting was the whole cost.
 *
 * ⚠ WHY THIS IS NOT SET GLOBALLY, AND WHY THE GATE KEEPS THE DEFAULT. `retryOnMount: false` on
 * every query would also stop the OWNER from re-probing when it remounts, which is the one place
 * a fresh decision is wanted — `AuthGate`'s own `useQuery` is deliberately left alone. The rule
 * this encodes is not "never retry", it is "a reader may not restart a probe it does not own".
 */
export function useAuthMeReader() {
  return useQuery({
    queryKey: ['auth-me'],
    queryFn: api.me,
    staleTime: 60_000,
    retryOnMount: false,
  })
}
