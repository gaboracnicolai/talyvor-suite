import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { stripComments } from '../../../packages/ui/src/lib/sourceText'
import { queryClient as production } from './App'
import { AskAI } from './areas/docs/AskAI'
import { PageSummary } from './areas/docs/PageSummary'
import { PageTitleSuggestion } from './areas/docs/PageTitleSuggestion'
import { PageTranslation } from './areas/docs/PageTranslation'
import { SearchDocs } from './areas/docs/SearchDocs'
import { AISummary } from './areas/track/AISummary'
import { FindDuplicates } from './areas/track/FindDuplicates'
import { SearchIssues } from './areas/track/SearchIssues'
import { TriageIssue } from './areas/track/TriageIssue'

// meteredFaultClaim.test.tsx — WHAT A METERED CARD CLAIMS ABOUT MONEY WHEN THE CALL FAILS, AND
// WHY THE ONE STATUS IT CLAIMS IT ON CANNOT SUPPORT IT.
//
// ── THE STATE, MEASURED IN apps/bff RATHER THAN IMAGINED HERE ────────────────
//
// `502 {"error":"<product> upstream unreachable"}` was emitted by forwardProduct — the single
// `a.client.Do` every one of these nine surfaces reaches its upstream through — for TWO opposite
// causes: nothing listening, and an upstream that is running perfectly and has not finished.
// The second is not exotic. `a.client` is `&http.Client{Timeout: 10 * time.Second}`, and
// stream.go's own header measured what that bound does to a model call: "truncating every
// completion longer than that, WHICH IS MOST OF THEM". That fix moved the bound off
// `/api/ai/stream/{provider}` — the one AI route in this product that bills nobody — and left it
// on all nine that do.
//
// apps/bff/product_timeout_test.go reproduces it: a Docs upstream that answers 300ms after a 50ms
// bound produced byte-identical output to a connection refused. The BFF now separates them with
// `code: "UPSTREAM_TIMEOUT"`, the same discrimination docs_ai_test.go argued for one status down.
//
// ── WHAT THIS FILE PINS, AND WHY IT IS A RECORD RATHER THAN A REPAIR ─────────
//
// On that 502, five of the nine cards tell the reader that no work was done:
//
//   PageSummary / PageTranslation / PageTitleSuggestion / AskAI  "nothing was asked of the model"
//   AISummary                                                    "nothing was charged"
//
// On a TIMEOUT all five are false. The model was asked; it is still working; whether Lens took
// the charge is the upstream's to know and this app cannot see it. The other four make no money
// claim on a fault — FindDuplicates and TriageIssue say only "This is a fault, not an empty
// result", and the two searches say only that nothing was READ, which is true of the reader's
// screen either way.
//
// ⚠ THE COPY IS NOT CHANGED HERE AND THAT IS DELIBERATE. Choosing what a reader should be told
// when the product does not know whether it billed them is a product decision on a money
// surface, and this repository's own answer already exists ONE CARD OVER, in SearchIssues' price
// note: "Track's answer carries no record either way, so this app cannot say whether this one was
// billed." Adopting that sentence on five shipping cards is a call for Nicolai, filed on W1.7.
// What lands here is the measurement, in a form that cannot be lost: the split is asserted in
// BOTH directions, so a sixth card acquiring the claim is loud, and so is the day someone takes
// the decision and this file has to change with the copy.

// ── THE RULE ALREADY EXISTS IN THIS REPOSITORY, ENFORCED ON TWO SURFACES OF NINE ──
//
// ⚠ THIS IS WHAT CONTROL T6 FOUND AND IT CHANGES WHAT THE FILE IS FOR. Making FindDuplicates say
// "nothing was charged" on a fault reds TWO tests: this census, and a PRE-EXISTING per-card test
// named "FindDuplicates — what each of Track's two shapes draws · a 500 says fault, and claims
// nothing about the money". So "a fault may not claim the money did not move" is not a rule this
// file is inventing. It was written down, and enforced, on the two Track mutation cards — and the
// four Docs write cards and AISummary say the opposite, with nothing watching. A rule held on the
// surfaces that already obey it and absent from the five that break it is the exact shape both
// metered censuses exist to end (W1.1.9a: "the fix applied where the defect was reported and the
// identical shape one element over never swept for").
//
// ── THE CONTROLS ────────────────────────────────────────────────────────────
//
// 10 arms across BOTH suites, `~/talyvor-queue/w17-slow-model-fault-controls-m4x7.py`. Each
// applied ALONE, predicted catcher named FIRST, restored in a `finally` and sha256-verified.
// Verdicts from TEST NAMES, never exit codes.
//
//   T1   forwardProduct calls a timeout "unreachable" again  → 1 red  (the bff timeout test)
//   T1P  T1 with product_timeout_test.go DELETED             → 0 RED / 546 tests ← what shipped
//   T2   every failure gets the timeout code                 → 1 red  (the refused arm)
//   T3   the shipped 10s bound moved to 20s                  → 1 red  (the bound pin)
//   T4   the stream client gains a whole-exchange Timeout    → 2 red  (mine + a PRE-EXISTING one)
//   T5   PageSummary stops claiming                          → 2 red  (here + its own test)
//   T6   FindDuplicates STARTS claiming                      → 2 red  (here + the rule above)
//   T7   the stub stops failing (vacuity)                    → 9 red  (every row)
//   T8   the NO_WORK matcher made to match nothing           → 5 red  (4 rows + the pair)
//   T9   a row mis-classified HERE rather than in the card   → 2 red  (the floor + that row)
//   T10  a reworded comment                                  → 0 red
//
// ⚠ T1P IS THE FINDING: with the bff test absent, 546 tests pass while a healthy model past ten
// seconds is reported to the browser as an unreachable upstream.
//
// ⚠ T4's PREDICTION WAS WRONG AND THE CORRECTION IS WORTH MORE THAN THE PASS. I named one test;
// two reddened, because TestStream_AWholeExchangeClientTimeoutTruncatesTheStream already guards
// the stream direction. So half of what I thought was new was covered: the STREAM client was
// watched, and the SHARED client every metered route uses (T3) was not.

