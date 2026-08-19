import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * THE COMMANDS THE EXPIRY REGISTER TELLS A DEPLOYER TO RUN MUST BE ABLE TO SAY NO.
 *
 * ── WHAT THIS IS FOR ─────────────────────────────────────────────────────────
 *
 * `deploy/decision-expiry.sh` splits its premises in two. The ones it can read from this repo
 * it CHECKS, and its footer forbids silencing them. The ones that live in talyvor-track /
 * talyvor-docs / a third-party origin it cannot read, so it prints them as UNCHECKABLE with a
 * command, and its last line says: "run their commands in the named repo before a deploy."
 *
 * That sentence is the whole load-bearing structure of the uncheckable half. It is worth
 * exactly as much as the commands are: a command that exits 0 when the premise is FALSE turns
 * "someone will notice" into "someone confirmed it", which is strictly worse than the prose the
 * register replaced. The register's own header ranks a documented command as the WEAKEST of its
 * three forms; this is the failure mode that makes it weaker still.
 *
 * ── THE TWO HAZARDS, MEASURED RATHER THAN REASONED ABOUT ─────────────────────
 *
 * H1 — `go test <pkg> -run <filter>` EXITS 0 WHEN THE FILTER MATCHES NOTHING. Measured on a
 *      throwaway module holding one passing test:
 *
 *        $ go test ./... -run Unknown
 *        ok  	govac	0.366s [no tests to run]        EXIT=0
 *        $ go test ./... -run Unknown -v
 *        testing: warning: no tests to run
 *        PASS
 *        ok  	govac	0.180s [no tests to run]        EXIT=0
 *
 *      `-v` prints the word PASS. A deployer running the register's command sees a pass, and a
 *      renamed, moved or deleted test upstream is indistinguishable from a premise that holds.
 *
 *      ⚠ THIS WAS NOT HYPOTHETICAL WHEN THIS GUARD WAS WRITTEN. The register said premise 2 —
 *      "Track answers 200+[] for an unknown workspace and has no 404 branch on
 *      /v1/service/members" — was settled by `go test ./internal/member/ -run Unknown`.
 *      talyvor-track's `internal/member/` holds FIFTEEN test functions at 9cfad34 and NOT ONE
 *      of them matches the regex `Unknown`. The command had been reporting a pass on an
 *      instrument that ran nothing. The premise itself is true and IS tested upstream — by
 *      `TestServiceMembers_NonExistentWorkspace_EmptyAndAudited` in audit_test.go, which
 *      asserts the 200 and the `[]` body directly — so the register named a filter that misses
 *      the very test it is describing.
 *
 * H2 — `grep -c PATTERN FILE` EXITS 0 FOR ANY COUNT ≥ 1, so an expectation written as a
 *      trailing `# expect 2` comment is a human's job, not the command's. Measured:
 *
 *        $ grep -c 'cfg.MemberSyncSecret' one-line-file   → prints 1, EXIT=0
 *        $ [ "$(grep -c 'cfg.MemberSyncSecret' one-line-file)" = 2 ]   → EXIT=1
 *
 *      One secret gating BOTH Track service endpoints is the premise; a count of 1 means it
 *      gates one, and `grep -c` says nothing about that in its exit status.
 *
 * ── THE REPLACEMENT SHAPE, PROVED IN EVERY STATE RATHER THAN REASONED INTO ───
 *
 * A prescription written in a comment is worth nothing until it has been run against the case
 * it claims to catch. On a throwaway module holding the two `TestServiceRoute_*` names and one
 * decoy, with a subtest under the first so the count could be inflated by one:
 *
 *   both present and passing   [ "$(… | grep -c '^--- PASS: TestServiceRoute')" = 2 ]   EXIT 0
 *   the single-test form, test present   … | grep -q '^--- PASS: <Name>'                EXIT 0
 *   the single-test form, test RENAMED AWAY                                             EXIT 1
 *   one of the two FAILING                                                              EXIT 1
 *   one of the two DELETED                                                              EXIT 1
 *   ⚠ the OLD bare form on that same broken tree: ok … [no tests to run]                EXIT 0
 *
 * The last line is the control: on a tree where the named test no longer exists, the shape this
 * file forbids still answers yes. `^` matters — a subtest prints its `--- PASS:` indented, so
 * the anchor is what keeps the count a count of top-level tests.
 *
 * ── WHAT THIS GUARD DOES AND DOES NOT CLAIM ──────────────────────────────────
 *
 * It does NOT prove a settle command is fail-closed. That is not decidable by reading a shell
 * pipeline, and pretending otherwise would be the same mistake one layer up. It pins the TWO
 * SHAPES MEASURED ABOVE to exit 0 on a false premise, and it says so: this is a denylist of
 * measured hazards, and a new command in a new shape is covered by nothing here.
 *
 * It also cannot check that the named upstream test EXISTS — that premise lives in another
 * repository, which is the entire reason these entries are in the uncheckable half. The
 * `--- PASS:` requirement is what makes the DEPLOYER's run answer that question instead.
 *
 * ⚠ THE FLOORS ARE HARDCODED LITERALS AND THEY ARE NOT DECORATION. Every rule below is a loop
 * over a set parsed out of a bash file. Reformat the file, rename the helper, drop the
 * continuation backslashes, and the parse yields ZERO entries — at which point every rule
 * passes, having read nothing, and this file reports a clean register. The two floors are the
 * only things standing between that and a green run, so they name counts rather than deriving
 * one from the parse they are meant to police.
 */

