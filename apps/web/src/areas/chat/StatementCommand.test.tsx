import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { parseStatement } from './StatementCommand'

// B28.98 — `/statement Researcher` typed in Chat downloads the agent's statement for this month, and `/statement`
// every agent's: the same file Agent Wallets downloads (B19.22), from GET /api/agents/{id}/statement and
// /api/agents/statement. The BFF is mocked at the wire; that the file's rows are Lens's statement is proven against
// Lens by e2e chat-statement.

const M = 1_000_000

const CSV = (account: string) =>
  'posting_id,entry_id,at,account,kind,amount_ulxc,counterparty,ref,balance_after_ulxc\r\n' +
  `,,2026-10-01T00:00:00Z,${account},opening,,,,0\r\n` +
  `7,ent_1,2026-10-03T10:00:00Z,${account},fund,5000000,workspace,,5000000\r\n` +
  `,,2026-10-07T00:00:00Z,${account},closing,,,,5000000\r\n`

function mockBff() {
  const asked: string[] = []
  const saved: Array<{ name: string; text: Promise<string> }> = []
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-06T12:00:00Z'))
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  URL.createObjectURL = vi.fn((b: Blob) => {
    const text =
      typeof b.text === 'function'
        ? b.text()
        : new Promise<string>((resolve) => {
            const fr = new FileReader()
            fr.onload = () => resolve(String(fr.result))
            fr.readAsText(b)
          })
    saved.push({ name: '', text })
    return 'blob:statement'
  }) as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved[saved.length - 1].name = this.download
  })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    const csv = (account: string) => {
      asked.push(url)
      return new Response(CSV(account), { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8' } })
    }
    if (url === '/api/agents/agt_1/statement?from=2026-10-01&to=2026-10-07&format=csv') return csv('agent:agt_1')
    if (url === '/api/agents/statement?from=2026-10-01&to=2026-10-07&format=csv') return csv('workspace')
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models') return json([{ id: 'claude-opus-5', provider: 'anthropic', display_name: 'Claude Opus 5', input_per_1m: 5, output_per_1m: 25, tier: 'frontier' }])
    if (url === '/api/ai/providers') return json({ unconfigured: [] })
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/agents') {
      const agents = [
        { id: 'agt_1', name: 'Researcher', balance_ulxc: 5 * M, spent_ulxc: 0, keys: [], created_at: '2026-10-01T05:00:00Z' },
        { id: 'agt_2', name: 'Writer', balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-10-01T05:00:00Z' },
      ]
      return json({ workspace_balance_ulxc: 100 * M, allocated_ulxc: 5 * M, unallocated_ulxc: 95 * M, spent_ulxc: 0, agents })
    }
    return new Response('null', { status: 404 })
  })
  return { asked, saved }
}

async function typeInChat(command: string) {
  window.history.pushState({}, '', '/chat')
  render(<App />)
  const box = await screen.findByRole('textbox', { name: /message/i })
  await waitFor(() => expect(box).not.toBeDisabled())
  fireEvent.change(box, { target: { value: command } })
  fireEvent.keyDown(box, { key: 'Enter' })
  const card = await screen.findByTestId('chat-statement')
  expect(box).toHaveValue('')
  expect(screen.queryAllByTestId('turn-user')).toHaveLength(0) // nothing went to the model
  return card
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  queryClient.clear()
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.history.pushState({}, '', '/')
})

describe('Download a statement from Chat (B28.98)', () => {
  it('reads the agent named, or every agent', () => {
    expect(parseStatement('/statement Researcher')).toBe('Researcher')
    expect(parseStatement('/statement for Researcher')).toBe('Researcher')
    expect(parseStatement('/statement Researcher’s statement')).toBe('Researcher')
    expect(parseStatement('/statement')).toBe('')
    expect(parseStatement('/statements every agent')).toBe('')
  })

  it("downloads the named agent's statement for this month as CSV", async () => {
    const { asked, saved } = mockBff()
    const card = await typeInChat('/statement Researcher')
    await waitFor(() => expect(within(card).getByLabelText('Whose statement')).toHaveValue('agt_1'))
    const form = within(card).getByTestId('agent-statement-download')
    expect(within(form).getByLabelText('First day of Researcher’s statement')).toHaveValue('2026-10-01')
    expect(within(form).getByLabelText('Last day of Researcher’s statement')).toHaveValue('2026-10-06')
    fireEvent.click(within(form).getByRole('button', { name: 'Download' }))

    expect(await within(form).findByText('Saved researcher-statement-2026-10-01-to-2026-10-06.csv.')).toBeTruthy()
    expect(asked).toEqual(['/api/agents/agt_1/statement?from=2026-10-01&to=2026-10-07&format=csv'])
    expect(await saved[0].text).toBe(CSV('agent:agt_1'))
  })

  it("downloads every agent's statement when none is named", async () => {
    const { asked, saved } = mockBff()
    const card = await typeInChat('/statement')
    const whose = within(card).getByLabelText('Whose statement')
    await waitFor(() => expect(within(whose).getAllByRole('option').map((o) => o.textContent)).toEqual(['Every agent', 'Researcher', 'Writer']))
    expect(whose).toHaveValue('')
    fireEvent.click(within(within(card).getByTestId('bank-statement-download')).getByRole('button', { name: 'Download' }))

    await waitFor(() => expect(saved[0]?.name).toBe('agent-wallets-statement-2026-10-01-to-2026-10-06.csv'))
    expect(asked).toEqual(['/api/agents/statement?from=2026-10-01&to=2026-10-07&format=csv'])
    expect(await saved[0].text).toBe(CSV('workspace'))
  })
})
