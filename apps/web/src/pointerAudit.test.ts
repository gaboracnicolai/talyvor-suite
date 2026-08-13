import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * A `File.tsx:NN` POINTER IS A CLAIM ABOUT A LINE, AND NOTHING IN THIS REPO CHECKED ONE.
 *
 * This item has now paid for the same lesson three times. `47486d3` wrote it down after its own
 * first draft reported an offender at the wrong line:
 *
 *     a wrong line number in a failure message sends the next reader to the wrong place
 *
 * and then `319335c` regressed it in a different file. The pointers do not rot because anyone
 * edits them — they rot because somebody inserts a line ABOVE the thing they name. Every fix this
 * item ships moves code down, so every merge is an opportunity for silent drift, and a stale
 * pointer is invisible to every instrument here: it is prose to the type checker, prose to eslint,
 * and prose to all seven audits.
 *
 * ── WHAT WAS MEASURED, AND WHY THE SWEEP IS THE POINT ────────────────────────────────────────
 *
 * `319335c` handed over TWO stale pointers, both naming `MuNumeral.tsx:19`. A census of both
 * packages at that SHA finds ELEVEN pointers, and THREE of them are stale — the third,
 * `caseAudit.ts:42`, is stale on BOTH axes and nobody had looked at it:
 *
 *     caseAudit.ts:42  "Landing.tsx:72 is `<span className="font-figure text-eyebrow uppercase
 *                       text-faint">{unit}</span>`"
 *     Landing.tsx:72    <span className="inline-flex items-baseline gap-1.5">      ← the wrapper
 *     Landing.tsx:78    <span className="font-figure text-eyebrow uppercase text-faint">
 *     Landing.tsx:79      <CaseSafe>{unit}</CaseSafe>            ← and it no longer says {unit}
 *
 * That sentence is the load-bearing argument for why the case rule cannot be a source rule, and
 * the code it quotes to prove it had already been changed BY THE FIX THAT RULE EXISTS TO DESCRIBE.
 * Fixing the two that were handed over and not sweeping for the third is this item's own recurring
 * finding — "the fix was applied where the defect was found and the same shape one directory over
 * was never swept for" — which is why this is a census and a pin rather than two edits.
 *
 * ── LIVE vs HISTORICAL IS A CLASSIFICATION, NOT AN EXEMPTION ─────────────────────────────────
 *
 * Three of the eleven name a line as it stood at a NAMED PAST SHA (`1351de9`, `c71ca9c`) and are
 * correct as written — a reader is told they are reading history. They cannot be checked the same
 * way, and skipping them would leave a hole an author could park anything in. So they assert the
 * OPPOSITE: a HISTORICAL pointer's target must NOT contain the fragment. An entry filed as history
 * that has quietly become true again fails as MISFILED and has to be re-read, and an entry filed
 * as LIVE that drifts fails as STALE. Neither direction is a free pass.
 *
 * ── THE FLOOR ────────────────────────────────────────────────────────────────────────────────
 *
 * The table is compared to the census as a SET, both directions. A pointer added anywhere in
 * either package is unclassified and fails; a pointer deleted leaves a stale entry and fails. A
 * source-derived guard cannot see a deletion and a pinned list cannot see an addition, so this
 * repo's answer is to hold both and require them to agree — the failure mode that keeps recurring
 * here is a sweep whose closure quietly went empty while its assertion stayed true.
 *
 * ── THE LIMIT, STATED RATHER THAN IMPLIED ────────────────────────────────────────────────────
 *
 * A pointer is checked against ONE LINE. A sentence that names the right line while describing it
 * wrongly still passes — this pins WHERE, not WHAT. It also reads raw source including comments,
 * deliberately: a pointer inside a comment is exactly the thing being checked, so blanking
 * comments here would empty the closure entirely.
 *
 * ── AND THE WALK WAS `/\.tsx?$/`, SO THE FILES A DEPLOYER READS WERE OUTSIDE IT ──────────────
 *
 * Every claim above is about source comments, and the extension filter made that scope literal:
 * markdown was never opened. MEASURED at `6340cf8` — this repository's six `.md` files carry FIVE
 * in-repo pointers and FOUR ARE STALE:
 *
 *     deploy/README.md:385             "REFUSES TO START if this is set"   apps/bff/main.go:112 → `}`
 *     deploy/FULL-STACK-DEPLOY.md:39   "BFF requires LENS_PROVISION_SECRET"          main.go:94  → a comment line
 *     deploy/FULL-STACK-DEPLOY.md:40   "refuses to boot if LENS_API_KEY is set"      main.go:96  → docsGatewaySecret
 *     areas/docs/BFF-GAPS.md:14        "same as the existing route"       apps/bff/lens.go:74    → /api/bonds
 *
 * TWO of the four are rows of a table whose own header is "Verified from source, with the file and
 * line so you can re-check rather than trust this table" — the column exists so a reader does not
 * have to trust the table, and following those two lands on a comment line and an unrelated struct
 * field. The third is the env-table row telling an operator that `TRACK_WORKSPACE_ID` now stops the
 * boot, cited at a closing brace. The fourth is an area note's account of the Docs proxy.
 *
 * The fifth (`apps/bff/auth.go:14-15`, a note that stale prose still sits there) is CORRECT, so
 * the rot is not universal and the pins are not a formality. None of the four rotted by anyone
 * editing them: main.go's refusals moved ~20 lines down when the config struct grew comments, and
 * lens.go:74 was the ONE Docs route before three more were mounted above it.
 *
 * ⚠ THE POPULATION IS EVERY `.md` IN THE REPOSITORY, not the two package roots — a guard scoped
 * to where the defect was found is how this item keeps re-finding the same shape one directory
 * over. Both enumerations are widened together and still compared both directions.
 *
 * ⚠ THE ONE FORM STILL OUT OF SCOPE, SAID OUT LOUD: `IN_REPO_GO` requires a repo-relative
 * `apps/…` path, so FULL-STACK-DEPLOY.md's two `old main.go:89` / `:92` pointers — deliberately
 * historical, naming a PRE-#30 binary — are skipped as unresolvable rather than swept in. A bare
 * `main.go` names three repositories' main.go and this file cannot tell which; that is the same
 * cross-repo boundary `upstreamCitations.test.ts` refuses to guess at.
 */

