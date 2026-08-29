/**
 * WHAT THIS APP PUTS IN A REQUEST TO ITS OWN BFF, AND WHAT THE BFF DECODES OUT OF IT.
 *
 * The shared half of `bffRequestFieldRegister.test.ts`. Two extractions, joined on the route.
 *
 * ⚠ WHY THIS DIRECTION HAS NO GUARD YET AND THE OTHERS DO. `lensRequestBodies.ts` next door pins
 * what the BFF sends UPSTREAM to talyvor-lens, and `lib/calledRoutes.test.ts` pins that every BFF
 * ADDRESS this app names is one the BFF mounts. Neither says anything about the FIELDS inside a
 * request this app makes. The two apps ship from one repository through one CI, and a field the
 * browser sends that the BFF never decodes is dropped in silence and answered 200 — the control
 * that did nothing looks exactly like the control that worked.
 *
 * ⚠⚠ AND HERE IT IS SILENT, WHICH IS THE WORSE HALF OF THE CLASS. talyvor-track proved the loud
 * half (W3.68, `8359a30`): its `httpx.DecodeJSON` calls `DisallowUnknownFields`, so an undeclared
 * field is a 400 and two shipped write paths were dead that way. Measured here before writing
 * this: `DisallowUnknownFields` appears ONCE in `apps/bff` and it is inside a COMMENT
 * (`billing.go`, explaining that the handler decodes without it). Nothing in this BFF refuses an
 * unknown field. A 400 eventually gets reported by a user; a 200 that changed nothing does not.
 *
 * ⚠ THE WEB HALF IS TAKEN FROM THE TYPESCRIPT COMPILER, NOT FROM A REGEX, AND THE REASON IS
 * MEASURED RATHER THAN STYLISTIC. Two regex censuses of this same question were built and thrown
 * away in talyvor-track (W3.69): a window bounded by a character count reads the next function's
 * body, and a window bounded by the next request literal STILL mis-attributes, because a
 * TypeScript parameter type annotation spelled `body: { … }` sits BEFORE its own function's
 * request literal. Both produced confident, different, wrong tables. `getTypeAtLocation(body)`
 * has no such failure mode — and it resolves a spread and a `Partial<T>`, which no scan does.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'

export const WEB_ROOT = resolve(import.meta.dirname, '..')
export const REPO_ROOT = resolve(WEB_ROOT, '../..')
export const BFF_DIR = resolve(REPO_ROOT, 'apps/bff')

export interface WebRequestSite {
  /** repo-relative path of the file holding the `fetch` */
  file: string
  line: number
  /** upper-cased method; 'GET' when the init object names none */
  verb: string
  /** the path with every `${…}` span folded to `{}`; null when it is not a literal at all */
  path: string | null
  /** the json keys this site can put in the body; null when it sends no body */
  bodyFields: string[] | null
  /**
   * TRUE when the checker could not bound the body's keys — a `Record<string, unknown>`, an
   * `unknown` return, a non-`JSON.stringify` body. ⚠ NOT the same as an empty set and never to be
   * read as one: an unbounded body is an UNMEASURED contract, and the register must name it.
   */
  bodyUnbounded: boolean
  /** the source text of the body expression, for the register's prose */
  bodyRaw: string | null
}

const PRIMITIVE =
  ts.TypeFlags.Any |
  ts.TypeFlags.Unknown |
  ts.TypeFlags.StringLike |
  ts.TypeFlags.NumberLike |
  ts.TypeFlags.BooleanLike |
  ts.TypeFlags.BigIntLike |
  ts.TypeFlags.ESSymbolLike |
  ts.TypeFlags.EnumLike |
  ts.TypeFlags.VoidLike |
  ts.TypeFlags.Null |
  ts.TypeFlags.Undefined |
  ts.TypeFlags.Never

function unwrap(n: ts.Expression): ts.Expression {
  let e = n
  while (
    ts.isAsExpression(e) ||
    ts.isTypeAssertionExpression(e) ||
    ts.isNonNullExpression(e) ||
    ts.isParenthesizedExpression(e)
  ) {
    e = e.expression
  }
  return e
}

let cached: WebRequestSite[] | null = null

