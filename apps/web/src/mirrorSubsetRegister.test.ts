import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * TWO FILES SAID THEY MIRRORED AN UPSTREAM STRUCT **VERBATIM** AND BOTH WERE MISSING FIELDS THAT
 * ARE ON EVERY RESPONSE.
 *
 * ── THE FINDING THIS EXISTS FOR ──────────────────────────────────────────────
 *
 * MEASURED, not read: `areas/track/types.ts` headed itself "JSON-verbatim from talyvor-track @
 * a3bc7b2 … Field names and optionality mirror the Go structs' json tags exactly — so the day the
 * BFF proxies these routes, the fixture types are already the live types." At talyvor-track
 * `6bf443a` its `TrackIssue` was missing NINE of `model.Issue`'s thirty json fields:
 *
 *     labels          sort_order            ← NO omitempty: on EVERY issue response
 *     milestone_id?   field_values?   is_blocked?   relations?
 *     time_tracked_sec?   rice_score?   ice_score?
 *
 * `areas/docs/api.ts` headed itself "Shapes mirror talyvor-docs internal/model/model.go VERBATIM
 * (field-for-field, at e0cf605), so wiring the tree and reader is adding a fetch — the types
 * already speak the upstream shape." At talyvor-docs `d89a005` its `DocsPage` was missing
 * `own_ai_cost_usd` and `total_ai_cost_usd` — both without omitempty, so both on every page
 * response, and one of them is the column suite #204 registered a whole premise about.
 *
 * ⚠ NEITHER IS A LIVE BUG. The BFF streams these bodies verbatim, so the extra keys arrive and are
 * simply invisible to TypeScript. What is false is the SENTENCE, and specifically its second half:
 * "the types ARE ALREADY the live types" is a present-tense operational promise, and the next
 * person to wire a screen reads it instead of the upstream. That is the same decay
 * `upstreamCitations.test.ts` was written about, wearing a different form — a sha and the word
 * VERBATIM rather than a line number — which is exactly why that guard could not see it.
 *
 * ⚠ AND THE HANDOVER'S CENSUS WAS SHORT, WHICH IS WHY THIS FILE HOLDS A TABLE AND NOT TWO CASES.
 * The two files above were handed on. A sweep for cross-repo shape claims found FIVE, and
 * measuring all of them changed the answer twice:
 *
 *   · `areas/lens/Members.tsx#RosterMember` and `lib/api.ts#LXCSnapshot` MATCH their upstreams
 *     today — and neither names the commit it was true at, which is weaker than a stale sha, not
 *     stronger. They are in the table.
 *   · `lib/api.ts#LensBalance.held_balance_ulens` is `?:` against a Go field with NO omitempty —
 *     a divergence my extractor flagged and the file itself EXPLAINS twenty lines below the
 *     header: "Optional because a Lens older than the change that added it omits the field; `?? 0`
 *     at the read sites is a deployment-skew tolerance, not a default." A deliberate, documented,
 *     load-bearing divergence. It is NOT a defect and it is NOT in the table — a rule that made a
 *     considered tolerance into a red would be read as noise and then routed around.
 *
 * ── WHY THE FIX IS A DECLARED SUBSET AND NOT NINE MORE FIELDS ────────────────
 *
 * Adding the nine to `TrackIssue` makes the sentence true this afternoon and re-arms the identical
 * trap on the next upstream field, with still nothing watching — the shape
 * `upstreamCitations.test.ts` rejected when it refused to "fix" seven wrong line numbers by
 * correcting them. Worse, four of the nine (`field_values`, `relations`, …) have shapes this
 * repository would have to guess at, and a guessed type is a claim about another repo written in
 * the one place TypeScript will enforce it.
 *
 * So each mirror DECLARES its omissions by name, in its own file, and the claim becomes checkable
 * in two halves that meet in the middle:
 *
 *   the interface's own fields  ∪  its declared UPSTREAM-ONLY names
 *      =  the field list the deploy register tells a deployer to check upstream
 *
 * The left half is parsed out of TypeScript, the right half out of `deploy/decision-expiry.sh`.
 * Neither is a third copy of anything: the register's command reads the Go struct's json tags out
 * of the upstream file and compares them to that union, so `git grep`-able truth on both sides.
 *
 * ── WHAT THIS GUARD CLAIMS, PRECISELY ────────────────────────────────────────
 *
 * It does NOT claim any interface here matches its upstream. Nothing in this repository's CI can:
 * CI checks out this repository alone, and a guard that reads a sibling repo WHEN PRESENT is inert
 * in CI, which is the one place it would have to fire — `topUpMirrorRegister.test.ts` measured
 * exactly that and moved its premise to the register for it. This claims one link: the field list
 * the deployer's command asks talyvor-track / talyvor-docs about is the field list this repo
 * believes in. An entry naming a stale set settles the wrong question and reports a pass for it.
 *
 * It also claims the two halves cannot contradict each other silently: a name cannot be declared
 * UPSTREAM-ONLY while the interface mirrors it, and a file that declares omissions cannot go on
 * telling its reader it mirrors upstream VERBATIM.
 *
 * ⚠ WHAT IT CANNOT SEE, said out loud so the scope is not mistaken for coverage. A field DELETED
 * from a TS interface and added to its UPSTREAM-ONLY list in the same change is not a red — the
 * union is unchanged, and from here that is indistinguishable from a deliberate narrowing. Only
 * running the register's command upstream tells those apart. That direction is the register's job
 * and it is why these entries exist at all.
 *
 * ⚠ THE FLOORS ARE NOT DECORATION. Both sides are parsed out of source, so a rename, a reformat or
 * a deleted entry yields no match — at which point a set equality over two empty sets passes
 * having read nothing. Every parse asserts it found EXACTLY ONE subject, so the ways this guard
 * can stop seeing are reds rather than silences.
 */

