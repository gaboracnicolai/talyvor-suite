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
/**
 * ⚠ THE BUNDLED FLAGS ARE IN THE PATTERN, AND THEY WERE NOT — MEASURED, NOT ANTICIPATED. This read
 * `/\bgrep -c\b/`, and `\b` between `c` and `E` is not a boundary: both are word characters. So
 * `grep -cE` — a counting command in every sense the rule cares about — was classified as NEITHER
 * shape and generated NO test. The entry added beside this change used exactly that form and
 * escaped the rule silently; the count of files and tests did not move, which is what made it
 * invisible. Any `-cq`, `-ci`, `-cw` would have gone the same way. The rule was never about the
 * spelling of the flag: it is about a command that reads `grep`'s EXIT STATUS instead of its count.
 */
const COUNT_SHAPE = /\bgrep -c[A-Za-z]*\b/
const GREP_C = ENTRIES.filter((e) => COUNT_SHAPE.test(e.command))
/**
 * ⚠ THE BUNDLED FLAG IS IN THIS PATTERN TOO, AND IT WAS NOT — the identical defect recorded
 * against `grep -c` directly above, fixed there and not here. `/\bgrep -o\b/` does not match
 * `grep -oE`, so the six talyvor-lens request-body entries were in NO rule in this file. See H4
 * below, which is the control that keeps both patterns flag-bundling-proof.
 */
const EXTRACT_SHAPE = /\bgrep -o[A-Za-z]*\b/
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
/**
 * ⚠ THE EXPECTED LITERAL MAY BE SINGLE-QUOTED, AND IT HAD TO BECOME SO RATHER THAN THE COMMAND
 * BENDING TO THE RULE. This read `= "[^"]*"` — a double-quoted expectation only. The W1.7.1 entry
 * that settles the Docs metering tags compares the extracted SET of feature tags, and those tags
 * are Go STRING LITERALS, so the expected value CONTAINS double quotes:
 *
 *     [ "$(grep -oE '"docs-ai-(ask|…)"' …)" = '"docs-ai-ask" "docs-ai-summarize" …' ]
 *
 * ⚠ AND THE OBVIOUS WAY TO SATISFY THE OLD PATTERN WOULD HAVE WEAKENED THE COMMAND, WHICH IS WHY
 * THE PATTERN MOVED INSTEAD. Dropping the quotes from the grep so the expectation needs none —
 * `grep -oE 'docs-ai-(ask|…)'` — makes the extraction match the tag in PROSE: talyvor-docs'
 * engine.go:94 names `docs-ai-ask` and `docs-search` in a comment, so a tag deleted from the code
 * and left in the paragraph above it would still be extracted. That is the §D7 trap, and taking
 * it to keep a regex happy is how a guard's shape rule ends up dictating a weaker measurement.
 *
 * The PROPERTY is unchanged and is the whole point of the rule: the extraction must be CAPTURED
 * and COMPARED to a written-down literal, never trusted through an exit status. `'…'` carries a
 * literal exactly as `"…"` does. Positive-controlled below on the form this rule exists to
 * refuse — an uncaptured `grep -o` chained with `&&` — which still fails to match.
 */
