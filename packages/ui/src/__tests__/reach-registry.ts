/**
 * THE SET THIS PROJECT'S REACH IS MEASURED AGAINST — the package's own exports, derived.
 *
 * ⚠ THIS FILE MUST BE IMPORTED AFTER reachAudit AND NEVER BEFORE IT. It pulls in React, and the
 * DevTools hook reachAudit installs has to be in place before react-dom's module init.
 * apps/web/src/reachAudit.ts carries the measurement of what happens when the order is wrong:
 * zero commits, silently, across a whole green run. The split into two files exists for that.
 *
 * ⚠ NO GLOB HERE, unlike apps/web's registry. This project's components are all re-exported
 * through `src/index.ts` — components/index.ts names every file in components/ — so the package
 * import IS the complete set, and a glob would additionally register the fixtures and the test
 * helpers as if they were product.
 */
import * as UI from '../index'

import { registerModule } from '../../../../apps/web/src/reachAudit'

registerModule('packages/ui', UI as unknown as Record<string, unknown>)
