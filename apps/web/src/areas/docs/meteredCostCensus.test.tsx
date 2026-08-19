import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AskAI } from './AskAI'
import { PageSummary } from './PageSummary'
import { PageTitleSuggestion } from './PageTitleSuggestion'
import { PageTranslation } from './PageTranslation'
import { SearchDocs } from './SearchDocs'

// meteredCostCensus.test.tsx — every Docs surface that SPENDS must tell the reader it spent.
//
// ── WHY THIS FILE EXISTS, AND WHY IT IS A CENSUS RATHER THAN A TEST PER CARD ──
//
// W1.7's third bullet is "SHOW WHAT IT COST. Every one of these is a metered Lens call attributed
// to the page or issue — that is the entire product thesis and no screen shows it." Track's half
// of that discipline has a guard: areas/track/aiCostClaim.test.tsx, written after THREE Track
// cards were found printing one wrong sentence, each copied from the last.
//
// ⚠⚠ THAT GUARD'S POPULATION IS THREE FILE NAMES IN ANOTHER DIRECTORY — `['AISummary.tsx',
// 'FindDuplicates.tsx', 'TriageIssue.tsx']`, literals in areas/track. It is a good guard and it
// cannot see this directory at all. MEASURED at main `1f38e07`: five Docs surfaces spend on Lens,
// four print a cost sentence, and the fifth — SearchDocs — printed NOTHING, while its own file
// header carried a paragraph titled "⚠ WHAT IT COSTS" stating the fact in full. The knowledge was
// in the file, written by whoever measured it. The reader never saw it. A census keyed on "does
// this surface spend" is the only shape that would have caught that; a test per card is exactly
// what leaves the fifth card unwritten.
//
// ── THE POPULATION, AND WHAT PUTS A SURFACE IN IT ────────────────────────────
//
// A surface is IN if a use of it causes talyvor-docs to bill Lens. Measured against talyvor-docs
// main `4a35734`, read-only, from source rather than from these components' comments:
//
//   internal/ai/engine.go   Summarize → e.run(…, "docs-ai-summarize", pageID)
//                           Translate → e.run(…, "docs-ai-translate", pageID)
//                           SuggestTitle → e.run(…, "docs-ai-title", pageID)
//                           Ask       → e.run(…, "docs-ai-ask", "")      ← no page by construction
//   internal/search/semantic.go:400  req.Header.Set("X-Talyvor-Feature", "docs-search")
//
// and internal/search/handler.go#WithRateLimit states the property that makes search the one that
// mattered most to miss: "This route embeds the query via Lens on every semantic search
// (embed(ctx, "query", q)), so it spends per call… a single person typing drives ~200
// embeddings/min". It is the highest-frequency metered surface in the product.
//
// ⚠ THE FLOOR IS A LITERAL. `EXPECTED_METERED` is 5, typed out, never `METERED.length` — a floor
// derived from the list it guards is a floor that moves when someone deletes a row, which is the
// one direction this census exists to refuse.
//
// ⚠ AND THE STALE DIRECTION IS ASSERTED TOO. An entry names the upstream call site that makes it
// metered. If a surface stops spending, its row must be DELETED rather than left passing — see
// the changelog note below, which is the one Docs AI surface deliberately NOT in this population.
//
// ⚠ PageChangelog IS OUT, WITH A REASON RATHER THAN AN OMISSION. Its header records that the
// generate route's charge does not land on the page's own_ai_cost_usd, so it must NOT print the
// sentence the other cards print. A surface excluded silently is indistinguishable from one
// forgotten, which is how SearchDocs was missed; excluded surfaces are therefore named here.
//
// ── THE POSITIVE CONTROLS, AND THE ONE THAT FOUND A HOLE IN THIS FILE ────────
//
// Nine mutations, each applied ALONE against the whole `src/areas/docs` suite, failing test titles
// read rather than exit codes counted:
//
//   C1  results-branch <CostNote> deleted              → 4 red  (census + 3 branch tests)
//   C2  empty-branch <CostNote> deleted                → 0 RED — THE HOLE. See below.
//   C3  CostNote forced to the past tense always       → 1 red  ("says nothing was PROVED billed")
//   C4  CostNote forced to the conditional always      → 3 red
//   C5  CostNote keyed on semanticShown, not semantic  → 1 red  (the dropped-row asymmetry)
//   C6  `docs-search` renamed in both branches         → 2 red  (the ledger join key)
//   C7  one population row deleted (AskAI)             → 1 red  (the floor)
//   C8  a SIBLING card's sentence removed (PageSummary)→ 1 red  (this census guards all five)
//   C9  floor derived (METERED.length) AND a row deleted → 0 red
//
// ⚠⚠ C2 IS THE ONE WORTH READING. Deleting the cost note from the EMPTY-results branch left this
// entire directory green: this census drives the results branch, and every branch test in
// searchDocs.test.tsx held at least one row. The empty answer is the state a reader reaches with a
// bad query, the state that reads most like "nothing happened" — and the embedding was bought
// before Docs knew the result set was empty. The branch where the sentence matters most was the
// branch nothing covered. searchDocs.test.tsx now has a test for it and C2 is 1 red.
//
// ⚠ C9 IS WHY THE FLOOR IS TYPED OUT. With the floor derived from the list it guards, deleting a
// row goes GREEN — C7's red vanishes entirely. That is the whole argument for the literal, run
// rather than asserted.
//
// ⚠ C8 IS WHY THIS IS A CENSUS. It mutates a card that was ALREADY correct before this file
// existed. A guard written only for the surface that was broken would have passed it.
//
// ── THE PAYER COLUMN (tab-4d8a), AND ITS OWN SIX CONTROLS ────────────────────
//
// The nine above check the SPINE. They say nothing about who the charge lands on, and the five
// surfaces do not agree about that — see the payer field and the note above the loop that reads
// it. `~/talyvor-queue/w17-docs-payer-census-controls-4d8a.py`, each applied alone:
//
//   D1  SearchDocs' payer flipped to the page      → 1 red  ← the exact edit that was GREEN
//   D2  PageSummary's payer flipped to no-page     → 2 red  (census + that card's own test)
//   D3  PageSummary prints BOTH payer clauses      → 1 red  (census only — see below)
//   D4  the census's own payer column flipped      → 1 red  (the column is read, not decorative)
//   D5  the census rendering nothing               → 10 red (vacuity: 5 spine + 5 payer)
//   D6  a reworded comment                         → 0 red
//
// ⚠ D3 IS WHY THE ASSERTION HAS A `not.toMatch` HALF. A card printing BOTH clauses still says the
// right thing, so its per-card test stays green and a presence-only census would too. The payer is
// exclusive: saying both is saying nothing.
//
// ⚠ D2 IS WHY THIS IS A COLUMN AND NOT A FIFTH PER-CARD TEST. It reds in two places, which is the
// point — the four hand-written per-card assertions are real and are kept; what they could not do
// is notice the fifth card that never got one.

