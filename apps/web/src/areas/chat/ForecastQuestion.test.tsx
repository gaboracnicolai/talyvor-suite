import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'
import { parseRunOut } from './ForecastQuestion'

// B28.357 — "Will Researcher run out this month?" in Chat: the question opens a card that answers from Lens's month-end
// forecast, and the date it states is the forecast's runs_out_at for that agent. The BFF is mocked at the wire; that the
// date equals Lens's own /forecast output is proven against Lens by the e2e scenario chat-forecast-answer.

const M = 1_000_000

type ForecastAgent = { agent_id: string; name: string; spent_ulxc: number; forecast_ulxc: number; balance_ulxc?: number; runs_out_at?: string | null }

function mockBff(agents: ForecastAgent[]) {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models') {
      return json([{ id: 'claude-opus-5', provider: 'anthropic', display_name: 'Claude Opus 5', input_per_1m: 5, output_per_1m: 25, tier: 'frontier', release_date: '2026-06-01' }])
    }
    if (url === '/api/ai/providers') return json({ unconfigured: [] })
    if (url === '/api/agents/approvals') return json({ approvals: [] })
    if (url === '/api/agents/forecast') {
      const spent = agents.reduce((s, a) => s + a.spent_ulxc, 0)
      const forecast = agents.reduce((s, a) => s + a.forecast_ulxc, 0)
      return json({ at: '2026-10-06T10:00:00Z', month_start: '2026-10-01T00:00:00Z', month_end: '2026-11-01T00:00:00Z', spent_ulxc: spent, forecast_ulxc: forecast, agents })
    }
    return new Response('null', { status: 404 })
  })
}

async function ask(question: string) {
  const box = await screen.findByRole('textbox', { name: /message/i })
  await waitFor(() => expect(box).not.toBeDisabled())
  fireEvent.change(box, { target: { value: question } })
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() => expect(box).toHaveValue(''))
  const card = (await screen.findAllByTestId('chat-forecast')).find((c) => c.textContent?.includes(question))
  if (card === undefined) throw new Error(`no card for "${question}"`)
  return card
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.history.pushState({}, '', '/')
})

describe('Will an agent run out this month, answered in Chat from the forecast (B28.357)', () => {
  it('reads the agent the question names; any other question goes to the model', () => {
    expect(parseRunOut('Will agent A run out this month?')).toBe('A')
    expect(parseRunOut('when will “Support bot” run out of money')).toBe('Support bot')
    expect(parseRunOut('Is Researcher going to run out before the end of the month?')).toBe('Researcher')
    expect(parseRunOut('Will it rain this month?')).toBeNull()
  })

  it('states the date the forecast gives, as the calendar date Lens wrote it in', async () => {
    mockBff([
      // 00:30 on the 24th where the agent is, 22:30 on the 23rd in UTC: the agent's date is the one stated.
      { agent_id: 'agt_1', name: 'Researcher', spent_ulxc: 6 * M, forecast_ulxc: 31 * M, balance_ulxc: 4 * M, runs_out_at: '2026-10-24T00:30:00+02:00' },
      { agent_id: 'agt_2', name: 'Support bot', spent_ulxc: M, forecast_ulxc: 5 * M, balance_ulxc: 20 * M, runs_out_at: '2026-12-02T09:00:00Z' },
    ])
    window.history.pushState({}, '', '/chat')
    render(<App />)

    const yes = await ask('Will researcher run out this month?')
    expect(screen.queryAllByTestId('turn-user')).toHaveLength(0) // nothing went to the model
    const said = await within(yes).findByTestId('chat-forecast-answer')
    expect(said).toHaveTextContent(/^Yes\. At its pace so far this month, Researcher runs out on 24 October 2026\.$/)
    expect(within(said).getByTestId('chat-forecast-date')).toHaveAttribute('dateTime', '2026-10-24')
    expect(yes).toHaveTextContent('It has spent 6 LXC this month; at that pace, 31 LXC by the month’s end. It holds 4 LXC now.')
    expect(within(yes).getByRole('link', { name: 'See it on Agent Wallets' })).toHaveAttribute('href', '/agents?agent=agt_1')

    const no = await ask('Will Support bot run out this month?')
    expect(await within(no).findByTestId('chat-forecast-answer')).toHaveTextContent(/^No, not this month\. At its pace so far, Support bot runs out on 2 December 2026\.$/)
  })

  it('says so when Lens’s forecast gives no date, with the month’s spend and where it is heading', async () => {
    mockBff([{ agent_id: 'agt_1', name: 'Researcher', spent_ulxc: 6 * M, forecast_ulxc: 31 * M }])
    window.history.pushState({}, '', '/chat')
    render(<App />)

    const card = await ask('Will Researcher run out this month?')
    expect(await within(card).findByTestId('chat-forecast-answer')).toHaveTextContent('Lens’s forecast does not say yet when Researcher runs out.')
    expect(within(card).queryByTestId('chat-forecast-date')).toBeNull()
    expect(card).toHaveTextContent('It has spent 6 LXC this month; at that pace, 31 LXC by the month’s end.')
  })
})
