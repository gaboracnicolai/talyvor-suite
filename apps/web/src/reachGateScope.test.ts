import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * THE UNION REACH CHECK IS A WORKSPACE ASSERTION, SO IT RUNS FROM THE WORKSPACE SCRIPT.
 *
 * `scripts/check-audit-reach.mjs` reads TWO shard directories — `apps/web/.reach` and
 * `packages/ui/.reach` — and each is cleared and written only by ITS OWN project's vitest run
 * (see packages/ui/src/__tests__/reach-global-setup.ts). So the check is a claim about a run of
 * BOTH projects, and only a command that runs both can make it.
 *
 * ⚠ MEASURED ON `ed0425d`, WHICH IS WHY THIS FILE EXISTS. It was invoked from `apps/web`'s own
 * `test` script, and a per-package script cannot satisfy its precondition. Both directions were
 * measured on a tree `git status` reported EMPTY:
 *
 *   · RED IT DID NOT CAUSE. `cd apps/web && npm run test` exited 1 with
 *     "FLOOR packages/ui#Button … That project's DevTools hook is not receiving commits" —
 *     a FALSE diagnosis. The hook was fine; `packages/ui/.reach` simply held one shard from
 *     whenever that project last ran. The gate a session most naturally runs, red for a reason
 *     that has nothing to do with its diff, is how a real red gets normalised.
 *
 *   · GREEN IT DID NOT EARN, WHICH IS THE WORSE HALF. With `packages/ui`'s shards freshly written
 *     and then the ONLY test that renders `HoldBar` DELETED from the source, `check-audit-reach`
 *     printed "73 components exported, 73 rendered under the audits in 2 projects" and EXITED 0.
 *     Re-running `packages/ui` alone turned the same script red on the same source. The verdict
 *     about the other project was a function of when that project last ran, never of the code
 *     under test — exactly what .gitignore says the per-run clearing exists to prevent ("a stale
 *     shard would let a run that measured nothing be answered from a run that did"), which the
 *     clearing cannot reach across a project boundary.
 *
 * The rule this pins has two halves and needs both. Asserting only that the root runs it would
 * leave a package free to re-add it; asserting only that no package runs it would be satisfied by
 * deleting the check from the repo altogether.
 *
 * ⚠ THE PACKAGE HALF IS A CENSUS, NOT A PAIR OF NAMED FILES, so a THIRD workspace package added
 * later is covered without anyone remembering this file. A census that finds nothing passes for
 * every value of the repo, so it is held to a floor of package names written as literals —
 * deliberately not derived from the same glob it checks.
 */

const repoRoot = join(__dirname, '../../..')

/** Read as ORDERED text, never as a set: `&&` is what makes the shards fresh. */
function rootTestScript(): string {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
  return pkg.scripts?.test ?? ''
}

/**
 * Every workspace package, from pnpm-workspace.yaml's two globs. `apps/bff` is Go and has no
 * package.json; it is skipped by the readdir rather than by a name this file would have to keep.
 */
function workspacePackages(): { name: string; scripts: Record<string, string> }[] {
  const found: { name: string; scripts: Record<string, string> }[] = []
  for (const group of ['apps', 'packages']) {
    for (const entry of readdirSync(join(repoRoot, group))) {
      let raw: string
      try {
        raw = readFileSync(join(repoRoot, group, entry, 'package.json'), 'utf8')
      } catch {
        continue
      }
      const pkg = JSON.parse(raw)
      found.push({ name: pkg.name ?? `${group}/${entry}`, scripts: pkg.scripts ?? {} })
    }
  }
  return found
}

const CHECK = 'check-audit-reach.mjs'

describe('the union reach check runs where both projects have just run', () => {
  it('the root test script invokes it, so CI cannot lose it silently', () => {
    // ci.yml's web job runs `pnpm test` and nothing else that could carry this check.
    expect(rootTestScript()).toContain(CHECK)
  })

  it('the root test script runs both projects before it', () => {
    const script = rootTestScript()
    const recursive = script.indexOf('pnpm -r test')
    const check = script.indexOf(CHECK)
    expect(recursive).toBeGreaterThanOrEqual(0)
    expect(check).toBeGreaterThan(recursive)
  })

  it('the root test script joins them with && so a red project stops the check', () => {
    // Separate from the order above ON PURPOSE. `pnpm -r test ; node …` satisfies the order and
    // runs the check over the shards a FAILED run left behind, which is the same wrong answer in
    // a different costume — one assertion covering both could not tell them apart.
    const script = rootTestScript()
    expect(script.split(CHECK)[0]).toContain('&&')
  })

  it('no workspace package script invokes it — none of them can satisfy its precondition', () => {
    const offenders = workspacePackages().flatMap((pkg) =>
      Object.entries(pkg.scripts)
        .filter(([, body]) => body.includes(CHECK))
        .map(([script]) => `${pkg.name}#${script}`),
    )
    expect(offenders).toEqual([])
  })

  it('the census reached both packages that exist today', () => {
    // A floor, by literal name: an empty or half-empty census satisfies the rule above for every
    // value of the repo.
    const names = workspacePackages().map((p) => p.name)
    expect(names).toContain('@talyvor/web')
    expect(names).toContain('@talyvor/ui')
  })
})
