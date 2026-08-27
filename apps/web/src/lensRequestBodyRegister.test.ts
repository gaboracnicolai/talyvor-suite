import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  LENS_BODIES,
  NON_LENS_ANON_SITES,
  ROOT,
  anonymousMarshalSites,
  bindsOnly,
  cannotCalls,
  sentKeys,
  type LensBody,
} from './lensRequestBodies'

/**
 * THE SIX REQUEST BODIES THIS BFF SENDS talyvor-lens, AND NOTHING ASKED talyvor-lens ABOUT THEM.
 *
 * `aiRequestBodyRegister.test.ts` next door does this for the five talyvor-docs bodies built from a
 * NAMED Go struct. Its own census put nine more marshalled bodies in an `anonymous` bucket it could
 * not name, pinned at a literal `9` with the sentence "none is in deploy/decision-expiry.sh today".
 * Six of those nine are key sets talyvor-lens binds. These are those six.
 *
 * ── THE MEASUREMENT THIS GUARD'S TEXT COMES FROM ─────────────────────────────
 *
 * The consequence sentences below are not reasoned from the code, they are EXECUTED. Every one of
 * these six lens handlers decodes with a plain `json.NewDecoder(req.Body).Decode(&in)` — NOT
 * `DisallowUnknownFields` — so a renamed key upstream is indistinguishable from an absent one and
 * the field takes its ZERO VALUE with the decode reporting success. What that zero value then DOES
 * was measured against talyvor-lens `f09348d1e3e1f090ff9de7ca245daeeec8656676`, in a read-only
 * `git archive` scratch export (that repo was held by tab-8d3f and was NEVER written to), by
 * driving lens' own code: the REAL `newProvisionHandler` over fakes for its two interfaces, and the
 * REAL downstream validators (`tenant.Store.CreateAPIKey`, `billing.AllowedTopUpCents`,
 * `economy.DualTokenStore.ConvertLENStoLXC`, `workspace.Manager.SetDistillPolicy` /
 * `SetCachePoolable`) for the five mounted as closures inside `main.go`. Nine cases, every verdict
 * PREDICTED BEFORE THE RUN and the harness failing on any mismatch:
 *
 *   route                              key               rename ⇒
 *   POST /v1/provision                 identity          LOUD    400 "identity required"
 *   POST /v1/provision                 ttl_hours         SILENT  200, session JWT 8h ⇒ 24h
 *   POST /v1/provision                 cache_poolable    SILENT  200, the choice never reaches
 *                                                                the manager; the default applies
 *   POST …/api-keys                    scopes            LOUD    refused AT ISSUANCE
 *   POST …/api-keys                    name              SILENT  key created with Name=""
 *   POST …/billing/checkout            usd_cents         LOUD    0 ∉ [1000 5000 10000]
 *   POST …/lxc/convert                 lxc_amount_ulxc   LOUD    0 < 100000 µLXC minimum
 *   PUT  …/distill                     distill_policy    SILENT  200, "disabled" ⇒ "always"
 *   PUT  …/cache-poolable              cache_poolable    SILENT  200, opted-in true ⇒ false
 *
 * ⚠⚠ THE MONEY ROUTES FAIL LOUD AND THE CONSENT ROUTES FAIL SILENT, WHICH IS THE OPPOSITE OF WHERE
 * THE ATTENTION HAS GONE. Both amounts are refused by an upstream allow-list or minimum, so a
 * renamed `usd_cents` or `lxc_amount_ulxc` is a 400 a person sees. Every route that records a
 * CHOICE — pooling consent, distill policy, session lifetime — answers 200 and stores something
 * else.
 *
 * ⚠⚠ AND THE SHARPEST ONE IS distill_policy, BECAUSE THE FAIL-SAFE IS AIMED AT THE WRONG SHAPE.
 * `normalizeDistillPolicy` has an explicit `default:` arm that resolves garbage to
 * `DistillDisabled` — its comment says "a misconfiguration never silently distills". A renamed key
 * does not produce garbage, it produces `""`, and `""` is the ONE value with its own arm:
 * `DefaultDistillPolicy`, which is `DistillAlways`. So the single input shape a cross-repo rename
 * can actually generate is the single shape that walks past the fail-safe, and a person who chose
 * "disabled" is recorded as "always".
 *
 * ⚠ ttl_hours IS A CREDENTIAL LIFETIME AND THE BFF CANNOT SEE THE CHANGE. `tenant.go` asks for 8h
 * and its comment says "Kept short: it is a session credential". `auth.ClampTTL(0)` returns
 * `DefaultTokenTTL` = 24h. The BFF reads `expires_at` off the response into `lensTokenExp`, so it
 * records the 24h faithfully — every layer agrees, and the credential lives three times as long as
 * the only file that states an intention asks for.
 *
 * ── WHAT THIS GUARD CLAIMS, PRECISELY ───────────────────────────────────────
 *
 * The same one link the two sibling registers claim, and no more: the key set the deployer's
 * command asks talyvor-lens about is the key set this repository actually sends. It does NOT claim
 * any body matches its upstream — CI checks out this repository alone and nothing here can. Only
 * running the entry's command in a talyvor-lens checkout answers that, which is the entry's whole
 * job and why these exist at all.
 *
 * ⚠ WHAT IT CANNOT SEE, said out loud so the scope is not mistaken for coverage: a key renamed in
 * BOTH this repo and the register in one change is not a red here. From inside this repository that
 * is indistinguishable from a correct rename.
 *
 * ⚠ THE FLOORS ARE NOT DECORATION. Every half is parsed out of source, so a rename or a reformat
 * yields no match — at which point a set equality over two empty sets passes having read nothing.
 * Every body parse asserts its anchor occurs EXACTLY ONCE; the anonymous-marshal census is asserted
 * non-empty before it is partitioned; and the register is held to exactly as many lens entries as
 * this table has rows.
 */

