import { createPublicKey, verify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { type Receipt, canonicalPayload, nodeKey } from '../src/economy.ts'

const receipt: Receipt = {
  request_id: 'req-1', node_id: 'node-é', workspace_id: 'ws1', model: 'm', input_tokens: 12, output_tokens: 8,
  merkle_root: Array.from({ length: 32 }, (_, i) => (i * 7) % 256), timestamp: 1_759_800_000, leaf_count: 8,
}

describe('PoVI receipts signed as a node signs them (B34.8)', () => {
  it("lays a receipt out byte for byte as Lens's CanonicalPayload does", () => {
    // talyvor-lens internal/povi.CanonicalPayload of the same receipt, printed by Go.
    expect(canonicalPayload(receipt).toString('hex')).toBe('000000057265712d31000000076e6f64652dc3a900000003777331000000016d000000000000000c000000000000000800070e151c232a31383f464d545b626970777e858c939aa1a8afb6bdc4cbd2d90000000068e46ac00000000000000008')
  })

  it('signs it with a key whose public half Lens can decode and verify against', () => {
    const k = nodeKey()
    const raw = Buffer.from(k.pub, 'base64')
    expect(raw).toHaveLength(32)
    const pub = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' })
    const signed = k.signed(receipt)
    expect(verify(null, canonicalPayload(receipt), pub, Buffer.from(signed.signature, 'base64'))).toBe(true)
    expect(verify(null, canonicalPayload({ ...receipt, output_tokens: 9 }), pub, Buffer.from(signed.signature, 'base64'))).toBe(false)
  })
})
