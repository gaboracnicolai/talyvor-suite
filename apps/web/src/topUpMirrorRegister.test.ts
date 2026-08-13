import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * THE BFF'S COPY OF LENS'S MONEY ALLOW-LIST IS TIED TO THE DEPLOY-TIME COMMAND THAT CHECKS IT.
 *
 * ── THE FINDING THIS EXISTS FOR ──────────────────────────────────────────────
 *
 * apps/bff/billing.go's header lists three mitigations for copying Lens's top-up allow-list into
 * this repo. The second was: "a test pins the values against the Lens source". MEASURED — it does
 * not. `TestAllowedTopUpsMirrorLens` declared `want := []int64{1000, 5000, 10000}` as a literal in
 * the SAME package and compared `allowedTopUpCents` to it. It read nothing of talyvor-lens, and
 * could not: CI checks out this repository alone.
 *
 * The claim was INERT rather than wrong-today — lens a04310a internal/billing/billing.go:47 is
 * `var allowedTopUps = []int64{1000, 5000, 10000}`, byte for byte the same three sizes. What made
 * it worth a merge is the DIRECTION the list is documented to move in. Both files say the list is
 * ADDITIVE-ONLY (a webhook re-checks it days later, so removing a size would mark a legitimately
 * paid purchase anomalous). So the expected change is an APPEND, and an append is exactly what
 * nothing saw: Lens starts selling a fourth size, `amountAllowed` here refuses it before any dial,
 * /api/lxc/topup-options never offers it, the screen never draws the button, and neither repo goes
 * red. The REMOVAL direction was already covered — Lens answers 400 and handleLXCCheckout reports
 * allow-list drift naming both lists — which is why only this one direction was open.
 *
 * ── WHY THE FIX IS A REGISTER ENTRY AND NOT A TEST ───────────────────────────
 *
 * No test in this repo can read talyvor-lens. A guard that reads it WHEN PRESENT would be inert in
 * CI, which is precisely where it must fire — the same "green because it can never be red" shape
 * the finding is made of. deploy/decision-expiry.sh is what this repo already built for premises
 * that live where it cannot read: they are printed as UNCHECKABLE, never as passes, with a command
 * a deployer runs in the named repo. The premise moved there.
 *
 * That command was proved fail-closed in every state, in a real talyvor-lens checkout, before it
 * was written down — not reasoned into:
 *
 *   the three sizes as they are today        [ "$(grep -c '^var allowedTopUps = …{1000, 5000, 10000}$' …)" = 1 ]   EXIT 0
 *   the same command against an APPENDED fourth size (the arrival case)                                            EXIT 1
 *   the same command with the file absent — grep writes nothing, `[ "" = 1 ]` is false                             EXIT 1
 *   ⚠ the bare form this repo forbids, `grep -c … FILE`, on that same absent file                                  EXIT 2
 *
 * apps/web/src/settleCommands.test.ts polices the SHAPE of that command (it is a `grep -c` entry,
 * so it must compare the count rather than trust grep's exit status). This file polices the other
 * half, the half a shape rule cannot see: THE VALUES IN THE COMMAND ARE THE VALUES THIS REPO
 * ENFORCES. A register entry naming a stale list settles the wrong question and reports a pass for
 * it, which is worse than having no entry at all.
 *
 * ── WHAT THIS GUARD DOES AND DOES NOT CLAIM ──────────────────────────────────
 *
 * It does NOT claim the BFF's list equals Lens's. Nothing in this repository's CI can claim that,
 * and this file saying otherwise would rebuild the defect one layer up. It claims exactly one
 * link: the list the deployer's command asks about is the list this BFF enforces. Lens's half of
 * the chain is answered by running that command, and by nothing here.
 *
 * ⚠ THE TWO FLOORS ARE NOT DECORATION. Both sides are parsed out of source, so a rename, a
 * reformat, or a deleted entry yields no match — at which point an equality rule over two empty
 * lists passes having read nothing. Each side is asserted to parse EXACTLY ONE subject, so the
 * ways this guard can stop seeing are reds rather than silences.
 */

const ROOT = resolve(import.meta.dirname, '../../..')
const BILLING_GO = resolve(ROOT, 'apps/bff/billing.go')
const REGISTER = resolve(ROOT, 'deploy/decision-expiry.sh')

/** The Lens path the register entry must name — the file the deployer's command greps. */
const LENS_SUBJECT = 'internal/billing/billing.go'

/** Every `[]int64{…}` (or grep-escaped `\[\]int64{…}`) list of integers in a chunk of text. */
function int64Lists(text: string): number[][] {
  const out: number[][] = []
  for (const m of text.matchAll(/int64\{([0-9,\s]*)\}/g)) {
    const body = m[1].trim()
    if (body === '') continue
    out.push(body.split(',').map((s) => Number(s.trim())))
  }
  return out
}

/**
 * The BFF's declaration, as the compiler sees it: the ONE `var allowedTopUpCents = []int64{…}`.
 * Comment lines are dropped first — billing.go's header spells the same three amounts in prose,
 * and a guard that cannot tell a mention from a declaration reports the documentation as the
 * subject (deploy/decision-expiry.sh D9 learned that the expensive way).
 */
function declaredTopUps(goSource: string): number[][] {
  const code = goSource
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
    .join('\n')
  return int64Lists(
    code
      .split('\n')
      .filter((l) => /^var allowedTopUpCents = /.test(l))
      .join('\n'),
  )
}

/**
 * The third double-quoted argument of every `cannot` call in the register — the settle command.
 * Unescaped by bash's own rule for a double-quoted string: a backslash escapes only `$`, a
 * backtick, `"` and `\`; before anything else it stays a literal backslash, which is what keeps a
 * grep pattern's `\[` a `\[` and not a bracket expression.
 */
function settleCommands(shell: string): string[] {
  const joined = shell.replace(/\\\n\s*/g, ' ')
  const out: string[] = []
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
    if (args.length >= 3) out.push(args[2])
  }
  return out
}

