import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { stripComments } from '../../../packages/ui/src/lib/sourceText'
import { queryClient as production } from './App'
import { getJSON } from './lib/api'
import { AskAI } from './areas/docs/AskAI'
import { PageSummary } from './areas/docs/PageSummary'
import { PageTitleSuggestion } from './areas/docs/PageTitleSuggestion'
import { PageTranslation } from './areas/docs/PageTranslation'
import { SearchDocs } from './areas/docs/SearchDocs'
import { AISummary } from './areas/track/AISummary'
import { FindDuplicates } from './areas/track/FindDuplicates'
import { SearchIssues } from './areas/track/SearchIssues'
import { TriageIssue } from './areas/track/TriageIssue'

// oneActionOneCharge.test.tsx — ONE READER ACTION MUST BUY AT MOST ONE METERED CALL, AND THE
// CLIENT THAT DECIDES THAT IS THE PRODUCTION ONE.
//
// ── THE DEFECT, MEASURED RATHER THAN REVIEWED ────────────────────────────────
//
// Both metered censuses now prove that a surface spends nothing BEFORE the reader acts
// (areas/docs/meteredCostCensus.test.tsx, areas/track/meteredCostCensus.test.tsx, the mount
// column). Neither says anything about what ONE act costs, and the answer is not "one call":
// react-query re-issues a failed request under a policy that lives in App.tsx, not in the card.
//
// MEASURED at main `65b0f3fa`, not reasoned about. App.tsx's exported `queryClient` sets
//
//     retry: (failureCount, error) => failureCount < 1 && !(error instanceof ApiError && 401)
//
// — one automatic retry on any non-401 failure. AISummary is the ONE metered surface in the
// product that is a `useQuery`, and it opts out with a single line (`retry: false`) whose own
// comment states the rule: "A summary is a paid call. Nothing re-asks on its own: no retry, no
// refetch on focus." DELETING THAT ONE LINE makes a single press of "Summarise the thread" issue
// `/api/track/issues/iss-1/summary` TWICE — measured by counting the fetch log under the
// production default options — AND THE WHOLE apps/web SUITE STAYS GREEN: 134 files, 1923 tests,
// zero red. The card still says the right sentence, spends nothing at mount, and names the right
// payer, so every column in both censuses keeps passing.
//
// ⚠ THE REASON THE SUITE CANNOT SEE IT IS STRUCTURAL, AND THE CENSUS IS EXACT RATHER THAN
// APPROXIMATE — counted at main `65b0f3fa` from a clean `git archive` of that SHA, each count
// control-checked against a token that cannot be present. 45 test files build their own
// `new QueryClient(...)` and ALL 45 pass `retry: false` — correctly, so a deliberate fault arm
// does not take four seconds. 19 files import the PRODUCTION `queryClient` and drive whole
// routes for titles, landmarks, nav and refusal copy; NOT ONE of them presses a metered button
// or names a metered route (measured, both directions). So the retry policy that actually ships
// had never met a metered surface, and this file is where those two populations finally
// intersect.
//
// ── WHAT THIS FILE MEASURES, AND WHY IT NEEDS NO ROUTE TABLE ─────────────────
//
// Rendered alone, every one of the nine metered cards issues NOTHING at mount — that is what the
// censuses' mount column proves, and this file re-measures it as its own baseline. So after the
// reader's single action, every request in the log belongs to that action. The assertion is
// therefore the plain one: EXACTLY ONE request, no matter what its URL is. A retry is the same
// URL a second time; a double-submit is too; an effect loop is too. None of them needs this file
// to hold a third copy of the route table the two censuses already carry.
//
// ── THE ONE THING OVERRIDDEN, AND THE CONTROL THAT KEEPS IT HONEST ───────────
//
// The client under test is BUILT FROM `production.getDefaultOptions()` — derived, never restated,
// so a change to App.tsx's policy is measured here rather than shadowed by a copy. The single
// override is `retryDelay: 0`, which changes WHEN a retry is issued and not WHETHER. That is a
// claim, so it is controlled rather than asserted: `the harness can see a retry at all` below
// runs a bare read through this project's own `getJSON` under the SAME client and requires it to
// be issued MORE THAN ONCE. If retryDelay ever disabled retries, or App.tsx stopped retrying, or
// the fetch stub stopped failing, that probe reds and every `exactly one` below is known to be
// vacuous instead of quietly becoming so.

