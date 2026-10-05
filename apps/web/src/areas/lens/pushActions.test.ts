// B28.38 — Approve and Deny in the push notification. public/sw.js runs here in a service worker's
// shape: its listeners, the registration's notifications, the window clients and fetch.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const SW = readFileSync(resolve(import.meta.dirname, '../../../public/sw.js'), 'utf8')

function worker(fetchStatus: number) {
  const listeners: Record<string, (e: unknown) => void> = {}
  const shown: { title: string; options: { tag?: string; data?: unknown; icon?: string; badge?: string; actions?: { action: string }[] } }[] = []
  const fetch = vi.fn(async () => ({ ok: fetchStatus < 300, status: fetchStatus }))
  const openWindow = vi.fn(async () => undefined)
  const self = {
    addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn),
    registration: { showNotification: async (title: string, options: (typeof shown)[number]['options']) => void shown.push({ title, options }) },
    clients: { matchAll: async () => [], openWindow },
  }
  runInNewContext(SW, { self, fetch, encodeURIComponent })
  const fire = async (type: string, e: object) => {
    let done: Promise<unknown> = Promise.resolve()
    listeners[type]({ ...e, waitUntil: (p: Promise<unknown>) => (done = p) })
    await done
  }
  const push = (payload: object) => fire('push', { data: { json: () => payload } })
  const tap = (action: string) => {
    const n = shown[0]
    return fire('notificationclick', { action, notification: { title: n.title, data: n.options.data, close: () => {} } })
  }
  return { shown, fetch, openWindow, push, tap }
}

const LENS_PUSH = { type: 'agent_approval', approval_id: 'apr_7', agent_name: 'Researcher', amount_lxc: '2', reason: 'a request to gpt-5' }

describe('the approval push (B28.38)', () => {
  it('carries Approve and Deny', async () => {
    const sw = worker(200)
    await sw.push(LENS_PUSH)
    expect(sw.shown[0].title).toBe('Researcher asks you to approve 2 LXC')
    expect(sw.shown[0].options.actions?.map((a) => a.action)).toEqual(['approve', 'deny'])
  })

  it('Approve decides the approval from the service worker, without opening the app', async () => {
    const sw = worker(200)
    await sw.push(LENS_PUSH)
    await sw.tap('approve')
    expect(sw.fetch).toHaveBeenCalledWith('/api/agents/approvals/apr_7/approve', expect.objectContaining({ method: 'POST', credentials: 'same-origin' }))
    expect(sw.openWindow).not.toHaveBeenCalled()
    expect(sw.shown[1]).toMatchObject({ title: 'Approved: Researcher, 2 LXC', options: { tag: 'apr_7' } })
  })

  it('a decision Lens refuses (a passkey is needed) opens the app on Approvals instead', async () => {
    const sw = worker(403)
    await sw.push(LENS_PUSH)
    await sw.tap('deny')
    expect(sw.fetch).toHaveBeenCalledWith('/api/agents/approvals/apr_7/deny', expect.anything())
    expect(sw.openWindow).toHaveBeenCalledWith('/approvals')
    expect(sw.shown).toHaveLength(1)
  })

  it('B29.14 — the push and the notification after a decision carry the app icon as icon and badge', async () => {
    const sw = worker(200)
    await sw.push(LENS_PUSH)
    await sw.tap('approve')
    for (const n of sw.shown) expect(n.options).toMatchObject({ icon: '/icon-192.png', badge: '/icon-192.png' })
    expect(sw.shown).toHaveLength(2)
  })
})
