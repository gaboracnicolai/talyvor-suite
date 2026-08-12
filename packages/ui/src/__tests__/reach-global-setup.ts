import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

import type { GlobalSetupContext } from 'vitest/node'

/**
 * This project's half of the reach measurement: clear its shards once per run and hand the
 * workers the directory.
 *
 * ⚠ A SECOND DIRECTORY, NOT A SHARED ONE, AND THE REASON IS THE CLEARING. apps/web's
 * scripts/reach-global-setup.ts clears `apps/web/.reach` at the start of ITS invocation, and
 * `pnpm -r test` runs this project FIRST — so a shared directory would have this project's shards
 * written and then deleted before a single apps/web test ran, and the checker would report every
 * packages/ui-only component as unreached. Two directories, each cleared by its own project, is
 * the only arrangement that does not depend on which order pnpm chooses.
 *
 * ⚠ AND THE CHECKER HOLDS EACH DIRECTORY TO ITS OWN FLOOR. A union with one floor would let the
 * live half vouch for the dead one: apps/web's shards alone satisfy "Button was committed" while
 * this project recorded nothing at all.
 *
 * The `config.root`-not-`import.meta.url` rule is apps/web's and applies unchanged — under vite
 * that URL is a `/@fs/…` address and every write fails with ENOENT under a green run.
 *
 * ⚠ `REACH_SHARD_DIR` IS APPS/WEB'S RULE TOO, AND THIS PROJECT NEEDS IT MORE. check-audit-gate.mjs
 * probes BOTH projects, and its probe run here used to clear this directory as the last act of
 * every root `pnpm test` — which is why `cd apps/web && npm run test` was structurally red
 * afterwards, blaming a DevTools hook that was fine. See apps/web/scripts/reach-global-setup.ts
 * for the measurement.
 */
export default function setup({ provide, config }: GlobalSetupContext): void {
  const dir = resolve(config.root, process.env.REACH_SHARD_DIR ?? '.reach')
  rmSync(dir, { recursive: true, force: true })
  provide('reachDir', dir)
}
