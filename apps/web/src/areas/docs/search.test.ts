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
