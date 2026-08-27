import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * THE TWO KEYS THE PAGE EDITOR WRITES ARE A CROSS-REPO CLAIM, AND THE MIRROR THAT LOOKS LIKE
 * IT COVERS THEM DOES NOT.
 *
 * ── WHY THIS IS NOT ALREADY COVERED ──────────────────────────────────────────
 *
 * `mirrorSubsetRegister.test.ts` and the `DocsPage` entry in `deploy/decision-expiry.sh` pin
 * talyvor-docs' `model.Page` json tags. That covers the page READ, and it covers the page
 * CREATE request — but only because docs' `page.Handler.Create` decodes into `model.Page`.
 *
 * **It does not cover the PATCH at all.** docs' `page.Handler.Update` decodes into
 * `map[string]any`; the gate is `updatableFields` in `internal/page/store.go`, a set no mirror
 * reads. The two disagree in both directions and upstream's own comment says so: `content_text`
 * IS applied and is NOT in the allowlist (it is admitted by an explicit `k != "content_text"`
 * exception), while `ai_cost_usd` is a `model.Page` tag that is deliberately NOT applicable.
 * So the mirror can stay green over a page-write seam that has stopped writing.
 *
 * ⚠ AND A DROPPED KEY IS A 200. Measured by reading docs' store at `fd96dec7`: an un-allowlisted
 * key is `continue`d — "DROPPED IN SILENCE rather than refused — the rest of the request still
 * lands" — and when nothing survives, Update returns `s.GetByID(ctx, id)`. The handler's own
 * `updates["updated_by"]` keeps the SET clause non-empty, so `updated_at` still moves: a save
 * that stored nothing looks like a save that worked, on a page that even looks freshly touched.
 *
 * ── WHAT THIS FILE ADDS ──────────────────────────────────────────────────────
 *
 * The `cannot` entry in the register asks talyvor-docs the question. Its expected key set is a
 * LITERAL, and a literal is maintained by whoever remembers it. This holds that literal to the
 * body this app actually sends: add a key to `docsApi.updatePage` without adding it to the
 * register — i.e. without asking Docs whether the key is applicable — and this reds.
 *
 * ⚠ IT DERIVES BOTH SIDES. Neither the sent keys nor the register's set is transcribed here;
 * both are parsed from their source, so this cannot drift into agreeing with a memory of them.
 * Every extraction asserts it found SOMETHING first — an empty parse must fail rather than
 * vacuously satisfy a subset check, which is the shape a `[]` ⊆ anything comparison hides.
 *
 * Positive controls — scripts/w171-docs-pagewrite-controls.py, 17/17, each predicted before it
 * ran. Twelve exercise the two upstream commands against a disposable `git archive` export of
 * talyvor-docs; these five are this file, and it PASSED ON ITS FIRST RUN, so none of them is
 * decoration:
 *   R1 a third key added to `updatePage`'s patch type      → RED
 *   R2 a key removed from the register's expected set      → RED
 *   R3 the entry's `cannot` call removed, command left     → RED  ← FAILED FIRST. See below.
 *   R4 the prose block above the entry reworded            → GREEN (must-stay-green)
 *
 * ⚠ R3 IS THE ONE THAT PAID FOR ITSELF, TWICE OVER. It was predicted RED and came back GREEN,
 * because this file was grepping the register's TEXT: the command line survives when the
 * `cannot` call that publishes it does not, and a command nobody invokes is a premise nobody
 * asks. Both readers now run the register and parse what it PRINTS. The earlier miss was the
 * same shape one layer up — the first selector matched the prose block, which names the file and
 * the symbol too — which is what R4 exists to keep closed.
 */

const ROOT = resolve(__dirname, '../../..')
const API_TS = resolve(__dirname, 'areas/docs/api.ts')
const LENS_GO = resolve(ROOT, 'apps/bff/lens.go')
const REGISTER = resolve(ROOT, 'deploy/decision-expiry.sh')

/** Every settle command the register PRINTS, trimmed. See registeredAppliedKeys for why printed. */
function printedCommands(): string[] {
  return execFileSync('bash', [REGISTER], { encoding: 'utf8', cwd: ROOT })
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('settle it with:'))
}

