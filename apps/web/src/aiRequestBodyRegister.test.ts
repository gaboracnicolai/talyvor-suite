import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * THE FOUR AI REQUEST BODIES ARE CROSS-REPO SHAPE CLAIMS ON A MONEY PATH, AND NOTHING ASKED
 * talyvor-docs ABOUT THEM.
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
 * The command in the register greps the handler's OWN bind tags out of
 * `internal/ai/handler.go` and compares them to that set, so both halves are `git grep`-able
 * truth rather than prose.
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
 * ⚠ THE FLOORS ARE NOT DECORATION. Both halves are parsed out of source, so a rename, a reformat
 * or a deleted entry yields no match — at which point a set equality over two empty sets passes
 * having read nothing. Every parse asserts it found EXACTLY ONE subject, and the register is
 * asserted to hold EXACTLY as many AI-handler entries as this table has rows, so an entry for a
 * handler nobody sends to (or a table row whose entry was deleted) is a red rather than a silence.
 *
 * ⚠ MEASURED AGAINST talyvor-docs `d35f6406f0c9ca890929efbb3d8ff029dd4c4567`, read-only in a
 * `git archive` scratch export (that repo was held by another tab and was NEVER written to). The
 * four commands PASS there today, and all six positive controls fired as predicted —
 * `~/talyvor-queue/w17-aibody-register-controls-a91c.py`, each mutation restored in a `finally`
 * and sha256-verified back: a renamed bind key, an added key, a deleted key, the handler renamed,
 * and the handler file emptied all go red; the unmutated tree passes.
 */

const ROOT = resolve(import.meta.dirname, '../../..')
const REGISTER = resolve(ROOT, 'deploy/decision-expiry.sh')
/** The upstream file every command below greps, as the register spells it. */
const UPSTREAM_PATH = 'internal/ai/handler.go'

interface AIBody {
  /** the product route, for failure messages */
  route: string
  /** the talyvor-docs handler whose bind tags the register's command reads */
  handler: string
  /** repo-relative path of the file that BUILDS the body sent to that handler */
  file: string
  /** the Go struct, or — for the one body this BFF forwards verbatim — the TS call site */
  subject: string
  kind: 'go-struct' | 'ts-ask-call'
}

/**
 * Every request body this repository sends to a talyvor-docs AI route.
 *
 * Three are built in the BFF from a Go struct, because two of their fields are AUTHORITY rather
 * than content (`action` chooses what the workspace pays for; `page_id` is what the charge lands
 * on). The fourth — ask — is forwarded VERBATIM, so its only writer is the browser, and the key
 * lives in `api.ts`. That asymmetry is exactly why it is in this table: the verbatim route is the
 * one with no Go struct for a Go test to decode, and it was the least-covered of the four.
 */
const BODIES: AIBody[] = [
  { route: 'POST /api/docs/pages/{pageID}/summarize', handler: 'Transform', file: 'apps/bff/docs_ai.go', subject: 'docsSummarizeBody', kind: 'go-struct' },
  { route: 'POST /api/docs/pages/{pageID}/translate', handler: 'Translate', file: 'apps/bff/docs_ai.go', subject: 'docsTranslateBody', kind: 'go-struct' },
  { route: 'POST /api/docs/pages/{pageID}/suggest-title', handler: 'SuggestTitle', file: 'apps/bff/docs_ai.go', subject: 'docsSuggestTitleBody', kind: 'go-struct' },
  { route: 'POST /api/docs/ai/ask', handler: 'Ask', file: 'apps/web/src/areas/docs/api.ts', subject: 'ask', kind: 'ts-ask-call' },
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

/**
 * The double-quoted arguments of every `cannot` call in the register: DECISION, PREMISE, COMMAND.
 * Unescaped by bash's own rule for a double-quoted string — a backslash escapes only `$`, a
 * backtick, `"` and `\`, and before anything else it stays a literal backslash, which is what
 * keeps a grep pattern's `\*` a `\*`.
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
/** Every register entry whose command greps a handler out of talyvor-docs' AI handler file. */
const AI_ENTRIES = ENTRIES.filter(
  (a) => a[2].includes(UPSTREAM_PATH) && /func \(h \\?\*Handler\) \w+\(/.test(a[2]),
)

function entryFor(b: AIBody): string[] | null {
  const hits = AI_ENTRIES.filter((a) => a[2].includes(`Handler) ${b.handler}(`))
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
    describe(`${b.route} → docs ${b.handler}`, () => {
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
            `\`func (h *Handler) ${b.handler}(\` out of \`${UPSTREAM_PATH}\`. This repository's ` +
            'CI cannot read talyvor-docs, so that entry is the ONLY thing that asks a deployer ' +
            'whether the keys this app sends are still the keys that handler binds. Without it ' +
            'the claim is a sentence in a Go comment — and a wrong key on this route is a 200 ' +
            'with a billed completion that read nothing, which is the defect #234 measured.',
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

  it('the register holds no AI-handler entry this table does not account for', () => {
    expect(
      AI_ENTRIES.length,
      `deploy/decision-expiry.sh holds ${AI_ENTRIES.length} settle commands grepping a handler ` +
        `out of \`${UPSTREAM_PATH}\`, and this table has ${BODIES.length} rows. An entry with no ` +
        'row is a question asked on behalf of a body nobody sends — it goes stale with nothing ' +
        'watching, and its pass reads as coverage. Add the row or delete the entry.',
    ).toBe(BODIES.length)
  })
})
