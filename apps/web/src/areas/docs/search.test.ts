import { describe, expect, it } from 'vitest'
import { readSearch } from './search'

// search.ts — the reader between Docs' search envelope and a screen that is not allowed to
// overstate what it received.
//
// ⚠ THE ONE-DIRECTIONAL FACT IS THE WHOLE POINT OF THIS FILE. MEASURED against talyvor-docs
// `7bfa1cf` by running its Search handler with Lens unconfigured: SemanticSearch.Search returns
// `[], nil` when IsEnabled() is false, the handler merges that empty half in, and the envelope
// carries NO flag for it. So an answer of all-`fulltext` rows is the same bytes whether the
// semantic half ran and matched nothing or was never configured at all. A row tagged `semantic`
// or `both` PROVES it ran; the absence of one proves nothing. Nothing below may invert that.

const row = (over: Record<string, unknown> = {}) => ({
  page_id: 'pg-1',
  page_title: 'Auth flow',
  space_name: 'Engineering',
  headline: 'an <mark>auth</mark> excerpt',
  source: 'fulltext',
  url: '/spaces/sp-1/pages/pg-1',
  ...over,
})

const envelope = (results: unknown[]) => ({ results, total: results.length, query: 'auth', took_ms: 3 })

describe('readSearch', () => {
  it('reads a well-formed answer', () => {
    const v = readSearch(envelope([row()]))
    expect(v.kind).toBe('results')
    if (v.kind !== 'results') return
    expect(v.rows).toHaveLength(1)
    expect(v.rows[0].title).toBe('Auth flow')
    expect(v.rows[0].source).toBe('fulltext')
    expect(v.dropped).toBe(0)
  })

  it('separates an empty answer from a malformed one', () => {
    expect(readSearch(envelope([])).kind).toBe('empty')
    // A renamed or missing `results` is NOT an empty result set. This app has shipped an empty
    // list drawn over a failed read twice under other names.
    expect(readSearch({ total: 0, query: 'auth' }).kind).toBe('unrecognised')
    expect(readSearch({ results: null }).kind).toBe('unrecognised')
    expect(readSearch({ results: {} }).kind).toBe('unrecognised')
    expect(readSearch('results').kind).toBe('unrecognised')
    expect(readSearch(null).kind).toBe('unrecognised')
    expect(readSearch(undefined).kind).toBe('unrecognised')
  })

  it('reports the semantic half as HAVING RUN only when a row proves it', () => {
    for (const src of ['semantic', 'both']) {
      const v = readSearch(envelope([row(), row({ page_id: 'pg-2', source: src })]))
      expect(v.kind === 'results' && v.semantic).toBe('ran')
    }
  })

  it('reports UNKNOWN — never "did not run" — when no row proves it', () => {
    // All full-text. On this deployment that is what an unconfigured semantic half looks like;
    // it is ALSO what a configured one that matched nothing looks like. The two are the same
    // bytes, so the answer is "unknown", and there is no third state that claims otherwise.
    const v = readSearch(envelope([row(), row({ page_id: 'pg-2' })]))
    expect(v.kind === 'results' && v.semantic).toBe('unknown')
    // And an empty answer says nothing about it either.
    const e = readSearch(envelope([]))
    expect(e.kind === 'empty' && e.semantic).toBe('unknown')
  })

  it('never lets an unrecognised source value stand in for semantic evidence', () => {
    // A source value this app has never heard of must not be counted as proof the half ran —
    // the classification is one-directional, so an upstream ADDITION can only ever lose
    // evidence, never fabricate it.
    for (const src of ['SEMANTIC', 'vector', '', 'semantic ', null, 7]) {
      const v = readSearch(envelope([row({ source: src })]))
      expect(v.kind === 'results' && v.semantic).toBe('unknown')
    }
  })

  it('drops a row it cannot draw, counts it, and never drops one silently', () => {
    // A row with no title or no address is the failure talyvor-docs fixed twice on its own
    // semantic half (a hit with a blank line for a name, and one whose url was a dead link).
    // Rendering it is offering a reader a line with nothing written on it.
    const v = readSearch(
      envelope([row(), row({ page_id: 'pg-2', page_title: '' }), row({ page_id: 'pg-3', url: '' }), row({ page_id: '' })]),
    )
    expect(v.kind).toBe('results')
    if (v.kind !== 'results') return
    expect(v.rows).toHaveLength(1)
    expect(v.dropped).toBe(3)
  })

  it('is empty-with-a-count, not unrecognised, when every row is undrawable', () => {
    // The envelope was fine; the rows were not. That is a different fact from "the shape
    // changed", and a screen that conflated them would tell an operator to check the wrong thing.
    const v = readSearch(envelope([row({ page_title: '' })]))
    expect(v.kind).toBe('empty')
    if (v.kind !== 'empty') return
    expect(v.dropped).toBe(1)
  })

  // ── WHERE THE EVIDENCE CAME FROM IS PART OF THE EVIDENCE ────────────────────
  //
  // The rule three lines above the drop in search.ts is that evidence is taken BEFORE the
  // drawability check, "dropping the row must not also drop the one fact this response is able to
  // establish". Both branches below used to break that rule in opposite directions, and the rows
  // that trigger them are not hypothetical: the note on `dropped` records that talyvor-docs has
  // shipped an undrawable row twice, BOTH TIMES on its semantic half — a hit whose url was a route
  // its SPA does not register, and a hit with no title. That is exactly the row whose evidence the
  // empty branch threw away and whose evidence the results branch credited to other rows.

  it('keeps the semantic evidence when the only row proving it could not be drawn', () => {
    // Every row undrawable ⇒ `empty`. The half still ran, and the response still proves it.
    const v = readSearch(envelope([row({ source: 'semantic', page_title: '' })]))
    expect(v.kind).toBe('empty')
    if (v.kind !== 'empty') return
    expect(v.dropped).toBe(1)
    expect(v.semantic).toBe('ran')
  })

  it('does not credit a DRAWN row with evidence that arrived on a dropped one', () => {
    // One full-text row is shown; the semantic row was undrawable. "The half ran" is true;
    // "one of the rows on screen came from the semantic index" is false, and a screen given only
    // the first fact will write the second.
    const v = readSearch(envelope([row(), row({ page_id: 'pg-2', page_title: '', source: 'semantic' })]))
    expect(v.kind).toBe('results')
    if (v.kind !== 'results') return
    expect(v.rows).toHaveLength(1)
    expect(v.dropped).toBe(1)
    expect(v.semantic).toBe('ran')
    expect(v.semanticShown).toBe(false)
  })

  it('marks the evidence as SHOWN when a drawn row carries it', () => {
    // The positive control for the two above: with a drawable semantic row both facts are true,
    // so a fix that simply hardcoded `semanticShown: false` would fail here.
    for (const src of ['semantic', 'both']) {
      const v = readSearch(envelope([row(), row({ page_id: 'pg-2', source: src })]))
      expect(v.kind === 'results' && v.semantic).toBe('ran')
      expect(v.kind === 'results' && v.semanticShown).toBe(true)
    }
  })

  it('never turns an empty or all-full-text answer into evidence', () => {
    // The vacuity control on the other side. An empty branch that returned 'ran' unconditionally
    // would pass the first test above and be a fabrication; these two are what stop it.
    const e = readSearch(envelope([]))
    expect(e.kind === 'empty' && e.semantic).toBe('unknown')
    const u = readSearch(envelope([row({ page_title: '' }), row({ page_id: 'pg-2', url: '' })]))
    expect(u.kind).toBe('empty')
    expect(u.kind === 'empty' && u.dropped).toBe(2)
    expect(u.kind === 'empty' && u.semantic).toBe('unknown')
    const s = readSearch(envelope([row()]))
    expect(s.kind === 'results' && s.semanticShown).toBe(false)
  })

  it('carries the query Docs echoed, not the one the caller typed', () => {
    // Docs trims and echoes `query`; a screen that captions results with its own input can show
    // a caption that does not match the answer below it.
    const v = readSearch({ ...envelope([row()]), query: 'auth flow' })
    expect(v.kind === 'results' && v.query).toBe('auth flow')
    // Absent ⇒ null ⇒ the screen captions nothing rather than inventing an echo.
    const w = readSearch({ results: [row()], total: 1 })
    expect(w.kind === 'results' && w.query).toBe(null)
  })

  it('does not read `total` as a corpus count', () => {
    // Upstream sets `total: len(results)` — it has never been a corpus size. A view field named
    // `total` would be read as one by the next person, so there is not one.
    const v = readSearch({ results: [row()], total: 9999, query: 'auth' })
    expect(v.kind).toBe('results')
    expect(Object.keys(v)).not.toContain('total')
  })
})
