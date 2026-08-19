/**
 * THE SIX REQUEST BODIES THIS BFF BUILDS FOR talyvor-lens, AND THE POPULATION THEY COME OUT OF.
 *
 * This module is the shared half of two guards: `lensRequestBodyRegister.test.ts` holds every
 * body here to a `cannot` entry in `deploy/decision-expiry.sh`, and `aiRequestBodyRegister.test.ts`
 * next door subtracts this table from its own marshal census so the bodies it does NOT cover stay
 * counted rather than dropped. Both numbers used to be literals in a comment; they are derived here.
 *
 * ⚠ WHY THIS FAMILY IS DIFFERENT FROM THE DOCS ONE NEXT DOOR. Every body in `aiRequestBodyRegister`
 * is a NAMED Go struct, so its keys are findable by name. These six are anonymous maps and structs
 * — `json.Marshal(map[string]int64{"usd_cents": …})` and friends — which is exactly why the sibling
 * census puts them in its `anonymous` bucket and cannot name them. An anonymous literal is not a
 * lesser claim about another repository; it is the same claim with nowhere to hang a test.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

export const ROOT = resolve(import.meta.dirname, '../../..')
export const BFF_DIR = resolve(ROOT, 'apps/bff')

export interface LensBody {
  /** the lens route this body is POSTed/PUT to, as the register spells it */
  route: string
  /** repo-relative path of the file that BUILDS the body */
  file: string
  /**
   * How the keys are written at the marshal site. `map-literal` is a one-line
   * `map[string]T{"k": v}`; `anon-struct` is a struct literal (or a decoded `var in struct`)
   * whose json tags are the keys.
   */
  kind: 'map-literal' | 'anon-struct'
  /**
   * The line the parse anchors on. It must occur EXACTLY ONCE in the file — asserted, because an
   * anchor that matches twice silently parses the wrong one and an anchor that matches zero times
   * parses nothing, which a set comparison would read as agreement.
   */
  anchor: string
  /**
   * For `anon-struct` only: the enclosing func, so the struct is located inside it rather than by
   * the first `var in struct {` in the file. `keys.go` and `tenant.go` both hold more than one.
   */
  fn?: string
  /** the talyvor-lens file the settle command greps */
  upstreamFile: string
  /**
   * The FIXED-STRING anchor the settle command hands to `grep -F`. It is a column rather than a
   * derived value because it is the half a deployer actually runs — if it drifts from the route
   * above, the entry settles a different question, and that is what this table is for.
   */
  upstreamAnchor: string
  /** the name the register entry and the UPSTREAM-BINDS-ONLY declaration both use */
  subject: string
}

/**
 * ⚠ THE ORDER IS THE ORDER OF THE MEASURED VERDICT TABLE (see lensRequestBodyRegister.test.ts's
 * header): loud first, silent second. It is not alphabetical on purpose — the three routes whose
 * rename is SILENT are the reason this file exists.
 */
