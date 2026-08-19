import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `apps/bff/docs_search.go` MAKES FIVE CLAIMS ABOUT talyvor-docs AND NOTHING ASKS talyvor-docs.
 *
 * ── WHY THIS FILE, AND WHY IT IS NOT A DIFF ──────────────────────────────────
 *
 * The measurement that put these entries here is a NEGATIVE one, the same shape that put
 * `lib/api.ts`'s four Lens mirrors in the register: ALL FIVE CLAIMS RUN TRUE against talyvor-docs
 * `8189d7b53892f7f37e9756c5fe68e3cdd2c547da` today. Nothing to fix in the claims; everything to fix
 * in the fact that nothing was watching them.
 *
 * ⚠ MEASURED BY EXECUTING docs' OWN `search.Handler.Search`, not read off the comments beside the
 * constants (a `git archive` scratch export in /tmp — talyvor-docs was held by another tab and was
 * NEVER written to). A recording full-text store, a recording `pgxDB`, and an httptest server
 * standing in for the Lens embeddings endpoint, so "which half ran" is an observation and not an
 * inference:
 *
 *     type=banana / ALL / Fulltext / full-text →  200 {"results":[],"total":0}, ft NOT called,
 *                                                 0 embeddings — NEITHER half ran
 *     type absent / type=all                   →  ft(limit 10, offset 0) AND 1 embedding
 *     type=fulltext&limit=5&offset=7           →  ft(5, 7)             — the offset reached SQL
 *     type=semantic&limit=5&offset=7           →  pgvector LIMIT 5 OFFSET 7
 *     type=all&limit=5&offset=7                →  ft(12, 0), pgvector LIMIT 12 OFFSET 0
 *     type=all&limit=10&offset=45              →  ft(50, 0)            — the 50-row merged window
 *     type=fulltext&limit=10&offset=90         →  ft(10, 90)           — single-source pages past it
 *
 * ⚠ AND THE NEGATIVES HAVE AN INSTRUMENT CONTROL, because "the sixth key was ignored" and "the
 * recorder cannot see any key" produce the same line. `type=semantic&space_id=sp-1` puts a non-nil
 * space into the pgvector query's $4; `space=sp-1` and `spaceId=sp-1` leave it nil. So the recorder
 * can tell a key that IS read from one that is not, which is what makes `sort`, `author` and
 * `highlight` landing on nothing a measurement rather than a blind spot.
 *
 * ── WHY A QUERY PARAMETER IS THE WORST CASE OF THIS WHOLE CLASS ──────────────
 *
 * A response shape that drifts renders a blank field. A request BODY key that drifts is a 200 with
 * a billed completion that read nothing (#234). A query PARAMETER that drifts is worse than both:
 * `r.URL.Query().Get` returns "" for a renamed key and Docs then DEFAULTS `type` to `all`, so a
 * renamed `type` upstream means `type=semantic` silently stops asking for the semantic half — and
 * the answer is a 200 of full-text rows BYTE-IDENTICAL to a correct one. Semantic search is one of
 * W1.7's eight AI features and its half embeds the query through Lens on every call, so this sits
 * on a metered path as well as a silent one.
 *
 * ── WHAT THIS GUARD CLAIMS, PRECISELY ───────────────────────────────────────
 *
 * It does NOT claim any of the five is true — nothing in this repository can check that. CI checks
 * out this repo alone, which is why these premises are in the register's UNCHECKABLE half at all.
 * It claims ONE link, the same one `mirrorSubsetRegister.test.ts` and `aiRequestBodyRegister.test.ts`
 * claim for responses and request bodies: the thing the deployer's command asks talyvor-docs about
 * is the thing this repository actually depends on. An entry naming a stale window, a stale key set
 * or a stale type set settles the wrong question and reports a pass for it.
 *
 * ⚠ THE POPULATIONS ARE DERIVED FROM `docs_search.go`, NOT TYPED INTO THE TABLE. The wire keys come
 * from the route's own `out.Set(…)` calls, the discriminator from `docsSearchTypes`, the window from
 * `docsSearchMergedWindow`, and the behavioural half from every `docsSearch*Refusal` constant the
 * file declares. Add a sixth parameter, a fourth type, or a third refusal resting on an upstream
 * behaviour and this goes red without anyone having to remember that it should.
 *
 * ⚠ WHAT IT CANNOT SEE, SAID OUT LOUD SO THE SCOPE IS NOT MISTAKEN FOR COVERAGE.
 *   · A value changed in BOTH this repo and the register in one change is not a red here — from
 *     inside this repository that is indistinguishable from a correct change. Only running the
 *     command in a talyvor-docs checkout tells them apart. That direction is the register's job.
 *   · The two REFUSAL entries are held to the constants existing and being used, not to their
 *     wording. A refusal whose prose drifts from what it refuses is not visible here.
 *   · CONTROL B1, run and recorded rather than reasoned about: the `type` entry pins the SHAPE of
 *     docs' two dispatch arms, so an upstream `else` branch that runs a half for an unrecognised
 *     type leaves both arms untouched and the command GREEN. Predicted green, measured green. It is
 *     a boundary of that command, and it is written here rather than discovered by someone
 *     trusting it.
 *
 * ⚠ THE FLOORS ARE NOT DECORATION. Every half of every rule is parsed out of source, so a rename or
 * a reformat yields no match — at which point a set equality over two empty sets passes having read
 * nothing. Each parse asserts it found something, and the register is asserted to hold EXACTLY as
 * many docs-search entries as this table has rows, in both directions.
 *
 * ⚠ CONTROLS ON THIS GUARD: 11 caught, 1 predicted-green, 0 anomalies
 * (`apps/web/scripts/w171-docs-search-register-controls.py`), each mutation alone, the FULL
 * apps/web suite every time so "nothing else catches it" is measured, verdict predicted BEFORE the
 * run, every file restored in a `finally` and sha256-verified back. A sixth parameter on the wire ·
 * a fourth type accepted · the window moved to 40 · a third refusal with no entry · a refusal no
 * longer written to a caller · the window entry deleted · the key-set expectation narrowed · the
 * type entry's pattern re-aimed (the entry still EXISTS and still COUNTS, so only the marker match
 * can catch it) · the window entry's expectation moved while the constant stays · **the wire-query
 * builder renamed so `out.Set` parses to nothing** · **the type map renamed** — all RED, the last
 * two the vacuity cases. A reworded comment — GREEN.
 *
 * ⚠⚠ FOUR OF THEM WERE BLINDED — the same defect with this file REMOVED — and the PROJECT WAS
 * GREEN for every one: a sixth wire parameter, a fourth type, a moved window, and a narrowed
 * register expectation are watched by nothing else in this repository. "Caught" here is this
 * guard's, not the suite's.
 *
 * ⚠⚠ AND ONE CONTROL FAILED FIRST, WHICH IS THE PART WORTH READING. G5 — the refusal still
 * declared but no longer WRITTEN to a caller — left this guard GREEN. Its usage rule counted
 * MENTIONS of the constant's name, and the doc comment above `docsSearchTypeRefusal` opens by
 * naming it, so the rule was satisfied for free by every documented constant and could not fail for
 * the defect it was written for. Comments and the declaration line are excluded now, and the
 * measurement is written beside `refusalUses` rather than the count quietly lowered.
 *
 * ⚠ CONTROLS ON THE FIVE COMMANDS THEMSELVES: 14 caught, 2 predicted-green, 0 anomalies
 * (`~/talyvor-queue/w171-docssearch-register-controls-4b7e.py`), verdict predicted BEFORE each run,
 * every mutation restored in a `finally` and sha256-verified back. Mutating the upstream export:
 * the window number moved · `maxFetchRows` renamed · `space_id` renamed · a SIXTH key read · the
 * offset key deleted · a FOURTH type accepted · `semantic` renamed · the empty default removed ·
 * either dispatch arm inverted to a negation · `sqlOffset` starting at 0 · the window ceasing to be
 * `offset+limit` · **the Search FUNCTION renamed** · **the handler file EMPTIED** — all RED, the
 * last two the vacuity cases a command that finds nothing must not pass. A reworded comment — GREEN.
 */

