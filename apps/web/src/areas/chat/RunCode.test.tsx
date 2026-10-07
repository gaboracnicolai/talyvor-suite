import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { RUN_CODE_HEADER } from './chatApi'
import { CODE_RUN_FRAME } from './chatStream'

// B28.373 — code execution in a sandbox. The BFF is mocked at the wire with the frame Lens adds for each piece of code
// the model ran in its sandbox (chatStream.ts CODE_RUN_FRAME, talyvor-lens B28.119), sent only when the question asked
// for it. That a deployment's answer to "the 100th prime" is 541, worked out by code it ran, is the e2e scenario
// chat-run-code.

const sse = (...frames: unknown[]) => frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('')
const code = 'primes = [n for n in range(2, 600) if all(n % d for d in range(2, int(n ** 0.5) + 1))]\nprint(primes[99])'
const answer = (ran: boolean) =>
  sse(
    { type: 'message_start', message: { model: 'claude-opus-5', usage: { input_tokens: 12, output_tokens: 1 } } },
    ...(ran
      ? [
          { type: CODE_RUN_FRAME, language: 'python', code, stdout: '541\n', exit_code: 0 },
          // Code that is markup is shown as the text it is, never rendered.
          { type: CODE_RUN_FRAME, language: 'python', code: 'print("<b>bold</b>")', stdout: '', stderr: 'NameError: x', exit_code: 1 },
        ]
      : []),
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ran ? 'The 100th prime is 541.' : 'Hello.' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } },
    { type: 'message_stop' },
  )

function mockBff() {
  const asked: (string | null)[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models') return json([{ id: 'claude-opus-5', provider: 'anthropic', display_name: 'Claude Opus 5', input_per_1m: 5, output_per_1m: 25, tier: 'frontier' }])
    if (url === '/api/ai/providers') return json({ unconfigured: [] })
    if (url === '/api/lxc/topup-options') return json({ allowed_usd_cents: [1000], usd_per_lxc: 0.1 })
    if (url === '/api/ai/stream/anthropic/v1/messages') {
      const run = new Headers(init?.headers).get(RUN_CODE_HEADER)
      asked.push(run)
      return new Response(answer(run === 'on'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }
    return new Response('null', { status: 404 })
  })
  return asked
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.history.pushState({}, '', '/')
})

async function ask(question: string) {
  fireEvent.change(screen.getByPlaceholderText('Ask anything'), { target: { value: question } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
}

describe('Run code (B28.373)', () => {
  it('lets the model run code, shows the code and what it printed under the answer, keeps it after a reload, and stops when off', async () => {
    const asked = mockBff()
    window.history.pushState({}, '', '/chat')
    render(<App />)
    await screen.findByRole('button', { name: 'Model: Claude Opus 5' })
    const toggle = screen.getByRole('button', { name: 'Run code' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    await ask('What is the 100th prime?')

    const ran = await screen.findByRole('region', { name: 'Code this answer ran' })
    expect(asked).toEqual(['on'])
    expect(screen.getAllByTestId('turn-reply')[0].textContent).toContain('541')
    const runs = within(ran).getAllByTestId('turn-code-run')
    expect(runs).toHaveLength(2)
    expect(within(runs[0]).getByTestId('turn-code-run-code').textContent).toBe(code)
    expect(within(runs[0]).getByTestId('turn-code-run-output').textContent).toBe('541\n')
    expect(runs[0].textContent).not.toContain('Exited')
    expect(within(runs[1]).getByTestId('turn-code-run-code').textContent).toBe('print("<b>bold</b>")')
    expect(runs[1].querySelector('b')).toBeNull()
    expect(within(runs[1]).getByTestId('turn-code-run-output').textContent).toBe('NameError: x')
    expect(runs[1].textContent).toContain('Exited with code 1')

    // Kept with the conversation: opened again, the answer still shows what it ran.
    cleanup()
    queryClient.clear()
    render(<App />)
    const again = await screen.findByRole('region', { name: 'Code this answer ran' })
    expect(within(again).getAllByTestId('turn-code-run-output')[0].textContent).toBe('541\n')

    // Off, the next question goes without it and its answer shows no code.
    expect(screen.getByRole('button', { name: 'Run code' }).getAttribute('aria-pressed')).toBe('false')
    await ask('Thanks.')
    await waitFor(() => expect(screen.getAllByTestId('turn-reply')).toHaveLength(2))
    await waitFor(() => expect(screen.getAllByTestId('turn-reply')[1].textContent).toBe('Hello.'))
    expect(asked).toEqual(['on', null])
    expect(screen.getAllByRole('region', { name: 'Code this answer ran' })).toHaveLength(1)
  })
})
