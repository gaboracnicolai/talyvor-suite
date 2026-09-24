import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { focusRing } from '@talyvor/ui'
import { DocsArea } from './DocsArea'

// docsWrites.test.tsx — the Docs area's WRITE half, which nothing executed.
//
// ⚠ WHY THIS FILE EXISTS, MEASURED RATHER THAN GUESSED. v8 coverage over the WHOLE apps/web
// suite (1189 tests, 93 files) reported these eight functions with ZERO executions:
//
//   areas/docs/api.ts        createPage, updatePage
//   areas/docs/SpaceView.tsx the create form's mutationFn, onSuccess, onSubmit, onChange
//   areas/docs/PageView.tsx  the save mutationFn, onSuccess, and the Save onClick
//
// Every read on these three screens was driven; not one write was. That is the structural
// reason the queue's standing finding about this editor (it PATCHes content_text, the SEARCH
// PROJECTION, rather than the document) had to be found by reading three repositories: no test
// in this one ever sent the request, so no test in this one could have looked at it.
//
// These cases drive the requests themselves and read what goes on the wire.
//
// ⚠ B2.1 SETTLED THE PAGE PATCH'S BODY, SO IT IS NOW PINNED: `content`, the ProseMirror document.
// The textarea this replaced sent `content_text` alone — the search projection — so the document
// itself never moved and Docs appended no version.

const SPACES = [
  {
    id: 'sp eng',
    workspace_id: 'default',
    name: 'Engineering',
    slug: 'engineering',
    description: 'How we build',
    icon: '📘',
    color: '#0B7A85',
    private: false,
    created_by: 'm-1',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
  },
]

type Call = { url: string; method: string; body: unknown }

/**
 * A Docs upstream that answers the four routes these screens use and RECORDS every call.
 *
 * `pageText` is a queue: each GET of the page detail shifts the next value, so a test can make
 * the server's answer CHANGE across a save — which is the only way to tell a screen that re-reads
 * from one that renders what was typed at it.
 */
/** A Docs `content` string: a doc of paragraphs. */
function pm(...paras: string[]): string {
  return JSON.stringify({
    type: 'doc',
    content: paras.map((t) => (t === '' ? { type: 'paragraph' } : { type: 'paragraph', content: [{ type: 'text', text: t }] })),
  })
}

/** The editor, and a way to type into it: ProseMirror reads DOM edits through its MutationObserver. */
async function editor() {
  return screen.findByRole('textbox', { name: 'Content' })
}
function typeInto(ed: HTMLElement, text: string) {
  const p = ed.querySelector('p')
  if (p === null) throw new Error('no paragraph to type into')
  if (p.firstChild === null) p.appendChild(document.createTextNode(text))
  else p.firstChild.textContent = text
}

function mockDocs(opts: {
  /** Successive answers to the page read, as Docs `content` strings (see pm()). */
  pageText: string[]
  pages?: Array<{ id: string; title: string }>
  patchStatus?: number
  postStatus?: number
}) {
  const calls: Call[] = []
  const text = [...opts.pageText]
  let last = text[0] ?? ''
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const raw = init?.body
    calls.push({ url, method, body: typeof raw === 'string' ? JSON.parse(raw) : raw })

    if (url === '/api/docs/spaces') return json(SPACES)
    if (url === '/api/docs/spaces/sp%20eng/pages') {
      if (method === 'POST') {
        if ((opts.postStatus ?? 200) !== 200) return json({ error: 'nope' }, opts.postStatus)
        return json({ id: 'pg-new', title: 'made' })
      }
      return json(opts.pages ?? [])
    }
    if (url === '/api/docs/spaces/sp%20eng/pages/pg-1') {
      if (method === 'PATCH') {
        if ((opts.patchStatus ?? 200) !== 200) return json({ error: 'nope' }, opts.patchStatus)
        return json({ id: 'pg-1', title: 'First page' })
      }
      if (text.length > 0) last = text.shift() as string
      return json({ id: 'pg-1', title: 'First page', content: last, content_text: plain(last) })
    }
    if (url === '/api/docs/pages/pg-1/summarize') return json({ text: '• a summary' })
    return new Response('null', { status: 404 })
  })
  return calls
}

