import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * A DECISION READ OUT OF A FILE THAT IS NOT THERE IS NOT A DECISION THAT HOLDS.
 *
 * ── WHAT THIS IS FOR ─────────────────────────────────────────────────────────
 *
 * `deploy/decision-expiry.sh` splits its premises in two, and it is emphatic about the split:
 * "Cross-repo premises are reported UNCHECKABLE HERE — never as passes … An expiry register
 * that silently scores a cross-repo premise as 'fine' would be the exact failure it exists to
 * prevent." `settleCommands.test.ts` polices that half — the commands it hands a deployer must
 * be able to say no.
 *
 * This file polices the OTHER half, the one everybody assumed was safe, and it is there that
 * the register was scoring premises as fine without reading them.
 *
 * Most of the local checks are ABSENCE tests: they `grep` a path and VOID when the pattern is
 * found. `grep` cannot tell "the pattern is not in that file" from "there is no such file" —
 * both are exit 1, no output. So for those checks a MISSING SUBJECT reads exactly like a
 * premise in perfect health, and the register prints `ok`.
 *
 * ── MEASURED, NOT REASONED ABOUT ─────────────────────────────────────────────
 *
 * ~/talyvor-queue/w11-expiry-vacuity-census-3f7a.py moved each subject file aside in turn
 * (restored in a `finally`, sha256-verified back) and ran the register. At `9d3d6c8`, SEVEN of
 * the nine locally-checkable decisions reported their premise as HOLDING with the file that
 * premise lives in gone:
 *
 *     removed apps/bff/main.go                 D1 ok   D2 ok   D4 ok      exit 0
 *     removed deploy/track-docs.compose.yaml   D3 ok                      exit 0
 *     removed deploy/README.md                 D6 ok                      exit 0
 *     removed apps/bff/docs_membersync.go      D8 ok                      exit 0
 *     removed apps/web/vite.config.ts          D5 void  D9 ok             exit 1
 *     removed deploy/FULL-STACK-DEPLOY.md      D7 void                    exit 1
 *     removed apps/bff/lens.go                 D9 void                    exit 1
 *
 * Four of those runs exited 0 and printed "All locally-checkable premises still hold."
 *
 * ⚠ D3 IS THE ONE THAT SETTLES WHETHER THIS IS PEDANTRY. It does not merely mis-answer — it
 * ERRORS and is scored as a pass. With the compose fragment gone, `grep -c` writes nothing to
 * stdout, `n` is empty, and `[ "" -ne 3 ]` fails to parse:
 *
 *     decision-expiry.sh: line 122: [: : integer expression expected
 *
 * A non-zero `[` sends the `if` down its ELSE branch, which is `ok "member sync wired — all 3
 * variables present in the fragment"`. The check announced that three variables it never
 * counted are present.
 *
 * ── WHY A MISSING SUBJECT IS A STALE DECISION AND NOT AN UNCHECKABLE ─────────
 *
 * `cannot` exists for premises that live where this repo cannot read. A LOCAL path that has
 * stopped resolving is a different event: the anchor moved. The decision is still documented,
 * the runbook still tells an operator to rely on it, and nothing is watching it any more. That
 * is what `void` is for, and it is what makes CI red.
 *
 * ── THE SHAPE OF THIS TEST, AND THE FLOOR THAT MAKES IT READABLE ─────────────
 *
 * The register is run for real — the same file CI runs, not a re-implementation of its rules.
 * It only ever greps, so it is safe to run against a COPY: each case materialises a sandbox
 * holding the paths below and runs the register there, with one file left out. Nothing under
 * the repo is renamed or deleted, so a killed worker cannot leave the tree in a state a later
 * session has to discover.
 *
 * ⚠ A SANDBOX IS A FIXTURE, AND A FIXTURE SMALLER THAN THE PAGE ANSWERS FOR THE PAGE. Two
 * floors stand under every case below:
 *
 *   · the register must exit 0 in the REAL repo and print all nine `ok` marks. If main is red,
 *     or a mark's wording moved, every "the ok line is gone" assertion below would be true for
 *     the wrong reason — an absence asserted against a line that never appears is not a
 *     measurement.
 *   · the SANDBOX baseline must produce the same `ok` set as the real repo. That is what says
 *     SANDBOX_SOURCES is not missing something the register reads — and it has already earned
 *     its keep: the first draft of this list omitted apps/bff/auth.go, the sandbox voided D7,
 *     and the floor named it.
 *
 * ⚠ WHAT THE SECOND FLOOR CANNOT SEE, STATED RATHER THAN IMPLIED. Before the `subject` gate
 * existed, a file the register only ABSENCE-tests could be missing from the sandbox and the
 * baseline would still match — the vacuity being fixed here is exactly what would hide it.
 * With the gate in place a missing subject voids, so the floor closes; the rule that keeps it
 * closed for a NEWLY added check is `every grep target is a declared subject`, below.
 */

const REPO_ROOT = resolve(import.meta.dirname, '../../..')
const REGISTER_REL = 'deploy/decision-expiry.sh'

/**
 * What the sandbox is built from. Directories are copied shallowly, one level, files only.
 *
 * ⚠ NAMED BY LITERAL STRING, never derived from the register: a fixture computed from the
 * thing it is used to test agrees with that thing for every value of it.
 */
const SANDBOX_SOURCES = ['deploy/', 'apps/bff/', 'apps/web/vite.config.ts']

/** A distinctive slice of each check's `ok` line — the handle every assertion below is written in. */
const OK_MARK: Record<string, string> = {
  D1: 'STEP 3a seed deleted',
  D2: 'DOCS_WORKSPACE_ID is ignored, not refused',
  D3: 'member sync wired',
  D4: 'LENS_WORKSPACE_* inert on the BFF',
  D5: 'bundle stamping present',
  D6: 'no hand-rolled build in the runbook',
  D7: '3a-bis promises login-time membership',
  D8: 'the Docs nudge sends no identity headers',
  D9: 'the BFF excludes /assets/ from the SPA fallback',
}

/**
 * Every path a locally-checkable premise is read out of, and which checks read it.
 *
 * apps/bff/auth.go holds the `a.nudgeDocsMemberSync(` call D7's code half looks for. It is in
 * this table as the MUST-STAY-GREEN companion: D7 globs `apps/bff/*.go` rather than naming a
 * path, so it already fails closed, and a case that was green before this work and after it is
 * what says the harness can tell a register that speaks from one that does not.
 */
const SUBJECTS: { path: string; reads: string[]; gated: boolean }[] = [
  { path: 'apps/bff/main.go', reads: ['D1', 'D2', 'D4'], gated: true },
  { path: 'apps/bff/docs_membersync.go', reads: ['D8'], gated: true },
  { path: 'apps/web/vite.config.ts', reads: ['D5', 'D9'], gated: true },
  { path: 'deploy/README.md', reads: ['D6'], gated: true },
  { path: 'deploy/FULL-STACK-DEPLOY.md', reads: ['D7'], gated: true },
  { path: 'deploy/track-docs.compose.yaml', reads: ['D3'], gated: true },
  { path: 'apps/bff/lens.go', reads: ['D9'], gated: true },
  // NOT gated, and that is a claim the removal case below verifies rather than assumes. D7's
  // code half globs `apps/bff/*.go` for the CALL rather than naming a path, so there is nothing
  // for `subject` to assert and the glob already fails closed. It is here as the MUST-STAY-GREEN
  // companion: green before this work and after it, which is what says the harness can tell a
  // register that speaks from one that does not.
  { path: 'apps/bff/auth.go', reads: ['D7'], gated: false },
]

const sandboxes: string[] = []

/** Materialise SANDBOX_SOURCES into a fresh temp root, omitting one repo-relative path. */
function sandbox(omit?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'expiry-subjects-'))
  sandboxes.push(root)
  const put = (rel: string) => {
    if (rel === omit) return
    const dest = join(root, rel)
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(join(REPO_ROOT, rel), dest)
  }
  for (const src of SANDBOX_SOURCES) {
    if (!src.endsWith('/')) {
      put(src)
      continue
    }
    for (const name of readdirSync(join(REPO_ROOT, src))) {
      const rel = src + name
      if (!statSync(join(REPO_ROOT, rel)).isFile()) continue
      put(rel)
    }
  }
  return root
}