const EXTRACT_COMPARES = /\[\s*"\$\(.*grep -o.*\)"\s*=\s*(?:"[^"]*"|'[^']*')\s*\]/

const EXTRACT = ENTRIES.filter(
  (e) => EXTRACT_SHAPE.test(e.command) && !/\bcurl\b/.test(e.command),
)

/** A short, stable handle for a test name — the premise lines are paragraphs. */
const handle = (e: Uncheckable) => e.premise.slice(0, 56)

/**
 * Every `grep -<flags>` cluster in a command, as its flag letters. Derived by TOKENISING the
 * command rather than by re-running either shape pattern, which is the whole point: a rule that
 * decided its own population would agree with itself in every state, including the broken one.
 */
const grepFlagClusters = (command: string): string[] =>
  [...command.matchAll(/\bgrep -([A-Za-z]+)/g)].map((m) => m[1])

/**
 * H4 — A BUNDLED GREP FLAG FALLS OUT OF THE RULE THAT NAMES THE FLAG, AND THIS FILE HAD ALREADY
 * MEASURED THAT ONCE AND FIXED IT IN ONE RULE OF TWO.
 *
 * The `grep -c` comment above records it exactly: `\b` between `c` and `E` is not a boundary, so
 * `/\bgrep -c\b/` classified `grep -cE` as NEITHER shape and generated NO test. COUNT_SHAPE was
 * widened to `-c[A-Za-z]*`. EXTRACT_SHAPE was left as `/\bgrep -o\b/` in the same file.
 *
 * MEASURED at dd3ba56, by executing all 46 settle commands against read-only `git archive` exports
 * of talyvor-docs / talyvor-lens / talyvor-track at their mains: SIX entries write `grep -oE` and
 * are therefore in NO rule here — the whole talyvor-lens request-body register. They are the money
 * and credential shapes: billing/checkout `usd_cents`, lxc/convert `lxc_amount_ulxc`, api-keys
 * `scopes`, provision `ttl_hours`, distill `distill_policy`, cache-poolable `cache_poolable`.
 * All six happen to be in the compare form TODAY, so nothing upstream is wrong; the rule that
 * exists to keep them in it simply cannot see them, and a rewrite into `| grep -q .` would be
 * green here.
 *
 * ⚠ WHY THE POPULATION IS TOKENISED AND NOT RE-MATCHED. Asserting `oFamily.length === EXTRACT.length`
 * with both sides built from EXTRACT_SHAPE is a tautology in every state — it passes before the
 * widening and after it, and it would pass again if the pattern were reverted. Tokenising the flag
 * cluster is a second, independent mechanism, so this rule can still say no.
 */
describe('a bundled grep flag does not fall out of the rule that names the flag', () => {
  it('every command whose grep flags include `o` is classified as an extraction', () => {
    const byFlag = ENTRIES.filter(
      (e) =>
        grepFlagClusters(e.command).some((f) => f.includes('o')) && !/\bcurl\b/.test(e.command),
    )
    const missed = byFlag.filter((e) => !EXTRACT.includes(e))
    expect(
      missed.map((e) => e.premise.slice(0, 70)),
      'these settle commands extract with a `grep -o` family flag and EXTRACT did not classify ' +
        'them, so the rule that requires the extracted list be COMPARED never ran for them. The ' +
        'same bundled-flag blindness is recorded against `grep -c` higher up this file and was ' +
        'fixed there only. Widen EXTRACT_SHAPE the way COUNT_SHAPE already is.',
    ).toEqual([])
  })

  it('every command whose grep flags include `c` is classified as a count', () => {
    const byFlag = ENTRIES.filter((e) => grepFlagClusters(e.command).some((f) => f.includes('c')))
    const missed = byFlag.filter((e) => !GREP_C.includes(e))
    expect(
      missed.map((e) => e.premise.slice(0, 70)),
      'these settle commands read `grep -c` and the count rule did not classify them.',
    ).toEqual([])
  })

  /**
   * The positive control, both directions, on the patterns themselves. Without it the two rules
   * above pass the day every entry happens to be spelled `grep -o` — reading nothing, and saying
   * so to nobody.
   */
  it('each shape pattern matches the bare flag AND the bundled flag', () => {
    const cases = [
      { name: 'EXTRACT_SHAPE', shape: EXTRACT_SHAPE, bare: 'grep -o x', bundled: 'grep -oE x' },
      { name: 'COUNT_SHAPE', shape: COUNT_SHAPE, bare: 'grep -c x', bundled: 'grep -cE x' },
    ]
    for (const c of cases) {
      expect(c.shape.test(c.bare), `${c.name} lost the bare form`).toBe(true)
      expect(
        c.shape.test(c.bundled),
        `${c.name} does not match the bundled form. \b between the flag letter and the next ` +
          'letter is not a word boundary, so the rule silently generates no test for it.',
      ).toBe(true)
    }
    // The negative half: neither shape may swallow an unrelated flag cluster.
    expect(EXTRACT_SHAPE.test('grep -A12 foo'), 'EXTRACT_SHAPE matched grep -A').toBe(false)
    expect(COUNT_SHAPE.test('grep -q foo'), 'COUNT_SHAPE matched grep -q').toBe(false)
  })
})

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
        'unchanged: the number moves in the change that adds them, or it tolerates their loss. ' +
        'It was 16 while EXTRACT_SHAPE could not see a bundled `grep -oE`: the six talyvor-lens ' +
        'request-body premises were extraction commands the whole time and were counted by ' +
        'nothing, so widening the pattern moved the real population 27 -> 33 without a single ' +
        'entry being added to the register.',
    ).toBeGreaterThanOrEqual(33)
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
      ).toMatch(EXTRACT_COMPARES)
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