/** Docs' content_text: the document's text, a line per block. */
function plain(content: string): string {
  const doc = JSON.parse(content) as { content?: Array<{ content?: Array<{ text?: string }> }> }
  return (doc.content ?? []).map((b) => (b.content ?? []).map((t) => t.text ?? '').join('')).join('\n')
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/docs/*" element={<DocsArea />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const PAGE_URL = '/docs/spaces/sp eng/pages/pg-1'
const SPACE_URL = '/docs/spaces/sp eng'

afterEach(() => vi.restoreAllMocks())

// jsdom has no layout, and ProseMirror measures a Range when it scrolls a change into view. An
// empty rect list is what an unlaid-out range honestly has; without it the scroll throws.
if (typeof Range.prototype.getClientRects !== 'function') {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
}

describe('the page editor (B2.1)', () => {
  it('opens the stored DOCUMENT, with its structure, not a flattened projection', async () => {
    const doc = JSON.stringify({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Runbook' }] },
        { type: 'bullet_list', content: [{ type: 'list_item', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'restart it' }] }] }] },
      ],
    })
    mockDocs({ pageText: [doc] })
    renderAt(PAGE_URL)
    const ed = await editor()
    await waitFor(() => expect(ed.querySelector('h2')?.textContent).toBe('Runbook'))
    expect(ed.querySelector('ul li')?.textContent).toBe('restart it')
  })

  // The body is the document. `content_text` is Docs' projection of it, derived on this write.
  it('saves what was typed as the DOCUMENT — `content`, never `content_text`', async () => {
    const calls = mockDocs({ pageText: [pm('one')] })
    renderAt(PAGE_URL)
    const ed = await editor()
    await waitFor(() => expect(ed.textContent).toBe('one'))

    typeInto(ed, 'one, edited')
    await waitFor(() => expect(screen.getByText('Unsaved changes')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1))
    const patch = calls.find((c) => c.method === 'PATCH')
    expect(patch?.url).toBe('/api/docs/spaces/sp%20eng/pages/pg-1')
    const body = patch?.body as Record<string, unknown>
    expect(Object.keys(body)).toEqual(['content'])
    expect(JSON.parse(String(body.content))).toEqual(JSON.parse(pm('one, edited')))
  })

  it('shows what Docs RECORDED after a save, when that differs from what was sent', async () => {
    const calls = mockDocs({ pageText: [pm('from the server'), pm('WHAT DOCS RECORDED')] })
    renderAt(PAGE_URL)
    const ed = await editor()
    await waitFor(() => expect(ed.textContent).toBe('from the server'))

    typeInto(ed, 'what the person typed')
    await waitFor(() => expect(screen.getByText('Unsaved changes')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Content' })).textContent).toBe('WHAT DOCS RECORDED'))
    expect(calls.filter((c) => c.url.endsWith('/pages/pg-1') && c.method === 'GET')).toHaveLength(2)
    expect(screen.getByText('Saved.')).toBeTruthy()
  })

  // Mod-S is how people who write save.
  it('saves on Mod-S', async () => {
    const calls = mockDocs({ pageText: [pm('one')] })
    renderAt(PAGE_URL)
    const ed = await editor()
    await waitFor(() => expect(ed.textContent).toBe('one'))
    typeInto(ed, 'two')
    await waitFor(() => expect(screen.getByText('Unsaved changes')).toBeTruthy())
    fireEvent.keyDown(ed, { key: 's', ctrlKey: true })
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1))
  })

  // ⚠ THE SUMMARY IS OF THE PAGE AS STORED, AND THAT IS WHAT MAKES ITS COST SENTENCE TRUE. Docs
  // binds this completion's cost to page pg-1, so the bytes sent have to be that page's bytes, not
  // the unsaved keystrokes in the editor.
  it('summarises the page as STORED, not the unsaved keystrokes in the editor', async () => {
    const calls = mockDocs({ pageText: [pm('the text Docs has stored')] })
    renderAt(PAGE_URL)
    const ed = await editor()
    await waitFor(() => expect(ed.textContent).toBe('the text Docs has stored'))
    typeInto(ed, 'unsaved keystrokes nobody has stored')
    await waitFor(() => expect(screen.getByText('Unsaved changes')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /summarise this page/i }))

    await waitFor(() =>
      expect(calls.filter((c) => c.url === '/api/docs/pages/pg-1/summarize')).toHaveLength(1),
    )
    const post = calls.find((c) => c.url === '/api/docs/pages/pg-1/summarize')
    expect(post?.body).toEqual({ text: 'the text Docs has stored' })
  })

  // A failed write must say so AND leave the words on screen — they are the only copy.
  it('a refused save states it and keeps the draft', async () => {
    mockDocs({ pageText: [pm('one')], patchStatus: 502 })
    renderAt(PAGE_URL)
    const ed = await editor()
    await waitFor(() => expect(ed.textContent).toBe('one'))

    typeInto(ed, 'still mine')
    await waitFor(() => expect(screen.getByText('Unsaved changes')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/Couldn’t save/)).toBeTruthy()
    expect(ed.textContent).toBe('still mine')
  })
})

describe('the draft belongs to one page', () => {
  /** A second page on the same space, and a way to reach it without going up through the space. */
  function mockTwoPages() {
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url === '/api/docs/spaces') return json(SPACES)
      if (url === '/api/docs/spaces/sp%20eng/pages/pg-1')
        return json({ id: 'pg-1', title: 'First page', content: pm('ONE'), content_text: 'ONE' })
      if (url === '/api/docs/spaces/sp%20eng/pages/pg-2')
        return json({ id: 'pg-2', title: 'Second page', content: pm('TWO'), content_text: 'TWO' })
      return new Response('null', { status: 404 })
    })
  }

  function Jump() {
    const navigate = useNavigate()
    return (
      <button className={focusRing} onClick={() => navigate('/docs/spaces/sp eng/pages/pg-2')}>
        jump
      </button>
    )
  }

  // ⚠ THE ROUTE IS THE SAME ROUTE. React Router matches both pages to one <Route> element, so
  // PageView is NOT remounted when only :pageId changes. The editor is keyed by page, so page B
  // opens B's document — never A's edits under B's title, which Save would then write INTO B.
  it('a different page gets a different draft, not the last one’s text', async () => {
    mockTwoPages()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[PAGE_URL]}>
          <Jump />
          <Routes>
            <Route path="/docs/*" element={<DocsArea />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const ed = await editor()
    await waitFor(() => expect(ed.textContent).toBe('ONE'))
    typeInto(ed, 'ONE, edited')
    await waitFor(() => expect(screen.getByText('Unsaved changes')).toBeTruthy())

    fireEvent.click(screen.getByText('jump'))
    await screen.findByText('Second page')

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Content' }).textContent).toBe('TWO'))
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true)
  })
})