const ROOT = resolve(import.meta.dirname, '../../..')
const REGISTER = resolve(ROOT, 'deploy/decision-expiry.sh')

interface Mirror {
  /** repo-relative path of the file that declares the mirror */
  file: string
  /** the exported TypeScript interface */
  iface: string
  /** the upstream repository, as the register names it */
  repo: string
  /** the upstream file, as the register's command greps it */
  path: string
  /** the Go struct whose json tags the interface mirrors */
  struct: string
}

/**
 * Every cross-repo struct mirror in this repository, measured by sweeping for shape claims rather
 * than taken from the handover. `lib/api.ts#LensBalance` is deliberately absent — see the header.
 */
const MIRRORS: Mirror[] = [
  { file: 'apps/web/src/areas/track/types.ts', iface: 'TrackWorkspace', repo: 'talyvor-track', path: 'internal/model/model.go', struct: 'Workspace' },
  { file: 'apps/web/src/areas/track/types.ts', iface: 'TrackIssue', repo: 'talyvor-track', path: 'internal/model/model.go', struct: 'Issue' },
  { file: 'apps/web/src/areas/track/types.ts', iface: 'TrackComment', repo: 'talyvor-track', path: 'internal/model/model.go', struct: 'Comment' },
  { file: 'apps/web/src/areas/track/types.ts', iface: 'TrackTeam', repo: 'talyvor-track', path: 'internal/model/model.go', struct: 'Team' },
  { file: 'apps/web/src/areas/track/types.ts', iface: 'TrackMember', repo: 'talyvor-track', path: 'internal/member/mgmt_handler.go', struct: 'memberView' },
  { file: 'apps/web/src/areas/docs/api.ts', iface: 'DocsSpace', repo: 'talyvor-docs', path: 'internal/model/model.go', struct: 'Space' },
  { file: 'apps/web/src/areas/docs/api.ts', iface: 'DocsPage', repo: 'talyvor-docs', path: 'internal/model/model.go', struct: 'Page' },
]

/** Words that assert the mirror IS its upstream. A mirror file's header may not use them. */
const IDENTITY_WORDS = ['verbatim', 'field-for-field', 'exactly']

/**
 * A header with its DOUBLE-QUOTED SPANS REMOVED — a quotation is not an assertion.
 *
 * ⚠ THIS IS AN ESCAPE HATCH AND IT IS NAMED RATHER THAN HIDDEN. Both headers below retract the
 * false sentence by QUOTING it, which this repo prefers to deleting it, so the literal word
 * `verbatim` survives in the file that must no longer claim it. Stripping quotations is the only
 * form of that exception I could state mechanically. The cost is real: an author who writes an
 * identity claim inside quotation marks is not caught. What is caught is the case the finding is
 * made of — a header stating, in its own voice, that the interfaces below ARE the upstream struct.
 */
function unquoted(header: string): string {
  return header.replace(/"[\s\S]*?"/g, ' ')
}

const sourceOf = new Map<string, string>()
function source(file: string): string {
  const hit = sourceOf.get(file)
  if (hit !== undefined) return hit
  const text = readFileSync(resolve(ROOT, file), 'utf8')
  sourceOf.set(file, text)
  return text
}

