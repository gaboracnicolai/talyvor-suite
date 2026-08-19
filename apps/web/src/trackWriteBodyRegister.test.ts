import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * THE THREE TRACK WRITE BODIES — THE HALF `aiRequestBodyRegister.test.ts` NAMES AS A BOUNDARY
 * AND CANNOT SEE BY CONSTRUCTION.
 *
 * Next door's census derives its population from `json.Marshal(<Name>{` across `apps/bff`. That
 * finds every body this repository AUTHORS in Go. It cannot find these three, and the reason is
 * structural rather than an oversight: `trackCreateIssue`, `trackUpdateIssue` and the POST half of
 * `trackIssueComments` pass the caller's own `r.Body` straight to `forwardProduct`, so no Go struct
 * in this repository ever names their keys. The BROWSER authors them. That file says so in as many
 * words — the six verbatim forwards are "named as a BOUNDARY rather than left to read as coverage"
 * — and this file is the track half of that boundary.
 *
 * ── THE FINDING: THESE THREE ARE NOT ONE RISK CLASS, AND THE MAJORITY OF THE KEYS SIT ON THE
 *    ONLY SILENT ONE ────────────────────────────────────────────────────────────────────────
 *
 * MEASURED read-only against talyvor-track `3672af1a1f3936b4079cf88ea72f3e0db3136520`, in a
 * `git archive` scratch export — that repo is held by another tab and was NEVER written to, and
 * no fetch was run in it. All three routes decode through the SAME helper, `httpx.DecodeJSON`,
 * which calls `dec.DisallowUnknownFields()`. Reading that line alone says "a renamed key is a 400
 * everywhere" and that conclusion is WRONG for the route that matters most:
 *
 *   POST  /issues                 → `var body createBody`        (a STRUCT)  → rename = 400 BAD_JSON
 *   POST  /issues/{id}/comments   → `var in model.Comment`       (a STRUCT)  → rename = 400 BAD_JSON
 *   PATCH /issues/{id}            → `var updates map[string]any` (a MAP)     → rename = 200, UNCHANGED
 *
 * ⚠ `DisallowUnknownFields` HAS NO EFFECT ON A MAP DESTINATION. encoding/json enforces it for
 * struct fields only; a map accepts every key. Measured rather than read, with the flag toggled as
 * its own control so the struct result could not be a property of the type:
 *
 *     struct + {"title":"x"}    flag ON  → nil
 *     struct + {"headline":"x"} flag ON  → json: unknown field "headline"
 *     map    + {"state":"x"}    flag ON  → nil, map[state:x]          ← the key sails through
 *     struct + {"headline":"x"} flag OFF → nil                        ← control: the flag is why
 *
 * and the key that sails through is then dropped WITHOUT A WORD by `issue.Store.Update`:
 *
 *     for k, v := range updates {
 *         if _, ok := updatableFields[k]; !ok && k != "completed_at" { continue }
 *     ...
 *     if len(setClauses) == 0 { return s.getInWorkspace(ctx, id, workspaceID) }
 *
 * — a patch whose every key is unknown runs NO statement and answers 200 with the issue as it
 * already was. The browser then does exactly the diligent thing and it makes the failure worse:
 * `IssueDetail.tsx#patch` invalidates `['track-issue', id]` on success and re-reads, so the screen
 * confidently redraws the OLD value under a control the reader just moved. There is no status
 * code, no error body and no response field separating that from a correct edit.
 *
 * ⚠ THIS IS NOT HYPOTHETICAL AND UPSTREAM HAS ALREADY PAID FOR IT ONCE. The comment sitting inside
 * `updatableFields` records the same defect in the same map: "The column this allowlist's silence
 * made unwritable. Update drops any key that is not here WITHOUT a word, so
 * `PATCH {"milestone_id": "..."}` answered 200 with the field untouched — indistinguishable, to a
 * caller, from a stored value."
 *
 * ⚠ AND FOUR OF THE SIX KEYS THIS APP SENDS ARE ON THAT ROUTE — `status`, `description`,
 * `priority`, `assignee_id`. The two loud routes carry one key each (`title`, `body`). A guard
 * written for "the track write bodies" as one thing would have been right about the two that
 * announce their own failure and wrong about the one that does not.
 *
 * ── WHAT THIS GUARD CLAIMS, PRECISELY ───────────────────────────────────────────────────────
 *
 * It does NOT claim any body matches talyvor-track — nothing in this repository can, because CI
 * checks out this repository alone. It claims the same ONE link the two registers next door claim:
 * the key set the deployer's command asks talyvor-track about is the key set this app actually
 * sends. An entry naming a stale set settles the wrong question and reports a pass for it.
 *
 * Both halves are derived from source. The population is read out of `apps/bff/track.go` (a fourth
 * verbatim forward with no row here is a red — the completeness direction whose absence WAS the
 * hole next door), and each row's key set is read out of the browser files that build the body, so
 * a control added to a screen without a register update is a red rather than a silent widening.
 *
 * ⚠ WHAT IT CANNOT SEE, said out loud so scope is not mistaken for coverage. A key renamed in BOTH
 * this repo and the register in one change still agrees with itself. Only running the register's
 * command in a talyvor-track checkout tells that apart, which is what the `cannot` entries are for
 * and why they are UNCHECKABLE here rather than passes.
 */

const ROOT = resolve(import.meta.dirname, '../../..')
const REGISTER = resolve(ROOT, 'deploy/decision-expiry.sh')

/** How the upstream handler decodes the body — the risk class, and the whole point of the table. */
type Decodes = 'struct' | 'map'

interface WriteBody {
  /** the product route, for failure messages */
  route: string
  /** the talyvor-track file the register's command greps, as the register spells it */
  upstream: string
  /**
   * The decode target upstream, and with it the consequence of an upstream rename. `struct` is a
   * 400 the browser already surfaces; `map` is a 200 nothing can distinguish from success. This is
   * a COLUMN because it is not uniform across the three — see the header.
   */
  decodes: Decodes
  /**
   * Where the browser builds the body. A row is the UNION of its sites: `PATCH /issues/{id}` is
   * driven from two screens and four separate controls, and a union read from source is what stops
   * the fifth control from being invisible here.
   */
  sites: Site[]
}

interface Site {
  file: string
  /**
   * ONE capture group. `literal` captures the inside of an object literal (`{ title: t }`, and the
   * shorthand `{ body }`); `key` captures a single key name. A pattern that matches ZERO times
   * makes the row null and reds — a site that stops matching must not read as a route with no keys.
   */
  kind: 'literal' | 'key'
  re: RegExp
}

/**
 * ⚠ THE ROUTE ANCHOR IS THE URL, NOT THE HELPER NAME. A renamed mutation that still writes to
 * `/api/track/issues` is still this claim; a helper that keeps its name and changes its route is
 * not. Same rule `tsAskKeys` next door gives for the same reason.
 */
const BODIES: WriteBody[] = [
  {
    route: 'POST /api/track/issues',
    upstream: 'internal/issue/handler.go',
    decodes: 'struct',
    sites: [
      {
        file: 'apps/web/src/areas/track/IssueList.tsx',
        kind: 'literal',
        re: /fetch\('\/api\/track\/issues',[\s\S]{0,400}?JSON\.stringify\(\{([^}]*)\}\)/g,
      },
    ],
  },
  {
    route: 'PATCH /api/track/issues/{id}',
    upstream: 'internal/issue/store.go',
    decodes: 'map',
    sites: [
      {
        file: 'apps/web/src/areas/track/IssueList.tsx',
        kind: 'literal',
        re: /fetch\(`\/api\/track\/issues\/\$\{[^`]*\}`,[\s\S]{0,500}?JSON\.stringify\(\{([^}]*)\}\)/g,
      },
      {
        // The detail screen's four controls all go through one `patch(fields)` helper that
        // stringifies whatever it is handed, so the KEYS are at the call sites, not at the fetch.
        //
        // ⚠ THE WHOLE LITERAL, NOT THE FIRST KEY. The first draft matched `patch({ <key>:` and
        // captured one name per call. Control C7 — a second field added to an existing call,
        // `patch({ description: draft, estimate: 3 })` — was PREDICTED RED and came back GREEN:
        // the guard could not see a key this app had started sending, which is the exact silent
        // widening it exists to catch, on the exact route where a wrong key is a silent 200.
        file: 'apps/web/src/areas/track/IssueDetail.tsx',
        kind: 'literal',
        re: /\bpatch\(\{([^}]*)\}\)/g,
      },
    ],
  },
  {
    route: 'POST /api/track/issues/{id}/comments',
    upstream: 'internal/issue/handler.go',
    decodes: 'struct',
    sites: [
      {
        file: 'apps/web/src/areas/track/IssueDetail.tsx',
        kind: 'literal',
        re: /\/comments`[\s\S]{0,500}?JSON\.stringify\(\{([^}]*)\}\)/g,
      },
    ],
  },
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
 * The keys this app sends on a route, as the UNION over its sites. Returns null — a red — when any
 * site matches nothing, or when a captured name is not an identifier. A site that silently matches
 * zero times would shrink the claimed key set toward agreement with a stale register, which is the
 * direction a guard must not fail in.
 */
function sentKeys(b: WriteBody): string[] | null {
  const out = new Set<string>()
  for (const site of b.sites) {
    const hits = [...source(site.file).matchAll(site.re)]
    if (hits.length === 0) return null
    for (const hit of hits) {
      const names =
        site.kind === 'key'
          ? [hit[1]]
          : hit[1]
              .split(',')
              .map((s) => s.split(':')[0].trim())
              .filter((s) => s !== '')
      if (names.length === 0) return null
      for (const n of names) {
        if (!/^[a-z_][a-z0-9_]*$/.test(n)) return null
        out.add(n)
      }
    }
  }
  return out.size > 0 ? [...out].sort() : null
}

/**
 * THE POPULATION, DERIVED FROM SOURCE RATHER THAN TYPED INTO THE TABLE.
 *
 * Every `forwardProduct` call in `apps/bff/track.go` that hands the caller's own `r.Body` upstream.
 * The route is read from the `trackWorkspacePath(ws, …)` argument in the same call and the method
 * from the `http.Method…` constant, so a fourth verbatim forward cannot be added without a row
 * here. `aiRequestBodyRegister.test.ts` pins the count of these forwards; this derives WHICH.
 */
function verbatimForwards(): string[] {
  const text = source('apps/bff/track.go')
  const out: string[] = []
  const re = /a\.forwardProduct\(([\s\S]*?)\)\n/g
  for (const call of text.matchAll(re)) {
    const args = call[1]
    if (!/\br\.Body\b/.test(args)) continue
    const method = /http\.Method([A-Za-z]+)/.exec(args)
    const path = upstreamPathOf(args, text)
    if (!path || !method) {
      out.push(`UNPARSED: ${args.replace(/\s+/g, ' ').trim().slice(0, 80)}`)
      continue
    }
    out.push(`${method[1].toUpperCase()} /api/track${path}`)
  }
  return out.sort()
}

/**
 * The upstream path a forwardProduct call names, in the table's own spelling — so the two halves
 * are compared as-is rather than reconciled by string surgery that could launder a genuinely
 * different path into a match.
 *
 * ⚠ THE PATH IS NOT ALWAYS AN ARGUMENT. `trackIssueComments` builds it into a local FIRST
 * (`path := trackWorkspacePath(...)`) because one handler serves the GET and the POST, so a
 * matcher that only reads the call site sees a bare identifier. The first draft of this census did
 * exactly that and reported the comments route as UNPARSED — a real forward that read as
 * unreadable. It resolves a single-assignment local now, and an unresolved one stays UNPARSED
 * rather than being dropped, because a forward this cannot read must not leave the population.
 */
function upstreamPathOf(args: string, file: string): string | null {
  let expr: string | null = null
  const inline = /trackWorkspacePath\(ws,\s*([\s\S]*?)\)(?:,|\s*$)/.exec(args)
  if (inline) {
    expr = inline[1]
  } else {
    // the third argument after the secret is the path; a bare identifier is a local
    const ident = /trackGatewaySecret,\s*([A-Za-z_][A-Za-z0-9_]*)\s*,/.exec(args)
    if (!ident) return null
    const assigns = [
      ...file.matchAll(
        new RegExp(`\\b${ident[1]}\\s*:=\\s*trackWorkspacePath\\(ws,\\s*([\\s\\S]*?)\\)\\n`, 'g'),
      ),
    ]
    if (assigns.length !== 1) return null
    expr = assigns[0][1]
  }
  // Concatenate the literal halves, with any escaped path variable spelled the table's way.
  let outPath = ''
  const tokens = expr.split('+').map((t) => t.trim())
  for (const t of tokens) {
    const lit = /^"([^"]*)"$/.exec(t)
    if (lit) {
      outPath += lit[1]
      continue
    }
    if (/^url\.PathEscape\([A-Za-z_][A-Za-z0-9_]*\)$/.test(t)) {
      outPath += '{id}'
      continue
    }
    return null
  }
  return outPath === '' ? null : outPath
}

