import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * A PREMISE READ OUT OF A COMMENT IS NOT A PREMISE THAT HOLDS.
 *
 * ── WHAT THIS IS FOR, AND WHY IT IS NOT expirySubjects.test.ts ───────────────
 *
 * `expirySubjects.test.ts` closes ONE door: it runs `deploy/decision-expiry.sh` with each
 * subject file MOVED ASIDE and fails on any `ok` that survives. That proves a check TOUCHES
 * the file it names. It does not prove the check reads the CODE in that file, and those are
 * different questions — the register's own history says so twice:
 *
 *   · D7's header: "It matched `member-sync` anywhere in apps/bff/*.go, which the test file and
 *     these very comments satisfy — so deleting the production call left the check GREEN."
 *   · D9's header: "THE FIRST DRAFT OF THIS CHECK GREPPED THE WHOLE FILE FOR `assetsDir` AND
 *     VOIDED IMMEDIATELY — on the COMMENT that was added in the same change to warn against
 *     setting it. A guard that cannot tell a mention from a setting reports the documentation
 *     as the defect."
 *
 * Both lessons were learned INSIDE this register and applied to the check that taught them.
 * Neither was applied to the others, and nothing has ever asked.
 *
 * ── MEASURED, NOT REASONED ABOUT (tab-d7q2, 2026-08-28, main 94b9899) ────────
 *
 * Each PRESENCE check's live site was turned into a comment — the file still present, still
 * non-empty, the matched text still there one `// ` to the left — and the register re-run:
 *
 *     D3  compose vars commented       →  VOID   (its pattern anchors after leading space)
 *     D5  stampBuild() commented       →  ok     ⚠ the plugin is GONE and D5 says it is present
 *     D7  the nudge call commented     →  ok     ⚠ the call is GONE and D7 says the BFF makes it
 *     D9  bundleAssetsDir commented    →  VOID   (its pattern is anchored `^const … = "assets"$`)
 *
 * D5 and D7 printed "All locally-checkable premises still hold." For D5 the survivor is the
 * doc comment at the top of apps/web/vite.config.ts that DESCRIBES the plugin; for D7 it is the
 * commented-out call itself, which `grep -qF 'a.nudgeDocsMemberSync('` matches exactly as well
 * as the live one did.
 *
 * ⚠ THE PRODUCT IS DEFENDED IN BOTH CASES, MEASURED RATHER THAN ASSUMED, AND IT IS SAID HERE
 * RATHER THAN LEFT FLATTERING:
 *
 *   · D7 — commenting the whole `if trackWS != ""` block COMPILES (`go build ./...` exit 0,
 *     `go vet` clean) and `TestDocsNudge_FailureDoesNotAbortLogin` then FAILS. Run and read.
 *   · D5 — the mutation this file applies does NOT survive `tsc`: commenting the plugin out
 *     leaves `Plugin`, `bundleVersionPayload` and friends imported and unused. The realistic
 *     removal is the CLEAN one (pipeline entry, definition and the now-dead imports all gone),
 *     and that one typechecks, builds, and is caught one step later: `scripts/build-release.sh
 *     web` exits 1 with "apps/web/dist/version.json is missing … The stamping plugin did not
 *     run." That step is in CI. So D5's blindness costs a deployer a WRONG ANSWER FROM THE
 *     REGISTER, not an unstamped release.
 *
 * What was blind is the REGISTER, whose whole job is to tell a deployer that a documented
 * decision still rests on something true. A gate that is green because it read a paragraph is
 * the failure this register was written to prevent, arriving through its own front door.
 *
 * ── DIRECTION, AND WHY ONLY ONE OF THE TWO IS A RULE HERE ────────────────────
 *
 * A PRESENCE check says `ok` when its pattern is FOUND. A comment satisfying it is a FALSE PASS
 * and nothing else fires. That is the rule below.
 *
 * An ABSENCE check says `ok` when its pattern is NOT found, so a comment mentioning the
 * forbidden thing makes it VOID — CI goes red about a paragraph. That is a real cost and it was
 * measured too (D2, D4, D6 and D8 are all unanchored, D9's vite half strips comments and D1's
 * pattern is anchored), but it fails LOUD: somebody investigates and finds the comment. Making
 * those four quieter is a judgement about a deploy gate, so it is reported and not taken here.
 */

const REPO_ROOT = resolve(import.meta.dirname, '../../..')
const REGISTER_REL = 'deploy/decision-expiry.sh'

/** Same fixture list as expirySubjects.test.ts, and named by literal string for the same reason. */
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
 * EVERY check, classified by what its `ok` means. Exhaustive over OK_MARK — the floor below
 * refuses a new check that has not been classified, because an unclassified check is one this
 * file silently does not police.
 *
 *   presence — `ok` when the pattern is FOUND. A comment that satisfies it is a false PASS.
 *   absence  — `ok` when the pattern is NOT found. A comment that satisfies it is a false VOID:
 *              loud, safe, measured, and deliberately not changed here (see the header).
 */
