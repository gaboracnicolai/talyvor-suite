import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B19.22 — the DONE line: Nicolai downloads last month's CSV statement for one agent and for the whole
// bank, and the file opens with its opening and closing balances. The mock BFF answers the period
// statement the way Lens B19.5 writes it; the test reads the file the screen hands the browser.

const CSV = (account: string) =>
  'posting_id,entry_id,at,account,kind,amount_ulxc,counterparty,ref,balance_after_ulxc\r\n' +
  `,,2026-08-01T00:00:00Z,${account},opening,,,,0\r\n` +
  `7,ent_1,2026-08-03T10:00:00Z,${account},fund,5000000,workspace,,5000000\r\n` +
  `,,2026-09-01T00:00:00Z,${account},closing,,,,5000000\r\n`

function mockBff() {
  const asked: string[] = []
  const saved: Array<{ name: string; text: Promise<string> }> = []
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-28T12:00:00Z'))
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  URL.createObjectURL = vi.fn((b: Blob) => {
    // jsdom's Blob has no .text(); FileReader is how it reads one.
    const text = new Promise<string>((resolve) => {
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
    if (url === '/api/agents/agt_1/statement?from=2026-08-01&to=2026-09-01&format=csv') return csv('agent:agt_1')
    if (url === '/api/agents/statement?from=2026-08-01&to=2026-09-01&format=csv') return csv('workspace')
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents')
      return json({
        workspace_balance_ulxc: 20_000_000, allocated_ulxc: 5_000_000, unallocated_ulxc: 15_000_000, spent_ulxc: 0,
        agents: [{ id: 'agt_1', name: 'Researcher', balance_ulxc: 5_000_000, spent_ulxc: 0, keys: [], created_at: '2026-08-01T09:00:00Z' }],
      })
    if (url === '/api/agents/schedules') return json({ schedules: [] })
    if (url === '/api/agents/agt_1/topup') return json({ error: 'the agent has no automatic top-up' }, 404)
    if (url === '/api/agents/forecast') return json({ at: '', month_start: '', month_end: '', spent_ulxc: 0, forecast_ulxc: 0, agents: [] })
    if (url === '/api/agents/alerts') return json({ alerts: [], rule: 'the rule' })
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/agents/passkeys') return json({ passkeys: [] })
    if (url === '/api/agents/agt_1/statement') return json({ agent_id: 'agt_1', lines: [] })
    if (url === '/api/marketplace/listings') return json({ listings: [] })
    if (url === '/api/agents/agt_1/rules')
      return json({ max_per_request_ulxc: 0, daily_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 0, allowed_models: [], allowed_providers: [], allowed_listings: [], active_from: '', active_until: '', timezone: 'UTC', pause_on_unusual_spend: false })
    return new Response('null', { status: 404 })
  })
  return { asked, saved }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('downloading a statement for a period on the Agent Bank', () => {
  it("saves last month's CSV for one agent, opening and closing balances included", async () => {
    const { asked, saved } = mockBff()
    window.history.pushState({}, '', '/agents')
    render(<App />)

    const form = await screen.findByTestId('agent-statement-download')
    expect((within(form).getByLabelText('First day of Researcher’s statement') as HTMLInputElement).value).toBe('2026-08-01')
    expect((within(form).getByLabelText('Last day of Researcher’s statement') as HTMLInputElement).value).toBe('2026-08-31')
    fireEvent.click(within(form).getByRole('button', { name: 'Download' }))

    expect(await within(form).findByText('Saved researcher-statement-2026-08-01-to-2026-08-31.csv.')).toBeTruthy()
    expect(asked).toEqual(['/api/agents/agt_1/statement?from=2026-08-01&to=2026-09-01&format=csv'])
    expect(saved[0].name).toBe('researcher-statement-2026-08-01-to-2026-08-31.csv')
    const text = await saved[0].text
    expect(text).toContain('agent:agt_1,opening,,,,0')
    expect(text).toContain('agent:agt_1,closing,,,,5000000')
  })

  it("saves last month's CSV for the whole bank", async () => {
    const { asked, saved } = mockBff()
    window.history.pushState({}, '', '/agents')
    render(<App />)

    const form = await screen.findByTestId('bank-statement-download')
    fireEvent.click(within(form).getByRole('button', { name: 'Download' }))

    await waitFor(() => expect(saved[0]?.name).toBe('agent-bank-statement-2026-08-01-to-2026-08-31.csv'))
    expect(asked).toEqual(['/api/agents/statement?from=2026-08-01&to=2026-09-01&format=csv'])
    const text = await saved[0].text
    expect(text).toContain('workspace,opening')
    expect(text).toContain('workspace,closing')
  })
})
