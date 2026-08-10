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