// ── THE POSITIVE CONTROLS, AND THE TWO PREDICTIONS THAT WERE WRONG ──────────
//
// 14 arms, `~/talyvor-queue/w17-one-action-one-charge-controls-m4x7.py`. Each applied ALONE
// against the WHOLE apps/web suite, predicted catcher named FIRST, every file restored in a
// `finally` and sha256-verified back, verdicts read from FAILING TEST TITLES and never from an
// exit code. Every mutation is LINE-NEUTRAL where the file is a pointerAudit target — this repo
// learned twice in one session that a mutation which moves lines is measuring the line numbers.
//
//   R1   AISummary loses `retry: false` (THE DEFECT)      → 1 red  (AISummary, here)
//   R1P  the same defect with THIS FILE DELETED           → 0 RED / 1923 tests ← the pre-merge world
//   R2   the stub stops failing                           → 1 red  (the probe)
//   R3   R1 + a hand-built `retry: false` client          → 1 red  (the probe)
//   R4   R1 + the extra 50ms settle removed               → 1 red  (AISummary)
//   R4B  R1 + the idle wait removed entirely              → 1 red  (the probe)
//   R5   a row renamed in the DOCS census                 → 2 red  (this join + the census's own)
//   R6   a row renamed HERE                               → 1 red  (this join)
//   R7   the extractor's regex made to match nothing      → 1 red  (the literal floors)
//   R8   App.tsx gains `mutations: { retry: 1 }`          → 8 red here + 18 elsewhere
//   R8P  R8 with THIS FILE DELETED                        → 18 red, NOT ONE of them metered
//   R9   PageSummary's mutation given `retry: 1`          → 1 red here + 2 in its own tests
//   R9P  R9 with THIS FILE DELETED                        → 2 red, neither naming a charge
//   R10  a reworded comment                               → 0 red
//
// ⚠⚠ R1P IS THE WHOLE FINDING. One line removed from one card, and 1923 tests across 134 files
// pass while a single press of "Summarise the thread" buys the workspace TWO metered calls.
//
// ⚠⚠ TWO OF MY PREDICTIONS WERE WRONG AND BOTH ARE RECORDED IN THE HARNESS RATHER THAN QUIETLY
// REPAIRED, BECAUSE WHAT THEY MEASURED IS BETTER THAN WHAT I EXPECTED. R3 and R4B are the two
// ways to blind this census — give it a client that cannot retry, or stop waiting long enough to
// see one — and I predicted 0 red for each, meaning "successfully blinded". Both reddened the
// PROBE. The nine surface assertions do go quiet, which is what the arms were for; but the probe
// drinks from the same client and the same settle, so it cannot be left behind. The only honest
// blinding of this file is to stop it running, which is the same place areas/docs'
// meteredCostCensus.test.tsx arrived at with its M6.
//
// ⚠ R8P AND R9P ARE WHY THE CENSUS IS NINE SURFACES AND NOT JUST AISummary. Both directions of
// the mutation defect are ALREADY caught today — by refusal-copy tests and by one card's own
// fault arms. What none of those 20 tests say is that money moved: they assert wording. A guard
// that reds without naming the charge tells a developer to fix a sentence.

type Surface = {
  readonly name: string
  readonly area: 'docs' | 'track'
  /** The upstream call site that makes this surface cost money — named in the failure. */
  readonly upstream: string
  readonly node: React.ReactNode
  /** THE READER'S SINGLE ACTION. Anything before the click that issues no request (choosing a
   *  language, typing a query) is setup, not a second act. */
  readonly act: () => void
}

const PAGE_TEXT = 'The rollback runbook, in full.'
const ISSUE = 'iss-1'