const WEB_SRC = resolve(import.meta.dirname)
const UI_SRC = resolve(import.meta.dirname, '../../../packages/ui/src')
const REPO = resolve(import.meta.dirname, '../../..')

/**
 * ⚠ THIS FILE EXCLUDES ITSELF, AND THAT EXCLUSION IS ASSERTED RATHER THAN ASSUMED.
 *
 * The table below quotes all eleven pointers verbatim, so a census that read this file would find
 * every pointer twice and score its own source as product — a guard reading itself back is a
 * failure this repo has already met once. The exclusion is by exact repo-relative path and the
 * test below asserts that path really is on disk, so renaming this file cannot turn the exclusion
 * into a filter that matches nothing.
 */
const SELF = 'apps/web/src/pointerAudit.test.ts'

/**
 * `Some/Path.tsx:123`, `Name.ts:12` — the shape a human writes when citing a line — AND a Go file
 * in THIS repository, `apps/bff/billing.go:180`.
 *
 * ⚠ `.go` WAS MISSING AND THE OMISSION HAD ALREADY COST SOMETHING. `upstreamCitations.test.ts`
 * bans line citations into talyvor-track because the premise lives in another repo and cannot be
 * checked from here; it says in the same breath that `apps/bff/lens.go:366` and
 * `apps/bff/billing.go:180` "name a file IN THIS REPOSITORY … verifiable from here — a guard
 * could actually check them". None did. MEASURED at `eb051cd`: of the three such citations,
 * `checkoutRefusalSurface.test.tsx`'s `apps/bff/billing.go:180` was written at `31095b7` when 180
 * WAS the first line of handleLXCCheckout's doc — "Nothing is charged here … payment happens at
 * Stripe" — and a later commit IN THIS REPOSITORY moved that comment to 200-203. Line 180 is now
 * inside `probeBillingEnabled`, the function whose whole documented purpose is that it can never
 * start a purchase. So a sentence explaining why "nothing was charged" is honest points a reader
 * at the one path that is not the charge, and nothing went red.
 *
 * The same sentence cites `TopUp.tsx:22` in the SAME PARENTHESIS, and that one has been pinned
 * here since it was written. One citation checked, one invisible, one line of prose — and the
 * invisible one is the one that rotted.
 */
const POINTER = /\b([A-Za-z0-9_.\-/]+\.(?:tsx|ts|css|mjs|js|go)):(\d+)\b/g

/**
 * This repository's own Go, the only Go a pointer here can resolve. A `.go` citation naming
 * anything else is a CROSS-REPO one and belongs to `upstreamCitations.test.ts`, which bans the
 * form outright because it cannot be checked from here — it is skipped rather than swept in.
 *
 * Both directions of getting this wrong are already reds, which is why it needs no floor of its
 * own: widen it and the cross-repo citations stop resolving; narrow it to nothing and the pins
 * below become filed-but-not-seen.
 */
