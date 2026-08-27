import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AISummary } from './AISummary'
import { FindDuplicates } from './FindDuplicates'
import { SearchIssues } from './SearchIssues'
import { TriageIssue } from './TriageIssue'

// meteredCostCensus.test.tsx — every TRACK surface that SPENDS must tell the reader it spent,
// and must name the right payer.
//
// ── WHY THIS FILE EXISTS, AND WHAT BOTH EXISTING GUARDS COULD NOT SEE ────────
//
// W1.7's third bullet is "SHOW WHAT IT COST." Two guards enforce it today and NEITHER can see
// this card:
//
//   · areas/docs/meteredCostCensus.test.tsx is a census, and its population is `areas/docs`. Its
//     own header names the boundary problem — "that guard's population is three file names in
//     another directory … it cannot see this directory at all" — about the Track guard below.
//     It has the mirror-image boundary itself.
//   · areas/track/aiCostClaim.test.tsx enumerates THREE FILE-NAME LITERALS: AISummary.tsx,
//     FindDuplicates.tsx, TriageIssue.tsx.
//
// MEASURED at main `16d2218`: Track has FOUR browser-reachable surfaces whose use bills Lens.
// Three print a sentence. The fourth — SearchIssues, mounted on /track at TrackArea.tsx:110 —
// printed NOTHING, while its own file header carried a paragraph titled "⚠ WHAT IT COSTS"
// stating the fact in full. That is the SearchDocs defect (#240) one directory over, found the
// same way and hidden by the same thing: a population that is a list of names.
//
// ── THE POPULATION, AND WHAT PUTS A SURFACE IN IT ────────────────────────────
//
// A surface is IN if a use of it causes talyvor-track to bill Lens. Measured READ-ONLY against
// talyvor-track `bfc55740b52bef4eca743e3aa73e45d9904d4d3e` (held by tab-5b91, never written to),
// from source rather than from these components' comments — `X-Talyvor-Feature` is set from the
// `featureID` argument in both call paths (engine.go:213 completions, engine.go:263 embeddings):
//
//   internal/ai/engine.go:320  TriageIssue    → callAnthropicViaLens(…, issue.Identifier, …)
//   internal/ai/engine.go:373  FindDuplicates → callAnthropicViaLens(…, issue.Identifier, …)
//   internal/ai/engine.go:455  SummarizeThread→ callAnthropicViaLens(…, issue.Identifier, …)
//   internal/ai/engine.go:557  SemanticSearch → callEmbeddingsViaLens(…, "track-search", query)
//
// ⚠⚠ THE FOURTH ROW IS BILLED TO A DIFFERENT PAYER, AND THAT IS WHY A SHARED SENTENCE WOULD NOT
// HAVE FIXED IT. The first three pass the ISSUE'S OWN IDENTIFIER as the Lens feature tag, so
// `meteredCallCopy`'s "the charge is attributed to this issue" is true of them. Search passes the
// static tag `track-search` and no issue exists to charge — the embedding is of the QUERY. Pasting
// the shared sentence onto the search card would have satisfied a "does it say something about
// money" test while telling the reader the workspace's search spend lands on a ticket. The census
// is therefore keyed on the PAYER, which is the fact the upstream call site actually establishes.
//
// ⚠ ONE MORE TRACK SURFACE SPENDS AND IS DELIBERATELY OUT, NAMED RATHER THAN OMITTED:
// `engine.go:525` sprint planning, tag `track-sprint-planning`. This app mounts no route and no
// component for it, so it has no reader to tell. A surface excluded silently is indistinguishable
// from one forgotten — which is exactly how SearchIssues was missed.
//
// ⚠ THE `upstream` COLUMN IS A CLAIM ABOUT ANOTHER REPO AND NOTHING HERE ASKS IT. The only
// assertion this file makes about it is a shape. Measured read-only at talyvor-track `b2f282e`
// (tab-p9r4, W1.7.1): the first row named `Engine.Triage` and talyvor-track declares
// `TriageIssue` — zero declarations of `Engine.Triage`, at HEAD and at the SHA above, so it was
// never right rather than drifted. Corrected in place. ⚠ THE FOUR LINE NUMBERS ARE CORRECT AND
// THAT IS WORTH SAYING, because the obvious way to check them is wrong: they point at the
// `callAnthropicViaLens` / `callEmbeddingsViaLens` CALL lines, exactly as the arrows above say,
// NOT at the `func` declarations — which sit at 315/349/428/548 and make all four look stale to a
// reader who compares the wrong thing. `deploy/decision-expiry.sh` now carries a `cannot` entry
// that settles the declarations and the payer split against a talyvor-track checkout.
//
// ⚠ THE FLOOR IS A LITERAL. `EXPECTED_METERED` is 4, typed out, never `METERED.length` — a floor
// derived from the list it guards moves when someone deletes a row, which is the one direction a
// census exists to refuse. The docs census measured that as its C9 control; the same control is
// run here rather than inherited.

type Attribution = 'issue' | 'workspace'

const ISSUE = 'iss-7'

/** One BFF for the whole census. Every metered route answers, so a card that asks for the wrong
 *  one fails loudly rather than sitting in an unasked state that would sail through an assertion
 *  about a sentence. */
