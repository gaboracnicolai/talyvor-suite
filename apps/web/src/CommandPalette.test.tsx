import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App, queryClient } from './App'
import { historyKey } from './areas/chat/history'
import { SHORTCUTS } from './components/CommandPalette'

// B28.135 — the command palette and the keyboard shortcuts. Drives the real <App />: the keys are pressed on the page,
// and what is asserted is the screen a person is left on.

const CATALOG = [
  { id: 'claude-opus-5', provider: 'anthropic', display_name: 'Claude Opus 5', input_per_1m: 5, output_per_1m: 25, release_date: '2026-07-24', tier: 'frontier' },
  { id: 'gpt-4o', provider: 'openai', display_name: 'GPT-4o', input_per_1m: 2.5, output_per_1m: 10, release_date: '2024-05-13', tier: 'balanced' },
]
const QUESTION = 'Where does the kestrel nest?'

function mockBff() {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    const url = String(input)
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models') return json(CATALOG)
    if (url === '/api/ai/providers') return json({ unconfigured: [] })
    return new Response('null', { status: 404 })
  })
  // One saved conversation, which Chat reopens: a new chat is the thread gone with the conversation still listed.
  window.localStorage.setItem(
    historyKey('local'),
    JSON.stringify([
      {
        id: 'c-1', title: QUESTION, renamed: false, model_id: 'claude-opus-5', created_at: 1, updated_at: 1,
        messages: [{ role: 'user', content: QUESTION }, { role: 'assistant', content: 'On the north cliff.' }],
      },
    ]),
  )
}

async function mountAt(address: string): Promise<void> {
  window.history.pushState({}, '', address)
  render(<App />)
  await screen.findByRole('navigation', { name: /sections/i })
}

const press = (key: string, code: string, mods: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {}, on: Element = document.body) =>
  fireEvent.keyDown(on, { key, code, ...mods })

async function openPalette(): Promise<HTMLElement> {
  press('k', 'KeyK', { ctrlKey: true })
  return screen.findByRole('dialog', { name: 'Command palette' })
}

beforeEach(mockBff)
afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('the command palette (B28.135)', () => {
  it('opens with Ctrl+K on any screen, and a page typed and chosen with Enter opens', async () => {
    await mountAt('/settings')
    const palette = await openPalette()
    const box = within(palette).getByRole('combobox', { name: 'Type a command or a page' })
    expect(box).toHaveFocus()
    fireEvent.change(box, { target: { value: 'ledger' } })
    expect(within(palette).getByRole('option', { name: 'Ledger' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(window.location.pathname).toBe('/ledger')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Ledger')
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull()
  })

  it('New chat leaves the open conversation for an empty one, which is still listed', async () => {
    await mountAt('/chat')
    await screen.findByTestId('turn-user')
    const palette = await openPalette()
    fireEvent.click(within(palette).getByRole('option', { name: /^New chat/ }))
    await waitFor(() => expect(screen.queryByTestId('turn-user')).toBeNull())
    expect(within(screen.getByRole('list', { name: 'Saved conversations' })).getByRole('button', { name: QUESTION })).toBeInTheDocument()
  })

  it('words that name no command search the conversations for them', async () => {
    await mountAt('/settings')
    const palette = await openPalette()
    fireEvent.change(within(palette).getByRole('combobox'), { target: { value: 'kestrel' } })
    fireEvent.click(within(palette).getByRole('option', { name: 'Search conversations for “kestrel”' }))
    expect(window.location.pathname).toBe('/chat')
    const search = await screen.findByRole('searchbox', { name: 'Search conversations' })
    expect(search).toHaveValue('kestrel')
    await waitFor(() => expect(search).toHaveFocus())
    expect(within(await screen.findByRole('list', { name: 'Conversations found' })).getByText(QUESTION)).toBeInTheDocument()
  })

  it('Switch model opens the model picker on its search box', async () => {
    await mountAt('/chat')
    await screen.findByRole('button', { name: 'Model: Claude Opus 5' })
    const palette = await openPalette()
    fireEvent.click(within(palette).getByRole('option', { name: 'Switch model' }))
    expect(await screen.findByRole('listbox', { name: 'Models' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Search models' })).toHaveFocus()
  })
})

describe('the keyboard shortcuts (B28.135)', () => {
  it('Ctrl+/ lists every shortcut, and Esc closes the list', async () => {
    await mountAt('/settings')
    press('/', 'Slash', { ctrlKey: true })
    const list = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })
    const rows = within(list).getAllByRole('listitem').map((li) => li.textContent)
    expect(rows).toHaveLength(SHORTCUTS.length)
    for (const s of SHORTCUTS) expect(rows.some((r) => r?.startsWith(s.label))).toBe(true)
    press('Escape', 'Escape')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull())
  })

  it('Ctrl+Shift+O opens Chat on a new chat from another screen', async () => {
    await mountAt('/settings')
    press('O', 'KeyO', { ctrlKey: true, shiftKey: true })
    expect(window.location.pathname).toBe('/chat')
    await screen.findByRole('list', { name: 'Saved conversations' })
    // Turns are drawn once the catalog is read; until then no thread is on screen, new or not.
    await screen.findByRole('button', { name: 'Model: Claude Opus 5' })
    expect(screen.queryByTestId('turn-user')).toBeNull()
  })

  it('/ focuses Search conversations, but typed in the message box it is only a slash', async () => {
    await mountAt('/chat')
    const message = await screen.findByLabelText('Your message')
    press('/', 'Slash', {}, message)
    expect(screen.getByRole('searchbox', { name: 'Search conversations' })).not.toHaveFocus()
    press('/', 'Slash')
    await waitFor(() => expect(screen.getByRole('searchbox', { name: 'Search conversations' })).toHaveFocus())
  })
})
