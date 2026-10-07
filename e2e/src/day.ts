// B28.294 — THE DAY'S ONE CAP. With `--day-cap-usd` (the nightly script sets it to E2E_CAP_USD), a run may spend only what is
// left of that cap in the testers' day — from E2E_NIGHTLY_AT to the next — after every run before it that day, read from
// their results in `--out`. The nightly opens each day with all of it; the light passes (light.ts) share what it left.

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

/** The start of the testers' day `now` is in: the last E2E_NIGHTLY_AT (this machine's clock) at or before it. */
export function dayStart(now: Date, at: string): Date {
  const m = /^(\d{1,2}):(\d{2})$/.exec(at)
  if (m === null || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error(`E2E_NIGHTLY_AT must be HH:MM, got ${at}`)
  const start = new Date(now)
  start.setHours(Number(m[1]), Number(m[2]), 0, 0)
  if (start > now) start.setDate(start.getDate() - 1)
  return start
}

/** What the runs whose results are in `outDir`, started at or after `since`, spent between them. */
export async function spentSince(outDir: string, since: Date): Promise<{ usd: number; runs: number }> {
  const names = await readdir(outDir).catch(() => [] as string[])
  let usd = 0
  let runs = 0
  for (const name of names.filter((n) => /^run-.*\.json$/.test(n))) {
    const r = await readFile(join(outDir, name), 'utf8').then((t) => JSON.parse(t) as { started_at?: string; spent_usd?: number }).catch(() => undefined)
    if (r === undefined || typeof r.spent_usd !== 'number' || !(Date.parse(r.started_at ?? '') >= since.getTime())) continue
    usd += r.spent_usd
    runs++
  }
  return { usd, runs }
}

/** B28.294 — the day's cap, what the day's earlier runs spent of it, and so what this run may spend. */
export interface DayBudget {
  cap_usd: number
  since: string
  spent_before_usd: number
  runs_before: number
}

/** The day's budget for a run starting `now`, read from the results in `outDir`. */
export async function dayBudget(capUSD: number, outDir: string, nightlyAt: string, now: Date): Promise<DayBudget> {
  const since = dayStart(now, nightlyAt)
  const spent = await spentSince(outDir, since)
  return { cap_usd: capUSD, since: since.toISOString(), spent_before_usd: Number(spent.usd.toFixed(6)), runs_before: spent.runs }
}

/** What is left of the day's cap. */
export const leftOf = (d: DayBudget): number => Math.max(0, d.cap_usd - d.spent_before_usd)
