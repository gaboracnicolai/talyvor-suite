import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { LENS_BODIES, NON_LENS_ANON_SITES, cannotCalls } from './lensRequestBodies'

/**
 * THE REQUEST BODIES THIS REPO BUILDS ARE CROSS-REPO SHAPE CLAIMS, AND NOTHING ASKED
 * talyvor-docs ABOUT THEM.
 *
 * ── THE SECOND FINDING, AND IT IS ABOUT THIS FILE (tab-5d2a) ─────────────────
 *
 * ⚠⚠ THE TABLE BELOW WAS HAND-MAINTAINED AND ITS COMPLETENESS RULE RAN IN ONE DIRECTION ONLY.
 * It asked "does every register entry have a row" and never "does every body have a row", so a
 * body this repository builds, marshals and sends could sit outside the register with nothing
 * failing. One did. `apps/bff/docs_changelog.go#docsGenerateBody` is the FOURTH Go struct this BFF
 * marshals into a Docs request body; three of the four were in here and it was not — not by
 * judgement, but because the sweep that produced this table read `internal/ai/handler.go`, and
 * changelog binds its keys in `internal/changelog/handler.go`. The population boundary WAS the
 * hole.
 *
 * ⚠ AND THE HARM IS NOT THE AI HARM, WHICH IS WHY IT WAS WORTH FINDING RATHER THAN ASSUMING.
 * Changelog generation is not a metered call at all (docs_changelog.go records that measurement).
 * MEASURED BY EXECUTING docs' own `changelog.Handler.Generate` at `8189d7b5`, in a `git archive`
 * scratch export — that repo was held by another tab and was NEVER written to:
 *
 *     {"version":"v1.2.3","issue_ids":[]}  → 201 Created, ZERO Track lookups,
 *                                            a durable row summarised "Generated from 0 issues"
 *
 * and `…/changelog/entries/{id}/publish` pushes that row into the workspace's PUBLIC RSS feed. So
 * an upstream rename of `issue_ids` is not an error anywhere: this BFF's own empty-list refusal
 * reads the BROWSER's key, not the wire's, and every generated entry quietly becomes an empty
 * release note that can be published. That is the 201-shaped sibling of the 200-shaped defect the
 * four AI rows exist for.
 *
 * ⚠ THE FIX IS THE POPULATION, NOT THE ROW. `marshalCensus()` derives the go-struct half from
 * `json.Marshal(<Name>{` across `apps/bff`, so the table is now held to the source rather than to
 * a memory of which files were swept. Adding the changelog row alone would have left the next
 * body to be found by the next sweep.
 *
 * ── THE FINDING THIS EXISTS FOR ──────────────────────────────────────────────
 *
 * `mirrorSubsetRegister.test.ts` next door covers the RESPONSE shapes this app mirrors — the
 * structs in each area's `types.ts` and in `lib/api.ts`. The REQUEST bodies this repo builds for the AI
 * routes are the same kind of claim about another repository, and they were not in it. They are
 * the worse half of the pair, for a reason this repo has already paid for once:
 *
 *   #234 measured that `POST /v1/workspaces/{ws}/ai/suggest-title` binds `content`, while its two
 *   siblings bind `text`. A body sending `text` there is NOT an error upstream. Measured against
 *   docs' own handler over a Lens that counts completions:
 *
 *       {"text":"Some real page text.","page_id":"pg-1"}  → 200, 1 completion, 0 user bytes
 *
 *   A wrong key on these routes is a 200 with a real billed completion that read NOTHING. There
 *   is no status code, no error body and no response field that separates it from a correct call,
 *   which is why a black-box assertion cannot be the guard here.
 *
 * ⚠ AND THE EXISTING TESTS CANNOT SEE IT, WHICH IS THE POINT. `docs_suggesttitle_test.go`,
 * `docs_summarize_test.go` and `docs_translate_test.go` each decode the SENT body — the right
 * instrument — but they decode it through struct tags TRANSCRIBED INTO THIS REPOSITORY. Rename a
 * key in talyvor-docs and every one of them stays green, because both halves of the comparison
 * live here. The claim they check is "this app sends what this app believes"; the claim that
 * matters is "this app sends what DOCS BINDS", and no test in this repository can check it: CI
 * checks out this repository alone.
 *
 * ── WHAT THIS GUARD CLAIMS, PRECISELY ───────────────────────────────────────
 *
 * It does NOT claim any body matches its upstream — nothing here can. It claims ONE link, the
 * same one `mirrorSubsetRegister.test.ts` claims for responses: the key set the deployer's
 * command asks talyvor-docs about is the key set this repository actually sends. An entry naming
 * a stale set settles the wrong question and reports a pass for it.
 *
 * The command in the register greps the upstream's OWN bind tags out of talyvor-docs and compares
 * them to that set, so both halves are `git grep`-able truth rather than prose. ⚠ THIS SENTENCE
 * NAMED ONE FILE AND IS CORRECTED IN PLACE RATHER THAN LEFT (tab-5d2a): it read "out of
 * `internal/ai/handler.go`", which was true of all four rows when it was written and is exactly
 * the assumption that hid the fifth. The file is a COLUMN on each row now, and the subject may be
 * a handler FUNCTION (the AI four decode into an anonymous struct inside it) or a named TYPE
 * (changelog declares one beside the handler).
 *
 * ⚠ WHY EQUALITY AND NOT "WE SEND A SUBSET". A key docs binds and this app does not send is not
 * harmless: on these routes an absent key is a DEFAULT, not a refusal — `Engine.Translate`
 * substitutes `defaultLang = "English"` on a blank, so a translation nobody asked for in English
 * is a 200 and a billed completion. So an unsent bound key must be DECLARED
 * (`UPSTREAM-BINDS-ONLY <subject>: none`) in the file that builds the body, and the union is what
 * the register asks about. `none` is spelled out: a missing declaration must be distinguishable
 * from an empty one, and an absent line is a red.
 *
 * ⚠ WHAT IT CANNOT SEE, said out loud so the scope is not mistaken for coverage. A key renamed in
 * BOTH this repo and the register in one change is not a red here — the two halves still agree,
 * and from inside this repository that is indistinguishable from a correct rename. Only running
 * the register's command in a talyvor-docs checkout tells those apart. That direction is the
 * register's whole job and is why these entries exist at all.
 *
 * ⚠ AND A SECOND POPULATION IT DOES NOT TOUCH, NAMED SO THE SCOPE IS NOT MISTAKEN FOR COVERAGE.
 * Six of this BFF's `forwardProduct` calls pass the caller's own `r.Body` straight through
 * (`lens.go` ×3, `track.go` ×3): those shapes are authored by the browser, not here, so no Go
 * struct in `apps/bff` names them and the census below cannot see them. That is a boundary, not a
 * clean bill of health — nothing in this repository asks talyvor-docs about the `lens.go` three.
 * (`track.go`'s three ARE in the register now; so is the anonymous-marshal family this census
 * bucketed and could not name — see `lensRequestBodyRegister.test.ts`, which owns the six that go
 * to talyvor-lens and shares this file's population rather than counting its own.)
 *
 * ⚠ THE FLOORS ARE NOT DECORATION. Every half is parsed out of source, so a rename, a reformat or
 * a deleted entry yields no match — at which point a set equality over two empty sets passes
 * having read nothing. Every body parse asserts it found EXACTLY ONE subject; the marshal census
 * asserts it found at least one site before comparing anything (control G6 blanks the pattern and
 * the guard goes RED rather than green); the register is asserted to hold EXACTLY as many
 * request-body entries as this table has rows; and the marshalled bodies this guard does NOT
 * cover are pinned at a literal so the uncovered set cannot widen in silence.
 *
 * ⚠ MEASURED AGAINST talyvor-docs `d35f6406f0c9ca890929efbb3d8ff029dd4c4567` (the AI four, tab-a91c)
 * and re-measured against `8189d7b53892f7f37e9756c5fe68e3cdd2c547da` (tab-5d2a), read-only in a
 * `git archive` scratch export (that repo was held by another tab and was NEVER written to). ALL
 * FIVE commands pass there today — the four AI ones re-run rather than inherited from the older
 * SHA, and the changelog one new.
 *
 * ⚠ CONTROLS. tab-a91c's six on the AI entries; and 17/17 for this change,
 * `~/talyvor-queue/w17-marshalcensus-controls-5d2a.py`, verdict predicted BEFORE each run and every
 * mutation restored in a `finally` and sha256-verified back. Guard side: a new marshalled body
 * with no row, the changelog row deleted while the marshal stays, the register command re-aimed,
 * a sixth entry with no row, the declaration deleted, the register expectation narrowed, the
 * census pattern blanked (vacuity), a tenth uncovered site, and a SIBLING struct renamed in the Go
 * only — all RED; a reworded comment — GREEN. Register side, mutating the docs export: `issue_ids`
 * renamed, a key added, `workspace_id` dropped, the TYPE renamed and the handler file EMPTIED —
 * all RED, the last two being the vacuity cases a command that finds nothing must not pass.
 */

