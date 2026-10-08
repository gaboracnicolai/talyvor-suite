import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { localInput, parseSchedule } from './ScheduledPrompt'

// B28.377 — `/schedule Researcher: …` typed in Chat schedules the prompt on the agent's own wallet: the BFF relays it to
// Lens under the agent (apps/bff/prompt_schedules.go, prompt_schedules_test.go), the card waits for the run and shows
// its answer and what the agent's wallet paid, linked to the statement line; Scheduled prompts lists every schedule and
// stops one. The BFF is mocked at the wire; that Lens asks it at the time set and charges the agent's statement is
// proven against the stub Lens by e2e chat-scheduled-prompt.

const M = 1_000_000

function mockBff() {
  const created: Array<Record<string, unknown>> = []
  const stopped: string[] = []
  const schedule = {
    id: 'psc_1', agent_id: 'agt_1', prompt: 'What is 2+2?', provider: 'anthropic', model: 'claude-opus-5', every: 'day',
    next_run_at: '2026-10-09T09:00:00Z', active: true, created_at: '2026-10-08T05:00:00Z',
    runs: [{ ran_at: '2026-10-08T09:00:00Z', outcome: 'answered', answer: 'It is **4**.', request_id: 'req_9', charged_ulxc: 317, entry_id: 'ent_9' }],
  }
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models') return json([{ id: 'claude-opus-5', provider: 'anthropic', display_name: 'Claude Opus 5', input_per_1m: 5, output_per_1m: 25, tier: 'frontier' }])
    if (url === '/api/ai/providers') return json({ unconfigured: [] })
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/agents' && method === 'GET') {
      const agents = [
        { id: 'agt_1', name: 'Researcher', balance_ulxc: 2 * M, spent_ulxc: 0, keys: [], created_at: '2026-10-06T05:00:00Z' },
        { id: 'agt_2', name: 'Writer', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-06T05:00:00Z' },
      ]
      return json({ workspace_balance_ulxc: 100 * M, allocated_ulxc: 2 * M, unallocated_ulxc: 98 * M, spent_ulxc: 0, agents })
    }
    if (url === '/api/agents/agt_1/prompt-schedules' && method === 'POST') {
      created.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return json({ ...schedule, runs: [] }, 201)
    }
    if (url === '/api/agents/prompt-schedules') return json({ schedules: [schedule] })
    if (url === '/api/agents/prompt-schedules/psc_1/stop' && method === 'POST') {
      stopped.push('psc_1')
      schedule.active = false
      return json({ id: 'psc_1', active: false })
    }
    return new Response('null', { status: 404 })
  })
  return { created, stopped }
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.history.pushState({}, '', '/')
})

describe('Scheduled prompts billed to a wallet (B28.377)', () => {
  it('reads the agent before the colon and the prompt after it', () => {
    expect(parseSchedule('/schedule Researcher: summarise yesterday: shortest first')).toEqual({
      agent: 'Researcher',
      prompt: 'summarise yesterday: shortest first',
      whole: 'Researcher: summarise yesterday: shortest first',
    })
  })

  it('schedules the prompt on the agent’s wallet, then shows its answer and what the wallet paid, linked to the statement', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/chat')
    render(<App />)
    const box = await screen.findByRole('textbox', { name: /message/i })
    await waitFor(() => expect(box).not.toBeDisabled())
    fireEvent.change(box, { target: { value: '/schedule Researcher: What is 2+2?' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    const card = await screen.findByTestId('chat-schedule')
    expect(screen.queryAllByTestId('turn-user')).toHaveLength(0) // nothing was asked now, on the conversation's account

    await waitFor(() => expect(within(card).getByLabelText('Agent')).toHaveValue('agt_1'))
    expect(within(card).getByLabelText('The prompt')).toHaveValue('What is 2+2?')
    const at = new Date(Date.now() + 2 * 60 * 60_000)
    at.setSeconds(0, 0)
    fireEvent.change(within(card).getByLabelText('When'), { target: { value: localInput(at) } })
    fireEvent.change(within(card).getByLabelText('How often'), { target: { value: 'day' } })
    expect(within(card).getByTestId('chat-schedule-terms')).toHaveTextContent(
      'At the time set, Claude Opus 5 is asked on Researcher’s own wallet: each run is charged there, and Lens judges it by Researcher’s rules first.',
    )

    fireEvent.click(within(card).getByRole('button', { name: 'Schedule it' }))
    await waitFor(() => expect(bff.created).toHaveLength(1))
    expect(bff.created[0]).toEqual({ prompt: 'What is 2+2?', provider: 'anthropic', model: 'claude-opus-5', every: 'day', first_run_at: at.toISOString() })

    expect(await within(card).findByTestId('chat-schedule-done')).toHaveTextContent(/^At .+ Researcher asked Claude Opus 5:$/)
    expect(within(card).getByTestId('scheduled-run-answer')).toHaveTextContent('It is 4.')
    const billed = within(card).getByTestId('scheduled-run-billed')
    expect(billed).toHaveTextContent(/^Researcher’s wallet paid 0\.000317 LXC for it: the line on its statement$/)
    expect(within(billed).getByRole('link', { name: 'the line on its statement' })).toHaveAttribute('href', '/agents?agent=agt_1&entry=ent_9')
  })

  it('lists every schedule with its answers under Scheduled prompts, and stops one', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/chat/scheduled')
    render(<App />)
    const item = await screen.findByTestId('scheduled-prompt')
    await waitFor(() => expect(item).toHaveTextContent('Researcher asks Claude Opus 5'))
    expect(within(item).getByTestId('scheduled-run-answer')).toHaveTextContent('It is 4.')
    expect(within(item).getByRole('link', { name: 'the line on its statement' })).toHaveAttribute('href', '/agents?agent=agt_1&entry=ent_9')

    fireEvent.click(within(item).getByRole('button', { name: 'Stop it' }))
    await waitFor(() => expect(bff.stopped).toEqual(['psc_1']))
    await waitFor(() => expect(within(item).queryByRole('button', { name: 'Stop it' })).toBeNull())
    expect(item).toHaveTextContent('Stopped')
  })
})