export const LENS_BODIES: LensBody[] = [
  {
    route: 'POST /v1/workspaces/{wsID}/billing/checkout',
    file: 'apps/bff/billing.go',
    kind: 'map-literal',
    anchor: 'json.Marshal(map[string]int64{"usd_cents": in.USDCents})',
    upstreamFile: 'cmd/lens/main.go',
    upstreamAnchor: 'bill.post(authed, "/v1/workspaces/{wsID}/billing/checkout", func',
    subject: 'lensCheckoutBody',
  },
  {
    route: 'POST /v1/workspaces/{wsID}/lxc/convert',
    file: 'apps/bff/convert.go',
    kind: 'map-literal',
    anchor: 'json.Marshal(map[string]int64{"lxc_amount_ulxc": in.LXCAmountULXC})',
    upstreamFile: 'cmd/lens/main.go',
    upstreamAnchor: 'econ.post(authed, "/v1/workspaces/{wsID}/lxc/convert", func',
    subject: 'lensConvertBody',
  },
  {
    route: 'POST /v1/workspaces/{wsID}/api-keys',
    file: 'apps/bff/keys.go',
    kind: 'anon-struct',
    fn: 'func (a *app) handleMintKey(',
    anchor: 'var in struct {',
    upstreamFile: 'cmd/lens/main.go',
    upstreamAnchor: 'authed.Post("/v1/workspaces/{wsID}/api-keys", func',
    subject: 'lensMintKeyBody',
  },
  {
    route: 'POST /v1/provision',
    file: 'apps/bff/tenant.go',
    kind: 'anon-struct',
    fn: 'func (a *app) provision(',
    anchor: 'json.Marshal(struct {',
    upstreamFile: 'cmd/lens/provision_handler.go',
    upstreamAnchor: 'type provisionRequest struct',
    subject: 'lensProvisionBody',
  },
  {
    route: 'PUT /v1/workspaces/{wsID}/distill',
    file: 'apps/bff/distill.go',
    kind: 'map-literal',
    anchor: 'json.Marshal(map[string]string{"distill_policy": policy})',
    upstreamFile: 'cmd/lens/main.go',
    upstreamAnchor: 'authed.Put("/v1/workspaces/{wsID}/distill", func',
    subject: 'lensDistillBody',
  },
  {
    route: 'PUT /v1/workspaces/{wsID}/cache-poolable',
    file: 'apps/bff/tenant.go',
    kind: 'map-literal',
    anchor: 'json.Marshal(map[string]bool{"cache_poolable": poolable})',
    upstreamFile: 'cmd/lens/main.go',
    upstreamAnchor: 'authed.Put("/v1/workspaces/{wsID}/cache-poolable", func',
    subject: 'lensCachePoolableBody',
  },
]

/**
 * The anonymous marshal sites in apps/bff that are NOT in the table above, pinned by the file they
 * live in and what they actually are. All three are in `lens.go` and NONE of them sends a key set
 * to talyvor-lens — they are named here rather than counted, because "nine anonymous sites" was a
 * single number covering three different things and the number is what made them look alike.
 *
 * ⚠ ONE OF THEM ASSERTS NO KEY SET AT ALL, WHICH IS WHY NAMING BEAT COUNTING. `lens.go`'s
 * `json.Marshal(ws)` marshals a bare STRING — the workspace id — on its way into
 * `fields["workspace_id"]`. The cross-repo claim on that line is the map KEY assigned next to it,
 * not the marshal; the sibling census counted it as a body because it counts `json.Marshal(`.
 */
export const NON_LENS_ANON_SITES = [
  {
    file: 'lens.go',
    what: 'stripPageContentList re-marshals a talyvor-docs page LIST after deleting content/content_text — a RESPONSE projection, so its cross-repo claim is the two deleted key names, not a key set it sends',
  },
  {
    file: 'lens.go',
    what: 'docsSpaceCreateBody marshals the workspace id as a BARE STRING (json.Marshal(ws)) — no key set is asserted on this line at all',
  },
  {
    file: 'lens.go',
    what: 'docsSpaceCreateBody re-marshals the browser’s own object with workspace_id pinned — the claim is the talyvor-docs key `workspace_id`, and the rest of the object is authored by the browser',
  },
] as const

const cache = new Map<string, string>()
export function source(file: string): string {
  const hit = cache.get(file)
  if (hit !== undefined) return hit
  const text = readFileSync(resolve(ROOT, file), 'utf8')
  cache.set(file, text)
  return text
}

/**
 * The keys a one-line `map[string]T{"k": v, …}` literal sends.
 *
 * Returns null when the anchor does not occur EXACTLY ONCE, so a moved or duplicated marshal is a
 * red rather than an empty set that compares equal to another empty set.
 */
function mapLiteralKeys(b: LensBody): string[] | null {
  const lines = source(b.file).split('\n')
  const hits = lines.filter((l) => l.includes(b.anchor))
  if (hits.length !== 1) return null
  const keys = [...hits[0].matchAll(/"([a-z_][a-z0-9_]*)":/g)].map((m) => m[1])
  return keys.length > 0 ? keys : null
}

