/**
 * THE SET REACH IS MEASURED AGAINST — derived, never curated.
 *
 * A curated list guards the components someone thought of and says nothing about the others;
 * that is the lesson EmptyStates.test.tsx was written for. So this asks the module graph: every
 * component `@talyvor/ui` exports, and every component every apps/web module exports.
 *
 * ⚠ THIS FILE MUST BE IMPORTED AFTER reachAudit.ts AND NEVER BEFORE IT. It pulls in React, and
 * the hook reachAudit installs has to be in place before react-dom's module init. reachAudit.ts
 * carries the measurement of what happens when the order is wrong (zero commits, silently).
 *
 * ⚠ AN EAGER GLOB IMPORTS EVERY MATCH, SO THE EXCLUSIONS BELONG IN THE PATTERN. Filtering inside
 * the loop is too late: main.tsx calls createRoot at module scope and reddened all 52 test files
 * with "Target container is not a DOM element" while a filter that skipped it sat two lines
 * below the glob.
 *
 * ⚠ COST, MEASURED RATHER THAN ASSUMED: 6.55s / 6.72s without this pair, 7.31s / 7.19s with it,
 * over the full 612-test run on this machine. Setup time rises because every module is loaded up
 * front and collect time falls by nearly as much, because they are then already loaded.
 */
import * as UI from '@talyvor/ui'

import { registerModule } from './reachAudit'

registerModule('packages/ui', UI as unknown as Record<string, unknown>)

const modules = import.meta.glob(
  ['./**/*.tsx', '!./main.tsx', '!./**/*.test.tsx', '!./reachRegistry.tsx'],
  { eager: true },
) as Record<string, Record<string, unknown>>

for (const [path, mod] of Object.entries(modules)) {
  registerModule(`apps/web/${path.replace(/^\.\//, 'src/')}`, mod)
}
