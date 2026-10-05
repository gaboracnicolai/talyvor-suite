import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B19.4 — the Agent Bank, walked the way its DONE line reads: create an agent, fund it, set a daily
// limit, watch a payment over that limit refused with Lens's sentence, and approve a payment from the
// inbox. The mock BFF keeps balances and judges the two rules the walk needs the way Lens does
// (internal/economy/agent_rules.go): the daily limit before the approval amount, and an approved
// payment let through once.

const M = 1_000_000

function mockBff() {
  const agents: Array<{ id: string; name: string; balance_ulxc: number; spent_ulxc: number; keys: string[]; created_at: string }> = []
  const rules: Record<string, Record<string, unknown>> = {}
  const approvals: Array<{ id: string; agent_id: string; amount_ulxc: number; model: string; status: string; created_at: string; fp: string; payee?: { kind: 'agent'; id: string; name: string }; memo?: string }> = []
  let workspace = 100 * M
  const paid: Record<string, number> = {}
  const moveKeys: string[] = []
  const blips: Array<502 | 'drop'> = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    const allocated = () => agents.reduce((s, a) => s + a.balance_ulxc, 0)
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/agents' && method === 'GET')
      return json({
        workspace_balance_ulxc: workspace,
        allocated_ulxc: allocated(),
        unallocated_ulxc: workspace - allocated(),
        spent_ulxc: 0,
        agents,
      })
    if (url === '/api/agents' && method === 'POST') {
      const a = { id: `agt_${agents.length + 1}`, name: String(body.name), balance_ulxc: 0, spent_ulxc: 0, keys: [], created_at: '2026-09-28T06:00:00Z' }
      agents.push(a)
      return json(a, 201)
    }
    if (url === '/api/agents/approvals') return json({ approvals })
    const decision = /^\/api\/agents\/approvals\/([^/]+)\/(approve|deny)$/.exec(url)
    if (decision) {
      const a = approvals.find((x) => x.id === decision[1])!
      a.status = decision[2] === 'approve' ? 'approved' : 'denied'
      return json(a)
    }
    const m = /^\/api\/agents\/([^/]+)\/(\w+)$/.exec(url)
    const agent = agents.find((a) => a.id === m?.[1])
    if (!m || !agent) return new Response('null', { status: 404 })
    const r = rules[agent.id] ?? {}
    switch (m[2]) {
      case 'fund':
        agent.balance_ulxc += Number(body.amount_ulxc)
        return json({ agent_id: agent.id, balance_ulxc: agent.balance_ulxc })
      case 'withdraw': {
        moveKeys.push(new Headers(init?.headers).get('Idempotency-Key') ?? '')
        const blip = blips.shift()
        if (blip === 502) return json({ error: 'Lens could not answer just now' }, 502)
        if (blip === 'drop') throw new TypeError('Failed to fetch')
        agent.balance_ulxc -= Number(body.amount_ulxc)
        return json({ agent_id: agent.id, balance_ulxc: agent.balance_ulxc })
      }
      case 'rules':
        if (method === 'PUT') rules[agent.id] = body
        return json({
          max_per_request_ulxc: 0, daily_limit_ulxc: 0, monthly_limit_ulxc: 0, approval_above_ulxc: 0,
          allowed_models: null, allowed_providers: null, active_from: '', active_until: '', timezone: '',
          ...rules[agent.id],
        })
      case 'statement':
        return json({ agent_id: agent.id, lines: [] })
      case 'pay': {
        const amount = Number(body.amount_ulxc)
        const daily = Number(r.daily_limit_ulxc ?? 0)
        const spent = paid[agent.id] ?? 0
        if (daily > 0 && spent + amount > daily)
          return json({ error: `economy: the agent's spending rules refuse this request: the agent has spent ${spent / M} LXC of its daily limit of ${daily / M} LXC, and this payment would cost up to ${amount / M} LXC` }, 403)
        const fp = `${agent.id}>${String(body.to_agent_id)}:${amount}:${String(body.memo)}`
        if (Number(r.approval_above_ulxc ?? 0) > 0 && amount > Number(r.approval_above_ulxc)) {
          const ok = approvals.find((x) => x.fp === fp && x.status === 'approved')
          if (ok) ok.status = 'used'
          else {
            let open = approvals.find((x) => x.fp === fp && x.status === 'pending')
            if (!open) {
              // Lens B23.5: the approval names who it pays and why.
              const payee = agents.find((a) => a.id === body.to_agent_id)!
              open = { id: `apr_${approvals.length + 1}`, agent_id: agent.id, amount_ulxc: amount, model: '', status: 'pending', created_at: '2026-09-28T06:05:00Z', fp,
                payee: { kind: 'agent', id: payee.id, name: payee.name }, memo: String(body.memo) }
              approvals.push(open)
            }
            return json({ error: `this request would cost up to ${amount / M} LXC, above the agent's approval amount — approval ${open.id} must be approved by the workspace's owner before it is retried` }, 403)
          }
        }
        const to = agents.find((a) => a.id === body.to_agent_id)!
        agent.balance_ulxc -= amount
        to.balance_ulxc += amount
        paid[agent.id] = spent + amount
        return json({ entry_id: 'e1', from_agent_id: agent.id, to_agent_id: to.id, amount_ulxc: amount, from_balance_ulxc: agent.balance_ulxc, to_balance_ulxc: to.balance_ulxc, memo: body.memo })
      }
    }
    return new Response('null', { status: 404 })
  })
  return { agents, approvals, moveKeys, blips, setWorkspace: (v: number) => (workspace = v) }
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

