import type { IssuePriority } from './types'

/**
 * What Track's triage route actually said — as one of THREE named states, and, much more
 * importantly, which of its numbers mean two things at once.
 *
 * ⚠⚠ MEASURED, NOT READ. tab-7f6b drove talyvor-track's own `ai.Engine.TriageIssue` and
 * `ai.Handler.Triage` at `655a0a0` over a recording fake Lens, in a /tmp `git archive` export
 * (talyvor-track is held by another tab and was never written to). The engine needs no database, so
 * these are the WIRE BYTES a caller receives, one row per model reply — the full table is in
 * apps/bff/track_triage_test.go:
 *
 *     {"suggested_priority":2,…,"confidence":0.8}     → {"suggested_priority":2,"suggested_labels":["bug"],"suggested_assignee":"","summary":"x","is_duplicate":false,"confidence":0.8}
 *     the same reply with NO suggested_priority       → {"suggested_priority":0,…}
 *     a reply saying "suggested_priority": 0          → {"suggested_priority":0,…}      ⚠ THE SAME BYTES
 *     the same reply with NO confidence               → {…,"confidence":0}
 *     a reply saying "confidence": 0                  → {…,"confidence":0}              ⚠ THE SAME BYTES
 *     {"suggested_priority":9,…} / -1                 → 9 / -1, straight through
 *     {}                                             → every field at its zero value
 *     {"ai_available":false,"reason":…}               → the refusal, HTTP 200, when Track has no mint credential
 *
 * ⚠⚠ SO `suggested_priority: 0` IS TWO DIFFERENT FACTS AND NOTHING DOWNSTREAM CAN SEPARATE THEM.
 * Track's vocabulary calls 0 "None" (`model.IssuePriority`, and `priorityLabel(0)` is a real label
 * this app draws elsewhere); Go's zero value fills the same field when the model omits it, and
 * `TriageResult` carries no omitempty. A reader that trusted 0 would report "the AI suggests: None"
 * for a completion that never mentioned priority. So 0 is `priority: null` WITH
 * `priorityAmbiguous: true`, and the screen says which of the two facts it cannot tell apart. Same
 * argument, same shape, for `confidence`.
 *
 * ⚠ A VALUE OUTSIDE 0..4 IS A THIRD THING. The engine json-decodes the model's number and passes it
 * on; 9 and -1 were measured travelling intact. That is null priority too, but nothing about it is
 * ambiguous — the model named something Track's vocabulary does not have — so it is reported
 * separately. (It also matters upstream: `?apply=true` writes that number into the issue, because
 * talyvor-track's store allowlists the KEYS of an update and none of the VALUES. This app's BFF
 * forwards no query at all, so that path is unreachable from a browser — apps/bff/track_triage.go.)
 *
 * ⚠ TWO FIELDS ARE DELIBERATELY NOT READ. `triageSystemPrompt` asks the model for exactly
 * `suggested_priority`, `suggested_labels`, `summary` and `confidence`. `suggested_assignee` and
 * `is_duplicate` (with `duplicate_of`) are struct fields with no omitempty, so `"is_duplicate":false`
 * and `"suggested_assignee":""` ride on EVERY response whether or not any model ever considered
 * either question. Reading them would let this screen report an answer to a question nobody asked —
 * the same class as the tier dot that drew "cheap" for every model outside a two-entry map (#149).
 * Track's own duplicate finder is a different route with a different prompt, and it has a card.
 *
 * ⚠ THE THIRD STATE IS THE ONE THE WIRE DOES NOT HAVE. Anything matching neither the refusal nor a
 * response carrying a numeric `suggested_priority` is `unrecognised` — Track's `{"error":…,"code":…}`,
 * a renamed field, a proxy's HTML — and never an empty suggestion, because a blank-but-calm panel
 * over a failed read is a failure this app has already shipped under other names.
 */