type Call = { url: string; method: string }

/** One BFF for the whole census: every metered route answers, so a card that asks for the wrong
 *  one gets a 404 and fails loudly rather than rendering a hedged empty state that would sail
 *  through an assertion about a sentence. */
function mockBff() {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method })
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

    if (/^\/api\/docs\/pages\/[^/]+\/summarize$/.test(url)) return json({ text: 'a summary' })
    if (/^\/api\/docs\/pages\/[^/]+\/translate$/.test(url)) return json({ text: 'une traduction' })
    if (/^\/api\/docs\/pages\/[^/]+\/suggest-title$/.test(url)) return json({ title: 'A Better Title' })
    if (url === '/api/docs/ai/ask') return json({ answer: 'an answer', sources: [] })
    if (url.startsWith('/api/docs/search?')) {
      // A row tagged `semantic` — the ONE thing that proves the metered half actually ran. The
      // search card's cost sentence is keyed on this evidence, so the census drives the state in
      // which a charge is certain rather than the state in which it is merely possible.
      return json({
        results: [
          {
            page_id: 'pg-1',
            page_title: 'Auth flow',
            space_name: 'Engineering',
            headline: 'an excerpt',
            source: 'semantic',
            url: '/spaces/sp-1/pages/pg-1',
          },
        ],
        total: 1,
        query: 'auth',
        took_ms: 3,
      })
    }
    return json({ error: 'no such endpoint' }, 404)
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

