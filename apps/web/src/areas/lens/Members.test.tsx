import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Members } from './Members'
import { fixtureRoster } from './fixtures'

describe('Members', () => {
  it('lists the roster with names, emails and roles, owner first', () => {
    render(<Members />)
    for (const m of fixtureRoster) {
      expect(screen.getByText(m.name)).toBeInTheDocument()
      expect(screen.getByText(m.email)).toBeInTheDocument()
    }
    const roles = screen.getAllByText(/^(owner|member)$/)
    expect(roles.length).toBe(2)
    expect(roles[0]).toHaveTextContent('owner')
  })

  it('renders exactly one fixture notice', () => {
    render(<Members />)
    expect(screen.getAllByText(/placeholder/i)).toHaveLength(1)
  })
})