/**
 * ⚠ THE DECLARED SUBJECT IS A CLAIM ABOUT WHAT THE COMMAND READS, AND ONE OF THEM IS FALSE.
 *
 * `cannot`'s second argument names the repository AND the files the premise is read out of. It is
 * the cross-repo twin of `subject` in the same script: a deployer who has to re-anchor a settle
 * command reads that list to know which files matter.
 *
 * ⚠⚠ WHY THE 45/45 THAT CAME BEFORE THIS DID NOT SEE IT: IT WAS COUNTED PER ENTRY. tab-r5m2 armed
 * the register "45/45 against their declared subject file being emptied AND deleted" — an entry
 * scores armed as soon as ONE of its subjects reds the command. Re-run per (entry, SUBJECT) pair
 * at docs 313eb86 / track a12e01f / lens f134404 — every command executed in a read-only
 * `git archive` export, each subject emptied AND deleted in turn, restored and sha256-verified
 * back (~/talyvor-queue/w171-subject-arming-census-j8w4.py) — and it is 51 pairs, X0 green on all
 * 45 checkable entries, **50 ARMED and ONE INERT**: entry 5's `migrations/0018_page_own_ai_spend.sql`.
 * Empty it, delete it, and the command still exits 0. An entry-level control cannot see this,
 * because the other two subjects of that same entry red it correctly.
 *
 * ⚠ AND IT IS NOT AN ARTEFACT OF THE HARNESS, WHICH WAS THE FIRST THING CHECKED. A reused test
 * database would explain a green — `internal/migrate` records each migration's checksum, so an
 * already-migrated database never re-reads the file. Re-run against a FRESH database it was still
 * green, and the reason is simpler and worse: `TestAttribution_*` drives a `recordingBinder` fake
 * and a `lensStub` and opens no connection at all. The declared subject is not weakly read. It is
 * read by nothing, on any run, by any route.
 *
 * WHAT IS ENFORCEABLE FROM HERE. This repository's CI clones only itself, so it cannot execute a
 * settle command and cannot watch a subject red one. What it CAN decide is whether a declared
 * subject is reachable AT ALL:
 *
 *   R5 SHAPE       — a subject token is a bare repo-relative path. The register writes its lists
 *                    with TWO separators — `, ` (entry 5) and ` + ` (entries 37/38/39) — and a
 *                    parser that knows only one of them reads three real paths as a single path
 *                    that does not exist. It still ENDS IN `.go`, so a reachability rule would
 *                    wave it through. Whitespace in a token is what makes a third separator fail
 *                    here rather than silently become one unreadable subject.
 *   R6 REACHABILITY— a subject that is not a Go source file must be NAMED in the settle command.
 *                    `go test ./internal/ai/` pulls in `internal/page/ai_spend.go` through the
 *                    build graph without naming it — that is why .go files are exempt and why
 *                    this rule is not "every subject must appear in the command". A .sql file has
 *                    no such route: nothing compiles it. ⚠ THIS IS A POLICY, NOT A LAW OF THE
 *                    UNIVERSE — a test CAN reach a .sql through an `embed.FS`, and this repo
 *                    cannot see that either. The policy is what makes the arming visible from
 *                    here: declare a non-Go subject and name it, so a reader can tell whether it
 *                    is read.
 */
const SUBJECT_LIST = /^([a-z-]+)\s+(.*)$/
const declaredSubjects = (where: string): { repo: string | null; paths: string[] } => {
  const m = SUBJECT_LIST.exec(where)
  if (!m) return { repo: null, paths: [] }
  return { repo: m[1], paths: m[2].split(/,| \+ /).map((s) => s.trim()).filter(Boolean) }
}

