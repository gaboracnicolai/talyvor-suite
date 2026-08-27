import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * THE FILE THAT EXISTS TO STOP PROSE BEING MISTAKEN FOR A CHECK WAS RUNNING ITS PROSE AS A CHECK.
 *
 * A `cannot` entry in deploy/decision-expiry.sh is three DOUBLE-QUOTED bash arguments, and bash
 * performs command substitution on backticks inside a double-quoted string. Three entries explain
 * themselves using backticked shell — a bare `grep -q`, a `sed` comment-strip, and a bare
 * `go test` — so bash RAN all three on every invocation, CI included.
 *
 * (Their exact text is not quoted here. Spelling one of them inside this comment made esbuild
 * read the fragment as an unterminated regular expression and the whole file failed to collect —
 * prose parsed as code, which is the very defect below, one layer out.)
 *
 * ── WHAT THAT COST, MEASURED RATHER THAN REASONED ────────────────────────────
 *
 * · 363 bytes of stderr on every run: grep's usage message and `go: cannot find main module`.
 *   Exit status 0 throughout, so nothing was ever red about it.
 * · `grep` and `sed` with no file argument READ STDIN. When stdin is a pipe that never closes —
 *   which is what a supervisor, or any `subprocess.run(..., capture_output=True)` that does not
 *   pass `stdin=DEVNULL`, hands a child — the register BLOCKS FOREVER. Found by being hung by it:
 *   seven minutes before it was killed, then reproduced deliberately.
 * · With stdin at EOF (a terminal, a GitHub Actions step, node's `execFileSync`, which closes the
 *   child's stdin) both return instantly and empty. That is why nobody had seen it.
 *
 * ⚠⚠ AND THE THIRD COST IS THE ONE A DEPLOYER ACTUALLY MET: THE SUBSTITUTION ATE THE PROSE.
 * Each fragment was replaced by its own (empty) stdout, so three sentences in the printed register
 * shipped with a HOLE where the command name should be — "and a bare  exits 0 on that skip",
 * "because  swallows the usage message", "and without  a DDL line COMMENTED OUT still answers
 * yes". Measured by diffing the printed output before and after the fix: exactly three lines
 * change, and every change is a missing phrase coming back. A register whose whole purpose is to
 * tell a deployer what to run was handing them sentences with the verb removed.
 *
 * ⚠ THE EXISTING CALLERS WERE NEVER AT RISK, AND THAT IS MEASURED, NOT ASSUMED. The three
 * `execFileSync('bash', [REGISTER])` calls in docsPageWriteRegister.test.ts complete in ~90ms even
 * when node's OWN stdin is a never-closing pipe, because execFileSync gives the child a closed
 * stdin regardless. Stating the blast radius honestly matters: the defect is real and the harm
 * was bounded.
 *
 * ── WHY THREE RULES AND NOT ONE ──────────────────────────────────────────────
 *
 * R1 is the PROPERTY that actually bit: the script must terminate when stdin never closes.
 * R2 is the PROPERTY that is true every run: a script that runs only what it means to run writes
 *    nothing to stderr.
 * R3 is the CAUSE, and it is the only one of the three that says WHERE.
 *
 * A property test alone would go green the day someone silences the symptom (adding `< /dev/null`
 * to the CI step hides R1 and R2 and leaves arbitrary execution in place). The cause test alone
 * would go green the day the substitution finds a spelling R3 does not know. Neither is sufficient
 * and that is why both are here — the same reason the page-LIST entry now reads two files.
 *
 * Positive controls, both directions, in ~/talyvor-queue/w172-register-prose-controls-r5k9.py.
 * ALL THREE WERE RED BEFORE THE FIX, which is recorded there rather than asserted here.
 */

const ROOT = resolve(__dirname, '../../..')
const REGISTER = resolve(ROOT, 'deploy/decision-expiry.sh')

/**
 * The register's lines that bash EXECUTES — every line that is not a whole-line comment.
 *
 * ⚠ THIS IS DELIBERATELY THE COARSE RULE. A `cannot` call spans three continued lines and its
 * arguments are ordinary double-quoted strings, so anything not commented out is a line bash
 * evaluates. Narrowing it to "argument lines" would need this file to parse bash quoting, which is
 * the judgement that lets a new spelling through.
 */
function executedLines(): { n: number; text: string }[] {
  return readFileSync(REGISTER, 'utf8')
    .split('\n')
    .map((text, i) => ({ n: i + 1, text }))
    .filter(({ text }) => !text.trimStart().startsWith('#'))
}

describe('deploy/decision-expiry.sh runs only what it means to run', () => {
  it('parses executed lines at all, so the rules below cannot pass having read nothing', () => {
    const lines = executedLines()
    expect(
      lines.length,
      'no executed lines parsed out of deploy/decision-expiry.sh. Every rule in this file is an ' +
        'absence check over that list, and an empty list satisfies all of them while reading ' +
        'nothing — the vacuity shape this register itself has been bitten by twice.',
    ).toBeGreaterThan(100)
    // The file must still be the one this test thinks it is.
    expect(
      lines.some(({ text }) => text.startsWith('cannot "')),
      'no `cannot` invocation found. If the register stopped using that helper, this file is ' +
        'policing a shape that is no longer there.',
    ).toBe(true)
  })

  it('R3 — no unescaped backtick survives on a line bash evaluates', () => {
    const offenders = executedLines().flatMap(({ n, text }) => {
      const withoutEscaped = text.replace(/\\`/g, '')
      return [...withoutEscaped.matchAll(/(?<!\\)`([^`]*)`/g)].map((m) => `${n}: \`${m[1]}\``)
    })
    expect(
      offenders,
      'these backticks sit on lines bash evaluates, inside double-quoted arguments, so bash runs ' +
        'them as command substitutions. Two of the three found on 2026-08-27 read stdin and hung ' +
        'the whole script when stdin never closed; the third ran a real `go test` at the repo ' +
        'root. Write them as \\` in the prose — the rendering is identical and the substitution ' +
        'does not happen. This rule is the CAUSE half; R1 and R2 above are the properties, and ' +
        'each catches what the other cannot.',
    ).toEqual([])
  })

  /**
   * ⚠ THIS RULE WAS WRITTEN WITH `execFileSync` IN A `try`/`catch` AND IT PASSED ON A TREE WHERE
   * THE REGISTER WAS WRITING 363 BYTES TO STDERR. execFileSync does not throw when the command
   * exits 0, so the catch never ran, `stderr` kept its initial `''`, and the assertion compared
   * an empty string it had never filled to an empty string. A guard that reads nothing is green
   * for every possible tree — and only running it RED-FIRST, before the fix, showed it.
   * `spawnSync` returns stderr on BOTH paths, so there is no path on which this reads nothing.
   */
  it('R2 — a normal run writes NOTHING to stderr', () => {
    const r = spawnSync('bash', [REGISTER], { cwd: ROOT, encoding: 'utf8' })
    expect(
      r.error,
      'the register could not be spawned at all, so its stderr says nothing about the register.',
    ).toBeUndefined()
    expect(
      typeof r.stderr,
      'spawnSync returned no stderr channel — this rule would then compare undefined to "" and ' +
        'pass having measured nothing, which is the exact failure it was rewritten to remove.',
    ).toBe('string')
    const stderr = r.stderr
    expect(
      stderr,
      'the register wrote to stderr. Every check it means to run reports through stdout; bytes ' +
        'on stderr are a command nobody asked for. On 2026-08-27 this was 363 bytes — grep\'s ' +
        'usage message and `go: cannot find main module` — from three backticked prose fragments ' +
        'bash was executing, with exit status 0 the whole time.',
    ).toBe('')
  })

  it(
    'R1 — it terminates even when stdin is a pipe that never closes',
    async () => {
      const BOUND_MS = 6000 // the register completes in ~90ms; this is ~65x headroom
      const child = spawn('bash', [REGISTER], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] })
      // stdin is an open pipe and is deliberately never ended — a supervisor's shape exactly,
      // and the shape of any subprocess call that does not pass a closed stdin.
      child.stdout.resume()
      child.stderr.resume()
      const outcome = await new Promise<string>((res) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL')
          res('BLOCKED')
        }, BOUND_MS)
        child.on('exit', () => {
          clearTimeout(timer)
          res('exited')
        })
      })
      expect(
        outcome,
        `the register did not finish within ${BOUND_MS}ms with an open stdin. A check in it is ` +
          'reading standard input, so it waits for input that is never coming. CI hands its ' +
          'steps a closed stdin and so never sees this; a supervisor, an agent harness, or any ' +
          'subprocess call without an explicit closed stdin does — measured at seven minutes ' +
          'before the process was killed. ⚠ DO NOT FIX THIS BY GIVING THE CALLER `< /dev/null`: ' +
          'that hides this rule and R2 and leaves the arbitrary execution R3 names in place.',
      ).toBe('exited')
    },
    20000,
  )
})
