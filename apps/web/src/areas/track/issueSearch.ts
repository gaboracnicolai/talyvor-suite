/**
 * What Track's issue-search route actually said — and, much more importantly, what it CANNOT say.
 *
 * ⚠⚠ THE RESPONSE IS A BARE ARRAY WITH NO ENVELOPE AND NO PER-ROW SOURCE TAG. MEASURED, not read:
 * at talyvor-track `b6fec98`, its own `ai.Handler.SemanticSearch` driven in a /tmp `git archive`
 * export over a recording full-text backend, with the engine unconfigured — no mint credential,
 * which is this deployment:
 *
 *     AI off,  backend matches       → 200 [ …one issue… ]   backend called once
 *     AI off,  backend matches none  → 200 []                backend called once
 *     AI off,  NO backend wired      → 200 []                nothing called
 *     AI on,   vector path fails     → 200 [ …one issue… ]   backend called once
 *
 * ROWS 1 AND 4 ARE BYTE-IDENTICAL. `SemanticSearch` drops to `issueSearch.Search` whenever Lens is
 * unavailable, the pool is nil, the embedding call fails, the vector query fails, or the embedding
 * JOIN returns nothing, and its own docstring states that as the design: "The fallback path is
 * invisible to callers — they always get a useful result." Nothing in the payload records which
 * path ran.
 *
 * ⚠ SO THERE IS NO `semantic: 'ran'` STATE HERE, AND ITS ABSENCE IS THE POINT. The Docs sibling
 * (areas/docs/search.ts) has one, because Docs tags each row `fulltext`/`semantic`/`both` and a
 * tagged row PROVES the half ran. Track ships no such tag, so the one-directional claim available
 * over there is not available here — there is no evidence to read, in either direction. A field
 * called `semantic` on this view would be a place for a future reader to put a guess.
 *
 * ⚠ AND AN EMPTY ARRAY IS AT LEAST FOUR FACTS, one of which is a dead deployment.
 * `fullTextFallback` returns `nil, nil` when no search backend is wired at all, and
 * `issue.Store.Search` returns `nil, nil` when its pool is nil — both arrive here as `[]`,
 * indistinguishable from a genuine no-match. The screen may therefore say "nothing matched" only
 * as a description of the RESPONSE, never as a claim about the workspace.
 *
 * ⚠ A ROW THAT CANNOT BE DRAWN IS COUNTED, NEVER SILENTLY DISCARDED — the same rule the Docs
 * search reader follows. An issue with no id has nowhere to link and an issue with no title is a
 * line with nothing written on it; both are dropped, and the count is said out loud, because a
 * quietly shorter list is a lie about how much matched.
 */

import { ISSUE_STATUSES, type IssuePriority, type IssueStatus } from './types'

/** One search hit, in the fields this app draws. */
export interface IssueSearchRow {
  id: string
  /** Track's human key, e.g. `ENG-42`. May be empty — it is drawn only when present. */
  identifier: string
  title: string
  /** Exactly one of Track's six, or null when the value is not one this app knows. A status it
   *  cannot classify is NOT coerced to a default: `StatusPill` would then draw a confident hue for
   *  a value nobody recognised, which is the tier-dot defect (#149) in another costume. */
  status: IssueStatus | null
  /** 0–4, or null when absent or out of range. Never defaulted to 0 ("None") — see priorityLabel's
   *  `?? 'None'`, which is exactly the shape that turns "I do not know" into a false answer. */
  priority: IssuePriority | null
}

export type IssueSearchView =
  | { kind: 'results'; rows: IssueSearchRow[]; dropped: number }
  | { kind: 'empty'; dropped: number }
  | { kind: 'unrecognised' }

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function asStatus(v: unknown): IssueStatus | null {
  return typeof v === 'string' && (ISSUE_STATUSES as readonly string[]).includes(v)
    ? (v as IssueStatus)
    : null
}

function asPriority(v: unknown): IssuePriority | null {
  return v === 0 || v === 1 || v === 2 || v === 3 || v === 4 ? (v as IssuePriority) : null
}

export function readIssueSearch(payload: unknown): IssueSearchView {
  // ⚠ NOT AN ARRAY IS `unrecognised`, NOT EMPTY. Track answers this route with a bare array; an
  // object is what its ERROR shape looks like (`{"error":…,"code":…}`) and what an `ai_available`
  // refusal would look like if this route ever grew one. Reading either as "no results" would
  // render a fault as a calm empty panel.
  if (!Array.isArray(payload)) return { kind: 'unrecognised' }

  const rows: IssueSearchRow[] = []
  let dropped = 0

  for (const raw of payload) {
    if (typeof raw !== 'object' || raw === null) {
      dropped++
      continue
    }
    const r = raw as Record<string, unknown>
    const id = str(r.id)
    const title = str(r.title)
    if (id === '' || title === '') {
      dropped++
      continue
    }
    rows.push({
      id,
      identifier: str(r.identifier),
      title,
      status: asStatus(r.status),
      priority: asPriority(r.priority),
    })
  }

  if (rows.length === 0) return { kind: 'empty', dropped }
  return { kind: 'results', rows, dropped }
}
