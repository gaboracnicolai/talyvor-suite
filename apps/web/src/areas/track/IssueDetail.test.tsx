import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { IssueDetail } from './IssueDetail'

function renderDetail(issueId: string) {
  return render(
    <MemoryRouter initialEntries={[`/track/issues/${issueId}`]}>
      <Routes>
        <Route path="/track/issues/:issueId" element={<IssueDetail />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('IssueDetail', () => {
  it('renders title, status, assignee, description and the roster-resolved thread', () => {
    renderDetail('iss-1')
    expect(screen.getByText('ENG-42')).toBeInTheDocument()
    expect(screen.getByText('Gateway 502s on cold start when the upstream pool is empty')).toBeInTheDocument()
    expect(screen.getByText('In progress')).toBeInTheDocument()
    // "Jonas Weber" appears twice by design: as the assignee Row AND as a comment
    // author — both resolved from the same roster read, which is the point.
    expect(screen.getAllByText('Jonas Weber').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/First request after a deploy/)).toBeInTheDocument()

    // the thread: three comments, authors resolved by roster id, edit marker verbatim
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('Amara Okafor')).toBeInTheDocument()
    expect(screen.getByText(/Careful with the hold/)).toBeInTheDocument()
    expect(screen.getByText(/· edited/)).toBeInTheDocument()
  })

  it("surfaces Track's distinctive AI-cost rollup when non-zero", () => {
    renderDetail('iss-1')
    expect(screen.getByText('$0.42')).toBeInTheDocument()
    expect(screen.getByText(/5,210 tokens via gateway/)).toBeInTheDocument()
  })

  it('omits the AI-cost row entirely at zero', () => {
    renderDetail('iss-3')
    expect(screen.queryByText('AI cost')).not.toBeInTheDocument()
  })

  it('unknown id renders the calm not-found state with a way back', () => {
    renderDetail('iss-nope')
    expect(screen.getByText('Issue not found')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to issues' })).toHaveAttribute('href', '/track')
  })

  it('empty comment thread states itself quietly', () => {
    renderDetail('iss-3')
    expect(screen.getByText('No comments yet.')).toBeInTheDocument()
  })
})