const IN_REPO_GO = /^apps\/[A-Za-z0-9_.\-/]+\.go$/

type Kind = 'LIVE' | 'HISTORICAL'
interface Pin {
  kind: Kind
  /** LIVE: the target line must CONTAIN this. HISTORICAL: it must NOT. */
  fragment: string
  why: string
}

/**
 * Every `file:line` pointer in both packages, keyed by `<source>:<line>|<target>:<line>`.
 *
 * The fragment is the thing the quoting sentence promises is there, copied from that sentence
 * rather than from the target — a fragment read off the target would be true by construction.
 */
const PINS: Record<string, Pin> = {
  'apps/web/src/eyebrowAudit.ts:25|apps/web/src/areas/lens/Overview.tsx:226': {
    kind: 'LIVE',
    fragment: 'text-eyebrow uppercase',
    why: "the console's densest eyebrow, the surface `319335c` dropped `uppercase` from to prove 678 tests could not see it",
  },
  'apps/web/src/eyebrowAudit.ts:49|packages/ui/src/components/MuNumeral.tsx:23': {
    kind: 'LIVE',
    fragment: 'text-eyebrow uppercase',
    why: 'the element that OPENS the eyebrow, quoted to show CaseSafe sits inside it rather than on it',
  },
  'apps/web/src/placeholderAudit.ts:34|apps/web/src/areas/lens/Keys.tsx:97': {
    kind: 'LIVE',
    fragment: 'placeholder={k.key_prefix}',
    why: 'the site that passes a placeholder THROUGH a component, the whole argument for reading the DOM',
  },
  'apps/web/src/motion.test.tsx:154|packages/ui/src/preset.ts:149': {
    kind: 'LIVE',
    fragment: 'active:scale-[0.98]',
    why: 'the comment that writes the press one way, half of the pair the motion lock exists to keep apart',
  },
  'apps/web/src/motion.test.tsx:155|packages/ui/src/components/Button.tsx:37': {
    kind: 'LIVE',
    fragment: 'active:scale-98',
    why: 'the comment that writes the press the OTHER way — the two spellings are the point',
  },
  'apps/web/src/PanelReportsItsOwnQuery.test.tsx:28|apps/web/src/areas/lens/Overview.tsx:342': {
    kind: 'LIVE',
    fragment: 'error={ledger.error}',
    why: 'the CORRECT copy of the seam Spend.tsx had backwards — the whole positive control for that finding is that this line reads `ledger.error` while its guard is `ledger.isError`',
  },
  'apps/web/src/PanelReportsItsOwnQuery.test.tsx:303|apps/web/src/areas/lens/Overview.tsx:342': {
    kind: 'LIVE',
    fragment: '<Failed what="the mint ledger" error={ledger.error} />',
    why: 'the same line quoted VERBATIM beside the must-stay-green control that asserts its wording, so the quote and the assertion cannot drift apart',
  },
  'apps/web/src/caseAudit.ts:11|packages/ui/src/components/CaseSafe.tsx:85': {
    kind: 'LIVE',
    fragment: 'normal-case',
    why: 'the ONE applied `normal-case` in the product; the sentence says "exactly ONE ... in the product" in the present tense',
  },
  'apps/web/src/caseAudit.ts:42|apps/web/src/areas/marketing/Landing.tsx:79': {
    kind: 'LIVE',
    fragment: 'font-figure text-eyebrow uppercase text-faint',
    why: 'the uppercase label whose µ arrives as a prop from 130 lines away — the reason the rule cannot be a source rule',
  },
  'apps/web/src/test-setup.ts:202|packages/ui/src/components/CaseSafe.tsx:85': {
    kind: 'LIVE',
    fragment: 'normal-case',
    why: 'a DEVELOPER-FACING FAILURE MESSAGE naming the shape to copy — read exactly when somebody is already confused',
  },

  'apps/web/src/restingAffordance.test.ts:26|apps/web/src/areas/track/IssueList.tsx:357': {
    kind: 'HISTORICAL',
    fragment: 'hover:underline',
    why: 'the offender AS IT STOOD AT `1351de9`, quoted with that SHA; `47486d3` fixed it to `underline underline-offset-2`',
  },
  'apps/web/src/restingAffordance.test.ts:50|apps/web/src/areas/track/IssueList.tsx:325': {
    kind: 'HISTORICAL',
    fragment: 'hover:underline',
    why: "the line that file's own first draft wrongly reported — the sentence exists to say it holds something else",
  },
  'apps/web/src/displayScale.test.ts:20|apps/web/src/areas/track/IssueDetail.tsx:154': {
    kind: 'HISTORICAL',
    fragment: 'text-display-3',
    why: 'the console surface that reached for display type AS AT `c71ca9c`, quoted with that SHA',
  },
  'apps/web/src/areas/track/IssueDetail.tsx:138|apps/web/src/areas/track/IssueList.tsx:260': {
    kind: 'LIVE',
    fragment: 'ApiError, NOT a bare Error',
    why: 'the sentence this write path is the fifth instance of — quoted so the two Track write paths cannot state the rule differently',
  },
  'apps/web/src/errorTypes.test.ts:78|apps/web/src/areas/track/IssueDetail.tsx:98': {
    kind: 'HISTORICAL',
    fragment: 'throw new Error(String(res.status))',
    why: 'the sixth instance AS IT STOOD AT `d7652cf`, quoted with that SHA; this merge made it an ApiError, and rule D is what now holds it there',
  },
  'apps/web/src/errorTypes.test.ts:79|apps/web/src/areas/track/IssueDetail.tsx:120': {
    kind: 'HISTORICAL',
    fragment: 'throw new Error(String(res.status))',
    why: 'the seventh, the comment POST, same SHA and same repair — filed separately because the two paths were controlled separately',
  },

  // The four pointers packages/ui's setup writes when it explains why the audits are installed
  // there. The first two are the evidence that check-audit-reach.mjs's "NO test renders it" was
  // a claim about ONE of two projects; the second two are the precedent for importing upward.
  'packages/ui/src/__tests__/setup.ts:21|packages/ui/src/__tests__/components.test.tsx:46': {
    kind: 'LIVE',
    fragment: '<HoldBar elapsed={3} total={4}',
    why: "the hold-window fixture the reach table said nobody would write — HoldBar's only render anywhere",
  },
  'packages/ui/src/__tests__/setup.ts:22|packages/ui/src/__tests__/promotions.test.tsx:34': {
    kind: 'LIVE',
    fragment: '<FixtureNotice awaiting=',
    why: 'the second component the reach table classified as rendered by no test, rendered by a test',
  },
  'packages/ui/src/__tests__/setup.ts:41|packages/ui/src/__tests__/invariant.test.ts:26': {
    kind: 'LIVE',
    fragment: "'../../../../apps/web/src'",
    why: 'the precedent: this project already reaches up into apps/web from its own tests',
  },
  'packages/ui/src/__tests__/setup.ts:41|packages/ui/src/__tests__/selection.test.ts:255': {
    kind: 'LIVE',
    fragment: "'../../../../apps/web/src'",
    why: 'the second instance of that precedent, so the direction is a habit rather than one file',
  },
  // The four pointers the numeric-field audit and its tests write. Both sites they quote are the
  // MEASUREMENT that rule is built on: one is the offender it was written for, the other is the
  // exemption — a field whose value IS a figure and correctly is not on the face.
  'apps/web/src/fieldFaceAudit.ts:18|apps/web/src/areas/lens/ConvertLens.tsx:283': {
    kind: 'LIVE',
    fragment: 'inputMode="decimal"',
    why: 'the one field in the product that declares itself numeric — the defect this audit was written for',
  },
  'apps/web/src/fieldFaceAudit.ts:68|apps/web/src/areas/lens/ConvertLens.tsx:283': {
    kind: 'LIVE',
    fragment: 'inputMode="decimal"',
    why: 'the same site quoted where the rule argues the declaration is written in a DIFFERENT FILE from the class list',
  },
  'apps/web/src/fieldFaceAudit.ts:20|apps/web/src/areas/marketing/Landing.tsx:320': {
    kind: 'LIVE',
    fragment: 'type="range"',
    why: 'the live slider whose value is a figure OFF the face, and correctly so — the exemption, not a hypothetical',
  },
  'apps/web/src/fieldFaceAudit.ts:104|apps/web/src/areas/marketing/Landing.tsx:320': {
    kind: 'LIVE',
    fragment: 'type="range"',
    why: 'the same slider quoted beside the exemption set itself, so the set cannot be widened without meeting it',
  },
  'apps/web/src/fieldFaceAudit.test.tsx:31|apps/web/src/areas/lens/ConvertLens.tsx:283': {
    kind: 'LIVE',
    fragment: 'inputMode="decimal"',
    why: 'the unit case that pins the predicate to the real call site rather than to an invented fixture',
  },
  'apps/web/src/fieldFaceAudit.test.tsx:51|apps/web/src/areas/marketing/Landing.tsx:320': {
    kind: 'LIVE',
    fragment: 'type="range"',
    why: 'the unit case for the exemption, naming the render it exists to keep quiet',
  },
  // The census behind checkoutRefusalSurface.test.tsx: TopUp was the ONE error surface gated on
  // the error's CLASS, and the argument is only as good as the three siblings it contrasts with.
  // Each of these three is quoted as gating on `isError`; if one of them is ever narrowed to an
  // `instanceof` the way TopUp was, that sentence stops being true and this pin says so.
  'apps/web/src/checkoutRefusalSurface.test.tsx:22|apps/web/src/areas/lens/Keys.tsx:114': {
    kind: 'LIVE',
    fragment: '.isError ?',
    why: 'the sibling with the same fallback shape — revoke gates on isError and picks its 404 words inside',
  },
  'apps/web/src/checkoutRefusalSurface.test.tsx:22|apps/web/src/areas/lens/ConvertLens.tsx:336': {
    kind: 'LIVE',
    fragment: '.isError ?',
    why: 'the closest sibling of all — ConvertError is the same pattern as CheckoutError, and it is used INSIDE the block',
  },
  // The two pointers #166 writes at ConvertError's own repair. Both name the line where this repo
  // FIRST wrote the hazard down, at its third site; the fourth is what that merge fixed. The pin
  // is what stops the citation from decaying into a sentence nobody can check — the exact rot this
  // file was built for, and the reason a line citation is allowed here at all.
  'apps/web/src/areas/lens/convertApi.ts:51|apps/web/src/areas/track/IssueList.tsx:260': {
    kind: 'LIVE',
    fragment: 'ApiError, NOT a bare Error',
    why: 'the comment that names the hand-rolled-error-type hazard, quoted by the fix for its fourth occurrence',
  },
  'apps/web/src/areas/lens/convertRefusal.test.tsx:37|apps/web/src/areas/track/IssueList.tsx:260': {
    kind: 'LIVE',
    fragment: 'ApiError, NOT a bare Error',
    why: 'the same line quoted by the guard, so the finding and its evidence cite one checked place rather than two drifting ones',
  },
  'apps/web/src/checkoutRefusalSurface.test.tsx:23|apps/web/src/areas/track/IssueList.tsx:313': {
    kind: 'LIVE',
    fragment: '.isError ?',
    why: 'the surface #141 fixed, quoted so the two findings are visibly the same shape one area over',
  },
  'apps/web/src/checkoutRefusalSurface.test.tsx:28|apps/web/src/areas/lens/topupApi.ts:199': {
    kind: 'LIVE',
    fragment: '!body.url',
    why: 'the reason a 200 with no url is NOT the finding — it is already converted, so the gate lets it through',
  },
  'apps/web/src/checkoutRefusalSurface.test.tsx:59|apps/web/src/App.tsx:44': {
    kind: 'LIVE',
    fragment: 'onError',
    why: 'the app\'s only global error handler, quoted to show it hangs off the QUERY cache and cannot see a mutation',
  },
  'apps/web/src/checkoutRefusalSurface.test.tsx:62|apps/web/src/areas/lens/topupApi.ts:203': {
    kind: 'LIVE',
    fragment: "'upstream'",
    why: 'the sentence the fix reuses — pinned so "the fix says nothing new" stays a fact rather than a claim',
  },
  // The two pointers the error-type CENSUS writes. Both name the line where this repo first wrote
  // the hazard down, at its third site — the same line convertApi.ts and convertRefusal.test.tsx
  // already cite for the fourth. Four citations of one sentence, all checkable, none drifting.
  'apps/web/src/areas/lens/topupApi.ts:67|apps/web/src/areas/track/IssueList.tsx:260': {
    kind: 'LIVE',
    fragment: 'ApiError, NOT a bare Error',
    why: 'the hazard named at the site of its FIFTH occurrence, on the path that takes money',
  },
  'apps/web/src/errorTypes.test.ts:18|apps/web/src/areas/track/IssueList.tsx:260': {
    kind: 'LIVE',
    fragment: 'ApiError, NOT a bare Error',
    why: 'the census quoting the one place the repo recorded the class, so its list of four is checkable',
  },
  'apps/web/src/checkoutRefusalSurface.test.tsx:65|apps/web/src/areas/lens/TopUp.tsx:22': {
    kind: 'LIVE',
    fragment: 'The payment happens THERE',
    why: 'why "nothing was charged" is honest for a call that never completed — the charge happens after the redirect',
  },
  'apps/web/src/checkoutRefusalSurface.test.tsx:65|apps/bff/billing.go:203': {
    kind: 'LIVE',
    fragment: 'happens at Stripe',
    why: 'the BFF half of the same parenthesis — the sentence promises this line says the payment happens at Stripe AFTER the redirect',
  },
  'apps/web/src/areas/lens/spendWindowCeiling.test.tsx:16|apps/bff/lens.go:366': {
    kind: 'LIVE',
    fragment: 'clampInt(r.URL.Query().Get("limit"), 20, 1, 200)',
    why: 'the first of the TWO independent clamps the page ceiling rests on, quoted verbatim by the sentence that cites it',
  },
  'apps/web/src/upstreamCitations.test.ts:56|apps/bff/billing.go:203': {
    kind: 'LIVE',
    fragment: 'happens at Stripe',
    why: 'the example that paragraph gives of a citation checkable from here — now checked, which is what it asked for',
  },
  'apps/web/src/upstreamCitations.test.ts:55|apps/bff/lens.go:366': {
    kind: 'LIVE',
    fragment: 'clampInt(r.URL.Query().Get("limit"), 20, 1, 200)',
    why: 'its second example, pinned for the same reason',
  },
  'apps/web/src/upstreamCitations.test.ts:62|apps/web/src/areas/lens/TopUp.tsx:22': {
    kind: 'LIVE',
    fragment: 'The payment happens THERE',
    why: 'the citation that WAS pinned, named in the account of why its neighbour was not — so that account cannot rot either',
  },
  'apps/web/src/checkoutRefusalSurface.test.tsx:176|apps/web/src/areas/lens/TopUp.tsx:85': {
    kind: 'LIVE',
    fragment: 'must not leave a pending marker behind',
    why: 'the rule the marker test asserts, quoted from the code that states it rather than restated',
  },

  // ── THE RUNBOOKS ────────────────────────────────────────────────────────────────────────────
  // A deployer following one of these is mid-deploy and checking a refusal before they trip it.
  // The fragment is the REFUSAL ITSELF: a claim that the BFF stops for a variable is worth
  // exactly the line that stops it, so deleting the refusal reds the runbook that promises it.
  'deploy/README.md:385|apps/bff/main.go:117': {
    kind: 'LIVE',
    fragment: 'TRACK_WORKSPACE_ID must not be set',
    why: 'the ~~TRACK_WORKSPACE_ID~~ row promises "the BFF now REFUSES TO START if this is set"; it cited 112, which is a closing brace',
  },
  'deploy/FULL-STACK-DEPLOY.md:39|apps/bff/main.go:111': {
    kind: 'LIVE',
    fragment: 'LENS_PROVISION_SECRET is required',
    why: '"BFF requires LENS_PROVISION_SECRET … Refuses to start, names itself" — it cited 94, a comment line naming a test',
  },
  'deploy/FULL-STACK-DEPLOY.md:40|apps/bff/main.go:120': {
    kind: 'LIVE',
    fragment: 'LENS_API_KEY must not be set',
    why: '"BFF refuses to boot if LENS_API_KEY is set" — it cited 96, the docsGatewaySecret field',
  },
  // The one that was RIGHT, and it is a note about stale prose rather than about behaviour — so it
  // is LIVE on the prose: the day someone rewrites that comment, the note stops being true and
  // this reds instead of quietly outliving the thing it reports.
  'deploy/FULL-STACK-DEPLOY.md:48|apps/bff/auth.go:14': {
    kind: 'LIVE',
    fragment: 'one configured workspace credential',
    why: 'the "cosmetic, not blocking" note that auth.go still describes the old one-workspace model — the only in-repo runbook pointer that was accurate',
  },
  'apps/web/src/areas/docs/BFF-GAPS.md:14|apps/bff/lens.go:87': {
    kind: 'LIVE',
    fragment: '"/api/docs/spaces"',
    why: 'the Docs proxy mechanics are "same as the existing route"; it cited lens.go:74, which is /api/bonds — three more Docs routes were mounted above it',
  },
}

