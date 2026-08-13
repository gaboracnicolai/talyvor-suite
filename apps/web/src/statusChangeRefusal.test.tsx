import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from './App'

// statusChangeRefusal.test.tsx — THE WRITE THAT FAILED AND SAID NOTHING.
//
// Track's issue list carries a status `<select>` on every row. It is the fastest write in the
// product — one gesture, no form, no confirm — and it was the only write with NO error surface
// at all: `setStatus.isError` was read nowhere in the file. `setStatus` appeared exactly three
// times (the useMutation, `disabled={setStatus.isPending}`, and `.mutate(…)`), so a refusal had
// nowhere to land.
//
// MEASURED before this file existed, real `<App/>`, real shipped queryClient, a STATEFUL fake so
// an accepted write actually moves the stored row — reads served 200 and the write refused, which
// is the live condition (the BFF session outlives the workspace token by four hours: tenant.go
// 8h token, 12h session, and the reads on screen were fetched before it died):
//
//     write refused with   PATCH sent   select after   pill after   characters added to the page
//     ------------------   ----------   ------------   ----------   ---------------------------
//     401 dead credential  yes          in_progress    In progress   0
//     500 genuine fault    yes          in_progress    In progress   0
//     403 refused origin   yes          in_progress    In progress   0
//     200 accepted         yes          done           Done          (the row moved)
//
// ⚠ ZERO CHARACTERS, ON EVERY STATUS CODE. The reader picked "done", the control bounced back to
// the value Track still holds, and the product said nothing. The only signal a refusal happened
// is that the control they just set reverted — which reads as a UI glitch, not a refusal.
//
// ⚠ AND NO BAR CAN COVER FOR IT. SessionExpiredBar derives from the QUERY cache, the reads here
// are cached and good, and the shipped client sets `refetchOnWindowFocus: false` — so nothing
// refetches, no query error exists, and the bar is absent. Measured false in all three refusals.
//
// ⚠ IT IS NOT A SESSION FINDING. 500 and 403 are silent too, so this is strictly larger than the
// dead-credential family: it is a write that fails silently on every refusal.
//
// ⚠ THE SIBLING TWENTY LINES ABOVE HAS THE SENTENCE. `create.isError` renders a fully reasoned
// three-state message in this same file (#140 rewrote it an hour before this was measured), from
// the same `useMutation` API. Nobody carried it across to the mutation next to it.
//
// WHY THE FIXTURE IS STATEFUL: with a fake that serves the same row back, an accepted write and a
// refused one look identical on screen, and a positive control that cannot tell them apart proves
// nothing. Here 200 moves the row to "Done" and the refusals leave it at "In progress" — that
// difference is what makes the must-stay-greens below say anything.

const AUTHENTICATED = {
  mode: 'oidc',
  authenticated: true,
  user: { sub: 'sub-1', email: 'tester@example.com' },
  workspace_id: 'uabcdefghijklmnopqrstuvwxy',
  cache_poolable: false,
  needs_pooling_choice: false,
  signup_open: true,
}

const ISSUE = {
  id: 'iss-1',
  workspace_id: 'ws1',
  team_id: 'team-1',
  number: 7,
  identifier: 'ENG-7',
  title: 'Cache stampede on cold start',
  description: 'Original description.',
  status: 'in_progress',
  priority: 3,
  creator_id: 'u-1',
  lens_feature: '',
  ai_cost_usd: 0.4213,
  ai_tokens: 18342,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

/** null = the write is accepted and RECORDED; a number = every non-GET is refused with it. */
let refuseWrites: number | null = null
let stored = { ...ISSUE }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Reads always succeed — the cached-good state a write is refused from. */
function mockBff() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = String(input)
    const method = init?.method ?? 'GET'
    if (path === '/auth/me') return json(AUTHENTICATED)
    if (method !== 'GET' && refuseWrites !== null) {
      return json({ error: 'the upstream sentence' }, refuseWrites)
    }
    if (path.startsWith('/api/track/issues/iss-1') && method === 'PATCH') {
      Object.assign(stored, JSON.parse(String(init?.body ?? '{}')))
      return json(stored)
    }
    if (path.startsWith('/api/track/issues/iss-1')) return json(stored)
    if (path.startsWith('/api/track/issues')) return json([stored])
    if (path === '/api/track/teams') return json([{ id: 'team-1', identifier: 'ENG', name: 'Engineering' }])
    if (path === '/api/track/workspaces') return json([{ id: 'ws1', name: 'Acme' }])
    if (path === '/api/members') return json([{ id: 'u-1', name: 'Ada' }])
    return json(null, 404)
  })
}

/** Open the list and hand back the row's status control, with the reads already served. */
async function listWithOneIssue(): Promise<HTMLSelectElement> {
  window.history.pushState({}, '', '/track')
  render(<App />)
  return (await screen.findByLabelText('Status for ENG-7')) as HTMLSelectElement
}

