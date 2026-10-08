import { ApiError } from '../../lib/api'
import type { Conversation } from './history'

// HISTORY SYNC — B28.365. A person's conversations on every device they turn sync on, encrypted.
//
// ⚠ SEALED IN THIS BROWSER, AND ONLY THE SEALED COPY LEAVES IT. history.ts keeps conversations in localStorage
// because Lens stores no prompt or response text. Sync keeps that promise: the whole history is encrypted here with
// AES-GCM under a key derived (PBKDF2-SHA256) from a passphrase the person chooses, and the BFF and Lens only ever
// hold the ciphertext (apps/bff/chat_history_sync.go). Another device opens it with the same passphrase. Nobody can
// recover a forgotten one, and the screen says so.
//
// ⚠ OFF IS THE DEFAULT, AND OFF MAKES NO CALL. Nothing here touches the network unless this browser holds a sync
// setting for the signed-in identity, which only turning sync on writes.
//
// One sealed copy holds the whole history and the conversations deleted from it. Every sync merges this browser's
// list with the stored one — per conversation, the later edit wins; a deletion wins over any edit made before it —
// and stores the result over the version it read. Another device storing first is Lens's 409, and the sync starts
// again from the newer copy.

const SETTING_PREFIX = 'talyvor.chat.sync.v1:'
const DELETED_PREFIX = 'talyvor.chat.deleted.v1:'
// OWASP's figure for PBKDF2-HMAC-SHA256. It travels in the stored salt, so a later change still opens older copies.
const ITERATIONS = 600_000
const SYNC_PATH = '/api/chat/history-sync'

/** What a sync carries: the conversations, and when each deleted one was deleted. */
export interface SyncedHistory {
  conversations: Conversation[]
  deleted: Record<string, number>
}

/** This browser's sync for one identity: the stored copy's salt, and the key the passphrase derived with it. */
interface SyncSetting {
  salt: string
  key: string
}

/** Lens's sealed copy, as GET /api/chat/history-sync answers it; version 0 while it holds none. */
interface Sealed {
  version: number
  salt: string
  iv: string
  ciphertext: string
}

/** Why a sync did not happen, in a sentence the panel shows; status 0 when nothing answered or the browser refused. */
export class SyncError extends ApiError {
  constructor(message: string, status = 0) {
    super(status, SYNC_PATH)
    this.name = 'SyncError'
    this.message = message
  }
}

function readJSON<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? null : (JSON.parse(raw) as T)
  } catch {
    return null
  }
}

/** True when sync is on in this browser for `scope`. */
export function syncIsOn(scope: string): boolean {
  const s = readJSON<SyncSetting>(SETTING_PREFIX + scope)
  return typeof s?.salt === 'string' && typeof s?.key === 'string'
}

/** Stops syncing in this browser. Its conversations stay here; the stored copy stays for the other devices. */
export function turnOffSync(scope: string): void {
  try {
    window.localStorage.removeItem(SETTING_PREFIX + scope)
  } catch {
    // Nothing was stored, so there is nothing to turn off.
  }
}

/** The conversations deleted here, by id, with when. Kept with sync off too, so turning it on later cannot bring them back. */
export function readDeleted(scope: string): Record<string, number> {
  const d = readJSON<Record<string, number>>(DELETED_PREFIX + scope)
  return d !== null && typeof d === 'object' ? d : {}
}

export function recordDeleted(scope: string, id: string, at: number): void {
  writeDeleted(scope, { ...readDeleted(scope), [id]: at })
}

function writeDeleted(scope: string, deleted: Record<string, number>): void {
  try {
    window.localStorage.setItem(DELETED_PREFIX + scope, JSON.stringify(deleted))
  } catch {
    // A refused write is the same refusal history.ts reports for the list itself.
  }
}

function b64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function unb64(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

/** A new stored salt: the KDF and its iterations, then 16 random bytes. */
function newSalt(): string {
  return `pbkdf2-sha256:${ITERATIONS}:${b64(crypto.getRandomValues(new Uint8Array(16)))}`
}

/** The AES-GCM key `passphrase` derives with a stored salt. */
export async function deriveKey(passphrase: string, salt: string): Promise<CryptoKey> {
  const [kdf, iterations, bytes] = salt.split(':')
  if (kdf !== 'pbkdf2-sha256' || !(Number(iterations) > 0) || bytes === undefined) {
    throw new SyncError('The synced copy was sealed in a way this version of Talyvor cannot open.')
  }
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: unb64(bytes), iterations: Number(iterations) },
    material,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  )
}

export async function seal(key: CryptoKey, history: SyncedHistory): Promise<{ iv: string; ciphertext: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plain = new TextEncoder().encode(JSON.stringify(history))
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain))
  return { iv: b64(iv), ciphertext: b64(sealed) }
}

/** Opens a sealed copy; a wrong passphrase's key fails AES-GCM's check and says so. */
export async function unseal(key: CryptoKey, iv: string, ciphertext: string): Promise<SyncedHistory> {
  let plain: ArrayBuffer
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(ciphertext))
  } catch {
    throw new SyncError('That passphrase does not open the synced history.')
  }
  const parsed = JSON.parse(new TextDecoder().decode(plain)) as Partial<SyncedHistory>
  return {
    conversations: Array.isArray(parsed.conversations) ? parsed.conversations.filter((c) => typeof c?.id === 'string' && Array.isArray(c.messages)) : [],
    deleted: parsed.deleted !== null && typeof parsed.deleted === 'object' ? parsed.deleted : {},
  }
}

/** Marks each conversation in `next` that is not the very one `prev` held under its id as changed at `now`. */
export function stampChanged(prev: Conversation[], next: Conversation[], now: number): Conversation[] {
  const before = new Map(prev.map((c) => [c.id, c]))
  return next.map((c) => (before.get(c.id) === c ? c : { ...c, changed_at: now }))
}