const REGISTER = resolve(ROOT, 'deploy/decision-expiry.sh')
const ENTRIES = cannotCalls(readFileSync(REGISTER, 'utf8'))

/**
 * Every register entry whose settle command greps one of this table's upstream anchors. The anchor
 * is a fixed string handed to `grep -F`, so "the command names this route's mount line" is an exact
 * containment question rather than a pattern match that could drift.
 */
const LENS_ENTRIES = ENTRIES.filter((a) => LENS_BODIES.some((b) => a[2].includes(b.upstreamAnchor)))

function entryFor(b: LensBody): string[] | null {
  const hits = LENS_ENTRIES.filter((a) => a[2].includes(b.upstreamAnchor))
  return hits.length === 1 ? hits[0] : null
}

/** The key set a settle command compares talyvor-lens' bind tags against. */
function expectedInCommand(command: string): string[] | null {
  const m = /=\s*"([a-z0-9_\s]*)"\s*\]/.exec(command)
  if (!m) return null
  const names = m[1].split(/\s+/).filter((s) => s !== '')
  return names.length === 0 ? null : names
}

describe('every request body this BFF sends talyvor-lens is a question the register asks it', () => {
  for (const b of LENS_BODIES) {
    describe(`${b.route} ← ${b.file}`, () => {
      it('the sent body parses, with at least one key', () => {
        expect(
          sentKeys(b),
          `\`${b.subject}\` did not parse out of ${b.file} (anchor: ${b.anchor}). Every rule below ` +
            'compares the keys this app SENDS against a key set in deploy/decision-expiry.sh; with ' +
            'nothing parsed the comparison is between two empty sets and passes having read ' +
            'nothing. Re-anchor the parse deliberately, or drop the row and delete its register ' +
            'entry in the same change.',
        ).not.toBeNull()
      })

      it('the file declares which bound keys it does NOT send', () => {
        expect(
          bindsOnly(b),
          `${b.file} holds no single \`UPSTREAM-BINDS-ONLY ${b.subject}: …\` declaration. None of ` +
            'these six lens handlers uses DisallowUnknownFields, so an unsent key upstream is not ' +
            'a refusal — it is a ZERO VALUE that gets stored: a renamed distill_policy records ' +
            '"always" for someone who chose "disabled". A key lens binds and this app omits is ' +
            'therefore a decision. Write `none` where there is nothing omitted; a blank is not a ' +
            'declaration.',
        ).not.toBeNull()
      })

      it('nothing is declared unsent while the body sends it', () => {
        const sent = new Set(sentKeys(b) ?? [])
        expect(
          (bindsOnly(b) ?? []).filter((n) => sent.has(n)),
          `${b.file} declares a key as bound-upstream and NOT sent, and ${b.subject} sends it. The ` +
            'two halves of the claim contradict each other, and a reader believes whichever they ' +
            'read first.',
        ).toEqual([])
      })

      it('deploy/decision-expiry.sh holds exactly one settle command for it', () => {
        expect(
          entryFor(b),
          `no single \`cannot\` entry in deploy/decision-expiry.sh greps \`${b.upstreamAnchor}\` ` +
            `out of \`${b.upstreamFile}\`. This repository's CI cannot read talyvor-lens, so that ` +
            'entry is the ONLY thing that asks a deployer whether the keys this app sends are ' +
            'still the keys that handler binds. Without it the claim is a sentence in a Go ' +
            'comment — and on three of these six routes a wrong key is a 200 that stores a ' +
            'different answer than the person gave.',
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
          'the settle command holds no `[ "$(…)" = "…" ]` expectation, so it is not comparing the ' +
            "handler's bind tags to anything. A command read for its exit status is the `grep -c` " +
            'hazard in a new coat: the pipeline exits 0 whether or not the handler was found.',
        ).not.toBeNull()
        expect(
          inCommand,
          `deploy/decision-expiry.sh asks talyvor-lens about a different key set than ` +
            `${b.subject} plus its declared omissions describe. A deployer running that command ` +
            'gets a confident yes about a body this repo does not send — a pass for the wrong ' +
            'question, which is worse than no entry at all.',
        ).toEqual([...(sent ?? []), ...(unsent ?? [])].sort())
      })
    })
  }

  it('the anonymous marshal population is partitioned, not sampled', () => {
    const sites = anonymousMarshalSites()
    expect(
      sites.length,
      'no anonymous `json.Marshal(` parsed out of apps/bff at all. This is the population — with ' +
        'nothing parsed the partition below is between empty sets and passes having read nothing, ' +
        'which is precisely the silence it exists to break.',
    ).toBeGreaterThan(0)
    expect(
      sites.length,
      `apps/bff holds ${sites.length} anonymous marshal sites (${sites.join(', ')}), and this ` +
        `table accounts for ${LENS_BODIES.length} of them with ${NON_LENS_ANON_SITES.length} named ` +
        'as not-lens. A new one must be a decision — either a seventh row with its own register ' +
        'entry, or an entry in NON_LENS_ANON_SITES saying what it is instead. Silently widening ' +
        'the gap is how nine of these sat outside every register while three named siblings sat ' +
        'inside one.',
    ).toBe(LENS_BODIES.length + NON_LENS_ANON_SITES.length)
  })

  it('every row points at a marshal site that is actually anonymous', () => {
    // The rows and the census are parsed by DIFFERENT code off the same files, so this catches a
    // row whose anchor drifted onto a named struct — at which point the sibling guard would own it
    // and this one would be asking about a body it no longer describes.
    const files = new Set(anonymousMarshalSites().map((s) => s.split(':')[0]))
    for (const b of LENS_BODIES) {
      expect(
        files.has(b.file.replace('apps/bff/', '')),
        `${b.route}'s row names ${b.file}, and the anonymous-marshal census found no site in that ` +
          'file. The row and the population disagree about where this body is built.',
      ).toBe(true)
    }
  })

  it('the register holds no lens request-body entry this table does not account for', () => {
    expect(
      LENS_ENTRIES.length,
      `deploy/decision-expiry.sh holds ${LENS_ENTRIES.length} settle commands naming one of this ` +
        `table's upstream anchors, and the table has ${LENS_BODIES.length} rows. An entry with no ` +
        'row is a question asked on behalf of a body nobody sends — it goes stale with nothing ' +
        'watching and its pass reads as coverage. Add the row or delete the entry.',
    ).toBe(LENS_BODIES.length)
  })
})