/**
 * The declared fields of an exported interface, in the wire spelling the register's command reads
 * off the Go struct: `name` for a required key, `name,omitempty` for a `?:` one.
 *
 * Nested object literals would break the brace match, so the parse stops at the first line that is
 * exactly `}` — every mirror here is flat, and one that stops being flat parses short and reds on
 * the union rather than silently dropping a field.
 */
function interfaceFields(file: string, iface: string): string[] | null {
  const lines = source(file).split('\n')
  const start = lines.findIndex((l) => l.startsWith(`export interface ${iface} {`))
  if (start === -1) return null
  const out: string[] = []
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i] === '}') return out
    const m = /^ {2}([a-z_][a-z0-9_]*)(\??):/.exec(lines[i])
    if (m) out.push(m[2] === '?' ? `${m[1]},omitempty` : m[1])
  }
  return null
}

/**
 * The names a mirror file declares as present upstream and deliberately NOT mirrored:
 *
 *     UPSTREAM-ONLY TrackIssue: labels, sort_order, milestone_id?, …
 *     UPSTREAM-ONLY TrackTeam: none
 *
 * `?` means the upstream tag carries omitempty, the same convention the interfaces use. The
 * capture accepts only lowercase names, `?`, commas, whitespace and the comment gutter, so it ends
 * at the first word of the sentence that follows and cannot swallow prose. `none` is spelled out
 * rather than left blank: a missing declaration must be distinguishable from an empty one, and an
 * absent line is a red.
 */
function upstreamOnly(file: string, iface: string): string[] | null {
  const re = new RegExp(`UPSTREAM-ONLY ${iface}:([a-z0-9_?,\\s*]*)`, 'g')
  const hits = [...source(file).matchAll(re)]
  if (hits.length !== 1) return null
  const names = hits[0][1]
    .replace(/\*/g, ' ')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
  if (names.length === 1 && names[0] === 'none') return []
  if (names.some((n) => !/^[a-z_][a-z0-9_]*\??$/.test(n))) return null
  return names.map((n) => (n.endsWith('?') ? `${n.slice(0, -1)},omitempty` : n))
}

/**
 * The double-quoted arguments of every `cannot` call in the register: DECISION, PREMISE, COMMAND.
 * Unescaped by bash's own rule for a double-quoted string — a backslash escapes only `$`, a
 * backtick, `"` and `\`, and before anything else it stays a literal backslash, which is what
 * keeps a grep pattern's `\[` a `\[`.
 */
function cannotCalls(shell: string): string[][] {
  const joined = shell.replace(/\\\n\s*/g, ' ')
  const out: string[][] = []
  for (const line of joined.split('\n')) {
    if (!line.startsWith('cannot ')) continue
    const args: string[] = []
    let i = 0
    while (i < line.length) {
      if (line[i] !== '"') {
        i += 1
        continue
      }
      i += 1
      let buf = ''
      while (i < line.length && line[i] !== '"') {
        if (line[i] === '\\') {
          if (!'$`"\\'.includes(line[i + 1] ?? '')) buf += line[i]
          i += 1
          if (i < line.length) {
            buf += line[i]
            i += 1
          }
          continue
        }
        buf += line[i]
        i += 1
      }
      i += 1
      args.push(buf)
    }
    if (args.length >= 3) out.push(args)
  }
  return out
}

const ENTRIES = cannotCalls(readFileSync(REGISTER, 'utf8'))

/** The register entry for one mirror: the command names the upstream path and the struct. */
function entryFor(m: Mirror): string[] | null {
  const hits = ENTRIES.filter(
    (a) => a[2].includes(m.path) && a[2].includes(`type ${m.struct} struct`),
  )
  return hits.length === 1 ? hits[0] : null
}

/** The field list a settle command compares the upstream struct's json tags against. */
function expectedInCommand(command: string): string[] | null {
  const m = /=\s*"([a-z0-9_,\s]*)"\s*\]/.exec(command)
  if (!m) return null
  const names = m[1].split(/\s+/).filter((s) => s !== '')
  return names.length === 0 ? null : names
}

