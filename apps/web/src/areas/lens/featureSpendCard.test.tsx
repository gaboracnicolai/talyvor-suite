import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// ⚠ THE FILE IS `FeatureSpendCard.tsx`, NOT `FeatureSpend.tsx`, AND THE REASON IS MEASURED. The
// reader beside it is `featureSpend.ts`; on this repository's macOS checkout the filesystem is
// case-INSENSITIVE, so `from './FeatureSpend'` resolved to the READER and every test in this file
// failed with "Element type is invalid … got: undefined". CI runs on Linux, where the same import
// would have resolved to the component — a pair of files that behave differently on the two
// machines that read them. Renamed rather than papered over.
import { FeatureSpendCard } from './FeatureSpendCard'

// The card that makes six printed feature tags followable — and the four things it must not say.
//
// Every one of these drives the SHIPPED component over a stubbed `fetch`, so what is asserted is
// what a reader would see rather than what a reader function returns.

function answerWith(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
  )
}

function renderCard(days: 7 | 30 = 7) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <FeatureSpendCard days={days} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const ROW = {
  feature: 'docs-ai-summarize',
  cost_usd: 0.0031,
  requests: 2,
  input_tokens: 900,
  output_tokens: 40,
}

describe('FeatureSpendCard', () => {
  it('asks for the window it was given', async () => {
    answerWith(200, [ROW])
    renderCard(30)
    await screen.findByText('docs-ai-summarize')
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/spend/by-feature?days=30')
  })

  it('renders the tag a cost sentence prints, with its cost and its request count', async () => {
    answerWith(200, [ROW])
    renderCard()
    expect(await screen.findByText('docs-ai-summarize')).toBeInTheDocument()
    // ≈-marked: a float from SUM(cost_usd) is derived, and this screen dresses derived values
    // as derived. Never a numeral.
    expect(screen.getByText('≈ $0.0031')).toBeInTheDocument()
    expect(screen.getByText(/2 requests/)).toBeInTheDocument()
  })

  // ⚠⚠ THE UNTAGGED BUCKET IS ON THE SCREEN. It is the row a card called "spend by feature" is
  // most tempted to hide, and hiding it turns a slice of a workspace's spend into a picture of
  // all of it.
  it('shows the untagged bucket rather than filtering it out', async () => {
    answerWith(200, [{ ...ROW, feature: '', cost_usd: 4.2, requests: 900 }])
    renderCard()
    expect(await screen.findByText(/Untagged/)).toBeInTheDocument()
    expect(screen.getByText('≈ $4.2000')).toBeInTheDocument()
  })

  // Lens's zero-row answer (`null` → `[]`) is an empty WINDOW, not a broken card and not "$0.00".
  it('an empty window says so instead of printing a zero', async () => {
    answerWith(200, null)
    renderCard()
    expect(await screen.findByTestId('feature-spend-empty')).toBeInTheDocument()
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument()
  })

  // A payload this app cannot read must not render as an empty window — that would report
  // "you spent nothing" about money it failed to read.
  it('an unreadable payload is a fault, never an empty window', async () => {
    answerWith(200, { error: 'boom' })
    renderCard()
    expect(await screen.findByTestId('feature-spend-unreadable')).toBeInTheDocument()
    expect(screen.queryByTestId('feature-spend-empty')).not.toBeInTheDocument()
  })

  // A transport failure is a failure. The card never invents a breakdown.
  it('a failed read reports a failure', async () => {
    answerWith(500, { error: 'nope' })
    renderCard()
    expect(await screen.findByText(/Couldn’t load/)).toBeInTheDocument()
  })

  // Rows it could not read are SAID, not swallowed — the same rule the reader applies, carried
  // to the screen so the number a person sees is disclosed as incomplete.
  it('discloses rows it could not read', async () => {
    answerWith(200, [ROW, null, { feature: 'x' }])
    renderCard()
    expect(await screen.findByTestId('feature-spend-dropped')).toHaveTextContent('2')
  })

  // ⚠ THE CARD MUST NOT PRESENT ITSELF AS A DECOMPOSITION OF THE MONTH FIGURE ABOVE IT. Both sum
  // token_events.cost_usd, but over DIFFERENT windows — rolling `days` here, calendar month
  // there — so they are not expected to agree, and a reader who assumes they should would read a
  // difference as a defect. The caption is asserted rather than trusted to survive an edit.
  it('says the window is not the month card’s', async () => {
    answerWith(200, [ROW])
    renderCard(7)
    expect(await screen.findByText(/last 7 days/)).toBeInTheDocument()
    expect(screen.getByText(/not the month-to-date figure/)).toBeInTheDocument()
  })

  // ⚠ AND IT MUST NOT PRESENT THE LIST AS A MENU OF FEATURES. Track tags its calls with the
  // ISSUE'S identifier, so a workspace using Track gets one row per issue beside the operation
  // rows. Said on the card, because a reader seeing `ENG-42` next to `docs-ai-ask` would
  // otherwise have no way to know why.
  it('says the tags are not all operation names', async () => {
    answerWith(200, [ROW])
    renderCard()
    await screen.findByText('docs-ai-summarize')
    expect(screen.getByText(/Track tags its calls with the issue/)).toBeInTheDocument()
  })
})
