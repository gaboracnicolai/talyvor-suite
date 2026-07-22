import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { IssueList } from './IssueList'

// Filters are URL-driven (?status=&assignee_id=&team_id= — the server's own param
// names), so the tests exercise them through initialEntries instead of puppeting the
// Radix Select in jsdom: the URL IS the filter state, and this is exactly what a
// shared/bookmarked link renders.

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <IssueList />
    </MemoryRouter>,
  )
}

describe('IssueList', () => {
  it('renders the dense table with all fixture issues and marks the data as fixture', () => {
    renderAt('/track')
    expect(screen.getByText('14 issues')).toBeInTheDocument()
    expect(screen.getByText('Gateway 502s on cold start when the upstream pool is empty')).toBeInTheDocument()
    expect(screen.getByText('ENG-42')).toBeInTheDocument()
    // the honest marker: fixture data never renders unlabelled
    expect(screen.getByText('Fixture')).toBeInTheDocument()
    expect(screen.getByTitle(/GET \/v1\/workspaces\/\{wsID\}\/issues/)).toBeInTheDocument()
  })

  it('?status=done narrows to done issues only', () => {
    renderAt('/track?status=done')
    expect(screen.getByText('3 issues')).toBeInTheDocument()
    expect(screen.getByText('Dependency graph renders cycles as overlapping edges')).toBeInTheDocument()
    expect(screen.queryByText('Gateway 502s on cold start when the upstream pool is empty')).not.toBeInTheDocument()
  })

  it('?assignee_id narrows to that member', () => {
    renderAt('/track?assignee_id=mem-jonas')
    expect(screen.getByText('3 issues')).toBeInTheDocument()
    expect(screen.getByText('Alert on webhook dedup table growth')).toBeInTheDocument()
  })

  it('?team_id narrows to that team', () => {
    renderAt('/track?team_id=team-ops')
    expect(screen.getByText('6 issues')).toBeInTheDocument()
    expect(screen.queryByText('ENG-42')).not.toBeInTheDocument()
  })

  it('filters AND together and Clear resets to the full list', () => {
    renderAt('/track?team_id=team-ops&assignee_id=mem-jonas')
    expect(screen.getByText('1 issues')).toBeInTheDocument()
    expect(screen.getByText('OPS-14')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByText('14 issues')).toBeInTheDocument()
  })

  it('an unmatchable filter shows the calm empty state, not an error', () => {
    renderAt('/track?status=cancelled&team_id=team-ops')
    expect(screen.getByText('No issues match these filters.')).toBeInTheDocument()
  })

  it('unassigned issues render an em-dash in faint, never an invented name', () => {
    renderAt('/track?status=backlog')
    // all three backlog fixtures are unassigned
    expect(screen.getByText('3 issues')).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3)
  })

  it('each row links to its detail route', () => {
    renderAt('/track?status=in_review')
    const link = screen.getByRole('link', { name: /Allocator 402 body should name the funding step/ })
    expect(link).toHaveAttribute('href', '/track/issues/iss-2')
  })
})
