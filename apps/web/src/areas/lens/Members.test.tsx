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

  it('renders exactly one fixture notice, without placeholder wording', () => {
    render(<Members />)
    expect(screen.getAllByText(/sample data/i)).toHaveLength(1)
    expect(screen.queryByText(/placeholder/i)).not.toBeInTheDocument()
  })

  // Regression lock for the review finding: this fixture MUST NOT impersonate a
  // real person. Every address is on the RFC-2606 `.invalid` TLD (never a real
  // mailbox), so no future edit can quietly reintroduce a real name/email behind
  // the "sample data" label — the notice and the data can never disagree again.
  it('the fixture roster is unmistakably synthetic — every email is unroutable .invalid', () => {
    for (const m of fixtureRoster) {
      expect(m.email).toMatch(/@example\.invalid$/)
    }
  })
})
