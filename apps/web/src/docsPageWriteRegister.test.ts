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
const REGISTER = resolve(ROOT, 'deploy/decision-expiry.sh')

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
