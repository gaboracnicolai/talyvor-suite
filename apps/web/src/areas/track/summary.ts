import type { IssueSummaryView } from './types'

/**
 * What Track's issue-summary route actually said — as one of FOUR named states.
 *
 * ⚠ THE ROUTE ANSWERS THREE DIFFERENT BODIES AND DISCRIMINATES BY FIELD, NOT BY STATUS. All three
 * are HTTP 200 (talyvor-track `internal/ai/handler.go` Summary):
 *
 *     {"summary":…,"key_points":[…],"next_action":…,"sentiment":…}   the summary
 *     {"ai_available":false,"reason":…}                              AI is not configured
 *     {"summary_available":false,"min_comments":10}                  the thread is too short
 *
 * so `res.ok` says nothing about which one arrived, and a screen that read `.summary` off the
 * payload would render an empty summary card for both refusals.
 *
 * ⚠ THE FOURTH STATE IS THE ONE THE WIRE DOES NOT HAVE, AND IT IS WHY THIS IS A FUNCTION RATHER
 * THAN THREE `in` CHECKS AT THE CALL SITE. Anything that matches none of the three is
 * `unrecognised` — NOT a summary. A body whose `summary` field is renamed upstream would otherwise
 * arrive as a blank but perfectly calm summary panel, which is the failure this app has already
 * shipped twice under other names (an empty list drawn over a failed read).
 *
 * ⚠ THE REFUSALS ARE TESTED FIRST, DELIBERATELY. `ai_available === false` and
 * `summary_available === false` are checked before `summary`, so a body carrying a refusal AND a
 * stale summary field is reported as the refusal. The order is asserted in summary.test.ts; it is
 * not an accident of how the ifs happened to be typed.
 *
 * ⚠ AND THE COMPARISON IS `=== false`, NOT `'ai_available' in payload`. Track sends
 * `ai_available: true` alongside real content elsewhere in its API (the MCP surface does), so
 * presence-testing the key would classify a healthy answer as a refusal the day this route grows
 * the field.
 */
export function readSummary(payload: unknown): IssueSummaryView {
  if (typeof payload !== 'object' || payload === null) return { kind: 'unrecognised' }
  const p = payload as Record<string, unknown>

  if (p.ai_available === false) {
    return { kind: 'ai-unavailable', reason: typeof p.reason === 'string' ? p.reason : '' }
  }
  if (p.summary_available === false) {
    // ⚠ THE THRESHOLD IS READ, NEVER ASSUMED. Track's `summaryMinComments` is 10 today; writing a
    // 10 here would be this app restating an upstream constant it cannot check, and the screen
    // would keep saying "ten" the day Track says eight. Absent ⇒ null ⇒ the screen names no number.
    return {
      kind: 'too-short',
      minComments: typeof p.min_comments === 'number' ? p.min_comments : null,
    }
  }
  if (typeof p.summary === 'string' && p.summary.trim() !== '') {
    return {
      kind: 'summary',
      summary: p.summary,
      // Every field but `summary` is optional on the way in: Track builds these from the model's
      // JSON reply, and a model that omits one must not blank the whole panel.
      keyPoints: Array.isArray(p.key_points) ? p.key_points.filter((k): k is string => typeof k === 'string') : [],
      nextAction: typeof p.next_action === 'string' ? p.next_action : '',
      sentiment: typeof p.sentiment === 'string' ? p.sentiment : '',
    }
  }
  return { kind: 'unrecognised' }
}
