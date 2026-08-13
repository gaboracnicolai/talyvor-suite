import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentFacts, DistillChoice } from './Documents'

// Documents.test.tsx — the distill disclosure and its off switch.
//
// ⚠ WHY THIS EXISTS. DefaultDistillPolicy is DistillAlways: every workspace has distill_policy =
// 'always', so a customer attaching a PDF is ALREADY having it converted, and nothing in the
// product said so. A scanned document goes further — it is sent to a VISION MODEL to be read.
// The route to turn it off (PUT /v1/workspaces/{wsID}/distill) has been live the whole time with
// nothing calling it.
//
// These assert RENDERED TEXT and the RECORDED state, because the claim is about what a person can
// see and what Lens actually stored — not about what a request was sent.

const usage = { distill_policy: 'always', converted: 12, vision_ocr: 3, days: 30 }

/**
 * The BFF's answer when Lens could not be read: the SETTING is owed and still arrives, and the
 * three count keys are ABSENT rather than zero. apps/bff/distill_test.go
 * TestDistillUsageUnwiredIsNotReportedAsCounts pins the server half of this exact body.
 */
function mockBffWithoutCounts() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (b: unknown, status = 200) =>
      new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/api/distill' && (init?.method ?? 'GET') === 'GET') {
      return json({ distill_policy: 'always' })
    }
    return json(null, 404)
  })
}

// ⚠ THE MOCK IS STATEFUL ON PURPOSE. A POST that "succeeds" while GET keeps returning the old
// policy would let a component pass by echoing the click. Here the write moves the stored state and
// the read serves it, so the assertion below can only pass if the screen genuinely RE-READS what
// was recorded — which is the property being claimed.
function mockBff(over: Partial<typeof usage> = {}, opts: { failWrite?: boolean } = {}) {
  const state = { ...usage, ...over }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (b: unknown, status = 200) =>
      new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/api/distill' && (init?.method ?? 'GET') === 'GET') return json(state)
    if (url === '/api/distill' && init?.method === 'POST') {
      // A failed write must leave the stored state untouched — that is what "nothing changed" means.
      if (opts.failWrite) return json({ error: 'nope' }, 502)
      const asked = JSON.parse(String(init?.body ?? '{}')) as { distill_policy?: string }
      state.distill_policy = (asked.distill_policy ?? state.distill_policy) as typeof state.distill_policy
      return json({ distill_policy: state.distill_policy })
    }
    return json(null, 404)
  })
}

function renderChoice() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <DistillChoice />
    </QueryClientProvider>,
  )
}

beforeEach(() => mockBff())
afterEach(() => vi.restoreAllMocks())

describe('the disclosure states what happens to an attached document', () => {
  // Asserts the rendered TEXT rather than a DOM node: the copy emphasises phrases with <strong>,
  // which splits the text node, and a query that fails on element boundaries would be failing for
  // a reason that has nothing to do with what the reader can see.
  function factsText() {
    return render(<DocumentFacts />).container.textContent ?? ''
  }

  it('says a document is converted to Markdown before the model sees it', () => {
    expect(factsText()).toMatch(/converts it to Markdown before the model sees it/i)
  })

  // The saving is the reason it is on by default, so it is stated — but as a consequence, not a sale.
  it('says the conversion lowers the charge', () => {
    expect(factsText()).toMatch(/lowers what you are charged/i)
  })

  // ⚠ THE PART A READER WOULD NOT GUESS: a scanned document is sent to a vision model.
  it('says a scanned document is sent to a vision model to be read', () => {
    expect(factsText()).toMatch(/vision model/i)
  })

  it('says it is on unless turned off', () => {
    expect(factsText()).toMatch(/on for this workspace unless you turn it off/i)
  })
})