type FaultClaim = {
  readonly name: string
  readonly upstream: string
  /** MEASURED, not endorsed: does this card tell the reader no work happened / no charge landed? */
  readonly claimsNothingHappened: boolean
  readonly node: React.ReactNode
  readonly act: () => void
}

const PAGE_TEXT = 'The rollback runbook, in full.'
const ISSUE = 'iss-1'

/** The two sentences that are claims about the FAILED CALL rather than about the screen. */
const NO_WORK = /nothing was asked of the model/i
const NO_CHARGE = /nothing was charged/i

const SURFACES: readonly FaultClaim[] = [
  {
    name: 'PageSummary',
    upstream: 'internal/ai/engine.go#Engine.Summarize',
    claimsNothingHappened: true,
    node: <PageSummary pageId="pg-1" text={PAGE_TEXT} />,
    act: () => fireEvent.click(screen.getByRole('button', { name: /summarise this page/i })),
  },
  {
    name: 'PageTranslation',
    upstream: 'internal/ai/engine.go#Engine.Translate',
    claimsNothingHappened: true,
    node: <PageTranslation pageId="pg-1" text={PAGE_TEXT} />,
    act: () => {
      fireEvent.change(screen.getByLabelText(/translate into/i), { target: { value: 'French' } })
      fireEvent.click(screen.getByRole('button', { name: /translate this page/i }))
    },
  },
  {
    name: 'PageTitleSuggestion',
    upstream: 'internal/ai/engine.go#Engine.SuggestTitle',
    claimsNothingHappened: true,
    node: <PageTitleSuggestion spaceId="sp-1" pageId="pg-1" text={PAGE_TEXT} />,
    act: () => fireEvent.click(screen.getByRole('button', { name: /suggest a title/i })),
  },
  {
    name: 'AskAI',
    upstream: 'internal/ai/engine.go#Engine.AskDocs',
    claimsNothingHappened: true,
    node: <AskAI />,
    act: () => {
      fireEvent.change(screen.getByLabelText(/question/i), { target: { value: 'q' } })
      fireEvent.click(screen.getByRole('button', { name: /^ask$/i }))
    },
  },
  {
    name: 'SearchDocs',
    upstream: 'internal/search/semantic.go#SemanticSearch.embed',
    claimsNothingHappened: false,
    node: <SearchDocs />,
    act: () => {
      fireEvent.change(screen.getByLabelText(/search/i), { target: { value: 'auth' } })
      fireEvent.click(screen.getByRole('button', { name: /^search$/i }))
    },
  },
  {
    name: 'AISummary',
    upstream: 'internal/ai/engine.go:455#Engine.SummarizeThread',
    claimsNothingHappened: true,
    node: <AISummary issueId={ISSUE} />,
    act: () => fireEvent.click(screen.getByRole('button', { name: /summarise the thread/i })),
  },
  {
    name: 'FindDuplicates',
    upstream: 'internal/ai/engine.go:373#Engine.FindDuplicates',
    claimsNothingHappened: false,
    node: <FindDuplicates issueId={ISSUE} />,
    act: () => fireEvent.click(screen.getByRole('button', { name: /look for duplicates/i })),
  },
  {
    name: 'TriageIssue',
    upstream: 'internal/ai/engine.go:320#Engine.TriageIssue',
    claimsNothingHappened: false,
    node: <TriageIssue issueId={ISSUE} />,
    act: () => fireEvent.click(screen.getByRole('button', { name: /ask for a triage suggestion/i })),
  },
  {
    name: 'SearchIssues',
    upstream: 'internal/ai/engine.go:557#Engine.SemanticSearch',
    claimsNothingHappened: false,
    node: <SearchIssues />,
    act: () => {
      fireEvent.change(screen.getByLabelText(/^search$/i), { target: { value: 'auth' } })
      fireEvent.click(screen.getByRole('button', { name: /^search$/i }))
    },
  },
]

