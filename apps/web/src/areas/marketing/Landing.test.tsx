import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Landing } from './Landing'

// Area-owned smoke test — replaces the deleted shared areas/scaffold.test.tsx
// (the deadlock: a shared test over per-area screens). The marketing tab owns
// this file with its screen. The kept guarantee: the landing renders with NO
// providers — no auth gate, no query client — because it is a public page.
describe('Landing', () => {
  it('renders standalone and links into the app', () => {
    render(<Landing />)
    expect(screen.getByRole('heading', { name: /talyvor/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open the app/i })).toHaveAttribute('href', '/')
  })
})
