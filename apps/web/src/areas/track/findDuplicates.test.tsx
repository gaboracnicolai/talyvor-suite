import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { FindDuplicates } from './FindDuplicates'

// ⚠ EVERY BODY IN THIS FILE WAS OBSERVED COMING OUT OF talyvor-track, not invented. tab-9f27 drove
// its own `ai.Handler.FindDuplicates` at `6b31a75` over a REAL Postgres (throwaway pgvector:pg16,
// track's 27 migrations) and a recording fake Lens, in a /tmp `git archive` export. The eight rows
// are listed in apps/bff/track_duplicates_test.go.

function draw(issueId = 'iss-subject') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <FindDuplicates issueId={issueId} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function answerWith(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
}

beforeEach(() => {
  vi.unstubAllGlobals()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('FindDuplicates — nothing is asked until someone asks', () => {
  it('does not call Track on mount — the call costs, and mounting is not a question', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    draw()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Look for duplicates' })).toBeTruthy())
    expect(f).not.toHaveBeenCalled()
  })

  it('POSTs to the route with no body and no query', async () => {
    const f = vi.fn((_path: string, _init?: RequestInit) => Promise.resolve(new Response('[]', { status: 200 })))
    vi.stubGlobal('fetch', f)
    draw('iss 9')
    fireEvent.click(screen.getByRole('button', { name: 'Look for duplicates' }))
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1))
    const [path, init] = f.mock.calls[0]
    // The id is percent-encoded: an id with a slash or a space would otherwise reshape the path.
    expect(path).toBe('/api/track/issues/iss%209/find-duplicates')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBeUndefined()
  })
})

describe('FindDuplicates — what each of Track’s two shapes draws', () => {
  it('draws the candidates, with the score attributed to the model', async () => {
    answerWith(200, [
      { issue_id: 'iss-2', identifier: 'ENG-2', title: 'login hangs forever', similarity: 0.93 },
    ])
    draw()
    fireEvent.click(screen.getByRole('button', { name: 'Look for duplicates' }))

    const link = await screen.findByRole('link', { name: 'login hangs forever' })
    expect(link.getAttribute('href')).toBe('/track/issues/iss-2')
    expect(screen.getByText('ENG-2')).toBeTruthy()
    expect(screen.getByText('93%')).toBeTruthy()
    // ⚠ THE NUMBER IS THE MODEL'S CLAIM, NOT A MEASUREMENT, and the screen says so beside it.
    expect(screen.getByText(/model’s own claim/)).toBeTruthy()
  })

  // ⚠⚠ THE HEADLINE. `200 []` is at least FOUR situations upstream and the response says which one
  // never — so no sentence on this card may claim the issue has no duplicate.
  it('an empty answer is described as an answer, never as a fact about the issue', async () => {
    answerWith(200, [])
    draw()
    fireEvent.click(screen.getByRole('button', { name: 'Look for duplicates' }))

    expect(await screen.findByText('Track named no duplicate.')).toBeTruthy()
    // The window is Track's rule and is stated: candidates are this TEAM's recent issues.
    expect(screen.getByText(/not a check of the whole workspace/)).toBeTruthy()
    for (const forbidden of [/has no duplicate/i, /there are no duplicates/i, /this issue is unique/i]) {
      expect(screen.queryByText(forbidden)).toBeNull()
    }
  })

  // The `ai_available` consumption W1.7 asked for, on a second surface — and Track's reason is
  // printed verbatim because it names the variable an operator must set.
  it('says AI is off, in Track’s own words', async () => {
    const reason =
      'AI is not configured: set TRACK_LENS_MINT_KEY to the value of Lens’s LENS_MINT_KEY.'
    answerWith(200, { ai_available: false, reason })
    draw()
    fireEvent.click(screen.getByRole('button', { name: 'Look for duplicates' }))

    expect(await screen.findByText('Track’s AI is not configured on this deployment.')).toBeTruthy()
    expect(screen.getByText(reason)).toBeTruthy()
    expect(screen.queryByText('Track named no duplicate.')).toBeNull()
  })

  it('an unreadable shape is a fault, not an empty list', async () => {
    answerWith(200, { error: 'issue not found', code: 'NOT_FOUND' })
    draw()
    fireEvent.click(screen.getByRole('button', { name: 'Look for duplicates' }))

    expect(await screen.findByText(/does not recognise/)).toBeTruthy()
    expect(screen.queryByText('Track named no duplicate.')).toBeNull()
  })

  // ⚠ ONE CHAIN, FAILURE FIRST. "No duplicates" must never be what a failed ask looks like.
  it('a 500 says fault, and claims nothing about the money', async () => {
    answerWith(500, { error: 'boom' })
    draw()
    fireEvent.click(screen.getByRole('button', { name: 'Look for duplicates' }))

    expect(await screen.findByText(/This is a fault, not an empty result/)).toBeTruthy()
    expect(screen.queryByText('Track named no duplicate.')).toBeNull()
    // A 502 may arrive after the completion already ran, so no sentence here may promise a refund
    // or a free failure.
    expect(screen.queryByText(/nothing was charged/i)).toBeNull()
  })

  it('a 503 from the BFF says Track is not configured here', async () => {
    answerWith(503, { error: 'track upstream not configured on this BFF' })
    draw()
    fireEvent.click(screen.getByRole('button', { name: 'Look for duplicates' }))

    expect(await screen.findByText(/not configured on this deployment/)).toBeTruthy()
  })
})

