import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B21.4 — Features' "Stored answers": the counts, a deletion confirmed by typing the workspace's
// name, and a request to delete everything with its status. Every other Features read 404s here,
// which that screen already shows as "could not be read".

const WS = 'ws_3f9a'

function mockBff(posts: Array<{ url: string; body: unknown }>) {
  const counts = { shared_answers: 12, private_answers: 30, shared_conversions: 2, private_conversions: 5 }
  const requests: Array<{ id: number; status: string; requested_at: string }> = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/features/stored-answers') return json({ ...counts, confirm_with: WS })
    if (url === '/api/features/stored-answers/delete' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { scope: string; confirm: string }
      posts.push({ url, body })
      const deleted = { ...counts, private_answers: 0, private_conversions: 0 }
      counts.shared_answers = 0
      counts.shared_conversions = 0
      return json({ scope: body.scope, deleted })
    }
    if (url === '/api/features/deletion-requests' && init?.method === 'POST') {
      posts.push({ url, body: JSON.parse(String(init.body)) })
      const r = { id: 1, status: 'requested', requested_at: '2026-09-28T12:00:00Z' }
      requests.push(r)
      return json(r, 201)
    }
    if (url === '/api/features/deletion-requests') return json({ requests })
    return new Response('null', { status: 404 })
  })
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('Features → Stored answers', () => {
  it('deleting shared answers needs the workspace name typed, then the shared count reads zero', async () => {
    const posts: Array<{ url: string; body: unknown }> = []
    mockBff(posts)
    window.history.pushState({}, '', '/features')
    render(<App />)

    const counts = await screen.findByTestId('stored-answers-counts')
    await waitFor(() => expect(counts).toHaveTextContent('12 answers shared with others and 30 kept'))

    fireEvent.click(screen.getByRole('button', { name: 'Delete shared answers…' }))
    expect(screen.getByText(/This cannot be undone/)).toBeInTheDocument()
    expect(screen.getByText(/Answers already given to other users stay in their conversations/)).toBeInTheDocument()
    const confirm = screen.getByRole('button', { name: 'Delete shared answers' })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText(`Type ${WS} to confirm`), { target: { value: 'ws_3f9' } })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText(`Type ${WS} to confirm`), { target: { value: WS } })
    fireEvent.click(confirm)

    await waitFor(() => expect(counts).toHaveTextContent('0 answers shared with others and 30 kept'))
    expect(screen.getByRole('status')).toHaveTextContent('Deleted 12 shared answers and 2 shared document conversions.')
    expect(posts).toEqual([{ url: '/api/features/stored-answers/delete', body: { scope: 'shared', confirm: WS } }])
  })

  it('asking Talyvor to delete everything files the request and shows it waiting', async () => {
    const posts: Array<{ url: string; body: unknown }> = []
    mockBff(posts)
    window.history.pushState({}, '', '/features')
    render(<App />)

    const ask = await screen.findByRole('button', { name: 'Ask Talyvor to delete all my data' })
    await waitFor(() => expect(ask).toBeEnabled())
    fireEvent.click(ask)

    await waitFor(() =>
      expect(screen.getByTestId('deletion-requests')).toHaveTextContent(/Asked \d+ Sept 2026 — waiting for Talyvor to delete it\./),
    )
    expect(screen.getByRole('button', { name: 'Ask Talyvor to delete all my data' })).toBeDisabled()
    expect(posts).toEqual([{ url: '/api/features/deletion-requests', body: {} }])
  })
})
