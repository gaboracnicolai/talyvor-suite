import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Conversation } from './history'
import { SyncError, recordDeleted, stampChanged, syncHistory, turnOnSync } from './historySync'

// B28.365 — what talyvor-lens's /v1/workspaces/{ws}/chat-history (B28.107) is to the browser, through the BFF's
// /api/chat/history-sync: one sealed copy, versioned, stored over the version it was read at or refused with 409.
function fakeLens() {
  const stored = { version: 0, salt: '', iv: '', ciphertext: '' }
  const calls: string[] = []
  let beforePut: (() => void) | undefined
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${url}`)
    if (method === 'GET') return new Response(JSON.stringify(stored), { status: 200 })
    if (method === 'PUT') {
      const run = beforePut
      beforePut = undefined
      run?.()
      const body = JSON.parse(String(init?.body)) as { base_version: number; salt: string; iv: string; ciphertext: string }
      if (body.base_version !== stored.version) return new Response(JSON.stringify({ error: 'stale' }), { status: 409 })
      Object.assign(stored, { version: stored.version + 1, salt: body.salt, iv: body.iv, ciphertext: body.ciphertext })
      return new Response(JSON.stringify({ version: stored.version }), { status: 200 })
    }
    return new Response(null, { status: 404 })
  })
  return { stored, calls, fetchMock, interleave: (f: () => void) => (beforePut = f) }
}

// Each device is its own browser: its own localStorage, the same signed-in person.
const devices = new Map<string, Record<string, string>>()
function onDevice(name: string): void {
  window.localStorage.clear()
  for (const [k, v] of Object.entries(devices.get(name) ?? {})) window.localStorage.setItem(k, v)
}
function leaveDevice(name: string): void {
  const snapshot: Record<string, string> = {}
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i)!
    snapshot[k] = window.localStorage.getItem(k)!
  }
  devices.set(name, snapshot)
}

const SCOPE = 'user-sub-1'
const PASSPHRASE = 'correct horse battery'

function conversation(id: string, question: string, at: number): Conversation {
  return { id, title: question, renamed: false, model_id: 'claude-haiku-4-5', created_at: at, updated_at: at,
    messages: [{ role: 'user', content: question }, { role: 'assistant', content: 'Here is a plan.' }] }
}

describe('history sync', () => {
  let lens: ReturnType<typeof fakeLens>
  beforeEach(() => {
    devices.clear()
    window.localStorage.clear()
    lens = fakeLens()
    vi.stubGlobal('fetch', lens.fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('a chat made on one device appears on another, and Lens holds only what it cannot read', async () => {
    onDevice('laptop')
    const laptop = [conversation('c1', 'Plan the Lisbon offsite for twelve people', 1000)]
    await turnOnSync(SCOPE, PASSPHRASE, laptop)
    leaveDevice('laptop')
    expect(lens.stored.version).toBe(1)
    expect(atob(lens.stored.ciphertext)).not.toContain('Lisbon')
    expect(lens.stored.ciphertext).not.toContain('Lisbon')

    onDevice('phone')
    const phone = await turnOnSync(SCOPE, PASSPHRASE, [])
    expect(phone.conversations.map((c) => c.messages[0].content)).toEqual(['Plan the Lisbon offsite for twelve people'])
    leaveDevice('phone')

    // Another passphrase opens nothing, and leaves sync off on that device.
    onDevice('tablet')
    await expect(turnOnSync(SCOPE, 'not the passphrase', [])).rejects.toThrow(SyncError)
    expect(await syncHistory(SCOPE, [])).toBeNull()
  }, 30_000)

  it('off, it stays local: a device that never turned sync on sends nothing', async () => {
    onDevice('desk')
    expect(await syncHistory(SCOPE, [conversation('c9', 'A private question', 1000)])).toBeNull()
    expect(lens.calls).toEqual([])
  })

  it('a rename and a deletion travel, and a copy another device stored meanwhile is merged rather than overwritten', async () => {
    onDevice('laptop')
    const both = [conversation('c1', 'First', 1000), conversation('c2', 'Second', 2000)]
    await turnOnSync(SCOPE, PASSPHRASE, both)
    leaveDevice('laptop')
    const v1 = { ...lens.stored }

    // The phone adds c3 and stores it as v2 — which, below, lands between the laptop's read and its write.
    onDevice('phone')
    await turnOnSync(SCOPE, PASSPHRASE, [])
    const phoneList = [...both, conversation('c3', 'Third', 2500)]
    await syncHistory(SCOPE, phoneList)
    leaveDevice('phone')
    const v2 = { ...lens.stored }
    expect(v2.version).toBe(2)
    Object.assign(lens.stored, v1)

    // The laptop renames c1 and deletes c2, reading v1 and storing over it after the phone's v2 arrived: Lens's 409.
    onDevice('laptop')
    const renamed = stampChanged(both, [{ ...both[0], title: 'Offsite', renamed: true }], 3000)
    recordDeleted(SCOPE, 'c2', 3000)
    lens.interleave(() => Object.assign(lens.stored, v2))
    const laptop = await syncHistory(SCOPE, renamed)
    expect(lens.calls.slice(-4)).toEqual(['GET /api/chat/history-sync', 'PUT /api/chat/history-sync', 'GET /api/chat/history-sync', 'PUT /api/chat/history-sync'])
    expect(lens.stored.version).toBe(3)
    expect(laptop?.conversations.map((c) => `${c.id}:${c.title}`)).toEqual(['c3:Third', 'c1:Offsite'])
    leaveDevice('laptop')

    onDevice('phone')
    const phone = await syncHistory(SCOPE, phoneList)
    expect(phone?.conversations.map((c) => `${c.id}:${c.title}`)).toEqual(['c3:Third', 'c1:Offsite'])
  }, 30_000)
})