const ROOT = resolve(import.meta.dirname, '../../..')
const REGISTER = resolve(ROOT, 'deploy/decision-expiry.sh')

interface AIBody {
  /** the product route, for failure messages */
  route: string
  /**
   * The talyvor-docs file the register's command greps, as the register spells it. It is a COLUMN
   * and no longer a single constant: the fifth row's bind tags are not in the AI package, and a
   * one-file constant is exactly what made this table's population look complete while it was not.
   */
  upstream: string
  /**
   * The `sed` address the command must select on, which is where the bind tags actually live. The
   * four AI handlers decode into an ANONYMOUS struct inside the handler function, so their tags are
   * only findable through the func; changelog decodes into a NAMED type declared beside it. Two
   * shapes, and the row says which — a matcher that assumed one silently matched no entry for the
   * other, which reads as "no register entry" and not as "the matcher is wrong".
   */
  selector: string
  /** repo-relative path of the file that BUILDS the body sent to that handler */
  file: string
  /** the Go struct, or — for the one body this BFF forwards verbatim — the TS call site */
  subject: string
  kind: 'go-struct' | 'ts-ask-call'
}

/**
 * Every request body this repository BUILDS for a talyvor-docs route.
 *
 * Four are built in the BFF from a Go struct, because a field of each is AUTHORITY rather than
 * content (`action` chooses what the workspace pays for; `page_id` is what the charge lands on;
 * `workspace_id` is whose changelog gets the row). The fifth — ask — is forwarded VERBATIM, so its
 * only writer is the browser, and the key lives in `api.ts`. That asymmetry is exactly why it is in
 * this table: the verbatim route is the one with no Go struct for a Go test to decode.
 *
 * ⚠ THE TABLE IS NO LONGER THE POPULATION — `marshalledSubjects()` below is, for the go-struct
 * half. A row here that nothing marshals, and a marshalled body with no row, are both reds.
 */