describe('the create-page form', () => {
  it('POSTs the title to the space it is looking at', async () => {
    const calls = mockDocs({ pageText: [], pages: [] })
    renderAt(SPACE_URL)

    const input = await screen.findByLabelText('Page title')
    fireEvent.change(input, { target: { value: 'Runbook' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create page' }))

    await waitFor(() => {
      const post = calls.filter((c) => c.method === 'POST')
      expect(post).toHaveLength(1)
      expect(post[0].url).toBe('/api/docs/spaces/sp%20eng/pages')
      expect(post[0].body).toEqual({ title: 'Runbook' })
    })
  })

  // A title of spaces is not a title. Refused HERE, before any dial — and the refusal is silent
  // rather than an error, because nothing failed.
  it('does not dial for a whitespace-only title', async () => {
    const calls = mockDocs({ pageText: [], pages: [] })
    renderAt(SPACE_URL)

    const input = await screen.findByLabelText('Page title')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create page' }))

    await waitFor(() => expect(screen.getByLabelText('Page title')).toBeTruthy())
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0)
  })

  it('trims the title it sends', async () => {
    const calls = mockDocs({ pageText: [], pages: [] })
    renderAt(SPACE_URL)

    const input = await screen.findByLabelText('Page title')
    fireEvent.change(input, { target: { value: '  Runbook  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create page' }))

    await waitFor(() => {
      const post = calls.filter((c) => c.method === 'POST')
      expect(post).toHaveLength(1)
      expect(post[0].body).toEqual({ title: 'Runbook' })
    })
  })

  it('clears the box and refetches the list, so the new page appears', async () => {
    const calls = mockDocs({ pageText: [], pages: [{ id: 'pg-new', title: 'Runbook' }] })
    renderAt(SPACE_URL)

    const input = (await screen.findByLabelText('Page title')) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Runbook' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create page' }))

    await waitFor(() => expect(input.value).toBe(''))
    await waitFor(() =>
      expect(calls.filter((c) => c.url.endsWith('/pages') && c.method === 'GET').length).toBeGreaterThan(1),
    )
    expect(await screen.findByRole('link', { name: 'Runbook' })).toBeTruthy()
  })

  // The mirror of the save refusal: the words survive a failed create, and the screen says the
  // create did not happen rather than leaving an empty box that reads like success.
  it('a refused create states it and keeps the typed title', async () => {
    mockDocs({ pageText: [], pages: [], postStatus: 500 })
    renderAt(SPACE_URL)

    const input = (await screen.findByLabelText('Page title')) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Runbook' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create page' }))

    expect(await screen.findByText(/Couldn’t create that page/)).toBeTruthy()
    expect(input.value).toBe('Runbook')
  })
})

