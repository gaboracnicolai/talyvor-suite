import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// greppableSources.test.ts — NO SOURCE FILE IN THIS REPOSITORY MAY CONTAIN A NUL BYTE, BECAUSE
// ONE BYTE MAKES A WHOLE FILE INVISIBLE TO `grep` WITH NO ERROR AND NO NON-ZERO EXIT.
//
// ── THE DEFECT, MEASURED RATHER THAN REVIEWED ────────────────────────────────
//
// At main `81b9e52b`, `apps/web/src/lensRequestBodies.ts` line 190 read
//
//     .filter(([l]) => l.includes(b.fn ?? '<a raw 0x00 byte>'))
//
// — a "never matches" sentinel typed as the character rather than as an escape. The string VALUE
// is unremarkable. The byte on disk is not:
//
//   · `grep -c 'export' apps/web/src/lensRequestBodies.ts` printed NOTHING and exited 1. Not "0".
//     Nothing, on a file whose 12 export lines `tail` shows plainly.
//   · `grep -rn 'anonymousMarshalSites' apps/web/src` returned this module's THREE CALLERS and not
//     the line that DEFINES the function.
//   · Over the whole of `apps/web/src`, plain grep found `export` in 141 files and `git grep` found
//     it in 142. One file was missing from every plain-grep census of this tree, silently, rc=0.
//   · `file` called it `data`, while the bytes are valid UTF-8 with exactly one 0x00 at offset 9657.
//
// ⚠ AND THE REASON NOBODY NOTICED IS THAT `git grep` READS IT FINE — it found all four hits and
// all 142 files. This repository's documented commands are `git grep` (aiRequestBodyRegister's own
// header cites `git grep -n 'http.MaxBytesReader(w, r.Body' apps/bff`), so the tool the notes use
// is the one tool that is not fooled. A session working the tree with plain `grep` gets a false
// negative on this file and no signal that it happened.
//
// ⚠⚠ AND OF EVERY FILE IN THE REPOSITORY IT LANDED ON THE ONE WHOSE JOB IS TO BE A CENSUS.
// `lensRequestBodies.ts` is the shared population module for `lensRequestBodyRegister.test.ts` and
// `aiRequestBodyRegister.test.ts` — the two guards that hold this BFF's request bodies to a
// `cannot` entry per upstream key set. The file that answers "what is the population" was the file
// a population scan could not see.
//
// ── THE REPAIR, AND WHY IT CHANGES NO BEHAVIOUR ──────────────────────────────
//
// The escape sequence (a backslash, u, four zeros) is the same string as a raw NUL — U+0000 either way. Only the bytes on disk
// differ, and only the bytes on disk were ever the problem. The sentinel is now a named constant,
// so the next reader meets the reason before the character.
//
// ── WHAT THIS FILE ASSERTS ───────────────────────────────────────────────────
//
// The rule is repo-wide on purpose. A per-directory version would be the defect this repository
// keeps paying for — W1.1.9a: "the fix applied where the defect was reported and the identical
// shape one element over never swept for". A NUL in a Go file, a shell script or a runbook is the
// same silent hole; `deploy/decision-expiry.sh` is a file OF grep commands, and every one of them
// reads a source file.

// ── THE CONTROLS ────────────────────────────────────────────────────────────
//
// 8 arms, `~/talyvor-queue/w171-greppable-controls-m4x7.py`, each applied ALONE against the whole
// apps/web suite, predicted catcher named FIRST, sha256-verified restores, verdicts from failing
// test titles.
//
//   U1   the sentinel goes back to the raw byte (THE DEFECT)  → 1 red  (the census)
//   U1P  U1 with THIS FILE DELETED                            → 0 RED / 1956 tests ← what shipped
//   U2   a NUL planted in apps/bff/lens.go                    → 1 red  (the walk reaches Go)
//   U3   a NUL planted in deploy/decision-expiry.sh           → 1 red  (it reaches the runbook)
//   U4   the detector blinded                                 → 1 red  (the vacuity pair ONLY)
//   U5   the walk narrowed to apps/web/src                    → 1 red  (the reach assertions)
//   U6   the walk returning nothing                           → 1 red  (the literal floor)
//   U7   a reworded comment                                   → 0 red
//
// ⚠ U4 IS THE ONE WORTH READING. A blinded detector reds the self-test and NOT the census — the
// census reports a clean tree, which is exactly what a broken instrument looks like from outside.
// That is why the pair runs on every run rather than being reasoned about once.
//
// ⚠ U3's FIRST CUT PREFIXED THE SHEBANG AND SCORED 19 RED, NOT 1: it broke the script, and 18
// register tests that EXECUTE it reddened for a reason that had nothing to do with greppability.
// Re-aimed at a comment. The failed cut is worth keeping in words — a NUL in a file the suite
// EXECUTES is already loud; this guard exists for the files that are only ever READ.
//
// ⚠⚠ AND TWO ARMS WERE NOT WRITTEN, THEY HAPPENED — BEFORE THIS GUARD EVER GUARDED ANYTHING IT
// REDDENED TWICE ON ITS OWN AUTHOR. The editor that wrote this file put a raw 0x00 into the
// paragraph describing the escape, and the census caught it at byte 2437. Then the floor below
// was typed from a count that did not reproduce, and the floor test caught that. A guard that
// passes on its first run deserves suspicion; this one never got one.