/**
 * THE THREE NON-LENS ANON SITES SAY WHETHER THEY ARE ASKED. THIS HOLDS THOSE SENTENCES TO THE
 * REGISTER.
 *
 * ⚠ THE QUEUE ENTRY THAT SCOPED THIS TABLE SAID ALL THREE "REMAIN" — MEASURED AT docs
 * `f5f9257a6521db686471865cddeed17e57b57082`, THAT IS WRONG FOR TWO OF THEM, AND IN THE DIRECTION
 * THAT MATTERS: they are ASKED ALREADY, by the `DocsPage` and `DocsSpace` MIRROR entries, which pin
 * those structs' whole json-tag sets. `content`, `content_text` and `workspace_id` are all members.
 * Nobody wrote that down, so the same entries were about to be added twice — and, worse, the
 * coverage is INCIDENTAL: it holds only because Docs binds the RESPONSE struct on those paths.
 *
 * ⚠ WHICH IS WHY THE PREMISE IS NOW PINNED FOR THE AUTHZ ONE. `apps/bff/lens.go#docsSpaceCreateBody`
 * overwrites `workspace_id` with the SESSION's workspace and forwards every other key VERBATIM —
 * measured, not read: `{"name":"Eng","ws_id":"ws-ATTACKER"}` comes out as
 * `{"name":"Eng","workspace_id":"ws-SESSION","ws_id":"ws-ATTACKER"}`. So a Docs create handler that
 * authorized on a differently named field would find the browser's value already on the wire while
 * the mirror stayed green. That premise — Create decodes into model.Space — is its own entry now.
 *
 * ⚠⚠ THIS RULE PARTITIONS THE WHOLE TABLE AND DOES NOT FILTER IT, BECAUSE ITS FIRST VERSION FILTERED
 * AND CONTROL Z4 CAUGHT IT. That version took its population from rows matching the word `ASKED` in
 * the very prose it was policing, with a `> 0` floor. Rewording ONE row's `ASKED` to `COVERED` left
 * the floor satisfied by the other row and dropped the reworded one OUT of the population entirely —
 * its coverage claim then went unchecked with NOTHING RED (measured: 0 failures). That is the
 * silently-emptied scope this repository has already found twice (formatterReach's rule B, the
 * docsSearchTypes map). Every row is classified now, the two buckets must ACCOUNT FOR ALL THREE, and
 * a row that drifts out of both is a failure rather than an absence.
 */
