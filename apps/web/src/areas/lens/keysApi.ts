// Live data layer for /keys. lib/api.ts is a SHARED file (owned by another tab),
// so — like docs/api.ts and admin/api.ts — the keys reads and the mint WRITE live
// here in the area. Both routes are real, shipped and tested on the BFF
// (apps/bff/keys.go): GET /api/keys → the workspace's key list; POST /api/keys →
// mint. The workspace key is held server-side; the browser only ever sees the
// minted credential in the POST response, exactly once.
//
// THE WRITE PATH AND ORIGIN (verified against apps/bff/keys.go, not assumed):
// requireSameOrigin rejects a POST unless its `Origin` header equals the BFF's
// configured public origin (https://app.talyvor.com). We CANNOT and MUST NOT set
// Origin from JS — it is a forbidden header. Instead we rely on the browser: a
// POST to the RELATIVE path '/api/keys' is same-origin, so the browser attaches
// `Origin: https://app.talyvor.com` itself, which is exactly what the BFF checks
// (its own doc-comment: "browsers attach Origin to every POST and scripts cannot
// forge it"). Default `credentials: 'same-origin'` carries the session cookie.
// The one failure mode, and it is correct-by-design: if the app is ever loaded
// from a hostname other than the configured public origin (a raw IP, an alias),
// the mint 403s — a CSRF refusal, not a bug. GET (list) needs no Origin.
import { ApiError } from '../../lib/api'

/** Lens list row: internal/tenant/store.go WorkspaceAPIKey (KeyHash json:"-").
 *  GET /v1/workspaces/{ws}/api-keys → []WorkspaceAPIKey. The list NEVER carries a
 *  credential — only the displayable prefix. */
export interface WorkspaceAPIKey {
  id: string
  workspace_id: string
  key_prefix: string
  name: string
  scopes: string[]
  last_used_at?: string
  expires_at?: string
  created_at: string
}

/** Lens mint response: cmd/lens/main.go POST /v1/workspaces/{ws}/api-keys →
 *  201 {key, prefix, name, scopes, …}. `key` is the credential, returned EXACTLY
 *  ONCE and shown once; `prefix` is how it appears in lists afterwards. They sit
 *  ADJACENT in the JSON and look alike — the whole /keys screen exists so a human
 *  never copies the wrong one. Extra upstream fields (id, warning) are ignored. */
export interface MintResult {
  key: string
  prefix: string
  name: string
  scopes: string[]
}

async function getJSON<T>(path: string): Promise<T> {
  // The shared ApiError, so a 401 trips App.tsx's QueryCache handler and
  // re-probes the auth gate exactly like every other live area.
  const res = await fetch(path, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new ApiError(res.status, path)
  return (await res.json()) as T
}

export const keysApi = {
  /** LIVE — the workspace's keys, newest as the server orders them. */
  list: (): Promise<WorkspaceAPIKey[]> => keysApi._list(),
  _list: (): Promise<WorkspaceAPIKey[]> => getJSON<WorkspaceAPIKey[]>('/api/keys'),

  /** LIVE WRITE — mint a key. Relative path ⇒ same-origin ⇒ the browser supplies
   *  the Origin the BFF requires (see the file header). The returned `key` is the
   *  credential; the caller shows it once via RevealOnce and never logs or
   *  re-renders it. */
  mint: async (name: string, scopes: string[]): Promise<MintResult> => {
    const res = await fetch('/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ name, scopes }),
    })
    if (!res.ok) throw new ApiError(res.status, '/api/keys')
    return (await res.json()) as MintResult
  },
}