function mockBff() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    if (url.endsWith(`/api/track/issues/${ISSUE}/summary`)) return json({ summary: 'a summary' })
    if (url.endsWith(`/api/track/issues/${ISSUE}/find-duplicates`)) return json([])
    if (url.endsWith(`/api/track/issues/${ISSUE}/triage`)) return json({ priority: 2, labels: [] })
    if (url.startsWith('/api/track/issues/search?')) return json([])
    return json({ error: 'no such endpoint' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
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

/**
 * Every Track surface whose use bills Lens, the payer the upstream call site establishes, and the
 * site itself.
 *
 * ⚠ THE STATE ASSERTED IS THE ONE WHERE THE READER MEETS THE CONTROL — mount, before the spend.
 * TriageIssue's own comment says why the sibling cards do it there: the charge "is a property of
 * the button and not of the answer". A cost sentence a reader can only reach AFTER paying is a
 * receipt, not a price.
 */
const METERED: {
  name: string
  attribution: Attribution
  /** The Lens feature tag, WHEN it is a constant a reader could look up in the ledger. `null` for
   *  the three issue surfaces on purpose: their tag is the issue's own `Identifier`, chosen per
   *  request upstream, so there is no literal for this app to print or for a test to pin. That is
   *  a property of the call site, not an omission — see the header's table. */
  tag: string | null
  upstream: string
  node: React.ReactNode
}[] = [
  {
    name: 'AISummary',
    attribution: 'issue',
    tag: null,
    upstream: 'internal/ai/engine.go:455#Engine.SummarizeThread',
    node: <AISummary issueId={ISSUE} />,
  },
  {
    name: 'FindDuplicates',
    attribution: 'issue',
    tag: null,
    upstream: 'internal/ai/engine.go:373#Engine.FindDuplicates',
    node: <FindDuplicates issueId={ISSUE} />,
  },
  {
    name: 'TriageIssue',
    attribution: 'issue',
    tag: null,
    upstream: 'internal/ai/engine.go:320#Engine.TriageIssue',
    node: <TriageIssue issueId={ISSUE} />,
  },
  {
    name: 'SearchIssues',
    attribution: 'workspace',
    tag: 'track-search',
    upstream: 'internal/ai/engine.go:557#Engine.SemanticSearch',
    node: <SearchIssues />,
  },
]

/** ⚠ A LITERAL. Never METERED.length — see the header. */
const EXPECTED_METERED = 4

describe('every metered Track surface tells the reader it spent', () => {
  it(`the population is ${EXPECTED_METERED} surfaces, each naming the upstream call that bills`, () => {
    expect(METERED).toHaveLength(EXPECTED_METERED)
    for (const s of METERED) {
      expect(s.upstream, `${s.name} must name the upstream site that makes it metered`).toMatch(
        /^internal\/ai\/engine\.go:\d+#Engine\./,
      )
    }
    // Both payers are represented. A census that drifted to one kind would stop being able to
    // catch the confusion between them, which is the defect this file was written for.
    expect(new Set(METERED.map((s) => s.attribution))).toEqual(new Set(['issue', 'workspace']))
    // A constant tag belongs to exactly one surface: the tag is what separates one charge from
    // another in the workspace's Lens ledger, so two screens carrying one tag would point a
    // reader at a single line and each call it theirs.
    const tags = METERED.map((s) => s.tag).filter((t): t is string => t !== null)
    expect(new Set(tags).size).toBe(tags.length)
  })

  for (const s of METERED) {
    // The tag is pulled into a const so the null check narrows INSIDE the closure below — reading
    // `s.tag` there is `string | null` again, and a non-null assertion would be this file telling
    // the type system something it declined to check.
    const tag = s.tag
    if (tag === null) continue
    it(`${s.name} prints the ledger tag ${tag} the charge will appear under`, () => {
      mockBff()
      renderIn(s.node)
      // ⚠ THE TAG IS THE JOIN KEY, NOT A LABEL. "This costs money" without it leaves the reader no
      // way to find the charge in the Lens ledger, and a WRONG tag points them at someone else's
      // line. It is rendered in a <code> element, so it is its own text node.
      expect(
        screen.getByText(tag),
        `${s.name} bills under ${tag} (${s.upstream}) and must name it`,
      ).toBeInTheDocument()
    })
  }

  for (const s of METERED) {
    it(`${s.name} says the call is metered before the reader spends`, () => {
      mockBff()
      renderIn(s.node)
      expect(
        document.body.textContent,
        `${s.name} bills Lens (${s.upstream}) and must say so where the button is — ` +
          `a screen that offers a metered call without saying it is metered is the defect ` +
          `W1.7's third bullet names`,
      ).toMatch(/metered/i)
    })
  }

  for (const s of METERED) {
    it(`${s.name} names the payer its upstream call site actually establishes: the ${s.attribution}`, () => {
      mockBff()
      renderIn(s.node)
      const text = document.body.textContent ?? ''
      if (s.attribution === 'issue') {
        expect(text, `${s.upstream} passes issue.Identifier as the Lens feature tag`).toMatch(
          /attributed to this issue/i,
        )
      } else {
        // ⚠ BOTH HALVES. "Billed to this workspace" alone would still be satisfied by a card that
        // also said the charge lands on a ticket; the search embedding is of the QUERY and there
        // is no issue to charge, so the absence has to be stated as well as the payer.
        expect(text, `${s.upstream} passes the static tag track-search, not an issue`).toMatch(
          /billed to this workspace/i,
        )
        expect(text, `${s.name} must say the charge reaches NO issue`).toMatch(/no issue/i)
        expect(
          text,
          `${s.name} must not borrow meteredCallCopy — that sentence's payer is the issue`,
        ).not.toMatch(/attributed to this issue/i)
      }
    })
  }
})