const ROOT = resolve(import.meta.dirname, '../../..')

/** Extensions a person or a script greps. Binaries are excluded by not being listed. */
const TEXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.go',
  '.md',
  '.json',
  '.sh',
  '.yml',
  '.yaml',
  '.css',
  '.html',
  '.sql',
  '.txt',
])

const SKIP = new Set(['node_modules', 'dist', '.git', 'coverage', '.vite', 'build'])

/** ⚠ A LITERAL, never the length of what the walk returns. A floor derived from its own subject
 *  passes at zero, and a walk that silently stops finding files is exactly how this guard would go
 *  green having read nothing.
 *
 *  ⚠⚠ AND THIS FLOOR'S FIRST VALUE WAS WRONG, WHICH IS RECORDED RATHER THAN QUIETLY CORRECTED —
 *  IT IS THE SECOND TIME THIS FILE REDDENED ON ITS OWN AUTHOR BEFORE IT EVER GUARDED ANYTHING.
 *  I typed 500 from a one-off count that printed 536. The identical command re-run returns 402,
 *  and a second implementation (this walk, in node) returns 402 as well. I could not reproduce the
 *  536 and did not keep whatever produced it, so it is not evidence of anything. The floor below
 *  comes from the number TWO independent implementations agree on, with margin — and the reason it
 *  is worth the paragraph is that a floor typed from an unreproduced number is precisely the
 *  vacuity this repository keeps finding, pointed at the one line that exists to prevent it.
 *
 *  (The first reddening was the NUL this guard is about: the editor that wrote this very file put
 *  a raw 0x00 in the paragraph describing the escape, and the guard caught it at byte 2437.)
 *
 *  402 measured twice at `81b9e52b`; it is a FLOOR, so adding files is fine. */
const EXPECTED_FILES = 350

function textFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const p = resolve(dir, entry.name)
    if (entry.isDirectory()) out.push(...textFiles(p))
    else if (TEXT.has(entry.name.slice(entry.name.lastIndexOf('.')))) out.push(p)
  }
  return out
}

function hasNul(bytes: Buffer): boolean {
  return bytes.includes(0)
}

describe('every source file in this repository is greppable', () => {
  it('the detector finds a NUL when there is one, and does not when there is not', () => {
    // ⚠ THE VACUITY PAIR. "No file contains a NUL" is satisfied perfectly by a detector that never
    // says yes. Both directions are checked here, on this run, before the walk is trusted.
    expect(hasNul(Buffer.from('const NEVER_MATCHES = 0'))).toBe(false)
    expect(hasNul(Buffer.from([0x63, 0x6f, 0x6e, 0x00, 0x73, 0x74]))).toBe(true)
    // And the exact shape that shipped: a NUL inside a single-quoted TypeScript string literal.
    expect(
      hasNul(Buffer.concat([Buffer.from("b.fn ?? '"), Buffer.from([0]), Buffer.from("'")])),
    ).toBe(true)
    // The escape form — the repair — must NOT trip it. This is the assertion that keeps the fix
    // from being "delete the sentinel": the value is unchanged, the byte is gone.
    expect(hasNul(Buffer.from("b.fn ?? '\\u0000'"))).toBe(false)
  })

  it('the walk reads a repository and not an empty directory', () => {
    const files = textFiles(ROOT)
    expect(
      files.length,
      `the source walk found ${files.length} text files, below the pinned floor of ` +
        `${EXPECTED_FILES}. Every assertion below is vacuously true on an empty walk`,
    ).toBeGreaterThanOrEqual(EXPECTED_FILES)
    // It must reach every product half, not just the one this test file happens to live in.
    for (const half of ['apps/bff', 'apps/web/src', 'packages/ui/src', 'deploy', 'scripts']) {
      expect(
        files.some((f) => f.startsWith(resolve(ROOT, half))),
        `the walk never reached ${half}, so nothing there is being checked`,
      ).toBe(true)
    }
  })

  it('no source file contains a NUL byte', () => {
    const offenders = textFiles(ROOT)
      .map((f) => [f, readFileSync(f)] as const)
      .filter(([, b]) => hasNul(b))
      .map(([f, b]) => `${f.slice(ROOT.length + 1)} (first NUL at byte ${b.indexOf(0)})`)
    expect(
      offenders,
      'a NUL byte makes a whole file opaque to grep with NO error and NO non-zero exit: `grep -c` ' +
        'prints nothing, `grep -rn` skips the file, and a tree-wide census is quietly one file ' +
        'short. `git grep` is NOT fooled, which is what let the last one survive — the tool this ' +
        'repository documents is the one that reads it. If the byte is deliberate, write it as ' +
        'the escape \\u0000: the string value is identical and only the bytes on disk change',
    ).toEqual([])
  })
})
