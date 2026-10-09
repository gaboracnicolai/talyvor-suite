import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SharedDocsPage } from './SharedDocsPage'

// B28.447 — a stranger opening a Docs share link reads the page; a link Docs refuses (a changed token) says the page is
// not there rather than showing anything.

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function open(token: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[`/docs/s/${token}`]}>
        <Routes>
          <Route path="/docs/s/:token" element={<SharedDocsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('SharedDocsPage', () => {
  it('reads the shared page signed out', async () => {
    const content = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Restart the queue first.' }] }] })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ page: { id: 'p1', title: 'Runbook', content, content_text: '', updated_at: '2026-10-09T10:00:00Z' } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    open('s1_abc.c2ln')

    expect(await screen.findByRole('heading', { level: 1, name: 'Runbook' })).toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'The page' })).toHaveTextContent('Restart the queue first.')
    expect(fetchMock).toHaveBeenCalledWith('/api/public/docs/s1_abc.c2ln', expect.anything())
  })

  it('says the page is not there for a link Docs refuses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"link not found"}', { status: 404 })))

    open('s1_abc.c2lX')

    expect(await screen.findByRole('heading', { level: 1, name: 'This page isn’t available' })).toBeInTheDocument()
    expect(screen.queryByRole('article')).toBeNull()
  })
})
