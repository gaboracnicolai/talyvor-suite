import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../App'
import { historyKey } from './history'

// B29.10 — chat in the brand: the composer on raised with a line-strong border and the teal Send, the model
// picker in the eyebrow style, questions and replies at 15/24 with code and numbers in IBM Plex Mono, and the
// wallet lines a spend answer read in the wallet screens' raised card. A saved conversation is opened, so
// nothing is streamed.

const M = 1_000_000
const REPLY = 'Your agents spent 1.23 LXC today, 12% of the budget, mostly on gpt-4o.\n\n```sh\ncurl /statements\n```'

function mockBff() {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models')
      return json([{ id: 'claude-opus-5', provider: 'anthropic', display_name: 'Claude Opus 5', input_per_1m: 5, output_per_1m: 25, release_date: '2026-07-24', tier: 'frontier' }])
    if (url === '/api/ai/providers') return json({ unconfigured: [] })
    return new Response('null', { status: 404 })
  })
}

function saveConversation() {
  const at = Date.parse('2026-10-05T06:00:00Z')
  window.localStorage.setItem(
    historyKey('local'),
    JSON.stringify([
      {
        id: 'c1',
        title: 'What did my agents spend today?',
        renamed: false,
        model_id: 'claude-opus-5',
        created_at: at,
        updated_at: at,
        messages: [
          { role: 'user', content: 'What did my agents spend today?' },
          {
            role: 'assistant',
            content: REPLY,
            spend: [{ agent_id: 'agt_1', agent: 'Researcher', entry_id: 'ent_9', amount_ulxc: -1.23 * M, at: '2026-10-05T06:00:00Z' }],
          },
        ],
      },
    ]),
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.history.pushState({}, '', '/')
})

describe('chat in the brand (B29.10)', () => {
  it('puts the composer on raised with the teal Send, the picker in the eyebrow style, replies at 15/24 with mono figures, and the wallet lines on a raised card', async () => {
    mockBff()
    saveConversation()
    window.history.pushState({}, '', '/chat')
    render(<App />)

    const picker = await screen.findByRole('button', { name: 'Model: Claude Opus 5' })
    expect(picker).toHaveClass('font-figure', 'text-eyebrow', 'uppercase', 'text-label')

    const box = screen.getByRole('textbox', { name: 'Your message' })
    expect(box).toHaveClass('bg-raised', 'text-reading')
    expect(box.closest('form')).toHaveClass('bg-raised', 'border-rule-strong')
    expect(screen.getByRole('button', { name: 'Send' })).toHaveClass('bg-accent')

    const question = (await screen.findByTestId('turn-user')).firstElementChild
    expect(question).toHaveClass('bg-raised', 'text-reading')

    const reply = (await screen.findAllByTestId('turn-assistant')).at(-1)!
    await within(reply).findByText(/mostly on/, {}, { timeout: 5_000 })
    const text = within(reply).getByTestId('turn-reply')
    expect(text).toHaveClass('font-sans', 'text-reading')
    // The numbers on the figure face; a digit inside a word stays part of the word.
    const figures = Array.from(text.querySelectorAll('p span.font-figure')).map((s) => s.textContent)
    expect(figures).toEqual(['1.23', '12%'])
    expect(reply).toHaveTextContent('mostly on gpt-4o.')
    expect(text.querySelector('pre')).toHaveClass('font-mono')
    expect(text.querySelector('pre')?.parentElement).toHaveClass('bg-raised')

    const lines = screen.getByRole('navigation', { name: 'Statement lines this answer read' })
    expect(lines.parentElement).toHaveClass('bg-raised', 'rounded-card')
    expect(within(lines).getByText('From your agents’ statements')).toHaveClass('text-eyebrow', 'uppercase', 'text-label')
    expect(within(lines).getByRole('link', { name: /^Researcher: −1\.23 LXC/ })).toBeInTheDocument()
  }, 15_000)
})
