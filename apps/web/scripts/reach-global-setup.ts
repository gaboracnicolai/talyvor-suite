import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

import type { GlobalSetupContext } from 'vitest/node'

/**
 * Clear the reach shards ONCE per run, before any worker starts, and hand the workers the
 * directory to write into.
 *
 * ⚠ THE DIRECTORY IS PROVIDED, NEVER DERIVED FROM `import.meta.url`. Under vite that URL is
 * `/@fs/Users/…`, a vite-internal address and not a filesystem path: the first version resolved
 * `.reach` against it and every worker's write failed with ENOENT while 612 tests reported
 * green. `config.root` is the resolved project root and is the only address here that is a real
 * one.
 *
 * ⚠ CLEARING IS NOT TIDINESS. A stale shard is the exact failure this instrument exists to make
 * impossible: if the workers wrote nothing this run — a hook installed too late, a registry that
 * registered nothing — last run's files would still be on disk and check-audit-reach.mjs would
 * union them into a green answer about a run that measured nothing. Clearing here rather than in
 * the `test` script means every invocation of vitest gets it, including a single-file run and
 * watch mode.
 *
 * ⚠ A SINGLE-FILE RUN THEREFORE LEAVES A PARTIAL RECORD, and the checker fails LOUDLY on it
 * rather than reporting most of the product unreached as if that were news. It is chained after
 * the full run in the `test` script and nowhere else.
 */
export default function setup({ provide, config }: GlobalSetupContext): void {
  const dir = resolve(config.root, '.reach')
  rmSync(dir, { recursive: true, force: true })
  provide('reachDir', dir)
}
