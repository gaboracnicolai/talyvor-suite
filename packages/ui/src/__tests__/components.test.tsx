import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button, HoldBar, MuNumeral, Pill, Switch, TierDot } from '../components'

describe('components render + carry accessible semantics', () => {
  it('Button (primary) renders as a button with a type', () => {
    render(<Button variant="primary">Save</Button>)
    const b = screen.getByRole('button', { name: 'Save' })
    expect(b).toHaveAttribute('type', 'button')
  })

  it('Switch exposes role=switch (Radix)', () => {
    render(<Switch aria-label="Enable" defaultChecked />)
    expect(screen.getByRole('switch', { name: 'Enable' })).toBeInTheDocument()
  })

  it('Pill shows its label and hides the colour dot from AT', () => {
    const { container } = render(<Pill status="settled">Settled</Pill>)
    expect(screen.getByText('Settled')).toBeInTheDocument()
    // the coloured dot is aria-hidden; the hue never reaches the accessible name
    expect(container.querySelector('.bg-settled')).toHaveAttribute('aria-hidden', 'true')
  })

  it('MuNumeral splits whole units from the µ-tail (≥ 1 unit)', () => {
    const { container } = render(<MuNumeral micros={12_340567} unit="lens" />)
    expect(container.textContent).toContain('12')
    expect(container.textContent).toContain('.340567')
    expect(container.textContent?.toLowerCase()).toContain('lens')
  })

  it('MuNumeral switches to the µ-integer below one unit (whole === 0)', () => {
    const { container } = render(<MuNumeral micros={64} unit="lxc" />)
    // the µ-integer the ledger stores, not a dimmed decimal tail
    expect(container.textContent).toContain('64')
    expect(container.textContent).not.toContain('.000064')
    // the unit switches to µLXC (µ + lxc; CSS uppercases the letters, not the DOM text)
    expect(container.textContent?.toLowerCase()).toContain('µlxc')
  })

  it('MuNumeral keeps the sign on a sub-unit µ-integer', () => {
    const { container } = render(<MuNumeral micros={-64} unit="lxc" />)
    expect(container.textContent).toContain('-64')
  })

  it('HoldBar is a labelled progressbar', () => {
    render(<HoldBar elapsed={3} total={4} remainingLabel="1d left" />)
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '75')
    expect(screen.getByText('1d left')).toBeInTheDocument()
  })

  it('TierDot carries an accessible label (two categories, no numeral)', () => {
    render(<TierDot tier="capable" />)
    expect(screen.getByRole('img', { name: 'capable' })).toBeInTheDocument()
  })
})