const REGISTER = resolve(import.meta.dirname, '../../../deploy/decision-expiry.sh')

interface Uncheckable {
  premise: string
  where: string
  command: string
}

/**
 * The three double-quoted arguments of a `cannot` call, unescaped by bash's OWN rule for a
 * double-quoted string: a backslash is only an escape before `$`, a backtick, `"` or `\` — before
 * anything else it is a literal backslash. Getting this wrong in either direction misreads the
 * command: drop too much and a grep pattern's `\(` becomes a group, drop too little and the
 * `\"` around a command substitution is compared as part of the text.
 */
function quotedArgs(call: string): string[] {
  const args: string[] = []
  let i = 0
  while (i < call.length) {
    if (call[i] !== '"') {
      i += 1
      continue
    }
    i += 1
    let buf = ''
    while (i < call.length && call[i] !== '"') {
      if (call[i] === '\\') {
        if (!'$`"\\'.includes(call[i + 1] ?? '')) buf += call[i]
        i += 1
        if (i < call.length) {
          buf += call[i]
          i += 1
        }
        continue
      }
      buf += call[i]
      i += 1
    }
    i += 1
    args.push(buf)
  }
  return args
}

function parseUncheckable(text: string): Uncheckable[] {
  // Each `cannot` call is written across three backslash-continued lines; join them first.
  const joined = text.replace(/\\\n\s*/g, ' ')
  const out: Uncheckable[] = []
  for (const line of joined.split('\n')) {
    if (!line.startsWith('cannot ')) continue
    const args = quotedArgs(line)
    if (args.length < 3) continue
    out.push({ premise: args[0], where: args[1], command: args[2] })
  }
  return out
}

const ENTRIES = parseUncheckable(readFileSync(REGISTER, 'utf8'))
const GO_TEST = ENTRIES.filter((e) => /\bgo test\b/.test(e.command))
const GREP_C = ENTRIES.filter((e) => /\bgrep -c\b/.test(e.command))
/**
 * H3 — AN EXTRACTION PIPELINE ANSWERS YES ABOUT WHATEVER IT FOUND, INCLUDING NOTHING. The seven
 * struct-mirror entries added with mirrorSubsetRegister.test.ts read a Go struct's json tags with
 * `sed … | grep -o … | sort`. That is neither of the two shapes above, and the header's own
 * warning — "a new command in a new shape is covered by nothing here" — is why this rule exists in
 * the same change as the commands.
 *
 * ⚠ AND THE FIRST VERSION OF THIS PARAGRAPH WAS WRONG, IN THE DIRECTION THAT FLATTERS THE RULE. It
 * said the careful-looking `| grep -q .` form confirms a premise nobody checked when the struct is
 * renamed or the file is gone. MEASURED, in throwaway checkouts of talyvor-track's model.go: it
 * EXITS 1 in both — sed keys on the struct name and prints nothing either way, so that shape is
 * not blind where I claimed it was. What it IS blind to is the set of changes this premise exists
 * for: a field APPENDED, a field DELETED, an omitempty that came or went. The struct still prints
 * tags, `grep -q .` still says yes, and the field set has moved underneath it. The append is the
 * documented arrival case and nothing in either repository can see it. Comparing the captured list
 * is the only shape that can.
 *
 * ⚠ THE ONE `grep -o` COMMAND THIS RULE DOES NOT REACH IS EXCLUDED DELIBERATELY, AND NOT BY BEING
 * OVERLOOKED. The palette entry pipes `curl` through `grep -o` and PRINTS nine values for a
 * deployer to compare against packages/ui site-parity.test.ts. A previous session measured what
 * fail-closing it would cost — the nine values written down a THIRD time, which that file's own
 * header exists to warn against — and left it a human read on purpose. It reads a third-party
 * origin rather than a file in a checkout, which is the line drawn here: a command that extracts
 * from a FILE has a source of truth to be compared against, and one that extracts from a live
 * origin does not.
 */