const ROOT = resolve(import.meta.dirname, '../../..')
const REGISTER = resolve(ROOT, 'deploy/decision-expiry.sh')
const ROUTE_REL = 'apps/bff/docs_search.go'

const register = readFileSync(REGISTER, 'utf8')
const route = readFileSync(resolve(ROOT, ROUTE_REL), 'utf8')

/** The talyvor-docs file every one of these commands greps, as the register spells it. */
const UPSTREAM = 'internal/search/handler.go'

interface Claim {
  /** what this repo does BECAUSE the premise holds, for failure messages */
  decision: string
  /**
   * The `grep -o` pattern the command must extract with, quotes included. It is the row's key, and
   * the closing quote is load-bearing: the `type`-set pattern is a strict prefix of the
   * dispatch-arm one, so a `.includes` on the pattern alone matches two entries and reads as "no
   * entry" rather than "the matcher is wrong".
   */
  marker: string
}

const CLAIMS: Claim[] = [
  {
    decision: 'docsSearchMergedWindow — the 50-row ceiling the two-source refusal is written against',
    marker: "grep -o 'maxFetchRows *= *[0-9]*'",
  },
  {
    decision: 'the query is REBUILT from exactly the keys Docs reads, so a sixth cannot travel to be ignored',
    marker: "grep -o 'URL.Query().Get(.[a-z_]*.)'",
  },
  {
    decision: 'docsSearchTypes — the closed set this route answers 400 for anything outside of',
    marker: "grep -o 'kind == .[a-z]*.'",
  },
  {
    decision: 'docsSearchTypeRefusal — an unrecognised type runs NEITHER half and answers 200 with an empty list',
    marker: "grep -o 'if kind == .[a-z]*. || kind == .[a-z]*. {'",
  },
  {
    decision: 'docsSearchWindowRefusal exempts the single-source path, because upstream pages it in SQL',
    marker: "grep -o 'twoSources := kind == .[a-z]*.\\|sqlOffset := offset\\|sqlOffset = 0\\|window = offset + limit'",
  },
]