// ⚠⚠ THE UPSTREAM DEFECT THIS CARD REFUSES TO DRAW — MEASURED, NOT SUSPECTED. talyvor-track lists
// the candidate window by workspace + team with NO exclusion of the issue being asked about, so its
// prompt carried that issue under "Existing issues"; echoing the id back produced a row saying the
// issue duplicates ITSELF at similarity 1.
describe('FindDuplicates — the issue named as its own duplicate', () => {
  it('does not draw the subject as its own duplicate, and says the answer named it', async () => {
    answerWith(200, [
      { issue_id: 'iss-subject', identifier: 'ENG-1', title: 'the login page hangs', similarity: 1 },
      { issue_id: 'iss-2', identifier: 'ENG-2', title: 'login hangs forever', similarity: 0.9 },
    ])
    draw('iss-subject')
    fireEvent.click(screen.getByRole('button', { name: 'Look for duplicates' }))

    expect(await screen.findByRole('link', { name: 'login hangs forever' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'the login page hangs' })).toBeNull()
    expect(screen.queryByText('100%')).toBeNull()
    // Reported rather than swallowed — a list that quietly shortens is the lie `dropped` exists to
    // prevent, and this row was well-formed, so it is not a dropped row either.
    expect(screen.getByText(/also named this issue itself/)).toBeTruthy()
    expect(screen.queryByText(/could not be drawn/)).toBeNull()
  })

  it('an answer that is only the subject reads as no duplicate, and still reports it', async () => {
    answerWith(200, [
      { issue_id: 'iss-subject', identifier: 'ENG-1', title: 'the login page hangs', similarity: 1 },
    ])
    draw('iss-subject')
    fireEvent.click(screen.getByRole('button', { name: 'Look for duplicates' }))

    expect(await screen.findByText('Track named no duplicate.')).toBeTruthy()
    expect(screen.getByText(/also named this issue itself/)).toBeTruthy()
  })
})

// ⚠ THE ANSWER BELONGS TO THE ISSUE IT WAS ASKED ABOUT. React Router matches /track/issues/:id to
// ONE element, so arriving at another issue changes this prop WITHOUT remounting the component —
// the trap IssueDetail's four useStates and AISummary's reset both exist for. Here the issue id is
// the mutation's variable, so an answer whose variable is not the issue on screen is not drawn.
describe('FindDuplicates — an answer never outlives its issue', () => {
  it('drops issue A’s duplicates when the route moves to issue B', async () => {
    answerWith(200, [
      { issue_id: 'iss-2', identifier: 'ENG-2', title: 'login hangs forever', similarity: 0.93 },
    ])
    const view = draw('iss-a')
    fireEvent.click(screen.getByRole('button', { name: 'Look for duplicates' }))
    expect(await screen.findByRole('link', { name: 'login hangs forever' })).toBeTruthy()

    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <FindDuplicates issueId="iss-b" />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'login hangs forever' })).toBeNull(),
    )
    // Back to the unasked state — the button is offered again, for the issue now on screen.
    expect(screen.getByRole('button', { name: 'Look for duplicates' })).toBeTruthy()
  })
})