const DIRECTION: Record<string, 'presence' | 'absence'> = {
  D1: 'absence',
  D2: 'absence',
  D3: 'presence',
  D4: 'absence',
  D5: 'presence',
  D6: 'absence',
  D7: 'presence',
  D8: 'absence',
  D9: 'presence',
}

/**
 * For each PRESENCE check: the file its live site is in, and the literal that identifies the
 * LINES the register matches. Every line of that file containing the literal and not already a
 * comment is turned into one.
 *
 * ⚠ IDENTIFIED BY LITERAL, NEVER BY LINE NUMBER, and never derived from the register — a
 * fixture computed from the thing it tests agrees with that thing in every state, including the
 * broken one. `applied` is asserted below: an anchor that matches nothing would mutate nothing,
 * the check would print `ok` for the honest reason, and this file would score that as a pass.
 */
const LIVE_SITES: {
  check: string
  label: string
  path: string
  anchors: string[]
  comment: string
}[] = [
  {
    check: 'D3',
    label: 'the three sync variables',
    path: 'deploy/track-docs.compose.yaml',
    anchors: ['TRACK_MEMBER_SYNC_SECRET:', 'DOCS_TRACK_MEMBER_SYNC_SECRET:', 'DOCS_TRACK_URL:'],
    comment: '# ',
  },
  {
    check: 'D5',
    label: 'the plugin, definition and pipeline entry',
    path: 'apps/web/vite.config.ts',
    // both live uses. What is left behind is the block comment at the top of the file that
    // DESCRIBES the plugin — the exact text that satisfied the old `grep -q 'stampBuild'`.
    anchors: ['function stampBuild(): Plugin {', 'plugins: [react(), stampBuild()],'],
    comment: '// ',
  },
  {
    check: 'D5',
    // ⚠ A SECOND CASE FOR ONE CHECK, AND IT EXISTS BECAUSE A CONTROL CAME BACK VOID. D5 asserts
    // two clauses — the plugin is DEFINED and it is IN THE PIPELINE — and the case above
    // comments both, so it reds on the first clause alone and says nothing about the second.
    // Removing the pipeline entry while leaving the function defined is the realistic change
    // (a plugin that exists and never runs), and only this case can see it.
    label: 'the pipeline entry only, definition left live',
    path: 'apps/web/vite.config.ts',
    anchors: ['plugins: [react(), stampBuild()],'],
    comment: '// ',
  },
  {
    check: 'D7',
    label: 'the login-time nudge call',
    path: 'apps/bff/auth.go',
    anchors: ['a.nudgeDocsMemberSync('],
    comment: '// ',
  },
  {
    check: 'D9',
    label: 'the bundleAssetsDir pin',
    path: 'apps/bff/lens.go',
    anchors: ['const bundleAssetsDir = "assets"'],
    comment: '// ',
  },
]

/**
 * The MUST-STAY-GREEN companion. A harness that reds whenever a file is edited cannot tell a
 * blind check from a broken sandbox, so one line no check reads is commented out and every
 * `ok` must survive.
 */
const INERT_SITE = {
  path: 'apps/bff/lens.go',
  anchor: 'package main',
  comment: '// x ',
}

const sandboxes: string[] = []