/** The four fields the triage prompt actually asks for, in the form this app can draw. */
export interface TriageSuggestion {
  /** 1–4 when the model named one of Track's real priorities. NULL for 0 (see `priorityAmbiguous`)
   *  and for anything outside 0..4 — never defaulted, because `priorityLabel`'s `?? 'None'` would
   *  turn "I do not know" into a confident answer. */
  priority: IssuePriority | null
  /** True when the wire carried exactly 0 — the value that is both Track's "None" and the value an
   *  absent field gets. It is the reason `priority` is null, and the screen says so out loud. */
  priorityAmbiguous: boolean
  labels: string[]
  /** Entries that arrived and could not be drawn (not a string, or empty). Said, never swallowed. */
  droppedLabels: number
  /** The model's one-line summary. Empty when it sent none — indistinguishable from an empty one. */
  summary: string
  /** The model's OWN self-report, 0–1, or null when it is 0 (see `confidenceAmbiguous`) or outside
   *  the range. Never a measurement; the screen attributes it. */
  confidence: number | null
  /** True when the wire carried exactly 0: "the model said 0" and "the model said nothing" again. */
  confidenceAmbiguous: boolean
}

export type TriageView =
  /** At least one of the four fields the prompt asks for came back readable. */
  | { kind: 'suggestion'; suggestion: TriageSuggestion }
  /** A well-formed answer in which NONE of them did — measured: a model replying `{}` produces
   *  exactly this, and so does one whose reply carried only the two fields nobody asked for. It is
   *  named here rather than derived at the call site for duplicates.ts's reason (`none` vs
   *  `candidates` is the reader's judgement about a RESPONSE) and for one this repo measured: an
   *  empty branch written inside a component is flagged by emptyVsFault.test.ts however carefully
   *  its parent branched on failure, because that rule reads one component at a time. */
  | { kind: 'none'; suggestion: TriageSuggestion }
  | { kind: 'ai-unavailable'; reason: string }
  | { kind: 'unrecognised' }

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function asPriority(v: number): IssuePriority | null {
  return v === 1 || v === 2 || v === 3 || v === 4 ? (v as IssuePriority) : null
}

export function readTriage(payload: unknown): TriageView {
  // ⚠ ARRAYS FIRST: `typeof [] === 'object'`, and this route's success shape is an object. Track's
  // find-duplicates answers a bare array, so a mis-wired call site must land in `unrecognised`
  // rather than be probed for fields it cannot have.
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { kind: 'unrecognised' }
  }
  const p = payload as Record<string, unknown>

  // ⚠ `=== false`, NOT `'ai_available' in payload`, and BEFORE the content — summary.ts's rule and
  // its reasons: Track sends `ai_available: true` beside real content elsewhere in its API, and a
  // body carrying both a refusal and a stale suggestion must be read as the refusal.
  if (p.ai_available === false) {
    return { kind: 'ai-unavailable', reason: str(p.reason) }
  }

  // ⚠ THE PRESENCE OF A NUMERIC `suggested_priority` IS WHAT MAKES THIS A TRIAGE ANSWER. Measured:
  // `TriageResult` has no omitempty on it, so every real response carries the key even when the
  // model replied `{}`. An error body (`{"error":…,"code":"NOT_FOUND"}`) does not.
  if (typeof p.suggested_priority !== 'number') return { kind: 'unrecognised' }
  const raw = p.suggested_priority

  const labelsIn = Array.isArray(p.suggested_labels) ? p.suggested_labels : []
  const labels: string[] = []
  let droppedLabels = 0
  for (const l of labelsIn) {
    if (typeof l === 'string' && l.trim() !== '') labels.push(l)
    else droppedLabels++
  }

  const c = p.confidence
  const confidenceInRange = typeof c === 'number' && Number.isFinite(c) && c > 0 && c <= 1

  const suggestion: TriageSuggestion = {
    priority: asPriority(raw),
    priorityAmbiguous: raw === 0,
    labels,
    droppedLabels,
    summary: str(p.summary),
    confidence: confidenceInRange ? c : null,
    confidenceAmbiguous: c === 0,
  }

  // ⚠ "NOTHING CAME BACK" IS A STATEMENT ABOUT THE ANSWER, NEVER ABOUT THE ISSUE — duplicates.ts's
  // rule for its own empty arm. A dropped label counts as something arriving: the response carried
  // an entry, and that it could not be drawn is itself worth saying.
  const nothing =
    suggestion.priority === null &&
    suggestion.labels.length === 0 &&
    suggestion.droppedLabels === 0 &&
    suggestion.summary.trim() === '' &&
    suggestion.confidence === null

  return nothing ? { kind: 'none', suggestion } : { kind: 'suggestion', suggestion }
}
