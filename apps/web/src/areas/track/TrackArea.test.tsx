import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TrackArea } from './TrackArea'

// Area-owned smoke test — replaces the deleted shared areas/scaffold.test.tsx,
// which asserted every area's screen but which no area tab was allowed to
// edit (the deadlock). The track tab updates THIS file alongside its screens:
// screen and test evolve together inside one directory, touching nothing
// shared. The kept guarantee: the routed screen renders (bare, while it needs
// no providers) and names its area.
describe('TrackArea', () => {
  it('renders without providers and names its area', () => {
    render(<TrackArea />)
    expect(screen.getAllByText(/track/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/placeholder/i)).toBeInTheDocument()
  })
})
