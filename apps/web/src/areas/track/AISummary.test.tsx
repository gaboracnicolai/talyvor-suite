import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AISummary } from './AISummary'

// ⚠ EVERY ASSERTION IS ON THE RENDERED WORDS AND ON WHAT REACHED THE BFF. The three bodies below
// were MEASURED off talyvor-track's own engine at `eb0b39b` (tab-9e42, scratch copy) rather than
// copied out of a struct definition — see summary.test.ts for the four-row transcript.

let recorded: { method: string; path: string }[] = []

function mockBff(body: unknown, status = 200) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    recorded.push({ method: init?.method ?? 'GET', path: String(input) })
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

// ⚠ THE CLIENT IS RETURNED SO A RERENDER CAN REUSE IT. The issue-switch test below MUST hold the
// same cache across the switch: with a fresh QueryClient the panel would come up empty whatever
// this component does, and the test would pass over a component with no reset at all.
function open(issueId = 'iss-1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={qc}>
      <AISummary issueId={issueId} />
    </QueryClientProvider>,
  )
  return { ...view, qc }
}

beforeEach(() => {
  recorded = []
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('AISummary — Track AI in the browser at last', () => {
  // ⚠ THE COST RULE, AND IT IS THE FIRST ASSERTION FOR A REASON. A summary is a metered Lens call
  // billed to this issue. Nothing may be spent because someone opened a ticket.
  it('spends nothing until it is asked', async () => {
    mockBff({ summary: 'never reached' })
    open()
    await screen.findByRole('button', { name: 'Summarise the thread' })
    expect(recorded).toEqual([])
  })

  it('asks the issue-scoped BFF route, once, on the press', async () => {
    mockBff({ summary: 'Two people disagree about scope.' })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Summarise the thread' }))
    await screen.findByText('Two people disagree about scope.')
    expect(recorded).toEqual([{ method: 'GET', path: '/api/track/issues/iss-1/summary' }])
  })

  it('renders the summary, its key points, the next action and whose words they are', async () => {
    mockBff({
      summary: 'Two people disagree about scope.',
      key_points: ['Cold start is the trigger', 'Nobody owns the cache'],
      next_action: 'Decide the boundary',
      sentiment: 'blocked',
    })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Summarise the thread' }))

    await screen.findByText('Two people disagree about scope.')
    expect(screen.getByText('Cold start is the trigger')).toBeTruthy()
    expect(screen.getByText('Nobody owns the cache')).toBeTruthy()
    expect(screen.getByText(/Decide the boundary/)).toBeTruthy()
    expect(screen.getByText(/blocked/)).toBeTruthy()
    // ⚠ A MODEL WROTE THESE WORDS AND THE SCREEN SAYS SO. A summary that reads like a colleague's
    // note is the one kind of fake data a tracker must never draw silently.
    expect(screen.getByText(/not by a person/)).toBeTruthy()
  })

  // ⚠⚠ THE ai_available CONSUMPTION W1.7 ASKED FOR, AND THE WHOLE POINT OF THE ITEM.
  it('says plainly that Track’s AI is off, and repeats Track’s own operator sentence verbatim', async () => {
    const reason =
      'AI is not configured: set TRACK_LENS_MINT_KEY to the value of Lens’s LENS_MINT_KEY. ' +
      'It is a narrow credential that may only mint a per-workspace token.'
    mockBff({ ai_available: false, reason })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Summarise the thread' }))

    await screen.findByText('Track’s AI is not configured on this deployment.')
    // Verbatim, because the sentence names the variable to set and deliberately does not name
    // Lens's global admin key — paraphrasing it would invent operator instructions.
    expect(screen.getByText(reason)).toBeTruthy()
    // And it must not offer the button again: a control that cannot succeed is the thing the item
    // was written about.
    expect(screen.queryByRole('button', { name: 'Summarise the thread' })).toBeNull()
  })

  // ⚠⚠ THE MEASURED ASYMMETRY. Track checks the comment count BEFORE it checks availability, so
  // this body is what an AI-less deployment returns for almost every issue. The screen must state
  // the rule without promising the outcome.
  it('states the threshold from the wire and does not promise a summary', async () => {
    mockBff({ summary_available: false, min_comments: 10 })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Summarise the thread' }))

    await screen.findByText('Track summarises a thread once it has 10 comments. This one has fewer.')
    expect(screen.getByText(/does not say whether its AI is configured here/)).toBeTruthy()
  })

  // ⚠ NO 10 IS WRITTEN IN THIS APP. If Track stops sending the number, the screen names none — it
  // does not keep repeating the value it last knew.
  it('names no threshold when Track sends none', async () => {
    mockBff({ summary_available: false })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Summarise the thread' }))

    await screen.findByText('This thread is too short for Track to summarise.')
    expect(screen.queryByText(/10 comments/)).toBeNull()
  })

  // ⚠ THE FOURTH STATE. An upstream rename must draw a fault, not a calm empty panel.
  it('an unrecognised body is reported, not rendered as a blank summary', async () => {
    mockBff({ text: 'the words', points: [] })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Summarise the thread' }))

    await screen.findByText(/doesn’t recognise/)
  })

  it('a 503 with no Track upstream says Track is not configured, not that the thread is short', async () => {
    mockBff({ error: 'track upstream not configured on this BFF' }, 503)
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Summarise the thread' }))

    await screen.findByText(/Track is not configured on this deployment/)
    expect(screen.queryByText(/too short/)).toBeNull()
  })

  it('a fault is a fault, and says nothing was charged', async () => {
    mockBff({ error: 'boom' }, 500)
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Summarise the thread' }))

    await screen.findByText(/This is a fault, not an empty thread/)
  })

  it('a dead credential says only that it is unavailable — the bar says the rest', async () => {
    mockBff({ error: 'session expired' }, 401)
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Summarise the thread' }))

    await screen.findByText('Unavailable.')
  })

  // ⚠⚠ THE ANSWER BELONGS TO THE ISSUE THAT IS OPEN. React Router does not remount this component
  // when :id changes, so without the reset-during-render a summary requested on A stays on screen
  // over B's ticket, attributed to B, and nothing tells the reader. Same shape and same fix as the
  // four useStates at the top of IssueDetail.
  it('the summary on screen belongs to the issue that is open', async () => {
    mockBff({ summary: 'A’s thread is about cold starts.' })
    const view = open('iss-a')
    fireEvent.click(await screen.findByRole('button', { name: 'Summarise the thread' }))
    await screen.findByText('A’s thread is about cold starts.')

    view.rerender(
      <QueryClientProvider client={view.qc}>
        <AISummary issueId="iss-b" />
      </QueryClientProvider>,
    )

    // B shows the button again — not A's words, and not a request nobody made. The second
    // assertion is the load-bearing one: without the reset, `asked` survives the switch and this
    // component spends money on an issue whose reader never pressed anything.
    await screen.findByRole('button', { name: 'Summarise the thread' })
    expect(screen.queryByText('A’s thread is about cold starts.')).toBeNull()
    await waitFor(() => {
      expect(recorded.filter((r) => r.path.includes('iss-b'))).toEqual([])
    })
  })
})