/**
 * The json keys an anonymous struct literal sends, located INSIDE its enclosing func.
 *
 * The block ends at the first line whose trimmed form starts with `}` — which is `}` for a
 * `var in struct {` and `}{Identity: …}` for a literal that is immediately constructed. The tag
 * class stops at the comma, so `json:"expires_at,omitempty"` yields `expires_at`.
 *
 * ⚠ `omitempty` IS NOT SUBTRACTED, AND THAT IS DELIBERATE. `tenant.go` declares
 * `display_name,omitempty` and never assigns it, so that key is never on the wire — but the struct
 * tag is still this repository ASSERTING that talyvor-lens binds a key by that name. A rename
 * upstream falsifies the assertion whether or not a value was ever sent, and the day someone
 * populates the field is not the day the guard should start looking.
 */
function anonStructKeys(b: LensBody): string[] | null {
  const lines = source(b.file).split('\n')
  const fnHits = lines.map((l, i) => [l, i] as const).filter(([l]) => l.includes(b.fn ?? ' '))
  if (fnHits.length !== 1) return null
  const from = fnHits[0][1]
  const rel = lines.slice(from).findIndex((l) => l.includes(b.anchor))
  if (rel === -1) return null
  const out: string[] = []
  for (let i = from + rel + 1; i < lines.length; i += 1) {
    if (lines[i].trim().startsWith('}')) return out.length > 0 ? out : null
    const m = /`json:"([a-z_][a-z0-9_]*)/.exec(lines[i])
    if (m) out.push(m[1])
  }
  return null
}

/** The key set this repository sends on that route, parsed from the source that sends it. */
export function sentKeys(b: LensBody): string[] | null {
  return b.kind === 'map-literal' ? mapLiteralKeys(b) : anonStructKeys(b)
}

/**
 * Keys talyvor-lens binds that this repo deliberately does NOT send, declared in the file that
 * builds the body. Same convention the sibling guard uses: `none` is spelled out, and an absent
 * declaration is a red rather than an empty set.
 *
 * ⚠ SAME-LINE ONLY, for the reason the sibling records: a Go `//` comment has no terminator, so a
 * class that admits the newline runs into the next line and swallows it.
 */
export function bindsOnly(b: LensBody): string[] | null {
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
 * backtick, `"` and `\`, and before anything else it stays a literal backslash, which is what keeps
 * a grep pattern's `\*` a `\*`.
 *
 * ⚠ THIS LIVED IN `aiRequestBodyRegister.test.ts` AND WAS MOVED HERE RATHER THAN COPIED. Two
 * guards now read the same register, and two parsers for one file is exactly how the halves of a
 * claim start disagreeing quietly — the register would answer one guard's question and not the
 * other's, and each would report a pass.
 */
export function cannotCalls(shell: string): string[][] {
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

/**
 * Every `json.Marshal(` in the BFF's non-test Go whose argument is NOT a named struct literal
 * declared in the package — the sibling census's `anonymous` bucket, recomputed here so the two
 * guards partition ONE population instead of each counting its own.
 */
export function anonymousMarshalSites(): string[] {
  const out: string[] = []
  for (const f of readdirSync(BFF_DIR).sort()) {
    if (!f.endsWith('.go') || f.endsWith('_test.go')) continue
    const text = readFileSync(resolve(BFF_DIR, f), 'utf8')
    for (const m of text.matchAll(/json\.Marshal\(/g)) {
      const rest = text.slice(m.index + m[0].length).split('\n')[0]
      const hit = /^([A-Za-z_][A-Za-z0-9_]*)\{/.exec(rest)
      if (hit && hit[1] !== 'struct') continue
      out.push(`${f}:${text.slice(0, m.index).split('\n').length}`)
    }
  }
  return out
}