/**
 * The palette entry declares "talyvor.higgsfield.app — a third-party deployment, not a
 * repository", which is prose ON PURPOSE and is excluded here for the same reason it is excluded
 * from EXTRACT: it reads a live origin, not a file in a checkout. Recognised by the absence of a
 * repo-shaped first token rather than by name, so a second such entry is covered without an edit.
 */
const WITH_SUBJECTS = ENTRIES.map((e) => ({ entry: e, ...declaredSubjects(e.where) })).filter(
  (s) => s.repo !== null,
)
const PAIRS = WITH_SUBJECTS.flatMap((s) =>
  s.paths.map((p) => ({ entry: s.entry, repo: s.repo as string, path: p })),
)

describe('a declared subject is read by the command that declares it', () => {
  /**
   * The vacuity floor, and it is the one that matters most here: every rule below iterates PAIRS,
   * so a `where` field whose shape stops matching empties all of them and this file reports a
   * clean register having read nothing. 51 measured at 095d4b7e; the floor is named rather than
   * derived from the parse it polices.
   */
  it('parses a subject list out of substantially every uncheckable entry', () => {
    expect(
      WITH_SUBJECTS.length,
      'fewer `cannot` entries yielded a repo-and-paths subject list than the register declares. ' +
        'Either entries were deleted, or the `where` field changed shape — which silently empties ' +
        'every rule in this block.',
    ).toBeGreaterThanOrEqual(44)
    expect(
      PAIRS.length,
      'fewer (entry, subject) pairs than were measured armed. A subject that stops parsing is a ' +
        'subject nothing below can police.',
    ).toBeGreaterThanOrEqual(50)
  })

  it('R5 — every declared subject is a bare path, so a third separator cannot hide inside one', () => {
    const malformed = PAIRS.filter((p) => !/^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(p.path))
    expect(
      malformed.map((p) => `${p.repo} ${p.path}`),
      'these subject tokens are not bare repo-relative paths. The register writes its lists with ' +
        '`, ` and with ` + `; a separator this parser does not know leaves several paths glued ' +
        'into one token that names no file, and because such a token still ends in `.go` the ' +
        'reachability rule below waves it through. Add the separator to the split, deliberately.',
    ).toEqual([])
  })

  it('R6 — a subject that no `go test` could compile is named in the command', () => {
    const unreachable = PAIRS.filter(
      (p) => !p.path.endsWith('.go') && !p.entry.command.includes(p.path),
    )
    expect(
      unreachable.map((p) => `${p.repo} ${p.path}`),
      'these files are declared as subjects of a settle command that never names them, and they ' +
        'are not Go sources, so no `go test` in the command reaches them through the build graph ' +
        'either. MEASURED per (entry, subject) at docs 313eb86 — emptied AND deleted, against a ' +
        'FRESH database, the command still exits 0. The declaration says the premise is read out ' +
        'of this file and nothing reads it. Either name the path in the command, or stop ' +
        'declaring it.',
    ).toEqual([])
  })
})