/** When a conversation was last changed: a new turn or, B28.365, any other edit. */
export function editedAt(c: Conversation): number {
  return Math.max(c.updated_at, c.changed_at ?? 0)
}

/** Both histories as one: per conversation the later edit, and none deleted at or after its last edit. Newest first. */
export function mergeHistories(a: SyncedHistory, b: SyncedHistory): SyncedHistory {
  const deleted: Record<string, number> = { ...a.deleted }
  for (const [id, at] of Object.entries(b.deleted)) deleted[id] = Math.max(deleted[id] ?? 0, at)
  const byId = new Map<string, Conversation>()
  for (const c of [...a.conversations, ...b.conversations]) {
    const prior = byId.get(c.id)
    if (prior === undefined || editedAt(c) > editedAt(prior)) byId.set(c.id, c)
  }
  const conversations = [...byId.values()]
    .filter((c) => !(deleted[c.id] !== undefined && deleted[c.id] >= editedAt(c)))
    .sort((x, y) => y.updated_at - x.updated_at || (x.id < y.id ? -1 : 1))
  return { conversations, deleted }
}

async function getSealed(): Promise<Sealed> {
  let res: Response
  try {
    res = await fetch(SYNC_PATH, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
  } catch {
    throw new SyncError('Talyvor could not be reached to sync.')
  }
  if (res.status === 404) throw new SyncError('Sync is not available on this deployment yet.', 404)
  const body = (await res.json().catch(() => null)) as (Partial<Sealed> & { error?: string }) | null
  if (!res.ok || body === null || typeof body.version !== 'number') {
    throw new SyncError(typeof body?.error === 'string' ? body.error : `The synced history could not be read (${res.status}).`, res.status)
  }
  return { version: body.version, salt: body.salt ?? '', iv: body.iv ?? '', ciphertext: body.ciphertext ?? '' }
}

/** Stores a sealed copy over `base`; false when another device stored one first. */
async function putSealed(base: number, salt: string, sealed: { iv: string; ciphertext: string }): Promise<boolean> {
  let res: Response
  try {
    res = await fetch(SYNC_PATH, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ base_version: base, salt, ...sealed }),
    })
  } catch {
    throw new SyncError('Talyvor could not be reached to sync.')
  }
  if (res.status === 409) return false
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new SyncError(typeof body?.error === 'string' ? body.error : `The synced history could not be stored (${res.status}).`, res.status)
  }
  return true
}

async function settingKey(s: SyncSetting): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', unb64(s.key), 'AES-GCM', false, ['encrypt', 'decrypt'])
}

/**
 * Syncs `local` (this browser's list) with the stored copy and answers the merged history, or null when sync is off
 * here — in which case nothing was sent anywhere. The merged deletions are kept in this browser; the caller keeps the
 * conversations, merged into whatever its list holds by then.
 */
export async function syncHistory(scope: string, local: Conversation[]): Promise<SyncedHistory | null> {
  const setting = readJSON<SyncSetting>(SETTING_PREFIX + scope)
  if (setting === null || typeof setting.salt !== 'string' || typeof setting.key !== 'string') return null
  const key = await settingKey(setting)
  for (let attempt = 0; attempt < 3; attempt++) {
    const stored = await getSealed()
    let remote: SyncedHistory = { conversations: [], deleted: {} }
    if (stored.version > 0) {
      if (stored.salt !== setting.salt) {
        turnOffSync(scope)
        throw new SyncError('The synced history was set up again with another passphrase. Turn sync on with that one.')
      }
      remote = await unseal(key, stored.iv, stored.ciphertext)
    }
    const merged = mergeHistories({ conversations: local, deleted: readDeleted(scope) }, remote)
    writeDeleted(scope, merged.deleted)
    if (stored.version > 0 && JSON.stringify(merged) === JSON.stringify(mergeHistories(remote, { conversations: [], deleted: {} }))) {
      return merged
    }
    if (await putSealed(stored.version, setting.salt, await seal(key, merged))) return merged
  }
  throw new SyncError('Other devices kept changing the synced history; try again in a moment.')
}

/**
 * Turns sync on in this browser with `passphrase`: the stored copy's, when one is stored, which the passphrase must
 * open; otherwise a new one sealed with it. Then syncs once.
 */
export async function turnOnSync(scope: string, passphrase: string, local: Conversation[]): Promise<SyncedHistory> {
  const stored = await getSealed()
  const salt = stored.version > 0 ? stored.salt : newSalt()
  const key = await deriveKey(passphrase, salt)
  if (stored.version > 0) await unseal(key, stored.iv, stored.ciphertext)
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key))
  try {
    window.localStorage.setItem(SETTING_PREFIX + scope, JSON.stringify({ salt, key: b64(raw) } satisfies SyncSetting))
  } catch {
    throw new SyncError('This browser refused to remember that sync is on.')
  }
  const merged = await syncHistory(scope, local)
  if (merged === null) throw new SyncError('This browser refused to remember that sync is on.')
  return merged
}

/** Deletes the stored copy and stops syncing here. A device still syncing stores its own again when it next syncs. */
export async function deleteSyncedCopy(scope: string): Promise<void> {
  let res: Response
  try {
    res = await fetch(SYNC_PATH, { method: 'DELETE', credentials: 'same-origin', headers: { Accept: 'application/json' } })
  } catch {
    throw new SyncError('Talyvor could not be reached to delete the synced copy.')
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new SyncError(typeof body?.error === 'string' ? body.error : `The synced copy could not be deleted (${res.status}).`, res.status)
  }
  turnOffSync(scope)
}