const BODIES: AIBody[] = [
  { route: 'POST /api/docs/pages/{pageID}/summarize', upstream: 'internal/ai/handler.go', selector: 'func (h \\*Handler) Transform(', file: 'apps/bff/docs_ai.go', subject: 'docsSummarizeBody', kind: 'go-struct' },
  { route: 'POST /api/docs/pages/{pageID}/translate', upstream: 'internal/ai/handler.go', selector: 'func (h \\*Handler) Translate(', file: 'apps/bff/docs_ai.go', subject: 'docsTranslateBody', kind: 'go-struct' },
  { route: 'POST /api/docs/pages/{pageID}/suggest-title', upstream: 'internal/ai/handler.go', selector: 'func (h \\*Handler) SuggestTitle(', file: 'apps/bff/docs_ai.go', subject: 'docsSuggestTitleBody', kind: 'go-struct' },
  { route: 'POST /api/docs/spaces/{spaceID}/pages/{pageID}/changelog/generate', upstream: 'internal/changelog/handler.go', selector: 'type generateBody struct', file: 'apps/bff/docs_changelog.go', subject: 'docsGenerateBody', kind: 'go-struct' },
  { route: 'POST /api/docs/ai/ask', upstream: 'internal/ai/handler.go', selector: 'func (h \\*Handler) Ask(', file: 'apps/web/src/areas/docs/api.ts', subject: 'ask', kind: 'ts-ask-call' },
]

const sourceOf = new Map<string, string>()
function source(file: string): string {
  const hit = sourceOf.get(file)
  if (hit !== undefined) return hit
  const text = readFileSync(resolve(ROOT, file), 'utf8')
  sourceOf.set(file, text)
  return text
}

/**
 * The json keys a Go struct sends. The parse stops at the first line that is exactly `}`, so a
 * struct that grows a nested literal parses short and reds on the set equality rather than
 * silently dropping a key.
 */