describe('every cross-repo struct mirror is still readable from both sides', () => {
  for (const m of MIRRORS) {
    describe(`${m.file}#${m.iface} ↔ ${m.repo} ${m.struct}`, () => {
      it('the interface parses, with at least one field', () => {
        expect(
          interfaceFields(m.file, m.iface),
          `\`export interface ${m.iface}\` did not parse out of ${m.file}. Every rule below ` +
            'compares that interface against a field list in deploy/decision-expiry.sh; with ' +
            'nothing parsed the comparison is between two empty sets and passes having read ' +
            'nothing. Re-anchor the parse deliberately, or drop this mirror from the table and ' +
            'delete its register entry in the same change.',
        ).not.toBeNull()
      })

      it('the file declares which upstream fields it does NOT mirror', () => {
        expect(
          upstreamOnly(m.file, m.iface),
          `${m.file} holds no single \`UPSTREAM-ONLY ${m.iface}: …\` declaration. This mirror ` +
            'copies a struct out of another repository, so the only checkable form of the claim ' +
            'is: these fields, plus these named omissions, are the whole upstream struct. ' +
            'Without the declaration the file is back to asserting an identity nothing can ' +
            "check — which is the finding this guard exists for. Write `none` where there is " +
            'nothing omitted; a blank is not a declaration.',
        ).not.toBeNull()
      })

      it('nothing is declared UPSTREAM-ONLY while the interface mirrors it', () => {
        const fields = interfaceFields(m.file, m.iface) ?? []
        const omitted = upstreamOnly(m.file, m.iface) ?? []
        const bare = (s: string) => s.split(',')[0]
        const mirrored = new Set(fields.map(bare))
        expect(
          omitted.map(bare).filter((n) => mirrored.has(n)),
          `${m.file} declares a field as present upstream and NOT mirrored, and ${m.iface} ` +
            'mirrors it. The two halves of the claim contradict each other, and a reader ' +
            'believes whichever they read first. If the field was added to the interface, drop ' +
            'it from the UPSTREAM-ONLY list in the same change.',
        ).toEqual([])
      })

      it('deploy/decision-expiry.sh holds exactly one settle command for it', () => {
        expect(
          entryFor(m),
          `no single \`cannot\` entry in deploy/decision-expiry.sh names both \`${m.path}\` and ` +
            `\`type ${m.struct} struct\`. This repository's CI cannot read ${m.repo}, so that ` +
            'entry is the ONLY thing that asks a deployer whether the mirror is still whole. ' +
            'Without it the mirror is guarded by a sentence in its own header — which is the ' +
            'defect this guard was written for, arriving back.',
        ).not.toBeNull()
      })

      it('the deployer is asked about the field set this repo actually believes in', () => {
        const fields = interfaceFields(m.file, m.iface)
        const omitted = upstreamOnly(m.file, m.iface)
        const entry = entryFor(m)
        expect(fields, 'the interface must parse before its union means anything').not.toBeNull()
        expect(omitted, 'the omissions must parse before their union means anything').not.toBeNull()
        expect(entry, 'the register entry must parse before it can be compared').not.toBeNull()
        const inCommand = expectedInCommand(entry?.[2] ?? '')
        expect(
          inCommand,
          'the settle command holds no `[ "$(…)" = "…" ]` expectation, so it is not comparing ' +
            'the upstream json tags to anything. A command that reads an exit status here is ' +
            'the `grep -c` hazard in a new coat: the pipeline exits 0 whether or not the struct ' +
            'was found.',
        ).not.toBeNull()
        expect(
          inCommand,
          `deploy/decision-expiry.sh asks ${m.repo} about a different set of fields than ` +
            `${m.iface} plus its declared omissions describe. A deployer running that command ` +
            'gets a confident yes about a struct this repo does not believe in — a pass for the ' +
            'wrong question, which is worse than no entry at all. The union is the whole claim: ' +
            'change the interface or the UPSTREAM-ONLY line, and change the command with it.',
        ).toEqual([...(fields ?? []), ...(omitted ?? [])].sort())
      })
    })
  }
})

describe('a file that declares omissions no longer tells its reader it mirrors upstream whole', () => {
  const files = [...new Set(MIRRORS.map((m) => m.file))]
  for (const file of files) {
    it(`${file} — its header claims a subset, not an identity`, () => {
      const header = unquoted(source(file).split(/^(?:import|export)\b/m)[0] ?? '')
      expect(
        IDENTITY_WORDS.filter((w) => header.toLowerCase().includes(w)),
        `${file}'s header asserts it mirrors an upstream struct whole. That sentence is what ` +
          'the next person to wire a screen reads instead of the upstream — it is the entire ' +
          'finding: "the types are already the live types" was written while nine fields were ' +
          'missing, and no local change could ever make it false. The rule is unconditional ' +
          'rather than "only when omissions are declared", because that version PASSED VACUOUSLY ' +
          'on the tree with no declarations at all — green in precisely the state it exists for. ' +
          'Say SUBSET, name the omissions, and point at the register entry that settles them. ' +
          'A QUOTATION of the retracted sentence is not an assertion and is not counted — see ' +
          '`unquoted` above, where that exception is stated rather than left implicit.',
      ).toEqual([])
    })
  }
})
