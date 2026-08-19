import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { TriageIssue } from './TriageIssue'

// ⚠ EVERY BODY IN THIS FILE WAS OBSERVED COMING OUT OF talyvor-track, not invented. tab-7f6b drove
// its own `ai.Engine.TriageIssue` and `ai.Handler.Triage` at `655a0a0` over a recording fake Lens in
// a /tmp `git archive` export (the repo is held by another tab and was never written to). The rows
// are listed in apps/bff/track_triage_test.go.

const suggestion = {
  suggested_priority: 2,
  suggested_labels: ['bug', 'performance'],
  suggested_assignee: '',
  summary: 'checkout times out under load',
  is_duplicate: false,
  confidence: 0.8,
}

function draw(issueId = 'iss-subject') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TriageIssue issueId={issueId} />
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

const ASK = 'Ask for a triage suggestion'

beforeEach(() => {
  vi.unstubAllGlobals()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TriageIssue — nothing is asked until someone asks', () => {
  it('does not call Track on mount — the call costs, and mounting is not a question', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    draw()
    await waitFor(() => expect(screen.getByRole('button', { name: ASK })).toBeTruthy())
    expect(f).not.toHaveBeenCalled()
  })

  // ⚠⚠ THE QUERY STRING IS THE SAFETY PROPERTY AND IT IS ASSERTED FROM THE CLIENT SIDE TOO.
  // `?apply=true` is what makes talyvor-track overwrite this issue's priority and labels with the
  // model's suggestion (and discard the write error). The BFF forwards no query at all
  // (apps/bff/track_triage_test.go), and this card sends none — two independent refusals, because
  // the day someone "helpfully" adds a parameter here, the BFF is what still refuses it.
  it('POSTs to the route with no body and no query — never ?apply', async () => {
    const f = vi.fn((_path: string, _init?: RequestInit) => Promise.resolve(new Response(JSON.stringify(suggestion), { status: 200 })))
    vi.stubGlobal('fetch', f)
    draw('iss 9')
    fireEvent.click(screen.getByRole('button', { name: ASK }))
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1))
    const [path, init] = f.mock.calls[0]
    // The id is percent-encoded: an id with a slash or a space would otherwise reshape the path.
    expect(path).toBe('/api/track/issues/iss%209/triage')
    expect(path).not.toContain('?')
    expect(path).not.toContain('apply')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBeUndefined()
  })

  // The suggestion is not applied and the card says so — the whole reason this feature could reach
  // a browser at all while the write half stays a product decision.
  it('says the suggestion has not been applied, before and after asking', async () => {
    answerWith(200, suggestion)
    draw()
    expect(screen.getByText(/nothing is changed on the issue/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: ASK }))
    await screen.findByText('checkout times out under load')
    expect(screen.getByText(/nothing is changed on the issue/i)).toBeTruthy()
  })
})