const EXTRACT = ENTRIES.filter(
  (e) => /\bgrep -o\b/.test(e.command) && !/\bcurl\b/.test(e.command),
)

/** A short, stable handle for a test name — the premise lines are paragraphs. */
const handle = (e: Uncheckable) => e.premise.slice(0, 56)

describe('the expiry register still has an uncheckable half to police', () => {
  it('parses at least six UNCHECKABLE premises out of deploy/decision-expiry.sh', () => {
    expect(
      ENTRIES.length,
      'fewer `cannot` calls were parsed than the register declares. Either premises were ' +
        'deleted — in which case delete them here deliberately — or the parse above stopped ' +
        'matching the file, which silently empties every rule below.',
    ).toBeGreaterThanOrEqual(6)
  })

  it('the struct-mirror entries are still parsed as extraction commands', () => {
    expect(
      EXTRACT.length,
      'the `grep -o` rule has lost its subject. It is a loop, so with no extraction commands ' +
        'left it passes reading nothing — SIXTEEN cross-repo premises are settled by that ' +
        'shape and this floor is what makes their disappearance a red instead of a silence. It ' +
        'was 7 when only talyvor-track and talyvor-docs were registered; leaving it at 7 after ' +
        "lib/api.ts's four were added would have tolerated losing exactly those four in silence. " +
        'It was 11 until the five docs-search premises arrived, and the same argument applies ' +
        'unchanged: the number moves in the change that adds them, or it tolerates their loss.',
    ).toBeGreaterThanOrEqual(16)
  })

  it('at least three of them are settled by running `go test` upstream', () => {
    expect(
      GO_TEST.length,
      'the `go test` rule has lost its subject. It is a loop, so with no go-test commands left ' +
        'it passes reading nothing — this floor is what makes that a red instead.',
    ).toBeGreaterThanOrEqual(3)
  })
})

describe('a settle command exits non-zero when its premise does not hold', () => {
  for (const entry of GO_TEST) {
    it(`${handle(entry)} — proves the go test filter matched something`, () => {
      expect(
        entry.command,
        'this settle command runs `go test … -run <filter>` and reads its exit status. MEASURED: ' +
          'a filter matching no test prints "PASS" / "ok … [no tests to run]" and EXITS 0, so a ' +
          'renamed or deleted test upstream reports the premise as confirmed. Pipe `-v` output ' +
          "through a check on the `--- PASS: <TestName>` line so the deployer's run fails when " +
          'the named test is not there to run.',
      ).toContain('--- PASS:')
    })
  }

  for (const entry of EXTRACT) {
    it(`${handle(entry)} — compares the extracted list instead of trusting the pipeline`, () => {
      expect(
        entry.command,
        'this settle command extracts a list with `grep -o` and must compare it to an expected ' +
          'one. MEASURED: with the struct renamed, or the file absent, every stage of the ' +
          'pipeline still exits 0 and writes an empty line — so a form that reads the exit ' +
          'status confirms a premise it never looked at. Capture it and compare: ' +
          '[ "$(… | grep -o … )" = "field field,omitempty …" ].',
      ).toMatch(/\[\s*"\$\(.*grep -o.*\)"\s*=\s*"[^"]*"\s*\]/)
    })
  }

  for (const entry of GREP_C) {
    it(`${handle(entry)} — compares the count instead of trusting grep -c`, () => {
      expect(
        entry.command,
        'this settle command reads `grep -c`\'s exit status. MEASURED: `grep -c` exits 0 for ANY ' +
          'count ≥ 1, so an expectation written as a trailing `# expect N` comment is enforced by ' +
          'the reader and by nothing else. Capture the count and compare it: ' +
          '[ "$(grep -c … )" = N ].',
      ).toMatch(/\[\s*"\$\(.*grep -c.*\)"\s*=\s*\d+\s*\]/)
    })
  }
})