/** Every .ts/.tsx in both packages, TESTS INCLUDED — a failure message is developer-facing text. */
function sourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue
      const p = resolve(dir, name)
      if (statSync(p).isDirectory()) {
        walk(p)
        continue
      }
      if (!/\.tsx?$/.test(name)) continue
      if (relative(REPO, p) === SELF) continue
      out.push(p)
    }
  }
  walk(WEB_SRC)
  walk(UI_SRC)
  return out.sort()
}

/**
 * Every `.md` in the repository — the runbooks, the two area notes, both READMEs.
 *
 * They are SOURCES of pointers, never targets: `resolveTarget` still resolves against
 * `sourceFiles()` and the disk, so a markdown file cannot be cited by line here. That is
 * deliberate rather than incidental — a pointer INTO prose would pin a paragraph's position, and
 * paragraphs move for reasons that are not claims.
 */
function docFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue
      const p = resolve(dir, name)
      if (statSync(p).isDirectory()) {
        walk(p)
        continue
      }
      if (name.endsWith('.md')) out.push(p)
    }
  }
  walk(REPO)
  return out.sort()
}

/**
 * ⚠ THE POPULATION IS ASSERTED, BECAUSE A COMPLETE WALK IS NOT A GUARANTEED ONE. Measured at
 * `033d0a5` by recording every path this test opens — `node:fs` wrapped inside the vitest worker,
 * `~/talyvor-queue/w11-population-census-4b2e.py` — this file reads 102 of the 102 production
 * files under its two roots, tests on top. Its population is WHOLE today. Nothing here said so,
 * and nothing here would have noticed it stop being whole: with the walk made to skip
 * `areas/docs` and nothing else changed, this file stayed GREEN
 * (`~/talyvor-queue/w11-stoppedwalk-controls-4b2e.py`, where all five sweeps in this class were
 * green on the same mutation).
 *
 * ⚠ AND FOR THIS FILE A LOST SUBTREE IS NOT A MISSED CITATION — IT IS A CITATION THAT BECOMES
 * UNVERIFIABLE AND IS NOT SAID TO BE. The rule reads `File.tsx:123` markers and checks the line
 * they point AT. A walk that stops descending removes the TARGETS, so every pin into the lost
 * subtree simply stops being examined; the pins stay in the file reading as though something
 * still checks them. That is the failure mode this repo has named repeatedly — a guard that is
 * green because it can no longer be red.
 *
 * `import.meta.glob` is resolved by Vite at TRANSFORM time and touches `node:fs` not at all, so a
 * wrong root, a changed extension filter or a walk that stops descending cannot move both
 * enumerations the same way. Compared BOTH DIRECTIONS.
 *
 * ⚠ THE CALL IS LITERAL ON PURPOSE. Vite rewrites `import.meta.glob` by matching the SYNTAX at
 * transform time; hoisting the patterns into a variable typechecks and then dies at runtime.
 * ⚠ `SELF` IS SUBTRACTED FROM BOTH SIDES AND FOR TWO DIFFERENT REASONS THAT HAPPEN TO AGREE:
 * the walk drops it deliberately (a file citing itself is not a cross-file pin), and Vite never
 * returns the module that CONTAINS the glob call at all. The rule below that asserts the walk
 * excludes SELF is the one that keeps the first reason honest.
 */