const SURFACES: readonly Surface[] = [
  {
    name: 'PageSummary',
    area: 'docs',
    upstream: 'internal/ai/engine.go#Engine.Summarize (docs-ai-summarize)',
    node: <PageSummary pageId="pg-1" text={PAGE_TEXT} />,
    act: () => fireEvent.click(screen.getByRole('button', { name: /summarise this page/i })),
  },
  {
    name: 'PageTranslation',
    area: 'docs',
    upstream: 'internal/ai/engine.go#Engine.Translate (docs-ai-translate)',
    node: <PageTranslation pageId="pg-1" text={PAGE_TEXT} />,
    act: () => {
      fireEvent.change(screen.getByLabelText(/translate into/i), { target: { value: 'French' } })
      fireEvent.click(screen.getByRole('button', { name: /translate this page/i }))
    },
  },
  {
    name: 'PageTitleSuggestion',
    area: 'docs',
    upstream: 'internal/ai/engine.go#Engine.SuggestTitle (docs-ai-title)',
    node: <PageTitleSuggestion spaceId="sp-1" pageId="pg-1" text={PAGE_TEXT} />,
    act: () => fireEvent.click(screen.getByRole('button', { name: /suggest a title/i })),
  },
  {
    name: 'AskAI',
    area: 'docs',
    upstream: 'internal/ai/engine.go#Engine.AskDocs (docs-ai-ask)',
    node: <AskAI />,
    act: () => {
      fireEvent.change(screen.getByLabelText(/question/i), {
        target: { value: 'how do we roll back?' },
      })
      fireEvent.click(screen.getByRole('button', { name: /^ask$/i }))
    },
  },
  {
    name: 'SearchDocs',
    area: 'docs',
    upstream: 'internal/search/semantic.go#SemanticSearch.embed (docs-search)',
    node: <SearchDocs />,
    act: () => {
      fireEvent.change(screen.getByLabelText(/search/i), { target: { value: 'auth' } })
      fireEvent.click(screen.getByRole('button', { name: /^search$/i }))
    },
  },
  {
    name: 'AISummary',
    area: 'track',
    upstream: 'internal/ai/engine.go:455#Engine.SummarizeThread',
    node: <AISummary issueId={ISSUE} />,
    act: () => fireEvent.click(screen.getByRole('button', { name: /summarise the thread/i })),
  },
  {
    name: 'FindDuplicates',
    area: 'track',
    upstream: 'internal/ai/engine.go:373#Engine.FindDuplicates',
    node: <FindDuplicates issueId={ISSUE} />,
    act: () => fireEvent.click(screen.getByRole('button', { name: /look for duplicates/i })),
  },
  {
    name: 'TriageIssue',
    area: 'track',
    upstream: 'internal/ai/engine.go:320#Engine.TriageIssue',
    node: <TriageIssue issueId={ISSUE} />,
    act: () => fireEvent.click(screen.getByRole('button', { name: /ask for a triage suggestion/i })),
  },
  {
    name: 'SearchIssues',
    area: 'track',
    upstream: 'internal/ai/engine.go:557#Engine.SemanticSearch (track-search)',
    node: <SearchIssues />,
    act: () => {
      fireEvent.change(screen.getByLabelText(/^search$/i), { target: { value: 'auth' } })
      fireEvent.click(screen.getByRole('button', { name: /^search$/i }))
    },
  },
]

/** ⚠ LITERALS, never `SURFACES.length` or anything derived from the thing they guard. A floor
 *  measured from its own subject passes at zero — this repo's most-repeated finding. */
const EXPECTED_DOCS = 5
const EXPECTED_TRACK = 4

const CENSUS = {
  docs: resolve(import.meta.dirname, 'areas/docs/meteredCostCensus.test.tsx'),
  track: resolve(import.meta.dirname, 'areas/track/meteredCostCensus.test.tsx'),
} as const

/**
 * The names in a census's own `METERED` table.
 *
 * ⚠ A REFUSAL, NEVER A SILENT SKIP. If the anchors are not both present the census has been
 * restructured and this extractor is measuring nothing; #274 is this repo's record of what a
 * census that quietly returns less looks like from the outside — exactly like a healthy one.
 */
function censusPopulation(area: 'docs' | 'track'): string[] {
  const src = stripComments(readFileSync(CENSUS[area], 'utf8'))
  const from = src.indexOf('const METERED')
  const to = src.indexOf('const EXPECTED_METERED')
  if (from < 0 || to <= from) {
    throw new Error(
      `${CENSUS[area]}: could not find the METERED table between 'const METERED' and ` +
        `'const EXPECTED_METERED'. The census has moved and this join is no longer reading it — ` +
        `re-anchor it rather than letting it return an empty population`,
    )
  }
  return [...src.slice(from, to).matchAll(/name: '([A-Za-z]+)'/g)].map((m) => m[1])
}