/** ⚠ LITERALS. Never derived from SURFACES — a floor measured from its own subject passes at zero. */
const EXPECTED_SURFACES = 9
const EXPECTED_CLAIMERS = 5

const CENSUS = {
  docs: resolve(import.meta.dirname, 'areas/docs/meteredCostCensus.test.tsx'),
  track: resolve(import.meta.dirname, 'areas/track/meteredCostCensus.test.tsx'),
} as const

/** The names in a census's own METERED table. A REFUSAL, never a silent skip. */
function censusPopulation(area: 'docs' | 'track'): string[] {
  const src = stripComments(readFileSync(CENSUS[area], 'utf8'))
  const from = src.indexOf('const METERED')
  const to = src.indexOf('const EXPECTED_METERED')
  if (from < 0 || to <= from) {
    throw new Error(
      `${CENSUS[area]}: the METERED table has moved, so this join is reading nothing. Re-anchor it`,
    )
  }
  return [...src.slice(from, to).matchAll(/name: '([A-Za-z]+)'/g)].map((m) => m[1])
}

function faultingBff(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        // Exactly what forwardProduct answers when the model is still working.
        new Response(JSON.stringify({ error: 'docs upstream timed out', code: 'UPSTREAM_TIMEOUT' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('what a metered card claims about money when the call fails', () => {
  it('the population is the two censuses’ own, joined rather than restated', () => {
    const names = [...censusPopulation('docs'), ...censusPopulation('track')]
    expect(names).toHaveLength(EXPECTED_SURFACES)
    expect(
      new Set(SURFACES.map((s) => s.name)),
      'a surface censused for what it says at mount and missing here is a surface nothing holds ' +
        'to what it says when the call fails',
    ).toEqual(new Set(names))
    expect(
      SURFACES.filter((s) => s.claimsNothingHappened),
      'the measured split is five claimers and four that say nothing about money on a fault; if ' +
        'this moved, the copy moved, and the queue entry describing it is now describing a ' +
        'product that does not exist',
    ).toHaveLength(EXPECTED_CLAIMERS)
  })

  it('the two sentences are distinguishable, and neither matches the other card’s wording', () => {
    // ⚠ THE VACUITY PAIR. `not.toMatch` is satisfied perfectly by a regex that matches nothing,
    // so both are shown to match the sentence they are for and to miss the one they are not.
    expect(NO_WORK.test('nothing was asked of the model. Try again.')).toBe(true)
    expect(NO_WORK.test('This is a fault, not an empty thread — nothing was charged.')).toBe(false)
    expect(NO_CHARGE.test('This is a fault, not an empty thread — nothing was charged.')).toBe(true)
    expect(NO_CHARGE.test('nothing was asked of the model. Try again.')).toBe(false)
    // And neither may match the honest form this repo already ships one card over.
    const honest = 'this app cannot say whether this one was billed'
    expect(NO_WORK.test(honest)).toBe(false)
    expect(NO_CHARGE.test(honest)).toBe(false)
  })

  for (const s of SURFACES) {
    it(`${s.name} ${s.claimsNothingHappened ? 'claims nothing happened' : 'claims nothing about money'} on the 502 a slow model produces`, async () => {
      faultingBff()
      const defaults = production.getDefaultOptions()
      const qc = new QueryClient({
        defaultOptions: {
          queries: { ...defaults.queries, retry: false },
          mutations: { ...defaults.mutations },
        },
      })
      render(
        <QueryClientProvider client={qc}>
          <MemoryRouter>{s.node}</MemoryRouter>
        </QueryClientProvider>,
      )
      s.act()
      await waitFor(() => expect(qc.isFetching() + qc.isMutating()).toBe(0))
      await new Promise((r) => setTimeout(r, 30))
      const text = document.body.textContent ?? ''

      // ⚠ THE ANTI-VACUITY LINE. Every assertion below is about words on a failed card; if the
      // card never reached its fault arm they would all read an empty or mounted-state document
      // and the file would be measuring nothing.
      expect(
        text,
        `${s.name} did not reach a fault state on a 502, so this row measured the wrong screen`,
      ).toMatch(/couldn’t|could not|fault|unavailable/i)

      const claims = NO_WORK.test(text) || NO_CHARGE.test(text)
      expect(
        claims,
        s.claimsNothingHappened
          ? `${s.name} used to tell the reader no work was done and no longer does. If the ` +
            `decision on W1.7 has been taken, this row is the place it lands — flip it to false ` +
            `and say what the card says now.`
          : `${s.name} has acquired a claim that nothing was asked or charged. On a 502 this app ` +
            `cannot know that: forwardProduct answers 502 both when nothing is listening and ` +
            `when ${s.upstream} is running past the shared client's ten-second bound, and only ` +
            `the upstream knows whether Lens took the charge.`,
      ).toBe(s.claimsNothingHappened)
    })
  }
})