/**
 * ⚠ THREE OF THESE COMMANDS ANSWER A PREMISE ABOUT AUTHZ AND MONEY WITH A BARE `1` AND NOT ONE
 * BYTE OF OUTPUT, AND THE HARDENING THAT MADE THEM SILENT IS THIS REGISTER'S OWN.
 *
 * The footer tells a deployer to run the uncheckable half in the named repo before a deploy. Run
 * COLD — every `*_TEST_DATABASE_URL` stripped from the environment — against read-only exports at
 * docs df4a90d / track a12e01f / lens f134404, EXACTLY 3 of the 46 red: entry 2 (Track's
 * `internal/member`), entry 3 and entry 8 (Docs' `internal/trackintegration`). All three are
 * `go test`; so is entry 5, and entry 5 is GREEN cold, so "runs go test" is not the discriminator
 * and a deployer cannot tell the two apart by looking.
 *
 * ⚠⚠ AND WHAT THEY PRINT IS THE PART THAT MATTERS. MEASURED on entry 8: `exit=1, stdout 0 bytes,
 * stderr 0 bytes`. Docs' own test writes a good paragraph — "DOCS_TEST_DATABASE_URL is not set …
 * it FAILS rather than skips: a silently skipped real-PG suite looks exactly like a passing one" —
 * and `2>&1 | grep -c '^--- PASS: …'` eats every word of it, because grep is counting PASS lines
 * and a prerequisite failure produces none. That pipe is here ON PURPOSE: it is what stops
 * `go test -run <filter>` reporting a pass from a run of nothing, a hazard this file's header
 * records being caught. The fix for one blindness manufactured another. A deployer gets an
 * unexplained non-zero on "the /v1/service/ lane skips membership authz but still requires the
 * gateway secret" — indistinguishable from the premise having MOVED, which is the one thing this
 * register exists to tell them apart. The cost is not the wasted hour; it is that a register which
 * cries wolf on a security premise teaches the reader to discount its reds.
 *
 * R7 — a `go test` settle command states its prerequisite IN THE COMMAND, not in prose. Either it
 * guards on the database URL it needs and exits 3 with a sentence saying so — 3, not 1, so the
 * deployer can tell "I have not set this up" from "the premise has moved" — or it declares that it
 * needs no database. The declaration is a claim like any other and each of the four was MEASURED
 * cold, twice, before it was written down.
 */
/**
 * ⚠ `[^;]*` WAS WRONG AND THE RED IS WHAT SAID SO. The guard reads
 * `[ -n "${X:-}" ] || { echo '…'; exit 3; }` — there is a semicolon between the bracket and the
 * exit, inside the very brace group the rule is looking at, so a class excluding `;` could never
 * span it. It matched nothing on all three guarded commands and the rule stayed red for a reason
 * that had nothing to do with the register. Bounded to one line instead, which is the real
 * constraint: the guard and its exit are one statement in one command string.
 */
const NEEDS_DB_GUARD = /\[ -n "\$\{[A-Z_]+_TEST_DATABASE_URL:-\}" \][^\n]*exit 3;/
const NEEDS_NO_DB = 'NEEDS NO DATABASE'

describe('a settle command says what it needs before it says what it found', () => {
  it('there are still `go test` settle commands to police', () => {
    expect(
      GO_TEST.length,
      'no settle command was classified as a `go test`, which silently empties R7. Four were ' +
        'measured at 27b672d — entries 2, 3, 5 and 8.',
    ).toBeGreaterThanOrEqual(4)
  })

  for (const entry of GO_TEST) {
    it(`${handle(entry)} — R7 declares its database prerequisite`, () => {
      const guarded = NEEDS_DB_GUARD.test(entry.command)
      const declaredNone = entry.command.includes(NEEDS_NO_DB)
      expect(
        guarded || declaredNone,
        'this settle command runs `go test` and says nothing about what the run needs. MEASURED ' +
          'cold at docs df4a90d / track a12e01f: three of the four red with no ' +
          '`*_TEST_DATABASE_URL`, and they red SILENTLY — exit 1, zero bytes on stdout and ' +
          'stderr — because `2>&1 | grep -c \'^--- PASS: …\'` counts PASS lines and swallows the ' +
          "upstream test's own explanation. The deployer cannot tell that from a premise that " +
          'moved. Either guard on the URL and `exit 3` with a sentence, or write ' +
          `\`${NEEDS_NO_DB}\` and mean it — entry 5 drives a recordingBinder and a lensStub and ` +
          'opens no connection, which is why that arm exists and is not an escape hatch.',
      ).toBe(true)
      expect(
        guarded && declaredNone,
        'this command both guards on a database URL and declares it needs no database. One of ' +
          'the two is false.',
      ).toBe(false)
    })
  }
})