/** Every Docs surface whose use bills Lens, the tag it bills under, and the upstream call site
 *  that makes that true. `drive` takes the card from mounted to answered — the state in which the
 *  charge has certainly happened and the reader is looking at what it bought. */
const METERED: {
  name: string
  tag: string
  /** WHO THE CHARGE LANDS ON, and it is not the same for all five — see the header's second table. */
  payer: 'page' | 'workspace'
  upstream: string
  node: React.ReactNode
  drive: () => void
  landed: RegExp
}[] = [
  {
    name: 'PageSummary',
    tag: 'docs-ai-summarize',
    payer: 'page',
    upstream: 'internal/ai/engine.go#Engine.Summarize',
    node: <PageSummary pageId="pg-1" text="The rollback runbook, in full." />,
    drive: () => fireEvent.click(screen.getByRole('button', { name: /summarise this page/i })),
    landed: /a summary/,
  },
  {
    name: 'PageTranslation',
    tag: 'docs-ai-translate',
    payer: 'page',
    upstream: 'internal/ai/engine.go#Engine.Translate',
    node: <PageTranslation pageId="pg-1" text="The rollback runbook, in full." />,
    drive: () => {
      fireEvent.change(screen.getByLabelText(/translate into/i), { target: { value: 'French' } })
      fireEvent.click(screen.getByRole('button', { name: /translate this page/i }))
    },
    landed: /une traduction/,
  },
  {
    name: 'PageTitleSuggestion',
    tag: 'docs-ai-title',
    payer: 'page',
    upstream: 'internal/ai/engine.go#Engine.SuggestTitle',
    node: <PageTitleSuggestion spaceId="sp-1" pageId="pg-1" text="The rollback runbook, in full." />,
    drive: () => fireEvent.click(screen.getByRole('button', { name: /suggest a title/i })),
    landed: /A Better Title/,
  },
  {
    name: 'AskAI',
    tag: 'docs-ai-ask',
    payer: 'workspace',
    upstream: 'internal/ai/engine.go#Engine.Ask',
    node: <AskAI />,
    drive: () => {
      fireEvent.change(screen.getByLabelText(/question/i), { target: { value: 'how do we roll back?' } })
      fireEvent.click(screen.getByRole('button', { name: /^ask$/i }))
    },
    landed: /an answer/,
  },
  {
    name: 'SearchDocs',
    tag: 'docs-search',
    payer: 'workspace',
    upstream: 'internal/search/semantic.go#SemanticSearch.embed',
    node: <SearchDocs />,
    drive: () => {
      fireEvent.change(screen.getByLabelText(/search/i), { target: { value: 'auth' } })
      fireEvent.click(screen.getByRole('button', { name: /^search$/i }))
    },
    landed: /Auth flow/,
  },
]

/** ⚠ A LITERAL. Never METERED.length — see the header. */
const EXPECTED_METERED = 5

