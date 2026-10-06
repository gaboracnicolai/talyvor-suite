// B35.8 — the Mac's memory while the testers run: its pressure and its swap, read at the start of the run and every 5
// minutes, for the report to set beside the night's timeouts. While swap is more than three quarters full the run starts
// fewer users at once, down to MIN_WIDTH, so a busy Mac slows the night instead of failing it.

import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

export interface MemorySample {
  at: string
  /** macOS's memory pressure; undefined where it cannot be read. */
  pressure?: 'normal' | 'warn' | 'critical'
  swapUsedMB?: number
  swapTotalMB?: number
  /** How many users the run lets drive a browser at once from this sample on. */
  width: number
}

export type MemoryRead = Pick<MemorySample, 'pressure' | 'swapUsedMB' | 'swapTotalMB'>

export const SAMPLE_EVERY_MS = 5 * 60_000
export const MIN_WIDTH = 5
const SWAP_FULL = 0.75

/** macOS `sysctl -n vm.swapusage`: "total = 9216.00M  used = 7900.25M  free = 1315.75M  (encrypted)". */
export function parseSwapUsage(text: string): { usedMB: number; totalMB: number } | undefined {
  const mb = (name: string): number | undefined => {
    const m = new RegExp(`${name} = ([\\d.]+)([MG])`).exec(text)
    return m === null ? undefined : Number(m[1]) * (m[2] === 'G' ? 1024 : 1)
  }
  const usedMB = mb('used')
  const totalMB = mb('total')
  return usedMB === undefined || totalMB === undefined ? undefined : { usedMB, totalMB }
}

/** macOS `sysctl -n kern.memorystatus_vm_pressure_level`: 1 normal, 2 warn, 4 critical. */
export function parsePressureLevel(text: string): MemorySample['pressure'] {
  return ({ 1: 'normal', 2: 'warn', 4: 'critical' } as const)[Number(text.trim()) as 1 | 2 | 4]
}

/** Linux /proc/meminfo's SwapTotal and SwapFree, in kB. */
export function parseMeminfo(text: string): { usedMB: number; totalMB: number } | undefined {
  const kb = (name: string): number | undefined => {
    const m = new RegExp(`^${name}:\\s+(\\d+) kB`, 'm').exec(text)
    return m === null ? undefined : Number(m[1])
  }
  const total = kb('SwapTotal')
  const free = kb('SwapFree')
  return total === undefined || free === undefined ? undefined : { usedMB: (total - free) / 1024, totalMB: total / 1024 }
}

/**
 * The users the run starts at once after a sample: while swap is more than three quarters full, half as many as now,
 * never fewer than MIN_WIDTH; otherwise the width it was given. A machine whose swap cannot be read keeps that width.
 */
export function nextWidth(now: number, given: number, m: MemoryRead): number {
  if (m.swapUsedMB === undefined || m.swapTotalMB === undefined || !(m.swapTotalMB > 0)) return given
  if (m.swapUsedMB / m.swapTotalMB <= SWAP_FULL) return given
  return Math.min(given, Math.max(MIN_WIDTH, Math.floor(now / 2)))
}

const run = promisify(execFile)

/** This machine's memory now; what cannot be read is left out, never guessed. */
export async function readMemory(): Promise<MemoryRead> {
  if (process.platform === 'darwin') {
    const [swap, level] = await Promise.all([
      run('sysctl', ['-n', 'vm.swapusage']).then((r) => parseSwapUsage(r.stdout), () => undefined),
      run('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level']).then((r) => parsePressureLevel(r.stdout), () => undefined),
    ])
    return { ...(level === undefined ? {} : { pressure: level }), ...(swap === undefined ? {} : { swapUsedMB: swap.usedMB, swapTotalMB: swap.totalMB }) }
  }
  const swap = await readFile('/proc/meminfo', 'utf8').then(parseMeminfo, () => undefined)
  return swap === undefined ? {} : { swapUsedMB: swap.usedMB, swapTotalMB: swap.totalMB }
}
