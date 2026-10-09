import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B30.103 — the DONE line: accepting a capability's terms on screen lets its first use through. The mock BFF answers
// the way Lens B30.9 does: the list, each capability's latest text, an acceptance of the latest version only (409 with
// Lens's sentence otherwise), and a currency conversion refused, naming the version, until fx's latest terms are
// accepted — the gate Lens's PostMoney applies (economy.termsRefusal reads the same acceptances the list does).

const FX_BODY = '# Draft — for legal review\n\n## Converting between currencies\n\nTalyvor converts at the rate it shows.'

function mockBff({ published = 1 } = {}) {
  const sent: Array<{ url: string; body: unknown }> = []
  const accepted = new Map<string, { capability: string; version: number; person: string; accepted_at: string }>()
  const terms = () => [
    { capability: 'fx', name: 'Converting between currencies', class: 'RED', version: published, published_at: '2026-10-09T08:00:00Z', accepted: accepted.get('fx') },
    { capability: 'payments_out', name: 'Paying people and companies outside Talyvor', class: 'RED', version: 2, published_at: '2026-10-09T08:00:00Z', previously_accepted_version: 1 },
  ]
  // What Lens's gate says to a conversion: refused, naming the version, until the latest terms are accepted.
  const convert = () =>
    accepted.get('fx')?.version === published
      ? { status: 201, body: { entry: { capability: 'fx' } } }
      : { status: 403, body: { error: `Converting between currencies needs its terms accepted before it is used: this workspace has not accepted version ${published} of them` } }
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/terms') return json({ terms: terms() })
    if (url === '/api/terms/fx') return json({ ...terms()[0], text_path: 'docs/terms/fx.md', body: FX_BODY })
    if (url === '/api/terms/fx/accept' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { version: number }
      sent.push({ url, body })
      if (body.version !== published) return json({ error: 'economy: a newer version of these terms is published' }, 409)
      const a = { capability: 'fx', version: body.version, person: 'owner@example.com', accepted_at: '2026-10-09T09:00:00Z' }
      accepted.set('fx', a)
      return json({ acceptance: a }, 201)
    }
    if (url === '/api/wallets/capabilities')
      return json({ capabilities: [{ capability: 'fx', name: 'Converting between currencies', class: 'RED', real_money: false, level_needed: 'L2' }] })
    return json({ error: 'not found' }, 404)
  })
  return { sent, convert, publish: (v: number) => (published = v) }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('the Capability terms screen', () => {
  it('reads fx’s terms, accepts the version read, and the conversion refused before goes through after', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/settings/terms')
    render(<App />)

    const fx = await screen.findByTestId('terms-fx')
    expect(within(fx).getByText('Not accepted yet')).toBeTruthy()
    expect(within(screen.getByTestId('terms-payments_out')).getByText('Version 2 is new — accept it again')).toBeTruthy()
    expect(screen.getByTestId('terms-count').textContent).toBe('0 of 2 accepted')
    expect(screen.getByTestId('terms-preview').textContent).toContain('Preview — test money only')
    expect(bff.convert().status).toBe(403)

    fireEvent.click(within(fx).getByRole('button', { name: 'Read and accept' }))
    expect(await within(fx).findByRole('heading', { name: 'Draft — for legal review' })).toBeTruthy()
    fireEvent.click(within(fx).getByRole('button', { name: 'Accept version 1' }))

    expect(await within(fx).findByText('Accepted')).toBeTruthy()
    expect(within(fx).getByRole('status').textContent).toBe('Version 1 is accepted by owner@example.com. Converting between currencies may be used.')
    expect(screen.getByTestId('terms-count').textContent).toBe('1 of 2 accepted')
    expect(bff.sent).toEqual([{ url: '/api/terms/fx/accept', body: { version: 1 } }])
    expect(bff.convert().status).toBe(201)
  })

  it('shows Lens’s sentence when a newer version was published while the owner read the old one', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/settings/terms')
    render(<App />)

    const fx = await screen.findByTestId('terms-fx')
    fireEvent.click(within(fx).getByRole('button', { name: 'Read and accept' }))
    const accept = await within(fx).findByRole('button', { name: 'Accept version 1' })
    bff.publish(2)
    fireEvent.click(accept)

    expect((await within(fx).findByRole('alert')).textContent).toBe('A newer version of these terms is published.')
    expect(bff.convert().status).toBe(403)
  })
})
