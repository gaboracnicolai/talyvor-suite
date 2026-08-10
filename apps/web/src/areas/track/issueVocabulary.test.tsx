import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IssueDetail } from './IssueDetail'

/**
 * THE VOCABULARY A USER READS, ASSERTED ON THE SCREEN THAT DRAWS IT.
 *
 * ⚠ MEASURED 2026-08-10 at `1b7acf3`, whole suite green (1033 apps/web + 350 packages/ui): the
 * Issue detail screen showed the SAME FIELD IN TWO VOCABULARIES AT THE SAME MOMENT. `StatusPill`
 * rendered "In progress" through the exported, documented, unit-tested `statusLabel`; the editing
 * control BESIDE IT rendered `in_progress`, because its options mapped the raw enum (`{s}`). The
 * two are adjacent in the DOM — a probe reading the detail body back got the string
 * "StatusDonedone": the caption, the pill and the control, in that order.
 *
 * ⚠ AND THE PRIORITY HALF WAS THE MIRROR IMAGE. `format.ts` exported, documented and unit-tested
 * `priorityLabel` against model.IssuePriority — with ZERO production call sites — while
 * IssueDetail hand-rolled a second five-entry `PRIORITIES` list for the control that ships.
 * The two agreed on every value, which is exactly why nothing was going to notice when they
 * stopped: measured, renaming the SHIPPED label (`{ value: 1, label: 'Urgent' }` -> 'Critical')
 * left ALL 1383 tests GREEN, while renaming the same label in the DEAD map redded
 * `format.test.ts > priorityLabel maps 0–4`. The vocabulary that was pinned was the one that
 * shipped nowhere, and the one on screen was pinned by nothing.
 *
 * ⚠ WHY THE TRIGGER IS THE INSTRUMENT AND NOT THE OPEN MENU. Radix renders the SELECTED item's
 * own children into the closed trigger, so `getByLabelText('Status').textContent` IS that
 * option's label — reading it per value walks the option list one entry at a time without
 * opening anything. Measured, both alternatives are unavailable here: the menu does not open
 * under jsdom's pointer events (`fireEvent.pointerDown` leaves `aria-expanded="false"` and zero
 * `role="option"` nodes), and this Select is not inside a `<form>`, so Radix mounts no hidden
 * native `<select>` either — a probe found zero `<option>` elements in the container at every
 * value. What is NOT covered, said plainly: an option whose value is never rendered as the
 * SELECTED one would not be read by this file. Every value in both enums is covered below, so
 * that set is empty today; adding an enum member without adding a case here leaves it empty.
 *
 * ⚠ THE LABELS ARE HARDCODED LITERALS AND ARE NEVER READ BACK FROM `./format`. Importing
 * `statusLabel`/`priorityLabel` to build the expectation would compare each module to itself and
 * pass for every value either could take — the shape that made the dead map's unit test look
 * like coverage of a screen it never touched.
 *
 * ⚠ THE CONTROLS, WITH THE CATCHER PREDICTED BEFORE EACH RUN. Every assertion set below is
 * justified by a mutation that ONLY it catches; a set whose only controls are also caught by an
 * older guard is justified by neither, so those are marked as such rather than counted.
 *
 *   C1  shipped priority label renamed, BEFORE this file existed  -> all 1383 GREEN. The hole.
 *   C4' status option renders the raw enum again (the defect)     -> ONLY here, 12 failures
 *   C7  raw enum printed in the caption, every LABEL still right  -> ONLY the 6 raw-enum cases;
 *                                                                    the 6 label cases stay green
 *   C5' priority option label drifts from the module              -> ONLY here, 5 failures
 *   C6  PRIORITY_VALUES loses two values                          -> ONLY here, priority 3 and 4
 *                                                                    (a BLANK trigger — this is
 *                                                                    what covers the option LIST,
 *                                                                    not just the label function)
 *   C8  trigger routed through priorityLabel's `?? 'None'`        -> ONLY the out-of-range case,
 *                                                                    `expected 'None' to be ''`
 *   C2  PRIORITY_LABELS[1] renamed   -> here AND format.test.ts. TWO catchers: justifies NEITHER.
 *   C3  STATUS_LABELS renamed        -> here AND format.test.ts AND IssueList's refusal test.
 *                                       ⚠ I PREDICTED TWO AND THERE WERE THREE — the prediction
 *                                       was wrong, in the direction of under-listing.
 *
 * ⚠ TWO CONTROLS SCORED VOID BEFORE THEY SCORED ANYTHING, AND THE REASON IS WORTH THE LINE.
 * C4/C5 first replaced `{statusLabel(s)}` with `{s}` — which removes the LAST use of the import,
 * so `noUnusedLocals` failed the typecheck and the run reds without a single assertion being
 * evaluated. A compile error is not a caught mutation. Both were re-cut as
 * `{statusLabel(s) && s}` so the import stays live, tsc stays clean, and the red is an assertion.
 */

