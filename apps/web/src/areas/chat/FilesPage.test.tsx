import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B28.380 — uploaded files, linked from Chat's rail: every file attached in Chat, as Lens lists it through the BFF
// (GET /api/documents), each deleted for good on a second press (DELETE /api/documents/{id}). That a deployment's Lens
// then answers the deleted id 404 and lists it no more is the e2e scenario chat-files.

const REPORT = { id: 'tdoc_3f2a9c1e-0b7d-4c55-9e21-6a0d1c2b3e4f', media_type: 'application/pdf', filename: 'Q3 report.pdf', size_bytes: 4_200_000, uploaded_at: '2026-10-07T09:00:00Z' }
const NOTES = { id: 'tdoc_8b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d', media_type: 'text/markdown', filename: 'notes.md', size_bytes: 820, uploaded_at: '2026-10-08T12:00:00Z' }

function mockBff(list: () => Response) {
  const deleted: string[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/documents') return list()
    if (url.startsWith('/api/documents/') && init?.method === 'DELETE') {
      deleted.push(decodeURIComponent(url.slice('/api/documents/'.length)))
      return new Response(null, { status: 204 })
    }
    return new Response('null', { status: 404 })
  })
  return { deleted }
}

function json(v: unknown, status = 200) {
  return new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('Uploaded files (B28.380)', () => {
  it('lists every uploaded file, newest first, and deletes one for good only once it is confirmed', async () => {
    const bff = mockBff(() => json({ documents: [REPORT, NOTES] }))
    window.history.pushState({}, '', '/chat/files')
    render(<App />)

    const list = await screen.findByRole('list', { name: 'Uploaded files' })
    const rows = within(list).getAllByTestId('uploaded-file')
    expect(rows.map((r) => r.getAttribute('data-id'))).toEqual([NOTES.id, REPORT.id])
    expect(rows[1].textContent).toContain('Q3 report.pdf')
    expect(rows[1].textContent).toContain('PDF · 4.2 MB · uploaded Oct 7, 2026')
    expect(rows[0].textContent).toContain('Markdown · 1 KB')
    expect(screen.getByTestId('uploaded-files-total').textContent).toBe('2 files · 4.2 MB')

    // Kept: nothing is sent.
    fireEvent.click(within(list).getByRole('button', { name: 'Delete Q3 report.pdf' }))
    fireEvent.click(within(list).getByRole('button', { name: 'Keep it' }))
    expect(bff.deleted).toEqual([])

    fireEvent.click(within(list).getByRole('button', { name: 'Delete Q3 report.pdf' }))
    expect(within(list).getByTestId('uploaded-file-confirm').textContent).toContain('Delete Q3 report.pdf for good?')
    fireEvent.click(within(list).getByRole('button', { name: 'Delete for good' }))

    await waitFor(() => expect(within(list).getAllByTestId('uploaded-file')).toHaveLength(1))
    expect(bff.deleted).toEqual([REPORT.id])
    expect(within(list).getByTestId('uploaded-file').getAttribute('data-id')).toBe(NOTES.id)
    expect(screen.getByRole('status').textContent).toBe('Deleted Q3 report.pdf. No question can read it again.')
  })

  it('says so when this deployment’s Lens cannot list uploaded files yet, rather than that there are none', async () => {
    mockBff(() => json({ error: 'Lens cannot list uploaded files on this deployment yet', code: 'documents_unavailable' }, 404))
    window.history.pushState({}, '', '/chat/files')
    render(<App />)

    expect((await screen.findByTestId('uploaded-files-error')).textContent).toBe('Uploaded files cannot be listed on this deployment yet.')
    expect(screen.queryByTestId('uploaded-files-empty')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })
})