/** The keys `docsApi.updatePage` can put on the wire, read off its `patch` parameter type. */
function sentPatchKeys(): string[] {
  const src = readFileSync(API_TS, 'utf8')
  const m = src.match(/updatePage:\s*\([^)]*patch:\s*\{([^}]*)\}/)
  if (!m) {
    throw new Error(
      'could not find docsApi.updatePage\'s patch parameter type in areas/docs/api.ts. ' +
        'This extraction is the whole test: if it stops matching, every assertion below ' +
        'becomes vacuous, so it throws rather than returning [].',
    )
  }
  return [...m[1].matchAll(/([a-z_]+)\??\s*:/g)].map((x) => x[1]).sort()
}

/**
 * The keys the register's page-UPDATE entry says talyvor-docs will APPLY.
 *
 * ⚠ THIS READS THE REGISTER'S OUTPUT, NOT ITS TEXT, AND A CONTROL IS WHY. The first version
 * grepped the file for the command line. Control R3 deleted the entry's `cannot` invocation and
 * left the command line behind — and the test stayed GREEN, because the line it reads is a
 * different line from the one that publishes it. A command sitting in the file that no `cannot`
 * call reaches is exactly the "premise nobody is actually asking" this whole register exists to
 * prevent, so the instrument has to be the thing a deployer sees: run it, read what it prints.
 */
function registeredAppliedKeys(): string[] {
  const printed = execFileSync('bash', [REGISTER], { encoding: 'utf8', cwd: ROOT })
  const entry = printed
    .split('\n')
    .map((l) => l.trim())
    .find(
      (l) =>
        l.startsWith('settle it with:') &&
        l.includes('internal/page/store.go') &&
        l.includes('updatableFields'),
    )
  if (!entry) {
    throw new Error(
      'deploy/decision-expiry.sh does not PRINT a settle command for talyvor-docs\' page ' +
        'updatableFields. That entry is the only thing asking whether this app\'s page writes ' +
        'still land upstream; removing it — or leaving its command in the file with no `cannot` ' +
        'call reaching it — must not be a silent pass.',
    )
  }
  const expected = entry.match(/=\s*"([^"]*)"\s*\]/)
  if (!expected) {
    throw new Error('the page-UPDATE entry no longer compares an extracted list to an expected one')
  }
  // The capture is `<the content_text exception> <allowlist keys…>`; the exception is the
  // half that is NOT an allowlist key, and it is why content_text is applicable at all.
  return expected[1]
    .replace('!allowed && k != content_text', 'content_text')
    .trim()
    .split(/\s+/)
    .sort()
}

describe('the docs page-write seam is asked about, in both directions', () => {
  it('finds the keys this app PATCHes at all', () => {
    expect(sentPatchKeys()).toEqual(['content_text', 'title'])
  })

  it('finds the register entry that asks talyvor-docs about them', () => {
    const keys = registeredAppliedKeys()
    expect(keys.length).toBeGreaterThan(5)
    expect(keys).toContain('content_text')
  })

  it.each(sentPatchKeys())(
    'the register says talyvor-docs still applies %s',
    (key) => {
      expect(
        registeredAppliedKeys(),
        `areas/docs/api.ts#updatePage can send "${key}", and deploy/decision-expiry.sh's ` +
          'page-UPDATE entry does not list it among the keys talyvor-docs will apply. ' +
          'Upstream DROPS an un-applicable key in silence and still answers 200 with the page ' +
          'body, so nothing downstream of this will tell you the write did not land. Either ' +
          'add the key to that entry\'s expected set — having first run its command in a ' +
          'talyvor-docs checkout to confirm the key is really applicable — or stop sending it.',
      ).toContain(key)
    },
  )

  it('content_text is applicable ONLY through the exception, and the entry keeps both in one capture', () => {
    // Same instrument as above, and for the same reason R3 gave: the PRINTED command, so a
    // command left in the file that no `cannot` call reaches cannot satisfy this either.
    const entry = execFileSync('bash', [REGISTER], { encoding: 'utf8', cwd: ROOT })
      .split('\n')
      .map((l) => l.trim())
      .find(
        (l) =>
          l.startsWith('settle it with:') &&
          l.includes('internal/page/store.go') &&
          l.includes('updatableFields'),
      )
    expect(entry, 'the page-UPDATE settle command is not printed by the register').toBeDefined()
    // Removing the exception upstream is the realistic failure — it reads like a stray
    // special case in an allowlist loop — and it kills the editor's only write. The command
    // must capture it in the SAME comparison as the allowlist, or a rename of one and a
    // deletion of the other cannot both be mismatches.
    expect(entry).toContain('!allowed && k !=')
    expect(entry).toContain('updatableFields')
  })
})