/** Materialise SANDBOX_SOURCES into a fresh temp root, optionally rewriting one file. */
function sandbox(edit?: { path: string; rewrite: (src: string) => string }): {
  root: string
  changed: number
} {
  const root = mkdtempSync(join(tmpdir(), 'expiry-livecode-'))
  sandboxes.push(root)
  let changed = 0
  const put = (rel: string) => {
    const dest = join(root, rel)
    mkdirSync(dirname(dest), { recursive: true })
    if (edit && edit.path === rel) {
      const before = readFileSync(join(REPO_ROOT, rel), 'utf8')
      const after = edit.rewrite(before)
      changed = before === after ? 0 : 1
      writeFileSync(dest, after)
      const mode = statSync(join(REPO_ROOT, rel)).mode
      // the register itself is executable; a rewritten copy has to stay so
      if (mode & 0o111) spawnSync('chmod', ['+x', dest])
      return
    }
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
  return { root, changed }
}

/** Comment out every line holding one of `anchors` that is not already commented. */
const commentOut = (anchors: string[], marker: string) => (src: string) => {
  let hits = 0
  const out = src.split('\n').map((line) => {
    const bare = line.trimStart()
    if (bare.startsWith('//') || bare.startsWith('#') || bare.startsWith('*')) return line
    if (!anchors.some((a) => line.includes(a))) return line
    hits += 1
    return marker + line
  })
  if (hits === 0) return src
  return out.join('\n')
}

function runRegister(root: string): { code: number; text: string } {
  const r = spawnSync('bash', [join(root, REGISTER_REL), '-v'], { cwd: root, encoding: 'utf8' })
  return { code: r.status ?? -1, text: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

const spokeOk = (text: string, check: string) =>
  text.split('\n').some((l) => l.trim().startsWith('ok') && l.includes(OK_MARK[check]))

afterAll(() => {
  for (const root of sandboxes) rmSync(root, { recursive: true, force: true })
})

describe('the register is readable before anything is asked of it', () => {
  const live = runRegister(REPO_ROOT)

  it('exits 0 in this repo with every check green', () => {
    expect(
      live.code,
      'the register is not green on this tree. Every case below asserts an `ok` line is ABSENT ' +
        'after a mutation; against an already-red register those absences would be true for the ' +
        'wrong reason.',
    ).toBe(0)
  })

  it('prints every ok mark this file is written in', () => {
    const missing = Object.keys(OK_MARK).filter((c) => !spokeOk(live.text, c))
    expect(
      missing,
      'these marks match no `ok` line the register prints, so every assertion written in them ' +
        'is "a line that never appears did not appear". Re-anchor OK_MARK on the real wording.',
    ).toEqual([])
  })

  it('classifies every check as presence or absence', () => {
    expect(
      Object.keys(OK_MARK).filter((c) => !DIRECTION[c]),
      'a check exists that this file has not classified, so it is not policed here and nothing ' +
        'says so. Classify it: `presence` if its `ok` means the pattern was FOUND.',
    ).toEqual([])
    expect(
      Object.keys(DIRECTION).filter((c) => !OK_MARK[c]),
      'DIRECTION names a check the register no longer prints an ok line for.',
    ).toEqual([])
  })

  it('declares a live site for every presence check, and for no other', () => {
    const declared = [...new Set(LIVE_SITES.map((s) => s.check))].sort()
    expect(
      declared,
      'a presence check with no declared live site is one this file cannot mutate, and it would ' +
        'read as covered. Both directions are asserted so a check that CHANGES direction is ' +
        'noticed rather than silently dropped.',
    ).toEqual(
      Object.keys(DIRECTION)
        .filter((c) => DIRECTION[c] === 'presence')
        .sort(),
    )
  })

  it('the sandbox reproduces the repo ok set', () => {
    const box = runRegister(sandbox().root)
    const set = (t: string) =>
      t
        .split('\n')
        .filter((l) => l.trim().startsWith('ok'))
        .map((l) => l.trim())
        .sort()
    expect(
      set(box.text),
      'the sandbox disagrees with the repo, so SANDBOX_SOURCES is missing something the ' +
        'register reads and every case below would measure that gap instead.',
    ).toEqual(set(live.text))
    expect(box.code).toBe(0)
  })
})

describe('a presence check cannot be satisfied by a comment', () => {
  for (const site of LIVE_SITES) {
    const run = () =>
      sandbox({ path: site.path, rewrite: commentOut(site.anchors, site.comment) })

    it(`${site.check} (${site.label}) — the anchor matches a live line to begin with`, () => {
      expect(
        run().changed,
        `no un-commented line of ${site.path} contains any of ` +
          `${JSON.stringify(site.anchors)}. The mutation below would then be a no-op, ${site.check} ` +
          'would print `ok` for the honest reason, and this file would score that as a pass — an ' +
          'assertion about a mutation that never happened. Re-anchor on the live site.',
      ).toBe(1)
    })

    it(`${site.check} (${site.label}) — commented out ⇒ no ok line`, () => {
      const { root } = run()
      expect(
        spokeOk(runRegister(root).text, site.check),
        `${site.check}'s live site in ${site.path} is commented out — the code no longer runs — and ` +
          `the register still printed ${JSON.stringify(OK_MARK[site.check])}. It is matching TEXT, ` +
          'not code, so the premise it reports as holding is one it never looked at. D7 and D9 ' +
          'both record this exact failure in their own headers; the fix is the one D9 took — ' +
          'strip comment lines before the grep, or anchor the pattern at the start of the line ' +
          'where a comment marker cannot precede it.',
      ).toBe(false)
    })

    it(`${site.check} (${site.label}) — commented out ⇒ the register exits non-zero`, () => {
      const { root } = run()
      expect(
        runRegister(root).code,
        `with ${site.check}'s live site commented out the register exited 0 and told a deployer ` +
          'that all locally-checkable premises still hold.',
      ).not.toBe(0)
    })
  }

  it('an edit no check reads leaves every ok in place', () => {
    const { root, changed } = sandbox({
      path: INERT_SITE.path,
      rewrite: commentOut([INERT_SITE.anchor], INERT_SITE.comment),
    })
    expect(changed, 'the inert mutation matched nothing, so it controls nothing.').toBe(1)
    const { text, code } = runRegister(root)
    const missing = Object.keys(OK_MARK).filter((c) => !spokeOk(text, c))
    expect(
      missing,
      'commenting a line NO check reads made these checks stop printing ok. The harness is ' +
        'breaking the sandbox rather than measuring the register, and every red above would be ' +
        'true for that reason instead.',
    ).toEqual([])
    expect(code).toBe(0)
  })
})