function runRegister(root: string): { code: number; text: string } {
  const r = spawnSync('bash', [join(root, REGISTER_REL), '-v'], {
    cwd: root,
    encoding: 'utf8',
  })
  return { code: r.status ?? -1, text: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

/** The `ok` line for a check, if the register printed one. */
const spokeOk = (text: string, check: string) =>
  text.split('\n').some((l) => l.trim().startsWith('ok') && l.includes(OK_MARK[check]))

afterAll(() => {
  for (const root of sandboxes) rmSync(root, { recursive: true, force: true })
})

describe('the expiry register is readable before anything is asked of it', () => {
  const live = runRegister(REPO_ROOT)

  it('exits 0 in this repo with every check green', () => {
    expect(
      live.code,
      'the register is not green on this tree. Every case below asserts an `ok` line is ABSENT ' +
        'when a subject is missing; against an already-red register those absences would be ' +
        'true for the wrong reason. Fix the register first, then read this file.',
    ).toBe(0)
  })

  for (const check of Object.keys(OK_MARK)) {
    it(`prints ${check}'s ok line, so its absence below means something`, () => {
      expect(
        spokeOk(live.text, check),
        `no \`ok\` line matched ${JSON.stringify(OK_MARK[check])}. This table is how every ` +
          'assertion below is expressed, so a mark that matches nothing turns each of them ' +
          'into "a line that never appears did not appear" — a green run that read nothing. ' +
          'Re-anchor the mark on the wording the register actually prints.',
      ).toBe(true)
    })
  }

  it('produces the same ok set in a sandbox built from SANDBOX_SOURCES', () => {
    const box = runRegister(sandbox())
    const set = (t: string) =>
      t
        .split('\n')
        .filter((l) => l.trim().startsWith('ok'))
        .map((l) => l.trim())
        .sort()
    expect(
      set(box.text),
      'the sandbox disagrees with the repo, which means SANDBOX_SOURCES does not carry ' +
        'everything the register reads. Every case below would then be measuring the gap in ' +
        'this list rather than the gap in the register. Add the missing path here.',
    ).toEqual(set(live.text))
    expect(box.code).toBe(0)
  })
})

/**
 * Every repo-relative path this register greps, taken from its COMMAND lines.
 *
 * Comment lines are dropped first — the file's prose names half the repository, and a rule that
 * cannot tell a mention from a command reports the documentation as the defect (D9's own header
 * records that exact mistake being made here).
 *
 * ⚠ THE `cannot` ENTRIES ALSO CONTAIN `grep`, and their paths are the discriminator rather than
 * a problem: they point at talyvor-track / talyvor-docs checkouts, so resolving against THIS
 * repo drops them. That is the correct answer for the right reason — an upstream path is not a
 * subject this register can gate on, which is why those premises are UNCHECKABLE in the first
 * place. `/dev/null`, `assets/styles-…`, and the site URL fall out the same way.
 *
 * ⚠ THE FIRST VERSION REQUIRED A FILE EXTENSION, AND THE CONTROL IS WHAT SAID SO. C4 of
 * scripts/w11-expiry-subject-controls.py adds an ungated `grep … deploy/Caddyfile` and expects
 * this rule to name it; it did not, because `Caddyfile` has no dot and the pattern demanded
 * `.ext`. A rule written to catch the next unguarded check was blind to a whole shape of path
 * this repo actually contains — deploy/Caddyfile, deploy/Caddyfile.placeholder's neighbour, a
 * Dockerfile, a LICENSE. The token shape is now "contains a slash and resolves to a FILE here",
 * and `isFile` is the half that keeps `apps/bff/` (the directory left behind when the glob
 * `apps/bff/*.go` is truncated at the asterisk) from reading as a target.
 */
function grepTargets(text: string): string[] {
  const out = new Set<string>()
  // ⚠ `cannot` CALLS ARE DROPPED BY NAME NOW, NOT BY THEIR PATHS FAILING TO RESOLVE. The note
  // above says the upstream paths "point at talyvor-track / talyvor-docs checkouts, so resolving
  // against THIS repo drops them" — true, but that is a discriminator by ACCIDENT: any upstream
  // path that happens to also exist here, or any repo-relative path written in an entry's `#`
  // NOTE, is read as a local grep target and reported as an ungated check. MEASURED at 0e6e42a:
  // a note naming apps/web/src/settleCommands.test.ts did exactly that. The calls are
  // backslash-continued, so they are joined before the prefix test — matching how
  // settleCommands.test.ts parses the same file.
  for (const raw of text.replace(/\\\n\s*/g, ' ').split('\n')) {
    const line = raw.trim()
    if (line.startsWith('#') || line.startsWith('cannot ') || !/\bgrep\b/.test(line)) continue
    for (const tok of line.match(/[A-Za-z0-9_][A-Za-z0-9_./-]*/g) ?? []) {
      if (!tok.includes('/')) continue
      const abs = join(REPO_ROOT, tok)
      if (existsSync(abs) && statSync(abs).isFile()) out.add(tok)
    }
  }
  return [...out].sort()
}

/**
 * The paths named by `subject` calls, in command position.
 *
 * ⚠ THE TRAILING `"` IS LOAD-BEARING and was not in the first draft. `subject`'s own diagnostic
 * prints `subject file:  %s`, and a looser pattern read that line as a call and reported the
 * word `file` as a gated path — an extraction that invents a member is the same failure as one
 * that drops one. The call's real signature is `subject <path> "<decision>"`.
 */
function subjectPaths(text: string): string[] {
  const out = new Set<string>()
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('#')) continue
    const m = line.match(/(?:^|[;&|]\s*|\s)subject\s+([A-Za-z0-9_][A-Za-z0-9_./-]*)\s+"/)
    if (m) out.add(m[1])
  }
  return [...out].sort()
}

describe('every local premise the register greps is gated on its subject', () => {
  const text = readFileSync(join(REPO_ROOT, REGISTER_REL), 'utf8')
  const targets = grepTargets(text)
  const gated = subjectPaths(text)

  it('finds the grep targets at all', () => {
    expect(
      targets.length,
      'no repo-relative grep target was extracted from the register. Both rules below are loops ' +
        'over this list, so an empty parse turns them into green runs that read nothing — this ' +
        'floor names a count rather than deriving one from the same parse it polices.',
    ).toBeGreaterThanOrEqual(6)
  })

  it('finds the subject gates at all', () => {
    expect(gated.length, 'no `subject` call was parsed out of the register.').toBeGreaterThanOrEqual(6)
  })

  it('gates every one of them', () => {
    expect(
      targets.filter((t) => !gated.includes(t)),
      'the register greps these paths without first asserting they are there. That is the whole ' +
        'defect this file exists for: `grep` cannot tell "the pattern is not in that file" from ' +
        '"there is no such file", so for an absence test a moved anchor reads as a premise in ' +
        'perfect health. Wrap the check in `subject <path> "<decision>"`.',
    ).toEqual([])
  })

  it('the gated set is exactly the one this file declares, in both directions', () => {
    expect(
      gated,
      'the register gates a path this file does not declare `gated: true` for, or declares one ' +
        'the register no longer gates. Both directions matter: a gate nobody removes the file ' +
        'for is a gate nobody has watched work, and a path that quietly LOSES its gate is the ' +
        'defect this file was written about coming back. Update SUBJECTS deliberately — never ' +
        'by deriving it from the register, which would agree with the register for every value ' +
        'of the register.',
    ).toEqual([...new Set(SUBJECTS.filter((s) => s.gated).map((s) => s.path))].sort())
  })
})

describe('a check cannot report its premise holds when its subject file is gone', () => {
  for (const subject of SUBJECTS) {
    const run = () => runRegister(sandbox(subject.path))

    for (const check of subject.reads) {
      it(`${subject.path} missing ⇒ ${check} does not print ok`, () => {
        const { text } = run()
        expect(
          spokeOk(text, check),
          `${check} reads its premise out of ${subject.path}. With that file gone the register ` +
            `still printed ${JSON.stringify(OK_MARK[check])}. MEASURED at 9d3d6c8 for seven of ` +
            'nine checks: `grep` answers "no match" for a file that does not exist, and for an ' +
            'ABSENCE test no match is the shape of a premise in perfect health. A decision read ' +
            'out of a file that is not there is not a decision that holds — gate the check on ' +
            'the subject (see `subject` in deploy/decision-expiry.sh) so a moved anchor voids ' +
            'instead of passing.',
        ).toBe(false)
      })
    }

    it(`${subject.path} missing ⇒ the register exits non-zero`, () => {
      const { code } = run()
      expect(
        code,
        `with ${subject.path} gone the register exited 0 and printed "All locally-checkable ` +
          'premises still hold." A deploy gate that is green because it could not find the file ' +
          'it was asked about is the failure this register exists to prevent, arriving through ' +
          'its own front door.',
      ).not.toBe(0)
    })
  }
})
