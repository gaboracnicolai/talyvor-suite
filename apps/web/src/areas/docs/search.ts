/**
 * What Docs' search route actually said — and, separately, what it CANNOT say.
 *
 * ⚠ THE RESPONSE HAS NO FIELD FOR WHETHER THE SEMANTIC HALF RAN, AND THAT IS MEASURED RATHER THAN
 * INFERRED. talyvor-docs `7bfa1cf`, its own Search handler mounted over a stub store with Lens
 * deliberately unconfigured (`lensintegration.New("","")`, i.e. this deployment) and driven:
 *
 *     ?q=auth               → 200 {"results":[{…"source":"fulltext"…}],"total":1,"query":…,"took_ms":…}
 *     ?q=auth (no matches)  → 200 {"results":[],"total":0,…}
 *     ?q=auth&type=semantic → 200 {"results":[],"total":0,…}    the full-text store is not called
 *
 * `SemanticSearch.Search` returns `[]SemanticResult{}, nil` when `IsEnabled()` is false; the
 * handler merges that empty half in and the envelope — `{results,total,query,took_ms}` — carries
 * no flag for it. So an all-`fulltext` answer is THE SAME BYTES whether the semantic half ran and
 * matched nothing or was never configured at all.
 *
 * The one conclusion available is one-directional: a row tagged `semantic` or `both` proves the
 * half ran; the absence of one proves nothing. Hence `semantic: 'ran' | 'unknown'` and NO third
 * state — 'off' would be a claim this response cannot support. The classification only ever reads
 * the two positive literals, so an upstream that ADDS a source value can lose evidence here but
 * can never fabricate it.
 *
 * ⚠ `total` IS NOT A CORPUS COUNT AND IS NOT CARRIED. Upstream sets `Total: len(results)`, always
 * — never a count of matching documents. A view field named `total` would be read as one by the
 * next person who looked, so there is not one. (This matters more than it sounds: the BFF refuses
 * the deep pages upstream truncates precisely because a short page with a matching `total` reads
 * as the end of the corpus. See docs_search.go.)
 *
 * ⚠ A ROW THAT CANNOT BE DRAWN IS DROPPED AND COUNTED, NEVER DROPPED SILENTLY. talyvor-docs has
 * fixed this exact failure twice on its own semantic half — a hit whose `url` was a route the SPA
 * does not register (every semantic-only result a dead link), and a hit with no title, rendered as
 * "a line with nothing written on it". `dropped` exists so the screen can say a row arrived and
 * could not be shown, rather than quietly serving a shorter list.
 *
 * ⚠⚠ AND BECAUSE BOTH OF THOSE UPSTREAM DEFECTS WERE ON THE SEMANTIC HALF, THE UNDRAWABLE ROW IS
 * THE PROOF-CARRYING ROW — which is why WHERE the evidence arrived is carried and not just THAT it
 * did. Two facts, not one, and this file used to collapse them in opposite directions:
 *
 *   `semantic`      — the half RAN. Any row proves it, drawable or not. It was computed before the
 *                     drawability check for exactly that reason and then THROWN AWAY on the
 *                     rows-empty branch, which returned a hardcoded 'unknown'. MEASURED: one
 *                     `source:"semantic"` row with no title returned `{kind:'empty',dropped:1,
 *                     semantic:'unknown'}` and the card printed "this answer cannot say whether the
 *                     semantic half ran" while holding the proof that it had.
 *   `semanticShown` — a row ON SCREEN carries it. Only a DRAWN row proves this. Without it the
 *                     card read `semantic` and wrote "at least one of THESE came from the semantic
 *                     index" over a list of full-text rows — MEASURED, a false sentence about a
 *                     visible list, which is the worse of the two.
 *
 * `semanticShown` is not carried on `empty` because there it could only ever be false, and a field
 * that cannot vary is a field the next reader will test anyway.
 */

/** One search hit, in the fields this app draws. */
export interface SearchRow {
  pageID: string
  title: string
  spaceName: string
  /** Docs' `ts_headline` excerpt. May be empty; it is TRUSTED AS TEXT and never as markup —
   *  upstream wraps matches in `<mark>` and this app renders the string, tags and all, as text. */
  headline: string
  /** Exactly as upstream said it. Never widened: see the note on semantic evidence above. */
  source: 'fulltext' | 'semantic' | 'both' | 'unknown'
  /** A path in DOCS' own frontend. Map it with readerHref before using it as an href. */
  url: string
}

export type SearchView =
  | {
      kind: 'results'
      rows: SearchRow[]
      dropped: number
      /** The half RAN — established by ANY row, drawn or dropped. */
      semantic: 'ran' | 'unknown'
      /** A row the reader can SEE carries that proof. Only a drawn row establishes it, and it is a
       *  strictly stronger claim than `semantic` — never derive one from the other. */
      semanticShown: boolean
      query: string | null
    }
  | { kind: 'empty'; dropped: number; semantic: 'ran' | 'unknown' }
  | { kind: 'unrecognised' }

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

export function readSearch(payload: unknown): SearchView {
  if (typeof payload !== 'object' || payload === null) return { kind: 'unrecognised' }
  const p = payload as Record<string, unknown>
  // An absent or renamed `results` is NOT an empty result set — it is a shape this app does not
  // recognise, and the difference is the whole reason readSummary exists next door.
  if (!Array.isArray(p.results)) return { kind: 'unrecognised' }

  const rows: SearchRow[] = []
  let dropped = 0
  let semantic: 'ran' | 'unknown' = 'unknown'
  let semanticShown = false

  for (const raw of p.results) {
    if (typeof raw !== 'object' || raw === null) {
      dropped++
      continue
    }
    const r = raw as Record<string, unknown>
    const pageID = str(r.page_id)
    const title = str(r.page_title)
    const url = str(r.url)
    // ⚠ EVIDENCE IS TAKEN BEFORE THE DRAWABILITY CHECK, DELIBERATELY. A semantic hit that arrives
    // without a title is still proof the half ran — dropping the row must not also drop the one
    // fact this response is able to establish.
    const src = r.source
    const proves = src === 'semantic' || src === 'both'
    if (proves) semantic = 'ran'
    if (pageID === '' || title === '' || url === '') {
      dropped++
      continue
    }
    // ⚠ SET HERE AND NOWHERE ELSE — after the drop, at the push. This is the whole difference
    // between the two facts: `semantic` survives a dropped row and this must not.
    if (proves) semanticShown = true
    rows.push({
      pageID,
      title,
      spaceName: str(r.space_name),
      headline: str(r.headline),
      source: src === 'fulltext' || src === 'semantic' || src === 'both' ? src : 'unknown',
      url,
    })
  }

  // ⚠ `semantic`, NOT 'unknown'. Nothing was drawn, but a dropped row can still have proved the
  // half ran — and on this route the dropped row is the LIKELY carrier of that proof, because both
  // undrawable shapes talyvor-docs has shipped were semantic hits.
  if (rows.length === 0) return { kind: 'empty', dropped, semantic }
  return {
    kind: 'results',
    rows,
    dropped,
    semantic,
    semanticShown,
    // Docs trims the query and echoes what it actually searched for. Absent ⇒ null ⇒ the screen
    // captions nothing rather than echoing the caller's own input back as if it were the answer's.
    query: typeof p.query === 'string' ? p.query : null,
  }
}