function clientUnderTest(): QueryClient {
  const defaults = production.getDefaultOptions()
  return new QueryClient({
    defaultOptions: {
      queries: { ...defaults.queries, retryDelay: 0 },
      mutations: { ...defaults.mutations, retryDelay: 0 },
    },
  })
}

function failingBff(): string[] {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return new Response(JSON.stringify({ error: 'upstream is down' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
  return calls
}

async function settle(qc: QueryClient): Promise<void> {
  // ⚠ THE IDLE WAIT IS THE LOAD-BEARING LINE AND THE 50ms IS NOT — measured (R4/R4B), not
  // assumed. react-query holds `fetchStatus: 'fetching'` ACROSS a retry, so waiting for the
  // client to go idle already spans the second attempt; removing this line entirely is what
  // makes the count too early to mean anything. The extra tick is defence in depth against a
  // retry scheduled but not yet started, and R4 showed it catches nothing on its own. Saying so
  // here rather than letting a later reader infer it is load-bearing.
  await waitFor(() => expect(qc.isFetching() + qc.isMutating()).toBe(0))
  await new Promise((r) => setTimeout(r, 50))
  await waitFor(() => expect(qc.isFetching() + qc.isMutating()).toBe(0))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('one reader action buys at most one metered call', () => {
  it('the population is the two censuses’ own, joined rather than restated', () => {
    const docs = censusPopulation('docs')
    const track = censusPopulation('track')
    expect(docs).toHaveLength(EXPECTED_DOCS)
    expect(track).toHaveLength(EXPECTED_TRACK)
    expect(
      new Set(SURFACES.map((s) => s.name)),
      'a surface censused for what it SAYS and missing here is a surface nothing holds to what ' +
        'it COSTS. Add it below, or delete it from the census',
    ).toEqual(new Set([...docs, ...track]))
    for (const s of SURFACES) {
      expect(s.upstream, `${s.name} must name the upstream site that bills`).toMatch(/^internal\//)
    }
  })

  it('the harness can see a retry at all', async () => {
    // ⚠ THE VACUITY PAIR FOR EVERY ASSERTION BELOW. "Exactly one request" is satisfied perfectly
    // by a client that cannot retry, a stub that does not fail, and a wait that is too short. This
    // probe is a plain read through the app's OWN getJSON, under the SAME client the surfaces get,
    // and it must be issued MORE THAN ONCE. If it is not, nothing below is evidence of anything.
    const calls = failingBff()
    const qc = clientUnderTest()
    function Probe() {
      useQuery({ queryKey: ['retry-probe'], queryFn: () => getJSON<unknown>('/api/probe') })
      return null
    }
    render(
      <QueryClientProvider client={qc}>
        <Probe />
      </QueryClientProvider>,
    )
    await settle(qc)
    expect(
      calls.filter((u) => u === '/api/probe').length,
      'the production default options no longer re-issue a failed read, or this harness cannot ' +
        'observe it. Either way every "exactly one metered request" below has become vacuous',
    ).toBeGreaterThan(1)
  })

  for (const s of SURFACES) {
    it(`${s.name} issues exactly one request for one press, even when it fails`, async () => {
      const calls = failingBff()
      const qc = clientUnderTest()
      render(
        <QueryClientProvider client={qc}>
          <MemoryRouter>{s.node}</MemoryRouter>
        </QueryClientProvider>,
      )
      // The baseline the censuses' mount column proves, re-measured HERE under the production
      // options: nothing is bought before the reader acts. Without it, "exactly one" could be one
      // mount request and no action at all.
      await new Promise((r) => setTimeout(r, 25))
      expect(
        calls,
        `${s.name} called out before the reader pressed anything, so the count below would not ` +
          `be a count of what one press costs`,
      ).toEqual([])

      s.act()
      await settle(qc)

      expect(
        calls,
        `one press of ${s.name} issued ${calls.length} requests. Every one of them is a metered ` +
          `call on ${s.upstream}, billed to the workspace, and the card's own sentence promises ` +
          `the reader ONE. react-query re-issues a failed request under the policy in App.tsx ` +
          `(one retry on any non-401); a metered surface must opt out of it. Calls: ` +
          `${calls.join(', ') || '(none)'}`,
      ).toHaveLength(1)
    })
  }
})