/**
 * The double-quoted arguments of every `cannot` call, unescaped by bash's own rule for a
 * double-quoted string — a backslash escapes only `$`, a backtick, `"` and `\`, and before anything
 * else it stays a literal backslash, which is what keeps a grep pattern's `\|` a `\|`.
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

const ENTRIES = cannotCalls(register)
/** Every register entry that settles a premise out of docs' search handler. */
const SEARCH_ENTRIES = ENTRIES.filter((a) => a[2].includes(UPSTREAM))

function entryFor(c: Claim): string[] | null {
  const hits = SEARCH_ENTRIES.filter((a) => a[2].includes(c.marker))
  return hits.length === 1 ? hits[0] : null
}

/** The value a settle command compares its extraction against: `[ "$(…)" = "…" ]`. */
function expectedInCommand(command: string): string | null {
  const m = /=\s*"([^"]*)"\s*\]/.exec(command)
  return m ? m[1] : null
}

// ── THE POPULATIONS, DERIVED FROM apps/bff/docs_search.go ────────────────────

/** The query keys this route puts on the wire. `out` is the rebuilt query — see the route. */
function wireKeys(): string[] {
  const keys = [...route.matchAll(/out\.Set\("([a-z_]+)"/g)].map((m) => m[1])
  return [...new Set(keys)].sort()
}

/** The discriminator this route refuses outside of. */
function declaredTypes(): string[] {
  const m = /docsSearchTypes = map\[string\]bool\{([^}]*)\}/.exec(route)
  if (!m) return []
  return [...m[1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]).sort()
}

/** The merged-window constant, as a string. */
function declaredWindow(): string | null {
  const m = /const docsSearchMergedWindow = (\d+)/.exec(route)
  return m ? m[1] : null
}