// ⚠ THE THIRD INSTANCE OF THE SHAPE, AND THE ONE A CENSUS FOUND RATHER THAN A READER.
//
// `/docs/spaces/:spaceId` is ONE <Route> element, so moving from space A to space B changes
// `spaceId` underneath SpaceView and does NOT remount it — `useState` survives, exactly as it
// does one level down in PageView ('the draft belongs to one page', above) and in Track's
// IssueDetail. The two of those were each found by someone already reading the file. This one
// was found by asking the general question of every route in the app: which <Route> elements
// read a param AND hold state? There are three, and this was the unguarded one.
//
// MEASURED before it was fixed, not reasoned about — with 'A title meant for AAA' typed into
// space A's create form, arriving at space B and pressing Create page sent
//
//     POST /api/docs/spaces/sp-b/pages {"title":"A title meant for AAA"}
//
// — a page created in the WRONG SPACE under a title meant for another, from a button the reader
// had every reason to press. The refusal sentence about A stayed on screen over B as well.
//
// ⚠ NOT REACHABLE FROM THIS UI TODAY, and fixed anyway, for the same stated reason as the other
// two: nothing on this screen links to a sibling space (Back and the crumbs both go up to /docs
// and DO remount). A space switcher in the sidebar, a recent-spaces list or a search result makes
// it live, and whoever adds one has no reason to suspect this file. The failure is in the
// COMPONENT, not in the absence of a link — which is what these cases show by supplying one.
describe('the create form belongs to one space', () => {
  const SPACES2 = [
    { ...SPACES[0], id: 'sp-a', name: 'Space AAA', slug: 'a' },
    { ...SPACES[0], id: 'sp-b', name: 'Space BBB', slug: 'b' },
  ]

  /** Two spaces, and a way to reach the second without going up through the space list. */
  function mockTwoSpaces(postStatus = 200) {
    const calls: Call[] = []
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      const raw = init?.body
      calls.push({ url, method, body: typeof raw === 'string' ? JSON.parse(raw) : raw })
      if (url === '/api/docs/spaces') return json(SPACES2)
      if (url.endsWith('/pages') && method === 'POST') {
        return postStatus === 200 ? json({ id: 'pg-new', title: 'made' }) : json({ error: 'nope' }, postStatus)
      }
      if (url.endsWith('/pages')) return json([])
      return new Response('null', { status: 404 })
    })
    return calls
  }

  function renderTwoSpaces() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    function Jump() {
      const navigate = useNavigate()
      // `focusRing` because src/focusAudit.ts sweeps the live DOM at teardown and a bare
      // focusable control in a fixture fails the test that renders it.
      return (
        <button className={focusRing} onClick={() => navigate('/docs/spaces/sp-b')}>
          go to B
        </button>
      )
    }
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/docs/spaces/sp-a']}>
          <Jump />
          <Routes>
            <Route path="/docs/*" element={<DocsArea />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  const heading = (name: string) => screen.findByRole('heading', { name })

  it('a title typed in one space is never created in another', async () => {
    const calls = mockTwoSpaces()
    renderTwoSpaces()
    await heading('Space AAA')

    fireEvent.change(await screen.findByLabelText('Page title'), {
      target: { value: 'A title meant for AAA' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'go to B' }))
    await heading('Space BBB')

    // The reader is on B. Whatever the box is showing must not be A's words — and the create
    // a reader would now reach for must not carry them either.
    const box = screen.getByLabelText('Page title') as HTMLInputElement
    expect(box.value).not.toContain('AAA')

    fireEvent.change(box, { target: { value: 'B’s own page' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create page' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    const post = calls.find((c) => c.method === 'POST')!
    expect(post.url).toBe('/api/docs/spaces/sp-b/pages')
    expect((post.body as { title: string }).title).not.toContain('AAA')
  })

  it('a refusal about one space is not still on screen over another', async () => {
    mockTwoSpaces(500)
    renderTwoSpaces()
    await heading('Space AAA')

    fireEvent.change(await screen.findByLabelText('Page title'), { target: { value: 'doomed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create page' }))
    expect(await screen.findByText(/Couldn’t create that page/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'go to B' }))
    await heading('Space BBB')
    expect(screen.queryByText(/Couldn’t create that page/)).toBeNull()
  })

  // ⚠ THE OTHER DIRECTION, AND IT IS LOAD-BEARING. A component that threw this state away on
  // every render would pass both cases above and be useless: typing into the create form must
  // survive an ordinary re-render of the SAME space, or the reset is a keystroke eater rather
  // than a boundary.
  it('MUST STAY GREEN — typing in the space you are on is not disturbed', async () => {
    const calls = mockTwoSpaces()
    renderTwoSpaces()
    await heading('Space AAA')

    const box = (await screen.findByLabelText('Page title')) as HTMLInputElement
    fireEvent.change(box, { target: { value: 'Still typing in AAA' } })
    expect(box.value).toBe('Still typing in AAA')

    fireEvent.click(screen.getByRole('button', { name: 'Create page' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    const post = calls.find((c) => c.method === 'POST')!
    expect(post.url).toBe('/api/docs/spaces/sp-a/pages')
    expect((post.body as { title: string }).title).toBe('Still typing in AAA')
  })
})

describe('the AI cost readout, pinned where you write (B2.2)', () => {
  /** A page whose AI totals change across reads — Docs' sweep pricing an action between them. */
  function mockCostedPage(totals: Array<{ own: number; issues: number }>) {
    const queue = [...totals]
    let now = queue[0]
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    const reads = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url === '/api/docs/spaces') return json(SPACES)
      if (url === '/api/docs/spaces/sp%20eng/pages/pg-1') {
        reads()
        if (queue.length > 0) now = queue.shift() as { own: number; issues: number }
        return json({
          id: 'pg-1',
          title: 'First page',
          content: pm('words'),
          content_text: 'words',
          own_ai_cost_usd: now.own,
          ai_cost_usd: now.issues,
          total_ai_cost_usd: now.own + now.issues,
        })
      }
      if (url === '/api/docs/pages/pg-1/summarize') return json({ text: '• a summary' })
      return new Response('null', { status: 404 })
    })
    return reads
  }

  it('shows the page’s total AI cost in the editor’s toolbar, and what it is made of', async () => {
    mockCostedPage([{ own: 0.012, issues: 0.03 }])
    renderAt(PAGE_URL)
    const readout = await screen.findByTestId('page-ai-cost')
    await waitFor(() => expect(readout.textContent).toBe('AI on this page $0.04'))
    // Pinned in the editor itself — the sticky toolbar row the writing surface sits under.
    expect(readout.closest('.sticky')?.querySelector('[role="toolbar"]')).toBeTruthy()
    expect(screen.getByText(/from AI actions on/).textContent).toMatch(
      /\$0\.01 from AI actions on\s+this page, \$0\.03 from its linked\s+Track issues\./,
    )
  })

  it('after an AI action, re-reads the page until Docs has priced it, then shows the new total', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const reads = mockCostedPage([
        { own: 0, issues: 0 },
        { own: 0.02, issues: 0 },
      ])
      renderAt(PAGE_URL)
      const readout = await screen.findByTestId('page-ai-cost')
      await waitFor(() => expect(readout.textContent).toBe('No AI spend recorded on this page'))

      fireEvent.click(screen.getByRole('button', { name: /summarise this page/i }))
      await waitFor(() => expect(readout.textContent).toContain('pricing the last AI action'))

      await vi.advanceTimersByTimeAsync(20_000)
      await waitFor(() => expect(screen.getByTestId('page-ai-cost').textContent).toBe('AI on this page $0.02'))
      expect(reads.mock.calls.length).toBeGreaterThanOrEqual(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('AI on the selection, and ask from the page (B2.3)', () => {
  function mockWithAI(answer = 'Short.') {
    const calls: Call[] = []
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      const raw = init?.body
      calls.push({ url, method, body: typeof raw === 'string' ? JSON.parse(raw) : raw })
      if (url === '/api/docs/spaces') return json(SPACES)
      if (url === '/api/docs/spaces/sp%20eng/pages/pg-1') {
        if (method === 'PATCH') return json({ id: 'pg-1', title: 'First page' })
        return json({ id: 'pg-1', title: 'First page', content: pm('A very long winded sentence here.', 'Keep this.'), content_text: 'x' })
      }
      if (url === '/api/docs/pages/pg-1/rewrite') return json({ text: answer })
      if (url === '/api/docs/pages/pg-1/write') return json({ text: 'Step one.\nStep two.' })
      return new Response('null', { status: 404 })
    })
    return calls
  }

  /** Selects `text` inside the editor the way a browser does: a DOM range, then selectionchange. */
  function select(ed: HTMLElement, text: string) {
    const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      const i = (n.textContent ?? '').indexOf(text)
      if (i < 0) continue
      const range = document.createRange()
      range.setStart(n, i)
      range.setEnd(n, i + text.length)
      ed.focus()
      const sel = document.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
      return
    }
    throw new Error(`"${text}" is not in the editor`)
  }

  it('shortens the selection as a suggestion, and Replace puts it in the page', async () => {
    const calls = mockWithAI('Short.')
    renderAt(PAGE_URL)
    const ed = await editor()
    await waitFor(() => expect(ed.textContent).toContain('A very long winded sentence here.'))

    select(ed, 'A very long winded sentence here.')
    fireEvent.click(await screen.findByRole('button', { name: 'Shorten' }))

    expect((await screen.findByTestId('ai-suggestion')).textContent).toBe('Short.')
    const post = calls.find((c) => c.url === '/api/docs/pages/pg-1/rewrite')
    expect(post?.body).toEqual({ action: 'shorter', text: 'A very long winded sentence here.' })
    // A suggestion: the page has not changed yet.
    expect(ed.textContent).toContain('A very long winded sentence here.')

    fireEvent.click(screen.getByRole('button', { name: 'Replace selection' }))
    await waitFor(() => expect(ed.querySelector('p')?.textContent).toBe('Short.'))
    expect(ed.textContent).toContain('Keep this.')
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
  })

  it('refuses to Replace words that changed while the model was answering', async () => {
    mockWithAI('Short.')
    renderAt(PAGE_URL)
    const ed = await editor()
    await waitFor(() => expect(ed.textContent).toContain('A very long winded sentence here.'))
    select(ed, 'A very long winded sentence here.')
    fireEvent.click(await screen.findByRole('button', { name: 'Shorten' }))
    await screen.findByTestId('ai-suggestion')

    typeInto(ed, 'Someone rewrote this meanwhile.')
    await waitFor(() => expect(ed.textContent).toContain('Someone rewrote this meanwhile.'))
    fireEvent.click(screen.getByRole('button', { name: 'Replace selection' }))

    expect(await screen.findByText(/selected words changed after they were sent/)).toBeTruthy()
    expect(ed.textContent).toContain('Someone rewrote this meanwhile.')
  })

  it('will not translate without a language — upstream that is a billed answer in English', async () => {
    mockWithAI()
    renderAt(PAGE_URL)
    const ed = await editor()
    await waitFor(() => expect(ed.textContent).toContain('Keep this.'))
    select(ed, 'Keep this.')
    expect((await screen.findByRole('button', { name: 'Translate' })).hasAttribute('disabled')).toBe(true)
  })

  it('writes with AI from a prompt, with the page as context, and inserts it below the caret', async () => {
    const calls = mockWithAI()
    renderAt(PAGE_URL)
    const ed = await editor()
    await waitFor(() => expect(ed.textContent).toContain('Keep this.'))

    fireEvent.change(screen.getByLabelText('What to write'), { target: { value: 'a rollback checklist' } })
    fireEvent.click(screen.getByRole('button', { name: 'Write' }))

    expect((await screen.findByTestId('ai-suggestion')).textContent).toBe('Step one.\nStep two.')
    const post = calls.find((c) => c.url === '/api/docs/pages/pg-1/write')
    expect(post?.body).toEqual({
      prompt: 'a rollback checklist',
      context: 'A very long winded sentence here.\nKeep this.',
    })
    // A suggestion first; a write has nothing to replace.
    expect(screen.queryByRole('button', { name: 'Replace selection' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Insert below' }))
    await waitFor(() =>
      expect([...ed.querySelectorAll('p')].map((p) => p.textContent)).toEqual([
        'A very long winded sentence here.',
        'Step one.',
        'Step two.',
        'Keep this.',
      ]),
    )
  })

  it('offers Ask AI from the page itself', async () => {
    mockWithAI()
    renderAt(PAGE_URL)
    await editor()
    expect(await screen.findByRole('button', { name: /^ask/i })).toBeTruthy()
  })
})
