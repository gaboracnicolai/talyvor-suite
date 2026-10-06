import { describe, expect, it } from 'vitest'
import { MIN_WIDTH, nextWidth, parseMeminfo, parsePressureLevel, parseSwapUsage } from '../src/memory.ts'

describe("the Mac's memory (B35.8)", () => {
  it('reads macOS swap and pressure, and Linux swap', () => {
    expect(parseSwapUsage('total = 9216.00M  used = 7900.25M  free = 1315.75M  (encrypted)')).toEqual({ usedMB: 7900.25, totalMB: 9216 })
    expect(parseSwapUsage('total = 2.00G  used = 1.50G  free = 0.50G')).toEqual({ usedMB: 1536, totalMB: 2048 })
    expect(parsePressureLevel('4\n')).toBe('critical')
    expect(parsePressureLevel('1')).toBe('normal')
    expect(parseMeminfo('MemTotal: 100 kB\nSwapTotal:       2097152 kB\nSwapFree:         524288 kB\n')).toEqual({ usedMB: 1536, totalMB: 2048 })
  })

  it('starts half as many users at once while swap is more than three quarters full, down to 5, and all of them again after', () => {
    const full = { swapUsedMB: 7900, swapTotalMB: 9216 }
    expect(nextWidth(20, 20, full)).toBe(10)
    expect(nextWidth(10, 20, full)).toBe(MIN_WIDTH)
    expect(nextWidth(MIN_WIDTH, 20, full)).toBe(MIN_WIDTH)
    expect(nextWidth(3, 3, full)).toBe(3)
    expect(nextWidth(5, 20, { swapUsedMB: 6000, swapTotalMB: 9216 })).toBe(20)
    expect(nextWidth(20, 20, {})).toBe(20)
  })
})
