import { describe, expect, it } from 'vitest'
import { readTriage } from './triage'

// ── WHAT A TRIAGE ANSWER MAY BE READ AS ──────────────────────────────────────
//
// Every payload below is a MEASURED one: tab-7f6b drove talyvor-track's own `ai.Engine.TriageIssue`
// at `655a0a0` over a recording fake Lens (a /tmp `git archive` export — the repo is held by another
// tab and was never written to) and captured the exact bytes a caller receives for each model reply.
// The rows are reproduced in apps/bff/track_triage_test.go's header.
//
// ⚠⚠ THE TWO THAT DECIDE THIS FILE'S SHAPE: a model that OMITS `suggested_priority` and a model that
// suggests Track's priority 0 ("None") produce BYTE-IDENTICAL responses, and so do a model that omits
// `confidence` and one that states 0. Go's zero value and Track's own vocabulary value collide on
// the wire, so this reader may not report either as a suggestion.

const full = {
  suggested_priority: 2,
  suggested_labels: ['bug', 'performance'],
  suggested_assignee: '',
  summary: 'checkout times out under load',
  is_duplicate: false,
  confidence: 0.8,
}

describe('readTriage', () => {
  it('reads a suggestion the model actually made', () => {
    const v = readTriage(full)
    expect(v.kind).toBe('suggestion')
    if (v.kind !== 'suggestion') return
    expect(v.suggestion.priority).toBe(2)
    expect(v.suggestion.priorityAmbiguous).toBe(false)
    expect(v.suggestion.labels).toEqual(['bug', 'performance'])
    expect(v.suggestion.summary).toBe('checkout times out under load')
    expect(v.suggestion.confidence).toBe(0.8)
  })

  // ⚠ THE FINDING, AS AN ASSERTION. These two payloads are what Track sends for two different model
  // replies — one that said "priority 0" and one that said nothing about priority at all. They are
  // the same bytes, so `priority` is null in BOTH and the ambiguity is REPORTED rather than resolved.
  it('reports priority 0 as unknown, because 0 is both Track’s None and an absent field', () => {
    for (const payload of [
      { ...full, suggested_priority: 0 },
      { suggested_labels: ['bug'], suggested_assignee: '', summary: 'x', is_duplicate: false, confidence: 0.8, suggested_priority: 0 },
    ]) {
      const v = readTriage(payload)
      expect(v.kind).toBe('suggestion')
      if (v.kind !== 'suggestion') return
      expect(v.suggestion.priority).toBeNull()
      expect(v.suggestion.priorityAmbiguous).toBe(true)
    }
  })

  // ⚠ AND A VALUE OUTSIDE TRACK'S VOCABULARY IS A THIRD THING, NOT THE SECOND. Measured: a model
  // answering 9 or -1 marshals straight through, because the engine parses the number and Track's
  // store allowlists the KEYS of an update and none of the VALUES. Null priority, but nothing
  // ambiguous about it — the model named something Track does not have.
  it('reads a priority outside 0..4 as no priority, and not as the ambiguous zero', () => {
    for (const bad of [9, -1, 5, 1.5]) {
      const v = readTriage({ ...full, suggested_priority: bad })
      expect(v.kind).toBe('suggestion')
      if (v.kind !== 'suggestion') return
      expect(v.suggestion.priority).toBeNull()
      expect(v.suggestion.priorityAmbiguous).toBe(false)
    }
  })

  // ⚠ A NON-NUMERIC `suggested_priority` IS NOT A TRIAGE ANSWER AT ALL, and this expectation was
  // written the other way first and corrected by the red. Track's field is a Go int: a model
  // replying `"suggested_priority":"2"` fails json.Unmarshal upstream and the handler answers 502,
  // so a string here never came from this route. Reading it as a suggestion-with-no-priority would
  // be this app inventing a shape its upstream cannot produce.
  it('reads a non-numeric priority, and an absent one, as unrecognised', () => {
    for (const bad of ['2', null, true, {}]) {
      expect(readTriage({ ...full, suggested_priority: bad }).kind).toBe('unrecognised')
    }
    const { suggested_priority: _dropped, ...withoutTheField } = full
    expect(readTriage(withoutTheField).kind).toBe('unrecognised')
  })

  it('reports confidence 0 as unstated, for the same reason, and drops one outside 0..1', () => {
    const zero = readTriage({ ...full, confidence: 0 })
    expect(zero.kind).toBe('suggestion')
    if (zero.kind !== 'suggestion') return
    expect(zero.suggestion.confidence).toBeNull()
    expect(zero.suggestion.confidenceAmbiguous).toBe(true)

    for (const bad of [1.4, -0.2, '0.9', null]) {
      const v = readTriage({ ...full, confidence: bad })
      expect(v.kind).toBe('suggestion')
      if (v.kind !== 'suggestion') return
      expect(v.suggestion.confidence).toBeNull()
      expect(v.suggestion.confidenceAmbiguous).toBe(false)
    }
  })

  // ⚠ THE FIELDS THE PROMPT NEVER ASKS FOR ARE NOT READ. `triageSystemPrompt` requests exactly
  // suggested_priority, suggested_labels, summary and confidence; `suggested_assignee` and
  // `is_duplicate` are struct fields with no omitempty, so `"is_duplicate":false` rides on EVERY
  // response whether or not any model considered the question. A screen drawing "not a duplicate"
  // from that would be reporting an answer to a question nobody asked.
  it('ignores suggested_assignee, is_duplicate and duplicate_of entirely', () => {
    const v = readTriage({ ...full, suggested_assignee: 'someone', is_duplicate: true, duplicate_of: 'ENG-7' })
    expect(v.kind).toBe('suggestion')
    if (v.kind !== 'suggestion') return
    expect(Object.keys(v.suggestion).sort()).toEqual([
      'confidence',
      'confidenceAmbiguous',
      'droppedLabels',
      'labels',
      'priority',
      'priorityAmbiguous',
      'summary',
    ])
  })

  it('drops labels it cannot draw and says how many', () => {
    const v = readTriage({ ...full, suggested_labels: ['bug', '', 3, null, 'perf'] })
    expect(v.kind).toBe('suggestion')
    if (v.kind !== 'suggestion') return
    expect(v.suggestion.labels).toEqual(['bug', 'perf'])
    expect(v.suggestion.droppedLabels).toBe(3)
  })

  it('reads a null label list as none, not as a fault', () => {
    const v = readTriage({ ...full, suggested_labels: null })
    expect(v.kind).toBe('suggestion')
    if (v.kind !== 'suggestion') return
    expect(v.suggestion.labels).toEqual([])
    expect(v.suggestion.droppedLabels).toBe(0)
  })

  // Measured: a model replying `{}` produces a full response with every field at its zero value.
  // It is a well-formed ANSWER carrying nothing, which is a different fact from an unreadable one —
  // so it is `none`, the name duplicates.ts uses for the same distinction.
  it('reads the all-zero response as an answer that suggested nothing', () => {
    const v = readTriage({
      suggested_priority: 0,
      suggested_labels: null,
      suggested_assignee: '',
      summary: '',
      is_duplicate: false,
      confidence: 0,
    })
    expect(v.kind).toBe('none')
    if (v.kind !== 'none') return
    expect(v.suggestion.priority).toBeNull()
    expect(v.suggestion.priorityAmbiguous).toBe(true)
    expect(v.suggestion.labels).toEqual([])
    expect(v.suggestion.summary).toBe('')
    expect(v.suggestion.confidence).toBeNull()
  })

  it('reads the AI-off refusal, with Track’s own reason', () => {
    const v = readTriage({ ai_available: false, reason: 'AI is not configured: set TRACK_LENS_MINT_KEY…' })
    expect(v).toEqual({ kind: 'ai-unavailable', reason: 'AI is not configured: set TRACK_LENS_MINT_KEY…' })
  })

  // ⚠ THE REFUSAL IS TESTED BEFORE THE CONTENT, as in summary.ts: a body carrying BOTH must be read
  // as the refusal, or a stale field turns "AI is off" into a suggestion nobody made.
  it('prefers the refusal when a body carries both', () => {
    const v = readTriage({ ...full, ai_available: false, reason: 'off' })
    expect(v.kind).toBe('ai-unavailable')
  })

  // ⚠ `=== false`, NOT `'ai_available' in payload` — summary.ts's rule. Track sends
  // `ai_available: true` beside real content elsewhere in its API.
  it('does not read ai_available: true as a refusal', () => {
    const v = readTriage({ ...full, ai_available: true })
    expect(v.kind).toBe('suggestion')
  })

  it('reads anything else as unrecognised, never as an empty suggestion', () => {
    for (const payload of [
      null,
      undefined,
      'a string',
      42,
      [],
      [{ suggested_priority: 2 }],
      { error: 'issue not found', code: 'NOT_FOUND' },
      { suggestion: { priority: 2 } },
      {},
    ]) {
      expect(readTriage(payload).kind).toBe('unrecognised')
    }
  })
})