describe('the sweep reads the whole tree', () => {
  const globbed = Object.keys(
    import.meta.glob(['./**/*.{ts,tsx}', '../../../packages/ui/src/**/*.{ts,tsx}']),
  )
    .map((k) => relative(REPO, resolve(import.meta.dirname, k)))
    .filter((p) => p !== SELF)

  it('finds a substantial tree across both roots, so an empty anchor cannot pass', () => {
    // Far below the count at `033d0a5`: this catches a root that resolves to nothing, not a
    // refactor that moves files. The set comparison below is what catches a skip.
    expect(globbed.length).toBeGreaterThan(120)
  })

  it('the fs walk and Vite’s glob agree on the file set, both directions', () => {
    const swept = new Set(sourceFiles().map((p) => relative(REPO, p)))
    const glob = new Set(globbed)
    expect(
      [...glob].filter((f) => !swept.has(f)).sort(),
      'Vite sees files this walk never read. Every citation and every target lives in one of ' +
        'them, so a file missing here holds pins nothing verifies and targets nothing checks.',
    ).toEqual([])
    expect(
      [...swept].filter((f) => !glob.has(f)).sort(),
      'the walk read files Vite does not see. Either it left the two roots, or the two disagree ' +
        'about what a source file is.',
    ).toEqual([])
  })

  /**
   * The SAME both-directions floor for the markdown half, and it needs it more: the `.md` walk
   * starts at the repository root, so it has further to fall. A walk that stopped before `deploy/`
   * would take four pinned runbook pointers out of the census and leave their entries in `PINS`
   * reading as though something still checked them — which is why the set comparison, not a count,
   * is the floor.
   */
  const globbedDocs = Object.keys(
    import.meta.glob(['../../../**/*.md', '!../../../node_modules/**']),
  ).map((k) => relative(REPO, resolve(import.meta.dirname, k)))

  it('finds the markdown files at all, so an empty second walk cannot pass', () => {
    // Six at this commit. A floor, not a pin: this catches a root that resolves to nothing.
    expect(globbedDocs.length).toBeGreaterThan(3)
  })

  it('the .md walk and Vite’s glob agree on the file set, both directions', () => {
    const swept = new Set(docFiles().map((p) => relative(REPO, p)))
    const glob = new Set(globbedDocs)
    expect(
      [...glob].filter((f) => !swept.has(f)).sort(),
      'Vite sees markdown this walk never read — a runbook whose pointers nothing verifies.',
    ).toEqual([])
    expect(
      [...swept].filter((f) => !glob.has(f)).sort(),
      'the walk read markdown Vite does not see. The two disagree about the repository’s shape.',
    ).toEqual([])
  })
})