function goStructKeys(file: string, struct: string): string[] | null {
  const lines = source(file).split('\n')
  const start = lines.findIndex((l) => l === `type ${struct} struct {`)
  if (start === -1) return null
  const out: string[] = []
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i] === '}') return out.length > 0 ? out : null
    const m = /`json:"([a-z_]+)"`/.exec(lines[i])
    if (m) out.push(m[1])
  }
  return null
}

/**
 * The keys the browser puts in the ask body. Anchored on the ROUTE STRING rather than on the
 * method name, because the route is what decides where the money goes; a renamed helper that
 * still posts to `/api/docs/ai/ask` is still this claim.
 */
function tsAskKeys(file: string): string[] | null {
  const re = /'\/api\/docs\/ai\/ask',\s*'POST',\s*\{([^}]*)\}/g
  const hits = [...source(file).matchAll(re)]
  if (hits.length !== 1) return null
  const keys = hits[0][1]
    .split(',')
    .map((s) => s.split(':')[0].trim())
    .filter((s) => s !== '')
  if (keys.length === 0 || keys.some((k) => !/^[a-z_][a-z0-9_]*$/.test(k))) return null
  return keys
}

function sentKeys(b: AIBody): string[] | null {
  return b.kind === 'go-struct' ? goStructKeys(b.file, b.subject) : tsAskKeys(b.file)
}

/**
 * Keys the handler binds that this repo deliberately does NOT send, declared in the file that
 * builds the body. Same convention `UPSTREAM-ONLY` uses next door: `none` where there is nothing,
 * and an absent declaration is a red rather than an empty set.
 */
function bindsOnly(b: AIBody): string[] | null {
  // ⚠ THE CLASS EXCLUDES THE NEWLINE, AND THAT IS NOT A TIDY-UP. `mirrorSubsetRegister.test.ts`
  // reads `\s`, which works there only because every subject it parses ends its declaration at a
  // `*/` — the `/` is what stops the capture. A Go `//` comment has no terminator, so the same
  // class runs on into the next line and swallows `type docs…` up to its first capital. Measured:
  // all three Go declarations parsed as null with that class and read as MISSING, which is a red
  // for a declaration that is present — the guard failing shut. Same-line only, for both spellings.
  const re = new RegExp(`UPSTREAM-BINDS-ONLY ${b.subject}:([a-z0-9_,* \\t]*)`, 'g')
  const hits = [...source(b.file).matchAll(re)]
  if (hits.length !== 1) return null
  const names = hits[0][1]
    .replace(/\*/g, ' ')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
  if (names.length === 1 && names[0] === 'none') return []
  if (names.length === 0 || names.some((n) => !/^[a-z_][a-z0-9_]*$/.test(n))) return null
  return names
}

const BFF_DIR = resolve(ROOT, 'apps/bff')

/**
 * THE POPULATION, DERIVED FROM SOURCE RATHER THAN TYPED INTO THE TABLE ABOVE.
 *
 * Every `json.Marshal(…)` in the BFF's non-test Go, split in two: the ones whose argument is a
 * NAMED struct literal declared in this package, and everything else. The first half is a shape
 * this repository AUTHORS for another repository and is what the table has to account for; the
 * second half is counted and named rather than dropped, because a census that quietly skips a
 * category reports the coverage of the category it kept.
 */
