import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AISummary } from './AISummary'
import { FindDuplicates } from './FindDuplicates'
import { TriageIssue } from './TriageIssue'
import { meteredCallCopy } from './format'
import { getJSON } from '../../lib/api'

// aiCostClaim.test.tsx — the sentence three metered cards print about the number above them.
//
// ── THE CLAIM, AND WHY IT NEEDED ITS OWN FILE ────────────────────────────────
//
// AISummary, FindDuplicates and TriageIssue sit directly under IssueDetail's "AI cost" row, and
// all three used to say the same thing in the same words: "It is a metered AI call, and what it
// costs is added to the AI cost above — for this issue." Present tense, offered as a consequence
// of the click.
//
// MEASURED READ-ONLY IN talyvor-track AT `882c94d2a9a71dadc59753e3bde37aac86fb1b21`: nothing on
// the AI request path writes `issues.ai_cost_usd`. Its only two writers are `RecordSpendEvent`
// (called from the Lens `spend_alert` webhook alone, async and best-effort) and
// `RecordRequestSpend` (called from `Syncer.SyncFeatureSpend` alone, a 15-minute poller —
// `cmd/track/main.go:253`). `internal/ai/` writes no spend at all. The figure above therefore
// cannot have moved when the answer lands, and no refetch this app makes could find it moved.
//
// ⚠ THE THREE ASSERTIONS BELOW ARE ONE ASSERTION EACH, DELIBERATELY SPLIT ACROSS THE THREE CARDS.
// A single card's test would have kept the other two free to drift, which is how they came to say
// the same wrong sentence three times — each was written from the last one.
//
// ⚠ AND THE `no refetch` TEST IS THE ONE THAT PROTECTS THE DECISION RATHER THAN THE WORDS. The
// obvious "fix" for a stale number is to invalidate the issue query on success; here that spends a
// request to re-read a number that cannot have changed yet and leaves a refreshed panel reporting
// the old figure. If Track ever credits inline, this test is where that conversation starts — the
// sentence and the refetch have to change together or not at all.

const ISSUE = 'iss-7'

/** The old promise, kept as a literal so its removal is asserted rather than assumed. */
const OLD_PROMISE = /what it costs is added to the AI cost above/i

type Call = { url: string; method: string }

function mockBff(routes: Record<string, { status: number; body: unknown }>) {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method })
    for (const [suffix, res] of Object.entries(routes)) {
      if (url.endsWith(suffix)) {
        return new Response(JSON.stringify(res.body), {
          status: res.status,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }
    return new Response(JSON.stringify({ error: 'no such endpoint' }), { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

function renderIn(node: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const CARDS = [
  { name: 'AISummary', node: <AISummary issueId={ISSUE} /> },
  { name: 'FindDuplicates', node: <FindDuplicates issueId={ISSUE} />},
  { name: 'TriageIssue', node: <TriageIssue issueId={ISSUE} />},
]

/** Holds the SAME query key IssueDetail's Details card holds — the one behind the AI cost row.
 *  Without it in the tree an `invalidateQueries` regression would have nothing to refetch and the
 *  test below would pass over the very change it exists to catch. */
function IssueCostProbe() {
  useQuery({
    queryKey: ['track-issue', ISSUE],
    queryFn: () => getJSON<unknown>(`/api/track/issues/${ISSUE}`),
    retry: false,
  })
  return null
}

describe('the metered-call claim', () => {
  for (const card of CARDS) {
    it(`${card.name} says WHEN the charge appears, and does not promise it appears now`, () => {
      mockBff({})
      renderIn(card.node)
      // The one sentence, from ./format — not a copy of it. Three cards drifting into three
      // wordings of one fact is how the wrong one got written three times.
      expect(screen.getByText(meteredCallCopy)).toBeInTheDocument()
      expect(screen.queryByText(OLD_PROMISE)).not.toBeInTheDocument()
    })
  }

  it('every card sources the sentence from the same place', () => {
    // The drift guard. Rendering all three in one tree and counting occurrences of the SHARED
    // string is what makes "they happen to agree today" into "they cannot disagree".
    mockBff({})
    renderIn(
      <>
        {CARDS.map((c) => (
          <div key={c.name}>{c.node}</div>
        ))}
      </>,
    )
    expect(screen.getAllByText(meteredCallCopy)).toHaveLength(CARDS.length)
  })

  it('⚠ the sentence is IMPORTED by every card, never re-typed into one', () => {
    // The rendered-text check above catches a card whose wording drifts. It CANNOT catch a card
    // that pastes today's wording inline — identical text, free to drift tomorrow, and the next
    // edit to ./format would silently leave that card behind saying the old thing. That is how
    // three cards came to hold one wrong sentence, so the source is checked as well as the screen.
    for (const file of ['AISummary.tsx', 'FindDuplicates.tsx', 'TriageIssue.tsx']) {
      const src = readFileSync(resolve(import.meta.dirname, file), 'utf8')
      expect(src, `${file} must import the shared sentence`).toMatch(
        /import \{[^}]*\bmeteredCallCopy\b[^}]*\} from '\.\/format'/,
      )
      // The old promise, and any re-typed copy of the new one, must not be in a card.
      expect(src, `${file} must not carry its own copy of the claim`).not.toMatch(
        /is a metered AI call/,
      )
    }
  })

  it('⚠ does not re-read the issue after a paid call — a refresh that cannot see the change', async () => {
    // ⚠ THE ISSUE QUERY IS MOUNTED IN THE TREE ON PURPOSE. An earlier version of this test rendered
    // FindDuplicates alone and asserted "no GET on the issue route". It passed — and it would have
    // gone on passing with `invalidateQueries(['track-issue', id])` added to the mutation, because
    // with no such query mounted there is nothing for an invalidation to refetch. A guard that
    // cannot observe the regression it is named after is not a guard, so the probe below holds the
    // same query key IssueDetail holds, and an invalidation therefore produces a SECOND read.
    const calls = mockBff({
      [`/${ISSUE}/find-duplicates`]: { status: 200, body: [] },
      [`/api/track/issues/${ISSUE}`]: { status: 200, body: { id: ISSUE, ai_cost_usd: 0, ai_tokens: 0 } },
    })
    const issueReads = () =>
      calls.filter((c) => c.method === 'GET' && c.url.endsWith(`/api/track/issues/${ISSUE}`)).length

    renderIn(
      <>
        <IssueCostProbe />
        <FindDuplicates issueId={ISSUE} />
      </>,
    )
    // The probe's own mount read — the baseline the assertion is measured against.
    await waitFor(() => expect(issueReads()).toBe(1))

    fireEvent.click(screen.getByRole('button', { name: /look for duplicates/i }))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/find-duplicates'))).toBe(true))
    // Let any onSuccess-scheduled refetch land before concluding there was none.
    await new Promise((r) => setTimeout(r, 40))

    // Still one. The paid call did not cause the AI cost row to be re-read, because there is
    // nothing new for it to read — see meteredCallCopy in ./format for the two writers and where
    // they run.
    expect(issueReads()).toBe(1)
  })
})