interface Found {
  key: string
  target: string
  line: number
  source: string
}

/** Resolve a written target to a repo-relative path: a bare basename must be UNIQUE. */
function resolveTarget(written: string, all: string[]): string | null {
  if (written.endsWith('.go')) {
    // Go targets are not in the scanned set (that set is `.ts`/`.tsx`, and the sweep test below
    // holds it equal to Vite's glob), so they are resolved against the disk instead. A path that
    // matches IN_REPO_GO and is NOT there is a red, not a shrug: it is a typo in a citation.
    return existsSync(resolve(REPO, written)) ? written : null
  }
  if (written.includes('/')) {
    const rel = written.replace(/^\.\//, '')
    return all.some((p) => relative(REPO, p) === rel) ? rel : null
  }
  const hits = all.filter((p) => p.endsWith(`/${written}`))
  return hits.length === 1 ? relative(REPO, hits[0]) : null
}

function census(): { found: Found[]; unresolved: string[] } {
  const all = sourceFiles()
  // Sources: both packages' source AND every markdown file. Targets resolve against `all` (and
  // the disk, for Go), so widening the SOURCE set cannot widen what counts as a target.
  const sources = [...all, ...docFiles()]
  const found: Found[] = []
  const unresolved: string[] = []
  for (const p of sources) {
    const rel = relative(REPO, p)
    const text = readFileSync(p, 'utf8')
    const lines = text.split('\n')
    lines.forEach((line, i) => {
      for (const m of line.matchAll(POINTER)) {
        if (m[1].endsWith('.go') && !IN_REPO_GO.test(m[1])) continue
        const target = resolveTarget(m[1], all)
        if (target === null) {
          unresolved.push(`${rel}:${i + 1} -> ${m[1]} (no unique file)`)
          continue
        }
        found.push({ key: `${rel}:${i + 1}|${target}:${m[2]}`, target, line: Number(m[2]), source: rel })
      }
    })
  }
  return { found, unresolved }
}

const { found, unresolved } = census()

describe('every file:line pointer names a line that holds what the sentence promises', () => {
  it('excludes exactly this file, and this file is really there', () => {
    const self = resolve(REPO, SELF)
    expect(statSync(self).isFile()).toBe(true)
    expect(sourceFiles().map((p) => relative(REPO, p))).not.toContain(SELF)
  })

  it('the census is not empty — a sweep over zero pointers asserts nothing', () => {
    expect(found.length).toBeGreaterThan(8)
  })

  it('resolves every written target to exactly one file', () => {
    expect(unresolved).toEqual([])
  })

  it('classifies every pointer found, and finds every pointer classified', () => {
    const seen = found.map((f) => f.key).sort()
    const filed = Object.keys(PINS).sort()
    expect(seen.filter((k) => !filed.includes(k))).toEqual([])
    expect(filed.filter((k) => !seen.includes(k))).toEqual([])
  })

  it('every LIVE pointer names a line that CONTAINS its fragment', () => {
    const stale: string[] = []
    for (const f of found) {
      const pin = PINS[f.key]
      if (!pin || pin.kind !== 'LIVE') continue
      const lines = readFileSync(resolve(REPO, f.target), 'utf8').split('\n')
      const body = lines[f.line - 1]
      if (body === undefined) {
        stale.push(`${f.key} — line ${f.line} is past EOF (${lines.length} lines)`)
        continue
      }
      if (!body.includes(pin.fragment)) {
        stale.push(`${f.key} — expected ${JSON.stringify(pin.fragment)}, line holds ${JSON.stringify(body.trim().slice(0, 80))}`)
      }
    }
    expect(stale).toEqual([])
  })

  it('every HISTORICAL pointer names a line that no longer holds its fragment', () => {
    const misfiled: string[] = []
    for (const f of found) {
      const pin = PINS[f.key]
      if (!pin || pin.kind !== 'HISTORICAL') continue
      const lines = readFileSync(resolve(REPO, f.target), 'utf8').split('\n')
      const body = lines[f.line - 1]
      if (body !== undefined && body.includes(pin.fragment)) {
        misfiled.push(`${f.key} — filed as history but the line holds ${JSON.stringify(pin.fragment)} again`)
      }
    }
    expect(misfiled).toEqual([])
  })
})