/**
 * Every refusal this route serves that rests on an UPSTREAM BEHAVIOUR rather than on a shape. Each
 * one is a sentence shown to a caller, so a premise that moves turns it into a confident lie about
 * another repository. Derived, so a third refusal cannot be added without an entry.
 */
function refusalConstants(): string[] {
  return [...route.matchAll(/const (docsSearch\w*Refusal)\b/g)].map((m) => m[1]).sort()
}

/**
 * How many times a refusal constant is used in EXECUTABLE source — its own declaration line and
 * every comment line excluded.
 *
 * ⚠ THE FIRST VERSION OF THIS COUNTED MENTIONS AND THE CONTROL IS WHAT SAID SO. It asked for more
 * than one occurrence of the name anywhere in the file, which every declared constant satisfies for
 * free: the doc comment above `docsSearchTypeRefusal` opens by naming it. Control G5 — the refusal
 * still declared but no longer WRITTEN to a caller, replaced at the call site by a bare literal —
 * left the count at 2 and the guard GREEN. A rule that a documented constant passes for every value
 * of the code is not a rule; it is the shape of guard this repository keeps finding. Comments are
 * stripped, the declaration is excluded, and one real use is the floor.
 */
function refusalUses(name: string): number {
  const body = route
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .filter((l) => !new RegExp(`^const ${name}\\b`).test(l.trim()))
    .join('\n')
  return [...body.matchAll(new RegExp(`\\b${name}\\b`, 'g'))].length
}

