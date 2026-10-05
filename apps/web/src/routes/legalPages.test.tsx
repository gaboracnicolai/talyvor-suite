import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../App'
import { longDate, sectionId } from './legalParts'

// B28.274 — Privacy and Terms are read whole and dated: each says the day its words last changed,
// lists every section before the first, and ends with a line saying it has ended.

const SIGNED_OUT = { mode: 'oidc', authenticated: false, user: null }

beforeEach(() => {
  queryClient.clear()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
    String(input) === '/auth/me'
      ? new Response(JSON.stringify(SIGNED_OUT), { status: 200, headers: { 'Content-Type': 'application/json' } })
      : new Response('null', { status: 404 }),
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

function at(path: string) {
  window.history.pushState({}, '', path)
  return render(<App />)
}

describe('the legal pages', () => {
  it('reads a date as a calendar day and an anchor without its warning sign', () => {
    expect(longDate('2026-10-05')).toBe('5 October 2026')
    expect(sectionId('⚠ Earned LENS is not yours to spend straight away')).toBe(
      'earned-lens-is-not-yours-to-spend-straight-away',
    )
  })

  it.each(['Terms', 'Privacy'])('%s is dated, lists every section, and says where it ends', async (title) => {
    const { container } = at(`/${title.toLowerCase()}`)
    await screen.findByRole('heading', { level: 1, name: title })

    const dates = Array.from(container.querySelectorAll('main time')).map((t) => [t.getAttribute('dateTime'), t.textContent])
    expect(dates).toEqual([
      ['2026-10-05', '5 October 2026'],
      ['2026-10-05', '5 October 2026'],
    ])
    expect(screen.getByText(/Last updated/, { selector: 'header p' })).toHaveTextContent('Last updated 5 October 2026.')

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    const links = within(screen.getByRole('navigation', { name: 'On this page' })).getAllByRole('link')
    expect(links.map((a) => a.textContent)).toEqual(headings)
    for (const a of links) {
      const target = container.querySelector(a.getAttribute('href') ?? '')
      expect(target?.tagName, `${a.getAttribute('href')} points at no section`).toBe('SECTION')
    }

    const end = screen.getByText(new RegExp(`^End of ${title}\\.`))
    expect(end).toHaveTextContent(`End of ${title}. Last updated 5 October 2026. Back to the contents`)
    expect(screen.getByText(/Draft — needs legal review/)).toBeInTheDocument()
  })
})
