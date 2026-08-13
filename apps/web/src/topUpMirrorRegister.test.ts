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
 * ── THE SECOND FINDING: THE SENTENCE A HUMAN READS WAS NOT THE ONE THAT WAS PINNED ───────────
 *
 * The register entry is one `cannot` call with three arguments — a DECISION, a PREMISE, and the
 * settle COMMAND. The rule above pins the third. MEASURED at `f64ab7c`: the FIRST argument, the
 * line the register PRINTS to a deployer, spells the same list in prose — "Lens still accepts
 * exactly $10 / $50 / $100" — and nothing tied it to anything. Propagate an append the way the
 * guards demand (the declaration, TestAllowedTopUpsRestatedDeliberately, the command in this
 * entry) and the whole tree stays green with that sentence still naming three sizes. The entry
 * would then grep for four and TELL THE DEPLOYER it was checking three: an entry whose prose has
 * gone stale settles the wrong question in the reader's head while the machine half settles the
 * right one, which is the same defect this file was written for, one argument to the left.
 *
 * The same census found the prose in three more places, all unpinned, all on the money path —
 * named by the comment they sit in rather than by line, because a line number in a comment is the
 * claim `upstreamCitations.test.ts` was written about:
 *
 *     apps/bff/billing.go                 the header's account of why the list is copied at all
 *     apps/bff/billing.go                 the doc comment on the declaration itself
 *     apps/bff/billing.go                 formatUSDCents's doc, which spells the three as its
 *                                         examples of what it renders
 *     apps/web/src/areas/lens/topupApi.ts the header section headed WHY THE AMOUNTS ARE FETCHED,
 *                                         NEVER HARDCODED — which then hardcodes them in prose
 *
 * ⚠ WHY THIS IS A DERIVATION AND NOT A SECOND COPY OF A MONEY FORMATTER. The reason the previous
 * session left this open was that pinning the prose looked like it needed `formatUSDCents`
 * rewritten in TypeScript — a second money renderer to keep honest. It does not: the rule below
 * reads the NUMERALS out of the prose and multiplies by 100. There is no rendering decision in it
 * (no grouping, no cents, no symbol placement), so there is nothing for it to disagree with the
 * shipped formatters about. An amount that is NOT a whole number of dollars is not matched at all,
 * which is also the escape hatch: a comment that needs to name a non-size writes it with cents.
 *
 * ⚠ WHAT IS EXCLUDED, AND WHY, SO THE SCOPE IS NOT MISTAKEN FOR A SWEEP. Each subject is a REGION
 * chosen by a stated rule — a file's comments, a header comment, one argument of one call — not a
 * hand-picked line. Two other places in the repo name the three amounts and are NOT policed here:
 * figureAudit.ts's TRAP TWO paragraph quotes a rendered REFUSAL MESSAGE as an example inside a
 * rationale (a quotation of an output, not a statement of the list — and it is split across two
 * lines, so a per-region rule would read half of it), and the `.test.tsx` files that assert a
 * MOCKED BFF response are fixtures — an append does not make a fixture wrong. Both are recorded
 * here rather than silently left out.
 *
 * ── WHAT THIS GUARD DOES AND DOES NOT CLAIM ──────────────────────────────────
 *
 * It does NOT claim the BFF's list equals Lens's. Nothing in this repository's CI can claim that,
 * and this file saying otherwise would rebuild the defect one layer up. It claims exactly one
 * link: the list the deployer's command asks about is the list this BFF enforces. Lens's half of
 * the chain is answered by running that command, and by nothing here. The prose rule adds one
 * more link of the same kind: the sentences that SAY what the list is say what it is.
 *
 * ⚠ AND IT IS THE ONLY THING THAT DOES, WHICH WAS MEASURED RATHER THAN ASSUMED. With a fourth
 * size appended and propagated to the declaration, the Go restatement and the settle command —
 * and this file deleted — the other 96 web test files, `go test ./...` and decision-expiry.sh
 * are ALL GREEN, and the register prints the stale sentence while exiting 0. Deleting the prose
 * rules here does not fall back on a weaker check; it falls back on nothing.
 *
 * ⚠ THE TWO FLOORS ARE NOT DECORATION. Both sides are parsed out of source, so a rename, a
 * reformat, or a deleted entry yields no match — at which point an equality rule over two empty
 * lists passes having read nothing. Each side is asserted to parse EXACTLY ONE subject, so the
 * ways this guard can stop seeing are reds rather than silences.
 */

const ROOT = resolve(import.meta.dirname, '../../..')
const BILLING_GO = resolve(ROOT, 'apps/bff/billing.go')
const REGISTER = resolve(ROOT, 'deploy/decision-expiry.sh')
const TOPUP_API = resolve(ROOT, 'apps/web/src/areas/lens/topupApi.ts')

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
 * Every whole-dollar amount a chunk of prose names, in order, AS CENTS.
 *
 * `$10` → 1000. `$1,000` → 100000. `$12.34` and `$250.00` match NOTHING: an amount written with
 * cents is not a whole-dollar spelling of a size, and leaving it unmatched is what lets a comment
 * name a figure that is not one of the sizes without tripping the rule.
 *
 * ⚠ THIS IS NOT A FORMATTER AND MUST NOT BECOME ONE. It reads numerals and multiplies by 100. It
 * makes no rendering decision — no thousands separator of its own, no symbol placement, no
 * fraction digits — so it cannot drift from `formatUSDCents` (Go) or `formatCents` (this app) the
 * way a third rendering of money would. It accepts a grouped numeral because prose may contain
 * one; it never produces one.
 */