describe('every cross-repo claim apps/bff/docs_search.go makes is a question the register asks', () => {
  it('parses the route file at all', () => {
    expect(
      route.length,
      `${ROUTE_REL} read as empty. Every population below is derived from it, so an empty parse ` +
        'turns each rule into a comparison of two empty sets that passes having read nothing.',
    ).toBeGreaterThan(0)
  })

  for (const claim of CLAIMS) {
    describe(claim.decision, () => {
      it('deploy/decision-expiry.sh holds exactly one settle command for it', () => {
        expect(
          entryFor(claim),
          `no single \`cannot\` entry in deploy/decision-expiry.sh extracts with \`${claim.marker}\` ` +
            `out of \`${UPSTREAM}\`. This repository's CI cannot read talyvor-docs, so that entry ` +
            'is the ONLY thing that asks a deployer whether this premise still holds. Without it ' +
            'the claim is a sentence in a Go comment — and on this route a premise that has moved ' +
            'is a 200 that is byte-identical to a correct answer.',
        ).not.toBeNull()
      })

      it('the command compares its extraction instead of trusting the pipeline', () => {
        const entry = entryFor(claim)
        expect(entry, 'the entry must parse before its shape means anything').not.toBeNull()
        expect(
          expectedInCommand(entry?.[2] ?? ''),
          'the settle command holds no `[ "$(…)" = "…" ]` expectation, so it is not comparing ' +
            'what it extracted to anything. Every stage of a `sed | grep -o` pipeline exits 0 ' +
            'while writing an empty line, so a command that reads an exit status confirms a ' +
            'premise it never looked at.',
        ).not.toBeNull()
      })
    })
  }

  it('the deployer is asked about the window this route actually refuses on', () => {
    const window = declaredWindow()
    expect(
      window,
      `no \`const docsSearchMergedWindow = <n>\` parsed out of ${ROUTE_REL}. The comparison below ` +
        'is what keeps the register from asking talyvor-docs about a number this repo does not use.',
    ).not.toBeNull()
    const entry = entryFor(CLAIMS[0])
    expect(entry, 'the window entry must parse before it can be compared').not.toBeNull()
    expect(
      expectedInCommand(entry?.[2] ?? ''),
      `deploy/decision-expiry.sh asks talyvor-docs about a different merged window than ` +
        `docs_search.go refuses on (${window}). A deployer running that command gets a confident ` +
        'yes about a ceiling this route does not enforce — a pass for the wrong question, which ' +
        'is worse than no entry at all.',
    ).toBe(`maxFetchRows = ${window}|`)
  })

  it('the deployer is asked about the key set this route actually sends', () => {
    const keys = wireKeys()
    expect(
      keys.length,
      `no \`out.Set("<key>"\` parsed out of ${ROUTE_REL}. This is the population — with nothing ` +
        'parsed the equality below is between two empty sets and passes having read nothing.',
    ).toBeGreaterThan(0)
    const entry = entryFor(CLAIMS[1])
    expect(entry, 'the key entry must parse before it can be compared').not.toBeNull()
    expect(
      expectedInCommand(entry?.[2] ?? ''),
      'deploy/decision-expiry.sh asks talyvor-docs about a different key set than this route ' +
        `puts on the wire (${keys.join(' ')}). A key added here without the entry moving is a ` +
        'parameter that travels to be ignored and comes back looking honoured — the exact failure ' +
        "docsPageList's rule names — and the command would go on confirming the old five.",
    ).toBe(`${keys.map((k) => `URL.Query().Get(${k})`).join('|')}|`)
  })

  it('the deployer is asked about the type set this route actually refuses outside of', () => {
    const types = declaredTypes()
    expect(
      types.length,
      `no \`docsSearchTypes = map[string]bool{…}\` parsed out of ${ROUTE_REL}.`,
    ).toBeGreaterThan(0)
    const entry = entryFor(CLAIMS[2])
    expect(entry, 'the type entry must parse before it can be compared').not.toBeNull()
    expect(
      expectedInCommand(entry?.[2] ?? ''),
      'deploy/decision-expiry.sh asks talyvor-docs about a different discriminator than ' +
        `docsSearchTypes declares (${types.join(' ')}). The leading empty member is the ABSENT ` +
        'type, which upstream defaults to `all` and this route deliberately does not re-author — ' +
        'so it is part of the premise, not noise. A fourth type accepted here while the command ' +
        'still asks about three is a value this route forwards and nothing upstream recognises.',
    ).toBe(`kind == |${types.map((t) => `kind == ${t}`).join('|')}|`)
  })

  it('every refusal resting on an upstream BEHAVIOUR has an entry, and is still used', () => {
    const refusals = refusalConstants()
    expect(
      refusals.length,
      `no \`const docsSearch…Refusal\` parsed out of ${ROUTE_REL}. This is the population for the ` +
        'behavioural half — with nothing parsed the rule below passes having read nothing.',
    ).toBeGreaterThan(0)
    expect(
      refusals,
      'the set of upstream-behaviour refusals this route serves is not the set this table ' +
        'accounts for. Each one is a sentence a CALLER is shown about another repository: a ' +
        'premise that moves does not merely go stale, it becomes a confident explanation of a ' +
        'refusal that is no longer true. Add the claim and its register entry, or stop serving ' +
        'the refusal.',
    ).toEqual(['docsSearchTypeRefusal', 'docsSearchWindowRefusal'])
    for (const name of refusals) {
      const uses = refusalUses(name)
      expect(
        uses,
        `${name} is declared in ${ROUTE_REL} and used in executable source ${uses} time(s) — ` +
          'comments and its own declaration excluded, because counting mentions makes this rule ' +
          'true for every documented constant (control G5). A refusal constant nothing WRITES is ' +
          'a sentence no caller ever sees, and its register entry then asks talyvor-docs about a ' +
          'refusal this route does not serve.',
      ).toBeGreaterThan(0)
    }
  })

  it('the register holds no docs-search entry this table does not account for', () => {
    expect(
      SEARCH_ENTRIES.length,
      `deploy/decision-expiry.sh holds ${SEARCH_ENTRIES.length} settle commands reading ` +
        `${UPSTREAM}, and this table has ${CLAIMS.length} claims. An entry with no claim is a ` +
        'question asked on behalf of a premise this repo no longer depends on — it goes stale ' +
        'with nothing watching, and its pass reads as coverage. Add the claim or delete the entry.',
    ).toBe(CLAIMS.length)
  })
})
