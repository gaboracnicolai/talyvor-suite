import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B30.116 — the DONE line: on the Verification screen an owner reaches L1 then L2 on the Test provider and sees L2
// shown, the live level L0, and each capability's level. The mock BFF answers the way Lens B30.4 does: each check
// needs the level below it (409 with Lens's sentence otherwise), and a Test provider's pass leaves the live level at L0.

const MEANINGS = ['signed in', 'email and phone confirmed', 'identity checked', 'company checked']

function mockBff() {
  const sent: Array<{ url: string; body: unknown }> = []
  const checks: Array<Record<string, unknown>> = []
  const record = () => ({
    workspace_id: 'ws_1',
    level: `L${checks.length}`,
    meaning: MEANINGS[checks.length],
    live_level: 'L0',
    live_meaning: MEANINGS[0],
    checks: checks.length === 0 ? null : [...checks],
  })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/verification') return json(record())
    const m = /^\/api\/verification\/(contact|identity|company)$/.exec(url)
    if (m && method === 'POST') {
      const body = JSON.parse(String(init?.body))
      sent.push({ url, body })
      const level = ['contact', 'identity', 'company'].indexOf(m[1]) + 1
      if (checks.length < level - 1) {
        return json({ error: `economy: verification levels are reached in order: the ${MEANINGS[level]} check (L${level}) needs L${level - 1} — ${MEANINGS[level - 1]} — first; this workspace is at L${checks.length}` }, 409)
      }
      const check = { level: `L${level}`, subject: ['contact', 'person', 'company'][level - 1], method: 'test', test: true, status: 'completed', evidence_ref: `kyc_test_${level}`, started_at: '2026-10-08T09:00:00Z', checked_at: '2026-10-08T09:00:00Z' }
      checks.unshift(check)
      return json({ check, verification: record() }, 201)
    }
    if (url === '/api/wallets/capabilities')
      return json({
        capabilities: [
          { capability: 'spend_on_talyvor', name: 'Spending on Talyvor', class: 'GREEN', real_money: true, level_needed: 'L0' },
          { capability: 'payments_out', name: 'Paying people and companies outside Talyvor', class: 'RED', real_money: false, level_needed: 'L2' },
          { capability: 'b2b_credit', name: 'Credit lines and loans to companies', class: 'AMBER', real_money: false, level_needed: 'L3' },
        ],
      })
    return json({ error: 'not found' }, 404)
  })
  return sent
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('the Verification screen', () => {
  it('takes an owner from L0 to L1 to L2 on the Test provider, live L0, with each capability’s level', async () => {
    const sent = mockBff()
    window.history.pushState({}, '', '/settings/verification')
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Reach L1: email and phone confirmed' })).toBeTruthy()
    expect(screen.getByTestId('verification-level').textContent).toContain('L0')
    expect(screen.getByTestId('verification-preview').textContent).toContain('Preview — test money only')

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@example.com' } })
    fireEvent.change(screen.getByLabelText('Phone, in international form'), { target: { value: '+447700900123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check email and phone' }))
    expect(await screen.findByText('Passed by the Test provider: L1 — email and phone confirmed. It counts for test money only.')).toBeTruthy()

    expect(await screen.findByRole('heading', { name: 'Reach L2: identity checked' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Ada Owner' } })
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'gb' } })
    fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: '1990-04-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check identity' }))

    expect(await screen.findByRole('heading', { name: 'Reach L3: company checked' })).toBeTruthy()
    expect(screen.getByTestId('verification-level').textContent).toBe('L2identity checked')
    expect(screen.getByTestId('verification-live-level').textContent).toBe('L0signed in')
    expect(screen.getByTestId('verification-test-only').textContent).toContain('count for test money only')
    const rows = screen.getAllByTestId('verification-check')
    expect(rows.map((r) => r.textContent?.slice(0, 2))).toEqual(['L2', 'L1'])
    for (const r of rows) expect(within(r).getByText('Test — counts for test money only')).toBeTruthy()
    expect(within(rows[0]).getByText('kyc_test_2')).toBeTruthy()

    expect(screen.getByTestId('capability-level-spend_on_talyvor').textContent).toBe('Spending on TalyvorL0')
    expect(screen.getByTestId('capability-level-payments_out').textContent).toBe('Paying people and companies outside TalyvorL2')
    expect(screen.getByTestId('capability-level-b2b_credit').textContent).toBe('Credit lines and loans to companiesL3')
    expect(within(screen.getByTestId('verification-needs-L2')).getByText('Reached for test money only')).toBeTruthy()
    expect(within(screen.getByTestId('verification-needs-L3')).getByText('Not reached yet')).toBeTruthy()

    expect(sent).toEqual([
      { url: '/api/verification/contact', body: { email: 'owner@example.com', phone: '+447700900123' } },
      { url: '/api/verification/identity', body: { name: 'Ada Owner', country: 'GB', date_of_birth: '1990-04-01' } },
    ])
  })
})
