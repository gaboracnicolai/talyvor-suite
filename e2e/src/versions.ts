// B34.2 — WHAT WAS TESTED: the harness's commit, Lens's main at lens-src, and the versions production says it
// runs (the app's /api/version and Lens's /healthz). Every report and TESTERS.md entry names all three, so a
// night that tested old code, or production that moved under a run, is plain to whoever reads it.

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'

export interface Versions {
  /** The harness checkout's commit (short), or why it could not be read. */
  harness: string
  /** Lens's main as checked out at lens-src (short), or why there is none. */
  lens_src: string
  /** The commit the app's /api/version names, or why it could not be read. */
  app: string
  /** The version Lens's /healthz names, or why it could not be read. */
  lens: string
}

const firstLine = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split('\n')[0]

/** The commit `dir` is checked out at, short; or why not. */
export async function commitOf(dir: string): Promise<string> {
  if (dir === 'none') return 'none (--lens-src none)'
  if (!existsSync(dir)) return `none: there is no checkout at ${dir}`
  try {
    const { stdout } = await promisify(execFile)('git', ['-C', dir, 'rev-parse', '--short=7', 'HEAD'], { timeout: 30_000 })
    return stdout.trim()
  } catch (e) {
    const stderr = (e as { stderr?: string }).stderr?.trim()
    return `not read at ${dir}: ${stderr !== undefined && stderr !== '' ? stderr.split('\n')[0] : firstLine(e)}`
  }
}

/** One field of a JSON document at `url`, short when it is a commit; or why it could not be read. */
async function versionAt(url: string, field: 'commit' | 'version'): Promise<string> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return `not read: ${url} answered ${res.status}`
    const v = ((await res.json()) as Record<string, unknown>)[field]
    if (typeof v !== 'string' || v === '') return `not read: ${url} names no ${field}`
    return /^[0-9a-f]{8,40}$/.test(v) ? v.slice(0, 7) : v
  } catch (e) {
    return `not read: ${url}: ${firstLine(e)}`
  }
}

/** What production runs now: the app's /api/version and Lens's /healthz. */
export async function productionVersions(appURL: string, lensURL: string): Promise<Pick<Versions, 'app' | 'lens'>> {
  const [app, lens] = await Promise.all([versionAt(`${appURL}/api/version`, 'commit'), versionAt(`${lensURL}/healthz`, 'version')])
  return { app, lens }
}

export async function readVersions(repo: string, lensSrc: string, appURL: string, lensURL: string): Promise<Versions> {
  const [harness, lens_src, prod] = await Promise.all([commitOf(repo), commitOf(lensSrc), productionVersions(appURL, lensURL)])
  return { harness, lens_src, ...prod }
}

/** One production version, and what it became when a deploy landed during the run. */
const moved = (before: string, after: string | undefined): string =>
  after === undefined || after === before ? before : `${before} → ${after} (deployed during the run)`

/** The three versions in one line; `after` is production read again at the end of the run. */
export function versionsLine(v: Versions, after?: Pick<Versions, 'app' | 'lens'>): string {
  return `harness ${v.harness}; Lens's main at lens-src ${v.lens_src}; production app ${moved(v.app, after?.app)} (/api/version), ` +
    `Lens ${moved(v.lens, after?.lens)} (/healthz)`
}