describe('every non-lens anon site is either asked by a named register entry or declared exempt', () => {
  it('parses the register at all', () => {
    expect(
      ENTRIES.length,
      'no `cannot` entries parsed out of deploy/decision-expiry.sh. Every rule below is a ' +
        'containment question against that list, so an empty parse passes having read nothing.',
    ).toBeGreaterThan(0)
  })

  /** The mirror entry a row leans on, or null. Keyed on the BACKTICKED NAME, not on a verb. */
  const mirrorOf = (what: string) => /`(\w+)` MIRROR ENTRY/.exec(what)?.[1] ?? null
  /** A row that declares it has no key set for the register to ask about. */
  const isExempt = (what: string) => /\bexempt\b/i.test(what)

  for (const [i, site] of NON_LENS_ANON_SITES.entries()) {
    describe(`${site.file} site ${i + 1}`, () => {
      it('is classified — it names a mirror entry, or it declares itself exempt, never neither', () => {
        const mirror = mirrorOf(site.what)
        expect(
          mirror !== null || isExempt(site.what),
          `this row neither names a register entry in the "\`X\` MIRROR ENTRY" form nor declares ` +
            'itself exempt. Those are the only two honest states for a cross-repo claim: something ' +
            'asks talyvor-docs about it, or there is nothing to ask. A row in neither bucket reads ' +
            `as covered while nobody is watching it. Row: ${site.what.slice(0, 140)}…`,
        ).toBe(true)
      })

      it('is not BOTH asked and exempt, which would be two contradictory claims', () => {
        expect(
          mirrorOf(site.what) !== null && isExempt(site.what),
          'this row names a mirror entry AND declares itself exempt. One of the two sentences is ' +
            'false and a reader cannot tell which, so the row states nothing checkable.',
        ).toBe(false)
      })

      const mirror = mirrorOf(site.what)
      if (mirror !== null) {
        it(`the \`${mirror}\` mirror entry it leans on is actually in the register`, () => {
          const hits = ENTRIES.filter((a) => a[0].includes(`${mirror} mirrors`))
          expect(
            hits.length,
            `this row says the \`${mirror}\` mirror entry asks talyvor-docs about its key, and ` +
              `deploy/decision-expiry.sh holds ${hits.length} entries whose decision names ` +
              `"${mirror} mirrors". A row pointing at a deleted or renamed entry is worse than one ` +
              'that claims nothing: it tells the next reader the premise is watched.',
          ).toBe(1)
        })
      }
    })
  }

  it('the two buckets account for every row, so none can drift out of both silently', () => {
    const asked = NON_LENS_ANON_SITES.filter((s) => mirrorOf(s.what) !== null).length
    const exempt = NON_LENS_ANON_SITES.filter((s) => isExempt(s.what)).length
    expect(
      asked + exempt,
      `${asked} rows name a mirror entry and ${exempt} declare themselves exempt, out of ` +
        `${NON_LENS_ANON_SITES.length} rows. This is the rule control Z4 exists for: a population ` +
        'filtered out of the prose it polices can be emptied one row at a time by rewording, and ' +
        'each departure looks exactly like a row that was never there.',
    ).toBe(NON_LENS_ANON_SITES.length)
  })

  it('the space-create binding premise is pinned in its own right, not left to the mirror', () => {
    const hits = ENTRIES.filter((a) => a[2].includes('internal/space/handler.go'))
    expect(
      hits.length,
      'deploy/decision-expiry.sh holds no settle command reading talyvor-docs ' +
        '`internal/space/handler.go`. The DocsSpace mirror covers the `workspace_id` apps/bff pins ' +
        'ONLY because Docs’ Create decodes into model.Space. A create handler that bound its own ' +
        'request struct would move that authz key with the mirror still green, and apps/bff ' +
        'forwards every other key verbatim — so the browser’s value under the new name is ' +
        'already on the wire. Without this entry that is nobody’s question.',
    ).toBe(1)
    expect(
      /=\s*"[^"]+"\s*\]/.test(hits[0]?.[2] ?? ''),
      'the space-create binding command holds no `[ "$(…)" = "…" ]` expectation, so it is not ' +
        'comparing what it extracted. Every stage of a `sed | grep -o` pipeline exits 0 while ' +
        'writing an empty line, and a renamed Create produces exactly that empty line.',
    ).toBe(true)
  })

  /**
   * ⚠ AND THE ROW ABOVE IT LEANS ON A PIN THAT SPANS TWO FILES, WHICH IS WHY THE SUBJECT LIST IS
   * ASSERTED AND NOT JUST THE COMMAND.
   *
   * Row 1 says the `DocsPage` mirror covers stripPageContentList's two deleted key names ONLY
   * because the page LIST still serves `model.Page` rows. That premise has two layers —
   * `Store.List`'s return type AND `page.Handler.List` serving it unprojected — and for two
   * merges the settle command read the first only. MEASURED at docs 806109b5 against a disposable
   * export, mutating the handler and leaving the store alone: a projection added in the handler,
   * the handler renamed, and `internal/page/handler.go` DELETED each left the command exiting 0
   * while the premise was false, with `model.Page`'s tags untouched so the mirror stayed green
   * too. The consequence is not a blanked field: measured through the real stripPageContentList,
   * a projected row went in at 120 bytes and came out at 120 — both deletes matching nothing.
   *
   * ⚠ R6 IN settleCommands.test.ts POLICES "a declared subject the command never reads". It could
   * not see this, because the unread half was never DECLARED — the entry named one file and read
   * that one file. So this rule holds the DECLARATION, and R6 holds the reading. Either alone is
   * a scope that can be emptied by editing the other: drop the handler from the subject list and
   * R6 goes quiet with nothing red, which is the Z4 shape this file already carries a control for.
   */
  it('the page-LIST premise is pinned across BOTH layers it spans, not just the store', () => {
    const hits = ENTRIES.filter((a) => a[0].includes('page LIST still serves model.Page rows'))
    expect(
      hits.length,
      'deploy/decision-expiry.sh holds no entry pinning that talyvor-docs\' page LIST still ' +
        'serves model.Page rows. Without it, apps/bff#stripPageContentList deleting `content` ' +
        'and `content_text` BY NAME is nobody\'s question, and the failure mode ships a document ' +
        'rather than blanking a field.',
    ).toBe(1)
    const [, where, command] = hits[0]
    for (const path of ['internal/page/handler.go', 'internal/page/store.go']) {
      expect(
        where.includes(path),
        `the page-LIST entry does not declare talyvor-docs ${path} as a subject. The premise ` +
          'spans the handler AND the store; an entry that declares one of them tells R6 there is ' +
          'only one file to check, and R6 then passes having asked about half a premise.',
      ).toBe(true)
      expect(
        command.includes(path),
        `the page-LIST settle command never names ${path}. A \`sed\` pipeline reads exactly the ` +
          'paths it writes down — there is no build graph to reach the rest — so a half it does ' +
          'not name is a half nothing reads.',
      ).toBe(true)
    }
    expect(
      /=\s*"[^"]+"\s*\]/.test(command),
      'the page-LIST command holds no `[ "$(…)" = "…" ]` expectation, so it is not comparing what ' +
        'it extracted. A deleted handler file yields an EMPTY capture, and an empty capture must ' +
        'fail this comparison rather than satisfy it.',
    ).toBe(true)
  })
})