/** The outcome sentence this screen owes a reader whose status change did not take. */
const OUTCOME = /Couldn’t change the status/
const REMEDY = /try again/i

/**
 * The PILL's words — the row's own answer about what Track holds — read structurally rather than
 * by text.
 *
 * ⚠ THIS USED TO BE `screen.getByText('In progress')`, AND IT WAS UNIQUE ONLY BECAUSE OF A DEFECT.
 * The pill said "In progress" and the `<option>` two nodes away said "in progress": one field,
 * two vocabularies, and a case difference is what made the query resolve. Once both controls
 * speak `statusLabel` (the repair #150 made on the detail screen and did not carry across), the
 * text matches TWICE and the query throws "Found multiple elements". The assertion was always
 * about the pill; it now says so instead of relying on the option being wrong.
 */
function pillWords(): string {
  // <td><div class="flex …"><Pill/><select/></div></td> — the Pill is the cell's first <span>,
  // and an <option> is never a <span>, so this cannot drift onto the control.
  const cell = screen.getByLabelText('Status for ENG-7').closest('td')
  return cell?.querySelector('span')?.textContent ?? ''
}

beforeEach(() => {
  refuseWrites = null
  stored = { ...ISSUE }
  queryClient.clear()
  window.history.pushState({}, '', '/')
  mockBff()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('a status change refused on the issue list says so', () => {
  it('401: states the outcome, and does not tell the reader to retry a request that cannot succeed', async () => {
    const select = await listWithOneIssue()
    refuseWrites = 401
    fireEvent.change(select, { target: { value: 'done' } })

    await waitFor(() => expect(screen.getByText(OUTCOME)).toBeInTheDocument())
    // "Try again" is true of a blip and false of a dead credential — the same distinction the
    // sibling `create` makes in this file. Nothing about this request was wrong.
    expect(screen.getByText(OUTCOME).textContent ?? '').not.toMatch(REMEDY)
  })

  it('401: does not repeat the upstream sentence as advice about the change', async () => {
    // The reader picked from a closed list of statuses this screen rendered. A server sentence
    // is not a description of a request they could have got wrong.
    const select = await listWithOneIssue()
    refuseWrites = 401
    fireEvent.change(select, { target: { value: 'done' } })

    await waitFor(() => expect(screen.getByText(OUTCOME)).toBeInTheDocument())
    expect(screen.getByText(OUTCOME).textContent ?? '').not.toContain('the upstream sentence')
  })

  it('500: states the outcome AND keeps the remedy, because a fault really can pass', async () => {
    const select = await listWithOneIssue()
    refuseWrites = 500
    fireEvent.change(select, { target: { value: 'done' } })

    await waitFor(() => expect(screen.getByText(OUTCOME)).toBeInTheDocument())
    expect(screen.getByText(OUTCOME).textContent ?? '').toMatch(REMEDY)
  })

  it('403: states the outcome — a refusal is never silent, whatever the code', async () => {
    const select = await listWithOneIssue()
    refuseWrites = 403
    fireEvent.change(select, { target: { value: 'done' } })

    await waitFor(() => expect(screen.getByText(OUTCOME)).toBeInTheDocument())
  })

  it('a refusal leaves the row showing the status Track still holds, not the one that was picked', async () => {
    // The control is bound to the fetched row, so it reverts. That revert is the ONLY thing that
    // happened before this change, and on its own it reads as a glitch — this pins the data half
    // so the sentence is added to a screen that is still telling the truth about the row.
    const select = await listWithOneIssue()
    refuseWrites = 401
    fireEvent.change(select, { target: { value: 'done' } })

    await waitFor(() => expect(screen.getByText(OUTCOME)).toBeInTheDocument())
    expect((screen.getByLabelText('Status for ENG-7') as HTMLSelectElement).value).toBe('in_progress')
    expect(pillWords()).toBe('In progress')
  })

  it('MUST STAY GREEN — an accepted change moves the row and adds no failure sentence', async () => {
    // The positive control, and the one that makes every absence assertion above mean something:
    // a surface that says nothing satisfies "no failure sentence" perfectly, so this asserts the
    // row ACTUALLY MOVED as well. Both halves, or neither is evidence.
    const select = await listWithOneIssue()
    fireEvent.change(select, { target: { value: 'done' } })

    await waitFor(() =>
      expect((screen.getByLabelText('Status for ENG-7') as HTMLSelectElement).value).toBe('done'),
    )
    expect(pillWords()).toBe('Done')
    expect(screen.queryByText(OUTCOME)).toBeNull()
  })

  it('MUST STAY GREEN — the list renders no failure sentence before anything is pressed', async () => {
    // A sentence rendered unconditionally would satisfy every "the outcome is stated" assertion
    // above while telling a reader their work failed when it never ran.
    await listWithOneIssue()
    expect(screen.queryByText(OUTCOME)).toBeNull()
  })
})