describe('every metered Docs surface tells the reader it spent', () => {
  it(`the population is ${EXPECTED_METERED} surfaces, each naming the upstream call that bills`, () => {
    expect(METERED).toHaveLength(EXPECTED_METERED)
    for (const s of METERED) {
      expect(s.tag, `${s.name} must name the Lens feature tag it bills under`).toMatch(/^docs-/)
      expect(s.upstream, `${s.name} must name the upstream site that makes it metered`).toMatch(
        /^internal\//,
      )
    }
    // No two surfaces may share a tag: the tag is what separates one charge from another in the
    // workspace's Lens ledger, so a duplicate here would be two screens pointing a reader at one
    // line and calling it theirs.
    expect(new Set(METERED.map((s) => s.tag)).size).toBe(EXPECTED_METERED)
  })

  for (const s of METERED) {
    it(`${s.name} names ${s.tag} on screen once its answer lands`, async () => {
      mockBff()
      renderIn(s.node)
      s.drive()
      await waitFor(() => expect(screen.getByText(s.landed)).toBeInTheDocument())

      // The tag is rendered in a <code> element, so it is its own text node.
      expect(
        screen.getByText(s.tag),
        `${s.name} spends on Lens under ${s.tag} (${s.upstream}) and must say so — ` +
          `a screen that shows what a metered call bought without saying it was metered is the ` +
          `defect W1.7's third bullet names`,
      ).toBeInTheDocument()

      // ⚠ NAMING THE TAG IS NOT ENOUGH. A tag alone reads as a label; the sentence has to say the
      // call was billed and to WHOM, which is the workspace — no Docs AI call is billed to a user.
      expect(
        document.body.textContent,
        `${s.name} must say the call was metered and billed to this workspace`,
      ).toMatch(/metered Lens call billed to this workspace/i)
    })
  }

  /**
   * ⚠⚠ THE PAYER CLAUSE, AND THE HOLE IT WAS ADDED TO CLOSE — MEASURED, NOT REVIEWED.
   *
   * The assertion above checks the SPINE ("a metered Lens call billed to this workspace") on all
   * five. It says nothing about the clause that follows it, and that clause is NOT the same for
   * all five: three surfaces bind the charge to the page, two cannot. Four of the five had a
   * hand-written per-card test for it — pageSummary.test.tsx:135, pageTranslation.test.tsx:159,
   * pageTitleSuggestion.test.tsx:257, askAI.test.tsx:114 — and the fifth, SearchDocs, added by
   * #240, had NONE.
   *
   * MEASURED at main `eea492db`: flipping SearchDocs' proven-branch clause from "attributes it to
   * no single page, so it does not appear in any page's AI cost" to "attributes it to this page,
   * so it moves this page's own AI cost" left ALL 1617 TESTS GREEN. That is a false claim about
   * money on the highest-frequency metered surface in the product — the defect class #239 deleted
   * from Track's three cards, arriving on a fifth surface through the one clause nothing read.
   *
   * ⚠ IT IS A CENSUS COLUMN AND NOT A FIFTH PER-CARD TEST, DELIBERATELY. Four per-card tests and
   * one gap is exactly the shape that hid this; a sixth surface would arrive with the same gap.
   *
   * ⚠ RE-MEASURED UPSTREAM RATHER THAN INHERITED FROM THIS FILE'S OWN HEADER, at talyvor-docs
   * `11a9e0cce679481c35ef567319f9a7e7e1df0641` (a NEWER sha than the `4a35734` recorded above;
   * held by tab-9d47, never written to). `Engine.run` binds the charge to a page through
   * `BindAISpend` ONLY when `pageID != ""` (engine.go:110) — summarize/translate/title pass one,
   * `Ask` passes `""` (engine.go:198), and `docs-search` never goes through `run` at all: it is an
   * `X-Talyvor-Feature` header on an embeddings request (search/semantic.go:400). So "no single
   * page" is a property of the CALL SITE for two surfaces, not an editorial choice.
   *
   * ⚠ BOTH DIRECTIONS, ON PURPOSE. Asserting only the presence of the right clause would pass a
   * card that printed BOTH; the payer is exclusive, so the wrong one has to be absent as well.
   */
  for (const s of METERED) {
    it(`${s.name} names the payer its call site establishes: the ${s.payer}`, async () => {
      mockBff()
      renderIn(s.node)
      s.drive()
      await waitFor(() => expect(screen.getByText(s.landed)).toBeInTheDocument())
      const text = document.body.textContent ?? ''

      const bound = /moves this page’s own AI cost/i
      const unbound = /no single page/i
      if (s.payer === 'page') {
        expect(text, `${s.upstream} passes a pageID, so the charge moves this page's own AI cost`)
          .toMatch(bound)
        expect(text, `${s.name} must not also disclaim the page it IS attributed to`)
          .not.toMatch(unbound)
      } else {
        expect(text, `${s.upstream} binds no page, so the charge reaches no page's AI cost`)
          .toMatch(unbound)
        expect(text, `${s.name} bills the workspace and must NOT claim it moves a page's AI cost`)
          .not.toMatch(bound)
      }
    })
  }
})
