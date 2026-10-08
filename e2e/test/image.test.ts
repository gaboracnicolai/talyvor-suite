import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { PNG_MARGIN, PNG_SCALE, numberPNG } from '../src/scenarios.ts'

describe('B28.379 — the PNG image-in-chat attaches', () => {
  it('shows the digits in its pixels, black on white, square for square', () => {
    const png = numberPNG('42')
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    const chunks = new Map<string, Buffer>()
    for (let at = 8; at < png.length; at += 12 + png.readUInt32BE(at)) chunks.set(png.toString('latin1', at + 4, at + 8), png.subarray(at + 8, at + 8 + png.readUInt32BE(at)))
    const [w, h] = [chunks.get('IHDR')!.readUInt32BE(0), chunks.get('IHDR')!.readUInt32BE(4)]
    expect([w, h]).toEqual([(2 * 6 - 1 + 2 * PNG_MARGIN) * PNG_SCALE, (7 + 2 * PNG_MARGIN) * PNG_SCALE])
    const raw = inflateSync(chunks.get('IDAT')!)
    const square = (gx: number, gy: number) => raw[(gy * PNG_SCALE + PNG_SCALE / 2) * (w + 1) + 1 + gx * PNG_SCALE + PNG_SCALE / 2] === 0 ? '1' : '0'
    const rows = Array.from({ length: 7 }, (_, y) => Array.from({ length: 11 }, (_, x) => square(x + PNG_MARGIN, y + PNG_MARGIN)).join(''))
    // A 4 and a 2, a white column between them.
    expect(rows).toEqual([
      '00010001110',
      '00110010001',
      '01010000001',
      '10010000010',
      '11111000100',
      '00010001000',
      '00010011111',
    ])
    expect(square(0, 0)).toBe('0')
  })
})
