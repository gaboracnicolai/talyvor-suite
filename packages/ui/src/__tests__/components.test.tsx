import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button, HoldBar, MuNumeral, Pill, Shell, Switch, TierDot } from '../components'
import { focusRing } from '../lib/focus'

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

  it('Shell: below 840px the sidebar is a drawer — Menu opens it; a link, Escape or the backdrop closes it', () => {
    render(
      <Shell sidebar={<a href="#issues" className={focusRing}>Issues</a>} nav={<h1>Overview</h1>}>
        page
      </Shell>,
    )
    const menu = screen.getByRole('button', { name: 'Menu' })
    const aside = document.querySelector('aside')!
    // closed: invisible (so nothing in it takes focus) until the phone asks for it; always shown from `wide` up
    expect(menu).toHaveAttribute('aria-expanded', 'false')
    expect(menu).toHaveAttribute('aria-controls', aside.id)
    expect(aside.className.split(' ')).toEqual(expect.arrayContaining(['invisible', 'wide:visible', 'wide:static']))

    fireEvent.click(menu)
    expect(menu).toHaveAttribute('aria-expanded', 'true')
    expect(aside.className.split(' ')).toContain('visible')
    expect(aside.className.split(' ')).not.toContain('invisible')
    expect(screen.getByRole('link', { name: 'Issues' })).toHaveFocus()

    fireEvent.click(screen.getByRole('link', { name: 'Issues' }))
    expect(menu).toHaveAttribute('aria-expanded', 'false')
    expect(menu).toHaveFocus()

    fireEvent.click(menu)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(menu).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(menu)
    fireEvent.click(screen.getByRole('button', { name: 'Close navigation' }))
    expect(menu).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'Close navigation' })).toBeNull()
  })
})