const DECLARED = declaredTopUps(readFileSync(BILLING_GO, 'utf8'))
const TOPUP_ENTRIES = settleCommands(readFileSync(REGISTER, 'utf8')).filter(
  (c) => c.includes(LENS_SUBJECT) && c.includes('allowedTopUps'),
)

describe('both sides of the top-up allow-list premise are still readable', () => {
  it('apps/bff/billing.go declares exactly one allowedTopUpCents list', () => {
    expect(
      DECLARED.length,
      'the `var allowedTopUpCents = []int64{…}` declaration did not parse. This guard compares ' +
        'that list against the command deploy/decision-expiry.sh tells a deployer to run in a ' +
        'talyvor-lens checkout; with nothing parsed the comparison is between two empty lists and ' +
        'passes having read nothing. Re-anchor the parse on the declaration deliberately.',
    ).toBe(1)
  })

  it('deploy/decision-expiry.sh holds exactly one top-up settle command', () => {
    expect(
      TOPUP_ENTRIES.length,
      'no `cannot` entry in deploy/decision-expiry.sh names both ' +
        `\`${LENS_SUBJECT}\` and \`allowedTopUps\`. The BFF copies Lens's money allow-list and ` +
        'cannot read it at runtime, so that entry is the ONLY thing that asks a deployer whether ' +
        'the copy is still true. Without it the copy is guarded by a test that restates it in the ' +
        'same file — which is the defect this guard was written for, arriving back.',
    ).toBe(1)
  })
})

describe('the deployer is told to check the list this BFF actually enforces', () => {
  it('the settle command names the same amounts as allowedTopUpCents, in the same order', () => {
    const inCommand = int64Lists(TOPUP_ENTRIES[0] ?? '')
    expect(
      inCommand.length,
      'the settle command no longer contains an `[]int64{…}` list, so it cannot be asking about ' +
        'these amounts at all. It must grep the whole Lens declaration line — an APPENDED fourth ' +
        'size is the change this entire premise exists to catch, and a looser pattern matches it.',
    ).toBe(1)
    expect(
      inCommand[0],
      'apps/bff/billing.go enforces one list and deploy/decision-expiry.sh asks talyvor-lens ' +
        'about a different one. A deployer running that command gets a confident yes about a list ' +
        'this BFF does not use — a pass for the wrong question, which is worse than no entry. ' +
        'Both are ADDITIVE-ONLY: if a size was appended here, append it there in the same change.',
    ).toEqual(DECLARED[0])
  })
})