/** Every `fetch(...)` this app makes, with the body keys the type checker says it can carry. */
export function webRequestSites(): WebRequestSite[] {
  if (cached) return cached
  const cfgPath = ts.findConfigFile(WEB_ROOT, ts.sys.fileExists, 'tsconfig.json')
  if (!cfgPath) throw new Error('apps/web/tsconfig.json not found')
  const cfg = ts.parseJsonConfigFileContent(
    ts.readConfigFile(cfgPath, ts.sys.readFile).config,
    ts.sys,
    resolve(cfgPath, '..'),
  )
  const program = ts.createProgram(cfg.fileNames, cfg.options)
  const checker = program.getTypeChecker()

  const propNames = (node: ts.Expression): { unbounded: boolean; names: string[] } => {
    const t = checker.getTypeAtLocation(unwrap(node))
    if (t.getFlags() & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return { unbounded: true, names: [] }
    const names = new Set<string>()
    let unbounded = false
    for (const p of t.isUnion() ? t.types : [t]) {
      if (p.getFlags() & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
        unbounded = true
        continue
      }
      if (p.getFlags() & PRIMITIVE) continue
      if (checker.getIndexInfoOfType(p, ts.IndexKind.String)) unbounded = true
      for (const s of checker.getPropertiesOfType(p)) names.add(s.getName())
    }
    return { unbounded, names: [...names].sort() }
  }

  // ⚠ ONE HOP THROUGH A LOCAL, BECAUSE MOST CALL SITES WRITE `const path = …; fetch(path, …)`.
  // Without it those sites report no path at all and cannot be joined to a route — and an
  // unjoinable site contributes nothing to the census while looking like a site that was checked.
  // Measured: three of the eleven body-carrying sites are written that way, including the Track
  // issue PATCH, which is the one whose fields cross into another repository's allowlist.
  const pathOf = (n: ts.Expression): string | null => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text
    if (ts.isTemplateExpression(n)) {
      let out = n.head.text
      for (const sp of n.templateSpans) out += `{}${sp.literal.text}`
      return out
    }
    if (ts.isIdentifier(n)) {
      const sym = checker.getSymbolAtLocation(n)
      for (const d of sym?.getDeclarations() ?? []) {
        if (ts.isVariableDeclaration(d) && d.initializer) return pathOf(d.initializer)
      }
    }
    return null
  }

  const out: WebRequestSite[] = []
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue
    const rel = sf.fileName.startsWith(WEB_ROOT) ? sf.fileName.slice(WEB_ROOT.length + 1) : ''
    if (!rel.startsWith('src')) continue
    if (/\.test\.tsx?$/.test(rel)) continue
    const walk = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'fetch' &&
        node.arguments.length >= 1
      ) {
        let verb = 'GET'
        let body: ts.Expression | null = null
        const opts = node.arguments[1]
        if (opts && ts.isObjectLiteralExpression(opts)) {
          for (const pr of opts.properties) {
            let key: string | null = null
            let val: ts.Expression | null = null
            if (ts.isPropertyAssignment(pr) && pr.name) {
              key = pr.name.getText()
              val = pr.initializer
              // ⚠ SHORTHAND IS A DIFFERENT NODE KIND AND MISSING IT IS SILENT. In talyvor-track
              // the same generator saw `{ method: 'POST', body }` as an options object with
              // neither, and reported 10 body-carrying sites where there were 22.
            } else if (ts.isShorthandPropertyAssignment(pr)) {
              key = pr.name.getText()
              val = pr.name
            } else {
              continue
            }
            if (key === 'method') {
              const u = unwrap(val)
              verb = ts.isStringLiteral(u) ? u.text.toUpperCase() : `?${u.getText()}`
            } else if (key === 'body') {
              body = val
            }
          }
        }
        let bodyFields: string[] | null = null
        let bodyUnbounded = false
        let bodyRaw: string | null = null
        if (body) {
          const b = unwrap(body)
          bodyRaw = b.getText().slice(0, 100).replace(/\s+/g, ' ')
          if (
            ts.isCallExpression(b) &&
            b.expression.getText() === 'JSON.stringify' &&
            b.arguments.length > 0
          ) {
            const r = propNames(b.arguments[0])
            bodyFields = r.names
            bodyUnbounded = r.unbounded
          } else {
            bodyFields = []
            bodyUnbounded = true
          }
        }
        out.push({
          file: rel,
          line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          verb,
          path: pathOf(node.arguments[0]),
          bodyFields,
          bodyUnbounded,
          bodyRaw,
        })
      }
      ts.forEachChild(node, walk)
    }
    ts.forEachChild(sf, walk)
  }
  out.sort((a, b) => `${a.path}${a.verb}${a.file}${a.line}`.localeCompare(`${b.path}${b.verb}${b.file}${b.line}`))
  cached = out
  return out
}

// ── the BFF half ────────────────────────────────────────────────────────────────────────────────

export interface BffDecode {
  /** the route as apps/bff/lens.go registers it, plus the method the handler dispatches on */
  route: string
  /** repo-relative Go file holding the handler */
  file: string
  /** the enclosing func, so the anchor is located inside it — several files hold more than one */
  fn: string
  /** the FIXED anchor line. Asserted to occur EXACTLY ONCE inside `fn`, for the reason
   *  lensRequestBodies.ts records: an anchor that matches twice parses the wrong one, and one
   *  that matches zero times parses nothing — which a set comparison reads as agreement. */
  anchor: string
}

