import { MemoryRouter } from 'react-router-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SplitShortfall } from './SplitShortfall'

// B28.269 — the note under the per-model split is one plain, complete sentence that points
// to the Ledger, not "in no row of this split … absence of provenance".
describe('SplitShortfall', () => {
  it('says what is not broken down by model in one sentence ending at the Ledger', () => {
    render(
      <MemoryRouter>
        <SplitShortfall unattributed={1_500_000} notShown={0} shownCount={3} floor={false} testId="note" />
      </MemoryRouter>,
    )
    const text = screen.getByTestId('note').textContent?.replace(/\s+/g, ' ').trim()
    expect(text).toMatch(/^.+ of the total above is not broken down by model, because those charges did not record which model they were for; each one is listed in the Ledger\.$/)
    expect(text).not.toMatch(/no row of this split|provenance/)
    expect(screen.getByRole('link', { name: 'Ledger' }).getAttribute('href')).toBe('/ledger')
  })
})