function prosedCents(text: string): number[] {
  const out: number[] = []
  for (const m of text.matchAll(/\$([0-9]{1,3}(?:,[0-9]{3})*)(?![0-9,]*\.[0-9])/g)) {
    out.push(Number(m[1].replace(/,/g, '')) * 100)
  }
  return out
}

/** Line comments of a Go or TypeScript source, in order, `//` and leading `*` stripped. */
function lineComments(source: string): string {
  return source
    .split('\n')
    .filter((l) => /^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')
}

/**
 * The double-quoted arguments of every `cannot` call in the register: DECISION, PREMISE, COMMAND.
 * Unescaped by bash's own rule for a double-quoted string: a backslash escapes only `$`, a
 * backtick, `"` and `\`; before anything else it stays a literal backslash, which is what keeps a
 * grep pattern's `\[` a `\[` and not a bracket expression — and what turns the DECISION line's
 * `\$10` back into the `$10` a deployer reads on their terminal.
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

const GO_SOURCE = readFileSync(BILLING_GO, 'utf8')
const DECLARED = declaredTopUps(GO_SOURCE)
const TOPUP_CALLS = cannotCalls(readFileSync(REGISTER, 'utf8')).filter(
  (a) => a[2].includes(LENS_SUBJECT) && a[2].includes('allowedTopUps'),
)
const TOPUP_ENTRIES = TOPUP_CALLS.map((a) => a[2])

/**
 * The prose subjects: every REGION of this repository that states what the allow-list IS, each
 * one picked by a rule rather than by hand. `sites` is how many full restatements the region held
 * when the rule was written — a floor, so that rewording one out of existence is a red and not a
 * silence. Growing past it is fine; every restatement present is checked.
 */
const PROSE_SUBJECTS = [
  {
    what: 'apps/bff/billing.go — its comments',
    why: "the file's own account of why Lens's list is copied here, its declaration doc, and formatUSDCents's examples",
    text: lineComments(GO_SOURCE),
    sites: 3,
  },
  {
    what: 'deploy/decision-expiry.sh — the DECISION line of the top-up entry',
    why: 'the sentence the register prints to a deployer, beside the command it tells them to run',
    text: TOPUP_CALLS[0]?.[0] ?? '',
    sites: 1,
  },
  {
    what: 'apps/web/src/areas/lens/topupApi.ts — its header comment',
    why: 'the comment headed WHY THE AMOUNTS ARE FETCHED, NEVER HARDCODED',
    text: lineComments(
      readFileSync(TOPUP_API, 'utf8').split(/^import\b/m)[0] ?? '',
    ),
    sites: 1,
  },
]

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

describe('every sentence that spells the allow-list spells the one that is enforced', () => {
  for (const subject of PROSE_SUBJECTS) {
    describe(subject.what, () => {
      it('still names whole-dollar amounts at all', () => {
        const declared = DECLARED[0] ?? []
        expect(
          declared.length,
          'nothing parsed out of the declaration, so there is no list to compare the prose to. ' +
            'An equality rule over an empty expectation passes having read nothing.',
        ).toBeGreaterThan(0)
        expect(
          prosedCents(subject.text).length,
          `${subject.what} named ${subject.sites * declared.length} whole-dollar amounts when ` +
            `this rule was written (${subject.why}) and now names fewer. If the prose was ` +
            'deliberately reworded to stop spelling the sizes, drop this subject in the same ' +
            'change and say so — but a silent rewording is how the sentence and the list drift ' +
            'apart without a red, which is the whole subject of this file.',
        ).toBeGreaterThanOrEqual(subject.sites * declared.length)
      })

      it('names exactly the amounts allowedTopUpCents holds, in order, every time', () => {
        const declared = DECLARED[0] ?? []
        expect(declared.length).toBeGreaterThan(0)
        const found = prosedCents(subject.text)
        const restatements: number[][] = []
        for (let i = 0; i < found.length; i += declared.length) {
          restatements.push(found.slice(i, i + declared.length))
        }
        expect(
          restatements,
          `${subject.what} states the top-up sizes in prose and apps/bff/billing.go enforces a ` +
            'different set. The prose is what a reader — a deployer, or the next person to touch ' +
            'this money path — believes; the declaration is what the BFF refuses on. The list is ' +
            'ADDITIVE-ONLY in both repos, so the expected change is an APPEND, and an append that ' +
            'moves the declaration without moving these sentences leaves them quietly false. ' +
            'Amounts are compared as CENTS; write anything that is not a size with cents ' +
            '($250.00) so it is not read as one.',
        ).toEqual(Array.from({ length: restatements.length }, () => declared))
      })
    })
  }
})
