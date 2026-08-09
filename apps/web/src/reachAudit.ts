/**
 * WHICH COMPONENTS THE FIVE DOM AUDITS ACTUALLY REACH.
 *
 * test-setup.ts installs five audits that read the DOM as it is rendered — figure, case, focus,
 * glyph, placeholder — and says so itself: "A surface with no test is audited by nothing." That
 * sentence has been true and unmeasured. Every "MEASURED CLEAN" this item has recorded is a
 * statement about the components some test happened to render, and nothing anywhere asked which
 * ones those are.
 *
 * ⚠ THE PREVIOUS PASS STATED THE LIMIT AND PRESCRIBED THE WRONG INSTRUMENT, WHICH IS THE PART
 * WORTH KEEPING. It measured that every surface component is inside the test IMPORT closure (35
 * of 35), said plainly that "imported is not rendered", and recommended `@vitest/coverage-v8` —
 * "it is one dependency away". Installed and run at `aa0421b`: v8 coverage reported 60 files,
 * ALL of them apps/web, and NOT ONE file from packages/ui — while Overview.tsx, which it did
 * report, imports Card, CardHeader, MuNumeral, Pill and Row from `@talyvor/ui` on its third
 * line. The recommended instrument is blind to the whole package the design system lives in, so
 * it could not have answered the question it was recommended for. A prescription in a comment is
 * not a tested prescription.
 *
 * So this asks React directly. The DevTools global hook receives every commit; walking the fiber
 * tree gives the component functions that were actually mounted, which is the thing the audits
 * see and the thing "reach" means.
 *
 * ⚠ ORDER IS LOAD-BEARING AND THIS FILE MUST STAY IMPORT-POOR. React reads
 * `__REACT_DEVTOOLS_GLOBAL_HOOK__` ONCE, at react-dom's own module init. The first version of
 * this file imported `@talyvor/ui` at the top to build its identity table; ES imports are
 * evaluated before the module body, react-dom came in with it, and the hook was installed
 * against a React that had already read the global. MEASURED: zero commits recorded across 612
 * passing tests — a silent zero, not an error. The identity table therefore lives in a SECOND
 * file (reachRegistry.ts) imported after this one.
 *
 * ⚠ IDENTITY, NEVER NAME. An earlier version keyed on `fiber.type.name` and recorded `Button2`:
 * the transform renames a component when its name collides in scope, so a name-keyed table
 * reports a rendered component as unrendered. Identity is exact and cannot be renamed.
 *
 * ⚠ SHARDS, NOT ONE FILE. Each test file gets its own worker with its own module registry, so
 * there is no shared memory to accumulate into and no single process that sees the whole run.
 * Each worker writes what it saw; scripts/check-audit-reach.mjs unions them afterwards. That
 * script owns the classification table and the floors — including the floor that fails when this
 * instrument recorded nothing at all, which is the state a broken hook is otherwise
 * indistinguishable from.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

declare module 'vitest' {
  interface ProvidedContext {
    /** Absolute path to the shard directory, resolved from the project root and provided by
     *  scripts/reach-global-setup.ts. NEVER derived here: under vite `import.meta.url` is a
     *  `/@fs/…` address and resolving against it made every write fail with ENOENT under a
     *  green run. */
    reachDir: string
  }
}

/**
 * A React component, as opposed to a plain value a module happens to export.
 *
 * Functions must be capitalised — a module's exported helpers (`formatUSD`, `caseSafeRuns`) are
 * functions too and are not components. Objects must carry `$$typeof`, which is how forwardRef
 * and memo wrappers identify themselves; that is what excludes `queryClient`, `tokens`, `preset`
 * and a plain `DEFAULT_VIEW` object, each of which an earlier version of this registry counted
 * as a component that never rendered.
 */
export function isComponentExport(name: string, value: unknown): boolean {
  if (typeof value === 'function') return /^[A-Z]/.test(name)
  if (value && typeof value === 'object') {
    return typeof (value as { $$typeof?: unknown }).$$typeof === 'symbol'
  }
  return false
}

/** Walk a fiber tree iteratively, visiting every node's `type`.
 *
 *  ⚠ ITERATIVE, NOT RECURSIVE. A component tree is as deep as the product gets; an instrument
 *  that can throw on a deep enough surface would report that surface as unreached. */
export function walkFiber(root: unknown, onType: (type: unknown) => void): void {
  const stack: unknown[] = [root]
  while (stack.length > 0) {
    const fiber = stack.pop() as { type?: unknown; child?: unknown; sibling?: unknown } | null
    if (!fiber) continue
    onType(fiber.type)
    if (fiber.child) stack.push(fiber.child)
    if (fiber.sibling) stack.push(fiber.sibling)
  }
}

export interface ReachRecord {
  registerModule(where: string, mod: Record<string, unknown>): void
  registerComponent(where: string, name: string, value: unknown): void
  /** Record a fiber type as committed. Returns true only the FIRST time, so the caller can tell
   *  whether anything changed without diffing the set. */
  note(type: unknown): boolean
  registered(): string[]
  committed(): string[]
}

/** ⚠ A FACTORY, NOT ONLY A SINGLETON. The singleton below is shared with every module in the
 *  worker, so a unit test that registered a fixture into it would add that fixture to the shard
 *  the checker then reads — the test would invent an unaudited component. Tests build their own. */
export function createReachRecord(): ReachRecord {
  const identities = new Map<unknown, string>()
  const committed = new Set<string>()
  return {
    registerComponent(where, name, value) {
      if (!isComponentExport(name, value)) return
      // First registration wins, so a component re-exported through an index is named where it
      // is defined rather than wherever it is mentioned again.
      if (!identities.has(value)) identities.set(value, `${where}#${name}`)
    },
    registerModule(where, mod) {
      for (const [name, value] of Object.entries(mod)) this.registerComponent(where, name, value)
    },
    note(type) {
      const hit = identities.get(type)
      if (hit === undefined || committed.has(hit)) return false
      committed.add(hit)
      return true
    },
    registered: () => [...identities.values()].sort(),
    committed: () => [...committed].sort(),
  }
}

const record = createReachRecord()

export function registerModule(where: string, mod: Record<string, unknown>): void {
  record.registerModule(where, mod)
}

/**
 * ⚠ WRITTEN UNCONDITIONALLY, EVEN WHEN NOTHING WAS RECORDED. An earlier version skipped the write
 * when no component had been committed — so blinding the hook produced NO SHARDS, and the checker
 * reported "the directory does not exist" instead of "Button was registered and never committed".
 * Both are red, but only the second names what actually broke. An instrument that reports its own
 * silence as absence of a file makes every diagnosis one step longer.
 */
export function flushReach(dir: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    resolve(dir, `${process.pid}.json`),
    JSON.stringify({ registered: record.registered(), committed: record.committed() }),
  )
}

export function installReachAudit(): void {
  const g = globalThis as Record<string, unknown>
  if (g.__REACT_DEVTOOLS_GLOBAL_HOOK__) return
  g.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    isDisabled: false,
    supportsFiber: true,
    renderers: new Map(),
    inject: () => 1,
    checkDCE: () => {},
    onScheduleFiberRoot: () => {},
    onCommitFiberUnmount: () => {},
    onPostCommitFiberRoot: () => {},
    onCommitFiberRoot: (_id: number, root: { current?: unknown }) => {
      walkFiber(root?.current, (type) => {
        record.note(type)
      })
    },
  }
}

installReachAudit()