async function createAgent(name: string) {
  fireEvent.change(screen.getByLabelText('New agent name'), { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: 'Create agent' }))
  await waitFor(() => expect(screen.getByTestId('agent-open')).toHaveTextContent(name))
}

describe('Agent Bank', () => {
  // B17.26 — a Take back that meets a deploy's restart (a 502, then no answer) is sent again under one
  // Idempotency-Key and lands, instead of "Nothing changed. You can try again."
  it('takes LXC back through a restart, sending the same key until it is answered', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/agents')
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('agent-bank-totals')).toHaveTextContent('The workspace holds 100 LXC'))
    await createAgent('South')
    fireEvent.change(screen.getByLabelText('Amount in LXC for South'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Fund' }))
    await waitFor(() => expect(screen.getByTestId('agent-balance-agt_1')).toHaveTextContent('1 LXC'))

    bff.blips.push(502, 'drop')
    fireEvent.change(screen.getByLabelText('Amount in LXC for South'), { target: { value: '0.25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Take back' }))
    await waitFor(() => expect(screen.getByText(/South now holds/)).toHaveTextContent('South now holds 0.75 LXC.'), { timeout: 5_000 })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(bff.moveKeys).toHaveLength(3)
    expect(bff.moveKeys[0]).not.toBe('')
    expect(new Set(bff.moveKeys).size).toBe(1)
  }, 15_000)

  it('creates and funds an agent, refuses a payment over its daily limit, and pays once approved from the inbox', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/agents')
    render(<App />)

    await waitFor(() => expect(screen.getByTestId('agent-bank-totals')).toHaveTextContent('The workspace holds 100 LXC'))
    await createAgent('Writer')
    await createAgent('Researcher')

    fireEvent.change(screen.getByLabelText('Amount in LXC for Researcher'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Fund' }))
    await waitFor(() => expect(screen.getByTestId('agent-balance-agt_2')).toHaveTextContent('10 LXC'))
    expect(screen.getByTestId('agent-bank-totals')).toHaveTextContent('10 LXC with its agents and 90 LXC free to fund them')

    const daily = await screen.findByLabelText('Daily limit for Researcher, in LXC')
    fireEvent.change(daily, { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('Ask a person above for Researcher, in LXC'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }))
    await screen.findByText(/Saved\. Lens applies these rules/)

    const pay = within(screen.getByRole('group', { name: 'Pay to' }))
    fireEvent.click(pay.getByRole('button', { name: 'Writer' }))
    fireEvent.change(screen.getByLabelText('Payment in LXC from Researcher'), { target: { value: '6' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pay' }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        "Refused. The agent's spending rules refuse this request: the agent has spent 0 LXC of its daily limit of 5 LXC, and this payment would cost up to 6 LXC.",
      ),
    )
    expect(screen.getByTestId('agent-balance-agt_2')).toHaveTextContent('10 LXC')

    fireEvent.change(screen.getByLabelText('Payment in LXC from Researcher'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('What the payment is for'), { target: { value: 'draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pay' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('It is waiting in Approvals'))
    expect(bff.approvals.map((a) => a.status)).toEqual(['pending'])
    // B27.21: the row reads single-spaced — the figure alone in the figure face, " LXC" in the sentence's.
    const asks = await screen.findByText(/wants to pay Writer/)
    expect(asks.textContent).toBe('Researcher wants to pay Writer 3 LXC — draft')
    expect(asks.querySelector('.font-figure')?.textContent).toBe('3')

    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    await waitFor(() =>
      expect(screen.getByText(/Approved and paid/)).toHaveTextContent('Approved and paid 3 LXC from Researcher to Writer.'),
    )
    expect(bff.approvals.map((a) => a.status)).toEqual(['used'])
    expect(screen.queryByRole('alert')).toBeNull()
    await waitFor(() => expect(screen.getByTestId('agent-balance-agt_2')).toHaveTextContent('7 LXC'))
    expect(screen.getByTestId('agent-balance-agt_1')).toHaveTextContent('3 LXC')
    // A long walk: on CI it took 3.9–4.5 s of the default 5 s before B28.24 added two limits to the form.
  }, 15_000)
})
