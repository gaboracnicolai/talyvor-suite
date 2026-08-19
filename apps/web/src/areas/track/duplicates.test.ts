import { describe, expect, it } from 'vitest'
import { readDuplicates } from './duplicates'

// ⚠ EVERY PAYLOAD IN THIS FILE IS A BODY THAT WAS OBSERVED COMING OUT OF talyvor-track, not one
// invented to suit the reader. tab-9f27 drove its own `ai.Handler.FindDuplicates` at `6b31a75`
// over a REAL Postgres (throwaway pgvector:pg16, track's 27 migrations) and a recording fake Lens,
// in a /tmp `git archive` export. The eight rows are listed in apps/bff/track_duplicates_test.go.
describe('readDuplicates — the two shapes Track answers with, both 200', () => {
  const SUBJECT = 'iss-subject'

  it('reads the candidate list', () => {
    const v = readDuplicates(
      [{ issue_id: 'iss-2', identifier: 'ENG-2', title: 'login hangs forever', similarity: 0.93 }],
      SUBJECT,
    )
    expect(v).toEqual({
      kind: 'candidates',
      rows: [{ id: 'iss-2', identifier: 'ENG-2', title: 'login hangs forever', similarity: 0.93 }],
      dropped: 0,
      selfNamed: false,
    })
  })

  // ⚠ THE REFUSAL IS AN OBJECT AND THE ANSWER IS AN ARRAY — the discrimination this reader exists
  // for. `{"ai_available":false,…}` is a 200, so `res.ok` says nothing, and a reader that mapped
  // an object onto "no duplicates" would render a deployment with no AI as a clean bill of health.
  it('reads the AI-off refusal, with Track’s own reason verbatim', () => {
    const reason =
      'AI is not configured: set TRACK_LENS_MINT_KEY to the value of Lens’s LENS_MINT_KEY.'
    expect(readDuplicates({ ai_available: false, reason }, SUBJECT)).toEqual({
      kind: 'ai-unavailable',
      reason,
    })
  })

  it('an AI-off body with no reason still classifies as AI-off', () => {
    expect(readDuplicates({ ai_available: false }, SUBJECT)).toEqual({
      kind: 'ai-unavailable',
      reason: '',
    })
  })

  // ⚠ `=== false`, NOT `'ai_available' in payload` — the rule summary.ts already records. Track
  // sends `ai_available: true` beside real content elsewhere in its API, so presence-testing the
  // key would classify a healthy answer as a refusal the day this route grows the field.
  it('does not treat a present-and-true ai_available as a refusal', () => {
    expect(readDuplicates({ ai_available: true }, SUBJECT).kind).toBe('unrecognised')
  })

  it('an empty array is `none`, which is a statement about the RESPONSE and not about the issue', () => {
    expect(readDuplicates([], SUBJECT)).toEqual({ kind: 'none', dropped: 0, selfNamed: false })
  })

  it('anything that is neither shape is unrecognised, never an empty list', () => {
    expect(readDuplicates(null, SUBJECT).kind).toBe('unrecognised')
    expect(readDuplicates('[]', SUBJECT).kind).toBe('unrecognised')
    expect(readDuplicates(7, SUBJECT).kind).toBe('unrecognised')
    // Track's own error shape, which this route answers with a 404 for a foreign issue id —
    // measured. It must not read as "no duplicates".
    expect(readDuplicates({ error: 'issue not found', code: 'NOT_FOUND' }, SUBJECT).kind).toBe(
      'unrecognised',
    )
  })
})

