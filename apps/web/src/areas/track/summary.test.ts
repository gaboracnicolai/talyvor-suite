import { describe, expect, it } from 'vitest'
import { readSummary } from './summary'

// ⚠ THE THREE BODIES BELOW ARE NOT INVENTED. They were MEASURED by running talyvor-track's own
// engine at `eb0b39b` (tab-9e42, scratch copy, no DB needed): `SummarizeThread` was driven with
// 0/1/9/10 comments against an engine with a Lens URL and NO mint key, and the handler's branch
// table was applied to each result. The bytes it produced:
//
//     comments= 0 → 200 {"min_comments":10,"summary_available":false}
//     comments= 1 → 200 {"min_comments":10,"summary_available":false}
//     comments= 9 → 200 {"min_comments":10,"summary_available":false}
//     comments=10 → 200 {"ai_available":false,"reason":"AI is not configured: set TRACK_LENS_MINT_KEY …"}
//
// AI was equally unconfigured in all four.

describe('readSummary — one of four named states, never a guess', () => {
  it('reads a real summary, and the three optional fields survive', () => {
    const v = readSummary({
      summary: 'Two people disagree about scope.',
      key_points: ['a', 'b'],
      next_action: 'Decide the boundary',
      sentiment: 'blocked',
    })
    expect(v).toEqual({
      kind: 'summary',
      summary: 'Two people disagree about scope.',
      keyPoints: ['a', 'b'],
      nextAction: 'Decide the boundary',
      sentiment: 'blocked',
    })
  })

  it('a summary whose optional fields are absent is still a summary, not a fault', () => {
    const v = readSummary({ summary: 'Short one.' })
    expect(v).toEqual({ kind: 'summary', summary: 'Short one.', keyPoints: [], nextAction: '', sentiment: '' })
  })

  it('ai_available:false is the AI-off state and carries the operator sentence', () => {
    const v = readSummary({
      ai_available: false,
      reason: 'AI is not configured: set TRACK_LENS_MINT_KEY to the value of Lens’s LENS_MINT_KEY.',
    })
    expect(v.kind).toBe('ai-unavailable')
    expect(v).toHaveProperty('reason', expect.stringContaining('TRACK_LENS_MINT_KEY'))
  })

  it('summary_available:false is the too-short state and the threshold comes off the wire', () => {
    expect(readSummary({ summary_available: false, min_comments: 10 })).toEqual({
      kind: 'too-short',
      minComments: 10,
    })
  })

  // ⚠ NO 10 IS WRITTEN IN THIS APP. If Track stops sending the number, the screen must name none
  // rather than keep repeating the value it last knew.
  it('an absent min_comments is null, not a remembered 10', () => {
    expect(readSummary({ summary_available: false })).toEqual({ kind: 'too-short', minComments: null })
  })

  // ⚠ THE ORDER IS AN ASSERTION, NOT AN ACCIDENT OF HOW THE IFS WERE TYPED. A refusal beside a
  // stale summary field must be reported as the refusal — the reverse renders month-old words as
  // this minute's answer.
  it('a refusal wins over a summary field in the same body', () => {
    expect(readSummary({ ai_available: false, reason: 'r', summary: 'stale words' }).kind).toBe('ai-unavailable')
    expect(readSummary({ summary_available: false, min_comments: 10, summary: 'stale words' }).kind).toBe('too-short')
  })

  // ⚠ PRESENCE IS NOT THE TEST. `ai_available: true` beside a summary is a healthy answer.
  it('ai_available:true does not refuse', () => {
    expect(readSummary({ ai_available: true, summary: 'It works.' }).kind).toBe('summary')
  })

  // ⚠ THE STATE THE WIRE DOES NOT HAVE. Everything else is unrecognised, and unrecognised is NOT
  // a summary — an upstream rename must draw a fault, not a calm empty panel.
  it.each([
    ['null', null],
    ['a string', 'summary'],
    ['a number', 7],
    ['an array', ['summary']],
    ['an empty object', {}],
    ['a renamed field', { text: 'the words' }],
    ['a blank summary', { summary: '   ' }],
    ['summary_available:true with nothing else', { summary_available: true }],
  ])('%s is unrecognised, never a summary', (_name, payload) => {
    expect(readSummary(payload)).toEqual({ kind: 'unrecognised' })
  })
})