/**
 * THE THIRD lens.go PAGE ROUTE, AND THE ONE WHOSE CROSS-REPO CLAIM IS A DELETE RATHER THAN A SEND.
 *
 * `apps/bff/lens.go#docsSpacePages` relays talyvor-docs' page LIST through
 * `stripPageContentList`, which does `delete(row, "content")` and `delete(row, "content_text")`
 * on every row. Those two literals are a claim about another repository's response shape — the
 * same KIND of claim as the two above, made in the opposite direction — and it is the only thing
 * keeping every page's full ProseMirror document off the space tree.
 *
 * ⚠ THE EXISTING BFF TEST CANNOT SEE AN UPSTREAM CHANGE, AND IT LOOKS LIKE IT CAN.
 * `apps/bff/products_test.go` asserts the stripped body contains neither key — the right
 * assertion — but its fake Docs HARDCODES a row carrying both. Both halves of that comparison
 * live in this repository, so it is green whatever talyvor-docs serves: it pins that the delete
 * works on the row this repo invented, never that the row upstream sends is that row.
 *
 * ⚠ WHY THE `DocsPage` MIRROR IS NOT THIS GUARD EITHER, and the reason is the same one this file
 * already exists for one route over. The mirror pins `model.Page`'s tag set, so a RENAME of
 * `content` there is caught. What it cannot see is the list route ceasing to serve `model.Page`:
 * `page.Handler.List` returns whatever `Store.List` returns, and a projection type introduced for
 * the tree view — the ordinary reason to add one — leaves `model.Page` untouched and the mirror
 * green while both deletes stop matching.
 *
 * ⚠ MEASURED RATHER THAN REASONED, against docs `fd96dec790454b133847a399be28704c0ce369ec` in a
 * disposable `git archive` export (that repo was held by another tab and was NEVER written to),
 * driving docs' OWN mounted route over a real pgvector Postgres:
 *
 *     GET /v1/spaces/{id}/pages → 200, 10 rows, 6406 bytes
 *     row key set (24 keys): … content content_text … — both present
 *     the unstripped body contains the seeded document text VERBATIM
 *     after the BFF's two deletes: 5885 bytes — the strip is what removes it
 *
 * So the premise holds TODAY. That is exactly when it is worth registering: nothing here can see
 * the day it stops, and the failure is silent in the worst direction — not a blank field, but a
 * document body shipped to every caller of the tree.
 */