/**
 * Every request-body decode in the BFF that serves a route this app calls.
 *
 * ⚠ THE POPULATION IS "DECODES A REQUEST BODY", NOT "DECODES JSON". `apps/bff` has seven
 * `Decode(&…)` sites; two of them decode a RESPONSE from talyvor-lens (`billing.go`'s
 * `usd_per_lxc` peg read, and the provisioning read in `tenant.go`) and are not request contracts
 * at all. Naming the five rather than counting the seven is the difference between a register and
 * a number — the same reason `NON_LENS_ANON_SITES` next door names its three.
 */
export const BFF_DECODES: BffDecode[] = [
  { route: 'POST /api/keys', file: 'keys.go', fn: 'func (a *app) handleMintKey(', anchor: 'var in struct {' },
  { route: 'POST /api/lxc/checkout', file: 'billing.go', fn: 'func (a *app) handleLXCCheckout(', anchor: 'var in struct {' },
  { route: 'POST /api/lens/convert', file: 'convert.go', fn: 'func (a *app) handleConvert(', anchor: 'var in struct {' },
  { route: 'POST /api/distill', file: 'distill.go', fn: 'func (a *app) handleDistill(', anchor: 'var in struct {' },
  { route: 'POST /api/pooling', file: 'tenant.go', fn: 'func (a *app) handlePoolingChoice(', anchor: 'var in struct {' },
]

const goSource = (file: string): string => readFileSync(resolve(BFF_DIR, file), 'utf8')

/**
 * The json keys a BFF handler decodes off the request body, located inside its own func.
 *
 * Returns null when the func or the anchor does not occur exactly once, so a moved or duplicated
 * decode is a red rather than an empty set that compares equal to another empty set.
 */
export function decodedKeys(d: BffDecode): string[] | null {
  const lines = goSource(d.file).split('\n')
  const fnHits = lines.map((l, i) => [l, i] as const).filter(([l]) => l.includes(d.fn))
  if (fnHits.length !== 1) return null
  const from = fnHits[0][1]
  const rel = lines.slice(from).findIndex((l) => l.includes(d.anchor))
  if (rel === -1) return null
  const out: string[] = []
  for (let i = from + rel + 1; i < lines.length; i += 1) {
    if (lines[i].trim().startsWith('}')) return out.length > 0 ? out : null
    const m = /`json:"([a-z_][a-z0-9_]*)/.exec(lines[i])
    if (m) out.push(m[1])
  }
  return null
}

/**
 * Fields a BFF handler decodes that NOTHING IN THIS REPOSITORY SENDS, with what reaches them.
 *
 * ⚠ THE VALUE OF THIS TABLE IS THE RIGHT-HAND COLUMN. "One field has no sender" is a number;
 * "the whole chain beneath it works and only the UI cannot reach it" is a finding, and the only
 * way to tell those apart is to write down what each one does.
 *
 * ⚠⚠ THE ESTATE HALF IS A RECORDED MEASUREMENT, NOT A CI-VERIFIED CLAIM — CI checks out this
 * repository alone. It was taken 2026-08-29 against talyvor-lens by reading the code named in the
 * entry, and it is written here rather than left for a reader to infer.
 */
export const NO_SENDER_IN_THIS_REPO: Record<string, string> = {
  'POST /api/keys expires_at':
    'THE CONSOLE CANNOT SET AN API-KEY EXPIRY, AND EVERY LAYER BENEATH IT CAN. handleMintKey ' +
    'decodes expires_at and forwards it verbatim (json.Marshal(in) — omitempty drops a nil), ' +
    "talyvor-lens's POST /v1/workspaces/{wsID}/api-keys decodes it into *time.Time and passes it " +
    'to tenantStore.CreateAPIKey, the column is written, and authentication ENFORCES it ' +
    '(internal/tenant/store.go: a matched key whose expires_at is in the past is refused). ' +
    'keysApi.mint sends { name, scopes } and nothing else in this repository posts to /api/keys, ' +
    'so every key minted through the product is non-expiring — and rotation preserves the old ' +
    "key's expiry, so it stays that way. WorkspaceAPIKey.expires_at is declared on the list row " +
    'and rendered by no component. WHETHER THE CONSOLE SHOULD OFFER AN EXPIRY IS A PRODUCT AND ' +
    'SECURITY-POSTURE DECISION AND IS NOT A SESSION\'S TO TAKE — this entry exists so the ' +
    'capability is visible instead of silent, and so that wiring it shrinks this table and reds.',
}
