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
// These cases drive the requests themselves and read what goes on the wire. They deliberately do
// NOT pin the body of the page PATCH — what that write should carry is the open cross-repo
// decision recorded in the queue, and pinning today's answer would make that decision harder to
// take rather than easier.

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
function mockDocs(opts: {
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
      return json({ id: 'pg-1', title: 'First page', content_text: last })
    }
    if (url === '/api/docs/pages/pg-1/summarize') return json({ text: '• a summary' })
    return new Response('null', { status: 404 })
  })
  return calls
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

describe('the page editor re-reads what Docs recorded', () => {
  // ⚠ THE RED THIS FILE WAS WRITTEN FOR. The save already invalidated the page query on success —
  // the author's intent is in the source — but the editor seeds its draft only `while it is
  // null`, so the refetched value had no way to reach the textarea. The re-read ran and NOTHING
  // could observe it: a screen that renders what you typed at it, whatever the server did with
  // it. This app refuses exactly that shape everywhere else it writes (Documents.tsx "the
  // rendered state must be what Lens RECORDED"; Sharing.tsx; the BFF's setDistillPolicy "Report
  // what Lens RECORDED, never what was asked for").
  it('shows the server value after a save, not the text that was typed', async () => {
    mockDocs({ pageText: ['from the server', 'WHAT DOCS RECORDED'] })
    renderAt(PAGE_URL)

    const box = (await screen.findByLabelText('Content')) as HTMLTextAreaElement
    await waitFor(() => expect(box.value).toBe('from the server'))

    fireEvent.change(box, { target: { value: 'what the person typed' } })
    expect(box.value).toBe('what the person typed')

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(box.value).toBe('WHAT DOCS RECORDED'))
  })

  // ⚠ THE SUMMARY IS OF THE PAGE AS STORED, AND THAT IS WHAT MAKES ITS COST SENTENCE TRUE.
  //
  // Docs binds this completion's cost to page pg-1 and later rolls it onto that page's
  // `own_ai_cost_usd`, so the bytes sent have to be that page's bytes. Feeding the control the
  // editor's `draft` instead would bill a document for words it does not contain — and it would
  // read as the more helpful choice ("summarise what I'm looking at"), which is exactly why the
  // wiring is asserted here rather than trusted to the comment on it.
  //
  // It is also the assertion behind the claim that this control needs no editor at all: the text
  // comes from the page query, and a reader with no draft in the box gets the same request.
  it('summarises the page as STORED, not the unsaved keystrokes in the box', async () => {
    const calls = mockDocs({ pageText: ['the text Docs has stored'] })
    renderAt(PAGE_URL)

    const box = (await screen.findByLabelText('Content')) as HTMLTextAreaElement
    await waitFor(() => expect(box.value).toBe('the text Docs has stored'))
    fireEvent.change(box, { target: { value: 'unsaved keystrokes nobody has stored' } })

    fireEvent.click(screen.getByRole('button', { name: /summarise this page/i }))

    await waitFor(() =>
      expect(calls.filter((c) => c.url === '/api/docs/pages/pg-1/summarize')).toHaveLength(1),
    )
    const post = calls.find((c) => c.url === '/api/docs/pages/pg-1/summarize')
    expect(post?.body).toEqual({ text: 'the text Docs has stored' })
  })

  it('re-reads the page after a successful save', async () => {
    const calls = mockDocs({ pageText: ['one', 'two'] })
    renderAt(PAGE_URL)
    const box = (await screen.findByLabelText('Content')) as HTMLTextAreaElement
    await waitFor(() => expect(box.value).toBe('one'))

    fireEvent.change(box, { target: { value: 'edited' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(calls.filter((c) => c.url.endsWith('/pages/pg-1') && c.method === 'GET')).toHaveLength(2),
    )
  })

  it('PATCHes the page route, with the space id escaped', async () => {
    const calls = mockDocs({ pageText: ['one'] })
    renderAt(PAGE_URL)
    const box = (await screen.findByLabelText('Content')) as HTMLTextAreaElement
    await waitFor(() => expect(box.value).toBe('one'))

    fireEvent.change(box, { target: { value: 'edited' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const patch = calls.filter((c) => c.method === 'PATCH')
      expect(patch).toHaveLength(1)
      expect(patch[0].url).toBe('/api/docs/spaces/sp%20eng/pages/pg-1')
    })
  })

  // A failed write must say so AND leave the words on screen. Clearing the box on a refusal
  // destroys the only copy of what the person wrote.
  it('a refused save states it and keeps the draft', async () => {
    mockDocs({ pageText: ['one'], patchStatus: 502 })
    renderAt(PAGE_URL)
    const box = (await screen.findByLabelText('Content')) as HTMLTextAreaElement
    await waitFor(() => expect(box.value).toBe('one'))

    fireEvent.change(box, { target: { value: 'still mine' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/Couldn’t save/)).toBeTruthy()
    expect(box.value).toBe('still mine')
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
        return json({ id: 'pg-1', title: 'First page', content_text: 'ONE' })
      if (url === '/api/docs/spaces/sp%20eng/pages/pg-2')
        return json({ id: 'pg-2', title: 'Second page', content_text: 'TWO' })
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
  // PageView is NOT remounted when only :pageId changes — the params move underneath it and
  // useState survives. The seeding effect fills the draft only `while it is null`, and after the
  // first page it never is again. Unfixed, this leaves page A's text in the box under page B's
  // title, and Save writes A's content INTO B.
  //
  // Nothing in this UI links one page to a sibling today; the button below is what a page tree,
  // a "next page" link or a search result would be. That is why this is a test and not a bug
  // report: the failure is in the component, one ordinary link away from being live.
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

    const box = (await screen.findByLabelText('Content')) as HTMLTextAreaElement
    await waitFor(() => expect(box.value).toBe('ONE'))

    fireEvent.click(screen.getByText('jump'))
    await screen.findByText('Second page')

    await waitFor(() => expect((screen.getByLabelText('Content') as HTMLTextAreaElement).value).toBe('TWO'))
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
