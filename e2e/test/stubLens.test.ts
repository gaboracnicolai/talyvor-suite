import { type ChildProcess, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MODERATOR_READS, READS, Reader, type Recorded, drift, fill, moderatorHeaders, shapeOf } from '../selftest/lens-shapes.ts'

// B26.24 — the stub Lens answers every read the self-test makes in the shape a real Lens answers it,
// as recorded in selftest/lens-shapes.json (selftest/record-lens-shapes.ts).

const recorded = JSON.parse(readFileSync(new URL('../selftest/lens-shapes.json', import.meta.url), 'utf8')) as Recorded

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number }
      s.close(() => resolve(port))
    })
  })
}

describe('the stub Lens (B26.24)', () => {
  let stub: ChildProcess
  let read: (path: string) => Promise<{ status: number; json: unknown }>

  beforeAll(async () => {
    const port = await freePort()
    stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
      env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'shapes-key', STUB_MODERATOR_KEY: 'tlv_mod_shapes', STUB_BREAK: '' },
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    await new Promise<void>((resolve, reject) => {
      stub.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
      stub.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
    })
    const lens = new Reader(`http://127.0.0.1:${port}`, 'shapes-key')
    const { ws, token } = await lens.workspace()
    const agent = await lens.seed(ws, token)
    read = (path) => MODERATOR_READS.includes(path)
      ? lens.send('tlv_mod_shapes', 'GET', path, undefined, moderatorHeaders('tlv_mod_shapes'))
      : lens.send(token, 'GET', fill(path, ws, agent))
  })
  afterAll(() => {
    stub?.kill()
  })

  it('has a recorded answer for every read', () => {
    expect([...READS, ...MODERATOR_READS].filter((p) => recorded.reads[p] === undefined)).toEqual([])
  })

  it.each([...READS, ...MODERATOR_READS])('answers %s as Lens does', async (path) => {
    const lens = recorded.reads[path]
    const a = await read(path)
    expect(a.status, JSON.stringify(a.json)).toBe(lens.status)
    if (lens.shape !== undefined) expect(drift(lens.shape, shapeOf(a.json))).toEqual([])
  })
})
