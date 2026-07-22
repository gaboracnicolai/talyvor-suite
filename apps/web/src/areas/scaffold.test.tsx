import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Keys } from './lens/Keys'
import { Spend } from './lens/Spend'
import { Members } from './lens/Members'
import { TrackArea } from './track/TrackArea'
import { DocsArea } from './docs/DocsArea'
import { AdminArea } from './admin/AdminArea'
import { Landing } from './marketing/Landing'

// The scaffold contract: every area route has a placeholder that names what
// will live there, so five parallel tabs each have a landing surface and none
// needs to touch routing, the nav, or another area's directory.

describe('area placeholders', () => {
  const cases: Array<[string, () => React.ReactElement, RegExp]> = [
    ['Keys', () => <Keys />, /api keys/i],
    ['Spend', () => <Spend />, /spend & routing/i],
    ['Members', () => <Members />, /members/i],
    ['TrackArea', () => <TrackArea />, /track/i],
    ['DocsArea', () => <DocsArea />, /docs/i],
    ['AdminArea', () => <AdminArea />, /admin/i],
  ]
  it.each(cases)('%s names its area and marks itself a placeholder', (_n, el, title) => {
    const { unmount } = render(el())
    expect(screen.getAllByText(title).length).toBeGreaterThan(0)
    expect(screen.getByText(/placeholder/i)).toBeInTheDocument()
    unmount()
  })

  it('the marketing landing renders standalone — no auth gate, no query client', () => {
    // Rendering outside every provider proves it depends on neither.
    render(<Landing />)
    expect(screen.getByRole('heading', { name: /talyvor/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open the app/i })).toHaveAttribute('href', '/')
  })
})