/**
 * ⚠⚠ R8 — A CENSUS ROW'S `upstream` FIELD IS A CLAIM ABOUT ANOTHER REPOSITORY, AND UNTIL NOW THE
 * ONLY ASSERTION ON IT WAS THAT THE STRING STARTS WITH `internal/`.
 *
 * Both metered censuses carry one `upstream:` per surface — the call site in talyvor-docs or
 * talyvor-track that makes that surface cost the workspace money. Both headers presented that
 * column as holding the STALE direction ("if a surface stops spending, its row must be DELETED
 * rather than left passing"). It held nothing: `toMatch(/^internal\//)` is a shape, and a shape
 * is satisfied by any function name at all.
 *
 * MEASURED read-only at talyvor-docs `48c8336` and talyvor-track `b2f282e` (W1.7.1, tab-p9r4),
 * `git archive` exports of the object store — neither working tree written to, no fetch:
 * **TWO of the nine pointers named a function the upstream repo does not declare.** Docs wrote
 * `Engine.Ask`, talyvor-docs declares `AskDocs`; Track wrote `Engine.Triage`, talyvor-track
 * declares `TriageIssue`. Zero declarations of either wrong name, at HEAD and at the SHA each
 * census pins — so they were never right, not drifted. Both are corrected in those files.
 *
 * ⚠ AND THE OBVIOUS CHECK OF THE OTHER SEVEN IS THE WRONG ONE, WHICH IS WHY IT IS WRITTEN DOWN.
 * Track's four pointers carry LINE NUMBERS, and comparing them against the `func` declarations
 * (315/349/428/548) makes all four look stale. They are not: they point at the
 * `callAnthropicViaLens` / `callEmbeddingsViaLens` CALL lines, exactly as that header's arrows
 * say, and all four are correct at both SHAs. A pointer read against the wrong target reports a
 * finding that is not there.
 *
 * WHAT R8 ENFORCES, AND WHAT IT DELIBERATELY DOES NOT. This repo's CI clones only itself, so it
 * cannot execute an upstream check — that is the whole reason the `cannot` half exists. What it
 * CAN decide is whether each upstream file a census names is a DECLARED SUBJECT of some settle
 * command, so a deployer running the register is running something that covers it, and so a new
 * census row cannot arrive with nothing in the register pointing at its file. R8 is a
 * reachability rule of exactly the same kind as R6, one repository boundary further out.
 */
/**
 * ⚠ THE REPO IS PART OF THE KEY, AND THE FIRST CUT OF THIS RULE LEFT IT OUT — CAUGHT BY ITS OWN
 * CONTROL, NOT BY READING. Both censuses name `internal/ai/engine.go`: one in talyvor-docs, one in
 * talyvor-track. Joined on the BARE PATH, deleting the Docs settle command scored GREEN, because
 * the Track entry declares a file of the same name in a different repository. The rule would have
 * reported every upstream pointer covered with half the register gone. Which repo a census speaks
 * for is not written in the row — it is the directory the census lives in, so it is derived here
 * and the pair is what gets joined.
 */
const CENSUS_FILES = [
  { repo: 'talyvor-docs', file: resolve(import.meta.dirname, 'areas/docs/meteredCostCensus.test.tsx') },
  { repo: 'talyvor-track', file: resolve(import.meta.dirname, 'areas/track/meteredCostCensus.test.tsx') },
]
/** `upstream: 'internal/ai/engine.go:320#Engine.TriageIssue',` → `internal/ai/engine.go` */
const UPSTREAM_FIELD = /upstream:\s*'([^']+)'/g
const upstreamFiles = (): { census: string; repo: string; path: string; symbol: string }[] => {
  const out: { census: string; repo: string; path: string; symbol: string }[] = []
  for (const c of CENSUS_FILES) {
    const src = readFileSync(c.file, 'utf8')
    for (const m of src.matchAll(UPSTREAM_FIELD)) {
      const [locus, symbol] = m[1].split('#')
      out.push({
        census: c.file.slice(c.file.lastIndexOf('/areas/')),
        repo: c.repo,
        path: locus.split(':')[0],
        // `Engine.TriageIssue` → `TriageIssue`; `SemanticSearch.embed` → `embed`. The receiver is
        // dropped because a settle command greps the DECLARATION, where the receiver is spelled
        // `(e *Engine)` rather than `Engine.`.
        symbol: (symbol ?? '').split('.').pop() ?? '',
      })
    }
  }
  return out
}

