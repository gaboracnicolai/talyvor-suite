import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from './App'

// writeUnderDeadCredential.test.tsx — WHAT A BUTTON SAYS WHEN THE CREDENTIAL IS DEAD.
//
// SessionExpired.test.tsx already sweeps this state, and it is structurally blind to the half
// measured here: every one of its cases is an ADDRESS with PANELS that read. Nothing in it
// presses a button, and a mutation's error never enters the query cache, so the mechanism that
// makes the reads honest cannot reach the writes at all. Twelve `useMutation` call sites ship
// in this app and one of them — Documents.tsx — states the rule:
//
//     "You can try again" is true of a blip and false of a dead credential, and under the bar
//     it is a third voice giving a remedy that contradicts the one already on screen. The
//     OUTCOME still has to be stated either way — the reader pressed a button and needs to
//     know it did not take — so ONLY THE ADVICE MOVES.
//
// MEASURED before this file existed, real `<App/>`, real shipped queryClient, /auth/me
// authenticated and every /api/* answering 401 — the live condition, since the BFF session
// outlives the workspace token by four hours (tenant.go: 8h token, 12h session):
//
//   /keys   press "Create key"     bar visible   panel: "Couldn't mint the key. Please try again."
//   /track  press "Create issue"   bar visible   panel: "Couldn't create that issue — nope"
//
// The first is the contradiction the rule names. The SECOND is worse and is not a missing
// branch: IssueList classifies a refusal as retryable on `status >= 500`, so a 401 lands in the
// "the same request will be refused forever, not as sent" bucket and the screen prints the
// upstream's raw error string as advice about the request. Nothing about that request was
// wrong. And `CreateRefusal` did not extend `ApiError`, so `isSessionExpired` — the shared
// predicate one import away — could not see it, which is exactly the defect #136 fixed for a
// READ (`readDistill` threw a bare Error) arriving on the write path.
//
// THE THREE STATES STAY THREE, and that is asserted in both directions here: a 500 keeps its
// remedy, and a 400 carrying an upstream sentence still shows that sentence verbatim — the
// behaviour IssueList's CreateRefusal was written for.

const AUTHENTICATED = {
  mode: 'oidc',
  authenticated: true,
  user: { sub: 'sub-1', email: 'tester@example.com' },
  workspace_id: 'uabcdefghijklmnopqrstuvwxy',
  cache_poolable: false,
  needs_pooling_choice: false,
  signup_open: true,
}