describe('TriageIssue — what each measured body draws', () => {
  it('draws the suggestion the model made, with the priority named', async () => {
    answerWith(200, suggestion)
    draw()
    fireEvent.click(screen.getByRole('button', { name: ASK }))

    expect(await screen.findByText('checkout times out under load')).toBeTruthy()
    expect(screen.getByText('High')).toBeTruthy()
    expect(screen.getByText('bug')).toBeTruthy()
    expect(screen.getByText('performance')).toBeTruthy()
    // ⚠ THE NUMBER IS THE MODEL'S OWN SELF-REPORT, and the screen attributes it rather than
    // printing a bare percentage that reads as a measurement.
    expect(screen.getByText(/80%/)).toBeTruthy()
    expect(screen.getByText(/model’s own/i)).toBeTruthy()
  })

  // ⚠⚠ THE FINDING, ON THE SCREEN. `suggested_priority: 0` is Track's "None" AND the value an
  // omitted field gets, byte-identical either way — so the card may not draw "None", which is a
  // suggestion the model may never have made. It says which two facts it cannot tell apart.
  it('never draws "None" for the zero priority — it says the answer cannot be read', async () => {
    answerWith(200, { ...suggestion, suggested_priority: 0 })
    draw()
    fireEvent.click(screen.getByRole('button', { name: ASK }))

    await screen.findByText('checkout times out under load')
    expect(screen.queryByText('None')).toBeNull()
    expect(screen.getByText(/said no priority|said nothing about priority/i)).toBeTruthy()
  })

  it('draws no priority, and no ambiguity note, for a value outside Track’s vocabulary', async () => {
    answerWith(200, { ...suggestion, suggested_priority: 9 })
    draw()
    fireEvent.click(screen.getByRole('button', { name: ASK }))

    await screen.findByText('checkout times out under load')
    expect(screen.queryByText('High')).toBeNull()
    expect(screen.queryByText('None')).toBeNull()
    expect(screen.getByText(/not one of Track’s/i)).toBeTruthy()
  })

  it('draws no confidence at all when the wire says 0', async () => {
    answerWith(200, { ...suggestion, confidence: 0 })
    draw()
    fireEvent.click(screen.getByRole('button', { name: ASK }))

    await screen.findByText('checkout times out under load')
    expect(screen.queryByText(/0%/)).toBeNull()
    expect(screen.getByText(/did not say how sure/i)).toBeTruthy()
  })

  // ⚠ THE FIELDS THE PROMPT NEVER ASKS FOR ARE NEVER DRAWN. `is_duplicate` and `suggested_assignee`
  // ride on every response with no omitempty; a card reporting "not a duplicate" from a field no
  // model was asked about would be inventing an answer.
  it('draws nothing about duplicates or an assignee, even when the payload carries them', async () => {
    answerWith(200, { ...suggestion, is_duplicate: true, duplicate_of: 'ENG-7', suggested_assignee: 'someone' })
    draw()
    fireEvent.click(screen.getByRole('button', { name: ASK }))

    await screen.findByText('checkout times out under load')
    expect(screen.queryByText(/duplicate/i)).toBeNull()
    expect(screen.queryByText(/someone/)).toBeNull()
    expect(screen.queryByText(/ENG-7/)).toBeNull()
  })

  it('says so when the model returned nothing at all', async () => {
    answerWith(200, {
      suggested_priority: 0,
      suggested_labels: null,
      suggested_assignee: '',
      summary: '',
      is_duplicate: false,
      confidence: 0,
    })
    draw()
    fireEvent.click(screen.getByRole('button', { name: ASK }))

    expect(await screen.findByText(/Track’s AI answered without suggesting anything/i)).toBeTruthy()
  })

  it('renders Track’s AI-off reason verbatim', async () => {
    const reason =
      'AI is not configured: set TRACK_LENS_MINT_KEY to the value of Lens’s LENS_MINT_KEY.'
    answerWith(200, { ai_available: false, reason })
    draw()
    fireEvent.click(screen.getByRole('button', { name: ASK }))

    expect(await screen.findByText(/Track’s AI is not configured on this deployment/)).toBeTruthy()
    expect(screen.getByText(reason)).toBeTruthy()
  })

  it('draws an unrecognised shape as one, not as an empty suggestion', async () => {
    answerWith(200, { error: 'issue not found', code: 'NOT_FOUND' })
    draw()
    fireEvent.click(screen.getByRole('button', { name: ASK }))

    expect(await screen.findByText(/shape this app does not recognise/)).toBeTruthy()
  })

  // ⚠ ONE CHAIN, FAILURE FIRST. "The AI suggested nothing" must never be what a failed ask looks
  // like — emptyVsFault.test.ts measured exactly that shape shipping on IssueList.tsx.
  it('draws a fault as a fault', async () => {
    answerWith(502, { error: 'ai upstream' })
    draw()
    fireEvent.click(screen.getByRole('button', { name: ASK }))

    expect(await screen.findByText(/This is a fault, not an empty result/)).toBeTruthy()
  })

  it('says Track is not configured on this deployment for a 503 from the BFF', async () => {
    answerWith(503, { error: 'track not configured' })
    draw()
    fireEvent.click(screen.getByRole('button', { name: ASK }))

    expect(await screen.findByText(/not configured on this deployment/)).toBeTruthy()
  })

  // The answer belongs to the issue it was asked about — the trap AISummary and FindDuplicates both
  // guard: React Router keeps this element mounted across /track/issues/:id changes.
  it('does not draw one issue’s suggestion under another issue’s id', async () => {
    answerWith(200, suggestion)
    const { rerender } = draw('iss-a')
    fireEvent.click(screen.getByRole('button', { name: ASK }))
    await screen.findByText('checkout times out under load')

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    rerender(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <TriageIssue issueId="iss-b" />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.queryByText('checkout times out under load')).toBeNull()
  })
})
