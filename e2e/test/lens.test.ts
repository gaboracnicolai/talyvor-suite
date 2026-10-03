import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { LensClient } from '../src/lens.ts'

// B17.32 — user 146's marketplace use was charged, and the read-back that books it met a Lens answering
// 502: the use went unbooked and the ledger read "4 spend rows for 3 charged answers". A ledger read now
// waits out a restart.

const user = { index: 146, workspaceID: 'ws_146', token: 'tok', expiresAt: '' }
const row = { id: 'tx_1', type: 'spend', amount_ulxc: -470, created_at: '2026-10-03T01:08:26Z' }

let server: Server | undefined
afterEach(() => server?.close())

/** A Lens whose ledger answers `statuses` in turn (200 is the one row), then 200 for good. */
async function lens(statuses: number[]): Promise<{ client: LensClient; asked: () => number }> {
  let asked = 0
  server = createServer((_req, res) => {
    const status = statuses[asked++] ?? 200
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(status === 200 ? JSON.stringify([row]) : '')
  })
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
  const { port } = server.address() as { port: number }
  return { client: new LensClient(`http://127.0.0.1:${port}`, 'key'), asked: () => asked }
}

describe('the ledger read (B17.32)', () => {
  it('waits out a Lens that answers 502 while it restarts, and reads the charge', async () => {
    const { client, asked } = await lens([502, 503])
    expect(await client.ledger(user, 10_000)).toEqual([row])
    expect(asked()).toBe(3)
  })

  it('still fails when Lens is not back within the wait', async () => {
    const { client } = await lens([502, 502, 502, 502])
    await expect(client.ledger(user, 1_500)).rejects.toThrow(/Lens answered 502/)
  })
})

// B17.34 — user 166's seller published while Lens restarted and got the proxy's bare 502, so
// market-bill-refund never reached the refund. The publish is now sent again under its Idempotency-Key.
describe('publishing a listing (B17.34)', () => {
  it('is sent again under the same Idempotency-Key while Lens restarts, and answers the listing', async () => {
    const keys: (string | undefined)[] = []
    server = createServer((req, res) => {
      keys.push(req.headers['idempotency-key'] as string | undefined)
      if (keys.length === 1) return res.writeHead(502).end()
      res.writeHead(201, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id: 'lst_1' }))
    })
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
    const { port } = server.address() as { port: number }
    const client = new LensClient(`http://127.0.0.1:${port}`, 'key')
    const published = await client.publishListing(user, { title: 'Totals', template: 'What is {{a}} + {{b}}?', priceULXC: 1_000_000, model: 'm' }, 10_000)
    expect(published).toMatchObject({ ok: true, status: 201, value: { id: 'lst_1' } })
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).toBe(keys[0])
  })
})