describe('readDuplicates — the rows it will not draw', () => {
  const SUBJECT = 'iss-subject'

  // A row that cannot be drawn is COUNTED, never silently discarded — issueSearch.ts's rule, for
  // its reason: a quietly shorter list is a lie about how much matched.
  it('counts rows with no id and rows with no title', () => {
    const v = readDuplicates(
      [
        { issue_id: '', identifier: 'ENG-9', title: 'has no id', similarity: 0.8 },
        { issue_id: 'iss-3', identifier: 'ENG-3', title: '', similarity: 0.8 },
        'not an object',
        { issue_id: 'iss-4', identifier: 'ENG-4', title: 'drawable', similarity: 0.8 },
      ],
      SUBJECT,
    )
    expect(v).toEqual({
      kind: 'candidates',
      rows: [{ id: 'iss-4', identifier: 'ENG-4', title: 'drawable', similarity: 0.8 }],
      dropped: 3,
      selfNamed: false,
    })
  })

  // ⚠ A SIMILARITY THAT IS NOT A NUMBER IN [0,1] IS `null`, NEVER 0. Defaulting it would draw a
  // confident "0% match" for a value nobody recognised — the tier-dot defect (#149) again, and the
  // same rule issueSearch.ts applies to status and priority.
  it('does not default an unusable similarity', () => {
    const v = readDuplicates(
      [
        { issue_id: 'a', identifier: '', title: 'no similarity', similarity: 'high' },
        { issue_id: 'b', identifier: '', title: 'out of range', similarity: 42 },
        { issue_id: 'c', identifier: '', title: 'absent' },
      ],
      SUBJECT,
    )
    expect(v.kind).toBe('candidates')
    if (v.kind !== 'candidates') return
    expect(v.rows.map((r) => r.similarity)).toEqual([null, null, null])
    expect(v.dropped).toBe(0)
  })
})

// ⚠⚠ THE SUBJECT ISSUE IS IN ITS OWN CANDIDATE LIST UPSTREAM — MEASURED, NOT SUSPECTED.
// `FindDuplicates` lists candidates by workspace + team with NO exclusion of the issue being asked
// about, so the prompt talyvor-track sent carried `- R6X-2 (828fcba3…): the login page hangs` —
// the very issue in question — under the heading "Existing issues"; when the model echoed that id
// back, the route answered `[{"issue_id":"828fcba3…","identifier":"R6X-2","title":"the login page
// hangs","similarity":1}]`. An issue cannot duplicate itself, so the row is not drawn — and the
// fact that it arrived is REPORTED rather than swallowed, because a list that quietly shortens is
// the failure the `dropped` count above exists to prevent.
describe('readDuplicates — the issue named as its own duplicate', () => {
  it('does not draw the subject, and says the answer named it', () => {
    const v = readDuplicates(
      [
        { issue_id: 'iss-subject', identifier: 'ENG-1', title: 'the login page hangs', similarity: 1 },
        { issue_id: 'iss-2', identifier: 'ENG-2', title: 'login hangs forever', similarity: 0.9 },
      ],
      'iss-subject',
    )
    expect(v).toEqual({
      kind: 'candidates',
      rows: [{ id: 'iss-2', identifier: 'ENG-2', title: 'login hangs forever', similarity: 0.9 }],
      dropped: 0,
      selfNamed: true,
    })
  })

  // The self row is NOT counted in `dropped`: dropped means "Track sent something this screen
  // could not draw", and this row was perfectly well-formed. Conflating them would make the two
  // sentences the card prints unable to name what actually happened.
  it('an answer that is ONLY the subject is `none`, and still says it was named', () => {
    const v = readDuplicates(
      [{ issue_id: 'iss-subject', identifier: 'ENG-1', title: 'the login page hangs', similarity: 1 }],
      'iss-subject',
    )
    expect(v).toEqual({ kind: 'none', dropped: 0, selfNamed: true })
  })

  // The guard against the reverse mistake: with no subject id to compare against, nothing may be
  // treated as self — otherwise a caller that forgot the argument would silently lose a real row.
  it('with no subject id, no row is treated as the subject', () => {
    const v = readDuplicates([{ issue_id: 'iss-2', identifier: '', title: 't', similarity: 0.8 }], '')
    expect(v.kind).toBe('candidates')
    if (v.kind !== 'candidates') return
    expect(v.rows).toHaveLength(1)
    expect(v.selfNamed).toBe(false)
  })
})
