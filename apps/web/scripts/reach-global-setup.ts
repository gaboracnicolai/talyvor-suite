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
 *
 * ⚠ AND THAT IS WHY `REACH_SHARD_DIR` EXISTS. The clearing above is unconditional, so ANY vitest
 * run in this project destroys the record — including the two single-file probe runs
 * check-audit-gate.mjs performs at the END of the same `test` script. MEASURED at `ed0425d`: a
 * full run left 93 shards and 904 committed entries here and 11/19 in packages/ui, and after
 * `node scripts/check-audit-gate.mjs` both directories held ONE shard and ZERO committed entries.
 * The gate's probe is a legitimate vitest run; it just must not write here. It sets this variable
 * to a throwaway directory, which this setup clears and hands out instead — so the probe still
 * gets the same treatment and the evidence of the real run survives it.
 */
export default function setup({ provide, config }: GlobalSetupContext): void {
  const dir = resolve(config.root, process.env.REACH_SHARD_DIR ?? '.reach')
  rmSync(dir, { recursive: true, force: true })
  provide('reachDir', dir)
}