function registerRoutes(): string[] {
  return BODIES.map((b) => b.route).sort()
}
function derivedRoutes(): string[] {
  return verbatimForwards().sort()
}

/** The double-quoted arguments of every `cannot` call in the register: DECISION, PREMISE, COMMAND. */
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

const register = readFileSync(REGISTER, 'utf8')
const calls = cannotCalls(register)

/** The register entry for a route: the one `cannot` whose DECISION names that exact route. */
function entryFor(b: WriteBody): string[] | null {
  const hits = calls.filter((c) => c[0].includes(`[${b.route}]`))
  return hits.length === 1 ? hits[0] : null
}

/**
 * The key set the register DECLARES for a route, spelled `sends {a,b,c}` in the decision.
 *
 * ⚠ IT IS READ FROM THE DECISION AND NOWHERE ELSE. Read from the whole entry, the settle COMMAND
 * — which necessarily names the keys it greps for — answers the question on the decision's behalf,
 * and a decision that stopped naming a key still passes. That was control C3, predicted RED and
 * green until this was split out.
 */
function declaredKeys(b: WriteBody): string[] | null {
  const entry = entryFor(b)
  if (!entry) return null
  const m = /\bsends \{([a-z_,\s]*)\}/.exec(entry[0])
  if (!m) return null
  const names = m[1]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
  if (names.length === 0 || names.some((n) => !/^[a-z_][a-z0-9_]*$/.test(n))) return null
  return [...new Set(names)].sort()
}