/** Every /api/* answers `status` with `body`; /auth/me stays authenticated (the live condition). */
function mockAllApi(status: number, body: unknown = { error: 'upstream said this' }) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url === '/auth/me') {
      return new Response(JSON.stringify(AUTHENTICATED), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

function at(path: string) {
  window.history.pushState({}, '', path)
  return render(<App />)
}

/** The remedies a surface must not offer while the bar is offering a different one. */
const REMEDY = /try again/i

/** Drive one write surface to its failure sentence and hand back what the whole screen says. */
const SURFACES = [
  {
    name: 'keys — mint a key',
    path: '/keys',
    outcome: /Couldn’t mint the key/,
    drive: async () => {
      const input = await screen.findByLabelText('New key name')
      fireEvent.change(input, { target: { value: 'my key' } })
      fireEvent.click(screen.getByRole('button', { name: 'Create key' }))
    },
  },
  {
    name: 'track — create an issue',
    path: '/track',
    outcome: /Couldn’t create that issue/,
    drive: async () => {
      const input = await screen.findByLabelText('Title')
      fireEvent.change(input, { target: { value: 'an issue' } })
      fireEvent.click(screen.getByRole('button', { name: 'Create issue' }))
    },
  },
] as const

beforeEach(() => {
  queryClient.clear()
  window.history.pushState({}, '', '/')
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('a write refused by a dead credential states the outcome and leaves the remedy to the bar', () => {
  for (const s of SURFACES) {
    it(`${s.name}: says what did not happen, and does not offer a second remedy`, async () => {
      mockAllApi(401)
      at(s.path)
      await s.drive()
      await waitFor(() => expect(screen.getByText(s.outcome)).toBeInTheDocument())

      // The bar is the one voice that carries the remedy, and it IS on screen — which is what
      // makes a second one a contradiction rather than merely redundant.
      expect(screen.getByText(/Signing in again fixes it/)).toBeInTheDocument()

      const sentence = screen.getByText(s.outcome).textContent ?? ''
      expect(sentence, `the surface offers its own remedy: ${sentence}`).not.toMatch(REMEDY)
    })

    it(`${s.name}: does not repeat the upstream's error string as advice about the request`, async () => {
      // A 401 is not "not as sent" — nothing about the request was wrong, so the server's
      // sentence is not a description of it. This is the half that was measured printing
      // `nope` (the fake body's error) straight onto the screen.
      mockAllApi(401, { error: 'the upstream sentence' })
      at(s.path)
      await s.drive()
      await waitFor(() => expect(screen.getByText(s.outcome)).toBeInTheDocument())
      expect(screen.getByText(s.outcome).textContent ?? '').not.toContain('the upstream sentence')
    })

    it(`${s.name}: MUST STAY GREEN — a 500 keeps its remedy and raises no bar`, async () => {
      mockAllApi(500)
      at(s.path)
      await s.drive()
      await waitFor(() => expect(screen.getByText(s.outcome)).toBeInTheDocument())
      expect(screen.getByText(s.outcome).textContent ?? '').toMatch(REMEDY)
      expect(screen.queryByText(/Signing in again fixes it/)).toBeNull()
    })
  }

  it('MUST STAY GREEN — a 400 still shows the upstream sentence verbatim', async () => {
    // The behaviour CreateRefusal exists for: Track answered "issue: WorkspaceID, TeamID, Title,
    // and CreatorID are required" on every create in a workspace with no team, and the screen
    // discarded it. A 400 IS the server saying "not as sent", so its sentence is about the
    // request and must survive.
    mockAllApi(400, { error: 'issue: TeamID is required', code: 'CREATE_FAILED' })
    at('/track')
    const input = await screen.findByLabelText('Title')
    fireEvent.change(input, { target: { value: 'an issue' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create issue' }))
    await waitFor(() =>
      expect(screen.getByText(/Couldn’t create that issue/).textContent ?? '').toContain(
        'issue: TeamID is required',
      ),
    )
    expect(screen.queryByText(/Signing in again fixes it/)).toBeNull()
  })

  it('MUST STAY GREEN — a 403 at the mint still names the origin refusal', async () => {
    // The one diagnosis /keys makes for itself: requireSameOrigin refuses a POST whose Origin is
    // not the configured public origin, which is a CSRF refusal and not a session problem. It
    // used to be detected by `error.message.includes('403')` — a substring match on ApiError's
    // message format, four lines from a sibling mutation reading `.status` off the same type.
    mockAllApi(403)
    at('/keys')
    const input = await screen.findByLabelText('New key name')
    fireEvent.change(input, { target: { value: 'my key' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create key' }))
    await waitFor(() =>
      expect(screen.getByText(/request origin was rejected/)).toBeInTheDocument(),
    )
  })
})

// ── THE CONDITION THE FIXTURE ABOVE CANNOT PRODUCE, AND THE SURFACES IT CANNOT REACH ─────────
//
// `mockAllApi` answers EVERY /api/* with the same status, so a 401 case refuses the READS too.
// That is a real state — but it is not the one this file's own header describes. The header says
// the workspace token dies four hours before the BFF session (tenant.go: 8h token, 12h session),
// and a token that dies mid-session leaves the reads ALREADY SATISFIED in the query cache. The
// screen the reader is looking at is fully populated. Then they press a button.
//
// TWO THINGS FOLLOW, BOTH MEASURED AT `d7652cf` WITH ALL 1134 TESTS GREEN:
//
// 1. ⚠ THE SURFACES TABLE CANNOT REACH A WRITE THAT ONLY EXISTS AFTER A SUCCESSFUL READ.
//    `/keys` and `/track` render their forms whether or not the list read succeeded, which is why
//    those two are drivable under an all-401 fixture. IssueDetail's "Save description" and
//    "Comment" buttons are inside `if (!it) return …`, so under all-401 the screen renders "That
//    issue could not be read." and there is no button to press. The two write surfaces on that
//    screen were therefore not merely absent from the table — they were UNREACHABLE BY ITS
//    FIXTURE SHAPE, which is why adding a row would not have found them.
//
// 2. ⚠ AND THE PREMISE THE RULE RESTS ON IS FALSE HERE. The rule is "only the advice moves,
//    because the bar already carries the remedy" — and the block above ASSERTS the bar is on
//    screen. It is, in that fixture, because the READS 401'd and a read error is what
//    `useSessionExpired` derives from. When only the WRITE is refused, nothing puts an error in
//    the query cache (a mutation's error never enters it, and these two write paths are not even
//    mutations), so THE BAR IS ABSENT — measured absent for /keys, for the description save and
//    for the comment post. That is pinned below rather than asserted as correct: it is a gap in
//    the mechanism, not a property to preserve, and it is recorded so the day the bar learns to
//    see a refused write, this pin reds and gets re-argued instead of quietly kept.
//
// WHAT THAT LEFT ON SCREEN, MEASURED: the description save and the comment post rendered
// "…You can try again." for a 401 — BYTE-IDENTICAL to their 500 — because both write paths
// `throw new Error(String(res.status))` and then `catch {}` DISCARD the error, so the sentence is
// chosen with no error in hand at all. `isSessionExpired` is imported in that very file and used
// 200 lines below for the comments READ. `errorTypes.test.ts` could not see it either: its rule
// matches class DECLARATIONS, and states the exclusion is safe because "a `new Error()` with
// fields bolted on … is not what any of the five instances looked like" — these two are exactly
// that shape, a bare Error carrying the status, on a write path in the same area as three of the
// five.

/** Reads succeed and every WRITE is refused — the token that died four hours into the session. */
function mockReadsOkWritesRefused(writeStatus: number, body: unknown = { error: 'upstream said this' }) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = String(input)
    const method = init?.method ?? 'GET'
    const json = (b: unknown, status = 200) =>
      new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
    if (path === '/auth/me') return json(AUTHENTICATED)
    if (method !== 'GET') return json(body, writeStatus)
    if (path === '/api/members') return json([{ id: 'u-1', name: 'Ada' }])
    if (path === '/api/track/teams') return json([{ id: 'team-1', identifier: 'ENG', name: 'Engineering' }])
    if (path.endsWith('/comments')) return json([])
    if (path.startsWith('/api/track/issues/iss-1')) return json(DETAIL_ISSUE)
    return json(null, 404)
  })
}

const DETAIL_ISSUE = {
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

/** The two write surfaces that live behind a successful read. */
const DETAIL_SURFACES = [
  {
    name: 'track detail — save a description',
    outcome: /That did not save/,
    drive: async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Edit description' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Save description' }))
    },
  },
  {
    name: 'track detail — post a comment',
    outcome: /did not post/,
    drive: async () => {
      const input = await screen.findByLabelText('Add a comment')
      fireEvent.change(input, { target: { value: 'a reply' } })
      fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
    },
  },
] as const

async function driveDetail(s: (typeof DETAIL_SURFACES)[number], status: number, body?: unknown) {
  mockReadsOkWritesRefused(status, body)
  at('/track/issues/iss-1')
  await s.drive()
  await waitFor(() => expect(screen.getByText(s.outcome)).toBeInTheDocument())
  return screen.getByText(s.outcome).textContent ?? ''
}

describe('a write refused MID-SESSION, with the reads already satisfied', () => {
  for (const s of DETAIL_SURFACES) {
    it(`${s.name}: a 401 does not offer a remedy that is false`, async () => {
      const sentence = await driveDetail(s, 401)
      expect(sentence, `the surface offers its own remedy: ${sentence}`).not.toMatch(REMEDY)
    })

    // ⚠ THE ASSERTION THAT CANNOT BE SATISFIED BY DELETING WORDS. Dropping "try again" from both
    // arms would pass the test above and leave the screen just as unable to tell the two apart.
    // The three states stay three only if the sentences DIFFER, so this compares them.
    it(`${s.name}: a dead credential and a server fault do not read identically`, async () => {
      const refused = await driveDetail(s, 401)
      cleanup()
      vi.restoreAllMocks()
      const faulted = await driveDetail(s, 500)
      expect(refused, `401 and 500 render the same sentence: ${refused}`).not.toBe(faulted)
    })

    it(`${s.name}: MUST STAY GREEN — a 500 still says the outcome and keeps its remedy`, async () => {
      const sentence = await driveDetail(s, 500)
      expect(sentence).toMatch(REMEDY)
    })
  }

  // ⚠ PINNED, NOT ENDORSED — see the block comment above. A write refused for want of a credential
  // raises NO bar, on any of the three surfaces this file drives, because nothing puts the refusal
  // where `useSessionExpired` looks. The block at the top of this file asserts the bar IS present;
  // it is right about its own fixture and that fixture 401s the reads. Recorded here so the two
  // statements cannot be read as one, and so closing the gap reds this pin.
  it('PINNED — no bar is raised when only the WRITE is refused', async () => {
    for (const s of DETAIL_SURFACES) {
      await driveDetail(s, 401)
      expect(screen.queryByText(/Signing in again fixes it/)).toBeNull()
      cleanup()
      vi.restoreAllMocks()
    }
    mockReadsOkWritesRefused(401)
    at('/keys')
    const input = await screen.findByLabelText('New key name')
    fireEvent.change(input, { target: { value: 'my key' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create key' }))
    await waitFor(() => expect(screen.getByText(/Couldn’t mint the key/)).toBeInTheDocument())
    expect(screen.queryByText(/Signing in again fixes it/)).toBeNull()
  })
})
