import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { parseTask } from './AgentTask'

// B28.359 — `/task Researcher: …` typed in Chat hands the task to the agent: the BFF runs it on the agent's own wallet
// (apps/bff/agent_task.go, its key issued for the task and revoked after — agent_task_test.go), and the card shows the
// answer and the lines the task put on the agent's statement. The BFF is mocked at the wire; that Lens charges every
// call of the task to the agent's wallet, and nothing to the workspace, is proven against Lens by e2e chat-agent-task.

const M = 1_000_000

function mockBff(refuse?: string) {
  const tasks: Array<Record<string, unknown>> = []
  const lines: Array<Record<string, unknown>> = [
    { entry_id: 'ent_1', kind: 'fund', amount_ulxc: 2 * M, counterparty: 'workspace', balance_after_ulxc: 2 * M, at: '2026-10-06T05:00:00Z' },
  ]
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
    if (url === '/api/agents/agt_1/statement') return json({ lines: [...lines].reverse() })
    if (url === '/api/agents/agt_1/tasks') {
      tasks.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      if (refuse !== undefined) return json({ error: refuse }, 403)
      lines.push({ entry_id: 'ent_2', kind: 'spend', amount_ulxc: -12_345, counterparty: 'spend', balance_after_ulxc: 2 * M - 12_345, at: '2026-10-06T05:01:00Z' })
      return json({ agent_id: 'agt_1', answer: 'GPT, **Claude** and Gemini.', model: 'claude-opus-5', request_id: 'req_1', replayed: false, usage: { input_tokens: 9, output_tokens: 7 }, key_revoked: true })
    }
    return new Response('null', { status: 404 })
  })
  return { tasks }
}

async function typeInChat(command: string) {
  window.history.pushState({}, '', '/chat')
  render(<App />)
  const box = await screen.findByRole('textbox', { name: /message/i })
  await waitFor(() => expect(box).not.toBeDisabled())
  fireEvent.change(box, { target: { value: command } })
  fireEvent.keyDown(box, { key: 'Enter' })
  const card = await screen.findByTestId('chat-task')
  expect(box).toHaveValue('')
  expect(screen.queryAllByTestId('turn-user')).toHaveLength(0) // nothing went to the model on the conversation's account
  return card
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.history.pushState({}, '', '/')
})

describe('Hand a task to an agent from Chat (B28.359)', () => {
  it('reads the agent before the colon and the task after it', () => {
    expect(parseTask('/task Researcher: name three models: cheapest first')).toEqual({
      agent: 'Researcher',
      task: 'name three models: cheapest first',
      whole: 'Researcher: name three models: cheapest first',
    })
    expect(parseTask('/task summarise the week')).toEqual({ agent: '', task: 'summarise the week', whole: 'summarise the week' })
  })

  it('runs the task on the agent’s wallet and shows the answer and the lines it put on its statement', async () => {
    const bff = mockBff()
    const card = await typeInChat('/task Researcher: Name three models that read PDFs.')
    await waitFor(() => expect(within(card).getByLabelText('Agent')).toHaveValue('agt_1'))
    expect(within(card).getByLabelText('The task')).toHaveValue('Name three models that read PDFs.')
    expect(within(card).getByTestId('chat-task-terms')).toHaveTextContent(
      'It goes to Claude Opus 5 on Researcher’s own wallet: every call it makes is charged there, and Lens judges each by Researcher’s rules first.',
    )

    fireEvent.click(within(card).getByRole('button', { name: 'Hand it to Researcher' }))
    expect(await within(card).findByTestId('chat-task-done')).toHaveTextContent('Researcher did the task on Claude Opus 5, on its own wallet:')
    expect(bff.tasks).toEqual([{ task: 'Name three models that read PDFs.', provider: 'anthropic', model: 'claude-opus-5' }])
    expect(within(card).getByTestId('chat-task-answer')).toHaveTextContent('GPT, Claude and Gemini.')

    // The statement as it was just before is the line not counted: only the task's spend is.
    const billed = await within(card).findByTestId('chat-task-billed')
    expect(billed).toHaveTextContent(/^Researcher’s wallet paid for it: −0\.012345 LXC on its statement, leaving 1\.987655 LXC\.Spent on a request −0\.012345 LXC$/)
    expect(within(billed).getByRole('link', { name: 'Spent on a request' })).toHaveAttribute('href', '/agents?agent=agt_1&entry=ent_2')
  })

  it('says why, in Lens’s words, when the agent’s rules refuse the task', async () => {
    mockBff("economy: the agent's spending rules refuse this request: the agent is paused")
    const card = await typeInChat('/task Researcher: Name three models.')
    await waitFor(() => expect(within(card).getByLabelText('Agent')).toHaveValue('agt_1'))
    fireEvent.click(within(card).getByRole('button', { name: 'Hand it to Researcher' }))
    expect(await within(card).findByRole('alert')).toHaveTextContent(
      "Researcher did not do the task: The agent's spending rules refuse this request: the agent is paused.",
    )
  })
})