function marshalCensus(): { named: string[]; anonymous: string[] } {
  const named: string[] = []
  const anonymous: string[] = []
  for (const f of readdirSync(BFF_DIR).sort()) {
    if (!f.endsWith('.go') || f.endsWith('_test.go')) continue
    const text = readFileSync(resolve(BFF_DIR, f), 'utf8')
    for (const m of text.matchAll(/json\.Marshal\(/g)) {
      const rest = text.slice(m.index + m[0].length).split('\n')[0]
      const hit = /^([A-Za-z_][A-Za-z0-9_]*)\{/.exec(rest)
      const where = `${f}:${text.slice(0, m.index).split('\n').length}`
      // `struct {` is the anonymous literal spelled long-hand; it declares no reusable subject
      // for the table to name, so it belongs with the maps.
      if (hit && hit[1] !== 'struct') named.push(hit[1])
      else anonymous.push(where)
    }
  }
  return { named: [...new Set(named)].sort(), anonymous }
}

/**
 * The marshalled bodies this guard does NOT cover, DERIVED rather than typed.
 *
 * ⚠ THIS WAS THE LITERAL `9` AND ITS SENTENCE WENT FALSE THE DAY IT WAS ACTED ON. It read "NONE of
 * them is in deploy/decision-expiry.sh today", which was true when written and stopped being true
 * when `lensRequestBodyRegister.test.ts` put six of the nine — the talyvor-lens family — into the
 * register with a settle command each. A hand-typed count cannot notice that; it stays green while
 * the sentence beside it describes a world that has moved.
 *
 * So the number is now a partition of ONE population: the anonymous sites this guard's own census
 * finds, minus the six that sibling owns, minus the three `lens.go` sites named in
 * NON_LENS_ANON_SITES as not a lens key set at all. The count below must equal what is left, which
 * is zero — every anonymous site is now accounted for by exactly one of the three groups, and a
 * tenth site reds here AND next door rather than widening a gap in silence.
 */
const UNCOVERED_MARSHAL_SITES = LENS_BODIES.length + NON_LENS_ANON_SITES.length

const ENTRIES = cannotCalls(readFileSync(REGISTER, 'utf8'))
/** The upstream files this table's rows name, deduplicated — the register side's population. */
const UPSTREAM_PATHS = [...new Set(BODIES.map((b) => b.upstream))]
/**
 * Every register entry whose command greps a REQUEST-BODY subject out of one of those files: a
 * handler function (the four AI routes decode into an anonymous struct inside it) or a named body
 * type (changelog declares one). Anything else grepping the same file — a route mount, a constant —
 * is not this table's business and is not counted against it.
 */
const REQUEST_BODY_ENTRIES = ENTRIES.filter(
  (a) =>
    UPSTREAM_PATHS.some((p) => a[2].includes(p)) &&
    /(func \(h \\?\*Handler\) \w+\(|type \w+ struct)/.test(a[2]),
)

function entryFor(b: AIBody): string[] | null {
  const hits = REQUEST_BODY_ENTRIES.filter(
    (a) => a[2].includes(b.upstream) && a[2].includes(b.selector),
  )
  return hits.length === 1 ? hits[0] : null
}

/** The key set a settle command compares the handler's bind tags against. */
function expectedInCommand(command: string): string[] | null {
  const m = /=\s*"([a-z0-9_\s]*)"\s*\]/.exec(command)
  if (!m) return null
  const names = m[1].split(/\s+/).filter((s) => s !== '')
  return names.length === 0 ? null : names
}

describe('every AI request body this repo builds is a question the register asks talyvor-docs', () => {
  for (const b of BODIES) {
    describe(`${b.route} → docs ${b.upstream} ${b.selector}`, () => {
      it('the sent body parses, with at least one key', () => {
        expect(
          sentKeys(b),
          `\`${b.subject}\` did not parse out of ${b.file}. Every rule below compares the keys ` +
            'this app SENDS against a key set in deploy/decision-expiry.sh; with nothing parsed ' +
            'the comparison is between two empty sets and passes having read nothing. Re-anchor ' +
            'the parse deliberately, or drop this body from the table and delete its register ' +
            'entry in the same change.',
        ).not.toBeNull()
      })

      it('the file declares which bound keys it does NOT send', () => {
        expect(
          bindsOnly(b),
          `${b.file} holds no single \`UPSTREAM-BINDS-ONLY ${b.subject}: …\` declaration. On ` +
            'these routes an absent key is a DEFAULT and not a refusal — Engine.Translate ' +
            'substitutes "English" on a blank language and bills for it — so a key docs binds ' +
            'and this app omits is a decision, not an absence. Write `none` where there is ' +
            'nothing omitted; a blank is not a declaration.',
        ).not.toBeNull()
      })

      it('nothing is declared unsent while the body sends it', () => {
        const sent = new Set(sentKeys(b) ?? [])
        expect(
          (bindsOnly(b) ?? []).filter((n) => sent.has(n)),
          `${b.file} declares a key as bound-upstream and NOT sent, and ${b.subject} sends it. ` +
            'The two halves of the claim contradict each other, and a reader believes whichever ' +
            'they read first.',
        ).toEqual([])
      })

      it('deploy/decision-expiry.sh holds exactly one settle command for it', () => {
        expect(
          entryFor(b),
          `no single \`cannot\` entry in deploy/decision-expiry.sh greps ` +
            `\`${b.selector}\` out of \`${b.upstream}\`. This repository's ` +
            'CI cannot read talyvor-docs, so that entry is the ONLY thing that asks a deployer ' +
            'whether the keys this app sends are still the keys that subject binds. Without it ' +
            'the claim is a sentence in a Go comment — and a wrong key on these routes is a 2xx ' +
            'that read nothing: a billed completion (#234) on the AI four, and on changelog a ' +
            'durable, publishable row claiming a release with no issues in it.',
        ).not.toBeNull()
      })

      it('the deployer is asked about the key set this repo actually sends', () => {
        const sent = sentKeys(b)
        const unsent = bindsOnly(b)
        const entry = entryFor(b)
        expect(sent, 'the body must parse before its key set means anything').not.toBeNull()
        expect(unsent, 'the omissions must parse before their union means anything').not.toBeNull()
        expect(entry, 'the register entry must parse before it can be compared').not.toBeNull()
        const inCommand = expectedInCommand(entry?.[2] ?? '')
        expect(
          inCommand,
          'the settle command holds no `[ "$(…)" = "…" ]` expectation, so it is not comparing ' +
            "the handler's bind tags to anything. A command that reads an exit status here is " +
            'the `grep -c` hazard in a new coat: the pipeline exits 0 whether or not the ' +
            'handler was found.',
        ).not.toBeNull()
        expect(
          inCommand,
          `deploy/decision-expiry.sh asks talyvor-docs about a different key set than ` +
            `${b.subject} plus its declared omissions describe. A deployer running that command ` +
            'gets a confident yes about a body this repo does not send — a pass for the wrong ' +
            'question, which is worse than no entry at all.',
        ).toEqual([...(sent ?? []), ...(unsent ?? [])].sort())
      })
    })
  }

  it('every named body this BFF marshals for an upstream has a row', () => {
    const census = marshalCensus()
    expect(
      census.named.length,
      'no `json.Marshal(<Name>{` parsed out of apps/bff at all. This is the population — with ' +
        'nothing parsed the set equality below is between two empty sets and passes having read ' +
        'nothing, which is precisely the silence it exists to break.',
    ).toBeGreaterThan(0)
    expect(
      census.named,
      'the set of Go structs this BFF marshals into an upstream request body is not the set of ' +
        '`go-struct` rows in BODIES. THIS IS THE DIRECTION THE OLD COMPLETENESS RULE DID NOT ' +
        'RUN: it asked only whether every register entry had a row, so a body this repo builds ' +
        'and sends could have no row, no register entry and no failing test — which is exactly ' +
        'how `docsGenerateBody` sat outside the register while three siblings sat inside it. ' +
        'Add the row (and its register entry), or stop marshalling the struct.',
    ).toEqual(
      BODIES.filter((b) => b.kind === 'go-struct')
        .map((b) => b.subject)
        .sort(),
    )
  })

  it('the marshalled bodies this guard does NOT cover are counted, not dropped', () => {
    const anonymous = marshalCensus().anonymous
    expect(
      anonymous.length,
      `apps/bff now marshals ${anonymous.length} bodies from an anonymous map or struct ` +
        `(${anonymous.join(', ')}), and this guard is pinned at ${UNCOVERED_MARSHAL_SITES}. Each ` +
        'is still a key set another repository binds and none is in the register. The number is ' +
        'here so that "the go-struct bodies are covered" cannot be read as "the bodies are ' +
        'covered": a tenth site must be a decision, not a silent widening of the gap.',
    ).toBe(UNCOVERED_MARSHAL_SITES)
  })

  it('the register holds no request-body entry this table does not account for', () => {
    expect(
      REQUEST_BODY_ENTRIES.length,
      `deploy/decision-expiry.sh holds ${REQUEST_BODY_ENTRIES.length} settle commands grepping a ` +
        `request-body subject out of ${UPSTREAM_PATHS.join(' / ')}, and this table has ` +
        `${BODIES.length} rows. An entry with no row is a question asked on behalf of a body ` +
        'nobody sends — it goes stale with nothing watching, and its pass reads as coverage. ' +
        'Add the row or delete the entry.',
    ).toBe(BODIES.length)
  })
})