const BASE = {
  id: 'iss-1',
  workspace_id: 'ws1',
  team_id: 'team-1',
  number: 7,
  identifier: 'ENG-7',
  title: 'Cache stampede on cold start',
  description: 'D',
  status: 'in_progress',
  priority: 3,
  creator_id: 'u-1',
  lens_feature: '',
  ai_cost_usd: 0.4213,
  ai_tokens: 18342,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function mockBff(over: { status?: string; priority?: number }) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = String(input)
    const json = (b: unknown) =>
      new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (path === '/api/members') return json([{ id: 'u-1', name: 'Ada' }])
    if (path === '/api/track/teams') return json([{ id: 'team-1', identifier: 'ENG', name: 'Engineering' }])
    if (path.endsWith('/comments')) return json([])
    if (path === '/api/track/issues/iss-1') return json({ ...BASE, ...over })
    return json(null)
  })
}

async function openDetail(over: { status?: string; priority?: number }) {
  mockBff(over)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/track/issues/iss-1']}>
        <Routes>
          <Route path="/track/issues/:id" element={<IssueDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  // The row is what proves the screen actually rendered: an absence assertion on a screen that
  // never rendered is green for the wrong reason.
  await waitFor(() => expect(screen.getByText('ENG-7')).toBeTruthy())
}

afterEach(() => vi.restoreAllMocks())

/** model.IssueStatus (internal/model/model.go) -> the words a human reads. Literals, on purpose. */
const STATUS_WORDS: [string, string][] = [
  ['backlog', 'Backlog'],
  ['todo', 'Todo'],
  ['in_progress', 'In progress'],
  ['in_review', 'In review'],
  ['done', 'Done'],
  ['cancelled', 'Cancelled'],
]

/** model.IssuePriority (upstream `internal/model/model.go`, `type IssuePriority`) -> the words a human reads. */
const PRIORITY_WORDS: [number, string][] = [
  [0, 'None'],
  [1, 'Urgent'],
  [2, 'High'],
  [3, 'Medium'],
  [4, 'Low'],
]

describe('the Issue detail screen speaks one vocabulary per field', () => {
  it.each(STATUS_WORDS)('status %s reads "%s" in the control, not the enum', async (value, words) => {
    await openDetail({ status: value })
    const trigger = screen.getByLabelText('Status')
    expect(trigger.textContent, `the Status control for ${value}`).toBe(words)
  })

  it.each(STATUS_WORDS)('status %s never puts the raw enum on screen', async (value) => {
    await openDetail({ status: value })
    // The pill and the control sit in the same row; the enum must not survive in EITHER, which a
    // trigger-only assertion cannot say. Underscored values are the ones that read as machine
    // output, but `backlog`/`done` are checked the same way so no case is exempt.
    expect(document.body.textContent, `raw enum ${value} on screen`).not.toContain(value)
  })

  it.each(PRIORITY_WORDS)('priority %i reads "%s" in the control', async (value, words) => {
    await openDetail({ priority: value })
    const trigger = screen.getByLabelText('Priority')
    expect(trigger.textContent, `the Priority control for ${value}`).toBe(words)
  })

  /**
   * ⚠ A PROPERTY RECORDED, NOT ENDORSED — AND IT IS REACHABLE FROM UPSTREAM. talyvor-track's
   * `Update` handler allowlists the KEYS of its `map[string]any` body (`updatableFields`,
   * internal/issue/store.go) and validates no VALUE, so `PATCH {"priority": 99}` stores 99 in an
   * int column. This screen then draws an EMPTY priority control — no item matches, so Radix has
   * no children to lift into the trigger.
   *
   * Blank is pinned rather than "fixed" because the honest repair is upstream refusal, and the
   * near alternative is worse: `priorityLabel` ends `?? 'None'`, so routing the trigger through
   * it would answer an out-of-range priority with "None" — a claim that the issue is
   * unprioritised, which is the same defaulting shape as the tier dot that drew "cheap" for
   * every model outside a two-entry map. A blank control says "I do not know"; "None" lies.
   */
  it('an out-of-range priority draws a blank control rather than claiming "None"', async () => {
    await openDetail({ priority: 99 })
    expect(screen.getByLabelText('Priority').textContent).toBe('')
    expect(document.body.textContent).not.toContain('None')
  })
})