describe('R8 — every metered census names an upstream file the register can settle', () => {
  /**
   * The vacuity floor, and it is the one that matters: the rule below iterates this list, so a
   * census renamed or an `upstream:` field that stops matching empties it and this block reports
   * a clean join having read nothing. NINE measured at `d9060ae` — five Docs, four Track. Named
   * as a literal, never derived from the parse it polices.
   */
  it('parses an upstream pointer out of every metered census row', () => {
    expect(
      upstreamFiles().length,
      'fewer `upstream:` fields parsed than the two metered censuses declare. Either rows were ' +
        'deleted, or the field changed shape — which silently empties the rule below.',
    ).toBeGreaterThanOrEqual(9)

    // ⚠ AND EVERY POINTER MUST RESOLVE TO A SYMBOL, RATHER THAN BEING SKIPPED WHEN IT DOES NOT.
    // A row whose `upstream` names only a file cannot be settled at the granularity the rule
    // below joins on, and the quiet way to handle that is to let it through — which is the #274
    // defect exactly: a population that silently excuses what it cannot resolve. It refuses.
    const symbolless = upstreamFiles().filter((u) => u.symbol === '')
    expect(
      symbolless.map((u) => `${u.census} -> ${u.path}`),
      'these `upstream` pointers name a file and no `#Symbol`, so the rule below cannot ask ' +
        'whether any settle command looks at the call site this row rests on. Name the symbol.',
    ).toEqual([])
  })

  it('every upstream file a census names is a declared subject of a settle command', () => {
    // ⚠ THE JOIN IS ON THE SYMBOL, NOT THE FILE, AND THAT IS THE SECOND THING A CONTROL TAUGHT
    // THIS RULE. Joined on (repo, file) alone, deleting the Track settle command scored GREEN:
    // `talyvor-track internal/ai/engine.go` is ALREADY a declared subject of a PRE-EXISTING entry
    // about a different premise entirely. "Some command mentions this file" and "a command
    // settles this row's premise" are different claims, and a file-level join cannot tell them
    // apart — it would report every metered pointer covered by entries that never look at
    // metering. So the entry must declare the file for that repo AND its command must NAME the
    // symbol the row points at.
    const orphans = upstreamFiles().filter(
      (u) =>
        !WITH_SUBJECTS.some(
          (w) => w.repo === u.repo && w.paths.includes(u.path) && w.entry.command.includes(u.symbol),
        ),
    )
    expect(
      [...new Set(orphans.map((u) => `${u.census} -> ${u.repo} ${u.path}#${u.symbol}`))],
      'these upstream call sites are what make a surface METERED, and no `cannot` entry in ' +
        'deploy/decision-expiry.sh both declares the file for that repository AND names the ' +
        'symbol in its command. Nothing in either repository asks whether that call site still ' +
        'exists or still bills under the tag the card prints — which is how two of the nine came ' +
        'to name a function upstream does not declare. Add a settle command whose `where` field ' +
        'names the file and whose command greps the symbol, and verify it by RUNNING it against ' +
        'a read-only checkout of that repo.',
    ).toEqual([])
  })
})

describe('the extraction-shape rule still refuses the form it was written for', () => {
  it('EXTRACT_COMPARES accepts both quoting forms and rejects an uncaptured pipeline', () => {
    // The two accepted forms — same property, different shell quoting.
    expect(EXTRACT_COMPARES.test('[ "$(grep -oE \'json:"[a-z_]+\' f.go | sort -u)" = "a b c" ]')).toBe(true)
    expect(EXTRACT_COMPARES.test('[ "$(grep -oE \'"x"\' f.go | sort -u)" = \'"a" "b"\' ]')).toBe(true)
    // ⚠ THE ONE IT EXISTS TO REFUSE: the extraction run for its exit status, compared to nothing.
    // Every stage writes an empty line and exits 0 with the file absent.
    expect(EXTRACT_COMPARES.test('grep -oE \'json:"[a-z_]+\' f.go | sort -u && echo ok')).toBe(false)
    // And a capture compared to a BARE word rather than a written-down literal.
    expect(EXTRACT_COMPARES.test('[ "$(grep -o x f.go)" = x ]')).toBe(false)
  })
})