describe('the off switch', () => {
  it('states the policy Lens currently has, before offering the buttons', async () => {
    const { container } = renderChoice()
    await screen.findByRole('button', { name: /do not convert/i })
    await waitFor(() => expect(container.textContent ?? '').toMatch(/currently on for this workspace/i))
  })

  // ⚠ THE RECORDED STATE, NOT THE REQUESTED ONE. The screen must re-read what Lens stored; an
  // optimistic echo would show "off" even if Lens refused the write.
  it('renders what Lens recorded after turning it off', async () => {
    const { container } = renderChoice()
    fireEvent.click(await screen.findByRole('button', { name: /do not convert/i }))
    await waitFor(() => expect(container.textContent ?? '').toMatch(/currently off for this workspace/i))
  })

  it('says nothing changed when the write fails, rather than showing the new state', async () => {
    mockBff({}, { failWrite: true })
    const { container } = renderChoice()
    fireEvent.click(await screen.findByRole('button', { name: /do not convert/i }))
    expect(await screen.findByText(/did not save/i)).toBeInTheDocument()
    expect(container.textContent ?? '').toMatch(/currently on for this workspace/i)
  })
})

describe('the evidence is a count of documents, never a saving', () => {
  it('shows how many documents were converted', async () => {
    renderChoice()
    expect(await screen.findByText(/12 documents/i)).toBeInTheDocument()
  })

  // ⚠ vision_ocr IS A COST, not a saving, so it is counted separately and never summed in.
  it('counts vision-read documents separately from converted ones', async () => {
    renderChoice()
    expect(await screen.findByText(/3 .*vision|vision model.*3/i)).toBeInTheDocument()
    expect(screen.queryByText(/15 documents/i)).not.toBeInTheDocument()
  })

  // ⚠ NO DOLLAR FIGURE. The savings metric reads 0 for every format except HTML at the tier the
  // request path uses, so any money number here would be invented.
  it('states no money figure', async () => {
    const { container } = renderChoice()
    await screen.findByText(/12 documents/i)
    expect(container.textContent ?? '').not.toMatch(/\$\s?\d/)
  })

  // A workspace that has converted nothing must not render "0 documents" as though it were a
  // finding — and must not imply the feature is off.
  it('says nothing about counts when there are none', async () => {
    mockBff({ converted: 0, vision_ocr: 0 })
    const { container } = renderChoice()
    await waitFor(() => expect(container.textContent ?? '').toMatch(/currently on for this workspace/i))
    expect(container.textContent ?? '').not.toMatch(/0 documents/i)
  })

  // ⚠ A STATE THIS SCREEN COULD NOT BE SHOWN UNTIL NOW, WHICH IS WHY IT HAD NO TEST. Lens answers
  // 503 ("not wired") rather than 200-with-a-zero on /distill/usage so that an absent reader and a
  // workspace that converted nothing do not render identically; the BFF flattened that into
  // converted:0, vision_ocr:0, days:0, so the keys were ALWAYS present and this fixture was
  // unreachable.
  //
  // ⚠ AND THIS TEST IS HONEST ABOUT WHAT IT DOES NOT SEE. It passed on its FIRST run, which is a
  // reason to distrust it, so it was measured: with the renderer put back to reading the fields
  // directly it is still GREEN, because `undefined > 0` is false and the screen was already drawing
  // nothing by accident (w11-distill-unwired-controls-9d4c.py P4). The web change is a TYPE
  // correction, not a behaviour fix. What this DOES catch is the rendered hole below.
  //
  // The screen still draws nothing, deliberately: whether the panel should SAY "this deployment
  // cannot count documents" is a product decision and not this diff's. What is fixed is that the
  // fact survives as far as the screen, so that decision is now available to make.
  it('draws no count line, and no half-sentence, when the counts were never read', async () => {
    mockBffWithoutCounts()
    const { container } = renderChoice()
    await waitFor(() => expect(container.textContent ?? '').toMatch(/currently on for this workspace/i))
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/documents converted/i)
    expect(text).not.toMatch(/vision model\./i)
    // The failure this guards is not a missing line but a rendered HOLE: reading `days` on its own
    // gives "in the last  days" with nothing in it, which reads as a bug in the product rather
    // than as an unwired reader. usageOf makes that unrepresentable; P5 is the control that this
    // assertion is live rather than decorative.
    expect(text).not.toMatch(/in the last\s+days/i)
    expect(text).not.toMatch(/undefined/i)
    expect(text).not.toMatch(/NaN/)
  })
})
