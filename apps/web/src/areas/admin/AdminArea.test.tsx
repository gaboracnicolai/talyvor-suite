import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AdminArea } from './AdminArea'

// Area-owned smoke test — replaces the deleted shared areas/scaffold.test.tsx,
// which asserted every area's screen but which no area tab was allowed to
// edit (the deadlock). The admin tab updates THIS file alongside its screens:
// screen and test evolve together inside one directory, touching nothing
// shared. The kept guarantee: the routed screen renders (bare, while it needs
// no providers) and names its area.
describe('AdminArea', () => {
  it('renders without providers and names its area', () => {
    render(<AdminArea />)
    expect(screen.getAllByText(/admin/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/placeholder/i)).toBeInTheDocument()
  })
})
