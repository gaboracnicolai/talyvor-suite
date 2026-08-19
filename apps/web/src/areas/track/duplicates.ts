/**
 * What Track's find-duplicates route actually said — as one of FOUR named states, and, as with the
 * search reader beside it, what it CANNOT say.
 *
 * ⚠⚠ THE ROUTE ANSWERS TWO DIFFERENT SHAPES AND DISCRIMINATES BY SHAPE, NOT BY STATUS. Both are
 * HTTP 200. MEASURED, not read: tab-9f27 drove talyvor-track's own `ai.Handler.FindDuplicates` at
 * `6b31a75` — the real handler and the real `issue.Store` over a REAL Postgres (throwaway
 * pgvector:pg16 with track's own 27 migrations) and a recording fake Lens, in a /tmp `git archive`
 * export, because talyvor-track is held by another tab and was never written to:
 *
 *     a bare ARRAY  [{"issue_id":…,"identifier":"R5X-1","title":…,"similarity":0.93}]
 *     an OBJECT     {"ai_available":false,"reason":"…set TRACK_LENS_MINT_KEY…"}
 *
 * so `res.ok` says nothing about which arrived, and a reader that treated the object as "no
 * duplicates" would render a deployment where AI has never run — which is this one — as a clean
 * bill of health on the very screen a user asked the question from.
 *
 * ⚠ AN EMPTY ARRAY IS AT LEAST FOUR FACTS AND THE RESPONSE CANNOT SAY WHICH. Measured, one row
 * each: the model named nobody; the model named somebody BELOW talyvor-track's 0.7 threshold; the
 * model named an issue that was not in the candidate window, which the id lookup drops in silence;
 * or the window itself was empty. So this view's empty state is called `none` — a description of
 * the RESPONSE — and the screen may never render it as "this issue has no duplicate".
 *
 * ⚠ AND THE WINDOW IS ONE TEAM, NOT THE WORKSPACE. `FindDuplicates` lists candidates by
 * `WorkspaceID` AND `iss.TeamID`, 20 most recent. Measured: a byte-identical twin filed in another
 * team of the SAME workspace was not in the prompt at all and the answer was `[]`. Nothing in this
 * payload records the window, so the screen states it as Track's rule rather than as a finding.
 *
 * ⚠⚠ THE SUBJECT ISSUE IS IN ITS OWN CANDIDATE LIST — MEASURED, AND IT IS AN UPSTREAM DEFECT.
 * That same List has no exclusion for the issue being asked about, so the prompt Track sent
 * carried `- R6X-2 (828fcba3…): the login page hangs` — the very issue in question — under the
 * heading "Existing issues", beside a system prompt that says "You compare a new engineering issue
 * against existing ones". When the model echoed that id back at similarity 1, the route answered
 * with the issue as its own duplicate. An issue cannot duplicate itself, so the row is dropped
 * here — and `selfNamed` records that it ARRIVED, because a list that quietly shortens is exactly
 * the lie `dropped` exists to prevent. The repair belongs in talyvor-track and is reported in the
 * queue; this app declines to draw the nonsense in the meantime.
 */

/** One duplicate candidate, in the fields this app draws. */
export interface DuplicateRow {
  id: string
  /** Track's human key, e.g. `ENG-42`. May be empty — drawn only when present. */
  identifier: string
  title: string
  /**
   * The MODEL's own score, 0–1, or null when Track sent something outside that. Never defaulted to
   * 0: a confident "0% match" for a value nobody recognised is the tier-dot defect (#149) in
   * another costume, and this number is already a claim by a language model rather than a
   * measurement — the screen says whose it is.
   */
  similarity: number | null
}

export type DuplicatesView =
  | { kind: 'candidates'; rows: DuplicateRow[]; dropped: number; selfNamed: boolean }
  | { kind: 'none'; dropped: number; selfNamed: boolean }
  | { kind: 'ai-unavailable'; reason: string }
  | { kind: 'unrecognised' }

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function asSimilarity(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null
}

export function readDuplicates(payload: unknown, subjectIssueId: string): DuplicatesView {
  // ⚠ THE ARRAY IS TESTED FIRST, DELIBERATELY. `typeof [] === 'object'`, so an object-shaped test
  // written first would have to remember to exclude arrays; testing the answer's own shape first
  // means the refusal branch below can never see one.
  if (Array.isArray(payload)) {
    const rows: DuplicateRow[] = []
    let dropped = 0
    let selfNamed = false

    for (const raw of payload) {
      if (typeof raw !== 'object' || raw === null) {
        dropped++
        continue
      }
      const r = raw as Record<string, unknown>
      const id = str(r.issue_id)
      const title = str(r.title)
      if (id === '' || title === '') {
        dropped++
        continue
      }
      // ⚠ NOT COUNTED AS `dropped`, AND THE DIFFERENCE IS THE WHOLE POINT OF TWO FIELDS. `dropped`
      // means "Track sent a row this screen could not draw"; this row was perfectly well formed
      // and is simply not an answer to the question. Conflating them would leave the card unable
      // to say which of the two actually happened.
      if (subjectIssueId !== '' && id === subjectIssueId) {
        selfNamed = true
        continue
      }
      rows.push({
        id,
        identifier: str(r.identifier),
        title,
        similarity: asSimilarity(r.similarity),
      })
    }

    if (rows.length === 0) return { kind: 'none', dropped, selfNamed }
    return { kind: 'candidates', rows, dropped, selfNamed }
  }

  if (typeof payload !== 'object' || payload === null) return { kind: 'unrecognised' }
  const p = payload as Record<string, unknown>

  // ⚠ `=== false`, NOT `'ai_available' in payload` — summary.ts's rule and its reason. Track sends
  // `ai_available: true` beside real content elsewhere in its API, so presence-testing the key
  // would classify a healthy answer as a refusal the day this route grows the field.
  if (p.ai_available === false) {
    return { kind: 'ai-unavailable', reason: str(p.reason) }
  }

  // ⚠ THE FOURTH STATE IS THE ONE THE WIRE DOES NOT HAVE. Anything matching neither shape —
  // Track's own `{"error":…,"code":"NOT_FOUND"}`, a renamed field, a proxy's HTML — is
  // `unrecognised` and NOT an empty list, because an empty list drawn over a failed read is the
  // failure this app has already shipped more than once under other names.
  return { kind: 'unrecognised' }
}
