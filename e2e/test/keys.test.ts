import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { capturedLeaks, leaksIn, needlesOf } from '../src/keys.ts'

const key = `tlv_${'ab12'.repeat(16)}`
const needles = needlesOf({ what: 'its API key', value: key })

describe('B28.287 keys-unlisted', () => {
  it('passes a list that shows a key by its prefix, and names a whole key, its secret part, its hash or a stranger shaped like a key', () => {
    expect(leaksIn(JSON.stringify([{ id: 'k1', key_prefix: key.slice(0, 12), last4: key.slice(-4) }]), needles)).toEqual([])
    expect(leaksIn(JSON.stringify({ key }), needles)).toEqual(['its API key whole'])
    expect(leaksIn(JSON.stringify({ secret: key.slice(4) }), needles)).toEqual(['its API key without its prefix'])
    const sha = createHash('sha256').update(key).digest('hex')
    expect(leaksIn(JSON.stringify({ key_hash: sha.toUpperCase() }), needles)).toEqual(['its API key as its SHA-256'])
    expect(leaksIn('{"pool":[{"key":"sk-proj-0123456789abcdefghijKLMN"}]}', needles)).toEqual(['sk-proj-01… (shaped like a key)'])
  })
})

describe('B28.287 keys-not-forwarded', () => {
  it("names each place the upstream received the caller's key, and lets a provider key of Lens's own through", () => {
    const sent = { method: 'POST', url: '/v1/chat/completions', body: '{"model":"e2e-upstream"}',
      headers: [['authorization', 'Bearer sk-proj-lens-own-0123456789abcdef'], ['content-type', 'application/json']] as [string, string][] }
    expect(capturedLeaks(sent, needles)).toEqual([])
    expect(capturedLeaks({ ...sent, headers: [...sent.headers, ['x-talyvor-key', key]], url: `/v1/chat/completions?key=${key}` }, needles))
      .toEqual(['its API key whole in its x-talyvor-key header', 'its API key whole in its address'])
  })
})