describe('the docs page-LIST premise the BFF strips by name is asked about too', () => {
  /** The keys `stripPageContentList` removes from every row, read off the BFF's own source. */
  function strippedKeys(): string[] {
    const src = readFileSync(LENS_GO, 'utf8')
    const fn = src.match(/func stripPageContentList\(body \[\]byte\)[^]*?\n}/)
    if (!fn) {
      throw new Error(
        'could not find stripPageContentList in apps/bff/lens.go. Every assertion below compares ' +
          'the keys it deletes against the register; with nothing parsed the comparison is over ' +
          'an empty set and passes having read nothing, so this throws instead.',
      )
    }
    const keys = [...fn[0].matchAll(/delete\(row, "([a-z_]+)"\)/g)].map((m) => m[1]).sort()
    if (keys.length === 0) {
      throw new Error('stripPageContentList parsed, but no `delete(row, "…")` in it — see above')
    }
    return keys
  }

  /** The register entry that asks talyvor-docs whether the page list still serves model.Page. */
  function listEntry(): string | undefined {
    return printedCommands().find(
      (l) => l.includes('internal/page/store.go') && l.includes('func (s \\*Store) List('),
    )
  }

  it('finds the keys the BFF deletes from every listed page at all', () => {
    expect(strippedKeys()).toEqual(['content', 'content_text'])
  })

  it('the register asks talyvor-docs whether the page list still serves model.Page rows', () => {
    expect(
      listEntry(),
      'deploy/decision-expiry.sh prints no settle command for talyvor-docs\' `Store.List` return ' +
        'type. apps/bff/lens.go#stripPageContentList deletes "content" and "content_text" BY NAME ' +
        'from every row of that list, and those deletes are the only thing keeping each page\'s ' +
        'full ProseMirror document off the space tree. The BFF test that covers the strip feeds a ' +
        'fake Docs whose row this repository wrote, so it stays green whatever upstream serves; ' +
        'the DocsPage mirror pins model.Page\'s tags but NOT that the list route still returns ' +
        'them. A projection type introduced for the tree view leaves both green and both deletes ' +
        'matching nothing. This repository\'s CI cannot read talyvor-docs, so that entry is the ' +
        'only place a deployer is asked.',
    ).toBeDefined()
  })

  it('the entry pins the RETURN TYPE, not merely that a List function exists', () => {
    const entry = listEntry()
    expect(entry, 'the page-LIST settle command is not printed by the register').toBeDefined()
    // `grep -c` on a function name answers 1 whether it returns []model.Page or []pageRow, so
    // the comparison has to carry the type. An empty capture must MISMATCH, never satisfy.
    //
    // ⚠ THIS READS THE `= "…" ]` EXPECTATION, NOT THE LINE, AND CONTROL S5 IS WHY. The first
    // version asserted the LINE contained "[]model.Page" and was predicted RED for an entry
    // whose comparison had been changed to `= "ok"`. It came back GREEN: the entry's own
    // trailing comment explains the rule and NAMES the type, so the assertion was satisfied by
    // prose while the command compared against something else entirely. That is the same
    // failure the sibling rules above already pay for twice — a selector matching the
    // explanation instead of the thing explained — one layer further in.
    const compared = entry?.match(/=\s*"([^"]*)"\s*\]/)?.[1]
    expect(
      compared,
      'the page-LIST entry no longer compares an extracted value to an expected one, so it is ' +
        'not asking talyvor-docs anything — it is a pipeline whose exit status is read.',
    ).toBeDefined()
    //
    // ⚠⚠ AND THE TYPE ALONE WAS NOT THE PREMISE. This rule used to assert the expectation was
    // EXACTLY `[]model.Page`, which is `Store.List`'s return type and nothing else — while the
    // entry's own comment rested on a second fact, "`page.Handler.List` returns whatever
    // `Store.List` returns", that the command never read. MEASURED at docs 806109b5 against a
    // disposable export, mutating the handler and leaving the store alone: a projection added in
    // page.Handler.List, that handler renamed, and internal/page/handler.go DELETED each left the
    // shipped command EXITING 0 on a premise that was false, with model.Page's tags untouched so
    // the DocsPage mirror above stayed green through all three. So the expectation now carries
    // BOTH halves and this rule asserts both — anchored at the ends rather than by containment,
    // because `[]model.Page` also appears in the entry's prose and containment is what control S5
    // above already caught being satisfied by an explanation.
    expect(
      compared?.endsWith('|[]model.Page'),
      'the page-LIST entry\'s comparison does not END with `[]model.Page`, so a deployer running ' +
        'it gets a confident yes about a list route that may serve a projection type — the exact ' +
        'change this entry exists to catch, and the one that turns both of the BFF\'s by-name ' +
        `deletes into no-ops while every other guard stays green. Compared against: ${compared}`,
    ).toBe(true)
    expect(
      compared?.startsWith('out, err := h.store.List(|'),
      'the page-LIST entry\'s comparison does not open with the store call `page.Handler.List` ' +
        'makes, so it pins the store\'s return type and nothing about the handler that serves it. ' +
        'A projection in the HANDLER leaves Store.List returning []model.Page and this entry ' +
        `saying the premise holds. Compared against: ${compared}`,
    ).toBe(true)
  })

  it('every key the BFF deletes is a key the DocsPage mirror pins upstream', () => {
    // The two halves of the claim: the list serves model.Page (the entry above), and the keys
    // deleted by name are model.Page tags (this). Neither alone is the guard — the first without
    // the second passes over a delete of a key that was never in the struct.
    const mirror = printedCommands().find(
      (l) => l.includes('internal/model/model.go') && l.includes('type Page struct'),
    )
    expect(
      mirror,
      'the register prints no DocsPage mirror command, so there is nothing to check the deleted ' +
        'keys against',
    ).toBeDefined()
    const pinned = mirror?.match(/=\s*"([^"]*)"\s*\]/)?.[1].trim().split(/\s+/) ?? []
    expect(pinned.length, 'the DocsPage mirror pins no tags — an empty set matches anything').toBeGreaterThan(10)
    for (const key of strippedKeys()) {
      expect(
        pinned,
        `apps/bff/lens.go#stripPageContentList deletes "${key}" from every listed page row, and ` +
          '"' + key + '" is not a tag the DocsPage mirror pins on talyvor-docs\' model.Page. A ' +
          'delete of a key the rows do not carry is a no-op that reads as a redaction.',
      ).toContain(key)
    }
  })
})