describe('the three track write bodies this BFF forwards verbatim', () => {
  for (const b of BODIES) {
    describe(b.route, () => {
      it('the keys this app sends parse from the browser source', () => {
        expect(
          sentKeys(b),
          `no key set could be read for ${b.route}. A site that matches nothing must red here ` +
            `rather than shrink the claimed set toward whatever the register already says.`,
        ).not.toBeNull()
      })

      it('deploy/decision-expiry.sh holds exactly one entry for it', () => {
        expect(
          entryFor(b),
          `expected exactly one \`cannot\` in deploy/decision-expiry.sh whose decision names ` +
            `[${b.route}]. This is the only half of the claim a talyvor-track checkout can settle.`,
        ).not.toBeNull()
      })

      it('the deployer is asked about the key set this repo actually sends', () => {
        const sent = sentKeys(b)
        const declared = declaredKeys(b)
        expect(sent, 'the body must parse before its key set means anything').not.toBeNull()
        expect(
          declared,
          `the register entry for ${b.route} must spell its key set as \`sends {a,b,c}\` in the ` +
            `DECISION, so there is something to compare against.`,
        ).not.toBeNull()
        // ⚠ EQUALITY ON THE DECISION ARGUMENT ALONE, and both halves of that are controls.
        // The first draft searched all three `cannot` arguments for each sent key and passed C3
        // (`status` removed from the decision) because the COMMAND's own regex still contained
        // the word `status` — the guard was reading its own answer back out of the question.
        expect(
          declared,
          `${b.route} sends {${(sent ?? []).join(',')}} and the register declares ` +
            `{${(declared ?? []).join(',')}}. A stale set means the deployer's command settles a ` +
            `different question from the one this app asks.`,
        ).toEqual(sent)
      })

      it('the entry greps the upstream file the route actually decodes in', () => {
        const entry = entryFor(b)
        expect(entry, 'the register entry must parse before it can be compared').not.toBeNull()
        // The PREMISE argument alone, for C3's reason: the COMMAND names the file it greps, so
        // checking the joined args let a premise pointed at the wrong file pass (control C4).
        expect(
          (entry ?? [])[1],
          `${b.route} decodes in talyvor-track ${b.upstream}; a premise naming another file sends ` +
            `the deployer to a checkout position that cannot see the binding it claims to check.`,
        ).toContain(b.upstream)
      })

      it('the entry states the decode class, because it is not uniform across the three', () => {
        const entry = entryFor(b)
        expect(entry, 'the register entry must parse before it can be compared').not.toBeNull()
        // The word is the finding: two of these routes announce a rename with a 400 and one
        // answers 200 with the row unchanged. An entry that omits it hands the deployer three
        // rows that read alike and one consequence that is three times more serious on one of them.
        expect(
          (entry ?? [])[0],
          `${b.route} decodes into a ${b.decodes} upstream and the entry must say so.`,
        ).toContain(b.decodes === 'map' ? 'map[string]any' : 'struct')
      })
    })
  }

  it('every verbatim r.Body forward in track.go has a row', () => {
    const derived = derivedRoutes()
    expect(
      derived.every((d) => d.startsWith('PATCH ') || d.startsWith('POST ')),
      `a forwardProduct call in apps/bff/track.go passes r.Body and did not parse: ` +
        `${derived.filter((d) => d.startsWith('UNPARSED')).join(' | ')}`,
    ).toBe(true)
    expect(
      derived.length,
      `apps/bff/track.go forwards ${derived.length} bodies verbatim and this table has ` +
        `${BODIES.length} rows. A fourth verbatim forward is a fourth cross-repo shape claim, and ` +
        `the population running in one direction only is exactly what hid the fifth AI body.`,
    ).toBe(BODIES.length)
    expect(new Set(derived).size, 'two forwards parsed to the same route').toBe(derived.length)
  })

  it('the derived population and the table name the same routes', () => {
    expect(derivedRoutes()).toEqual(registerRoutes())
  })

  it('the census can find a forward at all', () => {
    // VACUITY. Every assertion above compares a derived set to a table; all of them pass over two
    // empty sets. This is the floor that makes the zeros mean something.
    expect(
      verbatimForwards().length,
      'no verbatim r.Body forward was found in apps/bff/track.go at all — the census matched ' +
        'nothing and every population check above is passing over an empty set.',
    ).toBeGreaterThan(0)
  })
})
