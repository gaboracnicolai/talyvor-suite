// B27.27 — "Your provider keys", for a workspace on the BYOK plan (Lens B27.26).
//
//   GET    /api/provider-keys            → Capability<ProviderKeys>   (apps/bff/provider_keys.go)
//   PUT    /api/provider-keys/{provider}   {"key": "…"} → ProviderKey
//   DELETE /api/provider-keys/{provider}   → 204
//
// A key goes in and never comes back out: Lens answers with the provider and the last four characters,
// and that is all this module ever holds. `enabled:false` is a deployment that holds no provider keys
// (Lens registers the routes only with LENS_PROVIDER_SECRET_KEK) — not a fault.

import { ApiError, getCapability, type Capability } from '../../lib/api'

/** What is ever shown of a stored key (talyvor-lens internal/byok.Key). */
export interface ProviderKey {
  provider: string
  last4: string
  updated_at: string
}

export interface ProviderKeys {
  /** The workspace's live subscription is the BYOK plan. */
  byok: boolean
  /** The providers a key can be added for. */
  providers: string[]
  keys: ProviderKey[]
}

export const PROVIDER_KEYS_KEY = ['provider-keys']

/** A save or removal Lens refused, with the sentence it gave (402: not on BYOK; 400: not a key). */
export class ProviderKeyError extends ApiError {
  constructor(
    status: number,
    path: string,
    readonly sentence: string,
  ) {
    super(status, path)
  }
}

async function send(provider: string, init: RequestInit): Promise<Response> {
  const path = `/api/provider-keys/${encodeURIComponent(provider)}`
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  })
  if (res.ok) return res
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  throw new ProviderKeyError(res.status, path, res.status < 500 ? (body.error ?? '') : '')
}

export const providerKeysApi = {
  list: (): Promise<Capability<ProviderKeys>> => getCapability<ProviderKeys>('/api/provider-keys', { byok: 'boolean' }),
  save: async (provider: string, key: string): Promise<ProviderKey> =>
    (await (await send(provider, { method: 'PUT', body: JSON.stringify({ key }) })).json()) as ProviderKey,
  remove: async (provider: string): Promise<void> => {
    await send(provider, { method: 'DELETE' })
  },
}
