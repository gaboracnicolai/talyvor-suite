import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Specimen } from './routes/Specimen'

// Proves the review surface renders: every component mounts inside BOTH a light and a
// dark themed frame without error (jsdom). The visual review is done in a browser; this
// is the guarantee that the tree is renderable in both themes at all.
describe('specimen renders every component in both themes', () => {
  it('mounts a light frame and a dark frame, each with the gallery', () => {
    render(<Specimen />)
    const light = screen.getByLabelText('light theme')
    const dark = screen.getByLabelText('dark theme')
    expect(light).toHaveAttribute('data-theme', 'light')
    expect(dark).toHaveAttribute('data-theme', 'dark')
    // a representative component from the gallery is present in each frame
    expect(within(light).getByRole('button', { name: 'Primary' })).toBeInTheDocument()
    expect(within(dark).getByRole('button', { name: 'Primary' })).toBeInTheDocument()
    // the µ-numeral tail and routing ramp render too
    expect(within(dark).getAllByText(/\.340567/).length).toBeGreaterThan(0)
    expect(within(light).getAllByRole('img', { name: /cheap|capable/ }).length).toBeGreaterThan(0)
  })
})
