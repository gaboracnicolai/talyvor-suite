import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B27.30 — a published board opens for someone with NO session, read-only.

const TOKEN = 'tok_abcdefghijklmnop'

function strangerAt(path: string, board: { status: number; body: unknown }) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'oidc', authenticated: false, user: null })
    if (url === `/api/public/boards/${TOKEN}`) return json(board.body, board.status)
    return new Response('null', { status: 401 })
  })
  window.history.pushState({}, '', path)
  return render(<App />)
}

beforeEach(() => queryClient.clear())
afterEach(() => {
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('a public board link, signed out', () => {
  it('shows the board, each issue in its status column, with nothing to open or change', async () => {
    strangerAt(`/board/${TOKEN}`, {
      status: 200,
      body: {
        workspace: 'Acme',
        project: 'Website',
        truncated: false,
        issues: [
          { identifier: 'WEB-3', title: 'Hero copy', status: 'in_progress', priority: 2, updated_at: '2026-10-02T00:00:00Z' },
          { identifier: 'WEB-1', title: 'Launch checklist', status: 'done', priority: 0, updated_at: '2026-10-01T00:00:00Z' },
        ],
      },
    })

    expect(await screen.findByRole('heading', { level: 1, name: 'Acme · Website' })).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'In progress' })).getByText('Hero copy')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Done' })).getByText('Launch checklist')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Todo' })).getByText('Nothing here.')).toBeInTheDocument()

    // Not the sign-in gate, and read-only: no issue links, no form controls.
    expect(screen.queryByText(/Sign in to Talyvor/i)).toBeNull()
    const main = screen.getByRole('main')
    expect(within(main).queryAllByRole('link')).toHaveLength(0)
    expect(within(main).queryAllByRole('button')).toHaveLength(0)
    expect(within(main).queryAllByRole('combobox')).toHaveLength(0)
  })

  it('says so when the link was turned off', async () => {
    strangerAt(`/board/${TOKEN}`, { status: 404, body: { error: 'board not found' } })
    expect(await screen.findByRole('heading', { level: 1, name: 'This board isn’t available' })).toBeInTheDocument()
  })
})
